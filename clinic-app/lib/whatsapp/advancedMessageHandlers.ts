/**
 * Advanced Message Handlers for WhatsApp Webhook
 * Handles specialized patient requests beyond basic booking
 */

import { createClient } from "@supabase/supabase-js";
import { WhatsAppMessage } from "./webhook";
import { sendWhatsAppMessage } from "@/lib/whatsapp/send";

export interface MessageProcessingResult {
  success: boolean;
  action: string;
  message?: string;
  error?: string;
}

// Valid request types - enforced at type level and runtime
const VALID_REQUEST_TYPES = [
  "lab_collection",
  "prescription",
  "results",
  "bill",
  "feedback",
  "reschedule",
  "status",
  "doctor_info"
] as const;

export type RequestType = typeof VALID_REQUEST_TYPES[number];

/**
 * Type guard to validate request type
 */
function isValidRequestType(type: string): type is RequestType {
  return (VALID_REQUEST_TYPES as readonly string[]).includes(type);
}

/**
 * Helper function to create patient request with validation
 */
async function createPatientRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  patientId: string,
  patientPhone: string,
  requestType: string,
  requestText: string
): Promise<{ success: boolean; error?: string }> {
  // Validate request type
  if (!isValidRequestType(requestType)) {
    return {
      success: false,
      error: `Invalid request type: ${requestType}`
    };
  }

  try {
    const { error } = await supabase.from("patient_requests").insert({
      clinic_id: clinicId,
      patient_id: patientId,
      patient_phone: patientPhone,
      request_type: requestType,
      request_text: requestText,
      status: "pending"
    });

    if (error) throw error;

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle lab/sample collection requests
 * Examples: "Can I do home sample collection?", "Book lab collection"
 */
export async function handleLabCollectionRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Create patient request with validation
    const createResult = await createPatientRequest(
      supabase,
      clinicId,
      patient.id,
      message.from,
      "lab_collection",
      text
    );

    if (!createResult.success) {
      return {
        success: false,
        action: "lab_collection_failed",
        error: createResult.error
      };
    }

    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `Thanks for your interest in home sample collection! 🏥\n\nOur team will contact you shortly to schedule the collection at your convenience.\n\nExpected timeframe: Within 2-4 hours.`
    );

    return {
      success: true,
      action: "lab_collection_requested",
      message: "Lab collection request logged"
    };
  } catch (error) {
    return {
      success: false,
      action: "lab_collection_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle test results requests
 * Examples: "Where are my results?", "Can I get my report?", "My test results"
 */
export async function handleResultsRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Try to find recent tests for this patient
    const { data: recentTests } = await supabase
      .from("patient_requests")
      .select("*")
      .eq("patient_id", patient.id)
      .eq("request_type", "lab_collection")
      .order("created_at", { ascending: false })
      .limit(3);

    let response = "";

    if (recentTests && recentTests.length > 0) {
      response = `Hi ${patient.name}! 👋\n\nI found ${recentTests.length} recent test(s).\n\nOur lab team will send you the results via email or WhatsApp as soon as they're ready. Typically within 24-48 hours.\n\nIf you need it urgently, just let us know! 📊`;
    } else {
      response = `Hi ${patient.name}! 👋\n\nI couldn't find any recent tests associated with your account.\n\nCould you provide the test date or type? Our team will look it up for you! 🔍`;
    }

    // Log request with validation
    const createResult = await createPatientRequest(
      supabase,
      clinicId,
      patient.id,
      message.from,
      "results",
      text
    );
    if (!createResult.success) {
      console.error("Failed to create results request:", createResult.error);
      // Continue anyway - still send response
    }

    await sendWhatsAppMessage(supabase, clinicId, message.from, response);

    return {
      success: true,
      action: "results_requested",
      message: "Results request processed"
    };
  } catch (error) {
    return {
      success: false,
      action: "results_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle prescription requests
 * Examples: "Can I get my prescription?", "Prescription refill"
 */
export async function handlePrescriptionRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Log request with validation
    const createResult = await createPatientRequest(
      supabase,
      clinicId,
      patient.id,
      message.from,
      "prescription",
      text
    );

    if (!createResult.success) {
      throw new Error(createResult.error);
    }

    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `Thanks for requesting your prescription! 💊\n\nOur pharmacy team will prepare your prescription and send it via email within 2 hours.\n\nIf it's urgent, please mention it here!`
    );

    return {
      success: true,
      action: "prescription_requested",
      message: "Prescription request logged"
    };
  } catch (error) {
    return {
      success: false,
      action: "prescription_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle billing/invoice requests
 * Examples: "What's my bill?", "Send invoice", "How much do I owe?"
 */
export async function handleBillingRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Log request with validation
    const createResult = await createPatientRequest(
      supabase,
      clinicId,
      patient.id,
      message.from,
      "bill",
      text
    );

    if (!createResult.success) {
      throw new Error(createResult.error);
    }

    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `Thanks for checking! 💰\n\nOur billing team will send you a detailed invoice within 1 hour.\n\nIf you have any questions about your charges, feel free to ask!`
    );

    return {
      success: true,
      action: "billing_requested",
      message: "Billing request logged"
    };
  } catch (error) {
    return {
      success: false,
      action: "billing_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle doctor information requests
 * Examples: "Tell me about Dr. Smith", "Who is the cardiologist?"
 */
export async function handleDoctorInfoRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Get doctors list
    const { data: doctors } = await supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("active", true);

    if (!doctors || doctors.length === 0) {
      await sendWhatsAppMessage(
        supabase,
        clinicId,
        message.from,
        "Our doctors list is currently being updated. Please call us at [clinic_number] to know more about our doctors."
      );
      return {
        success: true,
        action: "doctor_info_requested",
        message: "No doctors found"
      };
    }

    // Build response
    let response = `👨‍⚕️ Our Doctors:\n\n`;
    for (const doc of doctors.slice(0, 5)) {
      response += `• Dr. ${doc.name}\n  Specialty: ${doc.specialization || "General"}\n  Slot Duration: ${doc.appointment_duration_minutes} min\n\n`;
    }
    response += `To book an appointment, just say "Book appointment"!`;

    await sendWhatsAppMessage(supabase, clinicId, message.from, response);

    return {
      success: true,
      action: "doctor_info_sent",
      message: "Doctor info provided"
    };
  } catch (error) {
    return {
      success: false,
      action: "doctor_info_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle appointment reschedule requests
 * Examples: "Can I reschedule?", "Change my appointment", "Different time"
 */
export async function handleRescheduleRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Find upcoming appointments
    const { data: appointments } = await supabase
      .from("appointments")
      .select("*")
      .eq("patient_phone", message.from)
      .eq("status", "Confirmed")
      .gt("appointment_date", new Date().toISOString().split("T")[0]);

    if (!appointments || appointments.length === 0) {
      await sendWhatsAppMessage(
        supabase,
        clinicId,
        message.from,
        "No upcoming appointments found. Would you like to book one?"
      );

      return {
        success: true,
        action: "no_appointment_to_reschedule",
        message: "Patient has no upcoming appointments"
      };
    }

    // Log request with validation
    const createResult = await createPatientRequest(
      supabase,
      clinicId,
      patient.id,
      message.from,
      "reschedule",
      text
    );
    if (!createResult.success) {
      console.error("Failed to create reschedule request:", createResult.error);
      // Continue anyway - still send response
    }

    const appt = appointments[0];
    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `Got it! 📅\n\nYour current appointment:\nDate: ${appt.appointment_date}\nTime: ${appt.appointment_time}\n\nPlease reply with:\n• Your preferred date\n• Your preferred time\n\nOur team will confirm the new slot!`
    );

    return {
      success: true,
      action: "reschedule_requested",
      message: "Reschedule request logged"
    };
  } catch (error) {
    return {
      success: false,
      action: "reschedule_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle appointment status requests
 * Examples: "What time is my appointment?", "When is my appointment?"
 */
export async function handleStatusRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Find upcoming appointments
    const { data: appointments } = await supabase
      .from("appointments")
      .select("*")
      .eq("patient_phone", message.from)
      .eq("status", "Confirmed")
      .gt("appointment_date", new Date().toISOString().split("T")[0])
      .order("appointment_date", { ascending: true })
      .limit(1);

    if (!appointments || appointments.length === 0) {
      await sendWhatsAppMessage(
        supabase,
        clinicId,
        message.from,
        "No upcoming appointments. Would you like to book one?"
      );

      return {
        success: true,
        action: "no_appointment_status",
        message: "No appointments found"
      };
    }

    const appt = appointments[0];
    const doctor = await supabase
      .from("doctors")
      .select("*")
      .eq("id", appt.doctor_id)
      .single();

    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `📅 Your Appointment Details:\n\nDate: ${appt.appointment_date}\nTime: ${appt.appointment_time}\nDoctor: Dr. ${doctor.data?.name || "TBD"}\nStatus: ${appt.status}\n\nNeed to reschedule? Just say "reschedule"!`
    );

    return {
      success: true,
      action: "status_provided",
      message: "Appointment status sent"
    };
  } catch (error) {
    return {
      success: false,
      action: "status_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Handle feedback/complaints
 * Examples: "I want to give feedback", "I have a complaint"
 */
export async function handleFeedbackRequest(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  try {
    // Log request with validation
    const createResult = await createPatientRequest(
      supabase,
      clinicId,
      patient.id,
      message.from,
      "feedback",
      text
    );

    if (!createResult.success) {
      throw new Error(createResult.error);
    }

    await sendWhatsAppMessage(
      supabase,
      clinicId,
      message.from,
      `Thank you for your feedback! 🙏\n\nWe appreciate your input and will use it to improve our services.\n\nOur team will review your message shortly.`
    );

    return {
      success: true,
      action: "feedback_received",
      message: "Feedback logged"
    };
  } catch (error) {
    return {
      success: false,
      action: "feedback_failed",
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}

/**
 * Route message to appropriate handler based on keywords
 */
export async function routeAdvancedMessage(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  message: WhatsAppMessage & { clinicPhone: string },
  patient: any,
  text: string
): Promise<MessageProcessingResult> {
  const lowerText = text.toLowerCase();

  // Lab/collection
  if (lowerText.match(/lab|collect|sample|blood|test|needle|home.*collect/i)) {
    return await handleLabCollectionRequest(supabase, clinicId, message, patient, text);
  }

  // Results/reports
  if (lowerText.match(/result|report|ready|test.*ready|check.*result/i)) {
    return await handleResultsRequest(supabase, clinicId, message, patient, text);
  }

  // Prescription
  if (lowerText.match(/prescription|medicine|drug|refill|rx/i)) {
    return await handlePrescriptionRequest(supabase, clinicId, message, patient, text);
  }

  // Billing
  if (lowerText.match(/bill|invoice|cost|charge|pay|payment/i)) {
    return await handleBillingRequest(supabase, clinicId, message, patient, text);
  }

  // Doctor info
  if (lowerText.match(/doctor|specialist|cardiologist|dermatologist|who.*doctor/i)) {
    return await handleDoctorInfoRequest(supabase, clinicId, message, patient, text);
  }

  // Reschedule
  if (lowerText.match(/reschedule|change|different.*time|postpone|later/i)) {
    return await handleRescheduleRequest(supabase, clinicId, message, patient, text);
  }

  // Status
  if (lowerText.match(/status|when|time|appointment.*time|my.*appointment/i)) {
    return await handleStatusRequest(supabase, clinicId, message, patient, text);
  }

  // Feedback
  if (lowerText.match(/feedback|complaint|suggest|issue|problem/i)) {
    return await handleFeedbackRequest(supabase, clinicId, message, patient, text);
  }

  // No match
  return {
    success: false,
    action: "no_handler_matched",
    message: "No handler matched for this message"
  };
}
