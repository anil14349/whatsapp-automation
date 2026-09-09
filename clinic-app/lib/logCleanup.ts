import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getNumberSetting, getSetting } from "@/lib/settings";

/**
 * message_log retention cleanup. Ports src/Logging.gs's
 * cleanupLogSheet — age-based deletion first, then a row-count cap on
 * whatever survives. REMINDER rows are exempt from both (they're the
 * reminder scheduler's own dedup ledger, not routine chat log volume —
 * see lib/whatsapp/log.ts's doc comment), same as the original.
 */

const LOG_RETENTION_DAYS: Record<string, number> = {
  week: 7,
  month: 30,
  quarter: 90,
  quarterly: 90,
  halfyear: 182,
  halfyearly: 182,
  year: 365,
  yearly: 365,
  none: 0,
  forever: 0
};

function normalizeRetentionKey(value: string): string {
  const key = value.trim().toLowerCase().replace(/[\s_-]+/g, "");
  return key in LOG_RETENTION_DAYS ? key : "month";
}

export interface LogCleanupResult {
  retentionKey: string;
  retentionDays: number;
  maxRows: number;
  deletedByAge: number;
  deletedByCap: number;
}

export async function cleanupMessageLog(
  supabase: SupabaseClient<Database>
): Promise<LogCleanupResult> {
  const [retentionRaw, maxRowsRaw] = await Promise.all([
    getSetting(supabase, "LOG_RETENTION", "month"),
    getNumberSetting(supabase, "LOG_MAX_ROWS", 5000)
  ]);

  const retentionKey = normalizeRetentionKey(retentionRaw);
  const retentionDays = LOG_RETENTION_DAYS[retentionKey]!;
  const maxRows = maxRowsRaw > 0 ? maxRowsRaw : 5000;

  let deletedByAge = 0;

  if (retentionDays > 0) {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: deletedRows, error } = await supabase
      .from("message_log")
      .delete()
      .neq("direction", "REMINDER")
      .lt("logged_at", cutoff)
      .select("id");

    if (error) {
      throw new Error(`Failed to delete aged-out message_log rows: ${error.message}`);
    }

    deletedByAge = deletedRows.length;
  }

  const { count: survivingCount, error: countError } = await supabase
    .from("message_log")
    .select("id", { count: "exact", head: true })
    .neq("direction", "REMINDER");

  if (countError) {
    throw new Error(`Failed to count message_log rows: ${countError.message}`);
  }

  let deletedByCap = 0;
  const excess = (survivingCount ?? 0) - maxRows;

  if (excess > 0) {
    const { data: oldestRows, error: selectError } = await supabase
      .from("message_log")
      .select("id")
      .neq("direction", "REMINDER")
      .order("logged_at", { ascending: true })
      .limit(excess);

    if (selectError) {
      throw new Error(`Failed to find oldest message_log rows: ${selectError.message}`);
    }

    if (oldestRows.length > 0) {
      const { error: deleteError } = await supabase
        .from("message_log")
        .delete()
        .in(
          "id",
          oldestRows.map((row) => row.id)
        );

      if (deleteError) {
        throw new Error(`Failed to delete excess message_log rows: ${deleteError.message}`);
      }

      deletedByCap = oldestRows.length;
    }
  }

  return { retentionKey, retentionDays, maxRows, deletedByAge, deletedByCap };
}
