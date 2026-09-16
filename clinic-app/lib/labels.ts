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
