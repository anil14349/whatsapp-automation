// ============================================================
// Util_QuickBooking — part of the ABC Clinic WhatsApp bot
// Show available slots upfront for faster 2-step booking (Doctor → Slot)
// ============================================================



// Get available slots for a doctor grouped by date
// Returns: {date: [time1, time2, ...], ...}
function getSlotsByDoctor(doctorId) {

    const slots = {};

    // Get current + next 7 days
    const today = new Date();

    for (
        let dayOffset = 0;
        dayOffset < 7;
        dayOffset++
    ) {

        const date = new Date(today);
        date.setDate(date.getDate() + dayOffset);

        const dateString =
            Utilities.formatDate(
                date,
                TIMEZONE,
                "yyyy-MM-dd"
            );

        const availableSlots =
            getAvailableSlots(
                doctorId,
                dateString
            );

        if (
            availableSlots &&
            availableSlots.length > 0
        ) {

            slots[dateString] =
                availableSlots;
        }
    }

    return slots;
}



// Format slots for WhatsApp display (compact)
function formatSlotsForWhatsApp(doctorId) {

    const slots = getSlotsByDoctor(doctorId);

    if (
        !slots ||
        Object.keys(slots).length === 0
    ) {

        return "No available slots.";
    }

    let message =
        "📅 *Available Slots* (Next 7 Days)\n\n";

    let slotCount = 1;
    const slotMap = {}; // id → {date, time}

    for (
        const dateString in slots
    ) {

        if (!slots.hasOwnProperty(dateString)) {
            continue;
        }

        const dayName =
            Utilities.formatDate(
                new Date(dateString + "T00:00:00"),
                TIMEZONE,
                "EEE, MMM d"
            );

        message += "*" + dayName + "*\n";

        const daySlots = slots[dateString];

        for (
            let i = 0;
            i < daySlots.length;
            i++
        ) {

            const slotId = String(slotCount);
            const time = daySlots[i];

            slotMap[slotId] = {
                date: dateString,
                time: time
            };

            message +=
                slotId + ". " + time + "\n";

            slotCount++;
        }

        message += "\n";
    }

    return {
        message: message,
        slotMap: slotMap,
        totalSlots: slotCount - 1
    };
}



// ========================================================
// SHARED SLOT INDEXING
// ========================================================
// Build indexed list of slots to avoid code duplication
// Returns: [{id, date, time, dayName}, ...]
function buildSlotIndex(slots) {

    if (!slots || Object.keys(slots).length === 0) {
        return [];
    }

    const index = [];

    for (
        const dateString in slots
    ) {

        if (!slots.hasOwnProperty(dateString)) {
            continue;
        }

        const daySlots = slots[dateString];

        const dayName =
            Utilities.formatDate(
                new Date(dateString + "T00:00:00"),
                TIMEZONE,
                "EEE, MMM d"
            );

        for (
            let i = 0;
            i < daySlots.length;
            i++
        ) {

            index.push({
                id: String(index.length + 1),
                date: dateString,
                time: daySlots[i],
                dayName: dayName
            });
        }
    }

    return index;
}



// Create quick booking menu (slot selection)
function buildQuickBookingMenu(doctorId) {

    const slots = getSlotsByDoctor(doctorId);

    if (
        !slots ||
        Object.keys(slots).length === 0
    ) {

        return {
            success: false,
            message: "No available slots for this doctor."
        };
    }

    // ========================================================
    // USE SHARED SLOT INDEXING
    // ========================================================
    // Reuse buildSlotIndex to avoid duplicating iteration logic

    const slotIndex = buildSlotIndex(slots);

    const menuRows = slotIndex.map(function (slot) {

        return {
            id: slot.id,
            title: slot.dayName + " @ " + slot.time,
            description: "Book this slot"
        };
    });

    return {
        success: true,
        rows: menuRows,
        rowCount: menuRows.length
    };
}



// Parse quick booking slot selection and book directly
function quickBookAppointment(
    doctorId,
    patientPhone,
    patientName,
    patientLanguage,
    slotSelection
) {

    const slots = getSlotsByDoctor(doctorId);

    if (!slots) {

        return {
            success: false,
            message: "No available slots."
        };
    }

    // ========================================================
    // USE SHARED SLOT INDEXING
    // ========================================================
    // Reuse buildSlotIndex to find the selected slot

    const slotIndex = buildSlotIndex(slots);

    const selectedSlot = slotIndex.find(function (slot) {

        return String(slot.id) === String(slotSelection).trim();
    });

    if (!selectedSlot) {

        return {
            success: false,
            message:
                "Invalid slot selection."
        };
    }

    // Book the appointment directly
    return bookAppointment(
        doctorId,
        selectedSlot.date,
        selectedSlot.time,
        patientName,
        patientPhone,
        patientLanguage
    );
}
