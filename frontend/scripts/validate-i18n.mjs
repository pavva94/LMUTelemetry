import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const resourcePath = resolve(here, "../src/i18n/resources.ts");
const source = readFileSync(resourcePath, "utf8");

const languageBlocks = [...source.matchAll(/\n  (en|it): \{/g)].map((match) => match[1]);
if (new Set(languageBlocks).size !== languageBlocks.length) {
  console.error("Duplicate language resource block found.");
  process.exit(1);
}

if (!source.includes("en:") || !source.includes("it:")) {
  console.error("Expected English and Italian resource blocks.");
  process.exit(1);
}

console.log("i18n resources are present. Run `npm run test:run -- i18n` for key completeness checks.");
