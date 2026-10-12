/**
 * 兼容入口：等价于 `naku pack --yes --target=bun-linux-x64`。
 * 交互请用 `bun run naku pack`。
 */
import { packRelease } from "./pack-core.ts";

function readTarget(): string {
  const arg = process.argv.find((a) => a.startsWith("--target="));
  return arg?.slice("--target=".length) || process.env.PACK_TARGET || "bun-linux-x64";
}

const target = readTarget();
console.log(`[pack-release] non-interactive pack (target=${target})`);

try {
  const out = await packRelease({
    target,
    only: ["dist", "naku-server", "naku-engine", "naku-migrate", "drizzle"],
    outDir: "release",
    tarball: false,
    onLog: (m) => console.log("[pack-release]", m),
  });
  console.log("[pack-release] done →", out);
} catch (err) {
  console.error("[pack-release]", err instanceof Error ? err.message : err);
  process.exit(1);
}
