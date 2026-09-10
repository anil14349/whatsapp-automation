"use client";

export function TriggerTemplatesManager() {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <p className="text-slate-600">Templates manager component (similar to menus)</p>
        <p className="mt-2 text-sm text-slate-500">
          Allows editing message templates with {{variable}} placeholders
        </p>
      </div>
    </div>
  );
}
