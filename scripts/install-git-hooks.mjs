import { execFileSync, spawnSync } from "node:child_process";

if (
  spawnSync("git", ["rev-parse", "--git-dir"], { stdio: "ignore" }).status === 0
) {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "inherit",
  });
}
