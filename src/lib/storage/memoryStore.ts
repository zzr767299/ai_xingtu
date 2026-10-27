export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  entries<T>(prefix?: string): Promise<{ key: string; value: T }[]>;
  clear(): Promise<void>;
  name: string;
}

export class MemoryStore implements KeyValueStore {
  name = "memory";
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async entries<T>(prefix = ""): Promise<{ key: string; value: T }[]> {
    return [...this.data.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, value]) => ({ key, value: value as T }));
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}
