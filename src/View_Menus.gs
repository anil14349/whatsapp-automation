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



function getSlotSelectionMenuSpec(
    slots,
    page
) {

    if (!slots || slots.length === 0) {
        return null;
    }

    const pageInfo =
        getSlotSelectionPageInfo(
            slots.length,
            page || 0
        );

    let fallbackText = "";

    if (pageInfo.totalPages > 1) {
        fallbackText +=
            "Page " +
            (pageInfo.page + 1) +
            " of " +
            pageInfo.totalPages +
            "\n\n";
    }

    const rows = [];

    if (pageInfo.hasPrev) {

        rows.push({
            id: "prev",
            title: "Earlier times",
            description: "Previous page"
        });

        fallbackText +=
            "◀ Earlier times\n";
    }

    for (
        let i = pageInfo.start;
        i < pageInfo.end;
        i++
    ) {

        const slot =
            slots[i];

        fallbackText +=
            (i + 1) +
            "️⃣ " +
            slot +
            "\n";

        rows.push({
            id: String(i + 1),
            title: slot,
            description: ""
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "next",
            title: "More times",
            description: "Next page"
        });

        fallbackText +=
            "▶ More times\n";
    }

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose time"
        );

    if (
        !interactive &&
        slots.length > 10
    ) {
        fallbackText =
            formatAvailableSlotsForWhatsApp(
                slots
            );
    }

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages
    };
}



function computeSlotSelectionPageBounds(
    total,
    page
) {

    if (total <= 9) {

        return {
            start: 0,
            end: total,
            hasPrev: false,
            hasNext: false,
            page: 0
        };
    }

    if (page === 0) {

        return {
            start: 0,
            end: 9,
            hasPrev: false,
            hasNext: total > 9,
            page: 0
        };
    }

    const start =
        9 + (page - 1) * 8;

    const remaining =
        total - start;

    const hasNext =
        remaining > 9;

    const slotCount =
        hasNext
            ? 8
            : Math.min(remaining, 9);

    return {
        start: start,
        end: start + slotCount,
        hasPrev: true,
        hasNext: hasNext,
        page: page
    };
}



function getSlotSelectionPageInfo(
    totalSlots,
    page
) {

    const total =
        Number(totalSlots) || 0;

    let safePage =
        Number(page) || 0;

    if (safePage < 0) {
        safePage = 0;
    }

    if (total <= 9) {

        return {
            start: 0,
            end: total,
            hasPrev: false,
            hasNext: false,
            page: 0,
            totalPages: 1
        };
    }

    const lastPage =
        getLastSlotSelectionPage(total);

    if (safePage > lastPage) {
        safePage = lastPage;
    }

    const bounds =
        computeSlotSelectionPageBounds(
            total,
            safePage
        );

    return {
        start: bounds.start,
        end: bounds.end,
        hasPrev: bounds.hasPrev,
        hasNext: bounds.hasNext,
        page: bounds.page,
        totalPages: lastPage + 1
    };
}



function getLastSlotSelectionPage(totalSlots) {

    const total =
        Number(totalSlots) || 0;

    if (total <= 9) {
        return 0;
    }

    let page = 0;

    while (true) {

        const bounds =
            computeSlotSelectionPageBounds(
                total,
                page
            );

        if (!bounds.hasNext) {
            return page;
        }

        page++;
    }
}



function resolveSlotSelectionPage(session) {

    if (
        !session ||
        session.slotPage === undefined ||
        session.slotPage === null ||
        session.slotPage === ""
    ) {
        return 0;
    }

    const page =
        parseInt(
            session.slotPage,
            10
        );

    if (
        isNaN(page) ||
        page < 0
    ) {
        return 0;
    }

    return page;
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



function getConfirmCancelSpec() {

    const fallbackText =
        "1️⃣ Confirm\n" +
        "2️⃣ Cancel";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Confirm" },
            { id: "2", title: "Cancel" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getAppointmentListMenuSpec(
    appointments,
    mode
) {

    if (
        !appointments ||
        appointments.length === 0
    ) {
        return {
            fallbackText: "",
            interactive: null
        };
    }

    const listMode =
        mode === "doctor"
            ? "doctor"
            : "patient";

    const limit =
        Math.min(appointments.length, 10);

    const listed =
        appointments.slice(0, limit);

    const fallbackText =
        listMode === "doctor"
            ? formatDoctorPatientAppointmentsListForWhatsApp(
                listed
            )
            : formatAppointmentsListForWhatsApp(
                listed
            );

    const rows = listed.map(
        function (appt, index) {

            const doctorName =
                findDoctorById(appt.doctorId) ||
                "Unknown Doctor";

            if (listMode === "doctor") {
                return {
                    id: String(index + 1),
                    title:
                        appt.patientName ||
                        "Patient",
                    description:
                        (appt.date || "") +
                        " · " +
                        (appt.time || "")
                };
            }

            return {
                id: String(index + 1),
                title: doctorName,
                description:
                    (appt.date || "") +
                    " · " +
                    (appt.time || "")
            };
        }
    );

    return {
        fallbackText: fallbackText.trim(),
        interactive:
            buildInteractiveListSpec(
                rows,
                "Select appointment"
            )
    };
}



function getDoctorWeekdayMenuSpec(doctorId) {

    const availability =
        getDoctorWeeklyAvailability(
            doctorId
        );

    let fallbackText =
        "📅 Manage Availability\n\n";

    const rows =
        DOCTOR_WEEKDAYS.map(
            function (day, index) {

                const sessions =
                    availability[day];

                let summary =
                    "Not set";

                if (sessions.length > 0) {
                    summary =
                        sessions.length +
                        " session(s)";
                }

                fallbackText +=
                    (index + 1) +
                    ". " +
                    day +
                    ": " +
                    summary +
                    "\n";

                return {
                    id: String(index + 1),
                    title: day,
                    description: summary
                };
            }
        );

    fallbackText +=
        "\nSelect a day to manage.";

    return {
        fallbackText: fallbackText,
        interactive:
            buildInteractiveListSpec(
                rows,
                "Select day"
            )
    };
}



function buildDoctorDayAvailabilityBody(
    doctorId,
    dayName
) {

    const sessions =
        getDoctorDayAvailabilitySessions(
            doctorId,
            dayName
        );

    let text =
        "📅 " +
        dayName +
        " Availability\n\n";

    if (sessions.length === 0) {
        text += "No sessions set.\n";
    } else {
        sessions.forEach(
            function (session, index) {
                text +=
                    (index + 1) +
                    ". " +
                    session.start +
                    " - " +
                    session.end +
                    "\n";
            }
        );
    }

    return text;
}



function getDoctorDayAvailabilityActionSpec() {

    const fallbackText =
        "1️⃣ Add session\n" +
        "2️⃣ Remove session\n" +
        "3️⃣ Clear entire day";

    const interactive =
        buildInteractiveButtonSpec([
            { id: "1", title: "Add session" },
            { id: "2", title: "Remove session" },
            { id: "3", title: "Clear day" }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorSessionRemoveListSpec(sessions) {

    if (
        !sessions ||
        sessions.length === 0
    ) {
        return null;
    }

    let fallbackText = "";

    const rows =
        sessions.map(
            function (session, index) {

                const label =
                    session.start +
                    " - " +
                    session.end;

                fallbackText +=
                    (index + 1) +
                    ". " +
                    label +
                    "\n";

                return {
                    id: String(index + 1),
                    title: label,
                    description: ""
                };
            }
        );

    return {
        fallbackText: fallbackText.trim(),
        interactive:
            buildInteractiveListSpec(
                rows,
                "Remove session"
            )
    };
}



function getDoctorLeavesMenuSpec() {

    const fallbackText =
        formatDoctorLeavesMenu();

    const interactive =
        buildInteractiveListSpec(
            [
                {
                    id: "1",
                    title: "Add single-day leave"
                },
                {
                    id: "2",
                    title: "View upcoming leaves"
                },
                {
                    id: "3",
                    title: "Cancel a leave"
                },
                {
                    id: "4",
                    title: "Add leave range"
                }
            ],
            "Manage leaves"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorLeaveListMenuSpec(leaves) {

    if (
        !leaves ||
        leaves.length === 0
    ) {
        return {
            fallbackText: "No upcoming leaves.",
            interactive: null
        };
    }

    const limit =
        Math.min(leaves.length, 10);

    const listed =
        leaves.slice(0, limit);

    let fallbackText =
        "Upcoming leaves:\n\n";

    const rows =
        listed.map(
            function (leave, index) {

                const line =
                    leave.date +
                    (
                        leave.reason
                            ? " — " + leave.reason
                            : ""
                    );

                fallbackText +=
                    (index + 1) +
                    ". " +
                    line +
                    "\n";

                return {
                    id: String(index + 1),
                    title: leave.date,
                    description:
                        leave.reason || ""
                };
            }
        );

    return {
        fallbackText: fallbackText.trim(),
        interactive:
            buildInteractiveListSpec(
                rows,
                "Select leave"
            )
    };
}
