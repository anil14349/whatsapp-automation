import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import { BUTTON_IDS, isValidConfirmationButton } from "../button-ids.ts";
import { formatClockTime, formatLongDate } from "../appointment-format.ts";
import { debug } from "../logger.ts";
import { sendProactive } from "../proactive.ts";
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
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            supabase
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
        const language = isEn ? "EN" : "HI";

        // A whole date can be full, in which case there is no specific time.
        const day = formatLongDate(date, language);
        const slotText = !time || time === "ANY" ? day : `${day} at ${formatClockTime(time)}`;

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
        buttonId: string,
        /** The booking flow's own day list, so there is only one of them. */
        offerAnotherDate?: (exclude: string) => Promise<void>
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
                        : `🕐 ${formatClockTime(String(session.data?.time))}\n`;

                const whenDate = formatLongDate(
                    String(session.data?.date ?? ""),
                    isEn ? "EN" : "HI"
                );

                await this.whatsappClient.sendTextMessage(
                    phone,
                    isEn
                        ? `✅ You've been added to the waitlist!\n\n` +
                          `🩺 Doctor: ${session.data?.doctorName}\n` +
                          `📅 Date: ${whenDate}\n` +
                          whenText +
                          `\nPosition: #${result.position}\n\n` +
                          `We'll notify you on WhatsApp if a slot opens up.`
                        : `✅ आपको प्रतीक्षा सूची में जोड़ दिया गया है!\n\n` +
                          `🩺 डॉक्टर: ${session.data?.doctorName}\n` +
                          `📅 तारीख: ${whenDate}\n` +
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
        } else {
            // go_back passes isValidConfirmationButton, matched neither branch
            // above, and fell out of the function having sent nothing: the
            // patient tapped Back and the conversation stopped dead. Treated as
            // "no", which is where Back was going anyway.

            // Read before the session is rewritten: the day being refused lives
            // in the data that is about to be replaced.
            const refused = String(session.data?.date ?? "");

            await this.updateSession(phone, "BOOK_DATE", {
                language: session.data?.language || "EN",
                selectedDoctorId: session.data?.doctorId,
                selectedDoctorName: session.data?.doctorName
            }, session.clinic_id);

            // The day they were just refused is left off the list.
            if (offerAnotherDate) {
                await offerAnotherDate(refused);
                return true;
            }

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

            const freed = await sendProactive(
                this.whatsappClient,
                data.phone,
                isEn
                    ? `📋 The slot you were waiting for is now free:\n\n` +
                      `📅 ${date}\n` +
                      timeLine +
                      `\nTap below to book it.`
                    : `📋 जिस स्लॉट का आप इंतजार कर रहे थे वह अब खाली है:\n\n` +
                      `📅 ${date}\n` +
                      timeLine +
                      `\nबुक करने के लिए नीचे दबाएं।`,
                {
                    key: "waitlist_slot_available",
                    language: patient?.preferred_language ?? "EN",
                    parameters: [date, !time || time === "ANY" ? "any time" : time]
                },
                {
                    // It used to say 'Send "Hi" to start booking', which works
                    // but asks someone to type a password to their own slot.
                    buttons: [
                        {
                            id: BUTTON_IDS.PATIENT_MENU.BOOK,
                            title: isEn ? "Book" : "बुक करें"
                        }
                    ]
                }
            );

            // Their place is only given up once they have actually been told.
            if (!freed.delivered) {
                debug("waitlistHandler", "Could not reach the waitlisted patient", {
                    phone: data.phone,
                    reason: freed.reason
                });
                return;
            }

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
