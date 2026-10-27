type Target={targetFingerprint?:unknown};
/**
 * Uses the existing hash of RESOLVED pg host/port/database configuration.
 * This is neither a provider resource ID nor proof of a connected primary.
 * K_REVISION is a Cloud Run runtime identifier, not a guessed Replit build ID.
 */
export function runtimeDatabaseIdentity(target:Target|undefined,env:NodeJS.ProcessEnv=process.env){
  const fingerprint=typeof target?.targetFingerprint==="string"
    &&/^[a-f0-9]{24}$/.test(target.targetFingerprint)?target.targetFingerprint:null;
  const revision=typeof env.K_REVISION==="string"&&/^[a-z][a-z0-9-]{0,62}$/.test(env.K_REVISION)
    ?env.K_REVISION:null;
  return{
    configurationTargetFingerprint:fingerprint,
    fingerprintAlgorithm:"RESOLVED_PG_HOST_PORT_DATABASE_SHA256_96_V1",
    platformDatabaseResourceId:null,
    platformDatabaseResourceIdSource:"UNAVAILABLE",
    servingRevision:revision,
    servingRevisionSource:revision?"K_REVISION":"UNAVAILABLE",
    targetBindingVerified:false,
    targetBindingStatus:"UNVERIFIED",
    targetBindingReason:"AUTHORITATIVE_INFRASTRUCTURE_MAPPING_UNAVAILABLE",
    configurationFingerprintIsConnectionProof:false,
    // Only an authoritative resource/configuration mapping could establish binding.
    // SQL readiness and K_REVISION do not supply that mapping.
  };
}
