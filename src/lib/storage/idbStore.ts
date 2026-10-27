import { openDB, type IDBPDatabase } from "idb";
import { MemoryStore, type KeyValueStore } from "./memoryStore";

const DB_NAME = "ai-xingtu";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBPDatabase> | null = null;

function open() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          database.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export class IndexedDbStore implements KeyValueStore {
  name = "indexeddb";

  async get<T>(key: string): Promise<T | undefined> {
    return (await (await open()).get(STORE, key)) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await (await open()).put(STORE, value, key);
  }

  async delete(key: string): Promise<void> {
    await (await open()).delete(STORE, key);
  }

  async entries<T>(prefix = ""): Promise<{ key: string; value: T }[]> {
    const database = await open();
    const keys: IDBValidKey[] = await database.getAllKeys(STORE);
    const matched = keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
    const values = await Promise.all(matched.map((key) => database.get(STORE, key)));
    return matched.map((key, index) => ({ key, value: values[index] as T }));
  }

  async clear(): Promise<void> {
    await (await open()).clear(STORE);
  }
}

export function createStore(): KeyValueStore {
  if (typeof indexedDB === "undefined") {
    // 非浏览器环境（测试 / SSR）退回内存存储
    return new MemoryStore();
  }
  return new IndexedDbStore();
}
