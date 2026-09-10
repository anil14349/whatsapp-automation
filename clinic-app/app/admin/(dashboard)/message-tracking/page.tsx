/**
 * Admin Dashboard: Message Tracking
 * Displays message delivery status and analytics
 */

"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { BrandedCard, BrandedBadge, BrandedTable, BrandedTableHeader, BrandedTableRow, BrandedTableCell, BrandedButton } from "@/app/admin/(dashboard)/components/branded";

interface Message {
  id: string;
  patient_phone: string;
  patient_id?: string;
  content: string;
  direction: string;
  message_type: string;
  status: string;
  error_message?: string;
  sent_at?: string;
  delivered_at?: string;
  read_at?: string;
  failed_at?: string;
  created_at: string;
  patient?: {
    name: string;
  };
}

interface DeliveryStats {
  total_sent: number;
  total_delivered: number;
  total_read: number;
  total_failed: number;
  delivery_rate: number;
  read_rate: number;
}

export default function MessageTrackingPage() {
  const supabase = createClientComponentClient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [stats, setStats] = useState<DeliveryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterDirection, setFilterDirection] = useState<string>("all");

  useEffect(() => {
    loadMessages();
    loadStats();
  }, [filterStatus, filterDirection]);

  const loadMessages = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from("messages")
        .select("*, patient:patients(name)", { head: false });

      if (filterStatus !== "all") {
        query = query.eq("status", filterStatus);
      }

      if (filterDirection !== "all") {
        query = query.eq("direction", filterDirection);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;
      setMessages(data || []);
    } catch (error) {
      console.error("Error loading messages:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { data, error } = await supabase
        .from("message_delivery_stats")
        .select("*")
        .order("date", { ascending: false })
        .limit(7);

      if (error) throw error;

      // Calculate totals
      const totals = {
        total_sent: 0,
        total_delivered: 0,
        total_read: 0,
        total_failed: 0
      };

      (data || []).forEach((day) => {
        totals.total_sent += day.total_sent || 0;
        totals.total_delivered += day.total_delivered || 0;
        totals.total_read += day.total_read || 0;
        totals.total_failed += day.total_failed || 0;
      });

      setStats({
        ...totals,
        delivery_rate:
          totals.total_sent > 0
            ? (totals.total_delivered / totals.total_sent) * 100
            : 0,
        read_rate:
          totals.total_sent > 0
            ? (totals.total_read / totals.total_sent) * 100
            : 0
      });
    } catch (error) {
      console.error("Error loading stats:", error);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "warning",
      sent: "info",
      delivered: "success",
      read: "success",
      failed: "danger",
      default: "default"
    };
    return colors[status] || colors.default;
  };

  const getDirectionLabel = (direction: string) => {
    return direction === "to_patient" ? "📤 Outgoing" : "📥 Incoming";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Message Tracking</h1>
        <p className="text-slate-600 mt-2">Track message delivery status and view analytics.</p>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <BrandedCard title="Sent" className="border-blue-200 bg-blue-50">
            <p className="text-3xl font-bold text-blue-900">{stats.total_sent}</p>
          </BrandedCard>
          <BrandedCard title="Delivered" className="border-green-200 bg-green-50">
            <p className="text-3xl font-bold text-green-900">{stats.total_delivered}</p>
          </BrandedCard>
          <BrandedCard title="Read" className="border-purple-200 bg-purple-50">
            <p className="text-3xl font-bold text-purple-900">{stats.total_read}</p>
          </BrandedCard>
          <BrandedCard title="Failed" className="border-red-200 bg-red-50">
            <p className="text-3xl font-bold text-red-900">{stats.total_failed}</p>
          </BrandedCard>
          <BrandedCard title="Delivery Rate" className="border-orange-200 bg-orange-50">
            <p className="text-3xl font-bold text-orange-900">
              {stats.delivery_rate.toFixed(1)}%
            </p>
          </BrandedCard>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div>
          <label className="text-xs font-semibold text-slate-700 uppercase">Status</label>
          <select
            onChange={(e) => setFilterStatus(e.target.value)}
            value={filterStatus}
            className="px-3 py-2 rounded border border-slate-200 text-sm"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="read">Read</option>
            <option value="failed">Failed</option>
          </select>
        </div>

        <div>
          <label className="text-xs font-semibold text-slate-700 uppercase">Direction</label>
          <select
            onChange={(e) => setFilterDirection(e.target.value)}
            value={filterDirection}
            className="px-3 py-2 rounded border border-slate-200 text-sm"
          >
            <option value="all">All</option>
            <option value="to_patient">Outgoing</option>
            <option value="from_patient">Incoming</option>
          </select>
        </div>
      </div>

      {/* Messages table */}
      <BrandedCard title={`Messages (${messages.length})`}>
        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : messages.length === 0 ? (
          <p className="text-slate-500">No messages found.</p>
        ) : (
          <BrandedTable>
            <BrandedTableHeader>
              <BrandedTableCell>Patient</BrandedTableCell>
              <BrandedTableCell>Direction</BrandedTableCell>
              <BrandedTableCell>Content</BrandedTableCell>
              <BrandedTableCell>Status</BrandedTableCell>
              <BrandedTableCell>Time</BrandedTableCell>
              <BrandedTableCell>Action</BrandedTableCell>
            </BrandedTableHeader>
            <tbody>
              {messages.map((message) => (
                <BrandedTableRow key={message.id} className="hover:bg-slate-50">
                  <BrandedTableCell>
                    <div>
                      <p className="font-medium text-slate-900">{message.patient?.name || "Unknown"}</p>
                      <p className="text-xs text-slate-500">{message.patient_phone}</p>
                    </div>
                  </BrandedTableCell>
                  <BrandedTableCell>
                    {getDirectionLabel(message.direction)}
                  </BrandedTableCell>
                  <BrandedTableCell className="max-w-xs truncate">
                    {message.content || <span className="text-slate-400">No text</span>}
                  </BrandedTableCell>
                  <BrandedTableCell>
                    <BrandedBadge variant={getStatusColor(message.status)} size="sm">
                      {message.status}
                    </BrandedBadge>
                  </BrandedTableCell>
                  <BrandedTableCell>
                    <span className="text-xs text-slate-500">
                      {new Date(message.created_at).toLocaleString()}
                    </span>
                  </BrandedTableCell>
                  <BrandedTableCell>
                    <button
                      onClick={() => setSelectedMessage(message)}
                      className="text-xs text-blue-600 hover:text-blue-900 font-medium"
                    >
                      View
                    </button>
                  </BrandedTableCell>
                </BrandedTableRow>
              ))}
            </tbody>
          </BrandedTable>
        )}
      </BrandedCard>

      {/* Message details panel */}
      {selectedMessage && (
        <BrandedCard title="Message Details" className="border-purple-200 bg-purple-50">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-purple-900 uppercase">Patient</p>
                <p className="text-sm text-purple-900 font-medium">{selectedMessage.patient?.name}</p>
                <p className="text-xs text-purple-700">{selectedMessage.patient_phone}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-purple-900 uppercase">Direction</p>
                <p className="text-sm text-purple-900">{getDirectionLabel(selectedMessage.direction)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-purple-900 uppercase">Status</p>
                <BrandedBadge variant={getStatusColor(selectedMessage.status)}>
                  {selectedMessage.status}
                </BrandedBadge>
              </div>
              <div>
                <p className="text-xs font-semibold text-purple-900 uppercase">Type</p>
                <p className="text-sm text-purple-900">{selectedMessage.message_type}</p>
              </div>
            </div>

            {/* Content */}
            <div>
              <p className="text-xs font-semibold text-purple-900 uppercase">Content</p>
              <p className="text-sm text-purple-900 bg-white p-3 rounded border border-purple-200 mt-1">
                {selectedMessage.content || <span className="text-slate-400">No text content</span>}
              </p>
            </div>

            {/* Status timeline */}
            <div>
              <p className="text-xs font-semibold text-purple-900 uppercase mb-2">Status Timeline</p>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between items-center p-2 bg-white rounded border border-purple-200">
                  <span>Created</span>
                  <span className="text-purple-700">{new Date(selectedMessage.created_at).toLocaleString()}</span>
                </div>
                {selectedMessage.sent_at && (
                  <div className="flex justify-between items-center p-2 bg-white rounded border border-green-200">
                    <span>Sent</span>
                    <span className="text-green-700">{new Date(selectedMessage.sent_at).toLocaleString()}</span>
                  </div>
                )}
                {selectedMessage.delivered_at && (
                  <div className="flex justify-between items-center p-2 bg-white rounded border border-green-200">
                    <span>Delivered</span>
                    <span className="text-green-700">{new Date(selectedMessage.delivered_at).toLocaleString()}</span>
                  </div>
                )}
                {selectedMessage.read_at && (
                  <div className="flex justify-between items-center p-2 bg-white rounded border border-green-200">
                    <span>Read</span>
                    <span className="text-green-700">{new Date(selectedMessage.read_at).toLocaleString()}</span>
                  </div>
                )}
                {selectedMessage.failed_at && (
                  <div className="flex justify-between items-center p-2 bg-white rounded border border-red-200">
                    <span>Failed</span>
                    <span className="text-red-700">{new Date(selectedMessage.failed_at).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Error message */}
            {selectedMessage.error_message && (
              <div>
                <p className="text-xs font-semibold text-red-900 uppercase">Error</p>
                <p className="text-sm text-red-900 bg-red-50 p-2 rounded border border-red-200 mt-1">
                  {selectedMessage.error_message}
                </p>
              </div>
            )}

            {/* Close button */}
            <BrandedButton
              variant="secondary"
              size="sm"
              onClick={() => setSelectedMessage(null)}
            >
              Close
            </BrandedButton>
          </div>
        </BrandedCard>
      )}
    </div>
  );
}
