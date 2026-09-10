"use client";

import { useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminRole } from "@/lib/auth/authorize";
import { EditPatientNameModal } from "./EditPatientNameModal";
import type { Patient } from "@/lib/patients";

export default async function PatientsPage({
  searchParams
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdminRole(["ADMIN", "RECEPTIONIST"]);
  const { q } = await searchParams;
  const supabase = getSupabaseServerClient();

  let query = supabase
    .from("patients")
    .select("*")
    .order("last_visit_at", { ascending: false, nullsFirst: false })
    .limit(100);

  if (q) {
    // Search by name or phone — phone lookups won't have punctuation
    // (numbers are normalized on write), name search is a simple
    // case-insensitive partial match.
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%`);
  }

  const { data: patients, error } = await query;

  if (error) {
    throw new Error(`Failed to load patients: ${error.message}`);
  }

  return <PatientsContent patients={patients} />;
}

function PatientsContent({ patients }: { patients: Patient[] }) {
  const [editingPatient, setEditingPatient] = useState<Patient | null>(null);
  const [patientsList, setPatientsList] = useState(patients);

  const handleEditSuccess = (updatedPatient: Patient) => {
    setPatientsList((prev) =>
      prev.map((p) => (p.id === updatedPatient.id ? updatedPatient : p))
    );
  };

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Patients</h1>
      <p className="mt-1 text-sm text-slate-500">Patient registry with edit capabilities.</p>

      <form className="mt-4" method="get">
        <input
          type="search"
          name="q"
          placeholder="Search by name or phone…"
          className="w-full max-w-sm rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </form>

      <div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Language</th>
              <th className="px-4 py-3">Patient code</th>
              <th className="px-4 py-3">Last visit</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {patientsList.map((patient) => (
              <tr key={patient.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{patient.name || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{patient.phone}</td>
                <td className="px-4 py-3 text-slate-500">{patient.language}</td>
                <td className="px-4 py-3 text-slate-500">{patient.patient_code}</td>
                <td className="px-4 py-3 text-slate-500">
                  {patient.last_visit_at
                    ? new Date(patient.last_visit_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setEditingPatient(patient)}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Edit Name
                  </button>
                </td>
              </tr>
            ))}
            {patientsList.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No patients found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingPatient && (
        <EditPatientNameModal
          patient={editingPatient}
          onClose={() => setEditingPatient(null)}
          onSuccess={() => {
            const updatedPatient = { ...editingPatient, name: editingPatient.name };
            handleEditSuccess(updatedPatient);
            setEditingPatient(null);
          }}
        />
      )}
    </div>
  );
}
