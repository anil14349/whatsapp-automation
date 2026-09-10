"use client";

import { useTransition, useState } from "react";
import { editPatientNameAction } from "../appointments/actions";
import type { Patient } from "@/lib/patients";

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
          <div>
            <label className="block text-sm font-medium text-slate-700">Phone</label>
            <input
              type="text"
              value={patient.phone}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700">
              Patient Name
            </label>
            <input
              id="name"
              type="text"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setError("");
              }}
              placeholder="Enter patient name"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Patient Code</label>
            <input
              type="text"
              value={patient.patient_code}
              disabled
              className="mt-1 w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-500"
            />
          </div>

          {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>}

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {isPending ? "Saving..." : "Save Name"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
