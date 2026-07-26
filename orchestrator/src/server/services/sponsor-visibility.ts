import { getSetting } from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";

export async function resolveShowSponsorInfo(): Promise<boolean> {
  try {
    const stored = await getSetting("showSponsorInfo");
    if (stored == null) return settingsRegistry.showSponsorInfo.default();
    return settingsRegistry.showSponsorInfo.parse(stored) ?? false;
  } catch {
    return false;
  }
}
