import { SupabaseClient, createClient } from "@supabase/supabase-js";
import {
    bookAppointment,
    cancelAppointment,
    rescheduleAppointment,
    getAvailableSlots,
    AppointmentRequest,
    AppointmentResponse
} from "../shared/appointments.ts";
import { logWhatsAppMessage, logError } from "../shared/logger.ts";

/**
 * Appointment API Handler
 * POST /api/appointments - Book appointment
 * GET /api/appointments - Get user appointments
 * DELETE /api/appointments/:id - Cancel appointment
 * PUT /api/appointments/:id - Reschedule appointment
 */

// Initialize Supabase client
const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Create a mock WhatsApp client
const whatsappClient = {
    sendTextMessage: async (phone: string, message: string) => {
        console.log(`[WhatsApp] ${phone}: ${message}`);
    }
};

/**
 * Main request handler
 */
export async function handleAppointmentRequest(req: Request): Promise<Response> {
    try {
        const url = new URL(req.url);
        const method = req.method;
        const path = url.pathname;

        // Route to appropriate handler
        if (method === "POST" && path === "/api/appointments") {
            return await handleBookAppointment(req);
        } else if (method === "GET" && path === "/api/appointments") {
            return await handleGetAppointments(req);
        } else if (method === "GET" && path.match(/^\/api\/appointments\/(.+)$/)) {
            const appointmentId = path.split("/").pop()!;
            if (url.searchParams.get("action") === "available-slots") {
                return await handleGetAvailableSlots(req);
            } else {
                return await handleGetAppointment(req, appointmentId);
            }
        } else if (method === "DELETE" && path.match(/^\/api\/appointments\/(.+)$/)) {
            const appointmentId = path.split("/").pop()!;
            return await handleCancelAppointment(req, appointmentId);
        } else if (method === "PUT" && path.match(/^\/api\/appointments\/(.+)$/)) {
            const appointmentId = path.split("/").pop()!;
            return await handleRescheduleAppointment(req, appointmentId);
        } else {
            return new Response(JSON.stringify({ error: "Not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" }
            });
        }
    } catch (error) {
        await logError(supabase, error instanceof Error ? error : new Error(String(error)), {
            context: "appointmentAPI"
        });

        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}

/**
 * Handle booking an appointment
 * POST /api/appointments
 */
async function handleBookAppointment(req: Request): Promise<Response> {
    try {
        const body = await req.json();

        const request: AppointmentRequest = {
            patientPhone: body.patientPhone || body.phone,
            patientName: body.patientName || body.name,
            doctorId: body.doctorId,
            date: body.date,
            time: body.time,
            notes: body.notes
        };

        // Book appointment
        const result = await bookAppointment(supabase, whatsappClient, request);

        return new Response(JSON.stringify(result), {
            status: result.success ? 201 : 400,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                message: "Failed to book appointment",
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}

/**
 * Handle getting patient appointments
 * GET /api/appointments?phone=919876543210
 */
async function handleGetAppointments(req: Request): Promise<Response> {
    try {
        const url = new URL(req.url);
        const phone = url.searchParams.get("phone");

        if (!phone) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Phone number required"
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }

        // TODO: Fetch appointments from Google Sheets for this phone
        // For now, return empty list
        const appointments: any[] = [];

        return new Response(JSON.stringify({ success: true, appointments }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}

/**
 * Handle getting single appointment
 * GET /api/appointments/:id
 */
async function handleGetAppointment(req: Request, appointmentId: string): Promise<Response> {
    try {
        // TODO: Fetch appointment from Google Sheets
        const appointment = null;

        if (!appointment) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Appointment not found"
                }),
                {
                    status: 404,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }

        return new Response(JSON.stringify({ success: true, appointment }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}

/**
 * Handle cancelling appointment
 * DELETE /api/appointments/:id
 */
async function handleCancelAppointment(
    req: Request,
    appointmentId: string
): Promise<Response> {
    try {
        const body = await req.json().catch(() => ({}));
        const reason = body.reason;

        const result = await cancelAppointment(supabase, appointmentId, reason);

        return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}

/**
 * Handle rescheduling appointment
 * PUT /api/appointments/:id
 */
async function handleRescheduleAppointment(
    req: Request,
    appointmentId: string
): Promise<Response> {
    try {
        const body = await req.json();
        const { date, time } = body;

        if (!date || !time) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Date and time required"
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }

        const result = await rescheduleAppointment(supabase, appointmentId, date, time);

        return new Response(JSON.stringify(result), {
            status: result.success ? 200 : 400,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}

/**
 * Handle getting available slots
 * GET /api/appointments/slots?doctorId=D001&date=2026-09-15
 */
async function handleGetAvailableSlots(req: Request): Promise<Response> {
    try {
        const url = new URL(req.url);
        const doctorId = url.searchParams.get("doctorId");
        const date = url.searchParams.get("date");

        if (!doctorId || !date) {
            return new Response(
                JSON.stringify({
                    success: false,
                    error: "Doctor ID and date required"
                }),
                {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                }
            );
        }

        const slots = await getAvailableSlots(doctorId, date);

        return new Response(JSON.stringify({ success: true, slots }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    } catch (error) {
        return new Response(
            JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error)
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
}
