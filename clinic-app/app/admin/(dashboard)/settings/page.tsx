import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getAllSettings } from "@/lib/settings";
import { requireAdminRole } from "@/lib/auth/authorize";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  await requireAdminRole(["ADMIN"]);
  const supabase = getSupabaseServerClient();
  const settings = await getAllSettings(supabase);

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
      <p className="mt-1 text-sm text-slate-500">
        Configuration for the WhatsApp bot — changes apply to the next message the bot sends.
      </p>

      <div className="mt-6">
        <SettingsForm settings={settings} />
      </div>
    </div>
  );
}
