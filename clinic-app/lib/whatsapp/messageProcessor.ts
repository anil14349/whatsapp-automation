/**
 * WhatsApp Message Processor
 * Processes incoming messages and routes them appropriately
 */

import { createClient } from "@supabase/supabase-js";
import { WhatsAppMessage, getMessageText, normalizePhoneNumber } from "./webhook";
import { findOrCreatePatient } from "@/lib/patients";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";
import { routeAdvancedMessage } from "@/lib/whatsapp/advancedMessageHandlers";
import { MESSAGE_PATTERNS, matchesPattern } from "./messagePatterns";

export interface MessageProcessingResult {
  success: boolean;
  action: string;
  message?: string;
  error?: string;
}

// Pre-compiled advanced message patterns - created once at module load
const ADVANCED_PATTERNS = [
  MESSAGE_PATTERNS.LAB,
  MESSAGE_PATTERNS.RESULTS,
  MESSAGE_PATTERNS.PRESCRIPTION,
  MESSAGE_PATTERNS.BILLING,
  MESSAGE_PATTERNS.DOCTOR,
  MESSAGE_PATTERNS.RESCHEDULE,
  MESSAGE_PATTERNS.STATUS,
  MESSAGE_PATTERNS.FEEDBACK
] as const;

/**
 * Process incoming WhatsApp message
 */
export async function processIncomingMessage(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string }
): Promise<MessageProcessingResult> {
  try {
    const text = getMessageText(message);
    const patientPhone = normalizePhoneNumber(message.from);

    // Validate phone number was normalized successfully
    if (!patientPhone || patientPhone.trim() === "") {
      console.error("Invalid phone number after normalization:", { from: message.from, normalized: patientPhone });
      return {
        success: false,
        action: "patient_creation_failed",
        error: "Invalid phone number format"
      };
    }

    // Find or create patient
    let patient;
    try {
      patient = await findOrCreatePatient(supabase, clinicId, patientPhone);
    } catch (error) {
      console.error("Error in patient lookup/creation:", error, { clinicId, patientPhone });
      return {
        success: false,
        action: "patient_creation_failed",
        error: error instanceof Error ? error.message : "Unknown error during patient lookup"
      };
    }

    if (!patient) {
      console.error("Patient lookup returned null", { clinicId, patientPhone });
      return {
        success: false,
        action: "patient_creation_failed",
        error: "Patient lookup returned no data"
      };
    }

    // Update patient's last activity timestamp
    try {
      await supabase
        .from("patients")
        .update({ last_visit_at: new Date().toISOString() })
        .eq("id", patient.id);
    } catch (error) {
      console.warn("Failed to update patient last_visit_at:", error);
      // Don't fail the message processing for this
    }

    // Route message based on content
    if (!text) {
      // Non-text message (media, location, etc.)
      return handleMediaMessage(supabase, clinicId, message, patient);
    }

    const lowerText = text.toLowerCase();

    // Try advanced handlers first using pre-compiled patterns (better performance)
    if (ADVANCED_PATTERNS.some(pattern => matchesPattern(lowerText, pattern))) {
      const advancedResult = await routeAdvancedMessage(supabase, clinicId, message, patient, text);
      if (advancedResult.success) {
        return advancedResult;
      }
      // If advanced handler didn't match, continue to basic routing
    }

    // Fall back to basic booking/confirmation/cancellation handlers using pre-compiled patterns
    if (matchesPattern(lowerText, MESSAGE_PATTERNS.BOOKING)) {
      return await handleBookingRequest(
        supabase,
        clinicId,
        message,
        patient,
        text
      );
    }

    if (matchesPattern(lowerText, MESSAGE_PATTERNS.CONFIRMATION)) {
      return await handleConfirmation(supabase, clinicId, message, patient);
    }

    if (matchesPattern(lowerText, MESSAGE_PATTERNS.CANCELLATION)) {
      return await handleCancellation(supabase, clinicId, message, patient);
    }

    if (matchesPattern(lowerText, MESSAGE_PATTERNS.HELP)) {
      return await handleHelpRequest(supabase, clinicId, message, patient);
    }

    // Default: Send help menu (catches unmatched messages)
    return await handleHelpRequest(supabase, clinicId, message, patient);
  } catch (error) {
    console.error("Error processing WhatsApp message:", error);
    return {
      success: false,
      action: "processing_error",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle media messages (audio, image, video, document, location)
 */
async function handleMediaMessage(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any
): Promise<MessageProcessingResult> {
  // For now, just acknowledge media receipt
  await sendWhatsAppMessage(
    supabase,
    clinicId,
    message.from,
    "Thanks for sending that. Our team will review it shortly."
  );

  return {
    success: true,
    action: "media_received",
    message: `Received ${message.type} from patient`
  };
}

/**
 * Handle booking request
 */
async function handleBookingRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  // Parse appointment details from text (you can use NLP or patterns)
  // For now, simple pattern matching

  const dateMatch = text.match(
    /(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\b(?:tomorrow|today|next\s+\w+)\b)/i
  );
  const timeMatch = text.match(/(\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm|AM|PM))/i);

  // If we can't parse details, ask for them
  if (!dateMatch || !timeMatch) {
    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `Hi ${patient.name || "there"}! 👋\n\nTo book an appointment, please share:\n• Preferred date\n• Preferred time\n• Doctor preference (optional)`
    );

    return {
      success: true,
      action: "booking_info_requested",
      message: "Asked patient for appointment details"
    };
  }

  // Store booking request for admin review
  const { error } = await supabase.from("booking_requests").insert({
    clinic_id: clinicId,
    patient_id: patient.id,
    patient_phone: message.from,
    requested_date: dateMatch[1],
    requested_time: timeMatch[1],
    message_text: text,
    status: "pending",
    webhook_event_id: message.id
  });

  if (error) {
    console.error("Failed to create booking request:", error);
    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      "Sorry, we couldn't process your booking. Please try again later."
    );
    return {
      success: false,
      action: "booking_request_failed",
      error: error.message
    };
  }

  // Send confirmation to patient
  await sendWhatsAppMessage(
    supabase,
    clinicId,
    message.from,
    `Thanks for booking with us! 📅\n\nWe've received your request for ${dateMatch[1]} at ${timeMatch[1]}.\n\nOur team will confirm your appointment shortly.`
  );

  return {
    success: true,
    action: "booking_request_created",
    message: "Booking request created and awaiting confirmation"
  };
}

/**
 * Handle appointment confirmation
 */
async function handleConfirmation(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any
): Promise<MessageProcessingResult> {
  // Find pending booking request for this patient
  const { data: bookingRequest } = await supabase
    .from("booking_requests")
    .select("*")
    .eq("patient_id", patient.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!bookingRequest) {
    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      "No pending appointment to confirm. Would you like to book a new one?"
    );

    return {
      success: true,
      action: "no_pending_booking",
      message: "Patient confirmed but no booking found"
    };
  }

  // Update booking status
  await supabase
    .from("booking_requests")
    .update({ status: "confirmed_by_patient" })
    .eq("id", bookingRequest.id);

  await sendWhatsAppMessage(
    supabase,
    clinicId,
    message.from,
    "Great! Your appointment is confirmed. 🎉\n\nWe look forward to seeing you!"
  );

  return {
    success: true,
    action: "booking_confirmed",
    message: "Patient confirmed appointment"
  };
}

/**
 * Handle cancellation request
 */
async function handleCancellation(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any
): Promise<MessageProcessingResult> {
  // Find upcoming appointments for this patient
  // Use UTC date for proper timezone handling
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const todayDateString = utcToday.toISOString().split("T")[0];

  const { data: appointments } = await supabase
    .from("appointments")
    .select("*")
    .eq("patient_phone", message.from)
    .eq("status", "Confirmed")
    .gte("appointment_date", todayDateString)
    .limit(1);

  if (!appointments || appointments.length === 0) {
    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      "No upcoming appointments to cancel."
    );

    return {
      success: true,
      action: "no_appointment_to_cancel",
      message: "Patient requested cancellation but no appointment found"
    };
  }

  // Mark for manual cancellation review
  const appointment = appointments[0];
  await supabase
    .from("appointment_cancellations")
    .insert({
      appointment_id: appointment.id,
      patient_id: patient.id,
      reason: "Requested via WhatsApp",
      status: "pending_approval"
    });

  await sendWhatsAppMessage(
    supabase,
    clinicId,
    message.from,
    `Your cancellation request for ${appointment.appointment_date} at ${appointment.appointment_time} has been noted. Our team will process it shortly.`
  );

  return {
    success: true,
    action: "cancellation_requested",
    message: "Cancellation request created for review"
  };
}

/**
 * Handle help/menu request
 */
async function handleHelpRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any
): Promise<MessageProcessingResult> {
  const helpMenu = `Hi ${patient.name || "there"}! 👋\n\nWhat can we help you with?\n\n1. 📅 Book an appointment\n2. ✅ Confirm appointment\n3. ❌ Cancel appointment\n4. 📞 Call us\n\nJust reply with what you need!`;

  await sendWhatsAppMessage(supabase, clinicId, message.from, helpMenu);

  return {
    success: true,
    action: "help_menu_sent",
    message: "Help menu sent to patient"
  };
}

/**
 * Process failed webhook (for retry queue)
 */
export async function retryFailedWebhook(
  supabase: ReturnType<typeof createClient>,
  eventId: string,
  maxRetries: number = 3
): Promise<boolean> {
  // Get the event
  const { data: event } = await supabase
    .from("webhook_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (!event || event.retry_count >= maxRetries) {
    return false;
  }

  // Retry processing
  const { error: updateError } = await supabase
    .from("webhook_events")
    .update({
      retry_count: event.retry_count + 1,
      status: "retrying"
    })
    .eq("id", eventId);

  if (updateError) {
    console.error("Failed to update retry count:", updateError);
    return false;
  }

  // Reprocess the event
  try {
    const payload = event.payload;
    // Process based on event type
    // This would be called from the webhook handler
    return true;
  } catch (error) {
    console.error("Retry processing failed:", error);
    return false;
  }
}
