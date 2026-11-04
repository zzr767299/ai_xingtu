#!/usr/bin/env node
/**
 * 本地一键启动：同时拉起 AI 代理（读取 .env）与 Vite 开发服务器，并自动打开浏览器。
 *
 * 用法：双击根目录「启动 AI 星途.bat」，或运行 npm run dev:local
 * 可选环境变量：HOST（默认 127.0.0.1）、PORT（默认 5180）、NO_OPEN=1 不打开浏览器、NO_PROXY=1 不启动代理
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 5180);
const URL = `http://${HOST}:${PORT}`;
const PROXY_PORT = Number(process.env.PROXY_PORT ?? readEnvValue("PROXY_PORT") ?? 8787);

const children = [];
let shuttingDown = false;

function readEnvValue(key) {
  try {
    const envPath = path.join(projectRoot, ".env");
    if (!existsSync(envPath)) return undefined;
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`));
      if (match) return match[1].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // .env 可选
  }
  return undefined;
}

function isListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function looksLikeApp(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    const text = await response.text();
    return text.includes("AI 星途") || text.includes('id="root"');
  } catch {
    return false;
  }
}

function openBrowser(url) {
  if (process.env.NO_OPEN === "1") return;
  spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", windowsHide: true });
}

function stopChildren(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null && !child.killed) child.kill();
  }
  setTimeout(() => process.exit(exitCode), 200);
}

async function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isListening(PORT)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function spawnNode(scriptPath, label, args = []) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("exit", (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`\n[${label}] 已退出（代码 ${code}）。`);
    }
  });
  children.push(child);
  return child;
}

console.log("=".repeat(58));
console.log("  AI 星途 · 本地一键启动");
console.log("=".repeat(58));

if (await isListening(PORT)) {
  if (await looksLikeApp(URL)) {
    console.log(`服务已经在运行：${URL}`);
    console.log("已为你打开浏览器，无需重复启动。");
    openBrowser(URL);
    process.exit(0);
  }
  console.error(`端口 ${PORT} 已被其他程序占用，请先关闭占用该端口的程序再试。`);
  process.exit(1);
}

const apiKeyConfigured = Boolean(readEnvValue("AI_API_KEY"));
if (process.env.NO_PROXY !== "1" && apiKeyConfigured) {
  if (await isListening(PROXY_PORT)) {
    console.log(`AI 代理已在运行（端口 ${PROXY_PORT}），跳过启动。`);
  } else {
    console.log(`启动 AI 代理（端口 ${PROXY_PORT}，读取 .env）…`);
    spawnNode(path.join(projectRoot, "server", "ai-proxy.mjs"), "proxy");
  }
} else if (process.env.NO_PROXY !== "1") {
  console.log("未在 .env 中找到 AI_API_KEY，跳过 AI 代理（应用仍可离线使用本地题库）。");
}

console.log(`启动开发服务器：${URL}\n`);

const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
if (!existsSync(viteBin)) {
  console.error("找不到 node_modules/vite，请先在该目录运行一次 npm install。");
  stopChildren(1);
} else {
  spawnNode(viteBin, "vite", ["--host", HOST, "--port", String(PORT), "--strictPort"]);

  process.on("SIGINT", () => {
    console.log("\n正在关闭本地服务…");
    stopChildren(0);
  });
  process.on("SIGTERM", () => stopChildren(0));
  process.on("exit", () => {
    for (const child of children) {
      if (child.exitCode === null && !child.killed) child.kill();
    }
  });

  if (await waitForServer()) {
    console.log("\n" + "-".repeat(58));
    console.log(`  打开：${URL}`);
    console.log("  关闭本窗口（或按 Ctrl+C）即可停止所有本地服务。");
    console.log("-".repeat(58) + "\n");
    openBrowser(URL);
  } else {
    console.error("服务在 30 秒内没有启动成功，请查看上方 Vite 的报错信息。");
    stopChildren(1);
  }
}
