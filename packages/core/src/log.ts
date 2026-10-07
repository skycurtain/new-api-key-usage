/**
 * 业务日志（@logtape/logtape）——零依赖、Bun/edge 可跑。
 * 访问日志另用 Hono `logger` 中间件；本模块只记启动、错误、引擎等业务事件。
 */
import {
  configureSync,
  getConsoleSink,
  getLogger,
  type Logger,
  type LogLevel,
} from "@logtape/logtape";

export type AppLogLevel = Exclude<LogLevel, "trace">;

/** 防止密钥类串进日志正文（sk-key / Bearer / 机密 env） */
export function redactSecrets(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, "sk-***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .replace(
      /SK_KEY_ENCRYPTION_SECRET[=:]\s*\S+/gi,
      "SK_KEY_ENCRYPTION_SECRET=***",
    );
}

/** 日志时间戳：本地时区、可读（终端运维友好） */
export function formatLogTime(d: Date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const off = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `.${pad(d.getMilliseconds(), 3)}${off}`
  );
}

let configured = false;

/**
 * 进程内只允许配置一次（热更新时模块可能被重复求值）。
 * 使用 configureSync，避免 configure() 异步窗口内的重入锁。
 */
export function setupLogging(level: AppLogLevel = "info"): void {
  if (configured) return;
  try {
    configureSync({
      reset: true,
      sinks: {
        console: getConsoleSink({
          formatter: (record) => {
            const ts = formatLogTime(new Date(record.timestamp));
            const cat = record.category.join(".");
            const msg = redactSecrets(String(record.message));
            return `${ts} ${record.level.toUpperCase()} [${cat}] ${msg}`;
          },
        }),
      },
      // app 日志；meta 单独压到 warning，避免每次启动的配置提示
      loggers: [
        { category: ["naku"], lowestLevel: level, sinks: ["console"] },
        {
          category: ["logtape", "meta"],
          lowestLevel: "warning",
          sinks: ["console"],
        },
      ],
    });
    configured = true;
  } catch {
    // 并发/热更新竞态：已有配置在跑则忽略，绝不打崩业务进程
    configured = true;
  }
}

export function appLogger(...category: string[]): Logger {
  if (!configured) setupLogging("info");
  return getLogger(["naku", ...category]);
}
