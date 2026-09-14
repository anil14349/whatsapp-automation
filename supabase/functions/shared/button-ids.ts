/**
 * WhatsApp Button ID Constants
 * Used for interactive menu selections
 */

export const BUTTON_IDS = {
    // Language selection (6 languages)
    LANGUAGE: {
        EN: "lang_en",
        TE: "lang_te",
        HI: "lang_hi",
        KN: "lang_kn",
        TA: "lang_ta",
        ML: "lang_ml",
    },
    
    // Patient main menu
    PATIENT_MENU: {
        BOOK: "menu_book",
        APPOINTMENTS: "menu_appointments",
        CANCEL: "menu_cancel",
        RESCHEDULE: "menu_reschedule",
    },
    
    // Confirmation
    CONFIRMATION: {
        YES: "confirm_yes",
        NO: "confirm_no",
        BACK: "go_back",
    },
    
    // Doctor menu
    DOCTOR_MENU: {
        AVAILABILITY: "doctor_availability",
        LEAVE: "doctor_leave",
        APPOINTMENTS: "doctor_appointments",
        CANCEL: "doctor_cancel",
    },
    
    // Home collection menu
    HOME_COLLECTION_MENU: {
        CONFIRM: "collection_confirm",
        REJECT: "collection_reject",
    },
} as const;

/**
 * Check if a button ID is valid for patient menu
 */
export function isValidPatientMenuButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.PATIENT_MENU).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for language selection
 */
export function isValidLanguageButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.LANGUAGE).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for confirmation
 */
export function isValidConfirmationButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.CONFIRMATION).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for doctor menu
 */
export function isValidDoctorMenuButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.DOCTOR_MENU).includes(buttonId as any);
}
