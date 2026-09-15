/**
 * Deliver staff credentials over WhatsApp.
 *
 * Staff are already identified by their WhatsApp number, so this avoids the
 * email dependency entirely. Delivery is best-effort: Meta only permits
 * free-form messages within 24 hours of the person's last inbound message, and
 * outside that window the send is rejected. Callers must handle a false result
 * by showing the credential to the admin instead.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { WhatsAppClient } from "./whatsapp-client.ts";
import { getClinicRouteById } from "./clinic-routing.ts";
import { debug } from "./logger.ts";

/** Meta's code for "outside the 24 hour customer service window". */
const OUTSIDE_WINDOW = "131047";

export interface DeliveryResult {
    delivered: boolean;
    reason?: "no_phone" | "no_credentials" | "outside_window" | "send_failed";
}

function credentialMessage(
    name: string,
    credential: string,
    kind: "PIN" | "password",
    clinicName: string
): string {
    return [
        `🔐 ${clinicName} portal`,
        ``,
        `Hello ${name}, a new ${kind} has been issued for you:`,
        ``,
        `${credential}`,
        ``,
        `Please sign in and change it straight away. If you did not expect this, contact your clinic administrator.`
    ].join("\n");
}

export async function sendCredentialOverWhatsApp(
    supabase: SupabaseClient,
    clinicId: string,
    phone: string | null | undefined,
    name: string,
    credential: string,
    kind: "PIN" | "password"
): Promise<DeliveryResult> {
    if (!phone) {
        return { delivered: false, reason: "no_phone" };
    }

    const route = await getClinicRouteById(supabase, clinicId);

    if (!route) {
        return { delivered: false, reason: "no_credentials" };
    }

    const client = new WhatsAppClient(route.accessToken, route.phoneNumberId);

    try {
        await client.sendTextMessage(
            phone,
            credentialMessage(name, credential, kind, route.clinicName),
            supabase
        );

        return { delivered: true };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes(OUTSIDE_WINDOW) || message.includes("24 hours")) {
            debug("credentialDelivery", "Outside the 24 hour window", { phone });
            return { delivered: false, reason: "outside_window" };
        }

        debug("credentialDelivery", "Send failed", { phone, error: message });
        return { delivered: false, reason: "send_failed" };
    }
}
