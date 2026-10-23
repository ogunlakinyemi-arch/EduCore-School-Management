import {afterEach, describe, expect, it, vi} from "vitest";
import {canonicalPublicUrl} from "./canonical-public-url";
import {invitationRedirect, PUBLIC_PRODUCTION_ORIGIN} from "../routes/invitation-redirect";

afterEach(()=>vi.unstubAllEnvs());
describe("canonical onboarding destinations",()=>{
  it.each([
    "/accept-invitation",
    "/accept-invitation?partnerInvitation=opaque%2Btoken%2Fwith%3Dequals",
    "/accept-invitation?internalEmployeeInvitation=opaque%26claim",
    "/school/register?ref=opaque%2Breferral%2Ftoken",
    "/sign-up?applicantType=SCHOOL_ADMIN&ref=opaque%2Breferral",
    "/sign-up?applicantType=PARTNER",
    "/sign-in",
  ])("uses only the configured custom hostname and preserves path/tokens: %s",path=>{
    vi.stubEnv("PUBLIC_APP_URL","https://educore.yetenia.com");
    vi.stubEnv("REPLIT_DOMAINS","old-public.replit.app,untrusted.replit.dev");
    vi.stubEnv("REPLIT_APP_URL","https://old-public.replit.app");
    const result=canonicalPublicUrl(path,"production","untrusted.replit.dev");
    expect(result).toBe(`https://educore.yetenia.com${path}`);
    expect(new URL(result).hostname).toBe("educore.yetenia.com");
    expect(result).not.toMatch(/replit\.(app|dev|com)/);
    if(path.startsWith("/accept-invitation"))expect(invitationRedirect(path,"production")).toBe(result);
  });
  it("defaults to the verified custom domain without changing the legacy payment-return constant",()=>{
    vi.stubEnv("PUBLIC_APP_URL",undefined);
    expect(invitationRedirect("/accept-invitation","production")).toBe("https://educore.yetenia.com/accept-invitation");
    expect(PUBLIC_PRODUCTION_ORIGIN).toBe("https://edu-pulse-school-management--ogunlakinyemi.replit.app");
  });
  it("supports an explicitly configured portal domain",()=>{
    vi.stubEnv("PUBLIC_APP_URL","https://portal.example.org");
    expect(canonicalPublicUrl("/sign-up?applicantType=PARTNER","production"))
      .toBe("https://portal.example.org/sign-up?applicantType=PARTNER");
  });
  it.each(["https://old.replit.app","https://REPLIT.APP.","https://old.replit.app.","https://old.replit.dev"])(
    "fails closed for stale Replit production configuration: %s",origin=>{
      expect(()=>canonicalPublicUrl("/school/register?ref=opaque","production",undefined,origin)).toThrow();
    });
  it.each(["//attacker.example/sign-up","/school/register/../other","/sign-up#fragment","/accept-invitation?x=\\evil"])(
    "rejects unsafe onboarding paths: %s",path=>{
      expect(()=>canonicalPublicUrl(path,"production")).toThrow();
    });
  it("keeps Development invitations within the Development identity environment",()=>{
    vi.stubEnv("PUBLIC_APP_URL","https://educore.yetenia.com");
    expect(canonicalPublicUrl("/accept-invitation?partnerInvitation=opaque","development","fixture.replit.dev"))
      .toBe("https://fixture.replit.dev/accept-invitation?partnerInvitation=opaque");
  });
});
