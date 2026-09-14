import { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppMessage, WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidLanguageButton, isValidPatientMenuButton, isValidConfirmationButton, isValidDateSelectButton } from "../button-ids.ts";
import {
    bookAppointment,
    cancelAppointment,
    rescheduleAppointment,
    getAvailableSlots
} from "../appointments.ts";
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
                "Welcome to ABC Clinic! Please select your language:\n\n🇬🇧 English\n🇮🇳 हिंदी",
                [
                    { id: BUTTON_IDS.LANGUAGE.EN, title: "🇬🇧 English" },
                    { id: BUTTON_IDS.LANGUAGE.HI, title: "🇮🇳 हिंदी" }
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
                "👋 Welcome to ABC Clinic!\n\nWhat would you like to do today?"
            );
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                "👋 ABC क्लीनिक में आपका स्वागत है!\n\nआज आप क्या करना चाहते हैं?"
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
                    ? "❌ Invalid doctor selection. Please select a valid doctor."
                    : "❌ अमान्य डॉक्टर चयन। कृपया एक वैध डॉक्टर चुनें।"
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
                ? `✅ You've selected Dr. ${doctor.name}.\n\nPlease provide your preferred appointment date (YYYY-MM-DD):`
                : `✅ आपने डॉ. ${doctor.name} का चयन किया है।\n\nकृपया अपनी पसंदीदा नियुक्ति तारीख दें (YYYY-MM-DD):`
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
                        ? "📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to 7 days in advance)"
                        : "📅 कृपया अपनी पसंदीदा तारीख दर्ज करें (YYYY-MM-DD):\n\n(आप 7 दिन पहले तक बुक कर सकते हैं)"
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
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "❌ No available slots on that date. Please try another date."
                        : "❌ उस तारीख पर कोई स्लॉट उपलब्ध नहीं है। कृपया किसी अन्य तारीख को आजमाएं।"
                );
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
                        ? "📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to 7 days in advance)"
                        : "📅 कृपया अपनी पसंदीदा तारीख दर्ज करें (YYYY-MM-DD):\n\n(आप 7 दिन पहले तक बुक कर सकते हैं)"
                );
                return;
            }

            const slots = await this.supabaseClient.getAvailableSlots(clinicId, doctorId, buttonId, locationType);
            if (!slots || slots.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "❌ No available slots on that date. Please try another date."
                        : "❌ उस तारीख पर कोई स्लॉट उपलब्ध नहीं है। कृपया किसी अन्य तारीख को आजमाएं।"
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
                    ? "📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to 7 days in advance)"
                    : "📅 कृपया अपनी पसंदीदा तारीख दर्ज करें (YYYY-MM-DD):\n\n(आप 7 दिन पहले तक बुक कर सकते हैं)"
            );
            return;
        }

        // Check availability
        const slots = await this.supabaseClient.getAvailableSlots(clinicId, doctorId, dateString, locationType);
        if (!slots || slots.length === 0) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ No available slots on that date. Please try another date."
                    : "❌ उस तारीख पर कोई स्लॉट उपलब्ध नहीं है। कृपया किसी अन्य तारीख को आजमाएं।"
            );

            // Offer to try another date
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "📅 Please enter another date (YYYY-MM-DD):"
                    : "📅 कृपया कोई अन्य तारीख दर्ज करें (YYYY-MM-DD):"
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
                        ? "❌ No available slots on that date. Please try another date."
                        : "❌ उस तारीख पर कोई स्लॉट उपलब्ध नहीं है। कृपया किसी अन्य तारीख को आजमाएं।"
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
                    ? "❌ Invalid time format. Please use HH:MM (e.g., 14:30)"
                    : "❌ अमान्य समय प्रारूप। कृपया HH:MM का उपयोग करें (उदा. 14:30)"
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
                    ? "❌ That time slot is no longer available. Please choose another:"
                    : "❌ वह समय स्लॉट अब उपलब्ध नहीं है। कृपया दूसरा चुनें:"
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
                ? `✅ Time selected: ${selectedTime}\n\n📝 Please provide your full name:`
                : `✅ समय चुना गया: ${selectedTime}\n\n📝 कृपया अपना पूरा नाम प्रदान करें:`
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
                    : "कृपया एक वैध नाम प्रदान करें (2-100 वर्ण)"
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
                        status: "confirmed"
                    }
                );

                await this.updateSession(phone, "MAIN_MENU", {
                    language,
                    lastAppointmentId: appointmentId
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `✅ Appointment confirmed!\n\n👨‍⚕️ Doctor: ${session.data?.selectedDoctorName}\n📅 Date: ${session.data?.selectedDate}\n🕐 Time: ${session.data?.selectedTime}\n📍 Location: ${session.data?.locationType === "home" ? "Home Visit" : "Clinic Visit"}\n\n📌 Booking ID: ${appointmentId}`
                        : `✅ नियुक्ति की पुष्टि हुई!\n\n👨‍⚕️ डॉक्टर: ${session.data?.selectedDoctorName}\n📅 तारीख: ${session.data?.selectedDate}\n🕐 समय: ${session.data?.selectedTime}\n📍 स्थान: ${session.data?.locationType === "home" ? "घर पर मुलाकात" : "क्लिनिक में"}\n\n📌 बुकिंग ID: ${appointmentId}`
                );

                // Notify doctor
                await this.notifyDoctorNewBooking(session.data?.selectedDoctorId, clinicId, session.data, language);
            } catch (error) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `❌ Booking failed: ${error instanceof Error ? error.message : "Unknown error"}`
                        : `❌ बुकिंग विफल: ${error instanceof Error ? error.message : "अज्ञात त्रुटि"}`
                );

                await this.updateSession(phone, "MAIN_MENU", { language });
            }

            await this.showMainMenu(phone, language);
        } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ Booking cancelled. Returning to main menu..."
                    : "❌ बुकिंग रद्द की गई। मुख्य मेनू पर जा रहे हैं..."
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
                : `क्या आप निश्चित रूप से नियुक्ति ${appointmentId} को रद्द करना चाहते हैं? (हाँ/नहीं)`
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

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
            const result = await cancelAppointment(
                this.supabase,
                session.data?.selectedAppointmentId,
                "Patient initiated cancellation"
            );

            if (result.success) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "✅ Appointment cancelled successfully."
                        : "✅ नियुक्ति सफलतापूर्वक रद्द की गई।"
                );
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `❌ Cancellation failed: ${result.message}`
                        : `❌ रद्दीकरण विफल: ${result.message}`
                );
            }

            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "नहीं") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Cancellation aborted."
                    : "रद्दीकरण रद्द किया गया।"
            );
            await this.showMainMenu(phone, language);
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please reply with 'yes' or 'no'"
                    : "कृपया 'हाँ' या 'नहीं' के साथ जवाब दें"
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
                : "कृपया नई नियुक्ति तारीख दें (YYYY-MM-DD):"
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
                    : "अमान्य तारीख प्रारूप। कृपया YYYY-MM-DD का उपयोग करें"
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
                : "कृपया नई नियुक्ति समय दें (HH:MM):"
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
                    : "अमान्य समय प्रारूप। कृपया HH:MM का उपयोग करें"
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
                : `नई नियुक्ति समय: ${session.data?.newDate} को ${newTime}\n\nपुष्टि करें? (हाँ/नहीं)`
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

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
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
                        ? `✅ Appointment rescheduled to ${session.data?.newDate} at ${session.data?.newTime}`
                        : `✅ नियुक्ति को ${session.data?.newDate} को ${session.data?.newTime} पर पुनः समय निर्धारित किया गया`
                );
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `❌ Rescheduling failed: ${result.message}`
                        : `❌ पुनः समय निर्धारण विफल: ${result.message}`
                );
            }

            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "नहीं") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Rescheduling aborted."
                    : "पुनः समय निर्धारण रद्द किया गया।"
            );
            await this.showMainMenu(phone, language);
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please reply with 'yes' or 'no'"
                    : "कृपया 'हाँ' या 'नहीं' के साथ जवाब दें"
            );
        }
    }

    /**
     * Helper: Show main menu options
     */
    private async showMainMenu(phone: string, language: string): Promise<void> {
        const message =
            language === "EN"
                ? "📋 What would you like to do?\n\n🔖 Tap a button to choose:"
                : "📋 आप क्या करना चाहते हैं?\n\n🔖 चुनने के लिए बटन दबाएं:";

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.PATIENT_MENU.BOOK, title: language === "EN" ? "📅 Book Appointment" : "📅 नियुक्ति बुक करें" },
            { id: BUTTON_IDS.PATIENT_MENU.APPOINTMENTS, title: language === "EN" ? "📝 My Appointments" : "📝 मेरी नियुक्तियाँ" },
            { id: BUTTON_IDS.PATIENT_MENU.CANCEL, title: language === "EN" ? "❌ Cancel" : "❌ रद्द करें" },
            { id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE, title: language === "EN" ? "🔄 Reschedule" : "🔄 पुनः समय निर्धारित करें" }
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
                        ? "❌ No doctors available at the moment."
                        : "❌ इस समय कोई डॉक्टर उपलब्ध नहीं है।"
                );
                return;
            }

            let message = language === "EN" ? "👨‍⚕️ Select a doctor:\n\n" : "👨‍⚕️ एक डॉक्टर चुनें:\n\n";

            doctors.forEach((doc: any, idx: number) => {
                message += `${idx + 1}. Dr. ${doc.name}\n`;
            });

            message += language === "EN" ? "\nTap a doctor to book an appointment" : "\nनियुक्ति बुक करने के लिए एक डॉक्टर दबाएं";

            await this.whatsappClient.sendTextMessage(phone, message);
        } catch (error) {
            debug("patientFlow", "Error loading doctors", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ Error loading doctors. Please try again."
                    : "❌ डॉक्टर लोड करने में त्रुटि। कृपया दोबारा कोशिश करें।"
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
                        : `${date} को कोई स्लॉट उपलब्ध नहीं है। कृपया दूसरी तारीख चुनें।`
                );

                await this.updateSession(phone, "BOOK_DATE", {
                    language,
                    selectedDoctorId: doctorId
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "Please provide a new date (YYYY-MM-DD):"
                        : "कृपया नई तारीख दें (YYYY-MM-DD):"
                );
                return;
            }

            let message = language === "EN" ? `Available times on ${date}:\n\n` : `${date} पर उपलब्ध समय:\n\n`;

            slots.slice(0, 8).forEach((slot, idx) => {
                message += `${idx + 1}. ${slot}\n`;
            });

            message += language === "EN" ? "\nReply with your preferred time (HH:MM)" : "\nअपना पसंदीदा समय (HH:MM) के साथ उत्तर दें";

            await this.whatsappClient.sendTextMessage(phone, message);
        } catch (error) {
            debug("patientFlow", "Error loading available times", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Error loading available times. Please try again."
                    : "उपलब्ध समय लोड करने में त्रुटि। कृपया दोबारा कोशिश करें।"
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
                        ? "📋 You have no upcoming appointments.\n\nWould you like to book one?"
                        : "📋 आपके पास कोई आने वाली नियुक्तियाँ नहीं हैं।\n\nक्या आप एक बुक करना चाहेंगे?",
                    [
                        { id: "menu_book", title: "📅 Book Appointment" },
                        { id: "nav_menu", title: "🏠 Main Menu" }
                    ]
                );
            } else {
                let message = language === "EN" 
                    ? "📋 Your Upcoming Appointments:\n\n" 
                    : "📋 आपकी आने वाली नियुक्तियाँ:\n\n";

                appointments.forEach((apt: any, idx: number) => {
                    message += `${idx + 1}. 🩺 Dr. ${apt.doctor_name || "Unknown"}\n   📅 ${this.formatDate(apt.appointment_date)}\n   🕐 ${apt.appointment_time}\n   Status: ${apt.status}\n\n`;
                });

                // Show with history and menu buttons
                await this.whatsappClient.sendInteractiveButtonMessage(
                    phone,
                    message,
                    [
                        { id: "appt_history", title: "📜 View History" },
                        { id: "nav_menu", title: "🏠 Main Menu" }
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
                    ? "❌ Error loading appointments. Please try again."
                    : "❌ नियुक्तियाँ लोड करने में त्रुटि। कृपया दोबारा कोशिश करें।"
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
                : "रद्द करने के लिए कृपया नियुक्ति आईडी प्रदान करें:"
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
                : "पुनः समय निर्धारित करने के लिए कृपया नियुक्ति आईडी प्रदान करें:"
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
        const message =
            language === "EN"
                ? `\ud83d\udcc4 Please confirm your appointment details:\n\n👨‍⚕️ Doctor: ${data?.selectedDoctorName || "Unknown"}\n📅 Date: ${data?.selectedDate || "TBD"}\n⏰ Time: ${data?.selectedTime || "TBD"}\n👤 Name: ${data?.patientName || "Patient"}\n📍 Type: ${data?.locationType === "home" ? "Home Visit" : "Clinic Visit"}\n\nIs everything correct?`
                : `\ud83d\udcc4 \u0915\u0915\u0943\u092a\u092f\u093e \u0905\u092a\u0928\u0940 \u0928\u093f\u092f\u0941\u0915\u094d\u0924\u093f \u0935\u093f\u0935\u0930\u0923 \u0915\u0940 \u092a\u0941\u0937\u094d\u091f\u093f \u0915\u0930\u0947\u0902:\n\n👨‍⚕️ \u0921\u0949\u0915\u094d\u091f\u0930: ${data?.selectedDoctorName || "Unknown"}\n📅 \u0924\u093e\u0930\u0940\u0916: ${data?.selectedDate || "TBD"}\n⏰ \u0938\u092e\u092f: ${data?.selectedTime || "TBD"}\n👤 \u0928\u093e\u092e: ${data?.patientName || "Patient"}\n📍 \u092a\u094d\u0930\u0915\u093e\u0930: ${data?.locationType === "home" ? "\u0918\u0930 \u092a\u0930 \u092e\u0941\u0932\u093e\u0915\u093e\u0924" : "\u0915\u094d\u0932\u093f\u0928\u093f\u0915 \u092e\u0947\u0902"}\n\n\u0915\u094d\u092f\u093e \u0938\u092c \u0915\u0941\u0921 \u0920\u0940\u0915 \u0939\u0948?`;\n\n        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [\n            { id: BUTTON_IDS.CONFIRMATION.YES, title: language === \"EN\" ? \"✅ Yes, Confirm\" : \"✅ \u0939\u093e\u0901, \u092a\u0941\u0937\u094d\u091f\u093f \u0915\u0930\u0947\u0902\" },\n            { id: BUTTON_IDS.CONFIRMATION.NO, title: language === \"EN\" ? \"❌ No, Cancel\" : \"❌ \u0928\u0939\u0940\u0902, \u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902\" }\n        ]);\n    }\n\n    /**\n     * Helper: Show date selection menu (Today, Tomorrow, Other)\n     */\n    private async showDateMenu(phone: string, language: string): Promise<void> {\n        const message = language === \"EN\"\n            ? \"📅 When would you like your appointment?\"\n            : \"📅 \u0906\u092a \u0905\u092a\u0928\u0940 \u0928\u093f\u092f\u0941\u0915\u094d\u0924\u093f \u0915\u092c \u0932\u0947\u0928\u0940 \u091a\u0941\u0928\u0947\u0902\u0917\u0947?\";\n\n        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [\n            { id: BUTTON_IDS.DATE_SELECT.TODAY, title: language === \"EN\" ? \"📌 Today\" : \"📌 \u0906\u091c\" },\n            { id: BUTTON_IDS.DATE_SELECT.TOMORROW, title: language === \"EN\" ? \"📌 Tomorrow\" : \"📌 \u0915\u0932\" },\n            { id: BUTTON_IDS.DATE_SELECT.OTHER, title: language === \"EN\" ? \"📅 Other Date\" : \"📅 \u0915\u0941\u0932 \u0924\u093e\u0930\u0940\u0916\" }\n        ]);\n    }\n\n    /**\n     * Helper: Show available time slots\n     */\n    private async showAvailableSlots(\n        phone: string,\n        language: string,\n        slots: any[],\n        page: number = 0\n    ): Promise<void> {\n        if (!slots || slots.length === 0) {\n            await this.whatsappClient.sendTextMessage(\n                phone,\n                language === \"EN\"\n                    ? \"\u274c No slots available for this date.\"\n                    : \"\u274c \u0907\u0938 \u0924\u093e\u0930\u0940\u0916 \u0915\u0947 \u0932\u093f\u090f \u0915\u094b\u0908 \u0938\u094d\u0932\u0949\u091f \u0938\u0940 \u0908 \u0909\u092a\u0932\u092c\u094d\u0927 \u0928\u0939\u0940\u0902 \u0939\u0948\u0964\"\n            );\n            return;\n        }\n\n        const itemsPerPage = 9;\n        const start = page * itemsPerPage;\n        const end = start + itemsPerPage;\n        const pageSlots = slots.slice(start, end);\n\n        let message = language === \"EN\" ? \"⏰ Select your preferred time:\\n\\n\" : \"⏰ \u0905\u092a\u0935\u0939 \u0938\u092e\u092f \u091a\u0941\u0928\u0947\u0902:\\n\\n\";\n\n        const buttons: any[] = [];\n        pageSlots.forEach((slot: any, idx: number) => {\n            const slotNumber = start + idx + 1;\n            const time = typeof slot === \"string\" ? slot : slot.start_time || slot.time;\n            message += `${slotNumber}. ${time}\\n`;\n            buttons.push({\n                id: `slot_${time}`,\n                title: time\n            });\n        });\n\n        // Add pagination buttons if needed\n        if (page > 0) {\n            buttons.push({\n                id: BUTTON_IDS.NAVIGATION.EARLIER,\n                title: language === \"EN\" ? \"⬅️ Earlier\" : \"⬅️ \u092a\u0939\u0932\u0947\"\n            });\n        }\n\n        if (end < slots.length) {\n            buttons.push({\n                id: BUTTON_IDS.NAVIGATION.MORE,\n                title: language === \"EN\" ? \"➡️ More\" : \"➡️ \u0926\u0942\u0938\u0930\u0947\"\n            });\n        }\n\n        if (buttons.length <= 3) {\n            await this.whatsappClient.sendInteractiveButtonMessage(phone, message, buttons);\n        } else {\n            // Use list menu for more options\n            const listItems = pageSlots.map((slot: any, idx: number) => {\n                const time = typeof slot === \"string\" ? slot : slot.start_time || slot.time;\n                return {\n                    id: time,\n                    title: time,\n                    description: `Slot ${start + idx + 1}`\n                };\n            });\n\n            await this.whatsappClient.sendInteractiveListMessage(\n                phone,\n                message,\n                listItems,\n                language === \"EN\" ? \"Select a time\" : \"\u0938\u092e\u092f \u091a\u0941\u0928\u0947\u0902\"\n            );\n        }\n    }\n\n    /**\n     * Helper: Format date as YYYY-MM-DD\n     */\n    private formatDate(date: Date): string {\n        const year = date.getFullYear();\n        const month = String(date.getMonth() + 1).padStart(2, \"0\");\n        const day = String(date.getDate()).padStart(2, \"0\");\n        return `${year}-${month}-${day}`;\n    }\n\n    /**\n     * Helper: Notify doctor of new booking\n     */\n    private async notifyDoctorNewBooking(\n        doctorId: string,\n        clinicId: string,\n        bookingData: any,\n        language: string\n    ): Promise<void> {\n        try {\n            const doctor = (await this.supabaseClient.getDoctors(clinicId))?.find(\n                (d: any) => d.doctor_id === doctorId\n            );\n\n            if (!doctor || !doctor.phone) return;\n\n            const message = language === \"EN\"\n                ? `\ud83d\udd14 New Appointment Booking\\n\\nPatient: ${bookingData?.patientName}\\nDate: ${bookingData?.selectedDate}\\nTime: ${bookingData?.selectedTime}\\nType: ${bookingData?.locationType === \"home\" ? \"Home Visit\" : \"Clinic\"}`\n                : `\ud83d\udd14 \u0928\u092f\u0940 \u0928\u093f\u092f\u0941\u0915\u094d\u0924\u093f\\n\\n\u0930\u094b\u0917\u0940: ${bookingData?.patientName}\\n\u0924\u093e\u0930\u0940\u0916: ${bookingData?.selectedDate}\\n\u0938\u092e\u092f: ${bookingData?.selectedTime}\\n\u092a\u094d\u0930\u0915\u093e\u0930: ${bookingData?.locationType === \"home\" ? \"\u0918\u0930 \u0935\u093f\u0938\u0948\" : \"\u0915\u094d\u0932\u093f\u0928\u093f\u0915\"}`;\n\n            await this.whatsappClient.sendTextMessage(doctor.phone, message);\n        } catch (error) {\n            debug(\"patientFlow\", \"Error notifying doctor of booking\", {\n                error: error instanceof Error ? error.message : String(error)\n            });\n        }\n    }\n\n    private async updateSession(phone: string, newState: string, data?: any): Promise<void> {
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
