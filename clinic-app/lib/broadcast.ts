import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { getDoctorConfirmedAppointments } from "@/lib/appointments";
import { getNumberSetting, getSetting } from "@/lib/settings";
import { logMessage } from "@/lib/whatsapp/log";
import { sendWhatsAppText } from "@/lib/whatsapp/send";
import { applyClinicNamePlaceholder } from "@/lib/whatsapp/localize";

/**
 * Default fan-out for the send loop below — see the
 * BROADCAST_SEND_CONCURRENCY setting (CONFIGURATION.md) for why this
 * exists at all: with a large confirmed-appointment list, sending fully
 * sequentially (one HTTP call + one log write per recipient) can
 * comfortably exceed the request lifetime of whichever caller invoked
 * this (the WhatsApp webhook route or the admin broadcast server
 * action), especially on platforms/plans with a short default function
 * timeout. Batching sends in parallel groups cuts wall-clock roughly by
 * this factor without changing the per-recipient try/catch/log
 * behavior — a failed send still only fails that one recipient.
 */
const DEFAULT_SEND_CONCURRENCY = 5;

/**
 * Bulk doctor-portal broadcast: one message to every patient with a
 * Confirmed appointment for a given doctor on a given date (e.g. "running
 * 30 min late today"). Reachable both from the WhatsApp Doctor Portal
 * conversation flow (lib/whatsapp/doctorFlow.ts) and the admin/receptionist
 * web UI (app/admin/(dashboard)/appointments/actions.ts) — kept here,
 * self-contained, so neither caller needs to duplicate the send/log loop.
 *
 * Deliberately NOT running the message through localizeWhatsAppReply
 * (lib/whatsapp/localize.ts) the way lib/reminders.ts does for its own
 * fixed English template strings: that function's non-English path does
 * dictionary substring substitution keyed on ~600 known English UI
 * phrases (things like "Cancel", "Today", even " of "), which is safe
 * for this codebase's own fixed messages but would silently mangle a
 * doctor/admin's arbitrary free-typed broadcast text wherever it
 * happens to contain one of those substrings — with no way to detect or
 * preview the corruption before it's sent. There's also no real
 * translation available for free text the dictionary was never built to
 * cover, so this only applies the {{CLINIC_NAME}} placeholder
 * substitution every outbound message gets, and sends the identical
 * text to every recipient regardless of their saved language.
 */

export interface BroadcastResult {
  recipientCount: number;
  sent: number;
  errors: number;
}

/**
 * Pulled out as its own pure function so the dedup-by-phone behavior is
 * unit-testable without a live Supabase client — sendDoctorBroadcast
 * itself is orchestration code (Supabase reads/writes + WhatsApp sends)
 * that this codebase's convention is not to unit test (see
 * lib/whatsapp/doctorFlow.ts and lib/whatsapp/patientFlow.ts, both of
 * which have zero test files for the same reason).
 */
export function dedupePatientPhones(appointments: Array<{ patient_phone: string }>): string[] {
  return Array.from(new Set(appointments.map((appointment) => appointment.patient_phone)));
}

/**
 * Sends `message` to every unique patient phone number with a Confirmed
 * appointment for `doctorId` on `dateString` (YYYY-MM-DD). A patient with
 * more than one appointment that day is only messaged once.
 *
 * `timezone` isn't used for any date math here — the caller (WhatsApp
 * doctor-portal flow or the admin filter form) already resolved
 * `dateString` against the clinic's timezone before calling in — it's
 * accepted anyway to keep this function's signature consistent with the
 * rest of the codebase's send-loop helpers (e.g. sendAppointmentReminders),
 * all of which take a timezone, and so a future caller that needs to
 * derive `dateString` itself (e.g. "today" as of send time) doesn't
 * require a signature change.
 */
export async function sendDoctorBroadcast(
  supabase: SupabaseClient<Database>,
  doctorId: string,
  dateString: string,
  message: string,
  timezone: string
): Promise<BroadcastResult> {
  void timezone;

  const clinicName = await getSetting(supabase, "CLINIC_NAME", "ABC Clinic");
  const outboundMessage = applyClinicNamePlaceholder(message, clinicName);

  const appointments = await getDoctorConfirmedAppointments(supabase, doctorId, {
    fromDate: dateString,
    toDate: dateString
  });

  const uniquePhones = dedupePatientPhones(appointments);

  const result: BroadcastResult = {
    recipientCount: uniquePhones.length,
    sent: 0,
    errors: 0
  };

  const concurrency = Math.max(
    1,
    Math.trunc(await getNumberSetting(supabase, "BROADCAST_SEND_CONCURRENCY", DEFAULT_SEND_CONCURRENCY))
  );

  for (let i = 0; i < uniquePhones.length; i += concurrency) {
    const batch = uniquePhones.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async (phone) => {
        try {
          await sendWhatsAppText(phone, outboundMessage);

          await logMessage(supabase, {
            direction: "BROADCAST",
            phone,
            status: "SUCCESS",
            message: outboundMessage
          });

          result.sent++;
        } catch (sendError) {
          await logMessage(supabase, {
            direction: "BROADCAST",
            phone,
            status: `ERROR: ${sendError instanceof Error ? sendError.message : String(sendError)}`,
            message: outboundMessage
          });

          result.errors++;
          console.error(`Broadcast send failed for ${phone}:`, sendError);
        }
      })
    );
  }

  return result;
}
