/**
 * Status Update Processor for WhatsApp Delivery Reports
 * Handles message delivery status updates (sent, delivered, read, failed)
 */

import { createClient } from "@supabase/supabase-js";

export interface WhatsAppStatusUpdate {
  id: string; // WhatsApp message ID
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: number;
  recipient_id?: string;
  error?: {
    code: number;
    title: string;
    message: string;
  };
}

export interface StatusProcessingResult {
  success: boolean;
  messageId: string;
  status: string;
  error?: string;
}

/**
 * Extract status updates from WhatsApp webhook payload
 */
export function extractStatusUpdates(payload: any): WhatsAppStatusUpdate[] {
  const updates: WhatsAppStatusUpdate[] = [];

  try {
    const entry = payload.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.statuses) {
      return updates;
    }

    for (const status of value.statuses) {
      const statusUpdate: WhatsAppStatusUpdate = {
        id: status.id,
        status: status.status,
        timestamp: status.timestamp,
        recipient_id: status.recipient_id,
        error: status.errors?.[0],
      };

      updates.push(statusUpdate);
    }
  } catch (error) {
    console.error("Error extracting status updates:", error);
  }

  return updates;
}

/**
 * Process a single status update
 */
export async function processStatusUpdate(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  statusUpdate: WhatsAppStatusUpdate
): Promise<StatusProcessingResult> {
  try {
    // Find the message by WhatsApp message ID
    const { data: message, error: findError } = await supabase
      .from("messages")
      .select("*")
      .eq("whatsapp_message_id", statusUpdate.id)
      .eq("clinic_id", clinicId)
      .single();

    if (findError || !message) {
      // Message not found - could be from another clinic or system message
      return {
        success: false,
        messageId: statusUpdate.id,
        status: statusUpdate.status,
        error: "Message not found",
      };
    }

    // Prepare update data based on status
    const updateData: any = {
      status: statusUpdate.status,
      updated_at: new Date().toISOString(),
    };

    // Set appropriate timestamp
    switch (statusUpdate.status) {
      case "sent":
        updateData.sent_at = new Date(statusUpdate.timestamp * 1000).toISOString();
        break;
      case "delivered":
        updateData.delivered_at = new Date(statusUpdate.timestamp * 1000).toISOString();
        break;
      case "read":
        updateData.read_at = new Date(statusUpdate.timestamp * 1000).toISOString();
        break;
      case "failed":
        updateData.failed_at = new Date(statusUpdate.timestamp * 1000).toISOString();
        if (statusUpdate.error) {
          updateData.error_message = `${statusUpdate.error.title}: ${statusUpdate.error.message}`;
        }
        break;
    }

    // Update message in database
    const { error: updateError } = await supabase
      .from("messages")
      .update(updateData)
      .eq("id", message.id)
      .eq("clinic_id", clinicId);

    if (updateError) {
      throw updateError;
    }

    // Update analytics
    await updateDeliveryStats(supabase, clinicId, statusUpdate.status);

    return {
      success: true,
      messageId: statusUpdate.id,
      status: statusUpdate.status,
    };
  } catch (error) {
    return {
      success: false,
      messageId: statusUpdate.id,
      status: statusUpdate.status,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Process all status updates from a webhook payload
 */
export async function processStatusUpdates(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  payload: any
): Promise<StatusProcessingResult[]> {
  const statusUpdates = extractStatusUpdates(payload);
  const results: StatusProcessingResult[] = [];

  for (const update of statusUpdates) {
    const result = await processStatusUpdate(supabase, clinicId, update);
    results.push(result);
  }

  return results;
}

/**
 * Update daily delivery statistics
 */
async function updateDeliveryStats(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  status: string
): Promise<void> {
  try {
    const today = new Date().toISOString().split("T")[0];

    // Get or create today's stats
    const { data: existingStats, error: fetchError } = await supabase
      .from("message_delivery_stats")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("date", today)
      .single();

    if (fetchError && fetchError.code !== "PGRST116") {
      throw fetchError;
    }

    if (!existingStats) {
      // Create new stats record
      const newStats: any = {
        clinic_id: clinicId,
        date: today,
      };

      // Set count based on status
      switch (status) {
        case "sent":
          newStats.total_sent = 1;
          break;
        case "delivered":
          newStats.total_delivered = 1;
          break;
        case "read":
          newStats.total_read = 1;
          break;
        case "failed":
          newStats.total_failed = 1;
          break;
      }

      await supabase
        .from("message_delivery_stats")
        .insert([newStats]);
    } else {
      // Update existing stats
      const updateData: any = { updated_at: new Date().toISOString() };

      switch (status) {
        case "sent":
          updateData.total_sent = (existingStats.total_sent || 0) + 1;
          break;
        case "delivered":
          updateData.total_delivered = (existingStats.total_delivered || 0) + 1;
          break;
        case "read":
          updateData.total_read = (existingStats.total_read || 0) + 1;
          break;
        case "failed":
          updateData.total_failed = (existingStats.total_failed || 0) + 1;
          break;
      }

      await supabase
        .from("message_delivery_stats")
        .update(updateData)
        .eq("id", existingStats.id);
    }
  } catch (error) {
    console.error("Error updating delivery stats:", error);
    // Don't throw - analytics failure shouldn't break message processing
  }
}

/**
 * Get message delivery summary for a clinic
 */
export async function getDeliverySummary(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  days: number = 7
): Promise<any> {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const { data: stats, error } = await supabase
      .from("message_delivery_stats")
      .select("*")
      .eq("clinic_id", clinicId)
      .gte("date", startDate.toISOString().split("T")[0])
      .order("date", { ascending: false });

    if (error) throw error;

    // Calculate totals
    const summary = {
      period_days: days,
      total_sent: 0,
      total_delivered: 0,
      total_read: 0,
      total_failed: 0,
      delivery_rate: 0,
      read_rate: 0,
    };

    for (const stat of stats || []) {
      summary.total_sent += stat.total_sent || 0;
      summary.total_delivered += stat.total_delivered || 0;
      summary.total_read += stat.total_read || 0;
      summary.total_failed += stat.total_failed || 0;
    }

    // Calculate rates
    if (summary.total_sent > 0) {
      summary.delivery_rate = (summary.total_delivered / summary.total_sent) * 100;
      summary.read_rate = (summary.total_read / summary.total_sent) * 100;
    }

    return summary;
  } catch (error) {
    console.error("Error getting delivery summary:", error);
    return null;
  }
}

/**
 * Get failed messages for a clinic
 */
export async function getFailedMessages(
  supabase: ReturnType<typeof createClient>,
  clinicId: string,
  limit: number = 50
): Promise<any[]> {
  try {
    const { data: messages, error } = await supabase
      .from("messages")
      .select("*")
      .eq("clinic_id", clinicId)
      .eq("status", "failed")
      .order("failed_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return messages || [];
  } catch (error) {
    console.error("Error getting failed messages:", error);
    return [];
  }
}
