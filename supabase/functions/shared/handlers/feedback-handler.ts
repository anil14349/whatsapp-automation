import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import { debug } from "../logger.ts";

/**
 * Feedback Handler - post-appointment rating and comments.
 * Mirrors the monolith's 1-5 rating plus optional free-text comments.
 */

const RATING_LABELS: Array<{ value: number; label: string }> = [
    { value: 5, label: "⭐⭐⭐⭐⭐ Excellent" },
    { value: 4, label: "⭐⭐⭐⭐ Very Good" },
    { value: 3, label: "⭐⭐⭐ Good" },
    { value: 2, label: "⭐⭐ Fair" },
    { value: 1, label: "⭐ Poor" }
];

export const FEEDBACK_SKIP_ID = "feedback_skip";

export class FeedbackHandler {
    private supabase: SupabaseClient;
    private whatsappClient: any;

    constructor(supabase: SupabaseClient, whatsappClient: any) {
        this.supabase = supabase;
        this.whatsappClient = whatsappClient;
    }

    /**
     * Send the survey and open a PENDING row. Returns false if already sent.
     */
    async sendFeedbackSurvey(
        clinicId: string,
        appointmentId: string,
        patientPhone: string,
        patientName: string,
        doctorName: string
    ): Promise<boolean> {
        try {
            const { error } = await this.supabase.from("feedback").insert({
                clinic_id: clinicId,
                appointment_id: appointmentId,
                patient_phone: patientPhone,
                patient_name: patientName,
                doctor_name: doctorName,
                status: "PENDING"
            });

            // Unique appointment_id means the survey already went out.
            if (error) {
                debug("feedback", "Survey not queued", { appointmentId, error: error.message });
                return false;
            }

            await this.whatsappClient.sendInteractiveListMessage(
                patientPhone,
                `⭐ How was your experience with Dr. ${doctorName}?\n\nYour feedback helps us improve.`,
                "Rate us",
                [
                    {
                        title: "Your rating",
                        rows: RATING_LABELS.map((item) => ({
                            id: `feedback_rating_${item.value}`,
                            title: item.label
                        }))
                    }
                ],
                this.supabase
            );

            await this.supabase
                .from("whatsapp_sessions")
                .update({
                    state: "FEEDBACK_RATING",
                    data: { appointmentId, doctorName },
                    updated_at: new Date().toISOString()
                })
                .eq("phone", patientPhone)
                .eq("clinic_id", clinicId);

            return true;
        } catch (error) {
            debug("feedback", "Failed to send survey", {
                appointmentId,
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }

    /**
     * FEEDBACK_RATING - patient picks 1-5
     */
    async handleRating(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const reply = message.text?.trim() || "";
        const fromRow = reply.startsWith("feedback_rating_") ? reply.substring(16) : reply;
        const rating = Number(fromRow);

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please tap one of the star ratings, or reply with a number from 1 to 5.",
                this.supabase
            );
            return;
        }

        const appointmentId = session.data?.appointmentId;

        await this.supabase
            .from("feedback")
            .update({ rating, status: "RATED", submitted_at: new Date().toISOString() })
            .eq("appointment_id", appointmentId);

        await this.updateSession(phone, "FEEDBACK_COMMENTS", {
            ...session.data,
            rating
        });

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            `Thank you for rating us ${rating}/5!\n\nWould you like to add a comment?`,
            [{ id: FEEDBACK_SKIP_ID, title: "No thanks" }],
            this.supabase
        );
    }

    /**
     * FEEDBACK_COMMENTS - optional free text
     */
    async handleComments(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const reply = message.text?.trim() || "";
        const appointmentId = session.data?.appointmentId;
        const skipped = reply === FEEDBACK_SKIP_ID || reply.length === 0;

        if (!skipped) {
            await this.supabase
                .from("feedback")
                .update({
                    comments: reply.substring(0, 1000),
                    status: "COMPLETE",
                    submitted_at: new Date().toISOString()
                })
                .eq("appointment_id", appointmentId);
        }

        await this.updateSession(phone, "MAIN_MENU", {
            language: session.data?.language || "EN"
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            skipped
                ? "Thank you for your feedback! 🙏"
                : "Thank you! Your comments have been shared with the clinic. 🙏",
            this.supabase
        );
    }

    private async updateSession(phone: string, newState: string, data?: any): Promise<void> {
        const update: Record<string, unknown> = {
            state: newState,
            updated_at: new Date().toISOString()
        };

        if (data !== undefined) {
            update.data = data;
        }

        await this.supabase.from("whatsapp_sessions").update(update).eq("phone", phone);
    }
}
