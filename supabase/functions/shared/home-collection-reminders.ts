/**
 * Home Collection Reminder Service
 * 
 * Manages reminders for home blood collection requests.
 * Similar to appointment reminders but simpler: single reminder on collection day.
 * 
 * Reminder Timeline:
 * - Created when home collection request is confirmed
 * - Scheduled for collection_date at 08:00 AM
 * - Reminder sent once per request (unlike appointments which have 24h and 1h)
 * - Reminder cancelled if request is REJECTED or COMPLETED
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { debug } from "./logger.ts";
import * as types from "./types.ts";

export interface HomeCollectionReminderMessage {
  requestId: string;
  clinicName: string;
  collectionDate: string;
  language: string; // "EN" or "HI"
}

/**
 * Format reminder message for home collection
 * 
 * EN: "Hi [Name], our blood collection team will visit you on [Date]. 
 *     Please keep a light breakfast, arrange a comfortable space, and keep your phone ready. 
 *     For changes, reply to this message. - [Clinic Name]"
 * 
 * HI: "नमस्ते [नाम], हमारी रक्त संग्रह टीम [तारीख] को आपसे मिलने आएगी। 
 *     हल्का नाश्ता रखें, आरामदायक जगह तैयार करें, और अपने फोन को तैयार रखें। 
 *     बदलाव के लिए इस संदेश का जवाब दें। - [क्लिनिक नाम]"
 */
export function formatHomeCollectionReminderMessage(content: HomeCollectionReminderMessage): string {
  const { requestId, clinicName, collectionDate, language } = content;

  if (language === "HI") {
    return `🩸 रक्त संग्रह रिमाइंडर\n\n` +
           `नमस्ते! हमारी स्वास्थ्य टीम ${collectionDate} को आपके घर से रक्त संग्रह के लिए आएगी।\n\n` +
           `📋 अनुरोध ID: ${requestId}\n` +
           `🏥 क्लिनिक: ${clinicName}\n\n` +
           `💡 कृपया याद रखें:\n` +
           `• हल्का नाश्ता करें\n` +
           `• आरामदायक पोशाक पहनें\n` +
           `• फोन पास रखें\n\n` +
           `बदलाव के लिए इसका जवाब दें।`;
  }

  // Default: English
  return `🩸 Blood Collection Reminder\n\n` +
         `Hi! Our health team will visit you on ${collectionDate} for blood collection.\n\n` +
         `📋 Request ID: ${requestId}\n` +
         `🏥 Clinic: ${clinicName}\n\n` +
         `💡 Please remember:\n` +
         `• Eat a light breakfast\n` +
         `• Wear comfortable clothes\n` +
         `• Keep your phone nearby\n\n` +
         `Reply to this message if you need to reschedule.`;
}

/**
 * Create home collection reminder
 * 
 * Called when home collection request is confirmed.
 * Creates single PENDING reminder for collection_date at 08:00 AM.
 * 
 * Idempotent via UNIQUE(request_id) constraint - multiple calls won't create duplicates
 */
export async function createHomeCollectionReminder(
  supabase: SupabaseClient,
  clinicId: string,
  requestId: string,
  collectionDate: string,
  patientPhone: string,
  preferredLanguage?: string
): Promise<types.HomeCollectionReminder | null> {
  try {
    debug("homeCollectionReminder", "Creating reminder", { requestId, collectionDate });

    // Calculate scheduled time (collection_date at 08:00 AM)
    const scheduledTime = new Date(`${collectionDate}T08:00:00Z`).toISOString();

    const { data, error } = await supabase
      .from("home_collection_reminders")
      .insert({
        clinic_id: clinicId,
        request_id: requestId,
        patient_phone: patientPhone,
        scheduled_time: scheduledTime,
        status: "PENDING",
        preferred_language: preferredLanguage || "EN",
        attempts: 0,
        max_attempts: 3,
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) {
      // If UNIQUE constraint violation, return null (reminder already exists)
      if (error.code === "23505") {
        debug("homeCollectionReminder", "Reminder already exists (idempotent)", { requestId });
        return null;
      }

      throw error;
    }

    debug("homeCollectionReminder", "Reminder created successfully", { reminderId: data.id });
    return data;
  } catch (error) {
    debug("homeCollectionReminder", "Error creating reminder", {
      error: error instanceof Error ? error.message : String(error),
      requestId
    });
    throw error;
  }
}

/**
 * Get pending reminders ready to send
 * 
 * Returns reminders with:
 * - status = PENDING
 * - scheduled_time <= NOW
 * - attempts < max_attempts
 * 
 * Ordered by scheduled_time (oldest first)
 */
export async function getPendingHomeCollectionReminders(
  supabase: SupabaseClient,
  clinicId: string
): Promise<types.HomeCollectionReminder[]> {
  try {
    const { data, error } = await supabase
      .from("home_collection_reminders")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("status", "PENDING")
      .lt("scheduled_time", new Date().toISOString())
      .lt("attempts", "max_attempts")
      .order("scheduled_time", { ascending: true });

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    debug("homeCollectionReminder", "Error fetching pending reminders", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Get home collection request details for reminder
 */
export async function getHomeCollectionDetailsForReminder(
  supabase: SupabaseClient,
  requestId: string
): Promise<{
  requestId: string;
  patientPhone: string;
  collectionDate: string;
  clinicName: string;
  preferredLanguage: string;
} | null> {
  try {
    const { data, error } = await supabase
      .from("home_collection_requests")
      .select("request_id, phone, appointment_date, clinic:clinics(name)")
      .eq("request_id", requestId)
      .single();

    if (error || !data) {
      debug("homeCollectionReminder", "Request not found", { requestId });
      return null;
    }

    // PostgREST returns an object for a to-one embed.
    const row = data as unknown as {
      request_id: string;
      phone: string;
      appointment_date: string | null;
      clinic: { name: string } | null;
    };

    return {
      requestId: row.request_id,
      patientPhone: row.phone,
      collectionDate: row.appointment_date || new Date().toISOString().split("T")[0],
      clinicName: row.clinic?.name || "Clinic",
      preferredLanguage: "EN" // Default to EN, can be extended to fetch from patient record
    };
  } catch (error) {
    debug("homeCollectionReminder", "Error fetching request details", {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Mark reminder as sent
 */
export async function markHomeCollectionReminderAsSent(
  supabase: SupabaseClient,
  reminderId: string,
  messageId: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("home_collection_reminders")
      .update({
        status: "SENT",
        message_id: messageId,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", reminderId);

    if (error) {
      throw error;
    }

    debug("homeCollectionReminder", "Reminder marked as SENT", { reminderId, messageId });
  } catch (error) {
    debug("homeCollectionReminder", "Error marking reminder as sent", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Mark reminder as failed with retry logic
 */
export async function markHomeCollectionReminderAsFailed(
  supabase: SupabaseClient,
  reminderId: string,
  errorMessage: string
): Promise<{ shouldRetry: boolean }> {
  try {
    // Fetch current attempt count
    const { data: reminder, error: fetchError } = await supabase
      .from("home_collection_reminders")
      .select("attempts, max_attempts")
      .eq("id", reminderId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    const attempts = (reminder?.attempts || 0) + 1;
    const maxAttempts = reminder?.max_attempts || 3;
    const shouldRetry = attempts < maxAttempts;

    const { error: updateError } = await supabase
      .from("home_collection_reminders")
      .update({
        attempts,
        status: shouldRetry ? "PENDING" : "FAILED",
        error_message: errorMessage,
        updated_at: new Date().toISOString()
      })
      .eq("id", reminderId);

    if (updateError) {
      throw updateError;
    }

    debug("homeCollectionReminder", "Reminder marked as FAILED", {
      reminderId,
      attempts,
      shouldRetry
    });

    return { shouldRetry };
  } catch (error) {
    debug("homeCollectionReminder", "Error marking reminder as failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

/**
 * Mark reminders as skipped (when request is cancelled/rejected)
 */
export async function markHomeCollectionRemindersAsSkipped(
  supabase: SupabaseClient,
  requestId: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("home_collection_reminders")
      .update({
        status: "SKIPPED",
        updated_at: new Date().toISOString()
      })
      .eq("request_id", requestId)
      .neq("status", "SENT");

    if (error) {
      throw error;
    }

    debug("homeCollectionReminder", "Reminders marked as SKIPPED", { requestId });
  } catch (error) {
    debug("homeCollectionReminder", "Error marking reminders as skipped", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
