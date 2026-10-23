import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { hash } from "./native.mjs";

// The allocation helper imports AuthError through application auth. Bundle the
// real policy code with ONLY that exception class substituted; resolving any DB
// or network client is a hard error, never a fake application URL fallback.
export async function isolatedCheckoutPolicy(root,source,runner) {
  const require=createRequire(path.join(root,"artifacts/api-server/package.json"));
  const {build}=require("esbuild");
  const result=await build({
    stdin:{contents:source,resolveDir:path.join(root,"artifacts/api-server"),sourcefile:"isolated-policy-entry.mjs",loader:"js"},
    bundle:true,platform:"node",format:"esm",write:false,metafile:true,
    plugins:[{name:"credential-free-policy-boundary",setup(builder) {
      builder.onResolve({filter:/(?:^|\/)middlewares\/auth$/},()=>({path:"AuthError",namespace:"fictional-exception"}));
      builder.onLoad({filter:/.*/,namespace:"fictional-exception"},()=>({contents:
        "export class AuthError extends Error { constructor(status,message,eventType='ACCESS_DENIED'){super(message);this.status=status;this.eventType=eventType;} }",loader:"js"}));
      builder.onResolve({filter:/^@workspace\/db(?:\/|$)|^(?:node:)?(?:http|https|net|tls|dgram|child_process)$/},args=>{
        throw new Error("Forbidden runtime dependency in policy-only rehearsal: "+args.path);
      });
    }}],
  });
  const inputs=Object.keys(result.metafile.inputs);
  runner.check(inputs.every(file=>!file.includes("/middlewares/")&&!file.includes("/lib/db/")&&!file.includes("/fee-providers")),
    "checkout proof imports no application auth/database/provider runtime",
    {substitution:"exception class only, not allocation/verification policy",inputs});
  const bundle=result.outputFiles[0].contents,file=path.join(runner.evidence,"isolated-policy.mjs");
  fs.writeFileSync(file,bundle);
  fs.writeFileSync(path.join(runner.evidence,"isolated-policy-inputs.json"),JSON.stringify(result.metafile,null,2)+"\n");
  const execution=runner.run("isolated-current-SCV3-checkout-contract",process.execPath,[file]);
  return {...JSON.parse(execution.stdout.trim()),bundleSha256:hash(bundle),
    exceptionClassSubstituted:true,applicationAuthorizationTested:false};
}
