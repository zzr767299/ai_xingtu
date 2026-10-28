import { describe, expect, it } from "vitest";
import type { ExamQuestion, QuestionGrade } from "../src/types";
import {
  EXAM_TEMPLATES,
  gradeObjective,
  gradeSubjectiveLocal,
  normalizeAnswer,
  selectTemplate,
  summarizeAttempt,
  templateTotal,
  validatePaper,
} from "../src/lib/domain/exam";

function choiceQuestion(index: number, points = 10): ExamQuestion {
  return {
    id: `q${index}`,
    type: "choice",
    points,
    prompt: `第 ${index} 题：以下哪个概念用于保存执行状态？`,
    options: [
      { key: "A", text: "Checkpointer" },
      { key: "B", text: "Prompt" },
      { key: "C", text: "RAG" },
    ],
    answer: "A",
    explanation: "Checkpointer 保存图执行状态。",
    difficulty: "easy",
  };
}

function subjectiveQuestion(points = 10): ExamQuestion {
  return {
    id: "q-sub",
    type: "application",
    points,
    prompt: "请说明你会如何在真实项目中应用 Checkpointer，并说明风险。",
    answer: "使用 thread_id 区分会话，用 Checkpointer 保存状态，并注意状态体积与敏感信息。",
    rubric: {
      criteria: [
        { point: "说明 thread_id 的作用", keywords: ["thread_id", "会话"], points: 4 },
        { point: "说明状态持久化", keywords: ["Checkpointer", "状态"], points: 4 },
        { point: "说明风险", keywords: ["风险", "体积"], points: 2 },
      ],
    },
    explanation: "参考原文 LangGraph 记忆章节。",
    difficulty: "hard",
  };
}

describe("试卷 80 分校验", () => {
  it("三个模板满分都严格等于 80", () => {
    for (const template of EXAM_TEMPLATES) {
      expect(templateTotal(template)).toBe(80);
    }
  });

  it("按章节类型选择模板", () => {
    expect(selectTemplate({ profile: "concept" }).id).toBe("concept");
    expect(selectTemplate({ profile: "code-heavy" }).id).toBe("code-heavy");
    expect(selectTemplate({ profile: "mixed" }).id).toBe("mixed");
  });

  it("合法的 8 × 10 分试卷通过", () => {
    const paper = Array.from({ length: 8 }, (_, index) => choiceQuestion(index + 1));
    const result = validatePaper(paper);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(80);
  });

  it("总分不是 80 时拒绝开考", () => {
    const paper = Array.from({ length: 7 }, (_, index) => choiceQuestion(index + 1));
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("必须严格等于 80");
  });

  it("主观题评分细则分值和与题目分值不一致时拒绝", () => {
    const paper = [
      ...Array.from({ length: 7 }, (_, index) => choiceQuestion(index + 1)),
      { ...subjectiveQuestion(9), id: "q8" },
    ];
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("评分细则分值和为 10");
  });

  it("选择题答案不在选项中时拒绝", () => {
    const paper = Array.from({ length: 8 }, (_, index) => choiceQuestion(index + 1));
    paper[0] = { ...paper[0], answer: "Z" };
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("正确答案不在选项中");
  });

  it("题干重复时拒绝", () => {
    const paper = Array.from({ length: 8 }, (_, index) => choiceQuestion(index + 1));
    paper[1] = { ...paper[1], prompt: paper[0].prompt };
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("题目内容重复");
  });

  it("题目 id 重复时拒绝", () => {
    const paper = Array.from({ length: 8 }, (_, index) => choiceQuestion(index + 1));
    paper[1] = { ...paper[1], id: paper[0].id };
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("题目 id 重复");
  });

  it("只考 Base URL 等字面量的填空题被拒绝", () => {
    const paper = Array.from({ length: 7 }, (_, index) => choiceQuestion(index + 1));
    paper.push({
      id: "q8",
      type: "fill",
      points: 10,
      prompt: "本章百炼 OpenAI 兼容接口中，最常见的 Base URL 是：____。",
      answer: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      explanation: "原文给出了兼容模式地址。",
      difficulty: "easy",
    });
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("字面量");
  });

  it("代码题缺少代码内容时拒绝", () => {
    const paper = Array.from({ length: 7 }, (_, index) => choiceQuestion(index + 1));
    paper.push({
      id: "q8",
      type: "code-read",
      points: 10,
      prompt: "阅读下面代码，判断它更接近 LLM 风格还是 Chat Model 风格。",
      answer: "接近 LLM 风格，输入输出都是字符串。",
      rubric: { criteria: [{ point: "说明输入输出形式", keywords: ["字符串", "输入"], points: 10 }] },
      explanation: "参考模型分类一节。",
      difficulty: "medium",
    });
    const result = validatePaper(paper);
    expect(result.ok).toBe(false);
    expect(result.errors.join()).toContain("缺少代码");
  });

  it("代码题把代码放在 code 字段时通过", () => {
    const paper = Array.from({ length: 7 }, (_, index) => choiceQuestion(index + 1));
    paper.push({
      id: "q8",
      type: "code-read",
      points: 10,
      prompt: "阅读下面的代码，判断它更接近 LLM 风格还是 Chat Model 风格。",
      answer: "接近 LLM 风格，输入输出都是字符串。",
      code: 'response = llm.invoke("你好")\nprint(response)',
      codeLang: "python",
      rubric: { criteria: [{ point: "说明输入输出形式", keywords: ["字符串", "输入"], points: 10 }] },
      explanation: "参考模型分类一节。",
      difficulty: "medium",
    });
    const result = validatePaper(paper);
    expect(result.ok, result.errors.join("；")).toBe(true);
  });
});

describe("客观题判分", () => {
  it("选择题按标准答案判分", () => {
    const question = choiceQuestion(1, 10);
    expect(gradeObjective(question, "A").score).toBe(10);
    expect(gradeObjective(question, "B").score).toBe(0);
    expect(gradeObjective(question, "").score).toBe(0);
  });

  it("填空题兼容大小写、空格、标点与同义写法", () => {
    const question: ExamQuestion = {
      ...choiceQuestion(1, 4),
      type: "fill",
      prompt: "____ 用于保存图执行状态。",
      answer: "Checkpointer",
      answerAlternatives: ["检查点机制"],
      options: undefined,
    };
    expect(normalizeAnswer("  Check Pointer ")).toBe("checkpointer");
    expect(gradeObjective(question, " checkpointer ").score).toBe(4);
    expect(gradeObjective(question, "CHECKPOINTER").score).toBe(4);
    expect(gradeObjective(question, "检查点机制").score).toBe(4);
    expect(gradeObjective(question, "checkpoin").score).toBe(0);
    expect(gradeObjective(question, "Prompt").score).toBe(0);
  });

  it("空主观题得 0 分", () => {
    const grade = gradeSubjectiveLocal(subjectiveQuestion(10), "");
    expect(grade.score).toBe(0);
    expect(grade.gradedBy).toBe("local-rubric");
  });

  it("主观题按关键词命中比例估分并给出命中/遗漏", () => {
    const grade = gradeSubjectiveLocal(
      subjectiveQuestion(10),
      "我会用 thread_id 区分不同会话，并用 Checkpointer 保存状态，同时关注状态体积与敏感信息带来的风险。",
    );
    expect(grade.score).toBe(10);
    expect(grade.hits.length).toBeGreaterThan(0);

    const partial = gradeSubjectiveLocal(subjectiveQuestion(10), "我会使用 Checkpointer 保存状态。");
    expect(partial.score).toBeGreaterThan(0);
    expect(partial.score).toBeLessThan(10);
    expect(partial.misses.length).toBeGreaterThan(0);
  });
});

describe("成绩汇总与通关", () => {
  const grades = (examTotal: number): QuestionGrade[] => [
    {
      questionId: "q1",
      score: examTotal,
      maxScore: 80,
      correct: examTotal >= 48,
      feedback: "",
      hits: [],
      misses: [],
      gradedBy: "auto",
    },
  ];

  it("59 分不通过，60 分通过", () => {
    expect(summarizeAttempt(20, grades(39))).toMatchObject({ total: 59, passed: false, star: "failed" });
    expect(summarizeAttempt(20, grades(40))).toMatchObject({ total: 60, passed: true, star: "normal" });
  });

  it("星级边界正确", () => {
    expect(summarizeAttempt(20, grades(60)).star).toBe("bronze");
    expect(summarizeAttempt(20, grades(70)).star).toBe("silver");
    expect(summarizeAttempt(20, grades(80)).star).toBe("gold");
  });

  it("考试分超过 80 时截断，总分不超过 100", () => {
    const result = summarizeAttempt(20, grades(120));
    expect(result.examScore).toBe(80);
    expect(result.total).toBe(100);
  });
});
