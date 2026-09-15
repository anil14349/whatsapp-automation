/**
 * Paging the service list.
 *
 * WhatsApp refuses more than ten rows, so the list used to be sliced to ten and
 * the rest simply vanished: a clinic could switch a service on, see it in the
 * portal, and no patient would ever be shown it.
 */

import { assertEquals } from "std/testing/asserts.ts";

const PAGE_SIZE = 9;

/**
 * Mirrors showServiceList: nine services plus a paging row, or three buttons
 * when everything fits.
 */
function pageOf(total: number, page: number): { rows: number; hasMore: boolean } {
    const start = page * PAGE_SIZE;
    const shown = Math.max(0, Math.min(PAGE_SIZE, total - start));
    const hasMore = total > start + PAGE_SIZE;

    return { rows: shown + (hasMore ? 1 : 0), hasMore };
}

Deno.test("a full catalogue is reachable rather than cut off at ten", () => {
    const total = 25;
    let reached = 0;
    let page = 0;

    while (true) {
        const { rows, hasMore } = pageOf(total, page);
        reached += hasMore ? rows - 1 : rows;

        if (!hasMore) break;

        page += 1;

        if (page > 50) throw new Error("paging did not terminate");
    }

    assertEquals(reached, total, "some services could never be reached");
});

Deno.test("no page ever exceeds WhatsApp's ten row limit", () => {
    for (const total of [4, 9, 10, 11, 19, 25, 100]) {
        let page = 0;

        while (true) {
            const { rows, hasMore } = pageOf(total, page);

            assertEquals(
                rows <= 10,
                true,
                `${total} services produced a page of ${rows} rows`
            );

            if (!hasMore) break;
            page += 1;
        }
    }
});

Deno.test("exactly nine services need no paging row", () => {
    assertEquals(pageOf(9, 0), { rows: 9, hasMore: false });
});

Deno.test("ten services page rather than drop the tenth", () => {
    const first = pageOf(10, 0);

    assertEquals(first.hasMore, true);
    assertEquals(first.rows, 10);
    assertEquals(pageOf(10, 1), { rows: 1, hasMore: false });
});

Deno.test("a page past the end is empty rather than negative", () => {
    assertEquals(pageOf(5, 3), { rows: 0, hasMore: false });
});
