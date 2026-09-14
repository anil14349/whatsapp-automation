import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppMessage, WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidLanguageButton, isValidPatientMenuButton, isValidConfirmationButton, isValidDateSelectButton } from "../button-ids.ts";
import {
    bookAppointment,
    cancelAppointment,
    rescheduleAppointment,
    getAvailableSlots
} from "../appointments.ts";
import { createAppointmentReminders, markReminderAsSkipped } from "../appointment-reminders.ts";
import { debug, info, recordAuditEvent } from "../logger.ts";
import { isValidPatientName, normalizePhoneNumber, isValidBookingDate, formatBookingDateErrorMessage } from "../validators.ts";
import { AppointmentHistoryHandler } from "./appointment-history-handler.ts";
import { getClinicConfig, getClinicGreeting } from "../clinic-config.ts";

/**
 * Patient Flow Handler - Manages all patient conversation states
 * Handles: booking, viewing, cancelling, and rescheduling appointments
 */

export class PatientFlowHandler {
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
     * Main handler - Routes message to appropriate state handler
     */
    async handle(session: WhatsAppSession, message: ExtractedMessage): Promise<void> {
        try {
            const state = session.state || "LANGUAGE_SELECT";
            const phone = session.phone;

            debug("patientFlow", `Processing state: ${state}`, { phone, messageText: message.text });

            switch (state) {
                case "LANGUAGE_SELECT":
                    await this.handleLanguageSelect(phone, message, session);
                    break;

                case "MAIN_MENU":
                    await this.handleMainMenu(phone, message, session);
                    break;

                case "BOOK_DOCTOR":
                    await this.handleBookDoctor(phone, message, session);
                    break;

                case "BOOK_DATE":
                    await this.handleBookDate(phone, message, session);
                    break;

                case "BOOK_DATE_CUSTOM":
                    await this.handleBookDateCustom(phone, message, session);
                    break;

                case "BOOK_TIME":
                    await this.handleBookTime(phone, message, session);
                    break;

                case "BOOK_NAME":
                    await this.handleBookName(phone, message, session);
                    break;

                case "BOOK_CONFIRM":
                    await this.handleBookConfirm(phone, message, session);
                    break;

                case "MY_APPOINTMENTS":
                    await this.handleMyAppointments(phone, message, session);
                    break;

                case "APPOINTMENT_HISTORY":
                    await this.handleAppointmentHistory(phone, message, session);
                    break;

                case "CANCEL_SELECT":
                    await this.handleCancelSelect(phone, message, session);
                    break;

                case "CANCEL_CONFIRM":
                    await this.handleCancelConfirm(phone, message, session);
                    break;

                case "RESCHEDULE_SELECT":
                    await this.handleRescheduleSelect(phone, message, session);
                    break;

                case "RESCHEDULE_DATE":
                    await this.handleRescheduleDate(phone, message, session);
                    break;

                case "RESCHEDULE_TIME":
                    await this.handleRescheduleTime(phone, message, session);
                    break;

                case "RESCHEDULE_CONFIRM":
                    await this.handleRescheduleConfirm(phone, message, session);
                    break;

                default:
                    await this.handleMainMenu(phone, message, session);
            }
        } catch (error) {
            debug("patientFlow", "Error in flow handler", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                session.phone,
                "Sorry, something went wrong. Please try again later."
            );
        }
    }

    /**
     * LANGUAGE_SELECT - User selects preferred language
     */
    private async handleLanguageSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "LANGUAGE_SELECT") {
            await this.handleMainMenu(phone, message, session);
            return;
        }

        const buttonId = message.text.trim();

        // Validate button ID
        if (!isValidLanguageButton(buttonId)) {
            await this.whatsappClient.sendInteractiveButtonMessage(
                phone,
                "Welcome to ABC Clinic! Please select your language:\n\nðŸ‡¬ðŸ‡§ English\nðŸ‡®ðŸ‡³ à¤¹à¤¿à¤‚à¤¦à¥€",
                [
                    { id: BUTTON_IDS.LANGUAGE.EN, title: "ðŸ‡¬ðŸ‡§ English" },
                    { id: BUTTON_IDS.LANGUAGE.HI, title: "ðŸ‡®ðŸ‡³ à¤¹à¤¿à¤‚à¤¦à¥€" }
                ]
            );
            return;
        }

        // Parse selected language
        const selectedLanguage = buttonId === BUTTON_IDS.LANGUAGE.EN ? "EN" : "HI";

        // Update session
        await this.updateSession(phone, "MAIN_MENU", { language: selectedLanguage });

        // Send welcome message
        if (selectedLanguage === "EN") {
            await this.whatsappClient.sendTextMessage(
                phone,
                "ðŸ‘‹ Welcome to ABC Clinic!\n\nWhat would you like to do today?"
            );
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                "ðŸ‘‹ ABC à¤•à¥à¤²à¥€à¤¨à¤¿à¤• à¤®à¥‡à¤‚ à¤†à¤ªà¤•à¤¾ à¤¸à¥à¤µà¤¾à¤—à¤¤ à¤¹à¥ˆ!\n\nà¤†à¤œ à¤†à¤ª à¤•à¥à¤¯à¤¾ à¤•à¤°à¤¨à¤¾ à¤šà¤¾à¤¹à¤¤à¥‡ à¤¹à¥ˆà¤‚?"
            );
        }

        // Show main menu
        await this.showMainMenu(phone, selectedLanguage);
    }

    /**
     * MAIN_MENU - Show patient options
     */
    private async handleMainMenu(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const buttonId = message.text.trim();
        const clinicId = session.clinic_id;

        // Validate button ID
        if (!isValidPatientMenuButton(buttonId)) {
            await this.showMainMenu(phone, language);
            return;
        }

        // Parse menu choice
        switch (buttonId) {
            case BUTTON_IDS.PATIENT_MENU.BOOK:
                await this.updateSession(phone, "BOOK_DOCTOR");
                await this.showDoctorList(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.APPOINTMENTS:
                await this.updateSession(phone, "MY_APPOINTMENTS");
                await this.showMyAppointments(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.CANCEL:
                await this.updateSession(phone, "CANCEL_SELECT");
                await this.showCancelOptions(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.RESCHEDULE:
                await this.updateSession(phone, "RESCHEDULE_SELECT");
                await this.showRescheduleOptions(phone, language, clinicId);
                break;

            default:
                await this.showMainMenu(phone, language);
        }
    }

    /**
     * BOOK_DOCTOR - Display available doctors
     */
    private async handleBookDoctor(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "BOOK_DOCTOR") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }
        const language = session.data?.language || "EN";
        const clinicId = session.clinic_id;
        const doctorId = message.text.trim();

        // Validate doctor ID and fetch from database
        const doctors = await this.supabaseClient.getDoctors(clinicId);
        const doctor = doctors.find(d => d.doctor_id === doctorId);

        if (!doctor) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "âŒ Invalid doctor selection. Please select a valid doctor."
                    : "âŒ à¤…à¤®à¤¾à¤¨à¥à¤¯ à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤šà¤¯à¤¨à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤à¤• à¤µà¥ˆà¤§ à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤šà¥à¤¨à¥‡à¤‚à¥¤"
            );
            await this.showDoctorList(phone, language, clinicId);
            return;
        }

        // Store selected doctor and move to date selection
        await this.updateSession(phone, "BOOK_DATE", {
            language,
            selectedDoctorId: doctorId,
            selectedDoctorName: doctor.name
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `âœ… You've selected Dr. ${doctor.name}.\n\nPlease provide your preferred appointment date (YYYY-MM-DD):`
                : `âœ… à¤†à¤ªà¤¨à¥‡ à¤¡à¥‰. ${doctor.name} à¤•à¤¾ à¤šà¤¯à¤¨ à¤•à¤¿à¤¯à¤¾ à¤¹à¥ˆà¥¤\n\nà¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥€ à¤ªà¤¸à¤‚à¤¦à¥€à¤¦à¤¾ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¥‡à¤‚ (YYYY-MM-DD):`
        );
    }

    /**
     * BOOK_DATE - Select appointment date (Today, Tomorrow, or Other)
     * Max 1 week in advance (0-7 days from today)
     */
    private async handleBookDate(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const buttonId = message.text.trim();
        const locationType = session.data?.locationType || "clinic";
        const doctorId = session.data?.selectedDoctorId;
        const clinicId = session.clinic_id;

        // If button ID, parse date option
        if (isValidDateSelectButton(buttonId)) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            let selectedDate: string;

            if (buttonId === BUTTON_IDS.DATE_SELECT.TODAY) {
                selectedDate = this.formatDate(today);
            } else if (buttonId === BUTTON_IDS.DATE_SELECT.TOMORROW) {
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                selectedDate = this.formatDate(tomorrow);
            } else if (buttonId === BUTTON_IDS.DATE_SELECT.OTHER) {
                // Ask for custom date
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "ðŸ“… Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to 7 days in advance)"
                        : "ðŸ“… à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥€ à¤ªà¤¸à¤‚à¤¦à¥€à¤¦à¤¾ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚ (YYYY-MM-DD):\n\n(à¤†à¤ª 7 à¤¦à¤¿à¤¨ à¤ªà¤¹à¤²à¥‡ à¤¤à¤• à¤¬à¥à¤• à¤•à¤° à¤¸à¤•à¤¤à¥‡ à¤¹à¥ˆà¤‚)"
                );
                await this.updateSession(phone, "BOOK_DATE_CUSTOM", {
                    language,
                    selectedDoctorId: doctorId,
                    selectedDoctorName: session.data?.selectedDoctorName,
                    locationType
                });
                return;
            } else {
                await this.showDateMenu(phone, language);
                return;
            }

            // Check availability for selected date
            const slots = await this.supabaseClient.getAvailableSlots(clinicId, doctorId, selectedDate, locationType);
            if (!slots || slots.length === 0) {
                // Check if doctor is unavailable (not AVAILABLE or IN_CONSULTATION)
                const doctorAvailable = await this.supabaseClient.isDoctorAvailable(clinicId, doctorId);
                
                if (!doctorAvailable) {
                    const doctorStatus = await this.supabaseClient.getDoctorAvailabilityStatus(clinicId, doctorId);
                    const statusMessage = 
                        doctorStatus === 'ON_BREAK'
                            ? (language === "EN" ? "Dr. is currently on break" : "à¤¡à¥‰. à¤µà¤°à¥à¤¤à¤®à¤¾à¤¨ à¤®à¥‡à¤‚ à¤¬à¥à¤°à¥‡à¤• à¤ªà¤° à¤¹à¥ˆà¤‚")
                            : doctorStatus === 'BUSY'
                            ? (language === "EN" ? "Dr. is currently busy" : "à¤¡à¥‰. à¤µà¤°à¥à¤¤à¤®à¤¾à¤¨ à¤®à¥‡à¤‚ à¤µà¥à¤¯à¤¸à¥à¤¤ à¤¹à¥ˆà¤‚")
                            : (language === "EN" ? "Dr. is not available" : "à¤¡à¥‰. à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¤‚");
                    
                    await this.whatsappClient.sendTextMessage(
                        phone,
                        language === "EN"
                            ? `âŒ ${statusMessage}. Please try another doctor or date.`
                            : `âŒ ${statusMessage}à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤•à¤¿à¤¸à¥€ à¤…à¤¨à¥à¤¯ à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤¯à¤¾ à¤¤à¤¾à¤°à¥€à¤– à¤•à¥‹ à¤†à¤œà¤®à¤¾à¤à¤‚à¥¤`
                    );
                } else {
                    await this.whatsappClient.sendTextMessage(
                        phone,
                        language === "EN"
                            ? "âŒ No available slots on that date. Please try another date."
                            : "âŒ à¤‰à¤¸ à¤¤à¤¾à¤°à¥€à¤– à¤ªà¤° à¤•à¥‹à¤ˆ à¤¸à¥à¤²à¥‰à¤Ÿ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤•à¤¿à¤¸à¥€ à¤…à¤¨à¥à¤¯ à¤¤à¤¾à¤°à¥€à¤– à¤•à¥‹ à¤†à¤œà¤®à¤¾à¤à¤‚à¥¤"
                    );
                }
                await this.showDateMenu(phone, language);
                return;
            }

            // Move to time selection
            await this.updateSession(phone, "BOOK_TIME", {
                language,
                selectedDoctorId: doctorId,
                selectedDoctorName: session.data?.selectedDoctorName,
                selectedDate,
                locationType,
                slotPage: 0
            });

            await this.showAvailableSlots(phone, language, slots, 0);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(buttonId)) {
            // Custom date input - validate format and range
            const dateValidation = isValidBookingDate(buttonId);

            if (!dateValidation.valid) {
                const errorMsg = formatBookingDateErrorMessage(dateValidation.error || "invalid_format", language);
                await this.whatsappClient.sendTextMessage(phone, errorMsg);

                // Prompt to retry
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "ðŸ“… Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to 7 days in advance)"
                        : "ðŸ“… à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥€ à¤ªà¤¸à¤‚à¤¦à¥€à¤¦à¤¾ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚ (YYYY-MM-DD):\n\n(à¤†à¤ª 7 à¤¦à¤¿à¤¨ à¤ªà¤¹à¤²à¥‡ à¤¤à¤• à¤¬à¥à¤• à¤•à¤° à¤¸à¤•à¤¤à¥‡ à¤¹à¥ˆà¤‚)"
                );
                return;
            }

            const slots = await this.supabaseClient.getAvailableSlots(clinicId, doctorId, buttonId, locationType);
            if (!slots || slots.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "âŒ No available slots on that date. Please try another date."
                        : "âŒ à¤‰à¤¸ à¤¤à¤¾à¤°à¥€à¤– à¤ªà¤° à¤•à¥‹à¤ˆ à¤¸à¥à¤²à¥‰à¤Ÿ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤•à¤¿à¤¸à¥€ à¤…à¤¨à¥à¤¯ à¤¤à¤¾à¤°à¥€à¤– à¤•à¥‹ à¤†à¤œà¤®à¤¾à¤à¤‚à¥¤"
                );
                return;
            }

            await this.updateSession(phone, "BOOK_TIME", {
                language,
                selectedDoctorId: doctorId,
                selectedDoctorName: session.data?.selectedDoctorName,
                selectedDate: buttonId,
                locationType,
                slotPage: 0
            });

            await this.showAvailableSlots(phone, language, slots, 0);
        } else {
            await this.showDateMenu(phone, language);
        }
    }

    /**
     * BOOK_DATE_CUSTOM - Handle custom date input (intermediate state)
     * Validates date format and range, then routes to time selection
     */
    private async handleBookDateCustom(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const dateString = message.text.trim();
        const doctorId = session.data?.selectedDoctorId;
        const locationType = session.data?.locationType || "clinic";
        const clinicId = session.clinic_id;

        // Validate date format and range
        const dateValidation = isValidBookingDate(dateString);

        if (!dateValidation.valid) {
            const errorMsg = formatBookingDateErrorMessage(dateValidation.error || "invalid_format", language);
            await this.whatsappClient.sendTextMessage(phone, errorMsg);

            // Prompt to retry
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "ðŸ“… Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to 7 days in advance)"
                    : "ðŸ“… à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥€ à¤ªà¤¸à¤‚à¤¦à¥€à¤¦à¤¾ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚ (YYYY-MM-DD):\n\n(à¤†à¤ª 7 à¤¦à¤¿à¤¨ à¤ªà¤¹à¤²à¥‡ à¤¤à¤• à¤¬à¥à¤• à¤•à¤° à¤¸à¤•à¤¤à¥‡ à¤¹à¥ˆà¤‚)"
            );
            return;
        }

        // Check availability
        const slots = await this.supabaseClient.getAvailableSlots(clinicId, doctorId, dateString, locationType);
        if (!slots || slots.length === 0) {
            // Check if doctor is unavailable (not AVAILABLE or IN_CONSULTATION)
            const doctorAvailable = await this.supabaseClient.isDoctorAvailable(clinicId, doctorId);
            
            if (!doctorAvailable) {
                const doctorStatus = await this.supabaseClient.getDoctorAvailabilityStatus(clinicId, doctorId);
                const statusMessage = 
                    doctorStatus === 'ON_BREAK'
                        ? (language === "EN" ? "Dr. is currently on break" : "à¤¡à¥‰. à¤µà¤°à¥à¤¤à¤®à¤¾à¤¨ à¤®à¥‡à¤‚ à¤¬à¥à¤°à¥‡à¤• à¤ªà¤° à¤¹à¥ˆà¤‚")
                        : doctorStatus === 'BUSY'
                        ? (language === "EN" ? "Dr. is currently busy" : "à¤¡à¥‰. à¤µà¤°à¥à¤¤à¤®à¤¾à¤¨ à¤®à¥‡à¤‚ à¤µà¥à¤¯à¤¸à¥à¤¤ à¤¹à¥ˆà¤‚")
                        : (language === "EN" ? "Dr. is not available" : "à¤¡à¥‰. à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¤‚");
                
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `âŒ ${statusMessage}. Please try another doctor or date.`
                        : `âŒ ${statusMessage}à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤•à¤¿à¤¸à¥€ à¤…à¤¨à¥à¤¯ à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤¯à¤¾ à¤¤à¤¾à¤°à¥€à¤– à¤•à¥‹ à¤†à¤œà¤®à¤¾à¤à¤‚à¥¤`
                );
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "âŒ No available slots on that date. Please try another date."
                        : "âŒ à¤‰à¤¸ à¤¤à¤¾à¤°à¥€à¤– à¤ªà¤° à¤•à¥‹à¤ˆ à¤¸à¥à¤²à¥‰à¤Ÿ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤•à¤¿à¤¸à¥€ à¤…à¤¨à¥à¤¯ à¤¤à¤¾à¤°à¥€à¤– à¤•à¥‹ à¤†à¤œà¤®à¤¾à¤à¤‚à¥¤"
                );
            }

            // Offer to try another date
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "ðŸ“… Please enter another date (YYYY-MM-DD):"
                    : "ðŸ“… à¤•à¥ƒà¤ªà¤¯à¤¾ à¤•à¥‹à¤ˆ à¤…à¤¨à¥à¤¯ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¤°à¥à¤œ à¤•à¤°à¥‡à¤‚ (YYYY-MM-DD):"
            );
            return;
        }

        // Move to time selection
        await this.updateSession(phone, "BOOK_TIME", {
            language,
            selectedDoctorId: doctorId,
            selectedDoctorName: session.data?.selectedDoctorName,
            selectedDate: dateString,
            locationType,
            slotPage: 0
        });

        await this.showAvailableSlots(phone, language, slots, 0);
    }

    /**
     * BOOK_TIME - Select appointment time from available slots
     */
    private async handleBookTime(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const selectedTime = message.text.trim();
        const doctorId = session.data?.selectedDoctorId;
        const selectedDate = session.data?.selectedDate;
        const clinicId = session.clinic_id;
        const locationType = session.data?.locationType || "clinic";

        // Validate time format (HH:MM)
        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(selectedTime)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "âŒ Invalid time format. Please use HH:MM (e.g., 14:30)"
                    : "âŒ à¤…à¤®à¤¾à¤¨à¥à¤¯ à¤¸à¤®à¤¯ à¤ªà¥à¤°à¤¾à¤°à¥‚à¤ªà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ HH:MM à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤— à¤•à¤°à¥‡à¤‚ (à¤‰à¤¦à¤¾. 14:30)"
            );
            return;
        }

        // Verify slot still available
        const slots = await this.supabaseClient.getAvailableSlots(clinicId, doctorId, selectedDate, locationType);
        const slotExists = slots?.some((s: any) => s.start_time === selectedTime);

        if (!slotExists) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "âŒ That time slot is no longer available. Please choose another:"
                    : "âŒ à¤µà¤¹ à¤¸à¤®à¤¯ à¤¸à¥à¤²à¥‰à¤Ÿ à¤…à¤¬ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¦à¥‚à¤¸à¤°à¤¾ à¤šà¥à¤¨à¥‡à¤‚:"
            );
            await this.showAvailableSlots(phone, language, slots, 0);
            return;
        }

        // Move to name confirmation
        await this.updateSession(phone, "BOOK_NAME", {
            language,
            selectedDoctorId: doctorId,
            selectedDoctorName: session.data?.selectedDoctorName,
            selectedDate,
            selectedTime,
            locationType
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `âœ… Time selected: ${selectedTime}\n\nðŸ“ Please provide your full name:`
                : `âœ… à¤¸à¤®à¤¯ à¤šà¥à¤¨à¤¾ à¤—à¤¯à¤¾: ${selectedTime}\n\nðŸ“ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¤¾ à¤ªà¥‚à¤°à¤¾ à¤¨à¤¾à¤® à¤ªà¥à¤°à¤¦à¤¾à¤¨ à¤•à¤°à¥‡à¤‚:`
        );
    }

    /**
     * BOOK_NAME - Confirm patient name
     */
    private async handleBookName(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "BOOK_NAME") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }
        const language = session.data?.language || "EN";
        const patientName = message.text.trim();

        // Validate name
        if (!isValidPatientName(patientName)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please provide a valid name (2-100 characters)"
                    : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤à¤• à¤µà¥ˆà¤§ à¤¨à¤¾à¤® à¤ªà¥à¤°à¤¦à¤¾à¤¨ à¤•à¤°à¥‡à¤‚ (2-100 à¤µà¤°à¥à¤£)"
            );
            return;
        }

        // Move to confirmation
        await this.updateSession(phone, "BOOK_CONFIRM", {
            language,
            selectedDoctorId: session.data?.selectedDoctorId,
            selectedDoctorName: session.data?.selectedDoctorName,
            selectedDate: session.data?.selectedDate,
            selectedTime: session.data?.selectedTime,
            patientName
        });

        await this.showBookingConfirmation(phone, session.data, language);
    }

    /**
     * BOOK_CONFIRM - Final confirmation before booking with buttons
     */
    private async handleBookConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const buttonId = message.text.trim();
        const clinicId = session.clinic_id;

        // Validate button ID
        if (!isValidConfirmationButton(buttonId)) {
            await this.showBookingConfirmation(phone, session.data, language);
            return;
        }

        if (buttonId === BUTTON_IDS.CONFIRMATION.YES) {
            // Proceed with booking
            try {
                const appointmentId = await this.supabaseClient.createAppointment(
                    clinicId,
                    {
                        patient_phone: phone,
                        patient_name: session.data?.patientName || "Patient",
                        doctor_id: session.data?.selectedDoctorId,
                        appointment_date: session.data?.selectedDate,
                        appointment_time: session.data?.selectedTime,
                        location_type: session.data?.locationType || "clinic",
                        preferred_language: language  // Store patient's language preference for reminders
                    }
                );

                // Create appointment reminders (24-hour and 1-hour before)
                const reminderResult = await createAppointmentReminders(
                    this.supabase,
                    clinicId,
                    appointmentId,
                    session.data?.selectedDate,
                    session.data?.selectedTime
                );

                if (!reminderResult.success) {
                    debug("patientFlow", "Warning: Failed to create reminders", {
                        appointmentId,
                        error: reminderResult.error
                    });
                    // Don't fail the appointment booking even if reminders fail
                }

                await this.updateSession(phone, "MAIN_MENU", {
                    language,
                    lastAppointmentId: appointmentId
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `âœ… Appointment confirmed!\n\nðŸ‘¨â€âš•ï¸ Doctor: ${session.data?.selectedDoctorName}\nðŸ“… Date: ${session.data?.selectedDate}\nðŸ• Time: ${session.data?.selectedTime}\nðŸ“ Location: ${session.data?.locationType === "home" ? "Home Visit" : "Clinic Visit"}\n\nðŸ“Œ Booking ID: ${appointmentId}\n\nâ° You'll receive reminders before your appointment.`
                        : `âœ… à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤•à¥€ à¤ªà¥à¤·à¥à¤Ÿà¤¿ à¤¹à¥à¤ˆ!\n\nðŸ‘¨â€âš•ï¸ à¤¡à¥‰à¤•à¥à¤Ÿà¤°: ${session.data?.selectedDoctorName}\nðŸ“… à¤¤à¤¾à¤°à¥€à¤–: ${session.data?.selectedDate}\nðŸ• à¤¸à¤®à¤¯: ${session.data?.selectedTime}\nðŸ“ à¤¸à¥à¤¥à¤¾à¤¨: ${session.data?.locationType === "home" ? "à¤˜à¤° à¤ªà¤° à¤®à¥à¤²à¤¾à¤•à¤¾à¤¤" : "à¤•à¥à¤²à¤¿à¤¨à¤¿à¤• à¤®à¥‡à¤‚"}\n\nðŸ“Œ à¤¬à¥à¤•à¤¿à¤‚à¤— ID: ${appointmentId}\n\nâ° à¤†à¤ªà¤•à¥‹ à¤…à¤ªà¥‰à¤‡à¤‚à¤Ÿà¤®à¥‡à¤‚à¤Ÿ à¤¸à¥‡ à¤ªà¤¹à¤²à¥‡ à¤°à¤¿à¤®à¤¾à¤‡à¤‚à¤¡à¤° à¤®à¤¿à¤²à¥‡à¤‚à¤—à¥‡à¥¤`
                );

                // Notify doctor
                await this.notifyDoctorNewBooking(session.data?.selectedDoctorId, clinicId, session.data, language);
            } catch (error) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `âŒ Booking failed: ${error instanceof Error ? error.message : "Unknown error"}`
                        : `âŒ à¤¬à¥à¤•à¤¿à¤‚à¤— à¤µà¤¿à¤«à¤²: ${error instanceof Error ? error.message : "à¤…à¤œà¥à¤žà¤¾à¤¤ à¤¤à¥à¤°à¥à¤Ÿà¤¿"}`
                );

                await this.updateSession(phone, "MAIN_MENU", { language });
            }

            await this.showMainMenu(phone, language);
        } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "âŒ Booking cancelled. Returning to main menu..."
                    : "âŒ à¤¬à¥à¤•à¤¿à¤‚à¤— à¤°à¤¦à¥à¤¦ à¤•à¥€ à¤—à¤ˆà¥¤ à¤®à¥à¤–à¥à¤¯ à¤®à¥‡à¤¨à¥‚ à¤ªà¤° à¤œà¤¾ à¤°à¤¹à¥‡ à¤¹à¥ˆà¤‚..."
            );
            await this.showMainMenu(phone, language);
        } else {
            await this.showBookingConfirmation(phone, session.data, language);
        }
    }

    /**
     * MY_APPOINTMENTS - Show patient's upcoming appointments with history option
     */
    private async handleMyAppointments(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "MY_APPOINTMENTS") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const buttonId = message.text?.trim() || "";

        // Check for history button
        if (buttonId === "appt_history" || message.text?.toLowerCase() === "2") {
            // Show appointment history
            await this.updateSession(phone, "APPOINTMENT_HISTORY", { language });

            const historyHandler = new AppointmentHistoryHandler(this.supabase, this.whatsappClient);
            await historyHandler.handle(phone, session, "");
            return;
        }

        // Default: show upcoming appointments
        const clinicId = session.clinic_id;
        await this.showUpcomingAppointments(phone, language, clinicId);
    }

    /**
     * APPOINTMENT_HISTORY - Show patient's past appointments with pagination
     */
    private async handleAppointmentHistory(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "APPOINTMENT_HISTORY") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const historyHandler = new AppointmentHistoryHandler(this.supabase, this.whatsappClient);
        await historyHandler.handle(phone, session, message.text || "");
    }

    /**
     * CANCEL_SELECT - Select appointment to cancel
     */
    private async handleCancelSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "CANCEL_SELECT") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const appointmentId = message.text.trim();

        // Store selected appointment for cancellation
        await this.updateSession(phone, "CANCEL_CONFIRM", {
            language,
            selectedAppointmentId: appointmentId
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `Are you sure you want to cancel appointment ${appointmentId}? (yes/no)`
                : `à¤•à¥à¤¯à¤¾ à¤†à¤ª à¤¨à¤¿à¤¶à¥à¤šà¤¿à¤¤ à¤°à¥‚à¤ª à¤¸à¥‡ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ ${appointmentId} à¤•à¥‹ à¤°à¤¦à¥à¤¦ à¤•à¤°à¤¨à¤¾ à¤šà¤¾à¤¹à¤¤à¥‡ à¤¹à¥ˆà¤‚? (à¤¹à¤¾à¤/à¤¨à¤¹à¥€à¤‚)`
        );
    }

    /**
     * CANCEL_CONFIRM - Confirm cancellation
     */
    private async handleCancelConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "CANCEL_CONFIRM") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const confirmation = message.text.toLowerCase().trim();

        if (confirmation === "yes" || confirmation === "y" || confirmation === "à¤¹à¤¾à¤") {
            const appointmentId = session.data?.selectedAppointmentId;
            const clinicId = session.clinic_id;

            const result = await cancelAppointment(
                this.supabase,
                appointmentId,
                "Patient initiated cancellation"
            );

            if (result.success) {
                // Mark reminders as skipped (don't send reminders for cancelled appointments)
                await markReminderAsSkipped(this.supabase, appointmentId, "24_HOUR");
                await markReminderAsSkipped(this.supabase, appointmentId, "1_HOUR");

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "âœ… Appointment cancelled successfully."
                        : "âœ… à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¸à¤«à¤²à¤¤à¤¾à¤ªà¥‚à¤°à¥à¤µà¤• à¤°à¤¦à¥à¤¦ à¤•à¥€ à¤—à¤ˆà¥¤"
                );
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `âŒ Cancellation failed: ${result.message}`
                        : `âŒ à¤°à¤¦à¥à¤¦à¥€à¤•à¤°à¤£ à¤µà¤¿à¤«à¤²: ${result.message}`
                );
            }

            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "à¤¨à¤¹à¥€à¤‚") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Cancellation aborted."
                    : "à¤°à¤¦à¥à¤¦à¥€à¤•à¤°à¤£ à¤°à¤¦à¥à¤¦ à¤•à¤¿à¤¯à¤¾ à¤—à¤¯à¤¾à¥¤"
            );
            await this.showMainMenu(phone, language);
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please reply with 'yes' or 'no'"
                    : "à¤•à¥ƒà¤ªà¤¯à¤¾ 'à¤¹à¤¾à¤' à¤¯à¤¾ 'à¤¨à¤¹à¥€à¤‚' à¤•à¥‡ à¤¸à¤¾à¤¥ à¤œà¤µà¤¾à¤¬ à¤¦à¥‡à¤‚"
            );
        }
    }

    /**
     * RESCHEDULE_SELECT - Select appointment to reschedule
     */
    private async handleRescheduleSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "RESCHEDULE_SELECT") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const appointmentId = message.text.trim();

        await this.updateSession(phone, "RESCHEDULE_DATE", {
            language,
            selectedAppointmentId: appointmentId
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? "Please provide the new appointment date (YYYY-MM-DD):"
                : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¨à¤ˆ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¥‡à¤‚ (YYYY-MM-DD):"
        );
    }

    /**
     * RESCHEDULE_DATE - Select new appointment date
     */
    private async handleRescheduleDate(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "RESCHEDULE_DATE") {
            await this.showDateMenu(phone, session.data?.language || "EN");
            return;
        }
        const language = session.data?.language || "EN";
        const newDate = message.text.trim();

        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Invalid date format. Please use YYYY-MM-DD"
                    : "à¤…à¤®à¤¾à¤¨à¥à¤¯ à¤¤à¤¾à¤°à¥€à¤– à¤ªà¥à¤°à¤¾à¤°à¥‚à¤ªà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ YYYY-MM-DD à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤— à¤•à¤°à¥‡à¤‚"
            );
            return;
        }

        await this.updateSession(phone, "RESCHEDULE_TIME", {
            language,
            selectedAppointmentId: session.data?.selectedAppointmentId,
            newDate
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? "Please provide the new appointment time (HH:MM):"
                : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¨à¤ˆ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¸à¤®à¤¯ à¤¦à¥‡à¤‚ (HH:MM):"
        );
    }

    /**
     * RESCHEDULE_TIME - Select new appointment time
     */
    private async handleRescheduleTime(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "RESCHEDULE_TIME") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const newTime = message.text.trim();

        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newTime)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Invalid time format. Please use HH:MM"
                    : "à¤…à¤®à¤¾à¤¨à¥à¤¯ à¤¸à¤®à¤¯ à¤ªà¥à¤°à¤¾à¤°à¥‚à¤ªà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ HH:MM à¤•à¤¾ à¤‰à¤ªà¤¯à¥‹à¤— à¤•à¤°à¥‡à¤‚"
            );
            return;
        }

        await this.updateSession(phone, "RESCHEDULE_CONFIRM", {
            language,
            selectedAppointmentId: session.data?.selectedAppointmentId,
            newDate: session.data?.newDate,
            newTime
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `New appointment time: ${session.data?.newDate} at ${newTime}\n\nConfirm? (yes/no)`
                : `à¤¨à¤ˆ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¸à¤®à¤¯: ${session.data?.newDate} à¤•à¥‹ ${newTime}\n\nà¤ªà¥à¤·à¥à¤Ÿà¤¿ à¤•à¤°à¥‡à¤‚? (à¤¹à¤¾à¤/à¤¨à¤¹à¥€à¤‚)`
        );
    }

    /**
     * RESCHEDULE_CONFIRM - Confirm rescheduling
     */
    private async handleRescheduleConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "RESCHEDULE_CONFIRM") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const confirmation = message.text.toLowerCase().trim();

        if (confirmation === "yes" || confirmation === "y" || confirmation === "à¤¹à¤¾à¤") {
            const result = await rescheduleAppointment(
                this.supabase,
                session.data?.selectedAppointmentId,
                session.data?.newDate,
                session.data?.newTime
            );

            if (result.success) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `âœ… Appointment rescheduled to ${session.data?.newDate} at ${session.data?.newTime}`
                        : `âœ… à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤•à¥‹ ${session.data?.newDate} à¤•à¥‹ ${session.data?.newTime} à¤ªà¤° à¤ªà¥à¤¨à¤ƒ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤¿à¤¤ à¤•à¤¿à¤¯à¤¾ à¤—à¤¯à¤¾`
                );
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `âŒ Rescheduling failed: ${result.message}`
                        : `âŒ à¤ªà¥à¤¨à¤ƒ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤£ à¤µà¤¿à¤«à¤²: ${result.message}`
                );
            }

            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "à¤¨à¤¹à¥€à¤‚") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Rescheduling aborted."
                    : "à¤ªà¥à¤¨à¤ƒ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤£ à¤°à¤¦à¥à¤¦ à¤•à¤¿à¤¯à¤¾ à¤—à¤¯à¤¾à¥¤"
            );
            await this.showMainMenu(phone, language);
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please reply with 'yes' or 'no'"
                    : "à¤•à¥ƒà¤ªà¤¯à¤¾ 'à¤¹à¤¾à¤' à¤¯à¤¾ 'à¤¨à¤¹à¥€à¤‚' à¤•à¥‡ à¤¸à¤¾à¤¥ à¤œà¤µà¤¾à¤¬ à¤¦à¥‡à¤‚"
            );
        }
    }

    /**
     * Helper: Show main menu options
     */
    private async showMainMenu(phone: string, language: string): Promise<void> {
        const message =
            language === "EN"
                ? "ðŸ“‹ What would you like to do?\n\nðŸ”– Tap a button to choose:"
                : "ðŸ“‹ à¤†à¤ª à¤•à¥à¤¯à¤¾ à¤•à¤°à¤¨à¤¾ à¤šà¤¾à¤¹à¤¤à¥‡ à¤¹à¥ˆà¤‚?\n\nðŸ”– à¤šà¥à¤¨à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤¬à¤Ÿà¤¨ à¤¦à¤¬à¤¾à¤à¤‚:";

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.PATIENT_MENU.BOOK, title: language === "EN" ? "ðŸ“… Book Appointment" : "ðŸ“… à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¬à¥à¤• à¤•à¤°à¥‡à¤‚" },
            { id: BUTTON_IDS.PATIENT_MENU.APPOINTMENTS, title: language === "EN" ? "ðŸ“ My Appointments" : "ðŸ“ à¤®à¥‡à¤°à¥€ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿à¤¯à¤¾à¤" },
            { id: BUTTON_IDS.PATIENT_MENU.CANCEL, title: language === "EN" ? "âŒ Cancel" : "âŒ à¤°à¤¦à¥à¤¦ à¤•à¤°à¥‡à¤‚" },
            { id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE, title: language === "EN" ? "ðŸ”„ Reschedule" : "ðŸ”„ à¤ªà¥à¤¨à¤ƒ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤¿à¤¤ à¤•à¤°à¥‡à¤‚" }
        ]);
    }

    /**
     * Helper: Show available doctors
     */
    private async showDoctorList(phone: string, language: string, clinicId: string): Promise<void> {
        try {
            const doctors = await this.supabaseClient.getDoctors(clinicId);

            if (!doctors || doctors.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "âŒ No doctors available at the moment."
                        : "âŒ à¤‡à¤¸ à¤¸à¤®à¤¯ à¤•à¥‹à¤ˆ à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤"
                );
                return;
            }

            let message = language === "EN" ? "ðŸ‘¨â€âš•ï¸ Select a doctor:\n\n" : "ðŸ‘¨â€âš•ï¸ à¤à¤• à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤šà¥à¤¨à¥‡à¤‚:\n\n";

            doctors.forEach((doc: any, idx: number) => {
                // Add status indicator
                const availableStatuses = ['AVAILABLE', 'IN_CONSULTATION'];
                const statusIndicator = availableStatuses.includes(doc.availability_status) 
                    ? "âœ…" 
                    : "âš ï¸";
                
                message += `${idx + 1}. ${statusIndicator} Dr. ${doc.name}`;
                
                // Add status hint for unavailable doctors
                if (!availableStatuses.includes(doc.availability_status)) {
                    const statusLabel = 
                        doc.availability_status === 'ON_BREAK' 
                            ? (language === "EN" ? "(On break)" : "(à¤¬à¥à¤°à¥‡à¤• à¤ªà¤°)")
                            : doc.availability_status === 'BUSY'
                            ? (language === "EN" ? "(Busy)" : "(à¤µà¥à¤¯à¤¸à¥à¤¤)")
                            : (language === "EN" ? "(Offline)" : "(à¤‘à¤«à¤²à¤¾à¤‡à¤¨)");
                    message += ` ${statusLabel}`;
                }
                message += "\n";
            });

            message += language === "EN" 
                ? "\nTap a doctor to book an appointment" 
                : "\nà¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤¬à¥à¤• à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤à¤• à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤¦à¤¬à¤¾à¤à¤‚";

            await this.whatsappClient.sendTextMessage(phone, message);
        } catch (error) {
            debug("patientFlow", "Error loading doctors", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "âŒ Error loading doctors. Please try again."
                    : "âŒ à¤¡à¥‰à¤•à¥à¤Ÿà¤° à¤²à¥‹à¤¡ à¤•à¤°à¤¨à¥‡ à¤®à¥‡à¤‚ à¤¤à¥à¤°à¥à¤Ÿà¤¿à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¦à¥‹à¤¬à¤¾à¤°à¤¾ à¤•à¥‹à¤¶à¤¿à¤¶ à¤•à¤°à¥‡à¤‚à¥¤"
            );
        }
    }

    /**
     * Helper: Show available times for doctor on selected date
     */
    private async showAvailableTimes(
        phone: string,
        doctorId: string,
        date: string,
        language: string
    ): Promise<void> {
        try {
            const slots = await getAvailableSlots(doctorId, date);

            if (!slots || slots.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `No slots available on ${date}. Please select another date.`
                        : `${date} à¤ªà¤° à¤•à¥‹à¤ˆ à¤¸à¥à¤²à¥‰à¤Ÿ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¦à¥‚à¤¸à¤°à¥€ à¤¤à¤¾à¤°à¥€à¤– à¤šà¥à¤¨à¥‡à¤‚à¥¤`
                );

                await this.updateSession(phone, "BOOK_DATE", {
                    language,
                    selectedDoctorId: doctorId
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "Please provide a new date (YYYY-MM-DD):"
                        : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¨à¤ˆ à¤¤à¤¾à¤°à¥€à¤– à¤¦à¥‡à¤‚ (YYYY-MM-DD):"
                );
                return;
            }

            let message = language === "EN" ? `Available times on ${date}:\n\n` : `${date} à¤ªà¤° à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¸à¤®à¤¯:\n\n`;

            slots.slice(0, 8).forEach((slot, idx) => {
                message += `${idx + 1}. ${slot}\n`;
            });

            message += language === "EN" ? "\nReply with your preferred time (HH:MM)" : "\nà¤…à¤ªà¤¨à¤¾ à¤ªà¤¸à¤‚à¤¦à¥€à¤¦à¤¾ à¤¸à¤®à¤¯ (HH:MM) à¤•à¥‡ à¤¸à¤¾à¤¥ à¤‰à¤¤à¥à¤¤à¤° à¤¦à¥‡à¤‚";

            await this.whatsappClient.sendTextMessage(phone, message);
        } catch (error) {
            debug("patientFlow", "Error loading available times", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Error loading available times. Please try again."
                    : "à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¸à¤®à¤¯ à¤²à¥‹à¤¡ à¤•à¤°à¤¨à¥‡ à¤®à¥‡à¤‚ à¤¤à¥à¤°à¥à¤Ÿà¤¿à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¦à¥‹à¤¬à¤¾à¤°à¤¾ à¤•à¥‹à¤¶à¤¿à¤¶ à¤•à¤°à¥‡à¤‚à¥¤"
            );
        }
    }



    /**
     * Helper: Show patient's appointments
     */
    private async showUpcomingAppointments(phone: string, language: string, clinicId: string): Promise<void> {
        try {
            const appointments = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);

            if (!appointments || appointments.length === 0) {
                await this.whatsappClient.sendInteractiveButtonMessage(
                    phone,
                    language === "EN"
                        ? "ðŸ“‹ You have no upcoming appointments.\n\nWould you like to book one?"
                        : "ðŸ“‹ à¤†à¤ªà¤•à¥‡ à¤ªà¤¾à¤¸ à¤•à¥‹à¤ˆ à¤†à¤¨à¥‡ à¤µà¤¾à¤²à¥€ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿à¤¯à¤¾à¤ à¤¨à¤¹à¥€à¤‚ à¤¹à¥ˆà¤‚à¥¤\n\nà¤•à¥à¤¯à¤¾ à¤†à¤ª à¤à¤• à¤¬à¥à¤• à¤•à¤°à¤¨à¤¾ à¤šà¤¾à¤¹à¥‡à¤‚à¤—à¥‡?",
                    [
                        { id: "menu_book", title: "ðŸ“… Book Appointment" },
                        { id: "nav_menu", title: "ðŸ  Main Menu" }
                    ]
                );
            } else {
                let message = language === "EN" 
                    ? "ðŸ“‹ Your Upcoming Appointments:\n\n" 
                    : "ðŸ“‹ à¤†à¤ªà¤•à¥€ à¤†à¤¨à¥‡ à¤µà¤¾à¤²à¥€ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿à¤¯à¤¾à¤:\n\n";

                appointments.forEach((apt: any, idx: number) => {
                    message += `${idx + 1}. ðŸ©º Dr. ${apt.doctor_name || "Unknown"}\n   ðŸ“… ${this.formatDate(apt.appointment_date)}\n   ðŸ• ${apt.appointment_time}\n   Status: ${apt.status}\n\n`;
                });

                // Show with history and menu buttons
                await this.whatsappClient.sendInteractiveButtonMessage(
                    phone,
                    message,
                    [
                        { id: "appt_history", title: "ðŸ“œ View History" },
                        { id: "nav_menu", title: "ðŸ  Main Menu" }
                    ]
                );
            }
        } catch (error) {
            debug("patientFlow", "Error loading appointments", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "âŒ Error loading appointments. Please try again."
                    : "âŒ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿à¤¯à¤¾à¤ à¤²à¥‹à¤¡ à¤•à¤°à¤¨à¥‡ à¤®à¥‡à¤‚ à¤¤à¥à¤°à¥à¤Ÿà¤¿à¥¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¦à¥‹à¤¬à¤¾à¤°à¤¾ à¤•à¥‹à¤¶à¤¿à¤¶ à¤•à¤°à¥‡à¤‚à¥¤"
            );
        }
    }

    /**
     * Helper: Format date for display
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
     * Helper: Show cancel options
     */
    private async showCancelOptions(phone: string, language: string, clinicId: string): Promise<void> {
        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? "Please provide the appointment ID to cancel:"
                : "à¤°à¤¦à¥à¤¦ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤†à¤ˆà¤¡à¥€ à¤ªà¥à¤°à¤¦à¤¾à¤¨ à¤•à¤°à¥‡à¤‚:"
        );
    }

    /**
     * Helper: Show reschedule options
     */
    private async showRescheduleOptions(phone: string, language: string, clinicId: string): Promise<void> {
        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? "Please provide the appointment ID to reschedule:"
                : "à¤ªà¥à¤¨à¤ƒ à¤¸à¤®à¤¯ à¤¨à¤¿à¤°à¥à¤§à¤¾à¤°à¤¿à¤¤ à¤•à¤°à¤¨à¥‡ à¤•à¥‡ à¤²à¤¿à¤ à¤•à¥ƒà¤ªà¤¯à¤¾ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤†à¤ˆà¤¡à¥€ à¤ªà¥à¤°à¤¦à¤¾à¤¨ à¤•à¤°à¥‡à¤‚:"
        );
    }

    /**
     * Helper: Update session state and data
     */
    /**
     * Helper: Show booking confirmation details with button options
     */
    private async showBookingConfirmation(
        phone: string,
        data: any,
        language: string
    ): Promise<void> {
        const message = language === "EN"
            ? "Please confirm your appointment details."
            : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥€ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤µà¤¿à¤µà¤°à¤£ à¤•à¥€ à¤ªà¥à¤·à¥à¤Ÿà¤¿ à¤•à¤°à¥‡à¤‚à¥¤";

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.CONFIRMATION.YES, title: language === "EN" ? "Yes, Confirm" : "à¤¹à¤¾à¤, à¤ªà¥à¤·à¥à¤Ÿà¤¿ à¤•à¤°à¥‡à¤‚" },
            { id: BUTTON_IDS.CONFIRMATION.NO, title: language === "EN" ? "No, Cancel" : "à¤¨à¤¹à¥€à¤‚, à¤°à¤¦à¥à¤¦ à¤•à¤°à¥‡à¤‚" }
        ]);

    }

    private async showDateMenu(phone: string, language: string): Promise<void> {
        const message = language === "EN"
            ? "When would you like your appointment?"
            : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤…à¤ªà¤¨à¥€ à¤¨à¤¿à¤¯à¥à¤•à¥à¤¤à¤¿ à¤•à¥€ à¤¤à¤¾à¤°à¥€à¤– à¤šà¥à¤¨à¥‡à¤‚à¥¤";

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.DATE_SELECT.TODAY, title: language === "EN" ? "Today" : "à¤†à¤œ" },
            { id: BUTTON_IDS.DATE_SELECT.TOMORROW, title: language === "EN" ? "Tomorrow" : "à¤•à¤²" },
            { id: BUTTON_IDS.DATE_SELECT.OTHER, title: language === "EN" ? "Other date" : "à¤…à¤¨à¥à¤¯ à¤¤à¤¾à¤°à¥€à¤–" }
        ]);
    }

    private async showAvailableSlots(phone: string, language: string, slots: any[], page = 0): Promise<void> {
        const message = language === "EN" ? "Please select an available time." : "à¤•à¥ƒà¤ªà¤¯à¤¾ à¤‰à¤ªà¤²à¤¬à¥à¤§ à¤¸à¤®à¤¯ à¤šà¥à¤¨à¥‡à¤‚à¥¤";
        const buttons = slots.slice(page * 3, page * 3 + 3).map((slot: any) => {
            const time = typeof slot === "string" ? slot : slot.start_time || slot.time;
            return { id: `slot_${time}`, title: time };
        });
        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, buttons);
    }

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
            debug("patientFlow", "Error updating session", { error: error.message });
        }
    }
}
