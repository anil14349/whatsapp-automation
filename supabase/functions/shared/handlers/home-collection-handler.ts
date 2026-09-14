import { SupabaseClient } from "@supabase/supabase-js";
import { WhatsAppSession, ExtractedMessage } from "../types.ts";
import MultiClinicSupabaseClient from "../multi-clinic-supabase-client.ts";
import { BUTTON_IDS, isValidConfirmationButton } from "../button-ids.ts";
import { debug } from "../logger.ts";

/**
 * Home Collection Handler - Manages blood collection requests
 * Handles: location verification, request submission, status tracking
 * Used by sample collection personnel only
 */

export class HomeCollectionHandler {
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
            const state = session.state || "LOCATION_SELECT";
            const phone = session.phone;

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
                "Please share your location or type your address for home blood collection.\n\nYou can:\n1️⃣ Share location via WhatsApp\n2️⃣ Type your address"
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
                // Location confirmed, move to request confirmation
                await this.updateSession(phone, "REQUEST_CONFIRM", {
                    latitude: session.data?.latitude,
                    longitude: session.data?.longitude,
                    address: session.data?.address,
                    locationType: session.data?.locationType
                });

                await this.showRequestConfirmation(phone, session.data);
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
     */
    private async createHomeCollectionRequest(
        phone: string,
        locationData: any,
        clinicId: string
    ): Promise<{ success: boolean; requestId?: string; error?: string }> {
        try {
            const requestId = `HC_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Call Supabase to create home collection request
            const { error } = await this.supabase.from("home_collection_requests").insert({
                request_id: requestId,
                clinic_id: clinicId,
                phone,
                address: locationData?.address || null,
                latitude: locationData?.latitude || null,
                longitude: locationData?.longitude || null,
                location_type: locationData?.locationType || "TEXT",
                status: "PENDING",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            });

            if (error) {
                debug("homeCollectionFlow", "Error creating home collection request", {
                    error: error.message
                });

                return {
                    success: false,
                    error: error.message
                };
            }

            debug("homeCollectionFlow", "Created home collection request", { requestId });

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
            .eq("phone", phone);

        if (error) {
            debug("homeCollectionFlow", "Error updating session", { error: error.message });
        }
    }
}
