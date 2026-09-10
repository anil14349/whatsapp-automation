"use client";

import { useState } from "react";
import { Tab } from "@headlessui/react";
import { BrandedCard } from "@/app/admin/(dashboard)/components/branded";
import { TriggerMenusManager } from "./TriggerMenusManager";
import { TriggerTemplatesManager } from "./TriggerTemplatesManager";
import { TriggerSettingsManager } from "./TriggerSettingsManager";
import { TriggerCronJobsManager } from "./TriggerCronJobsManager";

export default function TriggersPage() {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const tabs = [
    { name: "📋 Menus", component: TriggerMenusManager },
    { name: "💬 Templates", component: TriggerTemplatesManager },
    { name: "⚙️ Settings", component: TriggerSettingsManager },
    { name: "⏰ Cron Jobs", component: TriggerCronJobsManager }
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900">Trigger Configuration</h1>
      <p className="mt-1 text-sm text-slate-500">
        Manage WhatsApp menus, message templates, settings, and scheduled jobs without deploying code.
      </p>

      <div className="mt-6">
        <Tab.Group selectedIndex={selectedIndex} onChange={setSelectedIndex}>
          <Tab.List className="flex space-x-1 rounded-lg bg-slate-100 p-1">
            {tabs.map((tab) => (
              <Tab
                key={tab.name}
                className={({ selected }) =>
                  `px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    selected
                      ? "bg-white text-brand-600 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`
                }
              >
                {tab.name}
              </Tab>
            ))}
          </Tab.List>

          <Tab.Panels className="mt-6">
            {tabs.map((tab, idx) => {
              const Component = tab.component;
              return (
                <Tab.Panel key={idx}>
                  <Component />
                </Tab.Panel>
              );
            })}
          </Tab.Panels>
        </Tab.Group>
      </div>

      <BrandedCard className="mt-8 border-blue-200 bg-blue-50">
        <h3 className="text-sm font-semibold text-blue-900">💡 Tip</h3>
        <p className="mt-1 text-sm text-blue-700">
          Changes to menus and templates are cached for 1 hour. To immediately see changes, manually refresh
          the cache in settings or wait for automatic expiration.
        </p>
      </BrandedCard>
    </div>
  );
}
