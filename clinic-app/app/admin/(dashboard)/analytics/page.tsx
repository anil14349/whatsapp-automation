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

const DEFAULT_RANGE_DAYS = 30;
// Hard ceiling on how wide a range the date filter form will accept —
// without this, a typo'd/handcrafted year in the query string (e.g.
// ?from=0001-01-01) would make enumerateDateRange build a
// multi-hundred-thousand-entry array once per doctor for the
// utilization/capacity computation, and render one bar per day.
const MAX_RANGE_DAYS = 366;

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-slate-900">{value}</p>
    </div>
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

      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">From</label>
          <input
            type="date"
            name="from"
            defaultValue={fromDate}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">To</label>
          <input
            type="date"
            name="to"
            defaultValue={toDate}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          />
        </div>

        <button
          type="submit"
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Total bookings" value={totalBookings} />
        <StatCard label="Overall no-show rate" value={formatPercent(noShow.overall.rate)} />
        <StatCard label="Doctors reporting" value={utilization.length} />
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Booking volume by day</h2>
        <p className="mt-0.5 text-xs text-slate-500">Includes appointments of every status.</p>

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
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Doctor</th>
              <th className="px-4 py-3">No-show rate</th>
              <th className="px-4 py-3">Completed</th>
              <th className="px-4 py-3">No-shows</th>
              <th className="px-4 py-3">Utilization</th>
              <th className="px-4 py-3">Booked</th>
              <th className="px-4 py-3">Capacity</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {utilization.map((doctor) => {
              const noShowStats = noShow.byDoctor.find((row) => row.doctorId === doctor.doctorId);

              return (
                <tr key={doctor.doctorId}>
                  <td className="px-4 py-3 text-slate-700">{doctor.doctorName}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatPercent(noShowStats?.rate ?? null)}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{noShowStats?.completed ?? 0}</td>
                  <td className="px-4 py-3 text-slate-500">{noShowStats?.noShow ?? 0}</td>
                  <td className="px-4 py-3 text-slate-700">{formatPercent(doctor.utilization)}</td>
                  <td className="px-4 py-3 text-slate-500">{doctor.booked}</td>
                  <td className="px-4 py-3 text-slate-500">{doctor.capacity}</td>
                </tr>
              );
            })}
            {utilization.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No doctors to report on.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
