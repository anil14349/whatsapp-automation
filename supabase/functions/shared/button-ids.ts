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
        HOME_COLLECTION: "menu_home_collection",
        MORE: "menu_more",
        CHANGE_LANGUAGE: "menu_change_language",
        MAIN_MENU: "menu_main",
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
        MARK_STATUS: "doctor_mark_status",
        LOGOUT: "doctor_logout",
    },
    
    // Home collection menu
    HOME_COLLECTION_MENU: {
        CONFIRM: "collection_confirm",
        REJECT: "collection_reject",
    },

    // Date selection
    DATE_SELECT: {
        TODAY: "date_today",
        TOMORROW: "date_tomorrow",
        OTHER: "date_other",
    },

    // Paging through lists that exceed WhatsApp's 10-row limit
    PAGINATION: {
        MORE_DOCTORS: "doctors_more",
        MORE_SLOTS: "slots_more",
    },

    // Location type (Clinic vs Home)
    LOCATION_TYPE: {
        CLINIC: "loc_clinic",
        HOME: "loc_home",
    },

    // Time window for home collection
    TIME_WINDOW: {
        MORNING: "time_morning",
        AFTERNOON: "time_afternoon",
        EVENING: "time_evening",
    },

    // Doctor appointment status
    APPOINTMENT_STATUS: {
        COMPLETED: "status_completed",
        NO_SHOW: "status_noshow",
    },

    // Navigation
    NAVIGATION: {
        MORE: "nav_more",
        EARLIER: "nav_earlier",
        MAIN_MENU: "nav_menu",
        BACK: "nav_back",
    },

    // Generic actions
    ACTION: {
        NEXT: "action_next",
        PREVIOUS: "action_prev",
        SELECT: "action_select",
        SKIP: "action_skip",
    },
} as const;

/**
 * Check if a button ID is valid for patient menu
 */
export function isValidPatientMenuButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.PATIENT_MENU).includes(buttonId as any);
}

/**
 * Check if a button ID is one of the declared language IDs.
 *
 * Declared is not the same as supported: use isSupportedLanguageButton()
 * from languages.ts to gate user input, otherwise an untranslated language
 * is accepted and silently served in the fallback language.
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

/**
 * Check if a button ID is valid for date selection
 */
export function isValidDateSelectButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.DATE_SELECT).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for location type
 */
export function isValidLocationTypeButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.LOCATION_TYPE).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for time window
 */
export function isValidTimeWindowButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.TIME_WINDOW).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for appointment status
 */
export function isValidStatusButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.APPOINTMENT_STATUS).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for navigation
 */
export function isValidNavigationButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.NAVIGATION).includes(buttonId as any);
}

/**
 * Check if a button ID is valid for home collection
 */
export function isValidHomeCollectionButton(buttonId: string): boolean {
    return Object.values(BUTTON_IDS.HOME_COLLECTION_MENU).includes(buttonId as any);
}
