/* global URL, console, process */
import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const roots = [new URL("../src/", import.meta.url), new URL("../public/education/", import.meta.url)].map(fileURLToPath);
const forbidden = [
  ["you", "do not have cancer"].join(" "),
  ["you", "have cancer"].join(" "),
  "normal",
  "safe",
];
const extensions = new Set([".ts", ".tsx", ".json", ".css"]);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extensions.has(extname(entry.name))) files.push(path);
  }
}

for (const root of roots) await walk(root);
const violations = [];
for (const file of files) {
  const content = (await readFile(file, "utf8")).toLocaleLowerCase();
  for (const phrase of forbidden) {
    if (new RegExp(`\\b${phrase.replaceAll(" ", "\\s+")}\\b`, "u").test(content)) {
      violations.push(`${file}: ${phrase}`);
    }
  }
}
if (violations.length) {
  console.error("Patient-facing content safety check failed:\n" + violations.join("\n"));
  process.exit(1);
}
console.log(`Patient-facing content safety check passed (${files.length} files).`);
