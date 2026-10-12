/**
 * 打包核心：供 CLI / 脚本共用，不带交互。
 * 产物：dist/ · naku-server · naku-engine · naku-migrate · drizzle/
 */
import { cp, mkdir, rm, stat, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const PACK_ITEMS = [
  "dist",
  "naku-server",
  "naku-engine",
  "naku-migrate",
  "drizzle",
] as const;
export type PackItem = (typeof PACK_ITEMS)[number];

export const PACK_TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-darwin-arm64",
  "bun-darwin-x64",
  "bun-windows-x64",
  "bun-windows-arm64",
] as const;

export function currentPlatformTarget(): string {
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  if (process.platform === "win32") return `bun-windows-${arch}`;
  if (process.platform === "darwin") return `bun-darwin-${arch}`;
  return `bun-linux-${arch}`;
}

export interface PackOptions {
  target: string;
  only: PackItem[];
  outDir: string;
  tarball?: boolean;
  root?: string;
  /** true：前端放到 <out>/dist/（部署包）；false：直接铺在 <out>/（本地 dist） */
  nestDist?: boolean;
  onLog?: (msg: string) => void;
}

function fail(msg: string): never {
  throw new Error(msg);
}

async function mustExist(path: string, label: string): Promise<void> {
  if (!existsSync(path)) fail(`missing ${label}: ${path}`);
}

async function nonEmptyDir(path: string, label: string): Promise<void> {
  const entries = await readdir(path);
  if (entries.length === 0) fail(`empty ${label}: ${path}`);
}

async function run(cmd: string[], cwd: string, onLog?: (m: string) => void) {
  onLog?.(`$ ${cmd.join(" ")}`);
  const proc = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) fail(`command failed (${code}): ${cmd.join(" ")}`);
}

export async function packRelease(opts: PackOptions): Promise<string> {
  const root = opts.root ?? resolve(import.meta.dir, "..");
  const releaseDir = resolve(root, opts.outDir);
  const log = opts.onLog ?? (() => {});
  const only = new Set(opts.only);
  const needBin = (name: PackItem) => only.has(name);

  log(`target=${opts.target}`);
  log(`out=${releaseDir}`);

  // 输出目录：只删本次会写入的条目，避免误删未选产物的旧文件？——部署包语义为整包覆盖，仍清空
  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  if (needBin("dist")) {
    log("build web…");
    await run(["bun", "run", "build:web"], root, log);
    const webDist = join(root, "apps", "web", "dist");
    await mustExist(webDist, "web dist");
    const dest = opts.nestDist === false ? releaseDir : join(releaseDir, "dist");
    await cp(webDist, dest, { recursive: true });
  }

  const compileOne = async (entry: string, name: PackItem) => {
    if (!needBin(name)) return;
    log(`compile ${name}…`);
    await run(
      [
        "bun",
        "build",
        "--compile",
        `--target=${opts.target}`,
        `--outfile=${join(releaseDir, name)}`,
        entry,
      ],
      root,
      log,
    );
  };
  await compileOne("apps/server/src/index.ts", "naku-server");
  await compileOne("apps/engine/src/index.ts", "naku-engine");
  await compileOne("packages/db/src/migrate-cli.ts", "naku-migrate");

  if (needBin("drizzle")) {
    const drizzleSrc = join(root, "packages", "db", "drizzle");
    await mustExist(drizzleSrc, "drizzle folder");
    await cp(drizzleSrc, join(releaseDir, "drizzle"), { recursive: true });
  }

  for (const item of opts.only) {
    if (item === "dist" && opts.nestDist === false) {
      // web 铺在 outDir 根：检查 outDir 非空即可
      await nonEmptyDir(releaseDir, "outDir");
      continue;
    }
    // Windows 本机编译可能带 .exe
    const candidates = [
      join(releaseDir, item),
      join(releaseDir, `${item}.exe`),
    ];
    const found = candidates.find((c) => existsSync(c));
    if (!found) fail(`missing ${item}: ${candidates[0]}`);
    if (item === "dist" || item === "drizzle") {
      await nonEmptyDir(found, `release/${item}`);
    } else {
      const s = await stat(found);
      if (s.size <= 0) fail(`empty file: ${item}`);
    }
  }

  if (opts.tarball) {
    const date = new Date();
    const ymd = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const tarName = `naku-release-${ymd}.tar.gz`;
    const tarPath = join(root, tarName);
    log(`tar ${tarName}…`);
    // 在 outDir 的父目录打包，使 tar 内为 release/ 根
    const parent = resolve(releaseDir, "..");
    const folderName = releaseDir.split(/[\\/]/).pop() ?? "release";
    await run(
      ["tar", "-czf", tarPath, "-C", parent, folderName],
      root,
      log,
    );
    log(`tarball → ${tarPath}`);
  }

  return releaseDir;
}
