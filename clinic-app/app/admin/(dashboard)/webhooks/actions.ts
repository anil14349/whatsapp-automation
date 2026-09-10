"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getAdminSession } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export async function updateWebhookSettingsAction(
  _prevState: any,
  formData: FormData
) {
  try {
    const session = await getAdminSession();
    if (!session) {
      redirect("/admin/login");
    }

    const supabase = getSupabaseServerClient();

    const whatsappBusinessAccountId = formData.get("whatsappBusinessAccountId") as string;
    const whatsappVerifyToken = formData.get("whatsappVerifyToken") as string;
    const webhookEnabled = formData.get("webhookEnabled") === "on";
    const autoProcessBookings = formData.get("autoProcessBookings") === "on";
    const autoSendConfirmations = formData.get("autoSendConfirmations") === "on";

    // Validate inputs
    if (!whatsappVerifyToken || whatsappVerifyToken.length < 8) {
      return {
        error: "Verify token must be at least 8 characters"
      };
    }

    // Get existing settings or create new ones
    const { data: existing } = await supabase
      .from("webhook_settings")
      .select("id")
      .eq("clinic_id", session.clinic_id)
      .single();

    const updateData = {
      whatsapp_business_account_id: whatsappBusinessAccountId,
      whatsapp_verify_token: whatsappVerifyToken,
      whatsapp_webhook_enabled: webhookEnabled,
      auto_process_bookings: autoProcessBookings,
      auto_send_confirmations: autoSendConfirmations,
      updated_at: new Date().toISOString()
    };

    if (existing) {
      // Update existing
      const { error } = await supabase
        .from("webhook_settings")
        .update(updateData)
        .eq("clinic_id", session.clinic_id);

      if (error) {
        console.error("Update error:", error);
        return { error: "Failed to update webhook settings" };
      }
    } else {
      // Create new
      const { error } = await supabase
        .from("webhook_settings")
        .insert({
          clinic_id: session.clinic_id,
          ...updateData
        });

      if (error) {
        console.error("Insert error:", error);
        return { error: "Failed to create webhook settings" };
      }
    }

    return {
      success: true,
      message: "Webhook settings saved successfully"
    };
  } catch (error) {
    console.error("Error updating webhook settings:", error);
    return {
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
}
