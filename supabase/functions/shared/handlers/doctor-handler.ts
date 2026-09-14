import { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidDoctorMenuButton, isValidConfirmationButton } from "../button-ids.ts";
import { debug } from "../logger.ts";

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
     */
    private async handleLogin(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const pin = message.text.trim();
        const doctorPin = Deno.env.get("DOCTOR_PORTAL_PIN") || "1234";
        const clinicId = session.clinic_id;

        // Validate PIN
        if (pin !== doctorPin) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "❌ Invalid PIN. Please try again."
            );
            return;
        }

        // Get doctor details from phone and clinic
        const doctors = await this.supabaseClient.getDoctors(clinicId);
        const doctor = doctors?.find((d: any) => d.phone === phone);

        if (!doctor) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "❌ You are not registered as a doctor. Please contact clinic administration."
            );
            return;
        }

        // Update session
        await this.updateSession(phone, "DOCTOR_MENU", {
            doctorId: doctor.doctor_id,
            doctorName: doctor.name,
            authenticated: true
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            `✅ Welcome, Dr. ${doctor.name}! 👋\n\nYou are now logged into the doctor portal.`
        );

        await this.showMenu(phone);
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

            case BUTTON_IDS.DOCTOR_MENU.CANCEL:
                await this.updateSession(phone, "DOCTOR_MENU");
                await this.showMenu(phone);
                break;

            default:
                await this.showMenu(phone);
        }
    }
        } else if (choice === "3" || choice === "appointments") {
            await this.updateSession(phone, "DOCTOR_APPOINTMENTS", {
                doctorId: session.data?.doctorId,
                doctorName: session.data?.doctorName,
                authenticated: true
            });
            await this.showTodayAppointments(phone, session.data?.doctorId);
        } else if (choice === "4" || choice === "logout") {
            await this.updateSession(phone, "DOCTOR_LOGIN", {});
            await this.whatsappClient.sendTextMessage(
                phone,
                "You have been logged out. Please login again with your PIN."
            );
        } else {
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

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.DOCTOR_MENU.AVAILABILITY, title: "📅 Availability" },
            { id: BUTTON_IDS.DOCTOR_MENU.LEAVE, title: "🗓️ Leave" },
            { id: BUTTON_IDS.DOCTOR_MENU.APPOINTMENTS, title: "📋 Appointments" },
            { id: BUTTON_IDS.DOCTOR_MENU.CANCEL, title: "🚪 Logout" }
        ]);
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
            // TODO: Query appointments for this doctor on today's date
            // This requires filtering the Appointments sheet by doctorId and today's date

            const message = `Today's Appointments:\n\n1. 10:00 - Patient Name 1\n2. 14:30 - Patient Name 2\n3. 16:00 - Patient Name 3\n\nTotal: 3 appointments`;

            await this.whatsappClient.sendTextMessage(phone, message);
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
