import {createHash} from "node:crypto";
import type {ProviderSendResult,ProviderFailureCategory} from "./communication-providers";
import {developmentPaymentNotificationsSuppressed} from "../lib/development-payment-notification-policy";
import {logger} from "../lib/logger";

export interface TelegramHealth {configured:boolean;ready:boolean;reason:string;botUsername:string|null;botId:string|null}
let health:TelegramHealth={configured:false,ready:false,reason:"NOT_CHECKED",botUsername:null,botId:null};
let checkedAt=0,credentialHash="";
const digest=(s:string)=>createHash("sha256").update(s).digest("hex");
export const telegramDevelopment=(env:NodeJS.ProcessEnv)=>
  !env.REPLIT_DEPLOYMENT&&(env.NODE_ENV==="development"||env.NODE_ENV==="test");
export const telegramRuntimeEnabled=(env:NodeJS.ProcessEnv)=>
  telegramDevelopment(env)||((!!env.REPLIT_DEPLOYMENT||env.NODE_ENV==="production")
    &&env.EDUCORE_PRODUCTION_TELEGRAM_ENABLED==="true");
const scope=(env:NodeJS.ProcessEnv)=>digest(JSON.stringify([
  env.TELEGRAM_BOT_TOKEN,env.SESSION_SECRET,telegramDevelopment(env),telegramRuntimeEnabled(env),
]));
export function getTelegramHealth(env:NodeJS.ProcessEnv=process.env):TelegramHealth{
  if(!env.TELEGRAM_BOT_TOKEN)return {configured:false,ready:false,reason:"TOKEN_MISSING",botUsername:null,botId:null};
  if(!telegramRuntimeEnabled(env))return {configured:true,ready:false,reason:"PRODUCTION_DISABLED",botUsername:null,botId:null};
  if(!env.SESSION_SECRET||env.SESSION_SECRET.length<32)return {configured:true,ready:false,reason:"ENCRYPTION_KEY_UNAVAILABLE",botUsername:null,botId:null};
  if(credentialHash!==scope(env)||Date.now()-checkedAt>120000)
    return {configured:true,ready:false,reason:"HEALTH_CHECK_REQUIRED",botUsername:null,botId:null};
  // A separate explicit Development opt-in authorizes only this new channel.
  // Never change the existing SMS/email payment-test or scheduler locks.
  if(health.ready&&developmentPaymentNotificationsSuppressed(env)&&env.EDUCORE_DEVELOPMENT_TELEGRAM_ENABLED!=="true")
    return {...health,ready:false,reason:"DEVELOPMENT_SEND_LOCK"};
  return {...health};
}
export class TelegramApiError extends Error{
  constructor(readonly code:number,readonly retryAfter=0,
    readonly category:"NETWORK_UNAVAILABLE"|"TIMEOUT"|"INVALID_RESPONSE"="NETWORK_UNAVAILABLE"){super("Telegram request failed");}
}
export function telegramHealthFailure(error:unknown){
  if(!(error instanceof TelegramApiError))return "BOT_UNAVAILABLE";
  if([401,404].includes(error.code))return "INVALID_TOKEN";
  if(error.code===403)return "PROVIDER_FORBIDDEN";
  if(error.code===429)return "RATE_LIMITED";
  if(error.code>=500)return "PROVIDER_UNAVAILABLE";
  return error.code ? "BOT_UNAVAILABLE" : error.category;
}
/** No caller may log a request URL, caught transport error, Bot API body or token. */
export async function telegramApi(method:"getMe"|"getWebhookInfo"|"getUpdates"|"sendMessage",body:unknown,
  env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch):Promise<any>{
  const diagnostic=method==="getMe"||method==="getWebhookInfo";
  if(!["getMe","getWebhookInfo","getUpdates","sendMessage"].includes(method)||
    !env.TELEGRAM_BOT_TOKEN||(!diagnostic&&!getTelegramHealth(env).ready))throw new TelegramApiError(401);
  try{
    const response=await transport(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      redirect:"error",signal:AbortSignal.timeout(8000),
    });
    let data:any;
    try{data=await response.json();}
    catch{throw new TelegramApiError(response.ok?0:response.status,0,"INVALID_RESPONSE");}
    if(!response.ok||data?.ok!==true){
      const code=Number(data?.error_code??response.status);
      const retry=Number(data?.parameters?.retry_after);
      throw new TelegramApiError(Number.isInteger(code)?code:0,
        Number.isSafeInteger(retry)&&retry>0?Math.min(retry,604800):0);
    }
    return data.result;
  }catch(error){
    if(error instanceof TelegramApiError)throw error;
    const name=(error as {name?:string}|null)?.name;
    throw new TelegramApiError(0,0,name==="AbortError"||name==="TimeoutError"?"TIMEOUT":"NETWORK_UNAVAILABLE");
  }
}
// Stateless provider inspection. In particular, the Owner health route must
// never refresh the cache consumed by send/link/poll operations.
async function inspectTelegramBot(env:NodeJS.ProcessEnv,transport:typeof fetch):Promise<TelegramHealth>{
  if(!env.TELEGRAM_BOT_TOKEN)return {configured:false,ready:false,reason:"TOKEN_MISSING",botUsername:null,botId:null};
  let stage:"getMe"|"getWebhookInfo"="getMe";
  try{
    const bot=await telegramApi("getMe",{},env,transport);
    if(bot?.is_bot!==true||!Number.isSafeInteger(bot.id)||!/^[A-Za-z0-9_]{5,32}$/.test(bot.username??""))
      throw new TelegramApiError(0,0,"INVALID_RESPONSE");
    stage="getWebhookInfo";
    const webhook=await telegramApi("getWebhookInfo",{},env,transport);
    if(!webhook||typeof webhook.url!=="string")throw new TelegramApiError(0,0,"INVALID_RESPONSE");
    const reason=webhook?.url?"WEBHOOK_CONFLICT":"READY";
    return {configured:true,ready:reason==="READY",reason,botUsername:bot.username,botId:String(bot.id)};
  }catch(error){
    const reason=telegramHealthFailure(error);
    // Never pass caught errors, URLs, response bodies or credentials to logging.
    logger.warn({event:"TELEGRAM_HEALTH_CHECK_FAILED",stage,reason,
      status:error instanceof TelegramApiError&&[400,401,403,404,429,500,502,503,504].includes(error.code)?error.code:0},
      "Telegram read-only configuration check failed");
    return {configured:true,ready:false,reason,botUsername:null,botId:null};
  }
}
export async function diagnoseTelegramBot(env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch){
  const inspected=await inspectTelegramBot(env,transport);
  return {configured:inspected.configured,diagnosticOk:inspected.ready,
    diagnosticReason:inspected.reason,botUsername:inspected.botUsername};
}
// Worker-owned readiness validation; never called from the diagnostic endpoint.
export async function refreshTelegramHealth(schemaReady:boolean,env:NodeJS.ProcessEnv=process.env,transport:typeof fetch=fetch){
  if(!telegramRuntimeEnabled(env)||!env.TELEGRAM_BOT_TOKEN||!env.SESSION_SECRET||env.SESSION_SECRET.length<32)
    return getTelegramHealth(env);
  health={configured:true,ready:false,reason:"HEALTH_CHECK_REQUIRED",botUsername:null,botId:null};
  if(!schemaReady){
    health={...health,reason:"SCHEMA_NOT_READY"};
  }else{
    health=await inspectTelegramBot(env,transport);
  }
  credentialHash=scope(env);checkedAt=Date.now();
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
