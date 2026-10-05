/**
 * usage_logs.dedupe_key 生成（usage_logs表字段设计 §3.1）
 * 消费行 type=2： `${api_key_id}:${request_id}`
 * 非消费行：      `${api_key_id}:${request_id}:${sha256指纹}`
 * request_id 空：退化为纯内容指纹
 */

export interface DedupeInput {
  api_key_id: number;
  request_id: string | null | undefined;
  type: number;
  created_at: string | number | Date;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  content: string;
}

const LOG_TYPE_CONSUME = 2;

function toUnix(created_at: string | number | Date): number {
  if (typeof created_at === "number") return created_at;
  if (created_at instanceof Date)
    return Math.floor(created_at.getTime() / 1000);
  return Math.floor(new Date(created_at).getTime() / 1000);
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 内容指纹（错误行含 content；空 request_id 的消费行不含 content） */
export async function contentFingerprint(row: DedupeInput): Promise<string> {
  const parts = [
    String(row.api_key_id),
    String(toUnix(row.created_at)),
    String(row.type),
    row.model_name,
    String(row.quota),
    String(row.prompt_tokens),
    String(row.completion_tokens),
    String(row.use_time),
  ];
  if (row.type !== LOG_TYPE_CONSUME || !row.request_id) {
    parts.push(row.content);
  }
  return sha256Hex(parts.join("\n"));
}

export async function buildDedupeKey(row: DedupeInput): Promise<string> {
  const rid = row.request_id?.trim() ?? "";
  if (row.type === LOG_TYPE_CONSUME && rid) {
    return `${row.api_key_id}:${rid}`;
  }
  const fp = await contentFingerprint(row);
  return rid ? `${row.api_key_id}:${rid}:${fp}` : `${row.api_key_id}:${fp}`;
}
