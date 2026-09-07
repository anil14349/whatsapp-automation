"use server";

import { redirect } from "next/navigation";
import { clearAdminSession } from "@/lib/auth/session";

export async function logoutAction(): Promise<void> {
  await clearAdminSession();
  redirect("/admin/login");
}
