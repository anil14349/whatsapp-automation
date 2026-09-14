import { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { ProcessMessageContext, WhatsAppSession, ExtractedMessage } from "./types.ts";
import { info, debug } from "./logger.ts";
import { PatientFlowHandler } from "./handlers/patient-handler.ts";
import { DoctorFlowHandler } from "./handlers/doctor-handler.ts";
import { HomeCollectionHandler } from "./handlers/home-collection-handler.ts";

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

    const session = await getOrCreateSession(supabase, senderPhone);

    debug("processMessage", "Session loaded", {
        state: session.state,
        role: session.role
    });

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
 * Get or create a session for the given phone
 */
async function getOrCreateSession(
    supabase: SupabaseClient,
    phone: string
): Promise<WhatsAppSession> {
    try {
        // Try to fetch existing session
        const { data: existing } = await supabase
            .from("whatsapp_sessions")
            .select("*")
            .eq("phone", phone)
            .maybeSingle();

        if (existing) {
            // Update last activity
            await supabase
                .from("whatsapp_sessions")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", existing.id);

            return existing;
        }

        // Create new session
        const { data: newSession } = await supabase
            .from("whatsapp_sessions")
            .insert({
                phone,
                role: "PATIENT",
                state: "LANGUAGE_SELECT",
                data: {},
                metadata: {}
            })
            .select()
            .single();

        return newSession as WhatsAppSession;
    } catch (error) {
        console.error("Failed to get/create session:", error);

        // Return default session (should not happen in production)
        return {
            id: "default",
            phone,
            role: "PATIENT",
            state: "LANGUAGE_SELECT",
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
            .eq("phone", phone);
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
    debug("handleGreeting", `Greeting from ${phone}`);

    // Reset to main flow
    await updateSession(supabase, phone, {
        state: "LANGUAGE_SELECT",
        data: {}
    });

    // Send greeting response
    await whatsappClient.sendTextMessage(
        phone,
        "👋 Welcome to ABC Clinic!\n\nPlease select your language:\n\n1️⃣ English\n2️⃣ हिंदी\n3️⃣ తెలుగు",
        supabase
    );
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
