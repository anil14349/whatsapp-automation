/**
 * In-memory stand-in for a Supabase client.
 *
 * Supports the subset of PostgREST chaining the handlers actually use, so
 * state-machine tests can run without a database or network. Rows are plain
 * objects held per table; filters are applied in order like PostgREST does.
 */

type Row = Record<string, any>;

interface Filter {
    column: string;
    op: "eq" | "neq" | "in" | "lt" | "lte" | "gt" | "gte" | "is" | "like" | "ilike";
    value: any;
}

export interface SeedData {
    [table: string]: Row[];
}

function matches(row: Row, filter: Filter): boolean {
    const actual = row[filter.column];

    switch (filter.op) {
        case "eq":
            return actual === filter.value;
        case "neq":
            return actual !== filter.value;
        case "in":
            return (filter.value as any[]).includes(actual);
        case "lt":
            return actual < filter.value;
        case "lte":
            return actual <= filter.value;
        case "gt":
            return actual > filter.value;
        case "gte":
            return actual >= filter.value;
        case "is":
            return actual === filter.value;
        case "like":
            return String(actual).includes(String(filter.value).replace(/[%*]/g, ""));
        case "ilike":
            return String(actual)
                .toLowerCase()
                .includes(String(filter.value).replace(/[%*]/g, "").toLowerCase());
        default:
            return false;
    }
}

class QueryBuilder implements PromiseLike<{ data: any; error: any }> {
    private filters: Filter[] = [];
    private mode: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row | Row[] | null = null;
    private singleMode = false;
    private maybeSingleMode = false;
    private orderBy: Array<{ column: string; ascending: boolean }> = [];
    private limitCount: number | null = null;
    private selectAfterWrite = false;

    constructor(
        private readonly store: SeedData,
        private readonly table: string,
        private readonly onWrite: (table: string, action: string, rows: Row[]) => void,
        private readonly failures: Record<string, any>
    ) {}

    private get rows(): Row[] {
        if (!this.store[this.table]) {
            this.store[this.table] = [];
        }
        return this.store[this.table];
    }

    select(_columns?: string) {
        if (this.mode === "select") {
            this.mode = "select";
        } else {
            this.selectAfterWrite = true;
        }
        return this;
    }

    insert(payload: Row | Row[]) {
        this.mode = "insert";
        this.payload = payload;
        return this;
    }

    update(payload: Row) {
        this.mode = "update";
        this.payload = payload;
        return this;
    }

    upsert(payload: Row) {
        this.mode = "insert";
        this.payload = payload;
        return this;
    }

    delete() {
        this.mode = "delete";
        return this;
    }

    eq(column: string, value: any) {
        this.filters.push({ column, op: "eq", value });
        return this;
    }

    neq(column: string, value: any) {
        this.filters.push({ column, op: "neq", value });
        return this;
    }

    in(column: string, value: any[]) {
        this.filters.push({ column, op: "in", value });
        return this;
    }

    lt(column: string, value: any) {
        this.filters.push({ column, op: "lt", value });
        return this;
    }

    lte(column: string, value: any) {
        this.filters.push({ column, op: "lte", value });
        return this;
    }

    gt(column: string, value: any) {
        this.filters.push({ column, op: "gt", value });
        return this;
    }

    gte(column: string, value: any) {
        this.filters.push({ column, op: "gte", value });
        return this;
    }

    is(column: string, value: any) {
        this.filters.push({ column, op: "is", value });
        return this;
    }

    like(column: string, value: any) {
        this.filters.push({ column, op: "like", value });
        return this;
    }

    ilike(column: string, value: any) {
        this.filters.push({ column, op: "ilike", value });
        return this;
    }

    // PostgREST applies each order in turn, so a second call is a tie-break,
    // not a replacement.
    order(column: string, opts?: { ascending?: boolean }) {
        this.orderBy.push({ column, ascending: opts?.ascending !== false });
        return this;
    }

    limit(count: number) {
        this.limitCount = count;
        return this;
    }

    maybeSingle() {
        this.maybeSingleMode = true;
        return this;
    }

    single() {
        this.singleMode = true;
        return this;
    }

    private matching(): Row[] {
        return this.rows.filter((row) => this.filters.every((f) => matches(row, f)));
    }

    private execute(): { data: any; error: any } {
        const failure = this.failures[`${this.table}.${this.mode}`] ?? this.failures[this.table];

        if (failure) {
            return { data: null, error: failure };
        }

        if (this.mode === "insert") {
            const incoming = Array.isArray(this.payload) ? this.payload : [this.payload as Row];
            const inserted: Row[] = [];

            for (const row of incoming) {
                const copy = { ...row };
                // Emulate the unique index that prevents double booking.
                if (this.table === "appointments") {
                    const clash = this.rows.find(
                        (existing) =>
                            existing.clinic_id === copy.clinic_id &&
                            existing.doctor_id === copy.doctor_id &&
                            existing.appointment_date === copy.appointment_date &&
                            existing.appointment_time === copy.appointment_time &&
                            existing.status !== "CANCELLED"
                    );

                    if (clash) {
                        return {
                            data: null,
                            error: { code: "23505", message: "duplicate key value" }
                        };
                    }
                }

                this.rows.push(copy);
                inserted.push(copy);
            }

            this.onWrite(this.table, "insert", inserted);
            return this.shape(inserted);
        }

        if (this.mode === "update") {
            const targets = this.matching();

            for (const row of targets) {
                Object.assign(row, this.payload);
            }

            this.onWrite(this.table, "update", targets);
            return this.shape(targets);
        }

        if (this.mode === "delete") {
            const targets = this.matching();
            this.store[this.table] = this.rows.filter((row) => !targets.includes(row));
            this.onWrite(this.table, "delete", targets);
            return this.shape(targets);
        }

        let result = this.matching();

        if (this.orderBy.length > 0) {
            result = [...result].sort((a, b) => {
                for (const { column, ascending } of this.orderBy) {
                    if (a[column] === b[column]) continue;
                    return (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1);
                }

                return 0;
            });
        }

        if (this.limitCount !== null) {
            result = result.slice(0, this.limitCount);
        }

        return this.shape(result);
    }

    private shape(rows: Row[]): { data: any; error: any } {
        if (this.maybeSingleMode) {
            return { data: rows[0] ?? null, error: null };
        }

        if (this.singleMode) {
            if (rows.length !== 1) {
                return {
                    data: null,
                    error: { code: "PGRST116", message: "expected exactly one row" }
                };
            }
            return { data: rows[0], error: null };
        }

        return { data: rows, error: null };
    }

    then<TResult1 = { data: any; error: any }, TResult2 = never>(
        onfulfilled?:
            | ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>)
            | null,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): PromiseLike<TResult1 | TResult2> {
        return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
    }
}

export class FakeSupabaseClient {
    readonly store: SeedData;
    readonly writes: Array<{ table: string; action: string; rows: Row[] }> = [];
    private readonly failures: Record<string, any> = {};

    constructor(seed: SeedData = {}) {
        this.store = structuredClone(seed);
    }

    /** Force a table (optionally a single operation) to return an error. */
    failOn(target: string, error: any): void {
        this.failures[target] = error;
    }

    from(table: string) {
        return new QueryBuilder(
            this.store,
            table,
            (t, action, rows) => this.writes.push({ table: t, action, rows }),
            this.failures
        );
    }

    rows(table: string): Row[] {
        return this.store[table] ?? [];
    }
}

export function fakeSupabase(seed: SeedData = {}): any {
    return new FakeSupabaseClient(seed);
}
