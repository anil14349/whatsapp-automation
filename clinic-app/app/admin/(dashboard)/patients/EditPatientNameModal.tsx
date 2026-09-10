"use client";

import { useTransition, useState } from "react";
import { editPatientNameAction } from "../appointments/actions";
import type { Patient } from "@/lib/patients";
import { BrandedButton, BrandedInput } from "@/app/admin/(dashboard)/components/branded";

interface EditPatientNameModalProps {
  patient: Patient;
  onClose: () => void;
  onSuccess: () => void;
}

export function EditPatientNameModal({
  patient,
  onClose,
  onSuccess
}: EditPatientNameModalProps) {
  const [isPending, startTransition] = useTransition();
  const [newName, setNewName] = useState(patient.name || "");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!newName.trim()) {
      setError("Name cannot be empty");
      return;
    }

    if (newName.trim().length < 2) {
      setError("Name must be at least 2 characters");
      return;
    }

    if (newName === patient.name) {
      setError("Name has not changed");
      return;
    }

    startTransition(async () => {
      const result = await editPatientNameAction(patient.id, newName.trim());
      if (result.success) {
        onSuccess();
        onClose();
      } else {
        setError(result.message);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Edit Patient Name</h2>
        <p className="mt-1 text-sm text-slate-500">Update patient information</p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <BrandedInput
            label="Phone"
            type="text"
            value={patient.phone}
            disabled
          />

          <BrandedInput
            label="Patient Name"
            id="name"
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setError("");
            }}
            placeholder="Enter patient name"
            autoFocus
          />

          <BrandedInput
            label="Patient Code"
            type="text"
            value={patient.patient_code}
            disabled
          />

          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-3 pt-4">
            <BrandedButton
              type="button"
              onClick={onClose}
              disabled={isPending}
              variant="secondary"
            >
              Cancel
            </BrandedButton>
            <BrandedButton
              type="submit"
              disabled={isPending}
              variant="primary"
            >
              {isPending ? "Saving..." : "Save Name"}
            </BrandedButton>
          </div>
        </form>
      </div>
    </div>
  );
}
