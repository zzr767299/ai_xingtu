import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const courseRepo = path.resolve(projectRoot, "..", "ai-agents-from-zero");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
};

/**
 * 开发/预览时直接读取课程仓库里的图片，避免把 500MB 素材复制进项目。
 * 生产部署可先运行 `npm run course:assets`。
 */
function courseAssets(): Plugin {
  const middleware = (req: { url?: string }, res: any, _next: () => void) => {
    const raw = (req.url ?? "").split("?")[0];
    const relative = decodeURIComponent(raw);
    const filePath = path.join(courseRepo, relative);
    if (!filePath.startsWith(courseRepo) || !fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    fs.createReadStream(filePath).pipe(res);
  };

  return {
    name: "xingtu-course-assets",
    configureServer(server) {
      server.middlewares.use("/course-assets", middleware as any);
    },
    configurePreviewServer(server) {
      server.middlewares.use("/course-assets", middleware as any);
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), courseAssets()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
