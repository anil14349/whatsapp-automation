"use client";

import { useEffect, useState } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";

interface MenuOption {
  id: string;
  label: string;
  description?: string;
}

interface Menu {
  id: string;
  trigger_key: string;
  language: string;
  title: string;
  description?: string;
  options: MenuOption[];
  footer?: string;
  enabled: boolean;
}

const LANGUAGES = [
  { code: "EN", name: "English" },
  { code: "TE", name: "తెలుగు (Telugu)" },
  { code: "HI", name: "हिन्दी (Hindi)" },
  { code: "KA", name: "ಕನ್ನಡ (Kannada)" },
  { code: "TA", name: "தமிழ் (Tamil)" },
  { code: "ML", name: "മലയാളം (Malayalam)" }
];

export function TriggerMenusManager() {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMenus();
  }, []);

  async function loadMenus() {
    try {
      setLoading(true);
      const supabase = getSupabaseServerClient();

      const { data, error: fetchError } = await supabase
        .from("trigger_menus")
        .select("*")
        .order("trigger_key")
        .order("language");

      if (fetchError) throw fetchError;

      setMenus(data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load menus");
    } finally {
      setLoading(false);
    }
  }

  async function saveMenu(menu: Menu) {
    try {
      const supabase = getSupabaseServerClient();

      const { error: updateError } = await supabase
        .from("trigger_menus")
        .update(menu)
        .eq("id", menu.id);

      if (updateError) throw updateError;

      setMenus(menus.map((m) => (m.id === menu.id ? menu : m)));
      setEditingMenu(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save menu");
    }
  }

  if (loading) {
    return <div className="text-center text-slate-500">Loading menus...</div>;
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

      <div className="grid gap-4">
        {menus.map((menu) => (
          <div key={menu.id} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{menu.trigger_key}</h3>
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                    {menu.language}
                  </span>
                  {!menu.enabled && <span className="text-xs text-red-600">DISABLED</span>}
                </div>

                <p className="mt-1 text-sm text-slate-600">{menu.title}</p>
                <p className="text-xs text-slate-500">{menu.description}</p>

                <div className="mt-2 space-y-1">
                  {menu.options.map((opt) => (
                    <div key={opt.id} className="text-xs text-slate-600">
                      {opt.id}. {opt.label}
                      {opt.description && ` — ${opt.description}`}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={() => setEditingMenu(menu)}
                className="rounded-md bg-brand-50 px-3 py-2 text-sm font-medium text-brand-600 hover:bg-brand-100"
              >
                Edit
              </button>
            </div>
          </div>
        ))}
      </div>

      {editingMenu && (
        <MenuEditModal
          menu={editingMenu}
          onSave={saveMenu}
          onClose={() => setEditingMenu(null)}
        />
      )}
    </div>
  );
}

function MenuEditModal({
  menu,
  onSave,
  onClose
}: {
  menu: Menu;
  onSave: (menu: Menu) => void;
  onClose: () => void;
}) {
  const [edited, setEdited] = useState(menu);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave(edited);
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="w-full max-w-2xl rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Edit Menu</h2>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Title</label>
            <input
              type="text"
              value={edited.title}
              onChange={(e) => setEdited({ ...edited, title: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={edited.description || ""}
              onChange={(e) => setEdited({ ...edited, description: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Footer</label>
            <input
              type="text"
              value={edited.footer || ""}
              onChange={(e) => setEdited({ ...edited, footer: e.target.value })}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={edited.enabled}
              onChange={(e) => setEdited({ ...edited, enabled: e.target.checked })}
              className="rounded"
            />
            <label className="text-sm font-medium text-slate-700">Enabled</label>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Menu Options (JSON)</label>
            <textarea
              value={JSON.stringify(edited.options, null, 2)}
              onChange={(e) => {
                try {
                  const options = JSON.parse(e.target.value);
                  setEdited({ ...edited, options });
                } catch {
                  // Invalid JSON, ignore
                }
              }}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
              rows={6}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
