/**
 * What staff are called on screen.
 *
 * The role values themselves are untouched: CLINIC_OWNER and the platform-wide
 * ADMIN must stay distinguishable in code, because one runs a clinic and the
 * other can see every clinic.
 */

export const ROLE_LABELS: Record<string, string> = {
    ADMIN: "Platform admin",
    CLINIC_OWNER: "Admin",
    RECEPTIONIST: "Receptionist",
    DOCTOR: "Doctor"
};

export function roleLabel(role: string): string {
    return ROLE_LABELS[role] ?? role.toLowerCase().replace(/_/g, " ");
}

export const STAFF_LABELS = {
    doctor: { plural: "Doctors", singular: "Doctor" },
    receptionist: { plural: "Receptionists", singular: "Receptionist" },
    collector: { plural: "Home Visit Staff", singular: "Home visit staff" }
} as const;

/**
 * The same words the summary uses, so a day and its totals agree.
 *
 * The table printed the raw enum, so a row read NO_SHOW while the summary
 * called the same thing something else.
 */
export const STATUS_LABELS: Record<string, string> = {
    CONFIRMED: "Booked",
    // Declared in the schema and read by the booking guards, but nothing
    // writes it: rescheduling moves the date and leaves the status alone. Named
    // here so it cannot arrive as a lower-case "rescheduled" among Title Case.
    RESCHEDULED: "Moved",
    COMPLETED: "Seen",
    NO_SHOW: "No-show",
    CANCELLED: "Cancelled"
};

export function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status.toLowerCase().replace(/_/g, " ");
}
