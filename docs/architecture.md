# 架构与数据模型

## 1. 分层

```
课程仓库 (Markdown)
      │  scripts/build-course.mjs（构建期）
      ▼
静态课程 JSON (public/course)
      │  lib/course/loader.ts
      ▼
React 页面 ── 领域规则（rules / exam / localContent）
      │                         │
      │                         └── AI 服务（provider / service / prompts / schemas）
      ▼
AppContext（课程 + 进度 + 设置 + 缓存）
      ▼
IndexedDB（进度、成绩、错题、笔记、AI 缓存、草稿）
```

业务规则不依赖 React 或 DOM：

- `lib/domain/rules.ts`：学习分、星级、通关、顺序解锁、继续学习目标、进度合并、课程同步迁移。
- `lib/domain/exam.ts`：题型模板、80 分校验、客观题判分、本地主观题评分、成绩汇总。
- `lib/domain/localContent.ts`：本地导读/总结/检查题/试卷生成（纯函数，输入课程数据）。
- `lib/ai/*`：模型调用、结构化校验、缓存键，均不直接出现在页面里。

## 2. 课程数据模型

`public/course/course.json`：

```ts
{
  schemaVersion: 1,
  courseId, title, version, generatedAt, commit,
  source: { repo, site, license, copyright },
  stats: { areas, chapters, chars, blocks },
  areas: [{
    id, order, code, title, fullTitle,
    groups: [{ title, chapterIds }],   // 02 / 05 有子分组
    chapterIds: string[]
  }],
  chapters: ChapterMeta[]
}
```

`ChapterMeta` 关键字段：

| 字段 | 说明 |
| --- | --- |
| `id` | `ch_<sha1(sourcePath)[:10]>`，稳定标识 |
| `sourcePath` / `sourceUrl` / `onlineUrl` | 原文映射与出处 |
| `objectives` | 从原文「本章课程目标」解析 |
| `advice` | 原文「学习建议」 |
| `sections[]` | H2 知识点：`id / title / chars` |
| `terms[]` | 与该章相关的术语表条目 |
| `profile` | `concept` / `mixed` / `code-heavy`，决定试卷模板 |
| `contentHash` | 原文哈希，用于缓存失效与同步迁移 |

`public/course/chapters/<id>.json`：

```ts
{
  schemaVersion, id, contentHash,
  intro: Block[],
  sections: [{
    id, title, subheadings[], chars,
    blocks: Block[]
  }]
}
type Block =
  | { k: "paragraph" | "ul" | "ol" | "table" | "quote" | "html" | "heading" | "hr" | "h3"; html: string; text: string }
  | { k: "code"; lang: string; code: string; text: string }
  | { k: "img"; src: string; alt: string }
```

构建期完成：

- 侧边栏解析（缩进 0 大关卡、2 章节/分组、4 分组章节）；
- 「本章课程目标 / 学习建议 / 官方文档与资源」结构化，并从 intro 中剔除避免重复；
- 相对 `.md` 链接 → 站内路由（按标题归一化匹配锚点）；仓库文件 → GitHub 链接；
- 图片路径 → `/course-assets/<repo-relative>`；
- 术语表表格与易混对照解析。

## 3. 进度模型

```ts
StudyProgressState {
  chapterProgress: Record<chapterId, {
    guideAck, sectionsRead[], checks{sectionId:{answered,correct,answer,at}},
    summaryRead, summaryBookmarked?, lastSectionId?, notes?, updatedAt
  }>,
  attempts: ExamAttempt[],
  wrong: WrongEntry[],
  lastLocation: { chapterId, sectionId?, tab, updatedAt } | null
}
```

- 学习分由 `computeStudyPoints` 从任务完成状态实时计算，不存冗余分数，避免前后端不一致。
- 解锁：每个大关卡首章默认开放，同一大关卡内需前一章通关；大关卡之间可自由选择。
- 首页「继续学习」由 `resolveResumeTarget` 决定：上次未通关 → 恢复原位置；已通关 → 最近未完成且已解锁章节；全部完成 → 复习。
- 课程版本变化时，`remapChapterIds` 用旧 `id → {sourcePath, contentHash}` 映射到新课程，再回写最新映射。

## 4. 考试契约

```ts
ExamQuestion {
  id, type, points, prompt, options?, answer, answerAlternatives?,
  rubric?: { criteria: [{ point, keywords[], points }] },
  explanation, knowledgePointTitle?, sourceRef?, difficulty, code?
}
```

校验（`validatePaper`）：

1. 题目 ID 唯一、分值正整数、题干与参考答案非空；
2. 选择题：选项 ≥ 2、key 唯一、answer 在选项中；
3. 其他题型（填空除外）：必须有 rubric，且 `Σcriteria.points === question.points`，每条细则至少 1 个关键词；
4. `Σpoints === 80`。

AI 命题流程：模板约束 → Zod 校验 → 80 分/细则校验 → 失败自动修复一次 → 仍失败则报错，由用户选择重试或切本地题库。**不会用不合法试卷开考。**

判分：

- 选择：精确匹配（忽略大小写）。
- 填空：NFKC 归一化 + 去空白标点 + 同义答案；只接受完整答案或包含标准答案（差值 ≤ 8 字符），拒绝残缺答案。
- 主观题：AI 按评分细则返回 `{score, feedback, hits, misses}`，分数截断到 `[0, points]`；本地模式按关键词覆盖率逐条得分并标注「本地估分」。
- AI 失败：保留试卷与答案，进入 `grading-error`，可重试或显式改用本地判分，不写 0 分记录。

## 5. AI 调用与缓存

- OpenAI 兼容：`POST {baseUrl}/chat/completions`；或代理地址。
- 超时（AbortController）+ 可重试错误（429/5xx/网络）一次退避重试；401/404 直接给出可读错误。
- 缓存键：`feature:chapterId:contentHash:model:promptVersion:extra`。
- 功能：`guide` / `summary` / `paper` / `explain:<sectionId>` / `similar`（不缓存）/ `chat`（按章节存对话）。
- 提示词强调：事实以原文为准；超出内容标【AI 补充】；不伪造原文链接或章节编号。
- 所有 AI 输出经过 Zod 结构校验；失败时返回明确错误而不是静默使用坏数据。

## 6. 存储

IndexedDB `ai-xingtu/kv`（单 object store，out-of-line key）：

| key | 内容 |
| --- | --- |
| `state:progress` | 整个学习进度快照 |
| `state:settings` | AI 与外观偏好 |
| `meta:course` | 课程版本 + id→path/hash 映射（同步迁移用） |
| `cache:ai:*` | AI 生成内容 |
| `chat:<chapterId>` | 章节对话（最近 60 条） |
| `draft:<chapterId>` | 未提交试卷（刷新恢复） |

写入策略：进度变更 250ms 防抖；页面隐藏/关闭时 flush；考试提交立即写入。测试使用 `MemoryStore` 替换 IndexedDB 验证读写与恢复。

导出格式 `schemaVersion: 1`，导入前 Zod 校验并预览数量，支持「合并（并集/去重）」与「覆盖」；覆盖需二次确认。

## 7. 扩展点

- 账号/云同步：在 `ProgressRepository` 之上增加远端适配器，沿用 `mergeProgress` 冲突合并。
- 间隔复习：`WrongEntry` 已含知识点、时间与掌握状态，可加入 SM-2 调度字段。
- 成就系统：`attempts` 与 `chapterProgress` 已提供所需事件源。
- 更多课程：`COURSE_REPO=<path> npm run course:build`，或替换 `public/course` 中符合 schema 的 JSON。
- 评测/观测：AI 服务层可注入日志与成本统计；当前每次调用返回模型名与缓存命中信息。
