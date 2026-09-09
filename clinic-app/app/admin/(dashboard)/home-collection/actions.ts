"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { updateHomeCollectionStatus, type HomeCollectionStatus } from "@/lib/homeCollection";
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
