/**
 * INTEGRATION EXAMPLE: Using Trigger Configuration in Patient Flow
 *
 * This file shows how to refactor the patient flow to use database-driven
 * menus, templates, and settings instead of hardcoded values.
 *
 * BEFORE: All configuration hardcoded in lib/whatsapp/patientFlow.ts
 * AFTER: Configuration in database, loaded via cache
 */

import type { FlowContext } from "@/lib/whatsapp/context";
import {
  getMenu,
  getTemplate,
  getSetting,
  getSettingNumber,
  interpolateTemplate
} from "@/lib/triggers/cache";

/**
 * EXAMPLE 1: Show main menu using database configuration
 */
export async function showMainMenuRefactored(ctx: FlowContext, language: string) {
  // OLD WAY (hardcoded):
  // const message = `Welcome to ${clinicName}!\n\n1. Book Appointment\n2. My Appointments\n3. Change Language\n* More`;
  // await sendMessage(ctx, message);

  // NEW WAY (from database):
  const menu = await getMenu(
    ctx.supabase,
    ctx.clinicId, // Need to add this to FlowContext
    "MAIN_MENU",
    language
  );

  if (!menu) {
    await ctx.reply("Welcome! Please select an option.");
    return;
  }

  // Build menu message from database
  const menuText = menu.options
    .map((opt) => `${opt.id}. ${opt.label}`)
    .join("\n");

  const message = `${menu.title}\n\n${menuText}${menu.footer ? `\n\n${menu.footer}` : ""}`;

  await ctx.reply(message);
}

/**
 * EXAMPLE 2: Send appointment reminder with template
 */
export async function sendAppointmentReminderRefactored(
  ctx: FlowContext,
  patientName: string,
  doctorName: string,
  appointmentTime: string,
  appointmentCode: string,
  language: string
) {
  // OLD WAY (hardcoded):
  // const message = `👋 Hi ${patientName}!
  // Your appointment with ${doctorName} is tomorrow at ${appointmentTime}.
  // Code: ${appointmentCode}
  // Reply with: 1. Confirm  2. Reschedule  3. Cancel`;

  // NEW WAY (from database with placeholders):
  const template = await getTemplate(
    ctx.supabase,
    ctx.clinicId,
    "APPOINTMENT_REMINDER",
    language
  );

  if (!template) {
    console.error("Appointment reminder template not found");
    return;
  }

  // Interpolate variables
  const message = interpolateTemplate(template.body, {
    patient_name: patientName,
    doctor_name: doctorName,
    appointment_time: appointmentTime,
    appointment_code: appointmentCode
  });

  await ctx.reply(message);
}

/**
 * EXAMPLE 3: Get clinic setting (home collection radius)
 */
export async function validateHomeCollectionLocationRefactored(
  ctx: FlowContext,
  patientLatitude: number,
  patientLongitude: number,
  language: string
) {
  // OLD WAY (hardcoded):
  // const radiusKm = 5;

  // NEW WAY (from database):
  const radiusKm = await getSettingNumber(
    ctx.supabase,
    ctx.clinicId,
    "home_collection_radius",
    5 // fallback default
  );

  // Calculate distance (using haversine formula)
  const clinicLocation = await getSetting(
    ctx.supabase,
    ctx.clinicId,
    "hospital_location"
  );

  if (!clinicLocation) {
    const template = await getTemplate(
      ctx.supabase,
      ctx.clinicId,
      "HOME_COLLECTION_NOT_AVAILABLE",
      language
    );
    await ctx.reply(template?.body || "Home collection not available");
    return false;
  }

  const [clinicLat, clinicLon] = clinicLocation.split(",").map(Number);
  const distance = calculateDistance(
    patientLatitude,
    patientLongitude,
    clinicLat,
    clinicLon
  );

  if (distance > radiusKm) {
    const template = await getTemplate(
      ctx.supabase,
      ctx.clinicId,
      "HOME_COLLECTION_OUT_OF_RANGE",
      language
    );

    const message = interpolateTemplate(template?.body || "", {
      distance: distance.toFixed(1),
      radius: radiusKm.toString()
    });

    await ctx.reply(message);
    return false;
  }

  return true;
}

/**
 * EXAMPLE 4: Check if feature is enabled per clinic
 */
export async function isDoctorPortalEnabledRefactored(ctx: FlowContext): Promise<boolean> {
  // OLD WAY (hardcoded):
  // return ENABLE_DOCTOR_PORTAL === "true";

  // NEW WAY (per-clinic setting):
  const enabled = await getSetting(
    ctx.supabase,
    ctx.clinicId,
    "enable_doctor_portal"
  );

  return enabled === "true";
}

/**
 * EXAMPLE 5: Refactored patient flow main handler
 *
 * This shows how the state machine logic stays in code,
 * but configuration comes from database
 */
export async function handlePatientMessageRefactored(
  ctx: FlowContext,
  messageText: string,
  language: string
) {
  const { supabase, phone, clinicId } = ctx;

  // Get or create session
  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("sender_phone", phone)
    .single();

  const currentState = session?.state || "MAIN_MENU";

  // STATE MACHINE LOGIC (stays in code)
  switch (currentState) {
    case "MAIN_MENU": {
      // Get menu from database
      const menu = await getMenu(supabase, clinicId, "MAIN_MENU", language);

      // Validate input (logic in code)
      const selectedOption = menu?.options.find((o) => o.id === messageText);

      if (!selectedOption) {
        await ctx.reply("Invalid option. Please select again.");
        return;
      }

      // Route based on selection (logic in code)
      if (messageText === "1") {
        // Start booking flow
        await handleBookingFlow(ctx, language);
      } else if (messageText === "2") {
        // Show appointments
        await handleMyAppointments(ctx, language);
      }
      // ... etc
      break;
    }

    case "BOOK_DOCTOR": {
      // Handle doctor selection
      // Menu comes from database, validation logic stays in code
      break;
    }

    // ... more states
  }
}

/**
 * Helper function to calculate distance (haversine formula)
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// These would be implemented with database-driven menus:
async function handleBookingFlow(ctx: FlowContext, language: string) {
  // Implementation
}

async function handleMyAppointments(ctx: FlowContext, language: string) {
  // Implementation
}

/**
 * SUMMARY OF CHANGES
 *
 * Benefits of this refactoring:
 *
 * 1. MULTI-CLINIC SUPPORT
 *    Different clinics can have different menus, messages, and settings
 *    without code changes
 *
 * 2. HOT RELOAD CONFIGURATION
 *    Change menus/templates/settings in database
 *    Changes apply within 1 hour (cache TTL)
 *    Or manually clear cache for instant reload
 *
 * 3. ADMIN UI
 *    Non-technical staff can manage messages and menus
 *    No need to touch code or redeploy
 *
 * 4. MULTI-LANGUAGE
 *    All languages stored in database
 *    Easy to add new languages
 *
 * 5. A/B TESTING
 *    Test different messages or menu layouts
 *    Track which performs better
 *
 * 6. PERFORMANCE
 *    In-memory caching prevents database hits
 *    ~50ms overhead vs zero overhead hardcoded
 *    Worth it for flexibility benefits
 *
 * 7. TYPE SAFETY
 *    Business logic still type-safe in code
 *    Configuration is dynamic but validated
 *
 * MIGRATION STRATEGY:
 *
 * Phase 1: Add cache layer (done ✓)
 * Phase 2: Create admin UI (in progress)
 * Phase 3: Refactor patient flow (next)
 * Phase 4: Refactor doctor flow (next)
 * Phase 5: Add cron job manager (future)
 */
