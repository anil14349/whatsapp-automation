import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
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
        const isEn = (session.data?.language || "EN") === "EN";

        // A whole date can be full, in which case there is no specific time.
        const slotText = !time || time === "ANY" ? date : `${date} ${time}`;

        const message = isEn
            ? `❌ No slots available for ${doctorName} on ${slotText}.\n\n` +
              `Would you like to join the waitlist? We'll notify you if a slot becomes available.`
            : `❌ ${slotText} को ${doctorName} के लिए कोई स्लॉट उपलब्ध नहीं है।\n\n` +
              `क्या आप प्रतीक्षा सूची में शामिल होना चाहेंगे? स्लॉट खाली होने पर हम आपको सूचित करेंगे।`;

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            message,
            [
                { id: "waitlist_yes", title: isEn ? "Join Waitlist" : "सूची में जुड़ें" },
                { id: "waitlist_no", title: isEn ? "Pick Another Date" : "दूसरी तारीख चुनें" }
            ],
            this.supabase
        );
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

        const isEn = (session.data?.language || "EN") === "EN";

        if (!isValidConfirmationButton(buttonId) && buttonId !== "waitlist_yes" && buttonId !== "waitlist_no") {
            await this.whatsappClient.sendTextMessage(
                phone,
                isEn
                    ? "Please tap a button to confirm."
                    : "कृपया पुष्टि के लिए बटन दबाएं।",
                this.supabase
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
                const whenText =
                    !session.data?.time || session.data?.time === "ANY"
                        ? ""
                        : `🕐 ${session.data?.time}\n`;

                await this.whatsappClient.sendTextMessage(
                    phone,
                    isEn
                        ? `✅ You've been added to the waitlist!\n\n` +
                          `🩺 Doctor: ${session.data?.doctorName}\n` +
                          `📅 Date: ${session.data?.date}\n` +
                          whenText +
                          `\nPosition: #${result.position}\n\n` +
                          `We'll notify you on WhatsApp if a slot opens up.`
                        : `✅ आपको प्रतीक्षा सूची में जोड़ दिया गया है!\n\n` +
                          `🩺 डॉक्टर: ${session.data?.doctorName}\n` +
                          `📅 तारीख: ${session.data?.date}\n` +
                          whenText +
                          `\nक्रम संख्या: #${result.position}\n\n` +
                          `स्लॉट खाली होने पर हम आपको WhatsApp पर सूचित करेंगे।`,
                    this.supabase
                );

                // Reset session to main menu
                await this.updateSession(phone, "MAIN_MENU", {
                    language: session.data?.language || "EN"
                }, session.clinic_id);
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    isEn
                        ? `❌ Could not add you to the waitlist. Please try again.`
                        : `❌ आपको प्रतीक्षा सूची में नहीं जोड़ा जा सका। कृपया पुनः प्रयास करें।`,
                    this.supabase
                );
            }
        } else if (buttonId === "waitlist_no" || buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            // Key names must match what PatientFlowHandler reads in BOOK_DATE.
            await this.updateSession(phone, "BOOK_DATE", {
                language: session.data?.language || "EN",
                selectedDoctorId: session.data?.doctorId,
                selectedDoctorName: session.data?.doctorName
            }, session.clinic_id);

            await this.whatsappClient.sendTextMessage(
                phone,
                isEn
                    ? `Please select a different date (YYYY-MM-DD):`
                    : `कृपया दूसरी तारीख चुनें (YYYY-MM-DD):`,
                this.supabase
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
            const { data: patient } = await this.supabase
                .from("patients")
                .select("preferred_language")
                .eq("phone", data.phone)
                .eq("clinic_id", clinicId)
                .maybeSingle();

            const isEn = (patient?.preferred_language || "EN") === "EN";
            const timeLine = !time || time === "ANY" ? "" : `🕐 ${time}\n`;

            await this.whatsappClient.sendTextMessage(
                data.phone,
                isEn
                    ? `🎉 Good news!\n\n` +
                      `A slot has become available that you were waiting for.\n\n` +
                      `📅 Date: ${date}\n` +
                      timeLine +
                      `\nWould you like to book this appointment?\n\n` +
                      `Send "Hi" to start booking.`
                    : `🎉 खुशखबरी!\n\n` +
                      `जिस स्लॉट का आप इंतज़ार कर रहे थे वह खाली हो गया है।\n\n` +
                      `📅 तारीख: ${date}\n` +
                      timeLine +
                      `\nक्या आप यह नियुक्ति बुक करना चाहेंगे?\n\n` +
                      `बुकिंग शुरू करने के लिए "Hi" भेजें।`,
                this.supabase
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
    private async updateSession(
        phone: string,
        newState: string,
        data: any,
        clinicId: string
    ): Promise<void> {
        const { error } = await this.supabase
            .from("whatsapp_sessions")
            .update({
                state: newState,
                data: data || {},
                updated_at: new Date().toISOString()
            })
            .eq("phone", phone)
            .eq("clinic_id", clinicId);

        if (error) {
            debug("waitlistHandler", "Error updating session", { error: error.message });
        }
    }
}
