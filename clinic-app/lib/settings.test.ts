import { describe, expect, it } from "vitest";
import { DORMANT_SETTING_KEYS } from "./settings";

describe("DORMANT_SETTING_KEYS", () => {
  it("is empty — every settings-table key seeded so far has real code behind it", () => {
    // Regression guard for the specific keys that took the longest to
    // get wired up (log retention/truncation was the last holdout —
    // see lib/logCleanup.ts, lib/whatsapp/log.ts). If a future setting
    // gets added ahead of its feature, add it here *and* to the Set in
    // lib/settings.ts in the same change — this test intentionally
    // fails loudly on an empty-Set assumption breaking, rather than
    // silently accepting a new dormant key with no corresponding test
    // update.
    expect(DORMANT_SETTING_KEYS.size).toBe(0);
    expect(DORMANT_SETTING_KEYS.has("LOG_RETENTION")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("LOG_MAX_ROWS")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("LOG_MESSAGE_MAX_CHARS")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("ENABLE_INBOUND_LOG")).toBe(false);
    expect(DORMANT_SETTING_KEYS.has("ENABLE_DEBUG_LOG")).toBe(false);
  });
});
