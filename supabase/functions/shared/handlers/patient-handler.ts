import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppMessage, WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidPatientMenuButton, isValidConfirmationButton, isValidDateSelectButton, isServiceButton, serviceButtonId, serviceIdFromButton, patientNameButtonId, patientNameIndex } from "../button-ids.ts";
import { knownPatientNames, MAX_REMEMBERED_NAMES } from "../patient-names.ts";
import { asLocationType, isHomeVisit, LOCATION_CLINIC, LOCATION_HOME } from "../location-type.ts";
import { checkServiceArea } from "../geo.ts";
import { getCollectorsForClinic, type Collector } from "../staff-directory.ts";
import { pickCollector } from "../collector-assignment.ts";
import { formatClockTime, formatLongDate } from "../appointment-format.ts";
import {
    getEnabledServices,
    getServiceById,
    formatPrice,
    type ClinicService,
    type ServiceChannel
} from "../clinic-services.ts";
import {
    addDays,
    getClinicClosure,
    getClinicServiceSlots,
    getClinicTimezone,
    todayInTimezone
} from "../clinic-slots.ts";
import {
    cancelAppointment,
    rescheduleAppointment
} from "../appointments.ts";
import { createAppointmentReminders, markReminderAsSkipped } from "../appointment-reminders.ts";
import { sendAppointmentCalendar } from "../appointment-calendar.ts";
import { sendProactive } from "../proactive.ts";
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
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
            supabase
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

                case "BOOK_LOCATION":
                    await this.handleBookLocation(phone, message, session);
                    break;

                case "BOOK_ADDRESS":
                    await this.handleBookAddress(phone, message, session);
                    break;

                case "BOOK_ADDRESS_DETAIL":
                    await this.handleBookAddressDetail(phone, message, session);
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

        const config = await getClinicConfig(this.supabase, session.clinic_id);
        const clinicName = config.clinic_name;

        await this.showMainMenu(
            phone,
            selectedLanguage,
            selectedLanguage === "EN"
                ? `👋 Welcome to ${clinicName}!`
                : `👋 ${clinicName} में आपका स्वागत है!`
        );
    }

    /**
     * A patient who has been here before and already has a language.
     *
     * Their greeting used to be the bare menu, so nothing in it said which
     * clinic had answered — which matters when a patient deals with more than
     * one on the same app.
     */
    async greetReturningPatient(session: WhatsAppSession, clinicName: string): Promise<void> {
        this.clinicId = session.clinic_id;

        const language = session.data?.language || "EN";
        const isEn = language === "EN";

        const welcome = isEn
            ? `👋 Welcome back to ${clinicName}!`
            : `👋 ${clinicName} में आपका फिर से स्वागत है!`;

        // Only one appointment may be active at a time, so a patient who has
        // one cannot book another: leading with "Book Appointment" offers the
        // one thing that will be refused, and buries the two that will not.
        try {
            const upcoming = await this.supabaseClient.getPatientAppointments(
                session.clinic_id,
                session.phone,
                true
            );

            const active = upcoming?.find(
                (a: any) => a.status === "CONFIRMED" || a.status === "RESCHEDULED"
            );

            if (active) {
                const whoOrWhat = active.doctor?.name
                    ? `👨‍⚕️ Dr. ${active.doctor.name}`
                    : `🩺 ${active.service_type?.name ?? (isEn ? "Appointment" : "नियुक्ति")}`;

                const body = [
                    welcome,
                    "",
                    isEn ? "You already have an appointment booked:" : "आपकी पहले से एक नियुक्ति है:",
                    "",
                    whoOrWhat,
                    `📅 ${this.formatLongDate(active.appointment_date, language)}`,
                    `🕐 ${this.formatClockTime(active.appointment_time)}`
                ].join("\n");

                await this.whatsappClient.sendInteractiveButtonMessage(
                    session.phone,
                    body,
                    [
                        {
                            id: BUTTON_IDS.PATIENT_MENU.RESCHEDULE,
                            title: isEn ? "🔄 Reschedule" : "🔄 समय बदलें"
                        },
                        {
                            id: BUTTON_IDS.PATIENT_MENU.CANCEL,
                            title: isEn ? "❌ Cancel" : "❌ रद्द करें"
                        },
                        {
                            id: BUTTON_IDS.PATIENT_MENU.MORE,
                            title: isEn ? "➕ More Options" : "➕ अन्य विकल्प"
                        }
                    ],
                    this.supabase
                );

                return;
            }
        } catch (error) {
            // A greeting is not worth failing over; fall back to the menu.
            debug("patientFlow", "Could not read appointments for the greeting", {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        await this.showMainMenu(session.phone, language, welcome);
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
            await this.handleServiceChosen(
                phone,
                language,
                clinicId,
                serviceIdFromButton(buttonId),
                false,
                session.data ?? {}
            );
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
                await this.showCancelOptions(phone, language, clinicId, session.data ?? {});
                break;

            case BUTTON_IDS.PATIENT_MENU.RESCHEDULE:
                await this.updateSession(phone, "RESCHEDULE_SELECT");
                await this.showRescheduleOptions(phone, language, clinicId, session.data ?? {});
                break;

            case BUTTON_IDS.PATIENT_MENU.HOME_COLLECTION:
                await this.startHomeCollection(phone, language, clinicId, session.data ?? {});
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

        await this.updateSession(phone, "SERVICE_SELECT", { language, servicePage: 0 });
        await this.showServiceList(phone, language, services, 0);
    }

    /**
     * Start a home visit from the menu button.
     *
     * This used to open a parallel flow of its own that wrote to
     * `home_collection_requests` - a table no portal screen reads - so a
     * patient could complete it and have nobody receive the request. It now
     * books an ordinary appointment, which the front desk can actually see.
     */
    private async startHomeCollection(
        phone: string,
        language: string,
        clinicId: string,
        data: Record<string, unknown>
    ): Promise<void> {
        const services = await getEnabledServices(this.supabase, clinicId, "home");

        if (services.length === 0) {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(
                phone,
                language,
                language === "EN"
                    ? "Sorry, we are not visiting homes at the moment."
                    : "क्षमा करें, अभी हम घर पर नहीं आ रहे हैं।"
            );
            return;
        }

        if (services.length === 1) {
            await this.beginHomeVisit(phone, language, services[0], data);
            return;
        }

        // homeOnly keeps the rest of the flow on the home channel: the patient
        // has already said where, so they must not be asked again.
        await this.updateSession(phone, "SERVICE_SELECT", {
            ...data,
            language,
            servicePage: 0,
            homeOnly: true
        });
        await this.showServiceList(phone, language, services, 0);
    }

    private async beginHomeVisit(
        phone: string,
        language: string,
        service: ClinicService,
        data: Record<string, unknown>
    ): Promise<void> {
        await this.updateSession(phone, "BOOK_ADDRESS", {
            ...data,
            language,
            serviceTypeId: service.serviceTypeId,
            serviceName: service.name,
            requiresDoctor: service.requiresDoctor,
            locationType: LOCATION_HOME
        });

        await this.askForLocation(phone, language, service.name);
    }

    /**
     * Ask for a shared pin.
     *
     * The reason a typed address is refused is only worth saying to someone
     * who has just typed one; up front it answers a question nobody asked.
     */
    private async askForLocation(
        phone: string,
        language: string,
        serviceName?: string,
        afterTyping = false
    ): Promise<void> {
        const en = language === "EN";
        const lead = serviceName ? `${serviceName}\n\n` : "";

        const why = afterTyping
            ? en
                ? "\n\nWe measure the pin against the area we travel to, so a typed address cannot be used."
                : "\n\nहम पिन से दूरी मापते हैं, इसलिए लिखा हुआ पता काम नहीं करेगा।"
            : "";

        await this.whatsappClient.sendTextMessage(
            phone,
            en
                ? `${lead}📍 Please share your location so we know where to come.\n\nTap ➕ (or 📎) → Location → Send your current location.${why}`
                : `${lead}📍 कृपया अपना स्थान साझा करें ताकि हमें पता चले कि कहाँ आना है।\n\n➕ (या 📎) → Location → Send your current location दबाएँ।${why}`
        );
    }

    private async showServiceList(
        phone: string,
        language: string,
        services: ClinicService[],
        page = 0
    ): Promise<void> {
        const isEn = language === "EN";
        const header = isEn ? "🩺 What do you need?" : "🩺 आपको क्या चाहिए?";

        const toOption = (s: ClinicService) => {
            const price = formatPrice(s.clinicPrice, language);

            return {
                id: serviceButtonId(s.serviceTypeId),
                title: s.name.slice(0, 24),
                description: price ? `${price} · ${s.durationMinutes} min` : `${s.durationMinutes} min`
            };
        };

        // Three buttons is the limit, and only worth it when everything fits.
        if (services.length <= 3) {
            await this.whatsappClient.sendInteractiveButtonMessage(
                phone,
                header,
                // Sliced as well as guarded: the client throws above three, and
                // that must not depend on the condition above staying correct.
                services.slice(0, 3).map((s) => ({
                    id: serviceButtonId(s.serviceTypeId),
                    title: s.name.slice(0, 24)
                })),
                this.supabase
            );
            return;
        }

        // 10 rows max per list, so the last row is reserved for paging.
        // Slicing alone would drop the rest without telling anyone.
        const pageSize = 9;
        const start = page * pageSize;
        const pageServices = services.slice(start, start + pageSize);
        const hasMore = services.length > start + pageSize;

        const rows = pageServices.map(toOption);

        if (hasMore) {
            rows.push({
                id: BUTTON_IDS.PAGINATION.MORE_SERVICES,
                title: isEn ? "➡️ More services" : "➡️ और सेवाएं",
                description: isEn
                    ? `${services.length - start - pageSize} more`
                    : `${services.length - start - pageSize} और`
            });
        }

        await this.whatsappClient.sendInteractiveListMessage(
            phone,
            header,
            isEn ? "Choose a service" : "सेवा चुनें",
            [{ title: isEn ? "Services" : "सेवाएं", rows }],
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
        serviceTypeId: string,
        homeOnly = false,
        data: Record<string, unknown> = {}
    ): Promise<void> {
        const channel: ServiceChannel = homeOnly ? "home" : "clinic";

        // Validated against the channel list rather than the service's own
        // flags, so a master switch the clinic has since turned off counts too.
        // Hiding a button is not authorisation.
        const available = await getEnabledServices(this.supabase, clinicId, channel);
        const service = available.find((s) => s.serviceTypeId === serviceTypeId);

        if (!service) {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(
                phone,
                language,
                language === "EN"
                    ? "Sorry, that service is not available at this clinic."
                    : "क्षमा करें, यह सेवा इस क्लिनिक में उपलब्ध नहीं है।"
            );
            return;
        }

        if (homeOnly) {
            await this.beginHomeVisit(phone, language, service, data);
            return;
        }

        const next = {
            ...data,
            language,
            serviceTypeId: service.serviceTypeId,
            serviceName: service.name,
            requiresDoctor: service.requiresDoctor
        };

        // Asking where only makes sense when the clinic will actually come:
        // the service has to be offered at home and the master switch on.
        const atHome = await getEnabledServices(this.supabase, clinicId, "home");
        const canVisit = atHome.some((s) => s.serviceTypeId === service.serviceTypeId);

        if (canVisit) {
            await this.updateSession(phone, "BOOK_LOCATION", next);
            await this.askWhere(phone, language, service.name);
            return;
        }

        if (service.requiresDoctor) {
            await this.updateSession(phone, "BOOK_DOCTOR", next);
            await this.showDoctorList(phone, language, clinicId);
            return;
        }

        await this.updateSession(phone, "BOOK_DATE", next);
        await this.showDateMenu(phone, language);
    }

    private async askWhere(phone: string, language: string, serviceName: string): Promise<void> {
        const en = language === "EN";

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            en
                ? `${serviceName}\n\nWhere would you like this?`
                : `${serviceName}\n\nआप इसे कहाँ चाहेंगे?`,
            [
                { id: BUTTON_IDS.LOCATION_TYPE.CLINIC, title: en ? "At the clinic" : "क्लिनिक में" },
                { id: BUTTON_IDS.LOCATION_TYPE.HOME, title: en ? "At my home" : "घर पर" }
            ]
        );
    }

    /**
     * BOOK_LOCATION - clinic or a visit to the patient's home
     */
    private async handleBookLocation(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        if (session.state !== "BOOK_LOCATION") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const reply = message.text.trim();

        if (reply === BUTTON_IDS.LOCATION_TYPE.HOME) {
            await this.updateSession(phone, "BOOK_ADDRESS", {
                ...session.data,
                locationType: LOCATION_HOME
            });

            await this.askForLocation(phone, language, session.data?.serviceName);
            return;
        }

        if (reply === BUTTON_IDS.LOCATION_TYPE.CLINIC) {
            const data = { ...session.data, locationType: LOCATION_CLINIC };

            if (session.data?.requiresDoctor) {
                await this.updateSession(phone, "BOOK_DOCTOR", data);
                await this.showDoctorList(phone, language, session.clinic_id);
                return;
            }

            await this.updateSession(phone, "BOOK_DATE", data);
            await this.showDateMenu(phone, language);
            return;
        }

        // Anything else is a stale tap or free text, so ask again.
        await this.askWhere(phone, language, session.data?.serviceName || "");
    }

    /**
     * BOOK_ADDRESS - where the visit should happen
     *
     * A shared pin is required. A typed address was accepted here on nothing
     * but its length, and carries no coordinates, so `checkServiceArea` never
     * ran for one: anyone could type eight characters and book a visit from
     * any distance. Refusing text is what makes the radius mean anything.
     */
    private async handleBookAddress(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        if (session.state !== "BOOK_ADDRESS") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const en = language === "EN";

        if (!message.latitude || !message.longitude) {
            const typed = Boolean((message.text || "").trim());
            await this.askForLocation(phone, language, session.data?.serviceName, typed);
            return;
        }

        const area = await checkServiceArea(
            this.supabase,
            session.clinic_id,
            message.latitude,
            message.longitude
        );

        if (!area.servable) {
            await this.whatsappClient.sendTextMessage(
                phone,
                en
                    ? `📍 Sorry, that location is outside the area we visit.\n\nIt is about ${Math.round(area.distanceKm ?? 0)} km away and we travel up to ${area.radiusKm} km.\n\nYou can share a different location, or book at the clinic instead.`
                    : `📍 क्षमा करें, वह स्थान हमारे क्षेत्र से बाहर है।\n\nयह लगभग ${Math.round(area.distanceKm ?? 0)} किमी दूर है और हम ${area.radiusKm} किमी तक जाते हैं।`
            );
            return;
        }

        await this.updateSession(phone, "BOOK_ADDRESS_DETAIL", {
            ...session.data,
            locationType: LOCATION_HOME,
            serviceLatitude: message.latitude,
            serviceLongitude: message.longitude
        });

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            en
                ? "📍 Location received.\n\nType your flat or house number and a nearby landmark so we can find the door."
                : "📍 स्थान मिल गया।\n\nअपना फ्लैट/मकान नंबर और पास का कोई लैंडमार्क लिखें।",
            [{ id: BUTTON_IDS.ACTION.SKIP, title: en ? "Skip" : "छोड़ें" }],
            this.supabase
        );
    }

    /**
     * BOOK_ADDRESS_DETAIL - flat number and landmark
     *
     * Free text is safe here: the pin has already decided servability, and
     * this only helps whoever travels find the door.
     */
    private async handleBookAddressDetail(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        if (session.state !== "BOOK_ADDRESS_DETAIL") {
            await this.showMainMenu(phone, session.data?.language || "EN");
            return;
        }

        const language = session.data?.language || "EN";
        const reply = (message.text || "").trim();

        let detail: string | null = null;

        switch (reply) {
            case BUTTON_IDS.ACTION.SKIP:
                break;

            default:
                detail = reply.length > 0 ? reply.slice(0, 200) : null;
        }

        const data = {
            ...session.data,
            serviceAddress: detail
        };

        if (session.data?.requiresDoctor) {
            await this.updateSession(phone, "BOOK_DOCTOR", data);
            await this.showDoctorList(phone, language, session.clinic_id);
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
        const homeOnly = session.data?.homeOnly === true;

        if (isServiceButton(reply)) {
            await this.handleServiceChosen(
                phone,
                language,
                session.clinic_id,
                serviceIdFromButton(reply),
                homeOnly,
                session.data ?? {}
            );
            return;
        }

        const services = await getEnabledServices(
            this.supabase,
            session.clinic_id,
            homeOnly ? "home" : "clinic"
        );

        if (reply === BUTTON_IDS.PAGINATION.MORE_SERVICES) {
            const nextPage = (session.data?.servicePage || 0) + 1;

            await this.updateSession(phone, "SERVICE_SELECT", {
                ...session.data,
                servicePage: nextPage
            });
            await this.showServiceList(phone, language, services, nextPage);
            return;
        }

        const index = Number(reply);

        if (Number.isInteger(index) && index >= 1 && index <= services.length) {
            await this.handleServiceChosen(
                phone,
                language,
                session.clinic_id,
                services[index - 1].serviceTypeId,
                homeOnly,
                session.data ?? {}
            );
            return;
        }

        await this.showServiceList(phone, language, services, session.data?.servicePage || 0);
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
            return await this.supabaseClient.getAvailableSlots(
                clinicId,
                doctorId,
                date,
                locationType,
                session.data?.serviceTypeId
            );
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
     * Tell the patient the clinic is shut, if that is why there are no slots.
     *
     * Returns true when it has answered, so the caller stops. Without this a
     * closed day falls through to "the doctor is unavailable" or a waitlist for
     * a day that will never open.
     */
    private async replyIfClinicClosed(
        phone: string,
        language: string,
        clinicId: string,
        date: string,
        followUp: "menu" | "retryDate"
    ): Promise<boolean> {
        const closure = await getClinicClosure(this.supabase, clinicId, date);

        if (!closure) {
            return false;
        }

        const reason = closure.reason === "holiday" && closure.name ? ` (${closure.name})` : "";

        await this.whatsappClient.sendTextMessage(
            phone,
            language === "EN"
                ? `The clinic is closed on ${date}${reason}. Please pick another date.`
                : `${date}${reason} को क्लिनिक बंद है। कृपया दूसरी तारीख चुनें।`,
            this.supabase
        );

        // The custom-date state only understands a typed date, so sending it the
        // date buttons would strand the patient.
        if (followUp === "menu") {
            await this.showDateMenu(phone, language);
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "📅 Please enter another date (YYYY-MM-DD):"
                    : "📅 कृपया कोई अन्य तारीख दर्ज करें (YYYY-MM-DD):",
                this.supabase
            );
        }

        return true;
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
        // Must be the same list showDoctorList offered: the position is resolved
        // against it, so filtering one and not the other books a different
        // doctor than the one tapped.
        const doctors = await this.supabaseClient.getBookableDoctors(clinicId);
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

        await this.showDateMenu(
            phone,
            language,
            language === "EN"
                ? `✅ You've selected Dr. ${doctor.name}.`
                : `✅ आपने डॉ. ${doctor.name} का चयन किया है।`
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
        const locationType = asLocationType(session.data?.locationType);
        const doctorId = session.data?.selectedDoctorId;
        const clinicId = session.clinic_id;

        // If button ID, parse date option
        if (isValidDateSelectButton(buttonId)) {
            // Today has to mean today where the patient is standing, not where
            // the server happens to run.
            const timezone = await getClinicTimezone(this.supabase, clinicId);
            const today = todayInTimezone(timezone);

            let selectedDate: string;

            if (buttonId === BUTTON_IDS.DATE_SELECT.TODAY) {
                selectedDate = today;
            } else if (buttonId === BUTTON_IDS.DATE_SELECT.TOMORROW) {
                selectedDate = addDays(today, 1);
            } else if (buttonId === BUTTON_IDS.DATE_SELECT.OTHER) {
                // Ask for custom date
                const aheadDays = await this.bookingWindowDays(
                    clinicId,
                    session.data?.serviceTypeId
                );

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to ${aheadDays} days in advance)`
                        : `📅 कृपया अपनी पसंदीदा तारीख दर्ज करें (YYYY-MM-DD):\n\n(आप ${aheadDays} दिन पहले तक बुक कर सकते हैं)`
                );
                // Carry the rest of the payload over. Rebuilding it here dropped
                // serviceTypeId, so a doctor-free service reached the custom date
                // step with no service and could never find a slot.
                await this.updateSession(phone, "BOOK_DATE_CUSTOM", {
                    ...session.data,
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
                if (await this.replyIfClinicClosed(phone, language, clinicId, selectedDate, "menu")) {
                    return;
                }

                // Check if doctor is unavailable (not AVAILABLE or IN_CONSULTATION)
                const doctorAvailable = await this.supabaseClient.isDoctorAvailable(clinicId, doctorId);
                
                if (!doctorAvailable) {
                    const doctorStatus = await this.supabaseClient.getDoctorAvailabilityStatus(clinicId, doctorId);

                    await this.whatsappClient.sendTextMessage(
                        phone,
                        this.doctorUnavailableMessage(
                            language,
                            doctorStatus,
                            session.data?.selectedDoctorName
                        )
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
            const clinicToday = todayInTimezone(await getClinicTimezone(this.supabase, clinicId));
            const aheadDays = await this.bookingWindowDays(clinicId, session.data?.serviceTypeId);
            const dateValidation = isValidBookingDate(buttonId, clinicToday, aheadDays);

            if (!dateValidation.valid) {
                const errorMsg = formatBookingDateErrorMessage(dateValidation.error || "invalid_format", language, aheadDays);
                await this.whatsappClient.sendTextMessage(phone, errorMsg);

                // Prompt to retry
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to ${aheadDays} days in advance)`
                        : `📅 कृपया अपनी पसंदीदा तारीख दर्ज करें (YYYY-MM-DD):\n\n(आप ${aheadDays} दिन पहले तक बुक कर सकते हैं)`
                );
                return;
            }

            const slots = await this.slotsForBooking(session, clinicId, buttonId, locationType);
            if (!slots || slots.length === 0) {
                if (await this.replyIfClinicClosed(phone, language, clinicId, buttonId, "menu")) {
                    return;
                }

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
     * How far ahead this booking may go.
     *
     * `clinic_services.max_booking_window_days` existed from the first
     * multi-clinic migration and was read by nothing; a week was hardcoded in
     * four places instead. A service with nothing set keeps that week.
     */
    private async bookingWindowDays(clinicId: string, serviceTypeId?: string): Promise<number> {
        if (!serviceTypeId) {
            return 7;
        }

        const service = await getServiceById(this.supabase, clinicId, serviceTypeId);

        return service && service.maxAheadDays > 0 ? service.maxAheadDays : 7;
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
        const locationType = asLocationType(session.data?.locationType);
        const clinicId = session.clinic_id;

        // Validate date format and range
        const clinicToday = todayInTimezone(await getClinicTimezone(this.supabase, clinicId));
        const aheadDays = await this.bookingWindowDays(clinicId, session.data?.serviceTypeId);
        const dateValidation = isValidBookingDate(dateString, clinicToday, aheadDays);

        if (!dateValidation.valid) {
            const errorMsg = formatBookingDateErrorMessage(dateValidation.error || "invalid_format", language, aheadDays);
            await this.whatsappClient.sendTextMessage(phone, errorMsg);

            // Prompt to retry
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? `📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can book up to ${aheadDays} days in advance)`
                    : `📅 कृपया अपनी पसंदीदा तारीख दर्ज करें (YYYY-MM-DD):\n\n(आप ${aheadDays} दिन पहले तक बुक कर सकते हैं)`
            );
            return;
        }

        // Check availability
        const slots = await this.slotsForBooking(session, clinicId, dateString, locationType);
        if (!slots || slots.length === 0) {
            if (await this.replyIfClinicClosed(phone, language, clinicId, dateString, "retryDate")) {
                return;
            }

            // Check if doctor is unavailable (not AVAILABLE or IN_CONSULTATION)
            const doctorAvailable = await this.supabaseClient.isDoctorAvailable(clinicId, doctorId);
            
            if (!doctorAvailable) {
                const doctorStatus = await this.supabaseClient.getDoctorAvailabilityStatus(clinicId, doctorId);

                await this.whatsappClient.sendTextMessage(
                    phone,
                    this.doctorUnavailableMessage(
                        language,
                        doctorStatus,
                        session.data?.selectedDoctorName
                    )
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
        const locationType = asLocationType(session.data?.locationType);

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

        // Move to name confirmation. The household is read before the write so
        // the whole payload is stored once, rather than a second update having
        // to reconstruct what the first one held.
        const known = await knownPatientNames(this.supabase, session.clinic_id, phone);

        await this.updateSession(phone, "BOOK_NAME", {
            ...session.data,
            language,
            selectedDoctorId: doctorId,
            selectedDoctorName: session.data?.selectedDoctorName,
            selectedDate,
            selectedTime,
            locationType,
            // The reply is only a position, so the list it indexes into has to
            // be the one this number was actually offered.
            offeredNames: known
        });

        await this.askWhoFor(phone, language, known, `✅ ${selectedTime}`);
    }

    /**
     * Ask who the booking is for.
     *
     * One number books for a household. The names it has used before are
     * offered back so the whole thing does not have to be typed again on a
     * phone, in a second language, every single time.
     */
    private async askWhoFor(
        phone: string,
        language: string,
        known: string[],
        prefix: string
    ): Promise<void> {
        if (known.length === 0) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? `${prefix}\n\n📝 Please provide your full name:`
                    : `${prefix}\n\n📝 कृपया अपना पूरा नाम प्रदान करें:`
            );
            return;
        }

        const body = language === "EN"
            ? `${prefix}\n\n📝 Who is this appointment for?`
            : `${prefix}\n\n📝 यह अपॉइंटमेंट किसके लिए है?`;

        const otherLabel = language === "EN" ? "Someone else" : "कोई और";

        const rows = [
            ...known.slice(0, MAX_REMEMBERED_NAMES).map((name, index) => ({
                id: patientNameButtonId(index),
                title: name.slice(0, 24)
            })),
            { id: BUTTON_IDS.PATIENT_NAME.SOMEONE_ELSE, title: otherLabel }
        ];

        if (rows.length <= 3) {
            await this.whatsappClient.sendInteractiveButtonMessage(phone, body, rows);
            return;
        }

        await this.whatsappClient.sendInteractiveListMessage(
            phone,
            body,
            language === "EN" ? "Choose" : "चुनें",
            [{ title: language === "EN" ? "Patient" : "मरीज़", rows }]
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
        const reply = message.text.trim();

        if (reply === BUTTON_IDS.PATIENT_NAME.SOMEONE_ELSE) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "📝 Please type the patient's full name:"
                    : "📝 कृपया मरीज़ का पूरा नाम लिखें:"
            );
            return;
        }

        const offered: string[] = Array.isArray(session.data?.offeredNames)
            ? session.data.offeredNames
            : [];

        const chosen = patientNameIndex(reply);

        // A position that was never offered is a crafted reply, not a choice.
        if (chosen !== null && !offered[chosen]) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "Please choose from the list, or type the name."
                    : "कृपया सूची में से चुनें, या नाम लिखें।"
            );
            return;
        }

        const patientName = chosen !== null ? offered[chosen] : reply;

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

        await this.showBookingConfirmation(
            phone,
            { ...session.data, patientName },
            language
        );
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
            // Carried to the end so the outcome and the menu are one message.
            let closing: string | undefined;

            try {
                // One active appointment per patient: block a second concurrent booking.
                const upcoming = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);
                const active = upcoming?.find(
                    (a: any) => a.status === "CONFIRMED" || a.status === "RESCHEDULED"
                );

                if (active) {
                    await this.updateSession(phone, "MAIN_MENU", { language });

                    // Points at the button rather than teaching a typed
                    // command: cancelling lives behind "More Options", and the
                    // menu below opens by offering to book again. A real
                    // patient hit this wall and abandoned the booking.
                    const when = `${this.formatLongDate(active.appointment_date, language)} at ${this.formatClockTime(active.appointment_time)}`;

                    await this.showMainMenu(
                        phone,
                        language,
                        language === "EN"
                            ? `You already have an appointment on ${when}. To change or cancel it, tap ➕ More Options.`
                            : `आपकी पहले से ${when} पर एक नियुक्ति है। उसे बदलने या रद्द करने के लिए ➕ अन्य विकल्प चुनें।`
                    );
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
                    location_type: asLocationType(session.data?.locationType),
                    service_address: session.data?.serviceAddress ?? undefined,
                    service_latitude: session.data?.serviceLatitude ?? undefined,
                    service_longitude: session.data?.serviceLongitude ?? undefined,
                    preferred_language: language  // Store patient's language preference for reminders
                });

                const appointmentId = appointment.id;

                // Assigned after the insert rather than as part of it, so a
                // rota problem can never cost the patient their booking.
                let assignedCollector: Collector | null = null;

                if (isHomeVisit(session.data?.locationType)) {
                    assignedCollector = await this.assignCollector(
                        appointmentId,
                        clinicId,
                        session.data?.selectedDate
                    );
                }

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

                const config = await getClinicConfig(this.supabase, clinicId);
                const isEn = language === "EN";

                // Saying so on the confirmation saves an argument at the desk.
                const revisitLine = appointment.is_revisit
                    ? isEn
                        ? "\n🔁 Recorded as a follow-up visit."
                        : "\n🔁 यह फ़ॉलो-अप विज़िट के रूप में दर्ज है।"
                    : "";

                // A bare "Token: 1" means nothing to someone who has not been
                // here before, so it says what to do with it.
                const tokenLine = appointment.token_number
                    ? isEn
                        ? `\n🎟️ Token ${appointment.token_number} — show this at reception`
                        : `\n🎟️ टोकन ${appointment.token_number} — रिसेप्शन पर दिखाएँ`
                    : "";

                // Where to go, rather than which kind of visit it is.
                const clinicAddress = [config.address, config.city].filter(Boolean).join(", ");
                const where = isHomeVisit(session.data?.locationType)
                    ? (isEn ? "At your home" : "आपके घर पर") +
                      (session.data?.serviceAddress ? ` — ${session.data.serviceAddress}` : "")
                    : clinicAddress || (isEn ? "At the clinic" : "क्लिनिक में");

                // Part of the detail block, not a prompt: a patient who needs
                // the clinic should not have to go looking for the number.
                const callUs = config.clinic_phone ? `\n📞 +${config.clinic_phone}` : "";

                // A service with no doctor has no name to print, and printing
                // one anyway produced "Dr. undefined" on a real confirmation.
                const doctorName = session.data?.selectedDoctorName;
                const whoOrWhat = doctorName
                    ? `👨‍⚕️ Dr. ${doctorName}`
                    : `🩺 ${session.data?.serviceName ?? (isEn ? "Appointment" : "नियुक्ति")}`;

                // The outcome closes the receipt rather than opening it, so the
                // clinic and the details sit where a patient re-reading them
                // will look first.
                const confirmation =
                    [
                        config.clinic_name,
                        "",
                        whoOrWhat,
                        `📅 ${this.formatLongDate(session.data?.selectedDate, language)}`,
                        `🕐 ${this.formatClockTime(session.data?.selectedTime)}`,
                        `📍 ${where}`
                    ].join("\n") +
                    tokenLine +
                    revisitLine +
                    callUs +
                    (isEn ? "\n\n✅ Appointment confirmed" : "\n\n✅ नियुक्ति की पुष्टि हो गई");

                // No buttons: this is a receipt, not a question. Asking "what
                // would you like to do?" of someone who has just finished is
                // noise, and "Book Appointment" right after booking is absurd.
                await this.whatsappClient.sendTextMessage(phone, confirmation, this.supabase);

                // Best effort, both of them: the booking is already made, so
                // neither a calendar file nor the doctor's copy may undo it.
                await sendAppointmentCalendar(this.supabase, this.whatsappClient, clinicId, phone, {
                    appointmentId,
                    clinicName: config.clinic_name,
                    doctorName: session.data?.selectedDoctorName,
                    date: session.data?.selectedDate,
                    time: session.data?.selectedTime,
                    timezone: config.timezone,
                    location: where,
                    token: appointment.token_number,
                    language
                });

                await this.notifyDoctorNewBooking(
                    session.data?.selectedDoctorId,
                    clinicId,
                    session.data
                );

                if (isHomeVisit(session.data?.locationType)) {
                    await this.notifyCollectorsOfHomeVisit(
                        clinicId,
                        session.data,
                        assignedCollector
                    );
                }

                return;
            } catch (error) {
                // Someone claimed the slot between selection and insert.
                if (error instanceof Error && error.message === "SLOT_TAKEN") {
                    await this.updateSession(phone, "MAIN_MENU", { language });
                    await this.showMainMenu(
                        phone,
                        language,
                        "That time was just booked by someone else. Please choose another slot."
                    );
                    return;
                }

                closing = language === "EN"
                    ? `❌ Booking failed: ${error instanceof Error ? error.message : "Unknown error"}`
                    : `❌ बुकिंग विफल: ${error instanceof Error ? error.message : "अज्ञात त्रुटि"}`;

                await this.updateSession(phone, "MAIN_MENU", { language });
            }

            await this.showMainMenu(phone, language, closing);
        } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(
                phone,
                language,
                language === "EN" ? "❌ Booking cancelled." : "❌ बुकिंग रद्द की गई।"
            );
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

        // Offered on the list itself. Without this it fell to the default below
        // and answered Main Menu with the same list again.
        if (
            buttonId === BUTTON_IDS.NAVIGATION.MAIN_MENU ||
            buttonId === BUTTON_IDS.PATIENT_MENU.MAIN_MENU
        ) {
            await this.showMainMenu(phone, language);
            return;
        }

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
        // The list is numbered, so "2" must be mapped back to its appointment.
        const chosen = await this.resolveAppointment(phone, clinicId, message.text);

        if (!chosen) {
            await this.showCancelOptions(phone, language, clinicId, session.data ?? {});
            return;
        }

        await this.confirmChosenAppointment(phone, language, chosen, "cancel", session.data ?? {});
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
        let closing: string | undefined;

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
            const appointmentId = session.data?.selectedAppointmentId;
            const clinicId = session.clinic_id;

            const result = await cancelAppointment(
                this.supabase,
                appointmentId,
                clinicId,
                "Patient initiated cancellation",
                "patient",
                this.whatsappClient
            );

            if (result.success) {
                closing = language === "EN"
                    ? "✅ Appointment cancelled successfully."
                    : "✅ नियुक्ति सफलतापूर्वक रद्द की गई।";
            } else {
                closing = language === "EN"
                    ? `❌ Cancellation failed: ${result.message}`
                    : `❌ रद्दीकरण विफल: ${result.message}`;
            }

            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language, closing);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "नहीं") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(
                phone,
                language,
                language === "EN" ? "Cancellation aborted." : "रद्दीकरण रद्द किया गया।"
            );
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
        // The list is numbered, so "2" must be mapped back to its appointment.
        const chosen = await this.resolveAppointment(phone, clinicId, message.text);

        if (!chosen) {
            await this.showRescheduleOptions(phone, language, clinicId, session.data ?? {});
            return;
        }

        await this.confirmChosenAppointment(phone, language, chosen, "reschedule", session.data ?? {});
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
        let newDate = message.text.trim();

        // The picker offers Today/Tomorrow rather than asking for YYYY-MM-DD,
        // so those ids have to resolve to a date before anything parses it.
        if (isValidDateSelectButton(newDate)) {
            const timezone = await getClinicTimezone(this.supabase, session.clinic_id);
            const today = todayInTimezone(timezone);

            if (newDate === BUTTON_IDS.DATE_SELECT.TODAY) {
                newDate = today;
            } else if (newDate === BUTTON_IDS.DATE_SELECT.TOMORROW) {
                newDate = addDays(today, 1);
            } else {
                const aheadDays = await this.bookingWindowDays(
                    session.clinic_id,
                    session.data?.serviceTypeId
                );

                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? `📅 Please enter the new date (YYYY-MM-DD):\n\n(Up to ${aheadDays} days ahead)`
                        : `📅 कृपया नई तारीख दर्ज करें (YYYY-MM-DD):\n\n(${aheadDays} दिन आगे तक)`
                );
                return;
            }
        }

        // Reschedule must honour the same window as a new booking.
        const rescheduleToday = todayInTimezone(
            await getClinicTimezone(this.supabase, session.clinic_id)
        );
        const rescheduleAhead = await this.bookingWindowDays(
            session.clinic_id,
            session.data?.serviceTypeId
        );
        const rescheduleWindow = isValidBookingDate(newDate, rescheduleToday, rescheduleAhead);
        if (!rescheduleWindow.valid) {
            await this.whatsappClient.sendTextMessage(
                phone,
                formatBookingDateErrorMessage(
                    rescheduleWindow.error || "invalid_format",
                    language,
                    rescheduleAhead
                )
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
            .select("doctor_id, service_type_id")
            .eq("id", session.data?.selectedAppointmentId)
            .maybeSingle();

        const slots = appointment
            ? await this.supabaseClient.getAvailableSlots(
                  session.clinic_id,
                  appointment.doctor_id,
                  newDate,
                  "clinic",
                  appointment.service_type_id ?? undefined
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
            ...session.data,
            language,
            selectedAppointmentId: session.data?.selectedAppointmentId,
            rescheduleDoctorId: appointment?.doctor_id,
            rescheduleServiceTypeId: appointment?.service_type_id ?? undefined,
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
                "clinic",
                session.data?.rescheduleServiceTypeId
            );

            await this.updateSession(phone, "RESCHEDULE_TIME", { ...session.data, slotPage: nextPage });
            await this.showAvailableSlots(phone, language, allSlots, nextPage, "RESCHEDULE_DATE");
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
            "clinic",
            session.data?.rescheduleServiceTypeId
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
            ...session.data,
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
        let closing: string | undefined;

        if (confirmation === "yes" || confirmation === "y" || confirmation === "हाँ") {
            const result = await rescheduleAppointment(
                this.supabase,
                session.data?.selectedAppointmentId,
                session.clinic_id,
                session.data?.newDate,
                session.data?.newTime
            );

            if (result.success) {
                closing = language === "EN"
                    ? `✅ Appointment rescheduled to ${session.data?.newDate} at ${session.data?.newTime}`
                    : `✅ नियुक्ति को ${session.data?.newDate} को ${session.data?.newTime} पर पुनः समय निर्धारित किया गया`;
            } else {
                closing = language === "EN"
                    ? `❌ Rescheduling failed: ${result.message}`
                    : `❌ पुनः समय निर्धारण विफल: ${result.message}`;
            }

            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(phone, language, closing);
        } else if (confirmation === "no" || confirmation === "n" || confirmation === "नहीं") {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(
                phone,
                language,
                language === "EN" ? "Rescheduling aborted." : "पुनः समय निर्धारण रद्द किया गया।"
            );
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

    /**
     * The one message a patient sees at the top of the flow.
     *
     * `intro` is folded into the same bubble rather than sent before it: a
     * welcome and then a separate "what would you like to do?" asked the same
     * question twice, a second apart, and the first had no buttons on it.
     */
    private async showMainMenu(phone: string, language: string, intro?: string): Promise<void> {
        const prompt =
            language === "EN" ? "What would you like to do?" : "आप क्या करना चाहते हैं?";

        const message = intro ? `${intro}\n\n${prompt}` : `📋 ${prompt}`;

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
            const doctors = await this.supabaseClient.getBookableDoctors(clinicId);

            if (!doctors || doctors.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "❌ No doctors are taking appointments at the moment. Please call the clinic or come in."
                        : "❌ इस समय कोई डॉक्टर अपॉइंटमेंट नहीं ले रहे हैं। कृपया क्लिनिक पर कॉल करें या सीधे आएं।",
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

            // Everyone on this list is bookable, so the status that used to be
            // printed on each row would read "Available" every time. What a
            // patient is actually choosing between is the qualification.
            //
            // The status also used to guarantee the description was never
            // empty. It no longer does, so a doctor with neither a
            // specialisation nor a qualification omits the field rather than
            // sending WhatsApp an empty string.
            const rows = pageDoctors.map((doc: any) => {
                const detail = [doc.specialization, doc.qualifications]
                    .filter((part: unknown) => typeof part === "string" && part.trim() !== "")
                    .join(" · ");

                return {
                    id: `doctor_${doc.id}`,
                    title: this.truncate(`Dr. ${doc.name}`, 24),
                    ...(detail ? { description: this.truncate(detail, 72) } : {})
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

            const bookedFor = String(data?.patientName || "A patient");
            // The doctor's own language is not held anywhere, so English.
            const bookedOn = formatLongDate(String(data?.selectedDate ?? ""), "EN");
            const bookedAt = formatClockTime(String(data?.selectedTime ?? ""));

            await sendProactive(
                this.whatsappClient,
                doctor.phone,
                `📅 New booking for ${bookedFor} on ${bookedOn} at ${bookedAt} has been received.`,
                {
                    key: "staff_new_booking",
                    parameters: [bookedFor, bookedOn, bookedAt]
                }
            );
        } catch (error) {
            debug("patientFlow", "Could not notify doctor of new booking", {
                doctorId,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Put the visit on a collector's round.
     *
     * Never throws: the booking is already committed, and an unassigned visit
     * is still visible to every collector as unclaimed work.
     */
    private async assignCollector(
        appointmentId: string,
        clinicId: string,
        date: string | undefined
    ): Promise<Collector | null> {
        try {
            const collector = await pickCollector(this.supabase, clinicId, String(date ?? ""));

            if (!collector) {
                debug("patientFlow", "No collector free for this home visit", { appointmentId });
                return null;
            }

            const { error } = await this.supabase
                .from("appointments")
                .update({ collector_id: collector.id })
                .eq("id", appointmentId)
                .eq("clinic_id", clinicId);

            if (error) {
                debug("patientFlow", "Could not assign a collector", {
                    appointmentId,
                    error: error.message
                });
                return null;
            }

            return collector;
        } catch (error) {
            debug("patientFlow", "Collector assignment failed", {
                appointmentId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Tell the collectors a home visit has been booked.
     *
     * Nothing told them at all: the old flow dispatched from a table the
     * patient path no longer writes, so a home collection was booked and no
     * collector ever heard. Best effort, like the doctor's copy.
     */
    private async notifyCollectorsOfHomeVisit(
        clinicId: string,
        data: Record<string, any> | undefined,
        assigned: Collector | null
    ): Promise<void> {
        try {
            // Only the collector who has it, unless nobody could take it - then
            // everyone, so an unclaimed visit is not silently nobody's.
            const tell = assigned
                ? [assigned]
                : await getCollectorsForClinic(this.supabase, clinicId);

            if (tell.length === 0) {
                debug("patientFlow", "Home visit booked with no collector to tell", { clinicId });
                return;
            }

            const bookedFor = String(data?.patientName || "A patient");
            const bookedOn = formatLongDate(String(data?.selectedDate ?? ""), "EN");
            const bookedAt = formatClockTime(String(data?.selectedTime ?? ""));

            const lead = assigned ? "🏠 New home visit" : "🏠 Unassigned home visit";

            for (const collector of tell) {
                await sendProactive(
                    this.whatsappClient,
                    collector.phone,
                    `${lead} for ${bookedFor} on ${bookedOn} at ${bookedAt} has been received.`,
                    {
                        key: "staff_new_booking",
                        parameters: [bookedFor, bookedOn, bookedAt]
                    }
                );
            }
        } catch (error) {
            debug("patientFlow", "Could not notify collectors", {
                clinicId,
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

                // The query embeds the doctor, so the name is nested. The
                // patient's name is shown too: one number books for a
                // household, and an unlabelled list is unreadable.
                appointments.forEach((apt: any, idx: number) => {
                    const who = apt.patient_name ? `   👤 ${apt.patient_name}\n` : "";
                    // Same words and format as the greeting and the receipt: a
                    // raw "13:00" and "Status: CONFIRMED" beside them read as a
                    // different booking.
                    const state = apt.status === "RESCHEDULED" ? "🔁 Moved" : "✅ Booked";

                    message += `${idx + 1}. 🩺 Dr. ${apt.doctor?.name || "Unknown"}\n${who}   📅 ${this.formatLongDate(apt.appointment_date, language)}\n   🕐 ${this.formatClockTime(apt.appointment_time)}\n   ${state}\n\n`;
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
     * Helper: Map a position from the numbered list onto the appointment
     */
    private async resolveAppointment(
        phone: string,
        clinicId: string,
        input: string
    ): Promise<any | null> {
        const raw = (input || "").trim();

        let appointments: any[] = [];

        try {
            appointments = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);
        } catch (error) {
            debug("patientFlow", "Could not load appointments to resolve a choice", {
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }

        if (/^\d+$/.test(raw)) {
            const index = parseInt(raw, 10) - 1;
            return appointments[index] ?? null;
        }

        // Scoped to this patient's own list, so a guessed id belonging to
        // someone else resolves to nothing.
        return appointments.find((apt: any) => apt.id === raw) ?? null;
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
     * "Friday, 18 September" — the weekday is what a patient checks against.
     */
    private formatLongDate(dateString: string, language: string): string {
        return formatLongDate(dateString, language);
    }

    /** 24 hour times are what the database holds; "11:30 am" is what people read. */
    private formatClockTime(time: string): string {
        return formatClockTime(time);
    }

    /**
     * Helper: Show cancel options
     */
    private async showCancelOptions(
        phone: string,
        language: string,
        clinicId: string,
        data: Record<string, unknown> = {}
    ): Promise<void> {
        await this.showAppointmentPicker(phone, language, clinicId, "cancel", data);
    }

    /**
     * Helper: Show reschedule options
     */
    private async showRescheduleOptions(
        phone: string,
        language: string,
        clinicId: string,
        data: Record<string, unknown> = {}
    ): Promise<void> {
        await this.showAppointmentPicker(phone, language, clinicId, "reschedule", data);
    }

    /**
     * Ask which appointment, showing them rather than asking for an id.
     *
     * Both of these used to send "Please provide the appointment ID", an
     * internal `APT_...` string deliberately never shown to the patient. The
     * step below already accepted a position from a numbered list; the list
     * was simply never printed.
     */
    private async showAppointmentPicker(
        phone: string,
        language: string,
        clinicId: string,
        purpose: "cancel" | "reschedule",
        data: Record<string, unknown>
    ): Promise<void> {
        const en = language === "EN";
        let appointments: any[] = [];

        try {
            appointments = await this.supabaseClient.getPatientAppointments(clinicId, phone, true);
        } catch (error) {
            debug("patientFlow", "Could not load appointments to pick from", {
                error: error instanceof Error ? error.message : String(error)
            });
        }

        if (appointments.length === 0) {
            await this.updateSession(phone, "MAIN_MENU", { language });
            await this.showMainMenu(
                phone,
                language,
                en
                    ? "You have no upcoming appointments."
                    : "आपकी कोई आगामी नियुक्ति नहीं है।"
            );
            return;
        }

        const describe = (apt: any) =>
            apt.doctor?.name
                ? `Dr. ${apt.doctor.name}`
                : apt.service_type?.name || (en ? "Appointment" : "नियुक्ति");

        const when = (apt: any) =>
            `${this.formatLongDate(apt.appointment_date, language)}, ${this.formatClockTime(apt.appointment_time)}`;

        // Only one appointment may be active at a time, so a list of one is the
        // normal case and picking from it is a step for nothing.
        if (appointments.length === 1) {
            const only = appointments[0];
            await this.confirmChosenAppointment(phone, language, only, purpose, data);
            return;
        }

        const rows = appointments.slice(0, 9).map((apt: any, idx: number) => ({
            // The position is what the next step resolves back to an id.
            id: String(idx + 1),
            title: when(apt).slice(0, 24),
            description: [describe(apt), apt.patient_name].filter(Boolean).join(" · ")
        }));

        await this.whatsappClient.sendInteractiveListMessage(
            phone,
            purpose === "cancel"
                ? (en ? "Which appointment would you like to cancel?" : "आप कौन सी नियुक्ति रद्द करना चाहते हैं?")
                : (en ? "Which appointment would you like to move?" : "आप कौन सी नियुक्ति बदलना चाहते हैं?"),
            en ? "Choose one" : "एक चुनें",
            [{ title: en ? "Your appointments" : "आपकी नियुक्तियाँ", rows }],
            this.supabase
        );
    }

    /** The one appointment they must have meant. */
    private async confirmChosenAppointment(
        phone: string,
        language: string,
        appointment: any,
        purpose: "cancel" | "reschedule",
        data: Record<string, unknown>
    ): Promise<void> {
        const en = language === "EN";
        const who = appointment.doctor?.name
            ? `Dr. ${appointment.doctor.name}`
            : appointment.service_type?.name || (en ? "Appointment" : "नियुक्ति");

        const detail =
            `${who}\n📅 ${this.formatLongDate(appointment.appointment_date, language)}` +
            `\n🕐 ${this.formatClockTime(appointment.appointment_time)}`;

        if (purpose === "reschedule") {
            await this.updateSession(phone, "RESCHEDULE_DATE", {
                ...data,
                language,
                selectedAppointmentId: appointment.id
            });

            await this.showDateMenu(
                phone,
                language,
                en ? `Moving your appointment:\n\n${detail}` : `नियुक्ति बदल रहे हैं:\n\n${detail}`
            );
            return;
        }

        await this.updateSession(phone, "CANCEL_CONFIRM", {
            language,
            selectedAppointmentId: appointment.id
        });

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            en
                ? `Cancel this appointment?\n\n${detail}`
                : `क्या यह नियुक्ति रद्द करें?\n\n${detail}`,
            [
                { id: BUTTON_IDS.CONFIRMATION.YES, title: en ? "Yes, cancel" : "हाँ, रद्द करें" },
                { id: BUTTON_IDS.CONFIRMATION.NO, title: en ? "No, keep it" : "नहीं, रहने दें" }
            ],
            this.supabase
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
        // This used to ask the patient to confirm details it never showed
        // them. Tolerable while they had just typed every one of them; not
        // once the name is picked from a list of the household.
        const en = language === "EN";
        const lines: string[] = [en ? "Please check these details:" : "कृपया ये विवरण जाँचें:", ""];

        if (data?.patientName) {
            lines.push(`${en ? "👤 Patient" : "👤 मरीज़"}: ${data.patientName}`);
        }

        if (data?.serviceName) {
            lines.push(`${en ? "🩺 For" : "🩺 सेवा"}: ${data.serviceName}`);
        }

        if (data?.selectedDoctorName) {
            lines.push(`${en ? "👨‍⚕️ Doctor" : "👨‍⚕️ डॉक्टर"}: ${data.selectedDoctorName}`);
        }

        if (data?.selectedDate) {
            lines.push(`${en ? "📅 Date" : "📅 तारीख"}: ${data.selectedDate}`);
        }

        if (data?.selectedTime) {
            lines.push(`${en ? "🕐 Time" : "🕐 समय"}: ${data.selectedTime}`);
        }

        await this.whatsappClient.sendInteractiveButtonMessage(phone, lines.join("\n"), [
            { id: BUTTON_IDS.CONFIRMATION.YES, title: language === "EN" ? "Yes, Confirm" : "हाँ, पुष्टि करें" },
            { id: BUTTON_IDS.CONFIRMATION.NO, title: language === "EN" ? "No, Cancel" : "नहीं, रद्द करें" }
        ]);

    }

    /**
     * Why a doctor has no times, said with their name in it.
     *
     * The wording was a fixed string beginning "Dr. is", so it reached real
     * patients as a sentence with a hole in it. Same failure as "Dr. undefined"
     * on the confirmation: if there is no name to print, do not print the
     * title either.
     */
    private doctorUnavailableMessage(
        language: string,
        status: string | null | undefined,
        doctorName?: string | null
    ): string {
        const en = language === "EN";
        const who = doctorName ? (en ? `Dr. ${doctorName}` : `डॉ. ${doctorName}`) : "";

        const subject = who || (en ? "That doctor" : "वह डॉक्टर");

        const reason =
            status === "ON_BREAK"
                ? en ? `${subject} is on a break` : `${subject} ब्रेक पर हैं`
                : status === "BUSY"
                    ? en ? `${subject} is busy` : `${subject} व्यस्त हैं`
                    : en ? `${subject} is not available` : `${subject} उपलब्ध नहीं हैं`;

        return en
            ? `❌ ${reason}. Please try another doctor or date.`
            : `❌ ${reason}। कृपया किसी अन्य डॉक्टर या तारीख को आजमाएं।`;
    }

    /**
     * The days that can actually be booked, as a list.
     *
     * This used to be three buttons — Today, Tomorrow, Other date — and "Other
     * date" asked the patient to type YYYY-MM-DD. Typing a date format is the
     * hardest thing the flow ever asked anyone to do: it rejects 22-09-2026,
     * 22/09, and "next Monday", and a patient who wanted the day after
     * tomorrow had to work out its date. The whole window is at most a week,
     * which fits in one list, so there is nothing to type.
     *
     * The row id is the date itself, which handleBookDate already accepts as a
     * typed reply, so the two paths stay one path.
     */
    private async showDateMenu(phone: string, language: string, intro?: string): Promise<void> {
        const en = language === "EN";
        const question = en
            ? "When would you like your appointment?"
            : "कृपया अपनी नियुक्ति की तारीख चुनें।";

        const message = intro ? `${intro}\n\n${question}` : question;

        const timezone = await getClinicTimezone(this.supabase, this.clinicId);
        const today = todayInTimezone(timezone);
        const aheadDays = await this.bookingWindowDays(this.clinicId);

        // Ten rows is Meta's limit, and one is kept back for typing a date
        // beyond the list when a service allows booking further out.
        const listed = Math.min(aheadDays + 1, 9);

        const rows: Array<{ id: string; title: string; description?: string }> = [];

        for (let i = 0; i < listed; i++) {
            const date = addDays(today, i);
            const when = new Date(`${date}T00:00:00`);

            const weekday = new Intl.DateTimeFormat(en ? "en-GB" : "hi-IN", {
                weekday: "short",
                day: "numeric",
                month: "short"
            }).format(when);

            const title = i === 0
                ? (en ? `Today · ${weekday}` : `आज · ${weekday}`)
                : i === 1
                    ? (en ? `Tomorrow · ${weekday}` : `कल · ${weekday}`)
                    : weekday;

            rows.push({ id: date, title: title.slice(0, 24) });
        }

        if (aheadDays + 1 > listed) {
            rows.push({
                id: BUTTON_IDS.DATE_SELECT.OTHER,
                title: en ? "Another date" : "अन्य तारीख",
                description: en ? `Up to ${aheadDays} days ahead` : `${aheadDays} दिन तक`
            });
        }

        try {
            await this.whatsappClient.sendInteractiveListMessage(
                phone,
                message,
                en ? "Pick a day" : "दिन चुनें",
                [{ title: en ? "Available days" : "उपलब्ध दिन", rows }],
                this.supabase
            );
        } catch (error) {
            debug("patientFlow", "Date list failed, falling back to buttons", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
                { id: BUTTON_IDS.DATE_SELECT.TODAY, title: en ? "Today" : "आज" },
                { id: BUTTON_IDS.DATE_SELECT.TOMORROW, title: en ? "Tomorrow" : "कल" },
                { id: BUTTON_IDS.DATE_SELECT.OTHER, title: en ? "Other date" : "अन्य तारीख" }
            ]);
        }
    }

    private async showAvailableSlots(
        phone: string,
        language: string,
        slots: any[],
        page = 0,
        emptyReturnsTo = "BOOK_DATE"
    ): Promise<void> {
        const times = (slots || []).map((slot: any) =>
            typeof slot === "string" ? slot : slot.start_time || slot.time
        );

        // Returning here sent nothing at all, so tapping "More times" after the
        // last free slot had gone left the patient with no reply and no way on.
        // Callers that ask for a fresh day check for this first and offer the
        // waitlist; only paging reaches it.
        if (times.length === 0) {
            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ No times are left for that day. Please choose another date (YYYY-MM-DD):"
                    : "❌ उस दिन कोई समय शेष नहीं है। कृपया दूसरी तारीख चुनें (YYYY-MM-DD):",
                this.supabase
            );
            await this.updateSession(phone, emptyReturnsTo, undefined);
            return;
        }

        // 10 rows max per list, so the last row is reserved for paging.
        const pageSize = 9;
        // A stale page from an older list would slice past the end and build a
        // list with no rows, which Meta refuses.
        const lastPage = Math.floor((times.length - 1) / pageSize);
        const safePage = Math.min(Math.max(page, 0), lastPage);
        const start = safePage * pageSize;
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
