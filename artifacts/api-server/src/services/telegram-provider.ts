import {createHash} from "node:crypto";
import type {ProviderSendResult,ProviderFailureCategory} from "./communication-providers";
import {developmentPaymentNotificationsSuppressed} from "../lib/development-payment-notification-policy";

export interface TelegramHealth {configured:boolean;ready:boolean;reason:string;botUsername:string|null;botId:string|null}
let health:TelegramHealth={configured:false,ready:false,reason:"NOT_CHECKED",botUsername:null,botId:null};
let checkedAt=0,credentialHash="";
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
export const telegramDevelopment=(env:NodeJS.ProcessEnv)=>
  !env.REPLIT_DEPLOYMENT&&(env.NODE_ENV==="development"||env.NODE_ENV==="test");
export function getTelegramHealth(env:NodeJS.ProcessEnv=process.env):TelegramHealth{
  if(!telegramDevelopment(env))return {configured:false,ready:false,reason:"DEVELOPMENT_ONLY",botUsername:null,botId:null};
  if(!env.TELEGRAM_BOT_TOKEN)return {configured:false,ready:false,reason:"TOKEN_MISSING",botUsername:null,botId:null};
  if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return {configured:true,ready:false,reason:"ENCRYPTION_KEY_UNAVAILABLE",botUsername:null,botId:null};
  if(credentialHash!==digest(env.TELEGRAM_BOT_TOKEN)||Date.now()-checkedAt>120000)
    return {configured:true,ready:false,reason:"HEALTH_CHECK_REQUIRED",botUsername:null,botId:null};
  // A separate explicit Development opt-in authorizes only this new channel.
  // Never change the existing SMS/email payment-test or scheduler locks.
  if(health.ready&&developmentPaymentNotificationsSuppressed(env)&&env.EDUCORE_DEVELOPMENT_TELEGRAM_ENABLED!=="true")
    return {...health,ready:false,reason:"DEVELOPMENT_SEND_LOCK"};
  return {...health};
}
export class TelegramApiError extends Error{
  constructor(readonly code:number,readonly retryAfter=0){super("Telegram request failed");}
}
/** No caller may log a request URL, caught transport error, Bot API body or token. */
export async function telegramApi(method:"getMe"|"getWebhookInfo"|"getUpdates"|"sendMessage",body:unknown,
  env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch):Promise<any>{
  if(!telegramDevelopment(env)||!env.TELEGRAM_BOT_TOKEN)throw new TelegramApiError(401);
  try{
    const response=await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      redirect:"error",signal:AbortSignal.timeout(8000),
    });
    const data=await response.json() as any;
    if(!response.ok||data?.ok!==true){
      const code=Number(data?.error_code??response.status);
      const retry=Number(data?.parameters?.retry_after);
      throw new TelegramApiError(Number.isInteger(code)?code:0,
        Number.isSafeInteger(retry)&&retry>0?Math.min(retry,604800):0);
    }
    return data.result;
  }catch(error){if(error instanceof TelegramApiError)throw error;throw new TelegramApiError(0);}
}
export async function refreshTelegramHealth(schemaReady:boolean,env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch){
  if(!telegramDevelopment(env)||!env.TELEGRAM_BOT_TOKEN||!env.SESSION_SECRET||env.SESSION_SECRET.length<32){
    health=getTelegramHealth(env);return health;
  }
  credentialHash=digest(env.TELEGRAM_BOT_TOKEN);checkedAt=Date.now();
  try{
    const bot=await telegramApi("getMe",{},env,transport);
    if(bot?.is_bot!==true||!Number.isSafeInteger(bot.id)||!/^[A-Za-z0-9_]{5,32}$/.test(bot.username??""))
      throw new TelegramApiError(0);
    const webhook=await telegramApi("getWebhookInfo",{},env,transport);
    const reason=webhook?.url?"WEBHOOK_CONFLICT":!schemaReady?"SCHEMA_NOT_READY":"READY";
    health={configured:true,ready:reason==="READY",reason,botUsername:bot.username,botId:String(bot.id)};
  }catch(error){
    health={configured:true,ready:false,reason:error instanceof TelegramApiError&&[401,404].includes(error.code)
      ?"INVALID_TOKEN":"BOT_UNAVAILABLE",botUsername:null,botId:null};
  }
  return getTelegramHealth(env);
}
export interface TelegramProvider {readonly provider:string;readonly channel:"telegram";
  send(message:{to:string;body:string;idempotencyKey:string}):Promise<ProviderSendResult>}
let botBlockedUntil=0;
const chatLastSend=new Map<string,number>();
export function createTelegramProvider(env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch):TelegramProvider|undefined{
  if(!getTelegramHealth(env).ready)return undefined;
  return {provider:"telegram-bot-api",channel:"telegram",async send(message){
    const failure=(category:ProviderFailureCategory,retryable=false,retryAfterSeconds?:number):ProviderSendResult=>({
      provider:"telegram-bot-api",channel:"telegram",status:"FAILED",accepted:false,delivered:false,
      failure:{category,retryable,...(retryAfterSeconds?{retryAfterSeconds}:{})},
    });
    if(!getTelegramHealth(env).ready)return failure("CONFIGURATION");
    if(!/^[1-9]\d{0,15}$/.test(message.to)||!message.body||message.body.length>4096)return failure("INVALID_REQUEST");
    const now=Date.now(),key=digest(message.to),last=chatLastSend.get(key)??0;
    if(botBlockedUntil>now||now-last<1100)return failure("RATE_LIMITED",true,Math.max(2,Math.ceil((botBlockedUntil-now)/1000)));
    if(chatLastSend.size>10000)chatLastSend.clear();
    chatLastSend.set(key,now);
    try{
      const result=await telegramApi("sendMessage",{chat_id:message.to,text:message.body,
        protect_content:true,link_preview_options:{is_disabled:true}},env,transport);
      if(!Number.isSafeInteger(result?.message_id))return failure("UNKNOWN");
      // Bot API acknowledgement is not a read receipt or proof of device delivery.
      return {provider:"telegram-bot-api",channel:"telegram",status:"ACCEPTED",accepted:true,delivered:false,
        providerMessageId:String(result.message_id)};
    }catch(error){
      if(!(error instanceof TelegramApiError))return failure("UNKNOWN");
      if(error.code===429){botBlockedUntil=now+Math.max(2,error.retryAfter)*1000;return failure("RATE_LIMITED",true,Math.max(2,error.retryAfter));}
      if(error.code===401){health={...health,ready:false,reason:"INVALID_TOKEN"};return failure("AUTHENTICATION");}
      if(error.code===403)return failure("PROVIDER_REJECTED");
      if(error.code===400)return failure("INVALID_REQUEST");
      // Telegram has no sendMessage idempotency key. Never blindly retry uncertain sends.
      return failure("UNKNOWN");
    }
  }};
}
