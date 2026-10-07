/**
 * 调度循环（方案 A）：一轮结束 → setTimeout 下一枪；inFlight 防重叠。
 * 启停不得抹掉已有 last_round。
 */
import { appLogger } from "@new-api-key-usage/core";
import { syncRound, type SyncRoundDeps } from "./sync-round.ts";

const log = appLogger("engine");

export interface LoopOptions extends SyncRoundDeps {
  intervalMs: number;
}

export function createSyncLoop(opts: LoopOptions) {
  let inFlight = false;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last_round: unknown = null;

  async function persist(running: boolean) {
    await opts.repos.engine.upsertSnapshot({
      running,
      sync_interval_ms: opts.intervalMs,
      last_round,
    });
  }

  async function runOnce(): Promise<void> {
    if (stopped) return;
    if (inFlight) {
      log.warn("上一轮尚未结束，跳过本枪");
      schedule();
      return;
    }
    inFlight = true;
    try {
      last_round = await syncRound(opts);
      await persist(!stopped);
    } catch (e) {
      log.error(`同步轮次异常：${e}`);
      await persist(!stopped).catch(() => {});
    } finally {
      inFlight = false;
      schedule();
    }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(() => {
      void runOnce();
    }, opts.intervalMs);
  }

  return {
    start() {
      log.info(`同步引擎启动：周期=${opts.intervalMs}ms`);
      void (async () => {
        const snap = await opts.repos.engine.getSnapshot();
        last_round = snap?.last_round ?? null;
        await persist(true).catch(() => {});
        void runOnce();
      })();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      // 等在跑的一轮结束，避免 stop 与 upsert 交错
      for (let i = 0; i < 50 && inFlight; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      await persist(false).catch(() => {});
    },
  };
}
