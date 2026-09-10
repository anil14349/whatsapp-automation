"use client";

export function TriggerSettingsManager() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <p className="text-slate-600">Settings manager component</p>
        <p className="mt-2 text-sm text-slate-500">
          Manage clinic-specific settings like home collection radius, max booking days, reminder timing
        </p>
      </div>
    </div>
  );
}
