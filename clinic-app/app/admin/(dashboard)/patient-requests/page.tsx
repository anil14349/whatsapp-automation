/**
 * Admin Dashboard: Patient Requests
 * Displays and manages all patient requests (lab, prescription, results, etc.)
 */

"use client";

import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import { BrandedCard, BrandedButton, BrandedBadge, BrandedTable, BrandedTableHeader, BrandedTableRow, BrandedTableCell } from "@/app/admin/(dashboard)/components/branded";

interface PatientRequest {
  id: string;
  patient_id: string;
  patient_phone: string;
  request_type: string;
  request_text: string;
  status: string;
  assigned_to?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  patient?: {
    name: string;
  };
}

export default function PatientRequestsPage() {
  const supabase = createClientComponentClient();
  const [requests, setRequests] = useState<PatientRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<PatientRequest | null>(null);
  const [filter, setFilter] = useState<string>("pending");
  const [assigningTo, setAssigningTo] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<any[]>([]);

  useEffect(() => {
    loadRequests();
    loadStaff();
  }, [filter]);

  const loadRequests = async () => {
    try {
      setLoading(true);
      const query = supabase
        .from("patient_requests")
        .select("*, patient:patients(name)", { head: false });

      if (filter !== "all") {
        query.eq("status", filter);
      }

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      setRequests(data || []);
    } catch (error) {
      console.error("Error loading requests:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadStaff = async () => {
    try {
      const { data, error } = await supabase
        .from("admin_users")
        .select("id, full_name")
        .eq("role", "ADMIN");

      if (error) throw error;
      setStaffList(data || []);
    } catch (error) {
      console.error("Error loading staff:", error);
    }
  };

  const handleUpdateStatus = async (requestId: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("patient_requests")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", requestId);

      if (error) throw error;

      // Update local state
      setRequests(requests.map(r => r.id === requestId ? { ...r, status: newStatus } : r));
      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, status: newStatus });
      }
    } catch (error) {
      console.error("Error updating request:", error);
    }
  };

  const handleAssignRequest = async (requestId: string, staffId: string) => {
    try {
      const { error } = await supabase
        .from("patient_requests")
        .update({ assigned_to: staffId, updated_at: new Date().toISOString() })
        .eq("id", requestId);

      if (error) throw error;

      // Update local state
      setRequests(requests.map(r => r.id === requestId ? { ...r, assigned_to: staffId } : r));
      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, assigned_to: staffId });
      }
      setAssigningTo(null);
    } catch (error) {
      console.error("Error assigning request:", error);
    }
  };

  const handleAddNote = async (requestId: string, note: string) => {
    try {
      const { error } = await supabase
        .from("patient_requests")
        .update({ notes: note, updated_at: new Date().toISOString() })
        .eq("id", requestId);

      if (error) throw error;

      // Update local state
      setRequests(requests.map(r => r.id === requestId ? { ...r, notes: note } : r));
      if (selectedRequest?.id === requestId) {
        setSelectedRequest({ ...selectedRequest, notes: note });
      }
    } catch (error) {
      console.error("Error adding note:", error);
    }
  };

  const getRequestTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      lab_collection: "blue",
      prescription: "green",
      results: "purple",
      bill: "orange",
      feedback: "yellow",
      reschedule: "indigo",
      default: "gray"
    };
    return colors[type] || colors.default;
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      pending: "warning",
      acknowledged: "info",
      in_progress: "info",
      resolved: "success",
      default: "default"
    };
    return colors[status] || colors.default;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Patient Requests</h1>
        <p className="text-slate-600 mt-2">Manage and track all patient requests for lab, prescription, results, and more.</p>
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2 flex-wrap">
        <BrandedButton
          variant={filter === "pending" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setFilter("pending")}
        >
          Pending
        </BrandedButton>
        <BrandedButton
          variant={filter === "acknowledged" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setFilter("acknowledged")}
        >
          Acknowledged
        </BrandedButton>
        <BrandedButton
          variant={filter === "in_progress" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setFilter("in_progress")}
        >
          In Progress
        </BrandedButton>
        <BrandedButton
          variant={filter === "resolved" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setFilter("resolved")}
        >
          Resolved
        </BrandedButton>
        <BrandedButton
          variant={filter === "all" ? "primary" : "secondary"}
          size="sm"
          onClick={() => setFilter("all")}
        >
          All
        </BrandedButton>
      </div>

      {/* Requests table */}
      <BrandedCard title={`Requests (${requests.length})`}>
        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : requests.length === 0 ? (
          <p className="text-slate-500">No requests found.</p>
        ) : (
          <BrandedTable>
            <BrandedTableHeader>
              <BrandedTableCell>Patient</BrandedTableCell>
              <BrandedTableCell>Type</BrandedTableCell>
              <BrandedTableCell>Status</BrandedTableCell>
              <BrandedTableCell>Request</BrandedTableCell>
              <BrandedTableCell>Date</BrandedTableCell>
              <BrandedTableCell>Assigned To</BrandedTableCell>
            </BrandedTableHeader>
            <tbody>
              {requests.map((request) => (
                <BrandedTableRow
                  key={request.id}
                  onClick={() => setSelectedRequest(request)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <BrandedTableCell>
                    <div>
                      <p className="font-medium text-slate-900">{request.patient?.name || "Unknown"}</p>
                      <p className="text-xs text-slate-500">{request.patient_phone}</p>
                    </div>
                  </BrandedTableCell>
                  <BrandedTableCell>
                    <BrandedBadge variant={getRequestTypeColor(request.request_type)} size="sm">
                      {request.request_type.replace("_", " ")}
                    </BrandedBadge>
                  </BrandedTableCell>
                  <BrandedTableCell>
                    <BrandedBadge variant={getStatusColor(request.status)} size="sm">
                      {request.status}
                    </BrandedBadge>
                  </BrandedTableCell>
                  <BrandedTableCell className="truncate max-w-xs">
                    {request.request_text}
                  </BrandedTableCell>
                  <BrandedTableCell>
                    {new Date(request.created_at).toLocaleDateString()}
                  </BrandedTableCell>
                  <BrandedTableCell>
                    {request.assigned_to ? (
                      staffList.find(s => s.id === request.assigned_to)?.full_name || "Assigned"
                    ) : (
                      <span className="text-slate-400">Unassigned</span>
                    )}
                  </BrandedTableCell>
                </BrandedTableRow>
              ))}
            </tbody>
          </BrandedTable>
        )}
      </BrandedCard>

      {/* Details panel */}
      {selectedRequest && (
        <BrandedCard title="Request Details" className="border-blue-200 bg-blue-50">
          <div className="space-y-4">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-semibold text-blue-900 uppercase">Patient</p>
                <p className="text-sm text-blue-900 font-medium">{selectedRequest.patient?.name}</p>
                <p className="text-xs text-blue-700">{selectedRequest.patient_phone}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-900 uppercase">Request Type</p>
                <BrandedBadge variant={getRequestTypeColor(selectedRequest.request_type)}>
                  {selectedRequest.request_type.replace("_", " ")}
                </BrandedBadge>
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-900 uppercase">Status</p>
                <div className="flex gap-2 items-center">
                  <BrandedBadge variant={getStatusColor(selectedRequest.status)}>
                    {selectedRequest.status}
                  </BrandedBadge>
                  <select
                    onChange={(e) => handleUpdateStatus(selectedRequest.id, e.target.value)}
                    value={selectedRequest.status}
                    className="text-xs px-2 py-1 rounded border border-blue-200"
                  >
                    <option value="pending">Pending</option>
                    <option value="acknowledged">Acknowledged</option>
                    <option value="in_progress">In Progress</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-blue-900 uppercase">Assigned To</p>
                {assigningTo ? (
                  <select
                    onChange={(e) => handleAssignRequest(selectedRequest.id, e.target.value)}
                    onBlur={() => setAssigningTo(null)}
                    autoFocus
                    defaultValue={selectedRequest.assigned_to || ""}
                    className="text-xs px-2 py-1 rounded border border-blue-200 w-full"
                  >
                    <option value="">Unassigned</option>
                    {staffList.map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.full_name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p
                    onClick={() => setAssigningTo(selectedRequest.id)}
                    className="text-sm cursor-pointer text-blue-600 hover:text-blue-800"
                  >
                    {staffList.find(s => s.id === selectedRequest.assigned_to)?.full_name || "Click to assign"}
                  </p>
                )}
              </div>
            </div>

            {/* Request text */}
            <div>
              <p className="text-xs font-semibold text-blue-900 uppercase">Request Text</p>
              <p className="text-sm text-blue-900 bg-white p-3 rounded border border-blue-200 mt-1">
                {selectedRequest.request_text}
              </p>
            </div>

            {/* Notes */}
            <div>
              <p className="text-xs font-semibold text-blue-900 uppercase">Notes</p>
              <textarea
                defaultValue={selectedRequest.notes || ""}
                onBlur={(e) => handleAddNote(selectedRequest.id, e.target.value)}
                placeholder="Add notes about this request..."
                className="w-full text-sm p-2 rounded border border-blue-200 mt-1"
                rows={3}
              />
            </div>

            {/* Timestamps */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-semibold text-blue-900 uppercase">Created</p>
                <p className="text-blue-700">{new Date(selectedRequest.created_at).toLocaleString()}</p>
              </div>
              <div>
                <p className="font-semibold text-blue-900 uppercase">Updated</p>
                <p className="text-blue-700">{new Date(selectedRequest.updated_at).toLocaleString()}</p>
              </div>
            </div>

            {/* Close button */}
            <BrandedButton
              variant="secondary"
              size="sm"
              onClick={() => setSelectedRequest(null)}
            >
              Close
            </BrandedButton>
          </div>
        </BrandedCard>
      )}
    </div>
  );
}
