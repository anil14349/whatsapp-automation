import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppSession } from "../types.ts";
import { BUTTON_IDS } from "../button-ids.ts";
import { debug } from "../logger.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";

/**
 * Appointment History Handler
 * Displays patient's past appointments in paginated format
 */

export class AppointmentHistoryHandler {
    private supabase: SupabaseClient;
    private whatsappClient: any;
    private supabaseClient: MultiClinicSupabaseClient;
    private clinicId = "";

    constructor(supabase: SupabaseClient, whatsappClient: any) {
        this.supabase = supabase;
        this.whatsappClient = whatsappClient;
        this.supabaseClient = new MultiClinicSupabaseClient(
            Deno.env.get("SUPABASE_URL") || "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            supabase
        );
    }

    /**
     * Handle appointment history state
     */
    async handle(
        phone: string,
        session: WhatsAppSession,
        messageText: string
    ): Promise<void> {
        try {
            const normalizedMessage = messageText.toLowerCase().trim();
            const page = session.data?.historyPage || 0;
            // Session writes must never touch this phone's row at another clinic.
            this.clinicId = session.clinic_id;

            // Check for navigation
            if (normalizedMessage === "nav_more" || messageText.includes(BUTTON_IDS.NAVIGATION.MORE)) {
                await this.showNextPage(phone, session, page + 1);
                return;
            }

            if (normalizedMessage === "nav_earlier" || messageText.includes(BUTTON_IDS.NAVIGATION.EARLIER)) {
                if (page > 0) {
                    await this.showNextPage(phone, session, page - 1);
                }
                return;
            }

            if (normalizedMessage === "nav_menu" || messageText.includes(BUTTON_IDS.NAVIGATION.MAIN_MENU)) {
                // Return to main menu
                await this.updateSession(phone, "MAIN_MENU", {});
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Returning to main menu...\n\nSend 'Hi' to start."
                );
                return;
            }

            // Default: show first page
            await this.showAppointmentHistory(phone, session, 0);
        } catch (error) {
            debug("appointmentHistory", "Error in handler", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                "Sorry, something went wrong. Please try again later."
            );
        }
    }

    /**
     * Show appointment history with pagination
     */
    private async showAppointmentHistory(
        phone: string,
        session: WhatsAppSession,
        page: number
    ): Promise<void> {
        try {
            const pageSize = 3; // Show 3 appointments per page
            const offset = page * pageSize;

            // Get total count
            const totalCount = await this.supabaseClient.getPatientAppointmentHistoryCount(
                session.clinic_id,
                phone
            );

            if (totalCount === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "📋 You don't have any completed appointments yet.\n\nBook an appointment to get started!"
                );

                await this.updateSession(phone, "MAIN_MENU", {});
                return;
            }

            // Get appointments for this page
            const history = await this.supabaseClient.getPatientAppointmentHistory(
                session.clinic_id,
                phone,
                pageSize,
                offset
            );

            // Build message
            let message = `📋 Your Appointment History\n\n`;

            for (let i = 0; i < history.length; i++) {
                const apt = history[i];
                message +=
                    `${i + 1}. 🩺 ${apt.doctor_name}\n` +
                    `   📅 ${this.formatDate(apt.appointment_date)}\n` +
                    `   🕐 ${apt.appointment_time}\n` +
                    `   ✅ Completed\n\n`;
            }

            message += `📄 Page ${page + 1} of ${Math.ceil(totalCount / pageSize)}`;

            // Build buttons for navigation
            const buttons = [];

            if (page > 0) {
                buttons.push({ id: BUTTON_IDS.NAVIGATION.EARLIER, title: "← Earlier" });
            }

            if (offset + pageSize < totalCount) {
                buttons.push({ id: BUTTON_IDS.NAVIGATION.MORE, title: "More →" });
            }

            buttons.push({ id: BUTTON_IDS.NAVIGATION.MAIN_MENU, title: "Back to Menu" });

            // Send message
            if (buttons.length > 1) {
                await this.whatsappClient.sendInteractiveButtonMessage(phone, message, buttons);
            } else {
                await this.whatsappClient.sendTextMessage(phone, message);
            }

            // Update session with current page
            await this.updateSession(phone, "MY_APPOINTMENTS", {
                historyPage: page
            });
        } catch (error) {
            debug("appointmentHistory", "Error showing history", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                "❌ Failed to load appointment history. Please try again later."
            );
        }
    }

    /**
     * Show next page of appointments
     */
    private async showNextPage(
        phone: string,
        session: WhatsAppSession,
        page: number
    ): Promise<void> {
        await this.showAppointmentHistory(phone, session, page);
    }

    /**
     * Format date for display (YYYY-MM-DD → DD Mon, YYYY)
     */
    private formatDate(dateString: string): string {
        try {
            const date = new Date(dateString);
            const formatter = new Intl.DateTimeFormat("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric"
            });
            return formatter.format(date);
        } catch {
            return dateString;
        }
    }

    /**
     * Helper: Update session state
     */
    private async updateSession(phone: string, newState: string, data?: any): Promise<void> {
        const { error } = await this.supabase
            .from("whatsapp_sessions")
            .update({
                state: newState,
                data: data || {},
                updated_at: new Date().toISOString()
            })
            .eq("phone", phone)
            .eq("clinic_id", this.clinicId);

        if (error) {
            debug("appointmentHistory", "Error updating session", { error: error.message });
        }
    }
}
