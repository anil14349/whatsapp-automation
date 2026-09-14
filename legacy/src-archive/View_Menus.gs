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
    buttonLabel,
    forceList
) {

    if (
        !rows ||
        rows.length === 0 ||
        rows.length > 10
    ) {
        return null;
    }

    // WhatsApp list messages add a second tap: the user first sees a
    // "Choose" button and only then sees the options. Avoid that extra
    // step whenever the menu can fit into WhatsApp's 3-button reply limit.
    // A persistent Main Menu / Doctor Portal navigation row is deliberately
    // omitted from the direct-button version; the numbered/text fallback and
    // the universal navigation handler still provide navigation.
    const directRows = rows.filter(function (row) {
        return row &&
            row.id !== "nav_main_menu" &&
            row.id !== "nav_back";
    });

    const hasPagingRows = rows.some(function (row) {
        const id = String(row && row.id || "");
        return /(^|_)(prev|next)$/.test(id) ||
            id.indexOf("_prev") !== -1 ||
            id.indexOf("_next") !== -1;
    });

    if (
        !forceList &&
        directRows.length > 0 &&
        directRows.length <= 3 &&
        !hasPagingRows
    ) {
        return buildInteractiveButtonSpec(
            directRows.slice(0, 3)
        );
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
//
// NOTE: WhatsApp button interactive messages do NOT support description
// fields (only title). Use buildInteractiveListSpec for menus that need
// descriptions (up to 72 chars per row). Buttons max 3 items × 20 chars.
// Lists max 10 items × title(24 chars) + description(72 chars).
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
        "📅 Book Appointment\n" +
        "🩸 Home Sample Collection\n" +
        "⋯ More Options\n\n" +
        "Please tap an option above to continue.";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "1",
                title: "Book Appointment"
            },
            {
                id: "home_collection",
                title: "Home Sample Collection"
            },
            {
                id: "menu_more",
                title: "More Options"
            }
        ]);

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getPatientMainMoreMenuSpec() {

    // All remaining patient actions are shown in one native WhatsApp list.
    // forceList=true prevents short lists from being converted into buttons.
    const rows = [
        {
            id: "2",
            title: "My Appointments",
            description: "View your upcoming appointments"
        },
        {
            id: "4",
            title: "Reschedule Appointment",
            description: "Change the date or time"
        },
        {
            id: "3",
            title: "Cancel Appointment",
            description: "Cancel an existing appointment"
        },
        {
            id: "5",
            title: "Change Language",
            description: "Choose your preferred language"
        },
        {
            id: "nav_main_menu",
            title: "Main Menu",
            description: "Return to the main menu"
        }
    ];

    const fallbackText =
        "📋 My Appointments\n" +
        "🔄 Reschedule Appointment\n" +
        "❌ Cancel Appointment\n" +
        "🌐 Change Language\n" +
        "🏠 Main Menu\n\n" +
        "Please tap an option above to continue.";

    return {
        fallbackText: fallbackText,
        interactive: buildInteractiveListSpec(
            rows,
            "More Options",
            true
        )
    };
}



function getDoctorMainMenuSpec() {

    const fallbackText =
        "Today's Schedule\n" +
        "Next Appointment\n" +
        "More (schedule / availability / patients…)";

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
            "This Week\n" +
            "Schedule by Date\n" +
            "More → next page";

        const rows = [
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
        ];

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        const interactive =
            buildInteractiveListSpec(
                rows,
                "Choose"
            );

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    if (t === 2) {

        const fallbackText =
            "Manage Availability\n" +
            "Manage Leaves\n" +
            "More → next page";

        const rows = [
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
        ];

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        const interactive =
            buildInteractiveListSpec(
                rows,
                "Choose"
            );

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    if (t === 3) {

        const fallbackText =
            "My Patients\n" +
            "Cancel Patient Appt\n" +
            "More → next page";

        const rows = [
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
        ];

        appendWhatsAppHomeNavRow(
            rows,
            "doctor"
        );

        const interactive =
            buildInteractiveListSpec(
                rows,
                "Choose"
            );

        return {
            fallbackText: fallbackText,
            interactive: interactive
        };
    }

    const fallbackText =
        "Reschedule Patient Appt\n" +
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
        "English\n" +
        "తెలుగు\n" +
        "हिन्दी\n" +
        "ಕನ್ನಡ\n" +
        "தமிழ்\n" +
        "മലയാളം";

    const interactive =
        buildInteractiveListSpec(
            [
                { id: "1", title: "English", description: "English" },
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



function getDateMenuSpec(mode) {

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayFormatted =
        Utilities.formatDate(today, TIMEZONE, "MMM dd, yyyy");
    const tomorrowFormatted =
        Utilities.formatDate(tomorrow, TIMEZONE, "MMM dd, yyyy");

    const fallbackText =
        "Today\n" +
        "Tomorrow\n" +
        "Enter another date";

    const rows = [
        {
            id: "date_today",
            title: "Today",
            description: todayFormatted
        },
        {
            id: "date_tomorrow",
            title: "Tomorrow",
            description: tomorrowFormatted
        },
        {
            id: "date_custom",
            title: "Other date",
            description: "Enter custom date in YYYY-MM-DD"
        }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        mode
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorSelectionMenuSpec(page) {
    const doctors = getDoctors();
    const total = doctors.length;

    if (total === 0) {
        return null;
    }

    // All doctors live in one native WhatsApp list.
    // Eight doctors per page leaves room for pagination and navigation rows.
    const pageSize = 8;
    const totalPages = Math.max(
        1,
        Math.ceil(total / pageSize)
    );

    let safePage = Number(page) || 0;
    if (safePage < 0) safePage = 0;
    if (safePage >= totalPages) safePage = totalPages - 1;

    const startIndex = safePage * pageSize;
    const visibleDoctors = doctors.slice(
        startIndex,
        startIndex + pageSize
    );

    const rows = visibleDoctors.map(function (doctor) {
        const description = [
            doctor.specialization,
            doctor.clinicName
        ].filter(Boolean).join(" — ");

        return {
            id:
                "doctor_select_" +
                encodeURIComponent(String(doctor.doctorId)),
            title: doctor.doctorName,
            description: description
        };
    });

    if (safePage > 0) {
        rows.push({
            id: "doctor_more_prev",
            title: "Earlier doctors",
            description: "Previous page"
        });
    }

    if (safePage < totalPages - 1) {
        rows.push({
            id: "doctor_more_next",
            title: "More doctors",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(rows, "patient");

    const fallbackLines = visibleDoctors.map(function (doctor, index) {
        return (index + 1) + ". " + doctor.doctorName;
    });

    if (safePage < totalPages - 1) {
        fallbackLines.push("9. More doctors");
    }

    return {
        fallbackText: fallbackLines.join("\n"),
        // Keep this as a native list even when only a few doctors exist.
        interactive: buildInteractiveListSpec(
            rows,
            "Choose doctor",
            true
        ),
        page: safePage,
        totalPages: totalPages,
        hasPrev: safePage > 0,
        hasNext: safePage < totalPages - 1
    };
}



function getHomeCollectionTimeWindowSpec(dateString) {

    const availableOptions =
        getHomeCollectionTimeWindowOptionsForDate(dateString);

    const fallbackText =
        availableOptions.map(function (option) {
            return option.value;
        }).join("\n");

    const rows =
        availableOptions.map(function (option) {
            return {
                id: option.id,
                title: option.title,
                description: option.description
            };
        });

    appendWhatsAppHomeNavRow(
        rows,
        "patient"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getMyAppointmentActionSpec() {

    const fallbackText =
        "Cancel Appointment\n" +
        "Reschedule\n" +
        "Main Menu";

    const interactive =
        buildInteractiveButtonSpec([
            {
                id: "appointment_action_cancel",
                title: "Cancel Appointment"
            },
            {
                id: "appointment_action_reschedule",
                title: "Reschedule"
            },
            {
                id: "nav_main_menu",
                title: "Main Menu"
            }
        ]);

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
        "Yes, cancel it\n" +
        "No, go back";

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



function getRescheduleConfirmSpec(mode) {

    const fallbackText =
        "Confirm\n" +
        "Choose another time\n" +
        "Cancel";

    const rows = [
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
    ];

    appendWhatsAppHomeNavRow(
        rows,
        mode
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getBookingConfirmSpec(mode) {

    return getRescheduleConfirmSpec(mode);
}



function getDoctorStatusActionSpec() {

    const fallbackText =
        "Completed\n" +
        "No-Show";

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
        "Confirm\n" +
        "Cancel";

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
        "Add session\n" +
        "Remove session\n" +
        "Clear entire day";

    const rows = [
        { id: "1", title: "Add session" },
        { id: "2", title: "Remove session" },
        { id: "3", title: "Clear day" }
    ];

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Choose"
        );

    return {
        fallbackText: fallbackText,
        interactive: interactive
    };
}



function getDoctorSessionRemoveListSpec(sessions, page) {

    if (
        !sessions ||
        sessions.length === 0
    ) {
        return null;
    }

    const total =
        sessions.length;

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

    // More than 9 sessions in a single day no longer falls back to a
    // plain numbered text list — paginate like getDoctorSelectionMenuSpec.
    // Row ids stay absolute 1-based indexes into the full list (matching
    // what removeDoctorAvailabilitySession expects), regardless of page.
    const pageInfo =
        getSlotSelectionPageInfo(
            total,
            page || 0
        );

    const visibleSessions =
        sessions.slice(
            pageInfo.start,
            pageInfo.end
        );

    const rows =
        visibleSessions.map(
            function (session, index) {

                return {
                    id: String(pageInfo.start + index + 1),
                    title:
                        session.start +
                        " - " +
                        session.end,
                    description: ""
                };
            }
        );

    if (pageInfo.hasPrev) {

        rows.push({
            id: "session_prev",
            title: "Earlier sessions",
            description: "Previous page"
        });
    }

    if (pageInfo.hasNext) {

        rows.push({
            id: "session_next",
            title: "More sessions",
            description: "Next page"
        });
    }

    appendWhatsAppHomeNavRow(
        rows,
        "doctor"
    );

    const interactive =
        buildInteractiveListSpec(
            rows,
            "Remove session"
        );

    return {
        fallbackText: fallbackText.trim(),
        interactive: interactive,
        page: pageInfo.page,
        totalPages: pageInfo.totalPages,
        hasPrev: pageInfo.hasPrev,
        hasNext: pageInfo.hasNext
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
