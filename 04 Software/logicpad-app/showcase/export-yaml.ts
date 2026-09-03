import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { packToYaml } from "../src/pack.ts";
import { showcaseYamlPack } from "../src/showcase.ts";

const out = join(dirname(fileURLToPath(import.meta.url)), "LogicPad-Showcase.yaml");
writeFileSync(out, packToYaml(showcaseYamlPack()), "utf8");
console.log("Wrote", out);
