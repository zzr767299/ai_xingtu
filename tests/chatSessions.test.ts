import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/lib/storage/memoryStore";
import { KEYS, ProgressRepository } from "../src/lib/storage/repo";
import type { ChatMessage, ChatSession } from "../src/types";

function message(role: ChatMessage["role"], content: string, at: number): ChatMessage {
  return { role, content, at };
}

function session(id: string, createdAt: number, messages: ChatMessage[] = []): ChatSession {
  return {
    id,
    chapterId: "ch1",
    title: `会话 ${id}`,
    createdAt,
    updatedAt: createdAt,
    messages,
  };
}

describe("章节对话历史", () => {
  it("按创建时间倒序读取，最近的在最前", async () => {
    const repo = new ProgressRepository(new MemoryStore());
    await repo.saveChatSessions("ch1", [session("old", 1000), session("new", 2000)]);
    const loaded = await repo.getChatSessions("ch1");
    expect(loaded.map((item) => item.id)).toEqual(["new", "old"]);
  });

  it("没有会话时返回空数组", async () => {
    const repo = new ProgressRepository(new MemoryStore());
    expect(await repo.getChatSessions("ch-empty")).toEqual([]);
  });

  it("把旧版单线程对话迁移为一个会话，并清理旧数据", async () => {
    const store = new MemoryStore();
    const repo = new ProgressRepository(store);
    await repo.saveChat("ch1", [
      message("user", "什么是大模型？", 1000),
      message("assistant", "大模型是……", 1100),
    ]);

    const sessions = await repo.getChatSessions("ch1");
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("什么是大模型？");
    expect(sessions[0].messages).toHaveLength(2);
    expect(await store.get(KEYS.chat + "ch1")).toBeUndefined();

    // 再次读取不会因为旧数据重复迁移
    expect(await repo.getChatSessions("ch1")).toHaveLength(1);
  });

  it("单个会话最多保留 60 条消息", async () => {
    const repo = new ProgressRepository(new MemoryStore());
    const messages = Array.from({ length: 80 }, (_, index) => message("user", `问题 ${index}`, 1000 + index));
    await repo.saveChatSessions("ch1", [session("s1", 1000, messages)]);
    const [loaded] = await repo.getChatSessions("ch1");
    expect(loaded.messages).toHaveLength(60);
    expect(loaded.messages[0].content).toBe("问题 20");
  });

  it("同一章节最多保留 30 个会话，丢弃最早的", async () => {
    const repo = new ProgressRepository(new MemoryStore());
    const sessions = Array.from({ length: 35 }, (_, index) => session(`s${index}`, 1000 + index));
    await repo.saveChatSessions("ch1", sessions);
    const loaded = await repo.getChatSessions("ch1");
    expect(loaded).toHaveLength(30);
    expect(loaded[0].id).toBe("s34");
    expect(loaded.some((item) => item.id === "s0")).toBe(false);
  });
});
