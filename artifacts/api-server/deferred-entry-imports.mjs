import path from "node:path";

/** Keep application/SDK imports out of the startup gate's compiled module.
 * Dynamic imports alone are insufficient when a bundler hoists externals. */
export function deferredEntryImports(artifactDir) {
  const entries = {
    "normal-server": path.join(artifactDir, "src/normal-server.ts"),
    "terminal-test-server": path.join(artifactDir, "src/terminal-test-server.ts"),
    logger: path.join(artifactDir, "src/lib/logger.ts"),
  };
  const outputs = new Map(Object.entries(entries).map(([name, source]) => [source, `./${name}.mjs`]));
  return {
    entries,
    plugin: {
      name: "defer-api-side-effect-entries",
      setup(build) {
        build.onResolve({ filter: /^\.\.?\// }, args => {
          if (!args.importer || args.kind === "entry-point") return;
          const source = path.resolve(path.dirname(args.importer), args.path);
          const output = outputs.get(source) ?? outputs.get(`${source}.ts`);
          if (output) return { path: output, external: true };
        });
      },
    },
  };
}
