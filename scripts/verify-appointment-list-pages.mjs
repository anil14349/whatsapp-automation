/**
 * Validates appointment-list pagination reserves Main Menu within 10 rows.
 * Mirrors buildAppointmentListPages / getAppointmentListPageInfo in View_Menus.gs.
 * Run: node scripts/verify-appointment-list-pages.mjs
 */

const failures = [];

function assert(name, condition, detail) {
    if (!condition) {
        failures.push({ name, detail: detail || "failed" });
    }
}

function buildAppointmentListPages(totalAppointments) {
    const total = Number(totalAppointments) || 0;
    const pages = [];

    if (total <= 0) {
        return pages;
    }

    let index = 0;

    while (index < total) {
        const isFirst = pages.length === 0;
        const remaining = total - index;
        let reserved = 1;

        if (!isFirst) {
            reserved += 1;
        }

        const maxWithoutNext = 10 - reserved;

        if (remaining <= maxWithoutNext) {
            pages.push({
                start: index,
                end: total,
                hasPrev: !isFirst,
                hasNext: false
            });
            break;
        }

        reserved += 1;
        const maxWithNext = 10 - reserved;
        const count = Math.min(remaining, maxWithNext);

        pages.push({
            start: index,
            end: index + count,
            hasPrev: !isFirst,
            hasNext: true
        });

        index += count;
    }

    return pages;
}

function rowCountForPage(page) {
    const apptCount = page.end - page.start;
    let rows = apptCount + 1;

    if (page.hasPrev) {
        rows += 1;
    }

    if (page.hasNext) {
        rows += 1;
    }

    return rows;
}

function simulateMenuRows(total, pageIndex) {
    const pages = buildAppointmentListPages(total);

    if (pages.length === 0) {
        return [];
    }

    const page = pages[Math.min(pageIndex, pages.length - 1)];
    const rows = [];

    for (let i = page.start; i < page.end; i++) {
        rows.push("appt_" + (i + 1));
    }

    if (page.hasPrev) {
        rows.push("appt_prev");
    }

    if (page.hasNext) {
        rows.push("appt_next");
    }

    if (rows.length < 10) {
        rows.push("nav_main_menu");
    }

    return rows;
}

for (const total of [1, 9, 10, 11, 15, 20, 25]) {
    const pages = buildAppointmentListPages(total);
    const covered = pages.reduce(
        (sum, page) => sum + (page.end - page.start),
        0
    );

    assert(
        `total ${total}: covers all appointments`,
        covered === total,
        `covered ${covered} of ${total}`
    );

    pages.forEach(function (page, index) {
        const rows = rowCountForPage(page);

        assert(
            `total ${total} page ${index}: <= 10 interactive rows`,
            rows <= 10,
            `${rows} rows`
        );

        const simulated = simulateMenuRows(total, index);

        assert(
            `total ${total} page ${index}: includes Main Menu nav`,
            simulated.includes("nav_main_menu"),
            simulated.join(",")
        );

        assert(
            `total ${total} page ${index}: simulated <= 10 rows`,
            simulated.length <= 10,
            `${simulated.length} rows`
        );
    });
}

const fifteen = buildAppointmentListPages(15);

assert(
    "15 appointments uses 2 pages",
    fifteen.length === 2,
    `got ${fifteen.length}`
);

assert(
    "15 appointments page 0 shows 8 items",
    fifteen[0].end - fifteen[0].start === 8,
    `got ${fifteen[0].end - fifteen[0].start}`
);

assert(
    "15 appointments page 1 shows 7 items",
    fifteen[1].end - fifteen[1].start === 7,
    `got ${fifteen[1].end - fifteen[1].start}`
);

if (failures.length > 0) {
    console.error("verify-appointment-list-pages: FAILED");
    failures.forEach(function (item) {
        console.error(" - " + item.name + ": " + item.detail);
    });
    process.exit(1);
}

console.log("verify-appointment-list-pages: all checks passed");
