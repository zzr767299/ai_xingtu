#!/usr/bin/env node
/** 把课程正文引用的图片复制到 public/course-assets，供生产构建使用。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(projectRoot, "..", "ai-agents-from-zero");
const courseRoot = path.join(projectRoot, "public", "course");
const targetRoot = path.join(projectRoot, "public", "course-assets");

if (!fs.existsSync(repoRoot)) {
  console.error(`找不到课程仓库：${repoRoot}`);
  process.exit(1);
}

const chapterDir = path.join(courseRoot, "chapters");
if (!fs.existsSync(chapterDir)) {
  console.error("请先运行 npm run course:build");
  process.exit(1);
}

const files = fs.readdirSync(chapterDir).filter((name) => name.endsWith(".json"));
const sources = new Set();

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(chapterDir, file), "utf8"));
  const visit = (blocks) => {
    for (const block of blocks ?? []) {
      if (block?.src?.startsWith("/course-assets/")) {
        sources.add(decodeURIComponent(block.src.replace("/course-assets/", "")));
      }
      if (block?.html) {
        for (const match of block.html.matchAll(/src="\/course-assets\/([^"]+)"/g)) {
          sources.add(decodeURIComponent(match[1]));
        }
      }
    }
  };
  visit(data.intro);
  for (const section of data.sections ?? []) visit(section.blocks);
}

let copied = 0;
let bytes = 0;
let missing = 0;

for (const relative of sources) {
  const source = path.join(repoRoot, relative);
  const target = path.join(targetRoot, relative);
  if (!fs.existsSync(source)) {
    missing += 1;
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied += 1;
  bytes += fs.statSync(source).size;
}

console.log(`图片素材复制完成：${copied} 个文件，${(bytes / 1048576).toFixed(1)} MB`);
if (missing) console.log(`有 ${missing} 个引用在源仓库中不存在，已跳过。`);
console.log(`输出目录：${targetRoot}`);
