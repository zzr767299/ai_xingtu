import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  AppSettings,
  ChapterContent,
  ChapterMeta,
  ChapterProgress,
  CourseData,
  ExamAttempt,
  Glossary,
  LastLocation,
  StudyProgressState,
  WrongEntry,
} from "../types";
import { loadChapter, loadCourse, loadGlossary } from "../lib/course/loader";
import { createStore } from "../lib/storage/idbStore";
import {
  ProgressRepository,
  createEmptyState,
  parseExportBundle,
} from "../lib/storage/repo";
import {
  buildChapterStatuses,
  computeStudyPoints,
  createEmptyProgress,
  mergeProgress,
  remapChapterIds,
  resolveResumeTarget,
  type ChapterStatus,
  type ResumeTarget,
} from "../lib/domain/rules";
import { AiService } from "../lib/ai/service";

const store = createStore();
const repo = new ProgressRepository(store);

export interface ToastState {
  id: number;
  text: string;
  tone: "info" | "success" | "error";
}

interface AppContextValue {
  ready: boolean;
  bootError: string | null;
  course: CourseData;
  glossary: Glossary;
  chapters: ChapterMeta[];
  chapterById: (id: string) => ChapterMeta | undefined;
  areaTitle: (areaId: string) => string;
  statuses: Record<string, ChapterStatus>;
  progress: StudyProgressState;
  settings: AppSettings;
  repo: ProgressRepository;
  ai: AiService;
  resume: ResumeTarget;
  contents: Record<string, ChapterContent | undefined>;
  loadingChapters: Record<string, boolean>;
  chapterErrors: Record<string, string>;
  loadChapterContent: (id: string) => Promise<ChapterContent | undefined>;
  updateChapterProgress: (chapterId: string, updater: (progress: ChapterProgress) => ChapterProgress) => void;
  setLastLocation: (location: LastLocation) => void;
  saveAttempt: (attempt: ExamAttempt, wrongs: WrongEntry[]) => Promise<void>;
  setWrongResolved: (id: string, resolved: boolean) => void;
  updateSettings: (updater: (settings: AppSettings) => AppSettings) => Promise<void>;
  importData: (text: string, mode: "merge" | "replace") => Promise<{ ok: boolean; message: string; warnings: string[] }>;
  exportData: (includeApiKey: boolean) => Promise<string>;
  resetAll: () => Promise<void>;
  flushSave: () => Promise<void>;
  notify: (text: string, tone?: ToastState["tone"]) => void;
  toast: ToastState | null;
  dismissToast: () => void;
  studyPointsFor: (chapterId: string) => ReturnType<typeof computeStudyPoints>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [course, setCourse] = useState<CourseData | null>(null);
  const [glossary, setGlossary] = useState<Glossary>({ terms: [], contrasts: [] });
  const [progress, setProgress] = useState<StudyProgressState>(createEmptyState);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [contents, setContents] = useState<Record<string, ChapterContent | undefined>>({});
  const [loadingChapters, setLoadingChapters] = useState<Record<string, boolean>>({});
  const [chapterErrors, setChapterErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  const settingsRef = useRef<AppSettings | null>(null);
  const progressRef = useRef(progress);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingState = useRef<StudyProgressState | null>(null);
  const pendingSettings = useRef<AppSettings | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  const flushSave = useCallback(async () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingState.current) {
      await repo.saveState(pendingState.current);
      pendingState.current = null;
    }
    if (pendingSettings.current) {
      await repo.saveSettings(pendingSettings.current);
      pendingSettings.current = null;
    }
  }, []);

  const scheduleSave = useCallback((state: StudyProgressState, immediate = false) => {
    pendingState.current = state;
    if (immediate) {
      void flushSave();
      return;
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 250);
  }, [flushSave]);

  const notify = useCallback((text: string, tone: ToastState["tone"] = "info") => {
    setToast({ id: Date.now(), text, tone });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [courseData, glossaryData, storedSettings, storedState, storedMeta] = await Promise.all([
          loadCourse(),
          loadGlossary(),
          repo.loadSettings(),
          repo.loadState(),
          repo.getCourseMeta<{
            version: string;
            idToPath: Record<string, string>;
            idToHash: Record<string, string>;
          }>(),
        ]);
        if (cancelled) return;

        let state = storedState;
        const idToPath = Object.fromEntries(
          courseData.chapters.map((chapter) => [chapter.id, chapter.sourcePath]),
        );
        const idToHash = Object.fromEntries(
          courseData.chapters.map((chapter) => [chapter.id, chapter.contentHash]),
        );

        if (storedMeta && storedMeta.version !== courseData.version) {
          const pathToId = Object.fromEntries(
            Object.entries(idToPath).map(([id, sourcePath]) => [sourcePath, id]),
          );
          const hashToId = Object.fromEntries(
            Object.entries(idToHash).map(([id, contentHash]) => [contentHash, id]),
          );
          const previous = Object.fromEntries(
            Object.keys(storedMeta.idToPath ?? {}).map((id) => [
              id,
              {
                sourcePath: storedMeta.idToPath[id],
                contentHash: storedMeta.idToHash?.[id] ?? "",
              },
            ]),
          );
          state = remapChapterIds(state, previous, { pathToId, hashToId });
          await repo.saveState(state);
        }

        await repo.saveCourseMeta({
          version: courseData.version,
          idToPath,
          idToHash,
        });

        if (!cancelled) {
          setCourse(courseData);
          setGlossary(glossaryData);
          setSettings(storedSettings);
          setProgress(state);
          setReady(true);
        }
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error.message : String(error));
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handler = () => {
      void flushSave();
    };
    window.addEventListener("beforeunload", handler);
    document.addEventListener("visibilitychange", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
      document.removeEventListener("visibilitychange", handler);
    };
  }, [flushSave]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = settings?.reduceMotion ? "true" : "false";
  }, [settings?.reduceMotion]);

  useEffect(() => {
    const theme = settings?.theme ?? "dark";
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "paper" ? "#f1e7d4" : "#070a11");
  }, [settings?.theme]);

  const chapters = useMemo(
    () => (course ? [...course.chapters].sort((a, b) => a.order - b.order) : []),
    [course],
  );

  const chapterIndex = useMemo(() => {
    const map = new Map<string, ChapterMeta>();
    for (const chapter of chapters) map.set(chapter.id, chapter);
    return map;
  }, [chapters]);

  const chapterById = useCallback(
    (id: string) => chapterIndex.get(id),
    [chapterIndex],
  );

  const areaTitle = useCallback(
    (areaId: string) => course?.areas.find((area) => area.id === areaId)?.title ?? areaId,
    [course],
  );

  const statuses = useMemo(
    () => (course ? buildChapterStatuses(course, progress) : {}),
    [course, progress],
  );

  const resume = useMemo<ResumeTarget>(() => {
    if (!course) return { kind: "review", reason: "课程尚未加载" };
    return resolveResumeTarget(course, progress, statuses);
  }, [course, progress, statuses]);

  const updateChapterProgress = useCallback(
    (chapterId: string, updater: (progress: ChapterProgress) => ChapterProgress) => {
      setProgress((previous) => {
        const current = previous.chapterProgress[chapterId] ?? createEmptyProgress(chapterId);
        const updated = { ...updater(current), chapterId, updatedAt: Date.now() };
        const next: StudyProgressState = {
          ...previous,
          chapterProgress: { ...previous.chapterProgress, [chapterId]: updated },
        };
        progressRef.current = next;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const setLastLocation = useCallback(
    (location: LastLocation) => {
      setProgress((previous) => {
        const next: StudyProgressState = { ...previous, lastLocation: location };
        progressRef.current = next;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const saveAttempt = useCallback(
    async (attempt: ExamAttempt, wrongs: WrongEntry[]) => {
      const next: StudyProgressState = {
        ...progressRef.current,
        attempts: [attempt, ...progressRef.current.attempts],
        wrong: [...wrongs, ...progressRef.current.wrong],
      };
      progressRef.current = next;
      setProgress(next);
      await repo.saveState(next);
    },
    [],
  );

  const setWrongResolved = useCallback(
    (id: string, resolved: boolean) => {
      setProgress((previous) => {
        const next = {
          ...previous,
          wrong: previous.wrong.map((entry) => (entry.id === id ? { ...entry, resolved } : entry)),
        };
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const updateSettings = useCallback(async (updater: (settings: AppSettings) => AppSettings) => {
    const current = settingsRef.current;
    if (!current) return;
    const next = updater(current);
    setSettings(next);
    settingsRef.current = next;
    pendingSettings.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 200);
  }, [flushSave]);

  const loadChapterContent = useCallback(async (id: string) => {
    if (contents[id]) return contents[id];
    setLoadingChapters((previous) => ({ ...previous, [id]: true }));
    try {
      const content = await loadChapter(id);
      setContents((previous) => ({ ...previous, [id]: content }));
      setChapterErrors((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      return content;
    } catch (error) {
      setChapterErrors((previous) => ({
        ...previous,
        [id]: error instanceof Error ? error.message : String(error),
      }));
      return undefined;
    } finally {
      setLoadingChapters((previous) => ({ ...previous, [id]: false }));
    }
  }, [contents]);

  const importData = useCallback(
    async (text: string, mode: "merge" | "replace") => {
      const parsed = parseExportBundle(text);
      if (!parsed.ok) return { ok: false, message: "导入失败：数据格式校验未通过", warnings: parsed.errors };
      if (parsed.bundle.courseId !== (course?.courseId ?? "ai-agents-from-zero")) {
        return { ok: false, message: "导入失败：课程 ID 不匹配，可能来自其他应用", warnings: [] };
      }

      const nextProgress =
        mode === "replace"
          ? parsed.bundle.progress
          : mergeProgress(progressRef.current, parsed.bundle.progress);

      setProgress(nextProgress);
      await repo.saveState(nextProgress);

      if (parsed.bundle.settings) {
        const imported = parsed.bundle.settings as AppSettings;
        const merged: AppSettings = {
          ...(settingsRef.current ?? (await repo.loadSettings())),
          ...imported,
          ai: {
            ...(settingsRef.current?.ai ?? (await repo.loadSettings()).ai),
            ...(imported.ai ?? {}),
            apiKey: imported.ai?.apiKey || settingsRef.current?.ai.apiKey || "",
          },
        };
        setSettings(merged);
        settingsRef.current = merged;
        await repo.saveSettings(merged);
      }

      return {
        ok: true,
        message:
          mode === "replace"
            ? `已覆盖导入 ${parsed.bundle.progress.attempts.length} 条考试记录`
            : `已合并导入，当前共 ${nextProgress.attempts.length} 条考试记录`,
        warnings: parsed.warnings,
      };
    },
    [course?.courseId],
  );

  const exportData = useCallback(async (includeApiKey: boolean) => {
    const bundle = await repo.buildExport(
      progressRef.current,
      course?.version ?? "unknown",
      course?.courseId ?? "ai-agents-from-zero",
      settingsRef.current ?? undefined,
      includeApiKey,
    );
    return JSON.stringify(bundle, null, 2);
  }, [course?.version, course?.courseId]);

  const resetAll = useCallback(async () => {
    await repo.clearAll();
    setProgress(createEmptyState());
    setSettings(await repo.loadSettings());
    notify("本地数据已清空（课程数据不受影响）", "success");
  }, [notify]);

  const ai = useMemo(
    () => new AiService(repo, () => settingsRef.current ?? ({} as AppSettings)),
    [],
  );

  const studyPointsFor = useCallback(
    (chapterId: string) => {
      const chapter = chapterIndex.get(chapterId);
      if (!chapter) {
        return computeStudyPoints({ sections: [] }, undefined);
      }
      return computeStudyPoints(chapter, progress.chapterProgress[chapterId]);
    },
    [chapterIndex, progress.chapterProgress],
  );

  const value = useMemo<AppContextValue | null>(() => {
    if (!course || !settings) return null;
    return {
      ready,
      bootError,
      course,
      glossary,
      chapters,
      chapterById,
      areaTitle,
      statuses,
      progress,
      settings,
      repo,
      ai,
      resume,
      contents,
      loadingChapters,
      chapterErrors,
      loadChapterContent,
      updateChapterProgress,
      setLastLocation,
      saveAttempt,
      setWrongResolved,
      updateSettings,
      importData,
      exportData,
      resetAll,
      flushSave,
      notify,
      toast,
      dismissToast: () => setToast(null),
      studyPointsFor,
    };
  }, [
    ready,
    bootError,
    course,
    glossary,
    chapters,
    chapterById,
    areaTitle,
    statuses,
    progress,
    settings,
    ai,
    resume,
    contents,
    loadingChapters,
    chapterErrors,
    loadChapterContent,
    updateChapterProgress,
    setLastLocation,
    saveAttempt,
    setWrongResolved,
    updateSettings,
    importData,
    exportData,
    resetAll,
    flushSave,
    notify,
    toast,
    studyPointsFor,
  ]);

  if (!value) {
    return <BootScreen error={bootError} />;
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error("useApp 必须在 AppProvider 内使用");
  return value;
}

function BootScreen({ error }: { error: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-3xl tracking-[0.3em] text-cyan">AI 星途</div>
      {error ? (
        <div className="max-w-xl rounded-xl border border-danger/40 bg-danger/10 p-5 text-sm text-danger">
          <div className="mb-2 font-semibold">启动失败</div>
          <p className="leading-relaxed">{error}</p>
          <p className="mt-3 text-xs text-danger/70">
            请确认已运行 <code className="rounded bg-black/30 px-1">npm run course:build</code> 生成课程数据。
          </p>
        </div>
      ) : (
        <div className="w-56 space-y-3">
          <div className="h-2 skeleton rounded-full" />
          <div className="h-2 w-3/4 skeleton rounded-full" />
          <p className="text-xs text-muted">正在加载课程星图与本地进度…</p>
        </div>
      )}
    </div>
  );
}
