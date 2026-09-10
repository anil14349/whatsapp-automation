"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateWebhookSettingsAction } from "./actions";
import { BrandedButton, BrandedInput, BrandedTextarea } from "@/app/admin/(dashboard)/components/branded";

interface WebhookSettingsFormProps {
  initialSettings?: any;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <BrandedButton
      type="submit"
      disabled={pending}
      variant="primary"
    >
      {pending ? "Saving…" : "Save Settings"}
    </BrandedButton>
  );
}

export function WebhookSettingsForm({ initialSettings }: WebhookSettingsFormProps) {
  const [state, formAction] = useFormState(updateWebhookSettingsAction, {});

  const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/webhooks/whatsapp`;

  return (
    <form action={formAction} className="space-y-4 max-w-2xl">
      <div className="rounded-md bg-blue-50 border border-blue-200 p-4 text-sm text-blue-700">
        <p className="font-medium">📋 WhatsApp Webhook Configuration</p>
        <p className="mt-2">
          Use the following values in your WhatsApp Business API settings:
        </p>
        <div className="mt-3 space-y-2 font-mono text-xs bg-white p-2 rounded border border-blue-100">
          <div>
            <strong>Webhook URL:</strong>
            <div className="break-all text-slate-600">{webhookUrl}</div>
          </div>
          <div>
            <strong>Verify Token:</strong>
            <div className="text-slate-600">Set in environment (WHATSAPP_VERIFY_TOKEN)</div>
          </div>
        </div>
      </div>

      <BrandedInput
        label="WhatsApp Business Account ID"
        name="whatsappBusinessAccountId"
        defaultValue={initialSettings?.whatsapp_business_account_id || ""}
        placeholder="123456789"
        helperText="Found in your WhatsApp Business settings"
      />

      <BrandedInput
        label="WhatsApp Verify Token"
        name="whatsappVerifyToken"
        type="password"
        defaultValue={initialSettings?.whatsapp_verify_token || ""}
        placeholder="Your secure verify token"
        helperText="This token is used to verify webhook requests. Keep it secret!"
      />

      <div className="flex items-center gap-2">
        <input
          id="webhookEnabled"
          name="webhookEnabled"
          type="checkbox"
          defaultChecked={initialSettings?.whatsapp_webhook_enabled ?? true}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        <label htmlFor="webhookEnabled" className="text-sm text-slate-700">
          Enable WhatsApp Webhooks
        </label>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="autoProcessBookings"
          name="autoProcessBookings"
          type="checkbox"
          defaultChecked={initialSettings?.auto_process_bookings ?? true}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        <label htmlFor="autoProcessBookings" className="text-sm text-slate-700">
          Auto-process booking requests from messages
        </label>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="autoSendConfirmations"
          name="autoSendConfirmations"
          type="checkbox"
          defaultChecked={initialSettings?.auto_send_confirmations ?? true}
          className="h-4 w-4 rounded border-slate-300 text-brand-600"
        />
        <label htmlFor="autoSendConfirmations" className="text-sm text-slate-700">
          Auto-send confirmation messages
        </label>
      </div>

      {state.error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
          ✅ Webhook settings saved successfully
        </div>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}
