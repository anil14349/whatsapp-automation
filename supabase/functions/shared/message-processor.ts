import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { ProcessMessageContext, WhatsAppSession, ExtractedMessage } from "./types.ts";
import { info, debug } from "./logger.ts";
import { PatientFlowHandler } from "./handlers/patient-handler.ts";
import { DoctorFlowHandler } from "./handlers/doctor-handler.ts";
import { HomeCollectionHandler } from "./handlers/home-collection-handler.ts";
import { getRoleByPhoneForClinic } from "./staff-directory.ts";
import { getClinicConfig, isClinicOpen, getAfterHoursMessage } from "./clinic-config.ts";
import { sendLanguagePrompt } from "./languages.ts";
import { getPinEntryPrompt } from "./doctor-auth.ts";
import { BUTTON_IDS } from "./button-ids.ts";

// These states belong to the home-collection flow whoever is in them.
const HOME_COLLECTION_STATES = new Set([
    "LOCATION_SELECT",
    "LOCATION_VERIFY",
    "REQUEST_DATE",
    "REQUEST_DATE_CUSTOM",
    "REQUEST_TIME_WINDOW",
    "REQUEST_CONFIRM",
    "REQUEST_TRACKING"
]);

/**
 * Main message processing pipeline
 * Routes incoming messages to appropriate handlers
 */
export async function processMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    context: ProcessMessageContext
): Promise<void> {
    const { senderPhone, senderName, messageText, messageType } = context;

    info("processMessage", `Processing message from ${senderPhone}`, {
        type: messageType,
        text: messageText.substring(0, 50)
    });

    // ============================================================
    // GET OR CREATE SESSION
    // ============================================================

    const clinicId =
        context.clinicId || Deno.env.get("DEFAULT_CLINIC_ID") || "default-clinic";
    const session = await getOrCreateSession(supabase, senderPhone, clinicId);

    debug("processMessage", "Session loaded", {
        state: session.state,
        role: session.role,
        clinic_id: session.clinic_id
    });

    // ============================================================
    // AFTER-HOURS GATE
    // ============================================================

    if (await isBlockedByAfterHours(supabase, whatsappClient, senderPhone, session)) {
        return;
    }

    // ============================================================
    // ROUTE TO HANDLER
    // ============================================================

    const normalizedMessage = messageText.toLowerCase().trim();

    // Greeting (always allowed)
    if (isGreeting(normalizedMessage)) {
        await handleGreeting(supabase, whatsappClient, senderPhone, session);
        return;
    }

    // Route by role
    const dispatchReply =
        messageText.trim().startsWith(BUTTON_IDS.HOME_COLLECTION_MENU.CONFIRM + ":") ||
        messageText.trim().startsWith(BUTTON_IDS.HOME_COLLECTION_MENU.REJECT + ":");

    // Dispatch replies arrive unprompted, and patients can be mid collection request.
    if (dispatchReply || HOME_COLLECTION_STATES.has(session.state)) {
        await handleHomeCollectionMessage(
            supabase,
            whatsappClient,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        );
        return;
    }

    if (session.role === "DOCTOR") {
        await handleDoctorMessage(
            supabase,
            whatsappClient,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        );
    } else if (session.role === "HOME_COLLECTION_PERSON") {
        await handleHomeCollectionMessage(
            supabase,
            whatsappClient,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session
        );
    } else {
        // Patient or default
        await handlePatientMessage(
            supabase,
            whatsappClient,
            senderPhone,
            senderName,
            messageText,
            normalizedMessage,
            session,
            context.latitude,
            context.longitude
        );
    }
}

/**
 * After-hours gate: reply with clinic hours instead of the menu.
 * Only fresh/idle patient conversations are gated, so nobody is stranded
 * halfway through a booking when the clinic closes.
 */
async function isBlockedByAfterHours(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    senderPhone: string,
    session: WhatsAppSession
): Promise<boolean> {
    if (session.role === "DOCTOR" || session.role === "HOME_COLLECTION_PERSON") {
        return false;
    }

    const idleStates = new Set(["LANGUAGE_SELECT", "MAIN_MENU"]);
    if (!idleStates.has(session.state)) {
        return false;
    }

    try {
        const config = await getClinicConfig(supabase, session.clinic_id);

        if (!config.enable_after_hours_reply || isClinicOpen(config, new Date())) {
            return false;
        }

        await whatsappClient.sendTextMessage(
            senderPhone,
            getAfterHoursMessage(config),
            supabase
        );

        return true;
    } catch (error) {
        // A config lookup failure must never silence the bot.
        debug("processMessage", "After-hours check failed, allowing message", {
            error: error instanceof Error ? error.message : String(error)
        });
        return false;
    }
}

/**
 * Get or create a session for the given phone
 */
async function getOrCreateSession(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string
): Promise<WhatsAppSession> {
    try {
        // Try to fetch existing session
        const { data: existing } = await supabase
            .from("whatsapp_sessions")
            .select("*")
            .eq("phone", phone)
            .eq("clinic_id", clinicId)
            .maybeSingle();

        if (existing) {
            // Update last activity
            await supabase
                .from("whatsapp_sessions")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", existing.id);

            return existing;
        }

        // Create new session with role determined by phone number
        const role = await getRoleByPhoneForClinic(supabase, phone, clinicId);
        const initialState =
            role === "DOCTOR"
                ? "DOCTOR_LOGIN"
                : role === "HOME_COLLECTION_PERSON"
                  ? "LOCATION_SELECT"
                  : "LANGUAGE_SELECT";

        const { data: newSession } = await supabase
            .from("whatsapp_sessions")
            .insert({
                phone,
                clinic_id: clinicId,
                role,
                state: initialState,
                data: {},
                metadata: {}
            })
            .select()
            .single();

        return newSession as WhatsAppSession;
    } catch (error) {
        console.error("Failed to get/create session:", error);

        // Return default session (should not happen in production)
        const role = await getRoleByPhoneForClinic(supabase, phone, clinicId);
        const initialState =
            role === "DOCTOR"
                ? "DOCTOR_LOGIN"
                : role === "HOME_COLLECTION_PERSON"
                  ? "LOCATION_SELECT"
                  : "LANGUAGE_SELECT";

        return {
            id: "default",
            phone,
            clinic_id: clinicId,
            role,
            state: initialState,
            data: {},
            metadata: {},
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
    }
}

/**
 * Update session state and data
 */
export async function updateSession(
    supabase: SupabaseClient,
    phone: string,
    clinicId: string,
    updates: {
        state?: string;
        data?: Record<string, any>;
        metadata?: Record<string, any>;
        role?: string;
    }
): Promise<void> {
    try {
        await supabase
            .from("whatsapp_sessions")
            .update({
                ...updates,
                updated_at: new Date().toISOString()
            })
            .eq("phone", phone)
            .eq("clinic_id", clinicId);
    } catch (error) {
        console.error("Failed to update session:", error);
    }
}

/**
 * Check if message is a greeting
 */
function isGreeting(message: string): boolean {
    const greetings = ["hi", "hello", "hey", "start", "हेलो", "नमस्ते"];
    return greetings.includes(message);
}

/**
 * Handle greeting message
 */
async function handleGreeting(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    session: WhatsAppSession
): Promise<void> {
    debug("handleGreeting", `Greeting from ${phone}`, { role: session.role });

    // Different greeting for doctors vs patients
    if (session.role === "DOCTOR") {
        // For doctors, keep them in DOCTOR_LOGIN and prompt for PIN
        const clinicId = session.clinic_id;
        const language = session.data?.language || "EN";

        // Don't reset session for doctors, keep DOCTOR_LOGIN state
        const pinPrompt = getPinEntryPrompt(phone, clinicId, language);
        await whatsappClient.sendTextMessage(phone, pinPrompt, supabase);
    } else if (session.role === "HOME_COLLECTION_PERSON") {
        // For sample collectors, reset to location selection
        await updateSession(supabase, phone, session.clinic_id, {
            state: "LOCATION_SELECT",
            data: {}
        });

        const language = session.data?.language || "EN";
        await whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? "📍 Please share your location to register for home sample collection:\n\n• Attach your GPS location, or\n• Type your address"
                : "📍 होम सैंपल कलेक्शन के लिए कृपया अपना स्थान साझा करें:\n\n• GPS स्थान साझा करें, या\n• अपना पता लिखें",
            supabase
        );
    } else {
        // Returning patients keep the language they chose last time.
        const { data: knownPatient } = await supabase
            .from("patients")
            .select("preferred_language")
            .eq("phone", phone)
            .eq("clinic_id", session.clinic_id)
            .maybeSingle();

        const savedLanguage = knownPatient?.preferred_language;

        if (savedLanguage) {
            await updateSession(supabase, phone, session.clinic_id, {
                state: "MAIN_MENU",
                data: { language: savedLanguage }
            });

            const handler = new PatientFlowHandler(supabase, whatsappClient);
            await handler.handle(
                { ...session, state: "MAIN_MENU", data: { language: savedLanguage } },
                { type: "text", text: "" }
            );
            return;
        }

        // For patients, reset to language selection
        await updateSession(supabase, phone, session.clinic_id, {
            state: "LANGUAGE_SELECT",
            data: {}
        });

        // Send greeting response
        const clinic = await getClinicConfig(supabase, session.clinic_id);

        await sendLanguagePrompt(
            whatsappClient,
            phone,
            `👋 Welcome to ${clinic.clinic_name}!\n\nPlease select your language:`,
            supabase
        );
    }
}

/**
 * Handle doctor messages
 * Routes to DoctorFlowHandler for portal operations
 */
async function handleDoctorMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    name: string,
    text: string,
    normalizedMessage: string,
    session: WhatsAppSession
): Promise<void> {
    debug("handleDoctorMessage", `Doctor message from ${phone}`, {
        state: session.state
    });

    try {
        // Create message object
        const message: ExtractedMessage = {
            type: "text",
            text: text
        };

        // Route to doctor handler
        const handler = new DoctorFlowHandler(supabase, whatsappClient);
        await handler.handle(session, message);
    } catch (error) {
        debug("handleDoctorMessage", "Error in doctor flow", {
            error: error instanceof Error ? error.message : String(error)
        });

        await whatsappClient.sendTextMessage(
            phone,
            "Sorry, an error occurred. Please try again later.",
            supabase
        );
    }
}

/**
 * Handle home collection messages
 * Routes to HomeCollectionHandler for blood collection requests
 */
async function handleHomeCollectionMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    name: string,
    text: string,
    normalizedMessage: string,
    session: WhatsAppSession
): Promise<void> {
    debug("handleHomeCollectionMessage", `Collector message from ${phone}`);

    try {
        // Create message object
        const message: ExtractedMessage = {
            type: "text",
            text: text
        };

        // Route to home collection handler
        const handler = new HomeCollectionHandler(supabase, whatsappClient);
        await handler.handle(session, message);
    } catch (error) {
        debug("handleHomeCollectionMessage", "Error in home collection flow", {
            error: error instanceof Error ? error.message : String(error)
        });

        await whatsappClient.sendTextMessage(
            phone,
            "Sorry, an error occurred. Please try again later.",
            supabase
        );
    }
}

/**
 * Handle patient messages
 * Routes to PatientFlowHandler for appointment booking and management
 */
async function handlePatientMessage(
    supabase: SupabaseClient,
    whatsappClient: WhatsAppClient,
    phone: string,
    name: string,
    text: string,
    normalizedMessage: string,
    session: WhatsAppSession,
    latitude?: number,
    longitude?: number
): Promise<void> {
    debug("handlePatientMessage", `Patient message from ${phone}`, {
        state: session.state
    });

    try {
        // Create message object with location if provided
        const message: ExtractedMessage = {
            type: "text",
            text: text,
            latitude,
            longitude
        };

        // Route to patient handler
        const handler = new PatientFlowHandler(supabase, whatsappClient);
        await handler.handle(session, message);
    } catch (error) {
        debug("handlePatientMessage", "Error in patient flow", {
            error: error instanceof Error ? error.message : String(error)
        });

        await whatsappClient.sendTextMessage(
            phone,
            "Sorry, an error occurred. Please try again later.",
            supabase
        );
    }
}
