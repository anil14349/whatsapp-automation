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



// Convention for any menu with more real options than fit in 3 buttons:
// show the 2 most important options directly, and use the 3rd button as
// a "More" pivot (id "menu_more"/"menu_more_<tier>") into a follow-up
// screen holding the rest — never silently drop an option. See
// getPatientMainMenuSpec/getPatientMainMoreMenuSpec and
// getDoctorMainMenuSpec/getDoctorMainMenuMoreSpec (tiers 1-3) for the
// reference implementation. Only the final tier, with 2 or fewer options
// left, should skip "More" and use its free 3rd slot for the persistent
// nav button instead (see getDoctorMainMenuMoreSpec's tier-4 branch).
// If a menu legitimately needs more than 10 total options, switch to
// buildInteractiveListSpec instead (10-row cap) — see getLanguageMenuSpec.
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
        "3️⃣ More (Cancel / Reschedule / Language)";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Book Appointment"
            },
            {
                id: "2",
                title: "My Appointments"
            },
            {
                id: "menu_more",
                title: "More"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getPatientMainMoreMenuSpec() {

    const fallbackText =
        "3️⃣ Cancel Appointment\n" +
        "4️⃣ Reschedule Appointment\n" +
        "5️⃣ Change Language";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "3",
                title: "Cancel Appointment"
            },
            {
                id: "4",
                title: "Reschedule"
            },
            {
                id: "5",
                title: "Change Language"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorMainMenuSpec() {

    const fallbackText =
        "1️⃣ Today's Schedule\n" +
        "2️⃣ Next Appointment\n" +
        "3️⃣ More (schedule / availability / patients…)";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Today's Schedule"
            },
            {
                id: "2",
                title: "Next Appointment"
            },
            {
                id: "menu_more",
                title: "More"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorMainMenuMoreSpec(tier) {

    const t =
        Number(tier) || 1;

    if (t === 1) {

        const fallbackText =
            "3️⃣ This Week\n" +
            "4️⃣ Schedule by Date\n" +
            "More → next page";

        const interactive =
            buildInteractiveButtonSpec([
                {
                    id: "3",
                    title: "This Week"
                },
                {
                    id: "4",
                    title: "Schedule by Date"
                },
                {
                    id: "menu_more_2",
                    title: "More"
                }
            ]);

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    if (t === 2) {

        const fallbackText =
            "5️⃣ Manage Availability\n" +
            "6️⃣ Manage Leaves\n" +
            "More → next page";

        const interactive =
            buildInteractiveButtonSpec([
                {
                    id: "5",
                    title: "Manage Availability"
                },
                {
                    id: "6",
                    title: "Manage Leaves"
                },
                {
                    id: "menu_more_3",
                    title: "More"
                }
            ]);

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    if (t === 3) {

        const fallbackText =
            "7️⃣ My Patients\n" +
            "8️⃣ Cancel Patient Appt\n" +
            "More → next page";

        const interactive =
            buildInteractiveButtonSpec([
                {
                    id: "7",
                    title: "My Patients"
                },
                {
                    id: "8",
                    title: "Cancel Patient"
                },
                {
                    id: "menu_more_4",
                    title: "More"
                }
            ]);

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    const fallbackText =
        "9️⃣ Reschedule Patient Appt\n" +
        "🔟 Mark Visit Status";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "doctor_reschedule",
                title: "Reschedule Patient"
            },
            {
                id: "doctor_status",
                title: "Mark Visit Status"
            },
            {
                id: "nav_main_menu",
                title: "Doctor Portal"
            }
        ]);

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
            "Choose language"
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
            {
                id: "date_today",
                title: "Today"
            },
            {
                id: "date_tomorrow",
                title: "Tomorrow"
            },
            {
                id: "date_custom",
                title: "Other date"
            }
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

    let fallbackText =
        buildDoctorSelectionFallbackText(
            doctors
        );

    // Cap at 9 so appendWhatsAppHomeNavRow always has room for the nav
    // row (9 + 1 = 10, the WhatsApp interactive-list cap). Beyond that,
    // skip building an interactive list entirely rather than silently
    // dropping the nav row or doctors past the 9th — sendWhatsAppMenuReply
    // falls back to fallbackText (which lists every doctor, uncapped)
    // whenever menuSpec.interactive is null.
    let interactive = null;

    if (doctors.length <= 9) {

        const rows = doctors.map(
            function (doctor, index) {

                const description =
                    [
                        doctor.specialization,
                        doctor.clinicName
                    ]
                        .filter(Boolean)
                        .join(" — ");

                return {
                    id: String(index + 1),
                    title: doctor.doctorName,
                    description: description
                };
            }
        );

        appendWhatsAppHomeNavRow(
            rows,
            "patient"
        );

        interactive =
            buildInteractiveListSpec(
                rows,
                "Select doctor"
            );
    }

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getSlotSelectionMenuSpec(
    slots,
    page,
    mode
) {

    const safeSlots =
        Array.isArray(slots)
            ? slots
            : [];

    const total =
        safeSlots.length;

    if (total === 0) {
        return null;
    }

    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const visibleSlots =
        safeSlots.slice(
            pageInfo.start,
            pageInfo.end
        );

    const rows =
        visibleSlots.map(
            function (slot, index) {

                const absoluteIndex =
                    pageInfo.start +
                    index;

                return {
                    id:
                        "slot_" +
                        String(absoluteIndex + 1),
                    title: String(slot),
                    description: ""
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "slot_prev",
            title: "Earlier times",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "slot_next",
            title: "More times",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        mode === "doctor"
            ? "doctor"
            : "patient"
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

    fallbackText +=
        visibleSlots
            .map(
                function (slot, index) {
                    return (
                        String(
                            pageInfo.start +
                            index +
                            1
                        ) +
                        "️⃣ " +
                        String(slot)
                    );
                }
            )
            .join("\n");

    if (pageInfo.hasPrev) {
        fallbackText += "\n◀ Earlier times";
    }

    if (pageInfo.hasNext) {
        fallbackText += "\n▶ More times";
    }

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose time"
        );

    if (
        !interactive &&
        total > 10
    ) {
        fallbackText =
            formatAvailableSlotsForWhatsApp(
                safeSlots
            );
    }

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
    };
}



// Row budget is 10 (WhatsApp's interactive-list cap). Every page reserves
// 1 row for the persistent "Main Menu"/"Back" nav row, on top of whatever
// is reserved for ◀/▶ pagination rows:
//   single page:        content ≤ 9   (+ 1 nav                = 10)
//   first page (>1 pg): content = 7   (+ 1 next  + 1 nav       = 9, ≤10)
//   middle page:        content = 6   (+ 1 prev + 1 next + nav = 9, ≤10)
//   last page:          content ≤ 8   (+ 1 prev + 1 nav        ≤ 10)
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
            end: 7,
            hasPrev: false,
            hasNext: total > 7,
            page: 0
        };
    }

    const start =
        7 + (page - 1) * 6;

    const remaining =
        total - start;

    const hasNext =
        remaining > 8;

    const slotCount =
        hasNext
            ? 6
            : Math.min(remaining, 8);

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



function getYesNoConfirmSpec(mode) {

    const fallbackText =
        "1️⃣ Yes, cancel it\n" +
        "2️⃣ No, go back";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "confirm_yes_cancel",
                title: "Yes, cancel"
            },
            {
                id: "confirm_no_back",
                title: "No, go back"
            },
            {
                id: "nav_main_menu",
                title:
                    mode === "doctor"
                        ? "Doctor Portal"
                        : "Main Menu"
            }
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
            {
                id: "confirm_yes",
                title: "Confirm"
            },
            {
                id: "confirm_other_time",
                title: "Other time"
            },
            {
                id: "confirm_cancel",
                title: "Cancel"
            }
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
                id: "status_completed",
                title: "Completed"
            },
            {
                id: "status_no_show",
                title: "No-Show"
            },
            {
                id: "nav_main_menu",
                title: "Doctor Portal"
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
            {
                id: "confirm_yes",
                title: "Confirm"
            },
            {
                id: "confirm_cancel",
                title: "Cancel"
            },
            {
                id: "nav_main_menu",
                title: "Doctor Portal"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function appendWhatsAppHomeNavRow(
    rows,
    listMode
) {

    if (
        !rows ||
        rows.length >= 10
    ) {
        return rows;
    }

    rows.push({
        id: "nav_main_menu",
        title:
            listMode === "doctor"
                ? "Doctor Portal"
                : "Main Menu",
        description: "Return to home"
    });

    return rows;
}



function getAppointmentListMenuSpec(
    appointments,
    mode,
    page
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

    const total =
        appointments.length;

    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const listed =
        appointments.slice(
            pageInfo.start,
            pageInfo.end
        );

    let fallbackText =
        listMode === "doctor"
            ? listed
                .map(
                    function (appt, index) {
                        return (
                            String(
                                pageInfo.start +
                                index +
                                1
                            ) +
                            "️⃣ " +
                            "👤 " +
                            (appt.patientName || "Patient") +
                            "\n" +
                            "   📅 " +
                            appt.date +
                            "   🕐 " +
                            appt.time +
                            "\n"
                        );
                    }
                )
                .join("\n")
            : listed
                .map(
                    function (appt, index) {
                        const doctorName =
                            findDoctorById(
                                appt.doctorId
                            ) ||
                            "Unknown Doctor";

                        return (
                            String(
                                pageInfo.start +
                                index +
                                1
                            ) +
                            "️⃣ " +
                            doctorName +
                            "\n" +
                            "   " +
                            formatAppointmentListRowDescription(
                                appt
                            ) +
                            "\n"
                        );
                    }
                )
                .join("\n");

    if (pageInfo.hasPrev) {
        fallbackText += "\n◀ Earlier appointments";
    }

    if (pageInfo.hasNext) {
        fallbackText += "\n▶ More appointments";
    }

    const rows =
        listed.map(
            function (appt, index) {

                const absoluteIndex =
                    pageInfo.start +
                    index;

                const doctorName =
                    findDoctorById(
                        appt.doctorId
                    ) ||
                    "Unknown Doctor";

                if (listMode === "doctor") {
                    return {
                        id:
                            "appt_" +
                            String(
                                absoluteIndex + 1
                            ),
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
                    id:
                        "appt_" +
                        String(
                            absoluteIndex + 1
                        ),
                    title: doctorName,
                    description:
                        formatAppointmentListRowDescription(
                            appt
                        )
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "appt_prev",
            title: "Earlier appointments",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "appt_next",
            title: "More appointments",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        listMode
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Select appointment"
        );

    if (
        !interactive &&
        total > 10
    ) {
        fallbackText =
            listMode === "doctor"
                ? formatDoctorPatientAppointmentsListForWhatsApp(
                    appointments
                )
                : formatAppointmentsListForWhatsApp(
                    appointments
                );
    }

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
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

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

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

    sessions.forEach(
        function (session, index) {

            fallbackText +=
                (index + 1) +
                ". " +
                session.start +
                " - " +
                session.end +
                "\n";
        }
    );

    // Cap at 9 so appendWhatsAppHomeNavRow always has room for the nav
    // row — see the identical comment in getDoctorSelectionMenuSpec.
    // fallbackText above already lists every session, uncapped.
    let interactive = null;

    if (sessions.length <= 9) {

        const rows =
            sessions.map(
                function (session, index) {

                    return {
                        id: String(index + 1),
                        title:
                            session.start +
                            " - " +
                            session.end,
                        description: ""
                    };
                }
            );

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        interactive =
            buildInteractiveListSpec(
                rows,
                "Remove session"
            );
    }

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive
    };
}



function getDoctorLeavesMenuSpec() {

    const fallbackText =
        formatDoctorLeavesMenu();

    const rows = [
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
    ];

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
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
        Math.min(leaves.length, 9);

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

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
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
