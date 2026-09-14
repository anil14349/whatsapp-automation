import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidDoctorMenuButton, isValidConfirmationButton } from "../button-ids.ts";
import { debug } from "../logger.ts";
import {
    verifyDoctorPin,
    isAccountLocked,
    getRemainingAttempts,
    formatAuthErrorMessage,
    getPinEntryPrompt
} from "../doctor-auth.ts";

/**
 * Doctor Flow Handler - Manages doctor portal interactions
 * Handles: authentication, availability management, appointment viewing, leave management
 */

export class DoctorFlowHandler {
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
            const state = session.state || "DOCTOR_LOGIN";
            const phone = session.phone;

            debug("doctorFlow", `Processing state: ${state}`, { phone, messageText: message.text });

            // Menu buttons must work from any sub-state, otherwise a doctor who
            // opens a sub-flow can never log out or switch task.
            if (
                state !== "DOCTOR_LOGIN" &&
                session.data?.authenticated &&
                isValidDoctorMenuButton(message.text?.trim() || "")
            ) {
                // Leave the sub-flow first so later input is not captured by it.
                await this.updateSession(phone, "DOCTOR_MENU", session.data);
                await this.handleMenu(phone, message, { ...session, state: "DOCTOR_MENU" });
                return;
            }

            switch (state) {
                case "DOCTOR_LOGIN":
                    await this.handleLogin(phone, message, session);
                    break;

                case "DOCTOR_MENU":
                    await this.handleMenu(phone, message, session);
                    break;

                case "DOCTOR_AVAILABILITY":
                    await this.handleAvailability(phone, message, session);
                    break;

                case "DOCTOR_AVAILABILITY_CONFIRM":
                    await this.handleAvailabilityConfirm(phone, message, session);
                    break;

                case "DOCTOR_LEAVE":
                    await this.handleLeave(phone, message, session);
                    break;

                case "DOCTOR_LEAVE_CONFIRM":
                    await this.handleLeaveConfirm(phone, message, session);
                    break;

                case "DOCTOR_APPOINTMENTS":
                    await this.handleAppointments(phone, message, session);
                    break;

                case "DOCTOR_CANCEL":
                    await this.handleCancel(phone, message, session);
                    break;

                case "DOCTOR_MARK_STATUS":
                    await this.handleMarkStatus(phone, message, session);
                    break;

                case "DOCTOR_MARK_STATUS_SELECT":
                    await this.handleMarkStatusSelect(phone, message, session);
                    break;

                case "DOCTOR_MARK_STATUS_CONFIRM":
                    await this.handleMarkStatusConfirm(phone, message, session);
                    break;

                default:
                    await this.handleMenu(phone, message, session);
            }
        } catch (error) {
            debug("doctorFlow", "Error in flow handler", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                session.phone,
                "Sorry, something went wrong. Please try again later."
            );
        }
    }

    /**
     * DOCTOR_LOGIN - Authenticate doctor with PIN
     * Uses rate limiting to prevent brute force attacks
     * Max 3 attempts, then 15-minute lockout
     */
    private async handleLogin(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state && session.state !== "DOCTOR_LOGIN") {
            await this.handleLogin(phone, message, { ...session, state: "DOCTOR_LOGIN" });
            return;
        }

        const clinicId = session.clinic_id;
        const providedPin = message.text?.trim() || "";
        const language = session.data?.language || "EN";

        // Check if account is locked
        if (isAccountLocked(phone, clinicId)) {
            const errorMsg = formatAuthErrorMessage(`account_locked_15`, language);
            await this.whatsappClient.sendTextMessage(phone, errorMsg);
            return;
        }

        // If message looks like empty or very short random text (not a PIN attempt),
        // send PIN prompt (handles edge case of first message not being greeting)
        if (providedPin.length === 0) {
            const pinPrompt = getPinEntryPrompt(phone, clinicId, language);
            await this.whatsappClient.sendTextMessage(phone, pinPrompt);
            return;
        }

        // Verify PIN with rate limiting
        const authResult = await verifyDoctorPin(this.supabase, phone, clinicId, providedPin);

        if (!authResult.success) {
            // Authentication failed
            const errorMsg = formatAuthErrorMessage(authResult.error || "invalid_pin", language);
            const remainingAttempts = getRemainingAttempts(phone, clinicId);

            let fullMessage = errorMsg;
            if (remainingAttempts > 0) {
                fullMessage +=
                    "\n\n" +
                    (language === "EN"
                        ? `${remainingAttempts} attempts remaining`
                        : `${remainingAttempts} प्रयास शेष`);
            }

            await this.whatsappClient.sendTextMessage(phone, fullMessage);

            // If locked, stop here
            if (authResult.error?.startsWith("account_locked")) {
                return;
            }

            // Otherwise, prompt for retry
            const retryPrompt = getPinEntryPrompt(phone, clinicId, language);
            await this.whatsappClient.sendTextMessage(phone, retryPrompt);
            return;
        }

        // PIN is valid - get doctor details
        try {
            const doctors = await this.supabaseClient.getDoctors(clinicId);
            const doctor = doctors?.find((d: any) => d.phone === phone || d.whatsapp_phone === phone);

            if (!doctor) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    language === "EN"
                        ? "❌ You are not registered as a doctor. Please contact clinic administration."
                        : "❌ आप एक डॉक्टर के रूप में पंजीकृत नहीं हैं। कृपया क्लिनिक प्रशासन से संपर्क करें।"
                );
                return;
            }

            // Authentication successful - update session
            await this.updateSession(phone, "DOCTOR_MENU", {
                doctorId: doctor.doctor_id || doctor.id,
                doctorName: doctor.name,
                language: language,
                authenticated: true
            });

            debug("doctorFlow", "Doctor authenticated successfully", {
                phone,
                doctorId: doctor.doctor_id
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? `✅ Welcome, Dr. ${doctor.name}!\n\nYou are now logged in to your portal.`
                    : `✅ स्वागत है, डॉ. ${doctor.name}!\n\nआप अब अपने पोर्टल में लॉगिन हैं।`
            );

            // Show doctor menu
            await this.showMenu(phone);
        } catch (error) {
            debug("doctorFlow", "Error during doctor lookup", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                language === "EN"
                    ? "❌ Error loading doctor details. Please try again."
                    : "❌ डॉक्टर विवरण लोड करने में त्रुटि। कृपया दोबारा कोशिश करें।"
            );
        }
    }

    /**
     * DOCTOR_MENU - Show doctor portal options
     */
    private async handleMenu(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        if (!session.data?.authenticated) {
            await this.updateSession(phone, "DOCTOR_LOGIN");
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please authenticate with your PIN:"
            );
            return;
        }

        const buttonId = message.text.trim();

        // Validate button ID
        if (!isValidDoctorMenuButton(buttonId)) {
            await this.showMenu(phone);
            return;
        }

        switch (buttonId) {
            case BUTTON_IDS.DOCTOR_MENU.AVAILABILITY:
                await this.updateSession(phone, "DOCTOR_AVAILABILITY", {
                    doctorId: session.data?.doctorId,
                    doctorName: session.data?.doctorName,
                    authenticated: true
                });
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "📅 Please provide your availability for today (format: HH:MM-HH:MM, e.g., 09:00-17:00):"
                );
                break;

            case BUTTON_IDS.DOCTOR_MENU.LEAVE:
                await this.updateSession(phone, "DOCTOR_LEAVE", {
                    doctorId: session.data?.doctorId,
                    doctorName: session.data?.doctorName,
                    authenticated: true
                });
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "🗓️ Please provide leave dates (format: YYYY-MM-DD to YYYY-MM-DD):"
                );
                break;

            case BUTTON_IDS.DOCTOR_MENU.APPOINTMENTS:
                await this.showAppointments(phone, session);
                break;

            case BUTTON_IDS.DOCTOR_MENU.MARK_STATUS:
                await this.updateSession(phone, "DOCTOR_MARK_STATUS", {
                    doctorId: session.data?.doctorId,
                    doctorName: session.data?.doctorName,
                    authenticated: true
                });
                await this.showMarkStatusAppointments(phone, session.data?.doctorId, session.data?.clinicId);
                break;

            case BUTTON_IDS.DOCTOR_MENU.LOGOUT:
                await this.updateSession(phone, "DOCTOR_LOGIN", {});
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "You have been logged out. Please login again with your PIN."
                );
                break;

            default:
                await this.showMenu(phone);
        }
    }

    /**
     * DOCTOR_AVAILABILITY - Set working hours (free text: HH:MM-HH:MM)
     */
    private async handleAvailability(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "DOCTOR_AVAILABILITY") {
            await this.showMenu(phone);
            return;
        }

        const timeRange = message.text.trim();

        // Validate format (HH:MM-HH:MM)
        if (!/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(timeRange)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "⚠️ Invalid format. Please use HH:MM-HH:MM (e.g., 09:00-17:00):"
            );
            return;
        }

        // Parse and validate times
        const [startTime, endTime] = timeRange.split("-");
        const [startHour, startMin] = startTime.split(":").map(Number);
        const [endHour, endMin] = endTime.split(":").map(Number);

        if (startHour >= endHour || (startHour === endHour && startMin >= endMin)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "⚠️ End time must be after start time. Please try again:"
            );
            return;
        }

        // Move to confirmation
        await this.updateSession(phone, "DOCTOR_AVAILABILITY_CONFIRM", {
            doctorId: session.data?.doctorId,
            doctorName: session.data?.doctorName,
            authenticated: true,
            availabilityStart: startTime,
            availabilityEnd: endTime
        });

        await this.showAvailabilityConfirmation(phone, startTime, endTime);
    }

    /**
     * DOCTOR_AVAILABILITY_CONFIRM - Confirm availability changes
     */
    private async handleAvailabilityConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "DOCTOR_AVAILABILITY_CONFIRM") {
            await this.showMenu(phone);
            return;
        }

        const buttonId = message.text.trim();
        const clinicId = session.clinic_id;
        const doctorId = session.data?.doctorId;

        if (!isValidConfirmationButton(buttonId)) {
            await this.showAvailabilityConfirmation(
                phone,
                session.data?.availabilityStart,
                session.data?.availabilityEnd
            );
            return;
        }

        if (buttonId === BUTTON_IDS.CONFIRMATION.YES) {
            try {
                // Save availability to database
                await this.supabaseClient.addDoctorOperatingHours(
                    clinicId,
                    doctorId,
                    `${session.data?.availabilityStart}-${session.data?.availabilityEnd}`
                );

                await this.updateSession(phone, "DOCTOR_MENU", {
                    doctorId,
                    doctorName: session.data?.doctorName,
                    authenticated: true
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    `✅ Availability updated: ${session.data?.availabilityStart} - ${session.data?.availabilityEnd}`
                );

                await this.showMenu(phone);
            } catch (error) {
                debug("doctorFlow", "Error saving availability", {
                    error: error instanceof Error ? error.message : String(error)
                });
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Error updating availability. Please try again."
                );
            }
        } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            await this.updateSession(phone, "DOCTOR_MENU", {
                doctorId: session.data?.doctorId,
                doctorName: session.data?.doctorName,
                authenticated: true
            });

            await this.whatsappClient.sendTextMessage(phone, "❌ Cancelled.");
            await this.showMenu(phone);
        }
    }

    /**
     * DOCTOR_LEAVE - Apply for leave
     */
    private async handleLeave(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "DOCTOR_LEAVE") {
            await this.showMenu(phone);
            return;
        }

        const dateRange = message.text.trim();

        // Validate format (YYYY-MM-DD to YYYY-MM-DD)
        if (!/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}$/.test(dateRange)) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "Invalid format. Please use 'YYYY-MM-DD to YYYY-MM-DD' (e.g., 2026-09-20 to 2026-09-25):"
            );
            return;
        }

        const [startDate, endDate] = dateRange.split(" to ");

        // Validate dates are in future
        const start = new Date(startDate);
        const end = new Date(endDate);
        const today = new Date();

        if (start < today) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "Leave start date must be in the future. Please try again:"
            );
            return;
        }

        if (end < start) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "Leave end date must be after start date. Please try again:"
            );
            return;
        }

        // Move to confirmation
        await this.updateSession(phone, "DOCTOR_LEAVE_CONFIRM", {
            doctorId: session.data?.doctorId,
            doctorName: session.data?.doctorName,
            authenticated: true,
            leaveStart: startDate,
            leaveEnd: endDate
        });

        await this.showLeaveConfirmation(phone, startDate, endDate);
    }

    /**
     * DOCTOR_LEAVE_CONFIRM - Confirm leave application
     */
    private async handleLeaveConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "DOCTOR_LEAVE_CONFIRM") {
            await this.showMenu(phone);
            return;
        }

        const buttonId = message.text.trim();
        const clinicId = session.clinic_id;
        const doctorId = session.data?.doctorId;

        if (!isValidConfirmationButton(buttonId)) {
            await this.showLeaveConfirmation(
                phone,
                session.data?.leaveStart,
                session.data?.leaveEnd
            );
            return;
        }

        if (buttonId === BUTTON_IDS.CONFIRMATION.YES) {
            try {
                // Save leave to database
                await this.supabaseClient.addDoctorLeave(
                    clinicId,
                    doctorId,
                    session.data?.leaveStart,
                    session.data?.leaveEnd
                );

                await this.updateSession(phone, "DOCTOR_MENU", {
                    doctorId,
                    doctorName: session.data?.doctorName,
                    authenticated: true
                });

                await this.whatsappClient.sendTextMessage(
                    phone,
                    `✅ Leave approved: ${session.data?.leaveStart} to ${session.data?.leaveEnd}`
                );

                await this.showMenu(phone);
            } catch (error) {
                debug("doctorFlow", "Error saving leave", {
                    error: error instanceof Error ? error.message : String(error)
                });
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Error applying for leave. Please try again."
                );
            }
        } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
            await this.updateSession(phone, "DOCTOR_MENU", {
                doctorId: session.data?.doctorId,
                doctorName: session.data?.doctorName,
                authenticated: true
            });

            await this.whatsappClient.sendTextMessage(phone, "❌ Cancelled.");
            await this.showMenu(phone);
        }
    }

    /**
     * DOCTOR_APPOINTMENTS - View today's appointments
     */
    private async handleAppointments(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "DOCTOR_APPOINTMENTS") {
            await this.showMenu(phone);
            return;
        }

        await this.updateSession(phone, "DOCTOR_MENU", {
            doctorId: session.data?.doctorId,
            doctorName: session.data?.doctorName,
            authenticated: true
        });

        await this.showTodayAppointments(phone, session.data?.doctorId);
        await this.showMenu(phone);
    }

    /**
     * DOCTOR_CANCEL - Cancel an appointment (doctor-initiated)
     */
    private async handleCancel(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation - prevent collision with old menu buttons
        if (session.state !== "DOCTOR_CANCEL") {
            await this.showMenu(phone);
            return;
        }

        const appointmentId = message.text.trim();

        // TODO: Implement appointment cancellation by doctor
        // This should verify appointment belongs to doctor, then cancel

        await this.updateSession(phone, "DOCTOR_MENU", {
            doctorId: session.data?.doctorId,
            doctorName: session.data?.doctorName,
            authenticated: true
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            `✅ Appointment ${appointmentId} has been cancelled.`
        );

        await this.showMenu(phone);
    }

    /**
     * Helper: Show doctor portal menu
     */
    private async showMenu(phone: string): Promise<void> {
        const message = `👨‍⚕️ Doctor Portal Menu:\n\nTap an option below:`;

        const rows = [
            { id: BUTTON_IDS.DOCTOR_MENU.APPOINTMENTS, title: "📋 Appointments", description: "View today's appointments" },
            { id: BUTTON_IDS.DOCTOR_MENU.MARK_STATUS, title: "✅ Mark Status", description: "Update an appointment status" },
            { id: BUTTON_IDS.DOCTOR_MENU.AVAILABILITY, title: "📅 Availability", description: "Set your consulting hours" },
            { id: BUTTON_IDS.DOCTOR_MENU.LEAVE, title: "🗓️ Leave", description: "Mark yourself on leave" },
            { id: BUTTON_IDS.DOCTOR_MENU.LOGOUT, title: "🚪 Logout", description: "End this portal session" }
        ];

        // Five options exceed the 3-button limit, so use a list message.
        try {
            await this.whatsappClient.sendInteractiveListMessage(
                phone,
                message,
                "Menu",
                [{ title: "Doctor Portal", rows }],
                this.supabase
            );
        } catch (error) {
            debug("doctorFlow", "Doctor menu list failed, sending text fallback", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                `${message}\n\n${rows.map((row) => row.title).join("\n")}`,
                this.supabase
            );
        }
    }

    /**
     * Helper: Show availability confirmation menu
     */
    private async showAvailabilityConfirmation(
        phone: string,
        startTime: string,
        endTime: string
    ): Promise<void> {
        const message = `Confirm availability:\n${startTime} - ${endTime}\n\nTap to confirm:`;
        
        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.CONFIRMATION.YES, title: "✅ Confirm" },
            { id: BUTTON_IDS.CONFIRMATION.NO, title: "❌ Cancel" }
        ]);
    }

    /**
     * Helper: Show leave confirmation menu
     */
    private async showLeaveConfirmation(
        phone: string,
        startDate: string,
        endDate: string
    ): Promise<void> {
        const message = `Confirm leave:\n${startDate} to ${endDate}\n\nTap to confirm:`;
        
        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.CONFIRMATION.YES, title: "✅ Confirm" },
            { id: BUTTON_IDS.CONFIRMATION.NO, title: "❌ Cancel" }
        ]);
    }

    /**
     * Helper: Show today's appointments for doctor
     */
    private async showTodayAppointments(phone: string, doctorId: string): Promise<void> {
        try {
            // Get clinic ID from session
            const { data: session } = await this.supabase
                .from("whatsapp_sessions")
                .select("data")
                .eq("phone", phone)
                .single();

            if (!session?.data?.clinicId) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Error: Clinic information not found."
                );
                return;
            }

            const clinicId = session.data.clinicId;
            const today = new Date().toISOString().split("T")[0];

            const appointments = await this.supabaseClient.getDoctorAppointments(clinicId, doctorId, today);

            if (appointments.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    `📋 No appointments scheduled for today.\n\nYou're all set! 😊`
                );
            } else {
                let appointmentList = "📋 Today's Appointments:\n\n";
                appointments.forEach((apt, index) => {
                    const patientName = apt.patient?.full_name || "Unknown";
                    const status = apt.status || "CONFIRMED";
                    const icon = status === "COMPLETED" ? "✅" : status === "NO_SHOW" ? "❌" : "📌";
                    appointmentList += `${index + 1}. ${apt.appointment_time} - ${patientName} ${icon}\n`;
                });
                appointmentList += `\nTotal: ${appointments.length} appointment(s)`;

                await this.whatsappClient.sendTextMessage(phone, appointmentList);
            }
        } catch (error) {
            debug("doctorFlow", "Error loading appointments", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                "Error loading appointments. Please try again."
            );
        }
    }

    /**
     * Helper: Show appointments for marking status
     */
    private async showMarkStatusAppointments(phone: string, doctorId: string, clinicId: string): Promise<void> {
        try {
            const today = new Date().toISOString().split("T")[0];
            const appointments = await this.supabaseClient.getDoctorAppointments(clinicId, doctorId, today);

            const confirmedAppointments = appointments.filter(apt => apt.status === "CONFIRMED");

            if (confirmedAppointments.length === 0) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "✅ No pending appointments to mark.\n\nAll appointments have been processed!"
                );
                await this.showMenu(phone);
            } else {
                let appointmentList = "📌 Select appointment to mark status:\n\n";
                confirmedAppointments.forEach((apt, index) => {
                    const patientName = apt.patient?.full_name || "Unknown";
                    appointmentList += `${index + 1}. ${apt.appointment_time} - ${patientName}\n`;
                });
                appointmentList += `\nReply with number (e.g., 1):`;

                await this.whatsappClient.sendTextMessage(phone, appointmentList);

                // Store appointments in session for later reference
                await this.updateSession(phone, "DOCTOR_MARK_STATUS_SELECT", {
                    doctorId: doctorId,
                    doctorName: (await this.supabase
                        .from("doctors")
                        .select("name")
                        .eq("id", doctorId)
                        .single()
                    ).data?.name,
                    authenticated: true,
                    clinicId: clinicId,
                    appointments: confirmedAppointments.map(apt => ({
                        id: apt.id,
                        time: apt.appointment_time,
                        patientName: apt.patient?.full_name || "Unknown",
                        patientId: apt.patient_id
                    }))
                });
            }
        } catch (error) {
            debug("doctorFlow", "Error loading appointments for status marking", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                "Error loading appointments. Please try again."
            );
        }
    }

    /**
     * DOCTOR_MARK_STATUS - Show list of appointments to mark
     */
    private async handleMarkStatus(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation
        if (session.state !== "DOCTOR_MARK_STATUS") {
            await this.showMenu(phone);
            return;
        }

        await this.showMarkStatusAppointments(phone, session.data?.doctorId, session.data?.clinicId);
    }

    /**
     * DOCTOR_MARK_STATUS_SELECT - Receive appointment selection and show status options
     */
    private async handleMarkStatusSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation
        if (session.state !== "DOCTOR_MARK_STATUS_SELECT") {
            await this.showMenu(phone);
            return;
        }

        const appointments = session.data?.appointments || [];
        const choice = message.text.trim();
        const appointmentIndex = parseInt(choice) - 1;

        if (isNaN(appointmentIndex) || appointmentIndex < 0 || appointmentIndex >= appointments.length) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "❌ Invalid selection. Please reply with the appointment number:"
            );
            return;
        }

        const selectedAppointment = appointments[appointmentIndex];

        // Store selected appointment and show status options
        await this.updateSession(phone, "DOCTOR_MARK_STATUS_CONFIRM", {
            doctorId: session.data?.doctorId,
            doctorName: session.data?.doctorName,
            authenticated: true,
            clinicId: session.data?.clinicId,
            selectedAppointmentId: selectedAppointment.id,
            selectedAppointmentTime: selectedAppointment.time,
            selectedPatientName: selectedAppointment.patientName
        });

        // Show status options
        const message2 = `Mark appointment for ${selectedAppointment.patientName} at ${selectedAppointment.time}:\n\nSelect status:`;
        
        await this.whatsappClient.sendInteractiveButtonMessage(phone, message2, [
            { id: "status_completed", title: "✅ Completed" },
            { id: "status_no_show", title: "❌ No Show" }
        ]);
    }

    /**
     * DOCTOR_MARK_STATUS_CONFIRM - Confirm and update appointment status
     */
    private async handleMarkStatusConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // Explicit state validation
        if (session.state !== "DOCTOR_MARK_STATUS_CONFIRM") {
            await this.showMenu(phone);
            return;
        }

        const statusChoice = message.text.trim();
        let newStatus: string;

        if (statusChoice === "status_completed") {
            newStatus = "COMPLETED";
        } else if (statusChoice === "status_no_show") {
            newStatus = "NO_SHOW";
        } else {
            await this.whatsappClient.sendTextMessage(
                phone,
                "❌ Invalid status. Please select from the options above."
            );
            return;
        }

        try {
            const appointmentId = session.data?.selectedAppointmentId;
            const clinicId = session.data?.clinicId;
            const patientName = session.data?.selectedPatientName;

            await this.supabaseClient.updateAppointmentStatus(
                clinicId,
                appointmentId,
                newStatus,
                newStatus === "NO_SHOW" ? "Doctor marked as no-show" : undefined
            );

            const statusText = newStatus === "COMPLETED" ? "Completed ✅" : "No-Show ❌";

            await this.whatsappClient.sendTextMessage(
                phone,
                `✅ Appointment for ${patientName} marked as ${statusText}.\n\nReturning to menu...`
            );

            // Reset to menu
            await this.updateSession(phone, "DOCTOR_MENU", {
                doctorId: session.data?.doctorId,
                doctorName: session.data?.doctorName,
                authenticated: true,
                clinicId: clinicId
            });

            await this.showMenu(phone);
        } catch (error) {
            debug("doctorFlow", "Error updating appointment status", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                "❌ Error updating appointment status. Please try again."
            );

            // Return to mark status selection
            await this.showMarkStatusAppointments(phone, session.data?.doctorId, session.data?.clinicId);
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
            debug("doctorFlow", "Error updating session", { error: error.message });
        }
    }
}
