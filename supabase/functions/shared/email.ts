/**
 * Transactional email via Resend.
 *
 * Password reset was generating valid tokens and then only logging them, so
 * the flow could never complete. Sending is best-effort: a failure is logged
 * and reported to the caller, never thrown, so it cannot leak whether an
 * address exists.
 */

import { debug } from "./logger.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface EmailResult {
    sent: boolean;
    error?: string;
}

function fromAddress(): string {
    return Deno.env.get("EMAIL_FROM") || "Clinic Portal <onboarding@resend.dev>";
}

export async function sendEmail(
    to: string,
    subject: string,
    html: string,
    text: string
): Promise<EmailResult> {
    const apiKey = Deno.env.get("RESEND_API_KEY");

    if (!apiKey) {
        debug("email", "RESEND_API_KEY not configured, email not sent", { subject });
        return { sent: false, error: "email_not_configured" };
    }

    try {
        const response = await fetch(RESEND_ENDPOINT, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ from: fromAddress(), to: [to], subject, html, text })
        });

        if (!response.ok) {
            const body = await response.text();
            debug("email", "Resend rejected the message", { status: response.status, body });
            return { sent: false, error: `resend_${response.status}` };
        }

        debug("email", "Email sent", { subject });
        return { sent: true };
    } catch (error) {
        debug("email", "Email send failed", {
            error: error instanceof Error ? error.message : String(error)
        });
        return { sent: false, error: "send_failed" };
    }
}

function resetUrl(token: string, userType: string): string {
    const base = Deno.env.get("PORTAL_BASE_URL") || Deno.env.get("API_BASE_URL") || "";
    return `${base.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}&type=${userType}`;
}

/**
 * Password/PIN reset link.
 *
 * The token is shown as well as linked, because clinic staff often open the
 * portal on a different device from their email.
 */
export async function sendPasswordResetEmail(
    to: string,
    name: string,
    token: string,
    userType: "doctor" | "receptionist" | "admin",
    clinicName = "your clinic"
): Promise<EmailResult> {
    const credential = userType === "doctor" ? "PIN" : "password";
    const link = resetUrl(token, userType);

    const text = [
        `Hello ${name},`,
        ``,
        `We received a request to reset your ${clinicName} portal ${credential}.`,
        ``,
        `Reset code: ${token}`,
        link ? `Reset link: ${link}` : ``,
        ``,
        `This code expires in 1 hour. If you did not request it, you can ignore this email.`
    ]
        .filter(Boolean)
        .join("\n");

    const html = `
        <p>Hello ${name},</p>
        <p>We received a request to reset your ${clinicName} portal ${credential}.</p>
        <p><strong>Reset code:</strong> <code>${token}</code></p>
        ${link ? `<p><a href="${link}">Reset your ${credential}</a></p>` : ""}
        <p>This code expires in 1 hour. If you did not request it, you can ignore this email.</p>
    `;

    return sendEmail(to, `Reset your ${clinicName} portal ${credential}`, html, text);
}

/**
 * Invite sent when an admin creates a staff account.
 */
export async function sendStaffInviteEmail(
    to: string,
    name: string,
    role: "doctor" | "receptionist",
    temporaryCredential: string,
    clinicName = "your clinic"
): Promise<EmailResult> {
    const credential = role === "doctor" ? "PIN" : "password";

    const text = [
        `Hello ${name},`,
        ``,
        `An account has been created for you on the ${clinicName} portal.`,
        ``,
        `Temporary ${credential}: ${temporaryCredential}`,
        ``,
        `Please sign in and change it immediately.`
    ].join("\n");

    const html = `
        <p>Hello ${name},</p>
        <p>An account has been created for you on the ${clinicName} portal.</p>
        <p><strong>Temporary ${credential}:</strong> <code>${temporaryCredential}</code></p>
        <p>Please sign in and change it immediately.</p>
    `;

    return sendEmail(to, `Your ${clinicName} portal account`, html, text);
}
