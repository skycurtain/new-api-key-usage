/**
 * pack 打包/构建 CLI：citty 定义命令，@clack/prompts 负责交互。
 * 有 TTY 且未给全 flag 时进交互；--yes / 无 TTY 则纯 flag。
 */
import { defineCommand, runMain } from "citty";
import * as p from "@clack/prompts";
import {
  PACK_ITEMS,
  PACK_TARGETS,
  currentPlatformTarget,
  packRelease,
  type PackItem,
} from "./pack-core.ts";

function isInteractive(yes: boolean | undefined): boolean {
  if (yes) return false;
  return Boolean(process.stdin.isTTY);
}

function cancel(): never {
  p.cancel("Operation cancelled");
  process.exit(0);
}

function assertNotCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) cancel();
  return value as T;
}

const targetOption = {
  target: {
    type: "string",
    description: `编译目标，如 ${PACK_TARGETS[0]}；默认交互选择或 ${PACK_TARGETS[0]}`,
  },
} as const;

const release = defineCommand({
  meta: {
    name: "release",
    description: "打部署产物包（dist + 单文件 + drizzle）",
  },
  args: {
    ...targetOption,
    only: {
      type: "string",
      description: `产物范围，逗号分隔；可选 ${PACK_ITEMS.join("|")}`,
    },
    out: {
      type: "string",
      default: "release",
      description: "输出目录",
    },
    tarball: {
      type: "boolean",
      description: "额外打 tar.gz（默认交互询问，否则否）",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "全部默认，不进交互",
    },
  },
  async run({ args }) {
    const interactive = isInteractive(args.yes as boolean | undefined);
    p.intro("PACK 打包");

    // --- target ---
    let target = args.target as string | undefined;
    if (!target) {
      if (interactive) {
        const picked = assertNotCancel(
          await p.select({
            message: "目标平台",
            options: (() => {
              const current = currentPlatformTarget();
              const base = PACK_TARGETS.map((t) => ({
                label: t === "bun-linux-x64" ? `${t}（服务器常用）` : t,
                value: t,
              }));
              // 当前平台已在列表中则不再追加，避免重复
              return PACK_TARGETS.includes(current as (typeof PACK_TARGETS)[number])
                ? base
                : [
                    ...base,
                    {
                      label: `${current}（当前平台，仅本地）`,
                      value: current,
                    },
                  ];
            })(),
            initialValue: "bun-linux-x64",
          }),
        );
        target = picked as string;
      } else {
        target = "bun-linux-x64";
      }
    }

    // --- only ---
    let only: PackItem[];
    const onlyArg = args.only as string | undefined;
    if (onlyArg) {
      only = onlyArg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean) as PackItem[];
      for (const item of only) {
        if (!PACK_ITEMS.includes(item)) {
          p.cancel(`未知产物: ${item}`);
          process.exit(1);
        }
      }
    } else if (interactive) {
      const picked = assertNotCancel(
        await p.multiselect({
          message: "打包内容",
          options: PACK_ITEMS.map((item) => ({ label: item, value: item })),
          initialValues: [...PACK_ITEMS],
          required: true,
        }),
      );
      only = picked as PackItem[];
    } else {
      only = [...PACK_ITEMS];
    }

    // --- out ---
    const outDir = (args.out as string) || "release";

    // --- tarball ---
    let tarball = args.tarball as boolean | undefined;
    if (tarball === undefined) {
      if (interactive) {
        tarball = assertNotCancel(
          await p.confirm({ message: "是否额外打 tar.gz？", initialValue: false }),
        ) as boolean;
      } else {
        tarball = false;
      }
    }

    const s = p.spinner();
    s.start(`编译 ${target} · ${only.join(" + ")}`);
    try {
      const out = await packRelease({
        target,
        only,
        outDir,
        tarball,
        onLog: (msg) => {
          // spinner 期间不逐条刷屏，保留关键节点可在结束后看
          if (msg.startsWith("tar ") || msg.startsWith("target=")) {
            s.message(msg);
          }
        },
      });
      s.stop(`完成 → ${out}`);
      p.outro(
        [
          `产物：${only.join(" · ")}`,
          `目标：${target}`,
          tarball ? "已附 tar.gz（仓库根目录）" : "未打 tar.gz",
          "",
          "服务器：覆盖 /opt/naku/release/ 后执行 docker compose up -d --build",
        ].join("\n"),
      );
    } catch (err) {
      s.stop("失败");
      p.cancel(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});

const build = defineCommand({
  meta: {
    name: "build",
    description: "构建产物到 bin/（当前平台，适合本地试跑）",
  },
  args: {
    item: {
      type: "positional",
      required: false,
      description: `可选：${PACK_ITEMS.join("|")}，不填则交互多选`,
    },
    ...targetOption,
    yes: {
      type: "boolean",
      alias: "y",
      description: "全部默认，不进交互",
    },
  },
  async run({ args }) {
    const interactive = isInteractive(args.yes as boolean | undefined);
    const target =
      (args.target as string | undefined) ?? currentPlatformTarget();

    let only: PackItem[];
    const positional = args.item as string | undefined;
    if (positional) {
      if (!PACK_ITEMS.includes(positional as PackItem)) {
        p.cancel(`未知产物: ${positional}`);
        process.exit(1);
      }
      only = [positional as PackItem];
    } else if (interactive) {
      p.intro("PACK 本地构建");
      only = assertNotCancel(
        await p.multiselect({
          message: "构建什么",
          options: PACK_ITEMS.map((item) => ({ label: item, value: item })),
          // 默认不选，由用户自选
          initialValues: [],
          required: true,
        }),
      ) as PackItem[];
    } else {
      only = ["naku-server", "naku-engine"];
    }

    const s = p.spinner();
    s.start(`构建 ${only.join(" + ")} → bin/`);
    try {
      await packRelease({
        target,
        only,
        outDir: "bin",
        tarball: false,
        // 前端进 bin/dist/，避免与单文件混放
        nestDist: true,
        onLog: (msg) => {
          if (msg.startsWith("compile") || msg.startsWith("build")) s.message(msg);
        },
      });
      s.stop("完成");
      p.outro(`已写入 bin/（${target}）`);
    } catch (err) {
      s.stop("失败");
      p.cancel(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  },
});

const main = defineCommand({
  meta: {
    name: "pack",
    version: "0.0.0",
    description: "PACK 打包 / 本地构建",
  },
  subCommands: { release, build },
});

runMain(main);
