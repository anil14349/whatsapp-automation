// ============================================================
// View_Menus — part of the ABC Clinic WhatsApp bot
// Interactive WhatsApp list/button menu spec builders.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================



function truncateInteractiveLabel(
    text,
    maxLength
) {

    const value =
        String(text || "").trim();

    if (value.length <= maxLength) {
        return value;
    }

    if (maxLength <= 1) {
        return value.substring(0, maxLength);
    }

    return (
        value.substring(0, maxLength - 1) +
        "…"
    );
}



function buildInteractiveListSpec(
    rows,
    buttonLabel
) {

    if (
        !rows ||
        rows.length === 0 ||
        rows.length > 10
    ) {
        return null;
    }

    return {
        type: "list",
        buttonLabel:
            truncateInteractiveLabel(
                buttonLabel || "Choose",
                20
            ),
        sections: [
            {
                title: "Options",
                rows: rows.map(function (row) {
                    return {
                        id: String(row.id),
                        title:
                            truncateInteractiveLabel(
                                row.title,
                                24
                            ),
                        description:
                            truncateInteractiveLabel(
                                row.description || "",
                                72
                            )
                    };
                })
            }
        ]
    };
}



function buildInteractiveButtonSpec(buttons) {

    if (
        !buttons ||
        buttons.length === 0 ||
        buttons.length > 3
    ) {
        return null;
    }

    return {
        type: "button",
        buttons: buttons.map(function (button) {
            return {
                id: String(button.id),
                title:
                    truncateInteractiveLabel(
                        button.title,
                        20
                    )
            };
        })
    };
}



function getPatientMainMenuSpec() {

    const fallbackText =
        "1️⃣ Book Appointment\n" +
        "2️⃣ My Appointments\n" +
        "3️⃣ Cancel Appointment\n" +
        "4️⃣ Reschedule Appointment\n" +
        "5️⃣ Change Language";

    const interactive =
        buildInteractiveListSpec(
            [
                {
                    id: "1",
                    title: "Book Appointment",
                    description: "Schedule a visit"
                },
                {
                    id: "2",
                    title: "My Appointments",
                    description: "View upcoming"
                },
                {
                    id: "3",
                    title: "Cancel Appointment",
                    description: "Cancel a booking"
                },
                {
                    id: "4",
                    title: "Reschedule",
                    description: "Change date or time"
                },
                {
                    id: "5",
                    title: "Change Language",
                    description: "EN / TE / HI / KA / TA / ML"
                }
            ],
            "Choose option"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorMainMenuSpec() {

    const fallbackText =
        "1️⃣ Today's Schedule\n" +
        "2️⃣ Next Appointment\n" +
        "3️⃣ This Week's Schedule\n" +
        "4️⃣ Schedule for a Date\n" +
        "5️⃣ Manage Availability\n" +
        "6️⃣ Manage Leaves\n" +
        "7️⃣ My Patients\n" +
        "8️⃣ Cancel Patient Appt\n" +
        "9️⃣ Reschedule Patient Appt\n" +
        "🔟 Mark Visit Status";

    const interactive =
        buildInteractiveListSpec(
            [
                { id: "1", title: "Today's Schedule" },
                { id: "2", title: "Next Appointment" },
                { id: "3", title: "This Week" },
                { id: "4", title: "Schedule by Date" },
                { id: "5", title: "Manage Availability" },
                { id: "6", title: "Manage Leaves" },
                { id: "7", title: "My Patients" },
                { id: "8", title: "Cancel Patient Appt" },
                { id: "9", title: "Reschedule Patient" },
                { id: "10", title: "Mark Visit Status" }
            ],
            "Doctor Portal"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getLanguageMenuSpec() {

    // 6 languages exceeds WhatsApp's 3-button interactive limit, so this
    // uses a list menu (10-row limit) instead of buildInteractiveButtonSpec.
    const fallbackText =
        "1️⃣ English\n" +
        "2️⃣ తెలుగు\n" +
        "3️⃣ हिन्दी\n" +
        "4️⃣ ಕನ್ನಡ\n" +
        "5️⃣ தமிழ்\n" +
        "6️⃣ മലയാളം";

    const interactive =
        buildInteractiveListSpec(
            [
                { id: "1", title: "English" },
                { id: "2", title: "Telugu", description: "తెలుగు" },
                { id: "3", title: "Hindi", description: "हिन्दी" },
                { id: "4", title: "Kannada", description: "ಕನ್ನಡ" },
                { id: "5", title: "Tamil", description: "தமிழ்" },
                { id: "6", title: "Malayalam", description: "മലയാളം" }
            ],
            "Select language"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDateMenuSpec() {

    const fallbackText =
        "1️⃣ Today\n" +
        "2️⃣ Tomorrow\n" +
        "3️⃣ Enter another date";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Today" },
            { id: "2", title: "Tomorrow" },
            { id: "3", title: "Other date" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorSelectionMenuSpec() {

    const doctors = getDoctors();

    if (doctors.length === 0) {
        return null;
    }

    let fallbackText = "";

    const rows = doctors.map(
        function (doctor, index) {

            const line =
                (index + 1) +
                ". " +
                doctor.doctorName +
                (
                    doctor.clinicName
                        ? " — " + doctor.clinicName
                        : ""
                );

            fallbackText += line + "\n";

            return {
                id: String(index + 1),
                title: doctor.doctorName,
                description:
                    doctor.clinicName || ""
            };
        }
    );

    fallbackText +=
        "\nReply with the doctor's number.";

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Select doctor"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getSlotSelectionMenuSpec(slots) {

    if (!slots || slots.length === 0) {
        return null;
    }

    let fallbackText = "";

    const rows = slots.map(
        function (slot, index) {

            fallbackText +=
                (index + 1) +
                "️⃣ " +
                slot +
                "\n";

            return {
                id: String(index + 1),
                title: slot,
                description: ""
            };
        }
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose time"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getYesNoConfirmSpec() {

    const fallbackText =
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Yes, cancel" },
            { id: "2", title: "No, go back" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getRescheduleConfirmSpec() {

    const fallbackText =
        "1️⃣ Confirm\n" +
        "2️⃣ Choose another time\n" +
        "3️⃣ Cancel";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Confirm" },
            { id: "2", title: "Other time" },
            { id: "3", title: "Cancel" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getBookingConfirmSpec() {

    return getRescheduleConfirmSpec();
}



function getDoctorStatusActionSpec() {

    const fallbackText =
        "1️⃣ Completed\n" +
        "2️⃣ No-Show";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Completed"
            },
            {
                id: "2",
                title: "No-Show"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}
