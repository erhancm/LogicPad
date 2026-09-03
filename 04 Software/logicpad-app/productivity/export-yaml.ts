import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packToYaml } from "../src/pack.ts";
import { productivityYamlPack } from "../src/productivity.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "LogicPad-Productivity.yaml");
writeFileSync(out, packToYaml(productivityYamlPack()), "utf8");
console.log("Wrote", out);
