import { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppMessage, WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidLanguageButton, isValidPatientMenuButton } from "../button-ids.ts";
import {
    bookAppointment,
    cancelAppointment,
    rescheduleAppointment,
    getAvailableSlots
} from "../appointments.ts";
import { debug, info, recordAuditEvent } from "../logger.ts";
import { isValidPatientName, normalizePhoneNumber } from "../validators.ts";

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
    ): Promise<void> {
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
     * BOOK_DATE - Select appointment date
     */
    private async handleBookDate(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const doctorId = session.data?.selectedDoctorId;
        const selectedDate = message.text.trim();

        // Validate date format
        if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Invalid date format. Please use YYYY-MM-DD (e.g., 2026-09-20)"
                    : "अमान्य तारीख प्रारूप। कृपया YYYY-MM-DD का उपयोग करें (उदा. 2026-09-20)"
            );
            return;
        }

        // Check if date is in future
        const dateObj = new Date(selectedDate);
        if (dateObj < new Date()) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please select a future date."
                    : "कृपया एक भविष्य की तारीख चुनें।"
            );
            return;
        }

        // Move to time selection
        await this.updateSession(phone, "BOOK_TIME", {
            language,
            selectedDoctorId: doctorId,
            selectedDoctorName: session.data?.selectedDoctorName,
            selectedDate
        });

        await this.showAvailableTimes(phone, doctorId, selectedDate, language);
    }

    /**
     * BOOK_TIME - Select appointment time
     */
    private async handleBookTime(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const doctorId = session.data?.selectedDoctorId;
        const selectedDate = session.data?.selectedDate;
        const selectedTime = message.text.trim();

        // Validate time format
        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(selectedTime)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Invalid time format. Please use HH:MM (e.g., 14:30)"
                    : "अमान्य समय प्रारूप। कृपया HH:MM का उपयोग करें (उदा. 14:30)"
            );
            return;
        }

        // Move to name confirmation
        await this.updateSession(phone, "BOOK_NAME", {
            language,
            selectedDoctorId: doctorId,
            selectedDoctorName: session.data?.selectedDoctorName,
            selectedDate,
            selectedTime
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `Selected time: ${selectedTime}\n\nPlease confirm or provide your full name:`
                : `चयनित समय: ${selectedTime}\n\nकृपया अपना पूरा नाम पुष्टि करें या प्रदान करें:`
        );
    }

    /**
     * BOOK_NAME - Confirm patient name
     */
    private async handleBookName(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
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
     * BOOK_CONFIRM - Final confirmation before booking
     */
    private async handleBookConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const confirmation = message.text.toLowerCase().trim();

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
            // Proceed with booking
            const result = await bookAppointment(this.supabase, this.whatsappClient, {
                patientPhone: phone,
                patientName: session.data?.patientName,
                doctorId: session.data?.selectedDoctorId,
                date: session.data?.selectedDate,
                time: session.data?.selectedTime
            });

            if (result.success) {
                await this.updateSession(phone, "MAIN_MENU", {
                    language,
                    lastAppointmentId: result.appointmentId
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `✅ Appointment confirmed!\n\nDoctor: ${session.data?.selectedDoctorName}\nDate: ${session.data?.selectedDate}\nTime: ${session.data?.selectedTime}\n\nBooking ID: ${result.appointmentId}`
                        : `✅ नियुक्ति की पुष्टि हुई!\n\nडॉक्टर: ${session.data?.selectedDoctorName}\nतारीख: ${session.data?.selectedDate}\nसमय: ${session.data?.selectedTime}\n\nबुकिंग ID: ${result.appointmentId}`
                );
            } else {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `❌ Booking failed: ${result.message}`
                        : `❌ बुकिंग विफल: ${result.message}`
                );

                await this.updateSession(phone, "MAIN_MENU", { language });
            }

            await this.showMainMenu(phone, language);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "नहीं") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Booking cancelled. Returning to main menu..."
                    : "बुकिंग रद्द की गई। मुख्य मेनू पर जा रहे हैं..."
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
     * MY_APPOINTMENTS - Show patient's upcoming appointments
     */
    private async handleMyAppointments(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        await this.updateSession(phone, "MAIN_MENU", { language });
        await this.showMyAppointments(phone, language);
    }

    /**
     * CANCEL_SELECT - Select appointment to cancel
     */
    private async handleCancelSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
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
    ): Promise<void> {
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
     * Helper: Show booking confirmation details
     */
    private async showBookingConfirmation(
        phone: string,
        data: any,
        language: string
    ): Promise<void> {
        const message =
            language === "EN"
                ? `Please confirm your appointment details:\n\n👨‍⚕️ Doctor: ${data.selectedDoctorName}\n📅 Date: ${data.selectedDate}\n⏰ Time: ${data.selectedTime}\n👤 Name: ${data.patientName}\n\nConfirm? (yes/no)`
                : `कृपया अपनी नियुक्ति विवरण की पुष्टि करें:\n\n👨‍⚕️ डॉक्टर: ${data.selectedDoctorName}\n📅 तारीख: ${data.selectedDate}\n⏰ समय: ${data.selectedTime}\n👤 नाम: ${data.patientName}\n\nपुष्टि करें? (हाँ/नहीं)`;

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: "confirm_yes", title: language === "EN" ? "Yes, Confirm" : "हाँ, पुष्टि करें" },
            { id: "confirm_no", title: language === "EN" ? "No, Cancel" : "नहीं, रद्द करें" }
        ]);
    }

    /**
     * Helper: Show patient's appointments
     */
    private async showMyAppointments(phone: string, language: string, clinicId: string): Promise<void> {
        try {
            const appointments = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);

            if (!appointments || appointments.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "📋 You have no upcoming appointments."
                        : "📋 आपके पास कोई आने वाली नियुक्तियाँ नहीं हैं।"
                );
            } else {
                let message = language === "EN" ? "📋 Your Appointments:\n\n" : "📋 आपकी नियुक्तियाँ:\n\n";

                appointments.forEach((apt: any, idx: number) => {
                    message += `${idx + 1}. Dr. ${apt.doctor_name || "Unknown"}\n   📅 ${apt.appointment_date} @ ${apt.appointment_time}\n   Status: ${apt.status}\n\n`;
                });

                await this.whatsappClient.sendTextMessage(phone, message);
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
