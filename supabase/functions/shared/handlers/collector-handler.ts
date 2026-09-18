/**
 * What a sample collector does on WhatsApp.
 *
 * The flow they had was the patient's own request flow: saying "hi" asked the
 * collector to book a home collection for themselves, took a typed address
 * with no distance check, and wrote it to a table no screen reads. It served
 * a patient path that no longer exists.
 *
 * A collector needs two things: the visits waiting for them, and a way to say
 * one is done. Both come from `appointments`, which is where a home sample
 * collection is now booked, so there is no second store to keep in step.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ExtractedMessage, WhatsAppSession } from "../types.ts";
import { BUTTON_IDS } from "../button-ids.ts";
import { formatClockTime, formatLongDate } from "../appointment-format.ts";
import { getClinicTimezone, todayInTimezone } from "../clinic-slots.ts";
import { getCollectorsForClinic } from "../staff-directory.ts";
import { isHomeVisit } from "../location-type.ts";
import { debug, recordAuditEvent } from "../logger.ts";

/** Row ids carry the appointment, which is per clinic and cannot be listed up front. */
const VISIT_PREFIX = "visit_";

export function visitButtonId(appointmentId: string): string {
    return `${VISIT_PREFIX}${appointmentId}`;
}

export function isVisitButton(id: string): boolean {
    return id.startsWith(VISIT_PREFIX);
}

export function visitIdFromButton(id: string): string {
    return id.slice(VISIT_PREFIX.length);
}

export class CollectorFlowHandler {
    constructor(
        private supabase: SupabaseClient,
        private whatsappClient: any
    ) {}

    async handle(session: WhatsAppSession, message: ExtractedMessage): Promise<void> {
        const phone = session.phone;
        const reply = (message.text || "").trim();

        try {
            if (session.state === "COLLECTOR_CONFIRM" && session.data?.selectedVisitId) {
                await this.handleConfirm(session, reply);
                return;
            }

            if (isVisitButton(reply)) {
                await this.askToConfirm(session, visitIdFromButton(reply));
                return;
            }

            await this.showTodaysVisits(session);
        } catch (error) {
            debug("collectorFlow", "Failed", {
                phone,
                error: error instanceof Error ? error.message : String(error)
            });

            await this.whatsappClient.sendTextMessage(
                phone,
                "Sorry, something went wrong. Please try again."
            );
        }
    }

    /** Who is messaging, so a round can be theirs rather than the clinic's. */
    private async me(phone: string, clinicId: string): Promise<string | null> {
        const collectors = await getCollectorsForClinic(this.supabase, clinicId);
        return collectors.find((c) => c.phone === phone)?.id ?? null;
    }

    /**
     * Home visits still to do today: this collector's own, plus anything
     * nobody was free to take. Unclaimed work has to be visible to someone.
     */
    private async todaysVisits(clinicId: string, collectorId: string | null): Promise<any[]> {
        const today = todayInTimezone(await getClinicTimezone(this.supabase, clinicId));

        const { data, error } = await this.supabase
            .from("appointments")
            .select("id, patient_name, appointment_time, service_address, location_type, status, collector_id, service_type:service_types(name)")
            .eq("clinic_id", clinicId)
            .eq("appointment_date", today)
            .eq("status", "CONFIRMED")
            .order("appointment_time", { ascending: true });

        if (error) {
            debug("collectorFlow", "Could not load today's visits", { error: error.message });
            return [];
        }

        // Filtered here rather than in the query: location_type has been spelt
        // both ways, and isHomeVisit is the one place that knows.
        return (data ?? [])
            .filter((row: any) => isHomeVisit(row.location_type))
            .filter((row: any) => !row.collector_id || row.collector_id === collectorId);
    }

    private async showTodaysVisits(session: WhatsAppSession): Promise<void> {
        const mine = await this.me(session.phone, session.clinic_id);
        const visits = await this.todaysVisits(session.clinic_id, mine);

        await this.update(session.phone, session.clinic_id, "COLLECTOR_MENU", {});

        if (visits.length === 0) {
            await this.whatsappClient.sendTextMessage(
                session.phone,
                "📋 No home collections booked for you today.\n\nMessage me again to check later.",
                this.supabase
            );
            return;
        }

        // Ten rows is Meta's limit, so a busy day shows the earliest nine.
        const shown = visits.slice(0, 9);

        const rows = shown.map((visit: any) => ({
            id: visitButtonId(visit.id),
            title: `${formatClockTime(visit.appointment_time)} · ${visit.patient_name}`.slice(0, 24),
            description: (
                (visit.collector_id ? "" : "Unassigned · ") +
                (visit.service_address || visit.service_type?.name || "Home visit")
            ).slice(0, 72)
        }));

        const more = visits.length > shown.length
            ? `\n\n${visits.length - shown.length} more after these.`
            : "";

        await this.whatsappClient.sendInteractiveListMessage(
            session.phone,
            `🏠 Home collections today${more}`,
            "Choose one",
            [{ title: "Today", rows }],
            this.supabase
        );
    }

    private async askToConfirm(session: WhatsAppSession, appointmentId: string): Promise<void> {
        const mine = await this.me(session.phone, session.clinic_id);
        const visits = await this.todaysVisits(session.clinic_id, mine);
        // Resolved against the list this collector was actually shown, so a
        // stale tap cannot reach another round or another clinic.
        const visit = visits.find((row: any) => row.id === appointmentId);

        if (!visit) {
            await this.showTodaysVisits(session);
            return;
        }

        await this.update(session.phone, session.clinic_id, "COLLECTOR_CONFIRM", {
            selectedVisitId: visit.id
        });

        const where = visit.service_address ? `\n📍 ${visit.service_address}` : "";

        await this.whatsappClient.sendInteractiveButtonMessage(
            session.phone,
            `Mark this collection as done?\n\n👤 ${visit.patient_name}\n🕐 ${formatClockTime(visit.appointment_time)}${where}`,
            [
                { id: BUTTON_IDS.CONFIRMATION.YES, title: "Yes, collected" },
                { id: BUTTON_IDS.CONFIRMATION.NO, title: "Not yet" }
            ],
            this.supabase
        );
    }

    private async handleConfirm(session: WhatsAppSession, reply: string): Promise<void> {
        if (reply !== BUTTON_IDS.CONFIRMATION.YES) {
            await this.showTodaysVisits(session);
            return;
        }

        const appointmentId = String(session.data?.selectedVisitId);
        const mine = await this.me(session.phone, session.clinic_id);

        // Checked here rather than as a filter on the update: the list this
        // collector was shown is already "mine or unclaimed", so re-finding it
        // there is the whole ownership rule in one place.
        const visits = await this.todaysVisits(session.clinic_id, mine);
        const visit = visits.find((row: any) => row.id === appointmentId);

        if (!visit) {
            await this.whatsappClient.sendTextMessage(
                session.phone,
                "That one is not on your round any more.",
                this.supabase
            );
            await this.showTodaysVisits(session);
            return;
        }

        // Closing an unclaimed visit claims it, so the round shows who went.
        const { data, error } = await this.supabase
            .from("appointments")
            .update({
                status: "COMPLETED",
                completed_at: new Date().toISOString(),
                ...(mine ? { collector_id: mine } : {})
            })
            .eq("id", appointmentId)
            .eq("clinic_id", session.clinic_id)
            .eq("status", "CONFIRMED")
            .select("id, patient_name")
            .maybeSingle();

        if (error || !data) {
            await this.whatsappClient.sendTextMessage(
                session.phone,
                "That one could not be updated. It may already be closed.",
                this.supabase
            );
            await this.showTodaysVisits(session);
            return;
        }

        await recordAuditEvent(
            this.supabase,
            "HOME_COLLECTION_COMPLETED",
            session.phone,
            "appointment",
            appointmentId
        );

        await this.whatsappClient.sendTextMessage(
            session.phone,
            `✅ Marked as collected for ${data.patient_name}.`,
            this.supabase
        );

        await this.showTodaysVisits(session);
    }

    private async update(
        phone: string,
        clinicId: string,
        state: string,
        data: Record<string, unknown>
    ): Promise<void> {
        await this.supabase
            .from("whatsapp_sessions")
            .update({ state, data, updated_at: new Date().toISOString() })
            .eq("phone", phone)
            .eq("clinic_id", clinicId);
    }
}
