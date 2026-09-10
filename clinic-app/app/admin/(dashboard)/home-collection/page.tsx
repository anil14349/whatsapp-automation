import { getSupabaseServerClient } from "@/lib/supabase/server";
import { listHomeCollectionRequests } from "@/lib/homeCollection";
import { HOME_COLLECTION_STATUSES } from "@/lib/homeCollectionStatus";
import { requireAdminRole } from "@/lib/auth/authorize";
import { HomeCollectionRowActions } from "./HomeCollectionRowActions";
import {
  BrandedSelect,
  BrandedButton,
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell
} from "@/app/admin/(dashboard)/components/branded";

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

      <form className="mt-4 flex flex-wrap items-end gap-4" method="get">
        <div className="flex-1 min-w-fit">
          <BrandedSelect
            label="Status"
            name="status"
            defaultValue={status ?? ""}
            options={[
              { value: "", label: "All statuses" },
              ...HOME_COLLECTION_STATUSES.map((option) => ({
                value: option,
                label: option
              }))
            ]}
          />
        </div>

        <BrandedButton type="submit" variant="primary">
          Filter
        </BrandedButton>
      </form>

      <div className="mt-6">
        <BrandedTable>
          <BrandedTableHeader>
            <BrandedTableCell>Requested</BrandedTableCell>
            <BrandedTableCell>Patient</BrandedTableCell>
            <BrandedTableCell>Phone</BrandedTableCell>
            <BrandedTableCell>Preferred date</BrandedTableCell>
            <BrandedTableCell>Time window</BrandedTableCell>
            <BrandedTableCell>Distance</BrandedTableCell>
            <BrandedTableCell>Status</BrandedTableCell>
          </BrandedTableHeader>
          <tbody>
            {requests.map((request) => (
              <BrandedTableRow key={request.id}>
                <BrandedTableCell>
                  {new Date(request.created_at).toLocaleDateString()}
                </BrandedTableCell>
                <BrandedTableCell className="font-medium">
                  {request.patient_name || "—"}
                </BrandedTableCell>
                <BrandedTableCell>{request.phone}</BrandedTableCell>
                <BrandedTableCell>{request.preferred_date}</BrandedTableCell>
                <BrandedTableCell>{request.time_window}</BrandedTableCell>
                <BrandedTableCell>{request.distance_km} km</BrandedTableCell>
                <BrandedTableCell>
                  <HomeCollectionRowActions requestId={request.id} status={request.status} />
                </BrandedTableCell>
              </BrandedTableRow>
            ))}
            {requests.length === 0 && (
              <BrandedTableRow>
                <BrandedTableCell colSpan={7} className="text-center py-6">
                  No home collection requests match this filter.
                </BrandedTableCell>
              </BrandedTableRow>
            )}
          </tbody>
        </BrandedTable>
      </div>
    </div>
  );
}
