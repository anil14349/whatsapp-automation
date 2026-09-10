"use client";

import { useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdminRole } from "@/lib/auth/authorize";
import { EditPatientNameModal } from "./EditPatientNameModal";
import type { Patient } from "@/lib/patients";
import {
  BrandedInput,
  BrandedButton,
  BrandedTable,
  BrandedTableHeader,
  BrandedTableRow,
  BrandedTableCell
} from "@/app/admin/(dashboard)/components/branded";

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
        <div className="max-w-sm">
          <BrandedInput
            type="search"
            name="q"
            placeholder="Search by name or phone…"
          />
        </div>
      </form>

      <div className="mt-6">
        <BrandedTable>
          <BrandedTableHeader>
            <BrandedTableCell>Name</BrandedTableCell>
            <BrandedTableCell>Phone</BrandedTableCell>
            <BrandedTableCell>Language</BrandedTableCell>
            <BrandedTableCell>Patient code</BrandedTableCell>
            <BrandedTableCell>Last visit</BrandedTableCell>
            <BrandedTableCell />
          </BrandedTableHeader>
          <tbody>
            {patientsList.map((patient) => (
              <BrandedTableRow key={patient.id}>
                <BrandedTableCell className="font-medium">{patient.name || "—"}</BrandedTableCell>
                <BrandedTableCell>{patient.phone}</BrandedTableCell>
                <BrandedTableCell>{patient.language}</BrandedTableCell>
                <BrandedTableCell>{patient.patient_code}</BrandedTableCell>
                <BrandedTableCell>
                  {patient.last_visit_at
                    ? new Date(patient.last_visit_at).toLocaleDateString()
                    : "—"}
                </BrandedTableCell>
                <BrandedTableCell className="text-right">
                  <BrandedButton
                    size="sm"
                    variant="primary"
                    onClick={() => setEditingPatient(patient)}
                  >
                    Edit Name
                  </BrandedButton>
                </BrandedTableCell>
              </BrandedTableRow>
            ))}
            {patientsList.length === 0 && (
              <BrandedTableRow>
                <BrandedTableCell colSpan={6} className="text-center py-6">
                  No patients found.
                </BrandedTableCell>
              </BrandedTableRow>
            )}
          </tbody>
        </BrandedTable>
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
