import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApp } from "../state/AppContext";
import { Badge, Button, Card, Modal, Toggle, cn } from "../components/ui";
import { PROVIDER_PRESETS, parseExportBundle } from "../lib/storage/repo";
import { testConnection, aiEndpoint, AiError } from "../lib/ai/provider";
import type { AiSettings } from "../types";
import type { AppSettings, AppTheme, ExportBundle } from "../types";

export function SettingsPage() {
  const {
    settings,
    updateSettings,
    exportData,
    importData,
    resetAll,
    repo,
    notify,
    progress,
    course,
    glossary,
  } = useApp();

  const [draft, setDraft] = useState<AppSettings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    text: string;
    endpoint: string;
    hint?: string;
    action?: "disable-proxy" | "use-proxy";
  } | null>(null);
  const [proxyHealth, setProxyHealth] = useState<{ ok: boolean; text: string } | null>(null);
  const [includeKey, setIncludeKey] = useState(false);
  const [importPreview, setImportPreview] = useState<{
    text: string;
    bundle: ExportBundle;
    warnings: string[];
  } | null>(null);
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importError, setImportError] = useState<string[] | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [cacheCount, setCacheCount] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

  const setAi = (patch: Partial<AppSettings["ai"]>) =>
    setDraft((previous) => ({ ...previous, ai: { ...previous.ai, ...patch } }));

  const applyPreset = (presetId: string) => {
    const preset = PROVIDER_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    setAi({
      preset: presetId,
      baseUrl: preset.baseUrl,
      model: preset.model || draft.ai.model,
      enabled: true,
    });
  };

  const save = async () => {
    await updateSettings(() => draft);
    notify("设置已保存", "success");
  };

  const runTestWith = async (config: AiSettings, label: string) => {
    setTesting(true);
    setTestResult(null);
    const endpoint = aiEndpoint({ ...config, enabled: true });
    try {
      const result = await testConnection({ ...config, enabled: true });
      setTestResult({
        ok: true,
        text: `${label}连接成功 · ${result.latencyMs} ms · 回复：${result.reply}`,
        endpoint,
      });
    } catch (caught) {
      const message =
        caught instanceof AiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : String(caught);
      const isProxyMissingKey = message.includes("代理未配置") || message.includes("AI_API_KEY");
      const isNetwork = caught instanceof AiError && caught.code === "network";
      setTestResult({
        ok: false,
        text: message,
        endpoint,
        hint: isProxyMissingKey
          ? "这次请求走的是代理，代理服务端没有配置 Key。请在项目根目录创建 .env 并填写 AI_API_KEY，重启 npm run proxy；或者关闭代理，直接用上方的 Base URL + Key 测试（前提是该服务允许浏览器跨域）。"
          : isNetwork && !config.useProxy
            ? "浏览器直连失败常见于服务端未开放 CORS：OPTIONS 预检可能返回 405，或响应缺少 Access-Control-Allow-Origin。接口本身可用 curl 验证；若不允许跨域，请改用代理。"
            : undefined,
        action: isProxyMissingKey ? "disable-proxy" : isNetwork && !config.useProxy ? "use-proxy" : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  const runTest = async (mode: "current" | "direct" | "proxy" = "current") => {
    const config: AiSettings = {
      ...draft.ai,
      enabled: true,
      useProxy: mode === "direct" ? false : mode === "proxy" ? true : draft.ai.useProxy,
    };
    await runTestWith(config, mode === "direct" ? "直连" : mode === "proxy" ? "代理" : "当前配置");
  };

  const proxyEnvSnippet = [
    draft.ai.baseUrl.trim() ? `AI_BASE_URL=${draft.ai.baseUrl.trim()}` : "",
    draft.ai.model.trim() ? `AI_MODEL=${draft.ai.model.trim()}` : "",
    "AI_API_KEY=在此填入服务端 Key",
  ]
    .filter(Boolean)
    .join("\n");

  const checkProxyHealth = async () => {
    setProxyHealth(null);
    try {
      const base = new URL(draft.ai.proxyUrl);
      const response = await fetch(`${base.origin}/health`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as { baseUrl?: string; model?: string; hasKey?: boolean };
      setProxyHealth({
        ok: true,
        text: `代理在线 · 模型 ${data.model || "未设置"} · ${data.hasKey ? "Key 已配置" : "Key 未配置"} · 上游 ${data.baseUrl || "未设置"}`,
      });
    } catch (caught) {
      setProxyHealth({
        ok: false,
        text: `无法读取代理状态：${caught instanceof Error ? caught.message : String(caught)}。请确认 npm run proxy 正在运行。`,
      });
    }
  };

  const copyProxyEnv = async () => {
    // 只把填写的值写进片段；留空表示沿用 .env 中已有配置
    const lines = [
      draft.ai.baseUrl.trim() ? `AI_BASE_URL=${draft.ai.baseUrl.trim()}` : "",
      draft.ai.model.trim() ? `AI_MODEL=${draft.ai.model.trim()}` : "",
      "AI_API_KEY=在此填入服务端 Key",
    ].filter(Boolean);
    const snippet = lines.join("\n");
    try {
      await navigator.clipboard.writeText(snippet);
      notify("代理环境变量已复制，保存到 .env 后重启 npm run proxy", "success");
    } catch {
      notify("复制失败，请手动选择文本", "error");
    }
  };

  const downloadExport = async () => {
    const json = await exportData(includeKey);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-xingtu-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify(includeKey ? "已导出（包含 API Key，请注意保管）" : "已导出备份（不含 API Key）", "success");
  };

  const pickFile = async (file: File) => {
    setImportError(null);
    const text = await file.text();
    const parsed = parseExportBundle(text);
    if (!parsed.ok) {
      setImportPreview(null);
      setImportError(parsed.errors);
      return;
    }
    setImportPreview({ text, bundle: parsed.bundle, warnings: parsed.warnings });
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    const result = await importData(importPreview.text, importMode);
    notify(result.message, result.ok ? "success" : "error");
    if (!result.ok) setImportError(result.warnings);
    setImportPreview(null);
  };

  const applyTheme = async (theme: AppTheme) => {
    const next = { ...draft, theme };
    setDraft(next);
    await updateSettings(() => next);
    notify(theme === "paper" ? "已切换到纸质书页皮肤" : "已切换到深空皮肤", "success");
  };

  const clearCache = async () => {
    const count = await repo.clearCache("");
    setCacheCount(count);
    notify(`已清理 ${count} 条 AI 缓存`, "success");
  };

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-6 lg:px-6">
      <div className="mb-5">
        <p className="text-[11px] uppercase tracking-[0.28em] text-dim">System</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">设置与数据</h1>
        <p className="mt-1 text-sm text-muted">
          AI 配置、外观偏好、本地数据备份与恢复。所有学习数据默认只保存在当前浏览器。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">AI 模型服务</h2>
                <p className="mt-0.5 text-[11px] text-muted">用于生成导读、总结、试卷与阅卷。</p>
              </div>
              <Badge tone={draft.ai.enabled ? "cyan" : "neutral"}>{draft.ai.enabled ? "已启用" : "未启用"}</Badge>
            </div>

            <div className="mt-4">
              <Toggle
                checked={draft.ai.enabled}
                onChange={(value) => setAi({ enabled: value })}
                label="启用 AI 功能"
                description="关闭后仍可使用原文、本地导读/总结/题库与本地判分，进度不受影响。"
              />
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="服务商预设">
                <select
                  value={draft.ai.preset}
                  onChange={(event) => applyPreset(event.target.value)}
                  className={inputClass}
                >
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="模型名称"
                hint={draft.ai.useProxy ? "代理模式不参与请求，使用 .env 的 AI_MODEL" : "例如 deepseek-chat、qwen-plus"}
              >
                <input
                  value={draft.ai.model}
                  onChange={(event) => setAi({ model: event.target.value })}
                  className={inputClass}
                  placeholder="模型 ID"
                />
              </Field>
              <Field
                label="Base URL"
                hint={draft.ai.useProxy ? "代理模式下可留空，使用 .env 的 AI_BASE_URL" : "OpenAI 兼容接口根路径，通常以 /v1 结尾"}
              >
                <input
                  value={draft.ai.baseUrl}
                  onChange={(event) => setAi({ baseUrl: event.target.value })}
                  className={inputClass}
                  placeholder="https://api.example.com/v1"
                />
              </Field>
              <Field label="API Key" hint={draft.ai.useProxy ? "代理模式不使用，可留空" : "仅保存在本地浏览器"}>
                <div className="flex gap-1.5">
                  <input
                    type={showKey ? "text" : "password"}
                    value={draft.ai.apiKey}
                    onChange={(event) => setAi({ apiKey: event.target.value })}
                    className={inputClass}
                    placeholder="sk-…"
                    autoComplete="off"
                  />
                  <Button size="sm" variant="secondary" onClick={() => setShowKey(!showKey)}>
                    {showKey ? "隐藏" : "显示"}
                  </Button>
                </div>
              </Field>
            </div>

            {draft.ai.useProxy && (
              <p className="mt-2 rounded-lg border border-gold/30 bg-gold/[0.06] px-3 py-2 text-[11px] leading-relaxed text-gold">
                当前启用代理：上方三项均为<span className="font-semibold">可选</span>，仅用于生成 .env 参考，<span className="font-semibold">不参与请求</span>。真正的 Base URL / 模型 / Key 由代理服务端 .env 提供，留空即可。
              </p>
            )}

            <div className="mt-3 rounded-xl border border-gold/25 bg-gold/[0.04] p-3 text-[11px] leading-relaxed text-gold/90">
              安全提示：浏览器直连适合个人本地使用。正式部署时请启用下方代理，把 API Key 放在服务端环境变量中，不要把密钥打包进前端。
            </div>

            <div className="mt-3">
              <Toggle
                checked={draft.ai.useProxy}
                onChange={(value) => setAi({ useProxy: value })}
                label="通过本地 / 服务端代理调用"
                description="开启后忽略上方的 Base URL 与 API Key，改由代理服务端注入。运行 npm run proxy 可启动本地代理。"
              />
            </div>
            {draft.ai.useProxy && (
              <div className="mt-3 space-y-2">
                <Field label="代理地址" hint="默认 http://localhost:8787/api/ai/chat">
                  <input
                    value={draft.ai.proxyUrl}
                    onChange={(event) => setAi({ proxyUrl: event.target.value })}
                    className={inputClass}
                  />
                </Field>
                <div className="rounded-lg border border-line/70 bg-panel2/40 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted">代理 .env 参考片段（按当前表单生成，留空项不写入）</span>
                    <Button size="sm" variant="ghost" onClick={() => void copyProxyEnv()}>
                      复制
                    </Button>
                  </div>
                  <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10.5px] leading-relaxed text-muted">{proxyEnvSnippet}</pre>
                  <p className="mt-1 text-[10px] leading-relaxed text-dim">
                    代理实际生效的配置以「检测代理」结果为准；修改 .env 后需要重启 npm run proxy。
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <Field label={`温度 ${draft.ai.temperature.toFixed(2)}`} hint="越低越稳定">
                <input
                  type="range"
                  min={0}
                  max={1.2}
                  step={0.05}
                  value={draft.ai.temperature}
                  onChange={(event) => setAi({ temperature: Number(event.target.value) })}
                  className="w-full accent-cyan"
                />
              </Field>
              <Field label="最大输出 tokens">
                <input
                  type="number"
                  min={256}
                  max={8192}
                  value={draft.ai.maxTokens}
                  onChange={(event) => setAi({ maxTokens: Number(event.target.value) })}
                  className={inputClass}
                />
              </Field>
              <Field label="超时（秒）">
                <input
                  type="number"
                  min={10}
                  max={300}
                  value={Math.round(draft.ai.timeoutMs / 1000)}
                  onChange={(event) => setAi({ timeoutMs: Number(event.target.value) * 1000 })}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-panel2/40 px-3 py-2 text-[11px]">
              <Badge tone={draft.ai.useProxy ? "gold" : "cyan"}>
                {draft.ai.useProxy ? "代理模式" : "直连模式"}
              </Badge>
              <span className="text-dim">请求发往</span>
              <code className="break-all text-cyan">{aiEndpoint(draft.ai)}</code>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void save()} disabled={!dirty}>
                保存设置
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void runTest("current")} disabled={testing}>
                {testing ? "测试中…" : "测试当前配置"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void runTest("direct")}
                disabled={testing || !draft.ai.baseUrl || !draft.ai.apiKey || !draft.ai.model}
              >
                测试直连
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void runTest("proxy")}
                disabled={testing || !draft.ai.proxyUrl}
              >
                测试代理
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void checkProxyHealth()}
                disabled={!draft.ai.proxyUrl}
              >
                检测代理
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(settings)} disabled={!dirty}>
                放弃修改
              </Button>
              {dirty && <span className="text-[11px] text-gold">有未保存修改</span>}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-dim">
              测试使用当前表单里的值（包括未保存修改）；连接成功后记得点「保存设置」。
            </p>
            {testResult && (
              <div
                className={cn(
                  "mt-2 rounded-lg border px-3 py-2 text-[12px] leading-relaxed",
                  testResult.ok
                    ? "border-ok/40 bg-ok/10 text-ok"
                    : "border-danger/40 bg-danger/10 text-danger",
                )}
              >
                <div>
                  {testResult.ok ? "✓ " : "✗ "}
                  {testResult.text}
                </div>
                <div className="mt-1 break-all text-[10.5px] opacity-75">请求地址：{testResult.endpoint}</div>
                {testResult.hint && <div className="mt-1.5 text-[11px] opacity-90">{testResult.hint}</div>}
                {testResult.action === "disable-proxy" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => {
                      setAi({ useProxy: false });
                      void runTestWith({ ...draft.ai, useProxy: false }, "直连");
                    }}
                  >
                    关闭代理并测试直连
                  </Button>
                )}
                {testResult.action === "use-proxy" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2"
                    onClick={() => {
                      setAi({ useProxy: true });
                      void runTestWith({ ...draft.ai, useProxy: true }, "代理");
                    }}
                  >
                    改用代理测试
                  </Button>
                )}
              </div>
            )}
            {proxyHealth && (
              <div
                className={cn(
                  "mt-2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed",
                  proxyHealth.ok
                    ? "border-cyan/35 bg-cyan/[0.06] text-cyan"
                    : "border-danger/40 bg-danger/10 text-danger",
                )}
              >
                {proxyHealth.ok ? "● " : "✗ "}
                {proxyHealth.text}
              </div>
            )}
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              本地代理启动方式：复制上方 .env 片段到项目根目录的
              <code className="mx-1 rounded bg-white/5 px-1">.env</code>，再运行
              <code className="mx-1 rounded bg-white/5 px-1">npm run proxy</code>。修改 .env 后需要重启代理；代理地址默认
              http://localhost:8787/api/ai/chat。
            </p>
          </Card>

          <Card className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-ink">外观皮肤</h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  深空适合夜间与技术阅读；纸质书页采用米色纸张、宋体内文与轻微纸纹，接近真实教材。
                </p>
              </div>
              <Badge tone="neutral">{draft.theme === "paper" ? "纸质书页" : "深空"}</Badge>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ThemeOption
                theme="dark"
                active={draft.theme === "dark"}
                title="深空"
                description="石墨底 + 青色星辉，默认样式"
                onSelect={() => void applyTheme("dark")}
              />
              <ThemeOption
                theme="paper"
                active={draft.theme === "paper"}
                title="纸质书页"
                description="米色纸张 + 宋体内文，护眼仿书本"
                onSelect={() => void applyTheme("paper")}
              />
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-dim">
              皮肤会立即应用并保存；切换不影响学习进度与成绩。也可用顶栏的 ☀ / ☾ 按钮快速切换。
            </p>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">学习偏好</h2>
            <div className="mt-3 space-y-2.5">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="昵称（可选）" hint="用于首页问候">
                  <input
                    value={draft.displayName}
                    onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                    className={inputClass}
                    placeholder="学习者"
                  />
                </Field>
                <Field label="每日目标（分钟）">
                  <input
                    type="number"
                    min={5}
                    max={240}
                    value={draft.dailyGoalMinutes}
                    onChange={(event) => setDraft({ ...draft, dailyGoalMinutes: Number(event.target.value) })}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Toggle
                checked={draft.reduceMotion}
                onChange={(value) => setDraft({ ...draft, reduceMotion: value })}
                label="减少动画"
                description="关闭星光脉冲、过渡与渐入动画，适合低性能设备或对动效敏感的用户。"
              />
            </div>
            <div className="mt-3">
              <Button size="sm" onClick={() => void save()} disabled={!dirty}>
                保存偏好
              </Button>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink">数据管理</h2>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              进度、成绩、错题、笔记与 AI 缓存均保存在本地 IndexedDB。关闭浏览器或断网不会丢失。
            </p>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-line/60 bg-panel2/40 p-3">
                <div className="text-[11px] text-dim">导出备份</div>
                <div className="mt-1 text-[12px] text-muted">
                  考试记录 {progress.attempts.length} 条 · 错题 {progress.wrong.length} 条 · 学习进度{" "}
                  {Object.keys(progress.chapterProgress).length} 章
                </div>
                <label className="mt-2 flex items-center gap-2 text-[11px] text-muted">
                  <input
                    type="checkbox"
                    checked={includeKey}
                    onChange={(event) => setIncludeKey(event.target.checked)}
                    className="accent-cyan"
                  />
                  同时导出 API Key（不推荐）
                </label>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => void downloadExport()}>
                  下载 JSON 备份
                </Button>
              </div>

              <div className="rounded-xl border border-line/60 bg-panel2/40 p-3">
                <div className="text-[11px] text-dim">导入恢复</div>
                <div className="mt-1 text-[12px] text-muted">
                  导入前会校验格式与版本，并让你选择合并或覆盖，不会静默覆盖现有数据。
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void pickFile(file);
                    event.target.value = "";
                  }}
                />
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => fileRef.current?.click()}>
                  选择备份文件
                </Button>
              </div>
            </div>

            {importError && (
              <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[12px] text-danger">
                <div className="font-medium">导入文件校验失败：</div>
                <ul className="mt-1 list-disc pl-4">
                  {importError.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => void clearCache()}>
                清理 AI 缓存
              </Button>
              {cacheCount !== null && <span className="text-[11px] text-dim">上次清理 {cacheCount} 条</span>}
              <Button size="sm" variant="danger" className="ml-auto" onClick={() => setConfirmReset(true)}>
                清空全部本地数据
              </Button>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">课程信息</h2>
            <dl className="mt-2 space-y-1.5 text-[11.5px]">
              <Row label="课程" value={course.title} />
              <Row label="版本" value={course.version} />
              <Row label="章节" value={`${course.stats.chapters} 章 / ${course.stats.areas} 大关卡`} />
              <Row label="术语" value={`${glossary.terms.length} 条`} />
              <Row label="许可" value={course.source.license} />
            </dl>
            <div className="mt-2 space-y-1 text-[11px]">
              <a href={course.source.repo} target="_blank" rel="noreferrer" className="block text-cyan hover:underline">
                课程 GitHub 仓库 ↗
              </a>
              <a href={course.source.site} target="_blank" rel="noreferrer" className="block text-cyan hover:underline">
                在线文档 ↗
              </a>
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-sm font-semibold text-ink">评分与解锁规则</h2>
            <ul className="mt-2 space-y-1.5 text-[11.5px] leading-relaxed text-muted">
              <li>总分 100 = 学习任务 20 + 章节考试 80。</li>
              <li>学习分：导读 2、知识点 8、检查 6、总结 4。</li>
              <li>考试总分必须严格等于 80，主观题评分细则分值和必须等于题目分值。</li>
              <li>总分 ≥ 60 通关并解锁下一关；59 分及以下保持锁定。</li>
              <li>星级：100 金、90–99 银、80–89 铜、60–79 普通；以历史最高分为准。</li>
              <li>已解锁关卡不会因后续低分撤销；每次考试独立保存。</li>
            </ul>
          </Card>

          <Card className="p-4 text-[11px] leading-relaxed text-dim">
            原文与版权归 {course.source.copyright} 所有（{course.source.license}）。本应用只做学习流程、AI 讲解与考核编排，
            并对 AI 生成内容与原文内容做明确区分。
          </Card>
        </div>
      </div>

      <Modal
        open={Boolean(importPreview)}
        onClose={() => setImportPreview(null)}
        title="确认导入备份"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setImportPreview(null)}>
              取消
            </Button>
            <Button size="sm" onClick={() => void confirmImport()}>
              {importMode === "replace" ? "覆盖导入" : "合并导入"}
            </Button>
          </>
        }
      >
        {importPreview && (
          <>
            <p>
              文件包含：考试记录 {importPreview.bundle.progress.attempts.length} 条、错题{" "}
              {importPreview.bundle.progress.wrong.length} 条、学习进度{" "}
              {Object.keys(importPreview.bundle.progress.chapterProgress).length} 章。
            </p>
            <p className="mt-1 text-[12px] text-dim">
              导出时间：{new Date(importPreview.bundle.exportedAt).toLocaleString("zh-CN")} · 课程版本{" "}
              {importPreview.bundle.courseVersion}
            </p>
            {importPreview.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-gold">
                {importPreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2">
                <input
                  type="radio"
                  checked={importMode === "merge"}
                  onChange={() => setImportMode("merge")}
                  className="mt-1 accent-cyan"
                />
                <span>
                  <span className="block text-[12.5px] text-ink">合并导入（推荐）</span>
                  <span className="block text-[11px] text-muted">
                    学习任务取并集，考试记录按 id 去重，保留更晚的学习位置。
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2">
                <input
                  type="radio"
                  checked={importMode === "replace"}
                  onChange={() => setImportMode("replace")}
                  className="mt-1 accent-cyan"
                />
                <span>
                  <span className="block text-[12.5px] text-danger">覆盖导入</span>
                  <span className="block text-[11px] text-muted">
                    用备份完全替换当前进度与成绩，当前数据将不可恢复。
                  </span>
                </span>
              </label>
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="清空全部本地数据"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setConfirmReset(false)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmReset(false);
                void resetAll();
              }}
            >
              确认清空
            </Button>
          </>
        }
      >
        <p>这会删除当前浏览器的全部学习进度、考试成绩、错题与 AI 缓存，且无法撤销。</p>
        <p className="mt-2 text-[12px] text-gold">建议先下载 JSON 备份再操作。</p>
      </Modal>
    </div>
  );
}

function ThemeOption({
  theme,
  active,
  title,
  description,
  onSelect,
}: {
  theme: AppTheme;
  active: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "overflow-hidden rounded-xl border p-0 text-left transition-colors",
        active ? "border-cyan/60 ring-1 ring-cyan/30" : "border-line hover:border-cyan/35",
      )}
    >
      <div
        className="relative h-24 w-full overflow-hidden"
        style={
          theme === "paper"
            ? {
                backgroundImage:
                  "repeating-linear-gradient(0deg, rgba(120,95,60,.06) 0 1px, transparent 1px 3px), radial-gradient(400px 160px at 15% 0%, rgba(176,143,88,.25), transparent 70%), linear-gradient(180deg,#f7efdf,#ecdfc8)",
              }
            : {
                backgroundImage:
                  "radial-gradient(300px 140px at 15% 0%, rgba(55,214,230,.18), transparent 65%), radial-gradient(260px 140px at 90% 10%, rgba(91,140,255,.16), transparent 60%), linear-gradient(180deg,#0b111c,#060911)",
              }
        }
      >
        <div className="absolute inset-x-3 top-3 space-y-1.5">
          <div
            className="h-2 w-16 rounded-full"
            style={{ background: theme === "paper" ? "#b7a17c" : "#37d6e6", opacity: 0.8 }}
          />
          <div
            className="h-1.5 w-full rounded-full"
            style={{ background: theme === "paper" ? "#cbbb9d" : "#223049" }}
          />
          <div
            className="h-1.5 w-5/6 rounded-full"
            style={{ background: theme === "paper" ? "#d8c9ad" : "#1a2537" }}
          />
          <div
            className="h-1.5 w-2/3 rounded-full"
            style={{ background: theme === "paper" ? "#e0d2b8" : "#16202f" }}
          />
        </div>
        <span
          className="absolute bottom-2 right-2 text-lg"
          style={{ color: theme === "paper" ? "#9d7018" : "#f6c453" }}
          aria-hidden="true"
        >
          ★
        </span>
      </div>
      <div className="flex items-start justify-between gap-2 bg-panel2/50 px-3 py-2">
        <span>
          <span className="block text-[12.5px] font-medium text-ink">{title}</span>
          <span className="block text-[10.5px] text-muted">{description}</span>
        </span>
        <span className={cn("mt-0.5 text-[10px]", active ? "text-cyan" : "text-dim")}>
          {active ? "使用中" : "切换"}
        </span>
      </div>
    </button>
  );
}

const inputClass =
  "w-full rounded-lg border border-line bg-panel2/60 px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-dim focus:border-cyan/50";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11.5px] text-muted">{label}</span>
        {hint && <span className="text-[10px] text-dim">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <dt className="text-dim">{label}</dt>
      <dd className="max-w-[60%] text-right text-muted">{value}</dd>
    </div>
  );
}
