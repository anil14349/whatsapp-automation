import { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import { BUTTON_IDS, isValidConfirmationButton } from "../button-ids.ts";
import { debug } from "../logger.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";

/**
 * Waitlist Handler - Manages appointment waitlist requests
 * Triggered when patient tries to book a full time slot
 * Allows patient to join waitlist for that slot
 */

export class WaitlistHandler {
    private supabase: SupabaseClient;
    private whatsappClient: any;
    private supabaseClient: MultiClinicSupabaseClient;

    constructor(supabase: SupabaseClient, whatsappClient: any) {
        this.supabase = supabase;
        this.whatsappClient = whatsappClient;
        this.supabaseClient = new MultiClinicSupabaseClient(
            Deno.env.get("SUPABASE_URL") || "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
        );
    }

    /**
     * Show waitlist offer when slot is full
     */
    async showWaitlistOffer(
        phone: string,
        doctorId: string,
        date: string,
        time: string,
        doctorName: string,
        session: WhatsAppSession
    ): Promise<void> {
        const message =
            `❌ No slots available for ${doctorName} on ${date} at ${time}.\n\n` +
            `Would you like to join the waitlist? We'll notify you if a slot becomes available.`;

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: "waitlist_yes", title: "Yes, Add to Waitlist" },
            { id: "waitlist_no", title: "Choose Different Time" }
        ]);
    }

    /**
     * Handle waitlist confirmation
     */
    async handleWaitlistConfirm(
        phone: string,
        session: WhatsAppSession,
        buttonId: string
    ): Promise<boolean> {
        // GUARD: Explicit state validation
        if (session.state !== "WAITLIST_CONFIRM") {
            return false;
        }

        if (!isValidConfirmationButton(buttonId) && buttonId !== "waitlist_yes" && buttonId !== "waitlist_no") {
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please tap a button to confirm."
            );
            return true;
        }

        if (buttonId === "waitlist_yes" || buttonId === BUTTON_IDS.CONFIRMATION.YES) {
            // Add to waitlist
            const result = await this.addToWaitlist(
                phone,
                session.data?.doctorId,
                session.data?.date,
                session.data?.time,
                session.clinic_id
            );

            if (result.success) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    `✅ You've been added to the waitlist!\n\n` +
                        `🩺 Doctor: ${session.data?.doctorName}\n` +
                        `📅 Requested Date: ${session.data?.date}\n` +
                        `🕐 Requested Time: ${session.data?.time}\n\n` +
                        `Position: #${result.position}\n\n` +
                        `We'll notify you via WhatsApp if this slot becomes available.`
                );

                // Reset session to main menu
                await this.updateSession(phone, "MAIN_MENU", {});
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    `❌ Failed to add to waitlist: ${result.error}`
                );
            }
        } else if (buttonId === "waitlist_no" || buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            // Return to book date to choose different time
            await this.updateSession(phone, "BOOK_DATE", {
                doctorId: session.data?.doctorId,
                doctorName: session.data?.doctorName
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                `Please select a different date:`
            );
        }

        return true;
    }

    /**
     * Add patient to waitlist
     */
    private async addToWaitlist(
        phone: string,
        doctorId: string,
        date: string,
        time: string,
        clinicId: string
    ): Promise<{ success: boolean; position?: number; error?: string }> {
        try {
            // Check if already on waitlist for this slot
            const { data: existing, error: checkError } = await this.supabase
                .from("waitlist")
                .select("*")
                .eq("clinic_id", clinicId)
                .eq("phone", phone)
                .eq("doctor_id", doctorId)
                .eq("date", date)
                .eq("time", time)
                .eq("status", "PENDING")
                .maybeSingle();

            if (existing) {
                return {
                    success: true,
                    position: existing.position,
                    error: undefined
                };
            }

            // Get current position (count of pending waitlist entries for this slot)
            const { count } = await this.supabase
                .from("waitlist")
                .select("*", { count: "exact" })
                .eq("clinic_id", clinicId)
                .eq("doctor_id", doctorId)
                .eq("date", date)
                .eq("time", time)
                .eq("status", "PENDING");

            const position = (count || 0) + 1;

            // Insert into waitlist
            const { error } = await this.supabase.from("waitlist").insert({
                clinic_id: clinicId,
                phone,
                doctor_id: doctorId,
                date,
                time,
                position,
                status: "PENDING",
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
            });

            if (error) {
                debug("waitlistHandler", "Error adding to waitlist", {
                    error: error.message
                });

                return {
                    success: false,
                    error: error.message
                };
            }

            debug("waitlistHandler", "Added to waitlist", {
                phone,
                doctorId,
                date,
                time,
                position
            });

            return {
                success: true,
                position
            };
        } catch (error) {
            debug("waitlistHandler", "Error in addToWaitlist", {
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Notify next person on waitlist when slot becomes available
     * Called when appointment is cancelled
     */
    async notifyWaitlistOnCancellation(
        doctorId: string,
        date: string,
        time: string,
        clinicId: string
    ): Promise<void> {
        try {
            // Get first person on waitlist
            const { data, error } = await this.supabase
                .from("waitlist")
                .select("*")
                .eq("clinic_id", clinicId)
                .eq("doctor_id", doctorId)
                .eq("date", date)
                .eq("time", time)
                .eq("status", "PENDING")
                .order("position", { ascending: true })
                .limit(1)
                .maybeSingle();

            if (!data) {
                debug("waitlistHandler", "No one on waitlist to notify");
                return;
            }

            // Notify the patient
            await this.whatsappClient.sendTextMessage(
                data.phone,
                `🎉 Good news!\n\n` +
                    `A slot has become available that you were waiting for.\n\n` +
                    `📅 Date: ${date}\n` +
                    `🕐 Time: ${time}\n\n` +
                    `Would you like to book this appointment?\n\n` +
                    `Send "Hi" to start booking.`
            );

            // Mark as notified
            await this.supabase
                .from("waitlist")
                .update({
                    status: "NOTIFIED",
                    notified_at: new Date().toISOString()
                })
                .eq("id", data.id);

            debug("waitlistHandler", "Notified waitlist patient", {
                phone: data.phone,
                doctorId,
                date,
                time
            });
        } catch (error) {
            debug("waitlistHandler", "Error notifying waitlist", {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Remove patient from waitlist (if they manually cancel)
     */
    async removeFromWaitlist(
        phone: string,
        doctorId: string,
        date: string,
        time: string,
        clinicId: string
    ): Promise<{ success: boolean }> {
        try {
            const { error } = await this.supabase
                .from("waitlist")
                .update({ status: "CANCELLED" })
                .eq("clinic_id", clinicId)
                .eq("phone", phone)
                .eq("doctor_id", doctorId)
                .eq("date", date)
                .eq("time", time);

            if (error) {
                debug("waitlistHandler", "Error removing from waitlist", {
                    error: error.message
                });

                return { success: false };
            }

            return { success: true };
        } catch (error) {
            debug("waitlistHandler", "Error in removeFromWaitlist", {
                error: error instanceof Error ? error.message : String(error)
            });

            return { success: false };
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
            .eq("phone", phone);

        if (error) {
            debug("waitlistHandler", "Error updating session", { error: error.message });
        }
    }
}
