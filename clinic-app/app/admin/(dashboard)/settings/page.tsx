import { redirect } from "next/navigation";
import Link from "next/link";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getAllSettings } from "@/lib/settings";
import { requireAdminRole } from "@/lib/auth/authorize";
import { getAdminSession } from "@/lib/auth/session";
import { SettingsForm } from "./SettingsForm";
import { BrandingSettingsPage } from "./branding/BrandingSettingsPage";

const SETTINGS_TABS = [
  { id: "bot", label: "Bot Settings", href: "/admin/settings" },
  { id: "branding", label: "Branding", href: "/admin/settings?tab=branding" }
];

interface SettingsPageProps {
  searchParams: { tab?: string };
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  await requireAdminRole(["ADMIN"]);
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  const tab = searchParams.tab || "bot";
  const supabase = getSupabaseServerClient();
  const settings = await getAllSettings(supabase);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-600">
          Configure your clinic's WhatsApp bot and branding.
        </p>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200">
        <div className="flex gap-4">
          {SETTINGS_TABS.map((tabItem) => (
            <Link
              key={tabItem.id}
              href={tabItem.href}
              className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                tab === tabItem.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {tabItem.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {tab === "bot" && (
        <div className="max-w-2xl">
          <p className="text-sm text-slate-500 mb-6">
            Configuration for the WhatsApp bot — changes apply to the next message the bot sends.
          </p>
          <SettingsForm settings={settings} />
        </div>
      )}

      {tab === "branding" && (
        <BrandingSettingsPage clinicId={session.clinic_id} />
      )}
    </div>
  );
}
