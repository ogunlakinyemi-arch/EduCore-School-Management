import {describe,expect,it} from "vitest";
import {runtimeDatabaseIdentity} from "./runtime-database-identity";
describe("allowlisted runtime identity",()=>{
  it("reuses the resolved configuration fingerprint, not a claimed resource ID",()=>{
    expect(runtimeDatabaseIdentity({targetFingerprint:"1234567890abcdef12345678"},{K_REVISION:"educore-00042-abc"}))
      .toMatchObject({configurationTargetFingerprint:"1234567890abcdef12345678",
        servingRevision:"educore-00042-abc",servingRevisionSource:"K_REVISION",
        platformDatabaseResourceId:null,targetBindingVerified:false});
    expect(runtimeDatabaseIdentity({targetFingerprint:"1234567890abcdef12345678"},{}))
      .toMatchObject({platformDatabaseResourceIdSource:"UNAVAILABLE",targetBindingStatus:"UNVERIFIED",
        targetBindingReason:"AUTHORITATIVE_INFRASTRUCTURE_MAPPING_UNAVAILABLE",
        configurationFingerprintIsConnectionProof:false});
  });
  it("reports unavailable runtime metadata explicitly",()=>{
    expect(runtimeDatabaseIdentity(undefined,{})).toMatchObject({
      servingRevision:null,servingRevisionSource:"UNAVAILABLE",configurationTargetFingerprint:null});
  });
  it("never serializes extra configuration, malformed metadata or secrets",()=>{
    const secret="postgresql://private-user:private-password@private-host/private-person";
    const result=runtimeDatabaseIdentity({targetFingerprint:secret,connectionString:secret,host:secret} as any,
      {K_REVISION:secret,DATABASE_URL:secret,CLERK_SECRET_KEY:secret} as any);
    const output=JSON.stringify(result);
    for(const value of ["private-user","private-password","private-host","private-person","postgresql","DATABASE_URL","CLERK_SECRET_KEY"])
      expect(output).not.toContain(value);
    expect(result.configurationTargetFingerprint).toBeNull();expect(result.servingRevision).toBeNull();
  });
  it("does not trust environment assertions as authoritative infrastructure evidence",()=>{
    expect(runtimeDatabaseIdentity({targetFingerprint:"1234567890abcdef12345678"},{
      PLATFORM_DATABASE_RESOURCE_ID:"claimed-resource",TARGET_BINDING_VERIFIED:"true",
    })).toMatchObject({platformDatabaseResourceId:null,targetBindingVerified:false,targetBindingStatus:"UNVERIFIED"});
  });
});
