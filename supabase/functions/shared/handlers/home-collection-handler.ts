import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidConfirmationButton } from "../button-ids.ts";
import { debug } from "../logger.ts";
import { isValidBookingDate, formatBookingDateErrorMessage } from "../validators.ts";
import { getHomeCollectionMinLeadHours, getMaxCollectionsPerCollectorPerDay } from "../config.ts";
import { getCollectorsForClinic } from "../staff-directory.ts";
import { createHomeCollectionReminder, markHomeCollectionRemindersAsSkipped } from "../home-collection-reminders.ts";

/**
 * Home Collection Handler - Manages blood collection requests
 * Handles: location verification, request submission, status tracking
 * Used by sample collection personnel only
 */

export class HomeCollectionHandler {
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
            const state = session.state || "LOCATION_SELECT";
            const phone = session.phone;
            const raw = message.text?.trim() || "";
            // Session writes must never touch this phone's row at another clinic.
            this.clinicId = session.clinic_id;

            // Dispatch replies carry their request id and can arrive in any state.
            if (
                raw.startsWith(BUTTON_IDS.HOME_COLLECTION_MENU.CONFIRM + ":") ||
                raw.startsWith(BUTTON_IDS.HOME_COLLECTION_MENU.REJECT + ":")
            ) {
                await this.handleCollectionOffer(phone, raw);
                return;
            }

            debug("homeCollectionFlow", `Processing state: ${state}`, {
                phone,
                messageText: message.text?.substring(0, 50)
            });

            switch (state) {
                case "LOCATION_SELECT":
                    await this.handleLocationSelect(phone, message, session);
                    break;

                case "LOCATION_VERIFY":
                    await this.handleLocationVerify(phone, message, session);
                    break;

                case "REQUEST_DATE":
                    await this.handleRequestDate(phone, message, session);
                    break;

                case "REQUEST_DATE_CUSTOM":
                    await this.handleRequestDateCustom(phone, message, session);
                    break;

                case "REQUEST_TIME_WINDOW":
                    await this.handleRequestTimeWindow(phone, message, session);
                    break;

                case "REQUEST_CONFIRM":
                    await this.handleRequestConfirm(phone, message, session);
                    break;

                case "REQUEST_TRACKING":
                    await this.handleRequestTracking(phone, message, session);
                    break;

                default:
                    await this.handleLocationSelect(phone, message, session);
            }
        } catch (error) {
            debug("homeCollectionFlow", "Error in flow handler", {
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                session.phone,
                "Sorry, something went wrong. Please try again later."
            );
        }
    }

    /**
     * LOCATION_SELECT - Get user location or address
     */
    private async handleLocationSelect(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "LOCATION_SELECT") {
            await this.handleLocationSelect(phone, message, session);
            return;
        }

        // Check if message contains location data (latitude/longitude)
        if (message.latitude && message.longitude) {
            // Location shared via WhatsApp location pin
            const latitude = message.latitude;
            const longitude = message.longitude;

            await this.updateSession(phone, "LOCATION_VERIFY", {
                latitude,
                longitude,
                locationType: "GPS"
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                `📍 Location received\n\nPlease confirm your address or provide a landmark:`
            );
        } else if (typeof message.text === "string" && message.text.length > 0) {
            // Address provided as text
            const address = message.text.trim();

            await this.updateSession(phone, "LOCATION_VERIFY", {
                address,
                locationType: "TEXT"
            });

            await this.whatsappClient.sendInteractiveButtonMessage(
                phone,
                `📍 Address: "${address}"\n\nIs this correct?`,
                [
                    { id: BUTTON_IDS.CONFIRMATION.YES, title: "Yes, Correct" },
                    { id: BUTTON_IDS.CONFIRMATION.NO, title: "No, Change" }
                ]
            );
        } else {
            // Request location
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please share your location or type your address for home blood collection.\n\nYou can:\n• Attach your location in WhatsApp, or\n• Type your address"
            );
        }
    }

    /**
     * LOCATION_VERIFY - Verify and confirm location
     */
    private async handleLocationVerify(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "LOCATION_VERIFY") {
            await this.showRequestConfirmation(phone, session.data);
            return;
        }

        const buttonId = message.text?.trim() || "";

        // Check if this is a button response
        if (isValidConfirmationButton(buttonId)) {
            if (buttonId === BUTTON_IDS.CONFIRMATION.YES) {
                // Location confirmed, move to date selection
                await this.updateSession(phone, "REQUEST_DATE", {
                    latitude: session.data?.latitude,
                    longitude: session.data?.longitude,
                    address: session.data?.address,
                    locationType: session.data?.locationType
                });

                // Show date selection menu
                await this.whatsappClient.sendInteractiveButtonMessage(
                    phone,
                    "📅 Please select a preferred date for home collection:",
                    [
                        { id: BUTTON_IDS.DATE_SELECT.TODAY, title: "Today" },
                        { id: BUTTON_IDS.DATE_SELECT.TOMORROW, title: "Tomorrow" },
                        { id: BUTTON_IDS.DATE_SELECT.OTHER, title: "Other Date" }
                    ]
                );
            } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
                // Request new location
                await this.updateSession(phone, "LOCATION_SELECT");

                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Please provide your correct location or address:"
                );
            }
        } else if (message.text && message.text.length > 5) {
            // Treat as corrected address
            await this.updateSession(phone, "LOCATION_VERIFY", {
                address: message.text.trim(),
                locationType: "TEXT"
            });

            await this.whatsappClient.sendInteractiveButtonMessage(
                phone,
                `📍 Address: "${message.text.trim()}"\n\nIs this correct?`,
                [
                    { id: BUTTON_IDS.CONFIRMATION.YES, title: "Yes, Correct" },
                    { id: BUTTON_IDS.CONFIRMATION.NO, title: "No, Change" }
                ]
            );
        } else {
            // Invalid input
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please tap a button or provide your address:"
            );
        }
    }

    /**
     * REQUEST_DATE - Select preferred date for home collection
     * Max 1 week in advance (0-7 days from today)
     */
    private async handleRequestDate(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "REQUEST_DATE") {
            await this.whatsappClient.sendTextMessage(phone, "Please select a date:");
            return;
        }

        const buttonId = message.text?.trim() || "";
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let selectedDate: string;

        if (buttonId === BUTTON_IDS.DATE_SELECT.TODAY || buttonId === "1" || buttonId === "today") {
            // Today
            selectedDate = this.formatDate(today);
        } else if (buttonId === BUTTON_IDS.DATE_SELECT.TOMORROW || buttonId === "2" || buttonId === "tomorrow") {
            // Tomorrow
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            selectedDate = this.formatDate(tomorrow);
        } else if (buttonId === BUTTON_IDS.DATE_SELECT.OTHER || buttonId === "3" || buttonId === "other") {
            // Ask for custom date
            await this.whatsappClient.sendTextMessage(
                phone,
                "📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can schedule up to 7 days in advance)"
            );
            await this.updateSession(phone, "REQUEST_DATE_CUSTOM", {
                latitude: session.data?.latitude,
                longitude: session.data?.longitude,
                address: session.data?.address,
                locationType: session.data?.locationType
            });
            return;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(buttonId)) {
            // Custom date input - validate format and range
            const dateValidation = isValidBookingDate(buttonId);

            if (!dateValidation.valid) {
                const errorMsg = formatBookingDateErrorMessage(dateValidation.error || "invalid_format", "EN");
                await this.whatsappClient.sendTextMessage(phone, errorMsg);

                // Prompt to retry
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can schedule up to 7 days in advance)"
                );
                return;
            }

            selectedDate = buttonId;
        } else {
            // Invalid input
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please select an option or enter a date (YYYY-MM-DD):"
            );
            return;
        }

        // Move to window selection
        await this.offerTimeWindows(phone, session, selectedDate);
    }

    /**
     * REQUEST_DATE_CUSTOM - Handle custom date input for home collection
     */
    private async handleRequestDateCustom(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const dateString = message.text?.trim() || "";

        // Validate date format and range
        const dateValidation = isValidBookingDate(dateString);

        if (!dateValidation.valid) {
            const errorMsg = formatBookingDateErrorMessage(dateValidation.error || "invalid_format", "EN");
            await this.whatsappClient.sendTextMessage(phone, errorMsg);

            // Prompt to retry
            await this.whatsappClient.sendTextMessage(
                phone,
                "📅 Please enter your preferred date (YYYY-MM-DD):\n\n(You can schedule up to 7 days in advance)"
            );
            return;
        }

        // Move to window selection
        await this.offerTimeWindows(phone, session, dateString);
    }

    /**
     * REQUEST_CONFIRM - Confirm home collection request details
     */
    private async handleRequestConfirm(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "REQUEST_CONFIRM") {
            await this.showRequestConfirmation(phone, session.data);
            return;
        }

        const buttonId = message.text?.trim() || "";

        // Check if this is a button response
        if (isValidConfirmationButton(buttonId)) {
            if (buttonId === BUTTON_IDS.CONFIRMATION.YES) {
                // Create home collection request
                const result = await this.createHomeCollectionRequest(
                    phone,
                    session.data,
                    session.clinic_id
                );

                if (result.success) {
                    await this.updateSession(phone, "REQUEST_TRACKING", {
                        requestId: result.requestId,
                        latitude: session.data?.latitude,
                        longitude: session.data?.longitude,
                        address: session.data?.address
                    });

                    await this.whatsappClient.sendTextMessage(
                        phone,
                        `✅ Your home collection request has been submitted!\n\nRequest ID: ${result.requestId}\n\n📍 Our team will contact you within 2-4 hours.\n\nYou will receive a confirmation message once the collection is scheduled.`
                    );

                    await this.notifyCollectors(result.requestId!, session.data, session.clinic_id);
                } else {
                    await this.whatsappClient.sendTextMessage(
                        phone,
                        `❌ Failed to submit request: ${result.error}`
                    );

                    await this.updateSession(phone, "LOCATION_SELECT", {});
                }
            } else if (buttonId === BUTTON_IDS.CONFIRMATION.NO) {
                // Go back to location selection
                await this.updateSession(phone, "LOCATION_SELECT", {});

                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Please provide your location again:"
                );
            }
        } else {
            // Invalid input
            await this.whatsappClient.sendTextMessage(
                phone,
                "Please tap a button to confirm or reject:"
            );
        }
    }

    /**
     * REQUEST_TRACKING - Track home collection request status
     */
    private async handleRequestTracking(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        // GUARD: Explicit state validation
        if (session.state !== "REQUEST_TRACKING") {
            const requestId = session.data?.requestId;
            if (requestId) {
                const status = await this.getRequestStatus(requestId, session.clinic_id);
                if (status) {
                    const statusMessage = this.formatStatusMessage(status);
                    await this.whatsappClient.sendTextMessage(phone, statusMessage);
                }
            }
            return;
        }

        // Check if user provided a request ID
        const providedId = message.text?.trim() || "";

        if (providedId.startsWith("HC_") && providedId.length > 10) {
            // Treat as request ID
            const status = await this.getRequestStatus(providedId, session.clinic_id);

            if (!status) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    `❌ Request ${providedId} not found. Please check the ID and try again.`
                );
                return;
            }

            const statusMessage = this.formatStatusMessage(status);
            await this.whatsappClient.sendTextMessage(phone, statusMessage);
        } else {
            // Use session request ID
            const requestId = session.data?.requestId;
            if (!requestId) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    "Please start a new request:"
                );
                await this.updateSession(phone, "LOCATION_SELECT", {});
                return;
            }

            const status = await this.getRequestStatus(requestId, session.clinic_id);

            if (!status) {
                await this.whatsappClient.sendTextMessage(
                    phone,
                    `❌ Request ${requestId} not found.`
                );
                return;
            }

            const statusMessage = this.formatStatusMessage(status);
            await this.whatsappClient.sendTextMessage(phone, statusMessage);
        }
    }

    /**
     * Helper: Create home collection request in Supabase
     * Also creates a reminder for the collection date
     */
    /**
     * The three collection windows, mirroring the Apps Script rules.
     */
    private getTimeWindowOptions(): Array<{ id: string; title: string; value: string; startMinutes: number }> {
        return [
            { id: "1", title: "Morning: 8AM-12PM", value: "Morning (8 AM - 12 PM)", startMinutes: 8 * 60 },
            { id: "2", title: "Afternoon: 12-4PM", value: "Afternoon (12 PM - 4 PM)", startMinutes: 12 * 60 },
            { id: "3", title: "Evening: 4-8PM", value: "Evening (4 PM - 8 PM)", startMinutes: 16 * 60 }
        ];
    }

    /**
     * Windows still reachable for a date, honouring the minimum lead time today.
     */
    private getTimeWindowOptionsForDate(dateString: string) {
        const options = this.getTimeWindowOptions();
        const today = new Date().toISOString().split("T")[0];

        if (!dateString || dateString !== today) {
            return options;
        }

        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        const minimumStart = currentMinutes + Math.ceil(getHomeCollectionMinLeadHours() * 60);

        return options.filter((option) => option.startMinutes >= minimumStart);
    }

    /**
     * Collections still bookable on a date across all collectors.
     */
    private async getRemainingCapacity(clinicId: string, date: string): Promise<number> {
        const collectors = await getCollectorsForClinic(this.supabase, clinicId);
        const capacity = collectors.reduce(
            (total, collector) => total + (collector.maxPerDay || getMaxCollectionsPerCollectorPerDay()),
            0
        );

        if (capacity === 0) {
            return 0;
        }

        const { count, error } = await this.supabase
            .from("home_collection_requests")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", clinicId)
            .eq("requested_date", date)
            .neq("status", "CANCELLED");

        if (error) {
            debug("homeCollectionFlow", "Error reading capacity", { error: error.message });
            return capacity;
        }

        return capacity - (count || 0);
    }

    /**
     * Offer the windows available for the chosen date, or explain why there are none.
     */
    private async offerTimeWindows(phone: string, session: WhatsAppSession, selectedDate: string): Promise<void> {
        const clinicId = session.clinic_id;
        const remaining = await this.getRemainingCapacity(clinicId, selectedDate);

        if (remaining <= 0) {
            await this.whatsappClient.sendTextMessage(
                phone,
                `Sorry, ${selectedDate} is fully booked for home collection. Please choose another date.`
            );
            return;
        }

        const windows = this.getTimeWindowOptionsForDate(selectedDate);

        if (windows.length === 0) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "There are no collection windows left for today. Please choose another date."
            );
            return;
        }

        await this.updateSession(phone, "REQUEST_TIME_WINDOW", {
            latitude: session.data?.latitude,
            longitude: session.data?.longitude,
            address: session.data?.address,
            locationType: session.data?.locationType,
            requestDate: selectedDate
        });

        const list = windows.map((w) => `${w.id}. ${w.value}`).join("\n");

        await this.whatsappClient.sendTextMessage(
            phone,
            `📅 Date: ${selectedDate}\n\nPlease choose a collection window:\n\n${list}`
        );
    }

    /**
     * REQUEST_TIME_WINDOW - Capture the chosen collection window
     */
    private async handleRequestTimeWindow(
        phone: string,
        message: ExtractedMessage,
        session: WhatsAppSession
    ): Promise<void> {
        const selectedDate = session.data?.requestDate;
        const choice = message.text?.trim() || "";
        const windows = this.getTimeWindowOptionsForDate(selectedDate);

        const selected = windows.find(
            (w) => w.id === choice || w.value.toLowerCase() === choice.toLowerCase()
        );

        if (!selected) {
            const list = windows.map((w) => `${w.id}. ${w.value}`).join("\n");
            await this.whatsappClient.sendTextMessage(
                phone,
                `Please choose a valid collection window:\n\n${list}`
            );
            return;
        }

        await this.updateSession(phone, "REQUEST_CONFIRM", {
            latitude: session.data?.latitude,
            longitude: session.data?.longitude,
            address: session.data?.address,
            locationType: session.data?.locationType,
            requestDate: selectedDate,
            requestTimeWindow: selected.value
        });

        await this.whatsappClient.sendTextMessage(
            phone,
            `📍 Location: ${session.data?.address || "Verified"}\n📅 Date: ${selectedDate}\n🕐 Window: ${selected.value}\n\nIs this correct?`
        );

        await this.whatsappClient.sendInteractiveButtonMessage(
            phone,
            "Please confirm your home collection request details:",
            [
                { id: BUTTON_IDS.CONFIRMATION.YES, title: "Yes, Confirm" },
                { id: BUTTON_IDS.CONFIRMATION.NO, title: "No, Change" }
            ]
        );
    }

    /**
     * Offer a new request to every configured collector; first to accept wins.
     */
    private async notifyCollectors(
        requestId: string,
        locationData: any,
        clinicId: string
    ): Promise<void> {
        const collectors = await getCollectorsForClinic(this.supabase, clinicId);

        if (collectors.length === 0) {
            debug("homeCollectionFlow", "No collectors configured to notify", { requestId });
            return;
        }

        const summary =
            "New home collection request\n\n" +
            `Address: ${locationData?.address || "Not provided"}\n` +
            `Date: ${locationData?.requestDate || "As soon as possible"}\n` +
            `Window: ${locationData?.requestTimeWindow || "Any"}\n\n` +
            "First collector to accept is assigned.";

        for (const collector of collectors) {
            try {
                await this.whatsappClient.sendInteractiveButtonMessage(collector.phone, summary, [
                    { id: `${BUTTON_IDS.HOME_COLLECTION_MENU.CONFIRM}:${requestId}`, title: "Accept" },
                    { id: `${BUTTON_IDS.HOME_COLLECTION_MENU.REJECT}:${requestId}`, title: "Reject" }
                ]);
            } catch (error) {
                // One unreachable collector must not stop the rest being offered the job.
                debug("homeCollectionFlow", "Failed to notify collector", {
                    collector: collector.phone,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    /**
     * Handle a collector accepting or rejecting a dispatched request.
     */
    private async handleCollectionOffer(phone: string, raw: string): Promise<void> {
        const separator = raw.indexOf(":");
        const action = raw.substring(0, separator);
        const requestId = raw.substring(separator + 1).trim();

        if (!requestId) {
            await this.whatsappClient.sendTextMessage(phone, "That request reference is not valid.");
            return;
        }

        if (action === BUTTON_IDS.HOME_COLLECTION_MENU.REJECT) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "Noted. This collection has not been assigned to you."
            );
            return;
        }

        // The status filter makes the claim atomic: only one collector can win.
        // The clinic filter stops a collector claiming another clinic's job.
        const { data: pending } = await this.supabase
            .from("home_collection_requests")
            .select("id, requested_date, status")
            .eq("id", requestId)
            .eq("clinic_id", this.clinicId)
            .maybeSingle();

        if (!pending) {
            await this.whatsappClient.sendTextMessage(phone, "That collection request no longer exists.");
            return;
        }

        const dailyLimit = getMaxCollectionsPerCollectorPerDay();
        const { count: assignedToday } = await this.supabase
            .from("home_collection_requests")
            .select("id", { count: "exact", head: true })
            .eq("clinic_id", this.clinicId)
            .eq("assigned_technician_name", phone)
            .eq("requested_date", pending.requested_date)
            .neq("status", "CANCELLED");

        if ((assignedToday || 0) >= dailyLimit) {
            await this.whatsappClient.sendTextMessage(
                phone,
                `You already have ${assignedToday} collections on ${pending.requested_date}, which is your daily limit of ${dailyLimit}.`
            );
            return;
        }

        const { data, error } = await this.supabase
            .from("home_collection_requests")
            .update({
                status: "ASSIGNED",
                assigned_technician_name: phone,
                updated_at: new Date().toISOString()
            })
            .eq("id", requestId)
            .eq("clinic_id", this.clinicId)
            .eq("status", "PENDING")
            .select("id, service_address, requested_date")
            .maybeSingle();

        if (error) {
            debug("homeCollectionFlow", "Error assigning collection", { error: error.message });
            await this.whatsappClient.sendTextMessage(
                phone,
                "Could not assign this collection. Please try again."
            );
            return;
        }

        if (!data) {
            await this.whatsappClient.sendTextMessage(
                phone,
                "This collection has already been taken by another collector."
            );
            return;
        }

        await this.whatsappClient.sendTextMessage(
            phone,
            `You are assigned to this collection.\n\nAddress: ${data.service_address}\nDate: ${data.requested_date}`
        );
    }

    private async createHomeCollectionRequest(
        phone: string,
        locationData: any,
        clinicId: string
    ): Promise<{ success: boolean; requestId?: string; error?: string }> {
        try {
            const collectionDate = locationData?.requestDate || new Date().toISOString().split("T")[0];

            // Call Supabase to create home collection request
            const { data, error } = await this.supabase
                .from("home_collection_requests")
                .insert({
                    clinic_id: clinicId,
                    patient_phone: phone,
                    service_address: locationData?.address || null,
                    latitude: locationData?.latitude ?? null,
                    longitude: locationData?.longitude ?? null,
                    requested_date: collectionDate,
                    requested_time_window: locationData?.requestTimeWindow || null,
                    status: "PENDING",
                    preferred_language: locationData?.language || "EN"
                })
                .select("id")
                .single();

            if (error) {
                debug("homeCollectionFlow", "Error creating home collection request", {
                    error: error.message
                });

                return {
                    success: false,
                    error: error.message
                };
            }

            const requestId = data.id as string;

            debug("homeCollectionFlow", "Created home collection request", { requestId });

            // Create reminder for collection date (fire at 08:00 AM on that day)
            try {
                await createHomeCollectionReminder(
                    this.supabase,
                    clinicId,
                    requestId,
                    collectionDate,
                    phone,
                    locationData?.language || "EN"
                );
                debug("homeCollectionFlow", "Reminder created for collection request", { requestId });
            } catch (reminderError) {
                // Log but don't fail the request - reminder creation is not critical
                debug("homeCollectionFlow", "Warning: Failed to create reminder", {
                    error: reminderError instanceof Error ? reminderError.message : String(reminderError),
                    requestId
                });
            }

            return { success: true, requestId };
        } catch (error) {
            debug("homeCollectionFlow", "Error creating home collection request", {
                error: error instanceof Error ? error.message : String(error)
            });

            return {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Helper: Get request status from Supabase
     */
    private async getRequestStatus(
        requestId: string,
        clinicId: string
    ): Promise<{ status: string; eta?: string; technician?: string } | null> {
        try {
            const { data, error } = await this.supabase
                .from("home_collection_requests")
                .select("*")
                .eq("request_id", requestId)
                .eq("clinic_id", clinicId)
                .maybeSingle();

            if (error || !data) {
                debug("homeCollectionFlow", "Error fetching request status", {
                    error: error?.message || "Not found"
                });

                return null;
            }

            return {
                status: data.status,
                eta: data.eta || "Pending",
                technician: data.assigned_technician || undefined
            };
        } catch (error) {
            debug("homeCollectionFlow", "Error fetching request status", {
                error: error instanceof Error ? error.message : String(error)
            });

            return null;
        }
    }

    /**
     * Helper: Format status message for display
     */
    private formatStatusMessage(status: any): string {
        let message = `📊 Request Status:\n\n`;

        switch (status.status) {
            case "PENDING":
                message += `⏳ Status: Pending\nOur team will contact you within ${status.eta}\n\n`;
                message += `Your request is in queue. Thank you for your patience.`;
                break;

            case "ASSIGNED":
                message += `👤 Status: Assigned\nTechnician: ${status.technician}\nETA: ${status.eta}\n\n`;
                message += `You will receive a call shortly with exact arrival time.`;
                break;

            case "ON_THE_WAY":
                message += `🚗 Status: On the Way\nTechnician: ${status.technician}\nETA: ${status.eta}\n\n`;
                message += `Please ensure someone is home to receive the collection.`;
                break;

            case "COMPLETED":
                message += `✅ Status: Completed\nTechnician: ${status.technician}\n\n`;
                message += `Your sample has been collected. Results will be available in 24-48 hours.`;
                break;

            case "CANCELLED":
                message += `❌ Status: Cancelled\n\n`;
                message += `This request has been cancelled. Contact us for assistance.`;
                break;

            default:
                message += `Status: ${status.status}\nETA: ${status.eta || "TBD"}\n\n`;
                message += `For more information, contact our team.`;
        }

        return message;
    }

    /**
     * Helper: Show request confirmation with button menu
     */
    private async showRequestConfirmation(phone: string, data: any): Promise<void> {
        let address = data?.address || `Coordinates: ${data?.latitude}, ${data?.longitude}`;

        const message = `Please confirm your home collection request:\n\n📍 Address: ${address}\n\nWe will visit you within 2-4 hours for blood collection.\n\nConfirm this request?`;

        await this.whatsappClient.sendInteractiveButtonMessage(phone, message, [
            { id: BUTTON_IDS.CONFIRMATION.YES, title: "Yes, Confirm" },
            { id: BUTTON_IDS.CONFIRMATION.NO, title: "No, Change" }
        ]);
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
            .eq("phone", phone)
            .eq("clinic_id", this.clinicId);

        if (error) {
            debug("homeCollectionFlow", "Error updating session", { error: error.message });
        }
    }

    /**
     * Helper: Format date as YYYY-MM-DD
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }
}
