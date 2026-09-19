import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import { debug } from "../logger.ts";

/**
 * Feedback Handler - post-appointment rating and comments.
 * Mirrors the monolith's 1-5 rating plus optional free-text comments.
 */

const RATING_LABELS: Array<{ value: number; label: string; labelHi: string }> = [
    { value: 5, label: "⭐⭐⭐⭐⭐ Excellent", labelHi: "⭐⭐⭐⭐⭐ उत्कृष्ट" },
    { value: 4, label: "⭐⭐⭐⭐ Very Good", labelHi: "⭐⭐⭐⭐ बहुत अच्छा" },
    { value: 3, label: "⭐⭐⭐ Good", labelHi: "⭐⭐⭐ अच्छा" },
    { value: 2, label: "⭐⭐ Fair", labelHi: "⭐⭐ ठीक-ठाक" },
    { value: 1, label: "⭐ Poor", labelHi: "⭐ खराब" }
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
            const { data: session } = await this.supabase
                .from("whatsapp_sessions")
                .select("state, data")
                .eq("phone", patientPhone)
                .eq("clinic_id", clinicId)
                .maybeSingle();

            // Never interrupt someone mid-flow; their booking context would be
            // lost. Leaving no feedback row means the scheduler retries later.
            const idleStates = ["LANGUAGE_SELECT", "MAIN_MENU", ""];
            const isIdle = !session || idleStates.includes(session.state || "");

            if (!isIdle) {
                debug("feedback", "Patient is mid-flow, survey deferred", {
                    appointmentId,
                    state: session.state
                });

                return false;
            }

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

            const language = session?.data?.language || "EN";
            const isEn = language === "EN";

            await this.whatsappClient.sendInteractiveListMessage(
                patientPhone,
                isEn
                    ? `⭐ How was your experience with Dr. ${doctorName}?\n\nYour feedback helps us improve.`
                    : `⭐ डॉ. ${doctorName} के साथ आपका अनुभव कैसा रहा?\n\nआपकी प्रतिक्रिया से हमें सुधार करने में मदद मिलती है।`,
                isEn ? "Rate us" : "रेटिंग दें",
                [
                    {
                        title: isEn ? "Your rating" : "आपकी रेटिंग",
                        rows: RATING_LABELS.map((item) => ({
                            id: `feedback_rating_${item.value}`,
                            title: isEn ? item.label : item.labelHi
                        }))
                    }
                ],
                this.supabase
            );

            await this.supabase
                .from("whatsapp_sessions")
                .update({
                    state: "FEEDBACK_RATING",
                    data: {
                        appointmentId,
                        doctorName,
                        language: session?.data?.language || "EN"
                    },
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
        const isEn = (session.data?.language || "EN") === "EN";

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            await this.whatsappClient.sendTextMessage(
                phone,
                isEn
                    ? "Please tap one of the star ratings, or reply with a number from 1 to 5."
                    : "कृपया कोई एक रेटिंग चुनें, या 1 से 5 के बीच कोई संख्या भेजें।",
                this.supabase
            );
            return;
        }

        const appointmentId = session.data?.appointmentId;

        await this.supabase
            .from("feedback")
            .update({ rating, status: "RATED", submitted_at: new Date().toISOString() })
            .eq("appointment_id", appointmentId)
            .eq("clinic_id", session.clinic_id);

        await this.updateSession(phone, "FEEDBACK_COMMENTS", {
            ...session.data,
            rating
        }, session.clinic_id);

        // "Would you like to add a comment?" offered only No thanks, because
        // saying yes means typing and a button cannot do that. Asked on a real
        // handset, the question had no answer but the negative one.
        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            isEn
                ? `Thank you for rating us ${rating}/5!\n\nIf you would like to add a comment, type it here. Otherwise tap No thanks.`
                : `${rating}/5 रेटिंग देने के लिए धन्यवाद!\n\nकोई टिप्पणी जोड़नी हो तो यहाँ लिखें, वरना "नहीं, धन्यवाद" चुनें।`,
            [{ id: FEEDBACK_SKIP_ID, title: isEn ? "No thanks" : "नहीं, धन्यवाद" }],
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
                .eq("appointment_id", appointmentId)
                .eq("clinic_id", session.clinic_id);
        }

        await this.updateSession(phone, "MAIN_MENU", {
            language: session.data?.language || "EN"
        }, session.clinic_id);

        await this.whatsappClient.sendTextMessage(
            phone,
            (session.data?.language || "EN") === "EN"
                ? skipped
                    ? "Thank you for your feedback! 🙏"
                    : "Thank you! Your comments have been shared with the clinic. 🙏"
                : skipped
                  ? "आपकी प्रतिक्रिया के लिए धन्यवाद! 🙏"
                  : "धन्यवाद! आपकी टिप्पणी क्लीनिक को भेज दी गई है। 🙏",
            this.supabase
        );
    }

    private async updateSession(
        phone: string,
        newState: string,
        data: any,
        clinicId: string
    ): Promise<void> {
        const update: Record<string, unknown> = {
            state: newState,
            updated_at: new Date().toISOString()
        };

        if (data !== undefined) {
            update.data = data;
        }

        await this.supabase
            .from("whatsapp_sessions")
            .update(update)
            .eq("phone", phone)
            .eq("clinic_id", clinicId);
    }
}
