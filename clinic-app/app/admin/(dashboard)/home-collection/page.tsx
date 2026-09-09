import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listHomeCollectionRequests } from "@/lib/homeCollection";
import { HOME_COLLECTION_STATUSES } from "@/lib/homeCollectionStatus";
import { requireAdminRole } from "@/lib/auth/authorize";
import { HomeCollectionRowActions } from "./HomeCollectionRowActions";

export default async function HomeCollectionPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminRole(["ADMIN", "RECEPTIONIST"]);
  const { status } = await searchParams;
  const supabase = getSupabaseServerClient();

  const requests = await listHomeCollectionRequests(
    supabase,
    status ? { status } : {}
  );

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Home Sample Collection</h1>
      <p className="mt-1 text-sm text-slate-500">
        Patient-requested home blood-sample collection — call each patient back to confirm the
        exact visit time, then update its status here.
      </p>

      <form className="mt-4 flex flex-wrap items-end gap-3" method="get">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-700">Status</label>
          <select
            name="status"
            defaultValue={status ?? ""}
            className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            <option value="">All statuses</option>
            {HOME_COLLECTION_STATUSES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Requested</th>
              <th className="px-4 py-3">Patient</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Preferred date</th>
              <th className="px-4 py-3">Time window</th>
              <th className="px-4 py-3">Distance</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {requests.map((request) => (
              <tr key={request.id}>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(request.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 font-medium text-slate-900">
                  {request.patient_name || "—"}
                </td>
                <td className="px-4 py-3 text-slate-500">{request.phone}</td>
                <td className="px-4 py-3 text-slate-700">{request.preferred_date}</td>
                <td className="px-4 py-3 text-slate-700">{request.time_window}</td>
                <td className="px-4 py-3 text-slate-500">{request.distance_km} km</td>
                <td className="px-4 py-3">
                  <HomeCollectionRowActions requestId={request.id} status={request.status} />
                </td>
              </tr>
            ))}
            {requests.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No home collection requests match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
