import { parseArgs } from "node:util";
import { Init } from "./src/init";

if (import.meta.main) {
  // --config overrides the default file (src/init.ts: loadConfig)
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: { config: { type: "string", short: "c" } },
  });
  new Init(values.config);

  // init.init()
}
