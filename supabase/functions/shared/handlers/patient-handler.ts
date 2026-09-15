import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppMessage, WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidPatientMenuButton, isValidConfirmationButton, isValidDateSelectButton, isServiceButton, serviceButtonId, serviceIdFromButton } from "../button-ids.ts";
import {
    getEnabledServices,
    getServiceById,
    formatPrice,
    type ClinicService
} from "../clinic-services.ts";
import { getClinicServiceSlots } from "../clinic-slots.ts";
import {
    cancelAppointment,
    rescheduleAppointment
} from "../appointments.ts";
import { createAppointmentReminders, markReminderAsSkipped } from "../appointment-reminders.ts";
import { debug, info, recordAuditEvent } from "../logger.ts";
import { isValidPatientName, normalizePhoneNumber, isValidBookingDate, formatBookingDateErrorMessage } from "../validators.ts";
import { AppointmentHistoryHandler } from "./appointment-history-handler.ts";
import { WaitlistHandler } from "./waitlist-handler.ts";
import { FeedbackHandler } from "./feedback-handler.ts";
import { getClinicConfig, getClinicGreeting } from "../clinic-config.ts";
import {
    isSupportedLanguageButton,
    resolveLanguageCode,
    sendLanguagePrompt
} from "../languages.ts";

/**
 * Patient Flow Handler - Manages all patient conversation states
 * Handles: booking, viewing, cancelling, and rescheduling appointments
 */

export class PatientFlowHandler {
    private supabase: SupabaseClient;
    private whatsappClient: any;
    private supabaseClient: MultiClinicSupabaseClient;
    private clinicId = "";

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
            // Session writes must never touch this patient's row at another clinic.
            this.clinicId = session.clinic_id;

            debug("patientFlow", `Processing state: ${state}`, { phone, messageText: message.text });

            // Patients often scroll up and tap an older menu button, so menu
            // ids are honoured from any state instead of being read as input.
            if (
                state !== "LANGUAGE_SELECT" &&
                state !== "MAIN_MENU" &&
                (isValidPatientMenuButton(message.text?.trim() || "") ||
                    isServiceButton(message.text?.trim() || ""))
            ) {
                await this.handleMainMenu(phone, message, { ...session, state: "MAIN_MENU" });
                return;
            }

            switch (state) {
                case "LANGUAGE_SELECT":
                    await this.handleLanguageSelect(phone, message, session);
                    break;

                case "MAIN_MENU":
                    await this.handleMainMenu(phone, message, session);
                    break;

                case "WAITLIST_CONFIRM":
                    await new WaitlistHandler(this.supabase, this.whatsappClient)
                        .handleWaitlistConfirm(phone, session, message.text?.trim() || "");
                    break;

                case "FEEDBACK_RATING":
                    await new FeedbackHandler(this.supabase, this.whatsappClient)
                        .handleRating(phone, message, session);
                    break;

                case "FEEDBACK_COMMENTS":
                    await new FeedbackHandler(this.supabase, this.whatsappClient)
                        .handleComments(phone, message, session);
                    break;

                case "SERVICE_SELECT":
                    await this.handleServiceSelect(phone, message, session);
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
        if (!isSupportedLanguageButton(buttonId)) {
            await this.askLanguage(phone);
            return;
        }

        // Parse selected language
        const selectedLanguage = resolveLanguageCode(buttonId);

        // Remember it so returning patients are not asked again.
        try {
            await this.supabaseClient.setPatientLanguage(phone, selectedLanguage, session.clinic_id);
        } catch (error) {
            debug("patientFlow", "Could not persist language preference", {
                error: error instanceof Error ? error.message : String(error)
            });
        }

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

        // Service ids are per clinic, so they cannot be part of the fixed list.
        if (isServiceButton(buttonId)) {
            await this.handleServiceChosen(phone, language, clinicId, serviceIdFromButton(buttonId));
            return;
        }

        // Validate button ID
        if (!isValidPatientMenuButton(buttonId)) {
            await this.showMainMenu(phone, language);
            return;
        }

        // Parse menu choice
        switch (buttonId) {
            case BUTTON_IDS.PATIENT_MENU.BOOK:
                await this.startBooking(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.APPOINTMENTS:
                await this.updateSession(phone, "MY_APPOINTMENTS");
                await this.showUpcomingAppointments(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.CANCEL:
                await this.updateSession(phone, "CANCEL_SELECT");
                await this.showCancelOptions(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.RESCHEDULE:
                await this.updateSession(phone, "RESCHEDULE_SELECT");
                await this.showRescheduleOptions(phone, language, clinicId);
                break;

            case BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION:
                await this.updateSession(phone, "LOCATION_SELECT", { language });
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "Please share your location or type your address for home sample collection."
                        : "कृपया घर से सैंपल लेने के लिए अपना स्थान साझा करें या पता लिखें।"
                );
                break;

            case BUTTON_IDS.PATIENT_MENU.MORE:
                await this.updateSession(phone, "MAIN_MENU", { language });
                await this.showMoreMenu(phone, language);
                break;

            case BUTTON_IDS.PATIENT_MENU.CHANGE_LANGUAGE:
                await this.updateSession(phone, "LANGUAGE_SELECT", { language });
                await this.askLanguage(phone);
                break;

            case BUTTON_IDS.PATIENT_MENU.MAIN_MENU:
                await this.updateSession(phone, "MAIN_MENU", { language });
                await this.showMainMenu(phone, language);
                break;

            default:
                await this.updateSession(phone, "MAIN_MENU", { language });
                await this.showMainMenu(phone, language);
        }
    }

    /**
     * Start booking.
     *
     * The service comes first because it decides whether a doctor is even
     * involved. A clinic offering one service should not be asked to choose.
     */
    private async startBooking(phone: string, language: string, clinicId: string): Promise<void> {
        const services = await getEnabledServices(this.supabase, clinicId, "clinic");

        if (services.length === 0) {
            // A clinic that has configured nothing must not show an empty menu.
            debug("patientFlow", "No services enabled, falling back to consultation", { clinicId });

            await this.updateSession(phone, "BOOK_DOCTOR");
            await this.showDoctorList(phone, language, clinicId);
            return;
        }

        if (services.length === 1) {
            await this.handleServiceChosen(phone, language, clinicId, services[0].serviceTypeId);
            return;
        }

        await this.updateSession(phone, "SERVICE_SELECT", { language });
        await this.showServiceList(phone, language, services);
    }

    private async showServiceList(
        phone: string,
        language: string,
        services: ClinicService[]
    ): Promise<void> {
        const isEn = language === "EN";
        const header = isEn ? "🩺 What do you need?" : "🩺 आपको क्या चाहिए?";

        // WhatsApp allows at most 10 rows, and at most 3 reply buttons.
        const shown = services.slice(0, 10);

        const options = shown.map((s) => {
            const price = formatPrice(s.clinicPrice, language);

            return {
                id: serviceButtonId(s.serviceTypeId),
                title: s.name.slice(0, 24),
                description: price ? `${price} · ${s.durationMinutes} min` : `${s.durationMinutes} min`
            };
        });

        if (options.length <= 3) {
            await this.whatsappClient.sendInteractiveButtonMessage(
                phone,
                header,
                // Sliced as well as guarded: the client throws above three, and
                // that must not depend on the condition above staying correct.
                options.slice(0, 3).map((o) => ({ id: o.id, title: o.title })),
                this.supabase
            );
            return;
        }

        await this.whatsappClient.sendInteractiveListMessage(
            phone,
            header,
            isEn ? "Choose a service" : "सेवा चुनें",
            [{ title: isEn ? "Services" : "सेवाएं", rows: options }],
            this.supabase
        );
    }

    /**
     * A service was picked, so route to whatever that service needs next.
     */
    private async handleServiceChosen(
        phone: string,
        language: string,
        clinicId: string,
        serviceTypeId: string
    ): Promise<void> {
        const service = await getServiceById(this.supabase, clinicId, serviceTypeId);

        // Hiding a button is not authorisation: a stale tap must not book a
        // service the clinic has since switched off.
        if (!service || !service.offeredAtClinic) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Sorry, that service is not available at this clinic."
                    : "क्षमा करें, यह सेवा इस क्लिनिक में उपलब्ध नहीं है।"
            );
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language);
            return;
        }

        const data = {
            language,
            serviceTypeId: service.serviceTypeId,
            serviceName: service.name,
            requiresDoctor: service.requiresDoctor
        };

        if (service.requiresDoctor) {
            await this.updateSession(phone, "BOOK_DOCTOR", data);
            await this.showDoctorList(phone, language, clinicId);
            return;
        }

        await this.updateSession(phone, "BOOK_DATE", data);
        await this.showDateMenu(phone, language);
    }

    /**
     * SERVICE_SELECT - the patient is choosing what they need
     */
    private async handleServiceSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const language = session.data?.language || "EN";
        const reply = message.text.trim();

        if (isServiceButton(reply)) {
            await this.handleServiceChosen(
                phone,
                language,
                session.clinic_id,
                serviceIdFromButton(reply)
            );
            return;
        }

        const services = await getEnabledServices(this.supabase, session.clinic_id, "clinic");
        const index = Number(reply);

        if (Number.isInteger(index) && index >= 1 && index <= services.length) {
            await this.handleServiceChosen(
                phone,
                language,
                session.clinic_id,
                services[index - 1].serviceTypeId
            );
            return;
        }

        await this.showServiceList(phone, language, services);
    }

    /**
     * Times available for whatever the patient is booking.
     *
     * A service with no doctor has no doctor hours to draw slots from, so it
     * falls back to the clinic's own opening hours and the service's capacity.
     */
    private async slotsForBooking(
        session: WhatsAppSession,
        clinicId: string,
        date: string,
        locationType: string
    ): Promise<string[]> {
        const doctorId = session.data?.selectedDoctorId;

        if (doctorId) {
            return await this.supabaseClient.getAvailableSlots(clinicId, doctorId, date, locationType);
        }

        const serviceTypeId = session.data?.serviceTypeId;

        if (!serviceTypeId) {
            return [];
        }

        const service = await getServiceById(this.supabase, clinicId, serviceTypeId);

        if (!service) {
            return [];
        }

        return await getClinicServiceSlots(this.supabase, clinicId, service, date);
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
        const reply = message.text.trim();
        const doctorPage = session.data?.doctorPage || 0;

        if (reply === BUTTON_IDS.PAGINATION.MORE_DOCTORS) {
            await this.updateSession(phone, "BOOK_DOCTOR", {
                ...session.data,
                language,
                doctorPage: doctorPage + 1
            });
            await this.showDoctorList(phone, language, clinicId, doctorPage + 1);
            return;
        }

        // Accept the list row id, a raw id, or the position shown in the list.
        const doctors = await this.supabaseClient.getDoctors(clinicId);
        const doctorId = reply.startsWith("doctor_") ? reply.substring(7) : reply;

        let doctor = doctors.find((d) => d.id === doctorId);

        if (!doctor && /^\d+$/.test(reply)) {
            doctor = doctors[doctorPage * 9 + Number(reply) - 1];
        }

        if (!doctor) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ Invalid doctor selection. Please select a valid doctor."
                    : "❌ अमान्य डॉक्टर चयन। कृपया एक वैध डॉक्टर चुनें।",
                this.supabase
            );
            await this.showDoctorList(phone, language, clinicId, doctorPage);
            return;
        }

        // Store selected doctor and move to date selection
        await this.updateSession(phone, "BOOK_DATE", {
            ...session.data,
            language,
            selectedDoctorId: doctor.id,
            selectedDoctorName: doctor.name
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `✅ You've selected Dr. ${doctor.name}.`
                : `✅ आपने डॉ. ${doctor.name} का चयन किया है।`,
            this.supabase
        );

        await this.showDateMenu(phone, language);
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
                selectedDate = this.toISODate(today);
            } else if (buttonId === BUTTON_IDS.DATE_SELECT.TOMORROW) {
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                selectedDate = this.toISODate(tomorrow);
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
            const slots = await this.slotsForBooking(session, clinicId, selectedDate, locationType);
            if (!slots || slots.length === 0) {
                // Check if doctor is unavailable (not AVAILABLE or IN_CONSULTATION)
                const doctorAvailable = await this.supabaseClient.isDoctorAvailable(clinicId, doctorId);
                
                if (!doctorAvailable) {
                    const doctorStatus = await this.supabaseClient.getDoctorAvailabilityStatus(clinicId, doctorId);
                    const statusMessage = 
                        doctorStatus === 'ON_BREAK'
                            ? (language === "EN" ? "Dr. is currently on break" : "डॉ. वर्तमान में ब्रेक पर हैं")
                            : doctorStatus === 'BUSY'
                            ? (language === "EN" ? "Dr. is currently busy" : "डॉ. वर्तमान में व्यस्त हैं")
                            : (language === "EN" ? "Dr. is not available" : "डॉ. उपलब्ध नहीं हैं");
                    
                    await this.whatsappClient.sendTextMessage(
                        phone,
                        language === "EN"
                            ? `❌ ${statusMessage}. Please try another doctor or date.`
                            : `❌ ${statusMessage}। कृपया किसी अन्य डॉक्टर या तारीख को आजमाएं।`
                    );
                } else {
                    await this.offerWaitlist(
                        phone,
                        language,
                        doctorId,
                        session.data?.selectedDoctorName || "the doctor",
                        selectedDate,
                        session
                    );
                    return;
                }
                await this.showDateMenu(phone, language);
                return;
            }

            // Move to time selection
            await this.updateSession(phone, "BOOK_TIME", {
                ...session.data,
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

            const slots = await this.slotsForBooking(session, clinicId, buttonId, locationType);
            if (!slots || slots.length === 0) {
                await this.offerWaitlist(
                    phone,
                    language,
                    doctorId,
                    session.data?.selectedDoctorName || "the doctor",
                    buttonId,
                    session
                );
                return;
            }

            await this.updateSession(phone, "BOOK_TIME", {
                ...session.data,
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
        const slots = await this.slotsForBooking(session, clinicId, dateString, locationType);
        if (!slots || slots.length === 0) {
            // Check if doctor is unavailable (not AVAILABLE or IN_CONSULTATION)
            const doctorAvailable = await this.supabaseClient.isDoctorAvailable(clinicId, doctorId);
            
            if (!doctorAvailable) {
                const doctorStatus = await this.supabaseClient.getDoctorAvailabilityStatus(clinicId, doctorId);
                const statusMessage = 
                    doctorStatus === 'ON_BREAK'
                        ? (language === "EN" ? "Dr. is currently on break" : "डॉ. वर्तमान में ब्रेक पर हैं")
                        : doctorStatus === 'BUSY'
                        ? (language === "EN" ? "Dr. is currently busy" : "डॉ. वर्तमान में व्यस्त हैं")
                        : (language === "EN" ? "Dr. is not available" : "डॉ. उपलब्ध नहीं हैं");
                
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `❌ ${statusMessage}. Please try another doctor or date.`
                        : `❌ ${statusMessage}। कृपया किसी अन्य डॉक्टर या तारीख को आजमाएं।`
                );
            } else {
                await this.offerWaitlist(
                    phone,
                    language,
                    doctorId,
                    session.data?.selectedDoctorName || "the doctor",
                    dateString,
                    session
                );
                return;
            }

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
            ...session.data,
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
        // Buttons arrive as "slot_HH:MM"; typed replies as "HH:MM".
        const rawTime = message.text.trim();
        const selectedTime = rawTime.startsWith("slot_") ? rawTime.substring(5) : rawTime;
        const doctorId = session.data?.selectedDoctorId;
        const selectedDate = session.data?.selectedDate;
        const clinicId = session.clinic_id;
        const locationType = session.data?.locationType || "clinic";

        if (rawTime === BUTTON_IDS.PAGINATION.MORE_SLOTS) {
            const nextPage = (session.data?.slotPage || 0) + 1;
            const allSlots = await this.slotsForBooking(session, clinicId, selectedDate, locationType);

            await this.updateSession(phone, "BOOK_TIME", { ...session.data, slotPage: nextPage });
            await this.showAvailableSlots(phone, language, allSlots, nextPage);
            return;
        }

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
        const slots = await this.slotsForBooking(session, clinicId, selectedDate, locationType);
        const slotExists = slots?.some(
            (s: any) => (typeof s === "string" ? s : s.start_time || s.time) === selectedTime
        );

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
            ...session.data,
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
            ...session.data,
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
                // One active appointment per patient: block a second concurrent booking.
                const upcoming = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);
                const active = upcoming?.find(
                    (a: any) => a.status === "CONFIRMED" || a.status === "RESCHEDULED"
                );

                if (active) {
                    await this.whatsappClient.sendTextMessage(
                        phone,
                        `You already have an appointment on ${active.appointment_date} at ${active.appointment_time}. Please cancel or reschedule it before booking another.`
                    );

                    await this.updateSession(phone, "MAIN_MENU", { language });
                    await this.showMainMenu(phone, language);
                    return;
                }

                // Falls back to consultation for sessions that began before the
                // clinic had services configured.
                const serviceTypeId =
                    session.data?.serviceTypeId ||
                    (await this.supabaseClient.getServiceTypeIdByCode("CONSULTATION"));

                // Keep a patient record so history and preferences have an owner.
                try {
                    await this.supabaseClient.getOrCreatePatient(
                        phone,
                        session.data?.patientName || "Patient",
                        session.clinic_id
                    );
                } catch (patientError) {
                    debug("patientFlow", "Could not upsert patient record", {
                        error: patientError instanceof Error ? patientError.message : String(patientError)
                    });
                }

                const appointment = await this.supabaseClient.createAppointment({
                    clinic_id: clinicId,
                    patient_phone: phone,
                    patient_name: session.data?.patientName || "Patient",
                    doctor_id: session.data?.selectedDoctorId,
                    service_type_id: serviceTypeId as string,
                    appointment_date: session.data?.selectedDate,
                    appointment_time: session.data?.selectedTime,
                    location_type: session.data?.locationType || "clinic",
                    preferred_language: language  // Store patient's language preference for reminders
                });

                const appointmentId = appointment.id;

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
                        ? `✅ Appointment confirmed!\n\n👨‍⚕️ Doctor: ${session.data?.selectedDoctorName}\n📅 Date: ${session.data?.selectedDate}\n🕐 Time: ${session.data?.selectedTime}\n📍 Location: ${session.data?.locationType === "home" ? "Home Visit" : "Clinic Visit"}\n\n📌 Booking ID: ${appointmentId}\n\n⏰ You'll receive reminders before your appointment.`
                        : `✅ नियुक्ति की पुष्टि हुई!\n\n👨‍⚕️ डॉक्टर: ${session.data?.selectedDoctorName}\n📅 तारीख: ${session.data?.selectedDate}\n🕐 समय: ${session.data?.selectedTime}\n📍 स्थान: ${session.data?.locationType === "home" ? "घर पर मुलाकात" : "क्लिनिक में"}\n\n📌 बुकिंग ID: ${appointmentId}\n\n⏰ आपको अपॉइंटमेंट से पहले रिमाइंडर मिलेंगे।`
                );

                // Best effort: a booking must never fail because the doctor
                // could not be reached.
                await this.notifyDoctorNewBooking(
                    session.data?.selectedDoctorId,
                    clinicId,
                    session.data
                );
            } catch (error) {
                // Someone claimed the slot between selection and insert.
                if (error instanceof Error && error.message === "SLOT_TAKEN") {
                    await this.whatsappClient.sendTextMessage(
                        phone,
                        "That time was just booked by someone else. Please choose another slot."
                    );

                    await this.updateSession(phone, "MAIN_MENU", { language });
                    await this.showMainMenu(phone, language);
                    return;
                }

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
        const clinicId = session.clinic_id;
        // The list is numbered, so "2" must be mapped back to its appointment id.
        const appointmentId = await this.resolveAppointmentId(phone, clinicId, message.text);

        if (!appointmentId) {
            await this.showCancelOptions(phone, language, clinicId);
            return;
        }

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
        // Accept tapped buttons (confirm_yes/confirm_no) as well as typed replies.
        const confirmation = this.normalizeConfirmation(message.text);

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
            const appointmentId = session.data?.selectedAppointmentId;
            const clinicId = session.clinic_id;

            // Captured before cancelling so the freed slot can be offered on.
            const { data: cancelled } = await this.supabase
                .from("appointments")
                .select("doctor_id, appointment_date, appointment_time")
                .eq("id", appointmentId)
                .eq("clinic_id", clinicId)
                .maybeSingle();

            const result = await cancelAppointment(
                this.supabase,
                appointmentId,
                clinicId,
                "Patient initiated cancellation"
            );

            if (result.success) {
                // Mark reminders as skipped (don't send reminders for cancelled appointments)
                await markReminderAsSkipped(this.supabase, appointmentId, "24_HOUR");
                await markReminderAsSkipped(this.supabase, appointmentId, "1_HOUR");

                if (cancelled) {
                    const waitlist = new WaitlistHandler(this.supabase, this.whatsappClient);

                    await waitlist.notifyWaitlistOnCancellation(
                        cancelled.doctor_id,
                        cancelled.appointment_date,
                        cancelled.appointment_time,
                        clinicId
                    );

                    // Patients on the date-level waitlist are waiting on "ANY" time.
                    await waitlist.notifyWaitlistOnCancellation(
                        cancelled.doctor_id,
                        cancelled.appointment_date,
                        "ANY",
                        clinicId
                    );
                }

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
        const clinicId = session.clinic_id;
        // The list is numbered, so "2" must be mapped back to its appointment id.
        const appointmentId = await this.resolveAppointmentId(phone, clinicId, message.text);

        if (!appointmentId) {
            await this.showRescheduleOptions(phone, language, clinicId);
            return;
        }

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

        // Reschedule must honour the same 0-7 day window as a new booking.
        const rescheduleWindow = isValidBookingDate(newDate);
        if (!rescheduleWindow.valid) {
            await this.whatsappClient.sendTextMessage(
                phone,
                formatBookingDateErrorMessage(rescheduleWindow.error || "invalid_format", language)
            );
            return;
        }

        if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Invalid date format. Please use YYYY-MM-DD"
                    : "अमान्य तारीख प्रारूप। कृपया YYYY-MM-DD का उपयोग करें"
            );
            return;
        }

        // The new time must come from the same doctor's real availability.
        const { data: appointment } = await this.supabase
            .from("appointments")
            .select("doctor_id")
            .eq("id", session.data?.selectedAppointmentId)
            .maybeSingle();

        const slots = appointment
            ? await this.supabaseClient.getAvailableSlots(
                  session.clinic_id,
                  appointment.doctor_id,
                  newDate,
                  "clinic"
              )
            : [];

        if (!slots || slots.length === 0) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ No available slots on that date. Please enter another date (YYYY-MM-DD):"
                    : "❌ उस तारीख पर कोई स्लॉट उपलब्ध नहीं है। कृपया कोई अन्य तारीख दर्ज करें (YYYY-MM-DD):",
                this.supabase
            );
            return;
        }

        await this.updateSession(phone, "RESCHEDULE_TIME", {
            language,
            selectedAppointmentId: session.data?.selectedAppointmentId,
            rescheduleDoctorId: appointment?.doctor_id,
            newDate,
            slotPage: 0
        });

        await this.showAvailableSlots(phone, language, slots, 0);
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
        const rawTime = message.text.trim();
        const newTime = rawTime.startsWith("slot_") ? rawTime.substring(5) : rawTime;
        const doctorId = session.data?.rescheduleDoctorId;
        const newDate = session.data?.newDate;

        if (rawTime === BUTTON_IDS.PAGINATION.MORE_SLOTS) {
            const nextPage = (session.data?.slotPage || 0) + 1;
            const allSlots = await this.supabaseClient.getAvailableSlots(
                session.clinic_id,
                doctorId,
                newDate,
                "clinic"
            );

            await this.updateSession(phone, "RESCHEDULE_TIME", { ...session.data, slotPage: nextPage });
            await this.showAvailableSlots(phone, language, allSlots, nextPage);
            return;
        }

        if (!/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(newTime)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Invalid time format. Please use HH:MM"
                    : "अमान्य समय प्रारूप। कृपया HH:MM का उपयोग करें",
                this.supabase
            );
            return;
        }

        // Guard against typed times that are not actually free.
        const slots = await this.supabaseClient.getAvailableSlots(
            session.clinic_id,
            doctorId,
            newDate,
            "clinic"
        );

        const slotFree = slots?.some(
            (s: any) => (typeof s === "string" ? s : s.start_time || s.time) === newTime
        );

        if (!slotFree) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ That time is not available. Please pick one of these:"
                    : "❌ वह समय उपलब्ध नहीं है। कृपया इनमें से चुनें:",
                this.supabase
            );
            await this.showAvailableSlots(phone, language, slots, 0);
            return;
        }

        await this.updateSession(phone, "RESCHEDULE_CONFIRM", {
            language,
            selectedAppointmentId: session.data?.selectedAppointmentId,
            rescheduleDoctorId: doctorId,
            newDate,
            newTime
        });

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            language === "EN"
                ? `New appointment time: ${newDate} at ${newTime}\n\nConfirm?`
                : `नई नियुक्ति समय: ${newDate} को ${newTime}\n\nपुष्टि करें?`,
            [
                { id: BUTTON_IDS.CONFIRMATION.YES, title: language === "EN" ? "Yes, Confirm" : "हाँ, पुष्टि करें" },
                { id: BUTTON_IDS.CONFIRMATION.NO, title: language === "EN" ? "No, Cancel" : "नहीं, रद्द करें" }
            ],
            this.supabase
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
        // Accept tapped buttons (confirm_yes/confirm_no) as well as typed replies.
        const confirmation = this.normalizeConfirmation(message.text);

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
            const result = await rescheduleAppointment(
                this.supabase,
                session.data?.selectedAppointmentId,
                session.clinic_id,
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
    /**
     * Offer the waitlist when a date is fully booked.
     * Session keys here must match what WaitlistHandler reads.
     */
    private async offerWaitlist(
        phone: string,
        language: string,
        doctorId: string,
        doctorName: string,
        date: string,
        session: WhatsAppSession
    ): Promise<void> {
        await this.updateSession(phone, "WAITLIST_CONFIRM", {
            language,
            doctorId,
            doctorName,
            date,
            time: "ANY"
        });

        await new WaitlistHandler(this.supabase, this.whatsappClient).showWaitlistOffer(
            phone,
            doctorId,
            date,
            "ANY",
            doctorName,
            session
        );
    }

    private async showMainMenu(phone: string, language: string): Promise<void> {
        const message =
            language === "EN"
                ? "📋 What would you like to do?\n\n🔖 Tap a button to choose:"
                : "📋 आप क्या करना चाहते हैं?\n\n🔖 चुनने के लिए बटन दबाएं:";

        // Offering home collection at a clinic that does not do it wastes one of
        // only three buttons and strands the patient in a dead flow.
        const homeServices = this.clinicId
            ? await getEnabledServices(this.supabase, this.clinicId, "home")
            : [];

        const buttons: Array<{ id: string; title: string }> = [
            { id: BUTTON_IDS.PATIENT_MENU.BOOK, title: language === "EN" ? "📅 Book Appointment" : "📅 नियुक्ति बुक करें" }
        ];

        if (homeServices.length > 0) {
            buttons.push({
                id: BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION,
                title: language === "EN" ? "🏠 Home Collection" : "🏠 घर से सैंपल"
            });
        }

        buttons.push({
            id: BUTTON_IDS.PATIENT_MENU.MORE,
            title: language === "EN" ? "➕ More Options" : "➕ अन्य विकल्प"
        });

        // WhatsApp allows a maximum of 3 reply buttons, so the less common
        // actions live behind "More Options".
        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            message,
            buttons,
            this.supabase
        );
    }

    /**
     * Helper: Show the secondary menu (actions that do not fit in 3 buttons)
     */
    private async showMoreMenu(phone: string, language: string): Promise<void> {
        const isEn = language === "EN";

        const rows = [
            {
                id: BUTTON_IDS.PATIENT_MENU.APPOINTMENTS,
                title: isEn ? "📝 My Appointments" : "📝 मेरी नियुक्तियाँ",
                description: isEn ? "View your upcoming appointments" : "अपनी आगामी नियुक्तियाँ देखें"
            },
            {
                id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE,
                title: isEn ? "🔄 Reschedule" : "🔄 समय बदलें",
                description: isEn ? "Change the date or time" : "तारीख या समय बदलें"
            },
            {
                id: BUTTON_IDS.PATIENT_MENU.CANCEL,
                title: isEn ? "❌ Cancel Appointment" : "❌ नियुक्ति रद्द करें",
                description: isEn ? "Cancel an existing appointment" : "मौजूदा नियुक्ति रद्द करें"
            },
            {
                id: BUTTON_IDS.PATIENT_MENU.CHANGE_LANGUAGE,
                title: isEn ? "🌐 Change Language" : "🌐 भाषा बदलें",
                description: isEn ? "Choose your preferred language" : "अपनी पसंदीदा भाषा चुनें"
            },
            {
                id: BUTTON_IDS.PATIENT_MENU.MAIN_MENU,
                title: isEn ? "↩️ Main Menu" : "↩️ मुख्य मेनू",
                description: isEn ? "Return to the main menu" : "मुख्य मेनू पर लौटें"
            }
        ];

        const body = isEn ? "📋 More options:" : "📋 अन्य विकल्प:";

        try {
            await this.whatsappClient.sendInteractiveListMessage(
                phone,
                body,
                isEn ? "Choose" : "चुनें",
                [{ title: isEn ? "Options" : "विकल्प", rows }],
                this.supabase
            );
        } catch (error) {
            debug("patientFlow", "More options list failed, sending text fallback", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                `${body}\n\n${rows.map((row) => row.title).join("\n")}`,
                this.supabase
            );
        }
    }

    /**
     * Helper: Prompt for language selection
     */
    private async askLanguage(phone: string): Promise<void> {
        await sendLanguagePrompt(
            this.whatsappClient,
            phone,
            "Please select your language / कृपया अपनी भाषा चुनें:",
            this.supabase
        );
    }

    /**
     * Helper: Show available doctors
     */
    private async showDoctorList(
        phone: string,
        language: string,
        clinicId: string,
        page = 0
    ): Promise<void> {
        try {
            const doctors = await this.supabaseClient.getDoctors(clinicId);

            if (!doctors || doctors.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "❌ No doctors available at the moment."
                        : "❌ इस समय कोई डॉक्टर उपलब्ध नहीं है।",
                    this.supabase
                );
                return;
            }

            // 10 rows max per list, so the last row is reserved for paging.
            const pageSize = 9;
            const start = page * pageSize;
            const pageDoctors = doctors.slice(start, start + pageSize);
            const hasMore = doctors.length > start + pageSize;

            if (pageDoctors.length === 0) {
                await this.showDoctorList(phone, language, clinicId, 0);
                return;
            }

            const availableStatuses = ["AVAILABLE", "IN_CONSULTATION"];

            const rows = pageDoctors.map((doc: any) => {
                const available = availableStatuses.includes(doc.availability_status);

                const statusLabel = available
                    ? language === "EN"
                        ? "Available"
                        : "उपलब्ध"
                    : doc.availability_status === "ON_BREAK"
                      ? language === "EN"
                          ? "On break"
                          : "ब्रेक पर"
                      : doc.availability_status === "BUSY"
                        ? language === "EN"
                            ? "Busy"
                            : "व्यस्त"
                        : language === "EN"
                          ? "Offline"
                          : "ऑफलाइन";

                return {
                    id: `doctor_${doc.id}`,
                    title: this.truncate(`${available ? "✅" : "⚠️"} Dr. ${doc.name}`, 24),
                    description: this.truncate(
                        doc.specialization ? `${doc.specialization} · ${statusLabel}` : statusLabel,
                        72
                    )
                };
            });

            if (hasMore) {
                rows.push({
                    id: BUTTON_IDS.PAGINATION.MORE_DOCTORS,
                    title: language === "EN" ? "➡️ More doctors" : "➡️ और डॉक्टर",
                    description: language === "EN" ? "Show the next doctors" : "अगले डॉक्टर दिखाएं"
                });
            }

            const body = language === "EN" ? "👨‍⚕️ Select a doctor:" : "👨‍⚕️ एक डॉक्टर चुनें:";

            await this.whatsappClient.sendInteractiveListMessage(
                phone,
                body,
                language === "EN" ? "Doctors" : "डॉक्टर",
                [{ title: language === "EN" ? "Doctors" : "डॉक्टर", rows }],
                this.supabase
            );
        } catch (error) {
            debug("patientFlow", "Error loading doctors", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ Error loading doctors. Please try again."
                    : "❌ डॉक्टर लोड करने में त्रुटि। कृपया दोबारा कोशिश करें।",
                this.supabase
            );
        }
    }

    private truncate(value: string, max: number): string {
        const characters = [...value];
        return characters.length <= max ? value : characters.slice(0, max - 1).join("") + "…";
    }

    /**
     * Tell the doctor a slot has just been taken.
     *
     * Never throws: the patient's booking is already committed, and Meta
     * rejects messages outside the 24 hour window.
     */
    private async notifyDoctorNewBooking(
        doctorId: string | undefined,
        clinicId: string,
        data: Record<string, any> | undefined
    ): Promise<void> {
        if (!doctorId) {
            return;
        }

        try {
            const { data: doctor } = await this.supabase
                .from("doctors")
                .select("phone, name")
                .eq("id", doctorId)
                .eq("clinic_id", clinicId)
                .eq("is_active", true)
                .maybeSingle();

            if (!doctor?.phone) {
                return;
            }

            await this.whatsappClient.sendTextMessage(
                doctor.phone,
                `📅 New booking\n\n${data?.patientName || "A patient"} — ${data?.selectedDate} at ${data?.selectedTime}`,
                this.supabase
            );
        } catch (error) {
            debug("patientFlow", "Could not notify doctor of new booking", {
                doctorId,
                error: error instanceof Error ? error.message : String(error)
            });
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
                    ],
                    this.supabase
                );
            } else {
                let message = language === "EN" 
                    ? "📋 Your Upcoming Appointments:\n\n" 
                    : "📋 आपकी आने वाली नियुक्तियाँ:\n\n";

                // The query embeds the doctor, so the name is nested.
                appointments.forEach((apt: any, idx: number) => {
                    message += `${idx + 1}. 🩺 Dr. ${apt.doctor?.name || "Unknown"}\n   📅 ${this.formatDate(apt.appointment_date)}\n   🕐 ${apt.appointment_time}\n   Status: ${apt.status}\n\n`;
                });

                // Show with history and menu buttons
                await this.whatsappClient.sendInteractiveButtonMessage(
                    phone,
                    message,
                    [
                        { id: "appt_history", title: "📜 View History" },
                        { id: "nav_menu", title: "🏠 Main Menu" }
                    ],
                    this.supabase
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
    /**
     * Helper: Map a position from the numbered list onto an appointment id
     */
    private async resolveAppointmentId(
        phone: string,
        clinicId: string,
        input: string
    ): Promise<string | null> {
        const raw = (input || "").trim();

        if (!/^\d+$/.test(raw)) {
            return raw || null;
        }

        const appointments = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);
        const index = parseInt(raw, 10) - 1;

        if (!appointments || index < 0 || index >= appointments.length) {
            return null;
        }

        return appointments[index].id;
    }

    /**
     * Helper: Map confirmation button IDs onto plain yes/no replies
     */
    private normalizeConfirmation(text: string): string {
        const raw = (text || "").trim();
        if (raw === BUTTON_IDS.CONFIRMATION.YES) return "yes";
        if (raw === BUTTON_IDS.CONFIRMATION.NO) return "no";
        return raw.toLowerCase();
    }

    /**
     * Helper: Format a Date as YYYY-MM-DD for storage and slot lookups
     */
    private toISODate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

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
        const message = language === "EN"
            ? "Please confirm your appointment details."
            : "कृपया अपनी नियुक्ति विवरण की पुष्टि करें।";

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.CONFIRMATION.YES, title: language === "EN" ? "Yes, Confirm" : "हाँ, पुष्टि करें" },
            { id: BUTTON_IDS.CONFIRMATION.NO, title: language === "EN" ? "No, Cancel" : "नहीं, रद्द करें" }
        ]);

    }

    private async showDateMenu(phone: string, language: string): Promise<void> {
        const message = language === "EN"
            ? "When would you like your appointment?"
            : "कृपया अपनी नियुक्ति की तारीख चुनें।";

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.DATE_SELECT.TODAY, title: language === "EN" ? "Today" : "आज" },
            { id: BUTTON_IDS.DATE_SELECT.TOMORROW, title: language === "EN" ? "Tomorrow" : "कल" },
            { id: BUTTON_IDS.DATE_SELECT.OTHER, title: language === "EN" ? "Other date" : "अन्य तारीख" }
        ]);
    }

    private async showAvailableSlots(phone: string, language: string, slots: any[], page = 0): Promise<void> {
        const times = (slots || []).map((slot: any) =>
            typeof slot === "string" ? slot : slot.start_time || slot.time
        );

        if (times.length === 0) {
            return;
        }

        // 10 rows max per list, so the last row is reserved for paging.
        const pageSize = 9;
        const start = page * pageSize;
        const pageTimes = times.slice(start, start + pageSize);
        const hasMore = times.length > start + pageSize;

        const rows = pageTimes.map((time: string) => ({
            id: `slot_${time}`,
            title: time
        }));

        if (hasMore) {
            rows.push({
                id: BUTTON_IDS.PAGINATION.MORE_SLOTS,
                title: language === "EN" ? "➡️ More times" : "➡️ और समय"
            });
        }

        const body =
            language === "EN"
                ? `Please select an available time (${times.length} available):`
                : `कृपया उपलब्ध समय चुनें (${times.length} उपलब्ध):`;

        await this.whatsappClient.sendInteractiveListMessage(
            phone,
            body,
            language === "EN" ? "Times" : "समय",
            [{ title: language === "EN" ? "Available times" : "उपलब्ध समय", rows }],
            this.supabase
        );
    }

    private async updateSession(phone: string, newState: string, data?: any): Promise<void> {
        // Omitting `data` must preserve the existing payload, not clear it.
        const patch: Record<string, unknown> = {
            state: newState,
            updated_at: new Date().toISOString()
        };

        if (data !== undefined) {
            patch.data = data;
        }

        const { error } = await this.supabase
            .from("whatsapp_sessions")
            .update(patch)
            .eq("phone", phone)
            .eq("clinic_id", this.clinicId);

        if (error) {
            debug("patientFlow", "Error updating session", { error: error.message });
        }
    }
}
