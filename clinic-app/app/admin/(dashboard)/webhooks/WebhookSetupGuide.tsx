"use client";

import { BrandedCard } from "@/app/admin/(dashboard)/components/branded";

export function WebhookSetupGuide() {
  return (
    <BrandedCard title="🚀 Setup Guide" className="border-green-200 bg-green-50">
      <div className="space-y-4 text-sm text-green-900">
        <div>
          <h3 className="font-semibold mb-2">Step 1: Create WhatsApp Business Account</h3>
          <p className="text-green-800">
            Go to <code className="bg-green-100 px-2 py-1 rounded">developers.facebook.com</code> and create a WhatsApp Business Account.
          </p>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Step 2: Get Your Credentials</h3>
          <ul className="list-disc list-inside space-y-1 text-green-800">
            <li>Access Token (in App Dashboard)</li>
            <li>Business Account ID (in WhatsApp Settings)</li>
            <li>Phone Number ID (associated with your number)</li>
          </ul>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Step 3: Configure Webhook</h3>
          <ol className="list-decimal list-inside space-y-2 text-green-800">
            <li>Fill in the webhook settings below</li>
            <li>Copy your Webhook URL and Verify Token</li>
            <li>In WhatsApp Settings → Webhooks:
              <ul className="list-disc list-inside ml-5 mt-1">
                <li>Paste the Webhook URL</li>
                <li>Paste the Verify Token</li>
                <li>Subscribe to message and message_status events</li>
              </ul>
            </li>
            <li>Click Verify and Save</li>
          </ol>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Step 4: Test Connection</h3>
          <p className="text-green-800">
            Send a test message from WhatsApp to verify the webhook is working. Check the "Recent Events" section below to see incoming messages.
          </p>
        </div>

        <div className="bg-green-100 p-3 rounded-md border border-green-300 mt-3">
          <p className="text-xs font-mono">
            <strong>Webhook URL:</strong> yourapp.com/api/webhooks/whatsapp
          </p>
        </div>
      </div>
    </BrandedCard>
  );
}
