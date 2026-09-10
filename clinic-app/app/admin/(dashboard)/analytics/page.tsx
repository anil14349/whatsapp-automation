import { getSupabaseServerClient } from "@/lib/supabase/server";
import { formatDateKey, isValidISODate } from "@/lib/scheduling/dates";
import { getServerEnv } from "@/lib/env";
import { requireAdminRole } from "@/lib/auth/authorize";
import { listDoctors } from "@/lib/doctors";
import {
  getBookingVolumeByDay,
  getDoctorUtilization,
  getNoShowRate
} from "@/lib/analytics";
import {
  BrandedInput,
  BrandedButton,
  BrandedCard,
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell
} from "@/app/admin/(dashboard)/components/branded";

const DEFAULT_RANGE_DAYS = 30;
// Hard ceiling on how wide a range the date filter form will accept —
// without this, a typo'd/handcrafted year in the query string (e.g.
// ?from=0001-01-01) would make enumerateDateRange build a
// multi-hundred-thousand-entry array once per doctor for the
// utilization/capacity computation, and render one bar per day.
const MAX_RANGE_DAYS = 366;

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <BrandedCard>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </BrandedCard>
  );
}

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}

function defaultDateRange(timezone: string): { fromDate: string; toDate: string } {
  const now = new Date();
  const toDate = formatDateKey(now, timezone);
  const fromDateObj = new Date(now.getTime() - (DEFAULT_RANGE_DAYS - 1) * 24 * 60 * 60 * 1000);
  const fromDate = formatDateKey(fromDateObj, timezone);

  return { fromDate, toDate };
}

/**
 * Validates the from/to query params: both must be real ISO dates,
 * from <= to, and the span capped at MAX_RANGE_DAYS. Falls back to the
 * last-30-days default wholesale on any violation, rather than trying to
 * partially repair a malformed range.
 */
function resolveDateRange(
  filters: { from?: string; to?: string },
  timezone: string
): { fromDate: string; toDate: string } {
  const defaults = defaultDateRange(timezone);
  const fromDate = filters.from || defaults.fromDate;
  const toDate = filters.to || defaults.toDate;

  if (!isValidISODate(fromDate) || !isValidISODate(toDate) || fromDate > toDate) {
    return defaults;
  }

  const spanDays =
    (new Date(`${toDate}T00:00:00Z`).getTime() - new Date(`${fromDate}T00:00:00Z`).getTime()) /
      (24 * 60 * 60 * 1000) +
    1;

  if (spanDays > MAX_RANGE_DAYS) {
    return defaults;
  }

  return { fromDate, toDate };
}

export default async function AnalyticsPage({
  searchParams
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  await requireAdminRole(["ADMIN", "RECEPTIONIST"]);
  const filters = await searchParams;
  const supabase = getSupabaseServerClient();
  const env = getServerEnv();

  const { fromDate, toDate } = resolveDateRange(filters, env.CLINIC_TIMEZONE);
  const range = { fromDate, toDate };

  const doctors = await listDoctors(supabase);

  const [bookingVolume, noShow, utilization] = await Promise.all([
    getBookingVolumeByDay(supabase, range),
    getNoShowRate(supabase, range, doctors),
    getDoctorUtilization(supabase, range, doctors)
  ]);

  const maxDayCount = Math.max(1, ...bookingVolume.map((day) => day.count));
  const totalBookings = bookingVolume.reduce((sum, day) => sum + day.count, 0);

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Analytics</h1>
      <p className="mt-1 text-sm text-slate-500">
        Booking volume, no-show rate, and doctor utilization for the selected date range.
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-4" method="get">
        <div className="flex-1 min-w-fit">
          <BrandedInput
            label="From"
            type="date"
            name="from"
            defaultValue={fromDate}
          />
        </div>

        <div className="flex-1 min-w-fit">
          <BrandedInput
            label="To"
            type="date"
            name="to"
            defaultValue={toDate}
          />
        </div>

        <BrandedButton type="submit" variant="primary">
          Filter
        </BrandedButton>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total bookings" value={totalBookings} />
        <StatCard label="Overall no-show rate" value={formatPercent(noShow.overall.rate)} />
        <StatCard label="Doctors reporting" value={utilization.length} />
      </div>

      <BrandedCard title="Booking volume by day" className="mt-6">
        <p className="text-xs text-slate-500">Includes appointments of every status.</p>

        <div className="mt-4 flex h-40 items-end gap-1 overflow-x-auto">
          {bookingVolume.map((day) => (
            <div
              key={day.date}
              className="flex min-w-[10px] flex-1 flex-col items-center justify-end"
              title={`${day.date}: ${day.count}`}
            >
              <div
                className="w-full rounded-t bg-brand-500"
                style={{ height: `${Math.max(2, (day.count / maxDayCount) * 100)}%` }}
              />
            </div>
          ))}
          {bookingVolume.length === 0 && (
            <p className="text-sm text-slate-400">No data in this range.</p>
          )}
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-400">
          <span>{fromDate}</span>
          <span>{toDate}</span>
        </div>
      </BrandedCard>

      <div className="mt-6">
        <BrandedTable>
          <BrandedTableHeader>
            <BrandedTableCell>Doctor</BrandedTableCell>
            <BrandedTableCell>No-show rate</BrandedTableCell>
            <BrandedTableCell>Completed</BrandedTableCell>
            <BrandedTableCell>No-shows</BrandedTableCell>
            <BrandedTableCell>Utilization</BrandedTableCell>
            <BrandedTableCell>Booked</BrandedTableCell>
            <BrandedTableCell>Capacity</BrandedTableCell>
          </BrandedTableHeader>
          <tbody>
            {utilization.map((doctor) => {
              const noShowStats = noShow.byDoctor.find((row) => row.doctorId === doctor.doctorId);

              return (
                <BrandedTableRow key={doctor.doctorId}>
                  <BrandedTableCell>{doctor.doctorName}</BrandedTableCell>
                  <BrandedTableCell>
                    {formatPercent(noShowStats?.rate ?? null)}
                  </BrandedTableCell>
                  <BrandedTableCell>{noShowStats?.completed ?? 0}</BrandedTableCell>
                  <BrandedTableCell>{noShowStats?.noShow ?? 0}</BrandedTableCell>
                  <BrandedTableCell>{formatPercent(doctor.utilization)}</BrandedTableCell>
                  <BrandedTableCell>{doctor.booked}</BrandedTableCell>
                  <BrandedTableCell>{doctor.capacity}</BrandedTableCell>
                </BrandedTableRow>
              );
            })}
            {utilization.length === 0 && (
              <BrandedTableRow>
                <BrandedTableCell colSpan={7} className="text-center py-6">
                  No doctors to report on.
                </BrandedTableCell>
              </BrandedTableRow>
            )}
          </tbody>
        </BrandedTable>
      </div>
    </div>
  );
}
