/**
 * 同步轮次：按《同步引擎设计》§3 编排。
 * 只经 packages/core（上游 + 去重）与 packages/db（仓储）写库。
 */
import {
  appLogger,
  buildDedupeKey,
  createUpstreamClient,
  KeyCrypto,
  parseOtherJson,
  toUnixSec,
} from "@new-api-key-usage/core";
import type { Repos } from "@new-api-key-usage/db";

const log = appLogger("engine");

export interface SyncRoundDeps {
  repos: Repos;
  newapiBase: string;
  skKeyEncryptionSecret: string;
}

export interface LastRound {
  started_at: number;
  keys_total: number;
  succeeded: number;
  failed: number;
  failed_api_key_ids: number[];
}

function parseOther(other: string | undefined): {
  billing_source: string | null;
  subscription_id: number | null;
  raw: Record<string, unknown> | null;
} {
  return parseOtherJson(other);
}

export async function syncRound(deps: SyncRoundDeps): Promise<LastRound> {
  const started = Date.now();
  const started_at = toUnixSec(new Date())!;
  const client = createUpstreamClient({ baseUrl: deps.newapiBase });
  const crypto = await KeyCrypto.fromEncryptionSecret(
    deps.skKeyEncryptionSecret,
  );

  const keys = await deps.repos.keys.listActive();
  const failed_api_key_ids: number[] = [];
  let succeeded = 0;
  let pulled = 0;
  let inserted = 0;
  let skipped = 0;

  for (const key of keys) {
    try {
      const sk = await crypto.openKey(key.key_ciphertext);

      const usage = await client.fetchTokenUsage(sk);
      if (!usage.ok) {
        failed_api_key_ids.push(key.id);
        log.warn(`同步失败 key_id=${key.id} 原因=usage/${usage.kind}`);
        continue;
      }
      await deps.repos.keys.update(key.id, {
        token_name: usage.data.name ?? key.token_name,
        total_granted: usage.data.total_granted,
        total_used: usage.data.total_used,
        total_available: usage.data.total_available,
        unlimited_quota: usage.data.unlimited_quota,
        model_limits: usage.data.model_limits,
        model_limits_enabled: usage.data.model_limits_enabled,
        expires_at: normalizeExpires(usage.data.expires_at),
        usage_synced_at: new Date(),
      });

      const logs = await client.fetchTokenLogs(sk);
      if (!logs.ok) {
        failed_api_key_ids.push(key.id);
        log.warn(`同步失败 key_id=${key.id} 原因=logs/${logs.kind}`);
        continue;
      }

      const rows = [...(logs.data ?? [])].sort((a, b) => {
        const ta = a.created_at ?? 0;
        const tb = b.created_at ?? 0;
        if (ta !== tb) return ta - tb;
        return String(a.request_id ?? "").localeCompare(String(b.request_id ?? ""));
      });
      pulled += rows.length;

      for (const row of rows) {
        const other = parseOther(row.other);
        const created_at = new Date(row.created_at * 1000);
        const dedupe_key = await buildDedupeKey({
          api_key_id: key.id,
          request_id: row.request_id,
          type: row.type ?? 2,
          created_at: row.created_at,
          model_name: row.model_name ?? "",
          quota: row.quota ?? 0,
          prompt_tokens: row.prompt_tokens ?? 0,
          completion_tokens: row.completion_tokens ?? 0,
          use_time: row.use_time ?? 0,
          content: row.content ?? "",
        });
        const ok = await deps.repos.keys.insertLog({
          api_key_id: key.id,
          dedupe_key,
          billing_source: other.billing_source,
          subscription_id: other.subscription_id,
          user_id: row.user_id ?? 0,
          created_at,
          type: row.type ?? 2,
          content: row.content ?? "",
          username: row.username ?? "",
          token_name: row.token_name ?? "",
          model_name: row.model_name ?? "",
          quota: row.quota ?? 0,
          prompt_tokens: row.prompt_tokens ?? 0,
          completion_tokens: row.completion_tokens ?? 0,
          use_time: row.use_time ?? 0,
          is_stream: !!row.is_stream,
          channel: row.channel ?? 0,
          channel_name: row.channel_name ?? "",
          token_id: row.token_id ?? 0,
          group_name: row.group ?? "",
          ip: row.ip ?? "",
          request_id: row.request_id ?? "",
          upstream_request_id: row.upstream_request_id ?? null,
          other: other.raw,
        });
        if (ok) inserted += 1;
        else skipped += 1;
      }
      await deps.repos.keys.update(key.id, { log_synced_at: new Date() });
      succeeded += 1;
    } catch (e) {
      failed_api_key_ids.push(key.id);
      log.error(`同步异常 key_id=${key.id} ${e}`);
    }
  }

  // QPU 采样：值变化才追加
  const qpuRes = await client.fetchQuotaPerUnit();
  if (qpuRes.ok) {
    const latest = await deps.repos.qpu.latest();
    const next = qpuRes.data.quota_per_unit;
    if (!latest || latest.qpu !== next) {
      await deps.repos.qpu.insertChange(next, new Date());
      log.info(`QPU 变更 ${latest?.qpu ?? "-"} -> ${next}`);
    }
  } else {
    log.warn(`QPU 采样失败 ${qpuRes.kind}`);
  }

  const last_round: LastRound = {
    started_at,
    keys_total: keys.length,
    succeeded,
    failed: failed_api_key_ids.length,
    failed_api_key_ids,
  };

  log.info(
    `同步轮次完成 key=${keys.length} 成功=${succeeded} 失败=${failed_api_key_ids.length} 拉取=${pulled} 新写=${inserted} 去重跳过=${skipped} 耗时=${Date.now() - started}ms`,
  );

  return last_round;
}

function normalizeExpires(unixSeconds: number | undefined | null): Date | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}
