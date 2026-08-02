import type { SpawnOptions } from "node:child_process";

export function getWindowsHideSpawnOptions(
  platform: NodeJS.Platform = process.platform
): Pick<SpawnOptions, "windowsHide"> {
  return platform === "win32" ? { windowsHide: true } : {};
}
