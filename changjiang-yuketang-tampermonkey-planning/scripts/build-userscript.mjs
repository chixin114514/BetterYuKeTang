import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const srcRoot = path.join(projectRoot, "src");
const distRoot = path.join(projectRoot, "dist");
const outFile = path.join(distRoot, "better-yuketang.user.js");

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => !entry.name.startsWith("."))
      .map(async (entry) => {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          return collectFiles(target);
        }
        if (entry.isFile() && target.endsWith(".js")) {
          return [target];
        }
        return [];
      })
  );

  return files.flat().sort();
}

async function build() {
  const files = await collectFiles(srcRoot);
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const banner = [
    "// ==UserScript==",
    "// @name         BetterYuKeTang",
    "// @namespace    https://github.com/jiaqiaosu/BetterYuKeTang",
    "// @version      0.1.0",
    "// @description  Enhance the Changjiang YukeTang learning flow with safer page helpers.",
    "// @author       jiaqiaosu",
    "// @match        *://*.yuketang.cn/*",
    "// @match        *://changjiang.yuketang.cn/*",
    "// @run-at       document-idle",
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// @grant        GM_addStyle",
    "// ==/UserScript==",
    ""
  ].join("\n");

  const body = contents.join("\n\n");
  await mkdir(distRoot, { recursive: true });
  await writeFile(outFile, `${banner}${body}\n`, "utf8");
  console.log(`Built ${path.relative(projectRoot, outFile)}`);
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
