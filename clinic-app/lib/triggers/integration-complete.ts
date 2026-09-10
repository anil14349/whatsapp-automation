/**
 * Complete Integration Example: All Trigger Features
 *
 * This file demonstrates how to use all trigger configuration features together:
 * 1. Database-driven menus
 * 2. Message templates with variable interpolation
 * 3. Clinic settings
 * 4. Cron job execution
 * 5. A/B testing
 * 6. Analytics tracking
 *
 * Real-world usage in patient/doctor flows:
 */

import type { FlowContext } from "@/lib/whatsapp/context";
import { reply, replyMenu } from "@/lib/whatsapp/context";
import type { Doctor, Appointment } from "@/lib/doctors";

// Import all trigger modules
import { getMainMenuFromDb } from "./../../lib/whatsapp/dbMenus";
import { getTemplateAndInterpolate, validateTemplateVariables } from "./templates";
import {
  getHomeCollectionRadius,
  isHomeCollectionEnabled,
  getMaxBookingDays
} from "./clinicSettings";
import { CronJobScheduler } from "./cronJobs";
import { selectVariantDeterministic, trackABTestEvent } from "./abTesting";
import {
  trackMenuShown,
  trackMenuClicked,
  trackTemplateSent,
  trackTemplateError
} from "./analytics";

/**
 * EXAMPLE 1: Show main menu with analytics
 */
export async function showMainMenuWithAnalytics(ctx: FlowContext): Promise<void> {
  // Load menu from database
  const menu = await getMainMenuFromDb(ctx.supabase, ctx.clinicId, ctx.language);

  // Track that menu was shown
  await trackMenuShown(ctx.supabase, ctx.clinicId, "MAIN_MENU", ctx.language, ctx.phone);

  // Send to user
  await replyMenu(ctx, "Welcome! What can we help you with?", menu);
}

/**
 * EXAMPLE 2: Send templated message with variables
 */
export async function sendAppointmentReminderWithTemplate(
  ctx: FlowContext,
  appointment: Appointment
): Promise<void> {
  try {
    // Load template and interpolate variables
    const message = await getTemplateAndInterpolate(
      ctx.supabase,
      ctx.clinicId,
      "APPOINTMENT_REMINDER",
      ctx.language,
      {
        patient_name: appointment.patient_name,
        doctor_name: appointment.doctor_name || "Your Doctor",
        appointment_date: appointment.appointment_date,
        appointment_time: appointment.appointment_time,
        appointment_code: appointment.id.slice(0, 8).toUpperCase()
      },
      {
        fallbackBody:
          "You have an appointment scheduled. Please reply to confirm or reschedule."
      }
    );

    // Send message
    await reply(ctx, message);

    // Track successful send
    await trackTemplateSent(
      ctx.supabase,
      ctx.clinicId,
      "APPOINTMENT_REMINDER",
      ctx.language,
      ctx.phone
    );
  } catch (error) {
    // Track error
    await trackTemplateError(
      ctx.supabase,
      ctx.clinicId,
      "APPOINTMENT_REMINDER",
      ctx.language,
      error instanceof Error ? error.message : "Unknown error",
      ctx.phone
    );
  }
}

/**
 * EXAMPLE 3: Check clinic settings before showing feature
 */
export async function startHomeCollectionFlowIfEnabled(
  ctx: FlowContext
): Promise<boolean> {
  // Load clinic settings
  const enabled = await isHomeCollectionEnabled(ctx.supabase, ctx.clinicId);
  const radiusKm = await getHomeCollectionRadius(ctx.supabase, ctx.clinicId);

  if (!enabled) {
    await reply(ctx, "Home collection is not available right now.");
    return false;
  }

  await reply(ctx, `Home collection available within ${radiusKm} km of our clinic.`);
  return true;
}

/**
 * EXAMPLE 4: Track menu interactions for analytics
 */
export async function handleMenuSelectionWithTracking(
  ctx: FlowContext,
  menuKey: string,
  selectedOption: string
): Promise<void> {
  // Track the click
  await trackMenuClicked(
    ctx.supabase,
    ctx.clinicId,
    menuKey,
    selectedOption,
    ctx.language,
    ctx.phone
  );

  // Process selection...
  await reply(ctx, `You selected: ${selectedOption}`);
}

/**
 * EXAMPLE 5: A/B test templates
 */
export async function sendTemplateWithABTesting(
  ctx: FlowContext,
  templateKey: string,
  variables: Record<string, string | number | boolean>
): Promise<void> {
  // Get active A/B tests
  const tests = await getActiveABTests(ctx.supabase, ctx.clinicId);
  const test = tests.find((t) => t.template_key === templateKey);

  let variant = "control";
  if (test) {
    // Select variant based on phone number (deterministic)
    variant = selectVariantDeterministic(
      ctx.phone,
      Object.keys(test.variants),
      test.variants
    );

    // Track that variant was shown
    await trackABTestEvent(
      ctx.supabase,
      ctx.clinicId,
      test.test_key,
      variant,
      "shown",
      ctx.phone
    );
  }

  // Load template (variant could be used as suffix in template_key)
  const templateKeyWithVariant = variant !== "control" ? `${templateKey}_${variant}` : templateKey;

  const message = await getTemplateAndInterpolate(
    ctx.supabase,
    ctx.clinicId,
    templateKeyWithVariant,
    ctx.language,
    variables
  );

  await reply(ctx, message);

  // Track send
  await trackTemplateSent(
    ctx.supabase,
    ctx.clinicId,
    templateKey,
    ctx.language,
    ctx.phone
  );
}

/**
 * EXAMPLE 6: Execute scheduled cron jobs
 */
export async function executeScheduledJobs(clinicId: string | undefined): Promise<void> {
  if (!clinicId) {
    return;
  }

  // This would typically be called from a scheduled API endpoint
  // e.g., `/api/cron/execute` called by an external scheduler (Vercel Cron, AWS EventBridge, etc.)

  // Create scheduler
  // const supabase = getSupabaseServerClient();
  // const scheduler = new CronJobScheduler(supabase);

  // Get jobs to run
  // const jobsToRun = await scheduler.getJobsToRun(clinicId);

  // Execute each job
  // for (const job of jobsToRun) {
  //   const execution = await scheduler.executeJob(job);
  //   console.log(`Job ${job.job_name} completed with status: ${execution.status}`);
  // }
}

/**
 * COMPLETE FLOW EXAMPLE: Booking Confirmation
 *
 * Shows how all features work together for a real appointment booking scenario
 */
export async function completeBookingFlow(
  ctx: FlowContext,
  patient: { name: string; phone: string },
  doctor: Doctor,
  appointment: Appointment
): Promise<void> {
  // 1. Show clinic-specific settings
  const maxDays = await getMaxBookingDays(ctx.supabase, ctx.clinicId);

  // 2. Load confirmation menu from database
  const menu = await getMainMenuFromDb(ctx.supabase, ctx.clinicId, ctx.language);

  // 3. Track the menu display
  await trackMenuShown(ctx.supabase, ctx.clinicId, "BOOKING_CONFIRM", ctx.language, ctx.phone);

  // 4. Send templated confirmation message
  const confirmMessage = await getTemplateAndInterpolate(
    ctx.supabase,
    ctx.clinicId,
    "BOOKING_CONFIRMED",
    ctx.language,
    {
      patient_name: patient.name,
      doctor_name: doctor.name,
      appointment_date: appointment.appointment_date,
      appointment_time: appointment.appointment_time,
      appointment_code: appointment.id.slice(0, 8).toUpperCase()
    },
    {
      fallbackBody: `Your appointment is confirmed with ${doctor.name}.`
    }
  );

  await reply(ctx, confirmMessage);

  // 5. Track the message send
  await trackTemplateSent(
    ctx.supabase,
    ctx.clinicId,
    "BOOKING_CONFIRMED",
    ctx.language,
    ctx.phone
  );

  // 6. Send reminder menu
  await replyMenu(ctx, "What would you like to do next?", menu);

  // 7. Track menu interaction
  await trackMenuShown(ctx.supabase, ctx.clinicId, "MAIN_MENU", ctx.language, ctx.phone);
}

// Placeholder import for the rest
async function getActiveABTests(supabase: any, clinicId: any): Promise<any[]> {
  // Implementation in abTesting.ts
  return [];
}
