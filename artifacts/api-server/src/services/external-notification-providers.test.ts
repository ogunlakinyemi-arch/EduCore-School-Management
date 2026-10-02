import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ResendEmailProvider, createCommunicationProviders, normalizeTermiiRecipient } from "./communication-providers";
import { MockEmailProvider, MockSmsProvider } from "./communication-test-providers";
import { WebPushProvider, pushSubscriptionSchema } from "./web-push-provider";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { verifiedReceipt } from "../routes/communication-receipts";
const subscription = { endpoint:"https://fcm.googleapis.com/fcm/send/test",keys:{
  p256dh:Buffer.from("046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5","hex").toString("base64url"),
  auth:Buffer.alloc(16,1).toString("base64url") }};
describe("external notification provider contracts (no network)",()=>{
  it("Resend sends stable idempotency, HTML and text and only acknowledges acceptance",async()=>{
    const fetch = vi.fn(async()=>new Response(JSON.stringify({id:"mock-email-id"}),{status:200}));
    const p = new ResendEmailProvider({apiKey:"mock-key",from:"EduCore <notifications@example.com>"},{fetch:fetch as typeof globalThis.fetch});
    const result = await p.send({to:"parent@example.com",subject:"Notice",body:"Text",html:"<p>Text</p>",idempotencyKey:"event-1-email"});
    expect(result).toMatchObject({accepted:true,delivered:false,providerMessageId:"mock-email-id"});
    const request = fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(request[1].headers).toMatchObject({"Idempotency-Key":"event-1-email"});
    expect(JSON.parse(String(request[1].body))).toMatchObject({text:"Text",html:"<p>Text</p>"});
  });
  it("missing email configuration leaves SMS usable and makes no network request",async()=>{
    const p=createCommunicationProviders({COMMUNICATION_EMAIL_PROVIDER:"resend"});
    expect((await p.email.send({to:"x@example.com",subject:"s",body:"b"})).failure?.category).toBe("CONFIGURATION");
    expect((await p.sms.send({to:"08012345678",body:"b"})).status).toBe("SIMULATED");
  });
  it.each(["invalid","a\n@example.com","a@","a@example.com\n"])("rejects invalid email %s without transport",async to=>{
    const fetch=vi.fn();
    const p=new ResendEmailProvider({apiKey:"mock-key",from:"x@example.com"},{fetch});
    expect((await p.send({to,subject:"s",body:"b"})).failure?.category).toBe("INVALID_REQUEST");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401,429,500])("classifies mocked Resend failure %s",async status=>{
    const p=new ResendEmailProvider({apiKey:"mock-key",from:"x@example.com"},{fetch:vi.fn(async()=>new Response("Private response",{status}))});
    const result=await p.send({to:"y@example.com",subject:"s",body:"b"});
    expect(result.accepted).toBe(false); expect(JSON.stringify(result)).not.toContain("Private response");
  });
  it.each(["08012345678","07012345678","09012345678","+2348012345678","002348012345678"])("normalizes Nigerian recipient %s",phone=>{
    expect(normalizeTermiiRecipient(phone)).toMatch(/^\+234\d{10}$/);
  });
  it.each(["+23480123","+23408012345678","+234801234567899","0801234"])("rejects malformed Nigerian recipient %s",phone=>{
    expect(normalizeTermiiRecipient(phone)).toBeNull();
  });
  it("mock SMS/email record stable attempts and retry without pretending delivery",async()=>{
    for(const p of [new MockEmailProvider(["retry","success"]),new MockSmsProvider(["retry","success"])]){
      expect((await p.send({to:"mock@example.com",subject:"s",body:"b",idempotencyKey:"event"})).failure?.retryable).toBe(true);
      const result=await p.send({to:"mock@example.com",subject:"s",body:"b",idempotencyKey:"event"});
      expect(result.status).toBe("SIMULATED"); expect(result.delivered).toBe(false);
      expect(p.attempts.map(a=>a.key)).toEqual(["event","event"]); expect(result.providerMessageId).toMatch(/^mock-/);
    }
  });
  it("validates subscriptions and rejects private/arbitrary endpoint egress",()=>{
    expect(pushSubscriptionSchema.safeParse(subscription).success).toBe(true);
    for(const endpoint of ["http://localhost/push","https://127.0.0.1/push","https://fcm.googleapis.com.evil.test/push"])
      expect(pushSubscriptionSchema.safeParse({...subscription,endpoint}).success).toBe(false);
  });
  it("expired subscriptions never reach transport",async()=>{
    const send=vi.fn();const p=new WebPushProvider({publicKey:"mock",privateKey:"mock",subject:"mailto:x@example.com"},send);
    expect((await p.send({subscription:{...subscription,expirationTime:1},idempotencyKey:"event"})).failure?.category).toBe("INVALID_REQUEST");
    expect(send).not.toHaveBeenCalled();
  });
  it("uses generic push payload, not sensitive school/child content",async()=>{
    const send=vi.fn().mockResolvedValue({statusCode:201});const p=new WebPushProvider({publicKey:"mock",privateKey:"mock",subject:"mailto:x@example.com"},send);
    const result=await p.send({subscription,idempotencyKey:"communication-1-push-1"});
    expect(result).toMatchObject({accepted:true,delivered:false});
    const payload=String(send.mock.calls[0][1]);expect(payload).toContain("Open EduCore for details");expect(payload).not.toContain("subscription");
  });
  it.each([404,410])("classifies expired push endpoint %s for cleanup",async statusCode=>{
    const p=new WebPushProvider({publicKey:"mock",privateKey:"mock",subject:"mailto:x@example.com"},vi.fn().mockRejectedValue({statusCode}));
    expect((await p.send({subscription,idempotencyKey:"event"})).failure).toEqual({category:"INVALID_REQUEST",retryable:false});
  });
  it("signed Resend receipts reject tampering and stale/replayed timestamps",()=>{
    const now=Date.now(),body=Buffer.from('{"type":"email.delivered"}'),time=String(Math.floor(now/1000));
    const secret=Buffer.from("mock-signing-key").toString("base64");
    const digest=createHmac("sha256",Buffer.from(secret,"base64")).update(`event.${time}.`).update(body).digest("base64");
    const headers={"svix-id":"event","svix-timestamp":time,"svix-signature":`v1,${digest}`};
    expect(verifiedReceipt("resend",body,headers,`whsec_${secret}`,now)).toBe(true);
    expect(verifiedReceipt("resend",Buffer.from("{}"),headers,secret,now)).toBe(false);
    expect(verifiedReceipt("resend",body,headers,secret,now+600000)).toBe(false);
  });
  it("signed Termii receipts reject unsigned bodies",()=>{
    const body=Buffer.from('{"message_id":"mock","status":"Delivered"}'),secret="mock-key";
    const headers={"x-termii-signature":createHmac("sha512",secret).update(body).digest("hex")};
    expect(verifiedReceipt("termii",body,headers,secret)).toBe(true);
    expect(verifiedReceipt("termii",Buffer.from("{}"),headers,secret)).toBe(false);
  });
});