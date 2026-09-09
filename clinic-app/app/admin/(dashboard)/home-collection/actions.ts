"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { updateHomeCollectionStatus } from "@/lib/homeCollection";
import type { HomeCollectionStatus } from "@/lib/homeCollectionStatus";
import { assertAdminRole } from "@/lib/auth/authorize";

export async function updateHomeCollectionStatusAction(
  requestId: string,
  status: HomeCollectionStatus
): Promise<void> {
  await assertAdminRole(["ADMIN", "RECEPTIONIST"]);

  const supabase = getSupabaseServerClient();
  await updateHomeCollectionStatus(supabase, requestId, status);

  revalidatePath("/admin/home-collection");
}
