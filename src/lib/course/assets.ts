/** 课程图片的本地路径 → 上游课程仓库 raw 地址。 */
const UPSTREAM_RAW = "https://raw.githubusercontent.com/didilili/ai-agents-from-zero/main/";
const LOCAL_PREFIX = "/course-assets/";

export function upstreamImageUrl(src: string | null | undefined): string | null {
  if (!src || !src.startsWith(LOCAL_PREFIX)) return null;
  return UPSTREAM_RAW + src.slice(LOCAL_PREFIX.length);
}

export const COURSE_ASSET_PREFIX = LOCAL_PREFIX;
