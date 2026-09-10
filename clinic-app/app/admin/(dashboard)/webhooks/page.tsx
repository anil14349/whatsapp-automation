import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminRole } from "@/lib/auth/authorize";
import { BrandedCard, BrandedButton, BrandedInput, BrandedTable, BrandedTableHeader, BrandedTableRow, BrandedTableCell, BrandedBadge } from "@/app/admin/(dashboard)/components/branded";
import { WebhookSettingsForm } from "./WebhookSettingsForm";
import { WebhookEventsList } from "./WebhookEventsList";
import { WebhookSetupGuide } from "./WebhookSetupGuide";

export default async function WebhooksPage() {
  await requireAdminRole(["ADMIN"]);
  const supabase = getSupabaseServerClient();

  // Get webhook settings
  const { data: settings } = await supabase
    .from("webhook_settings")
    .select("*")
    .limit(1)
    .single();

  // Get recent webhook events
  const { data: events } = await supabase
    .from("webhook_events")
    .select("*")
    .eq("source", "whatsapp")
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Webhook Configuration</h1>
        <p className="mt-1 text-sm text-slate-600">
          Manage WhatsApp webhooks and monitor incoming events
        </p>
      </div>

      {/* Webhook Setup Guide */}
      <WebhookSetupGuide />

      {/* Settings */}
      <BrandedCard title="Webhook Settings" className="mt-6">
        <WebhookSettingsForm initialSettings={settings} />
      </BrandedCard>

      {/* Recent Events */}
      <BrandedCard title="Recent Events" className="mt-6">
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Last 10 webhook events from WhatsApp
          </p>

          {events && events.length > 0 ? (
            <BrandedTable>
              <BrandedTableHeader>
                <BrandedTableCell>Time</BrandedTableCell>
                <BrandedTableCell>Type</BrandedTableCell>
                <BrandedTableCell>Status</BrandedTableCell>
                <BrandedTableCell>Retries</BrandedTableCell>
              </BrandedTableHeader>
              <tbody>
                {events.map((event) => (
                  <BrandedTableRow key={event.id}>
                    <BrandedTableCell>
                      {new Date(event.created_at).toLocaleString()}
                    </BrandedTableCell>
                    <BrandedTableCell>{event.event_type}</BrandedTableCell>
                    <BrandedTableCell>
                      <BrandedBadge
                        variant={
                          event.status === "processed"
                            ? "success"
                            : event.status === "failed"
                            ? "danger"
                            : event.status === "retrying"
                            ? "warning"
                            : "default"
                        }
                        size="sm"
                      >
                        {event.status}
                      </BrandedBadge>
                    </BrandedTableCell>
                    <BrandedTableCell>{event.retry_count}</BrandedTableCell>
                  </BrandedTableRow>
                ))}
              </tbody>
            </BrandedTable>
          ) : (
            <p className="text-sm text-slate-500 py-4">No webhook events yet</p>
          )}
        </div>
      </BrandedCard>

      {/* Health Status */}
      <BrandedCard title="Health Status" className="mt-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {events?.filter((e) => e.status === "processed").length || 0}
            </div>
            <p className="text-xs text-slate-500 mt-1">Processed</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {events?.filter((e) => e.status === "failed").length || 0}
            </div>
            <p className="text-xs text-slate-500 mt-1">Failed</p>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-amber-600">
              {events?.filter((e) => e.status === "retrying").length || 0}
            </div>
            <p className="text-xs text-slate-500 mt-1">Retrying</p>
          </div>
        </div>
      </BrandedCard>

      {/* Test Webhook Button */}
      <BrandedCard className="mt-6 border-blue-200 bg-blue-50">
        <h3 className="text-sm font-semibold text-blue-900">💡 Testing</h3>
        <p className="mt-2 text-sm text-blue-700">
          To test your webhook configuration, use the WhatsApp Business API test endpoint or send a test message from WhatsApp.
        </p>
        <div className="mt-4">
          <BrandedButton variant="primary" size="sm">
            Send Test Message
          </BrandedButton>
        </div>
      </BrandedCard>
    </div>
  );
}
