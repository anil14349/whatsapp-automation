"use client";

import { useState } from "react";
import { site } from "@/lib/site";

const faqs = [
  {
    q: "Do patients need to install an app?",
    a: "No — only WhatsApp. They send Hi to your clinic number and follow tap menus or type numbers.",
  },
  {
    q: "Who owns the booking system?",
    a: "We host the platform (Meta integration and booking software). You own your WhatsApp number, calendars, and business data. The appointment sheet is shared with your clinic at all times.",
  },
  {
    q: "Can we export our appointments?",
    a: "Yes — download from Google Sheets anytime. On termination we provide a formal export and handover per our service agreement.",
  },
  {
    q: "What does the monthly fee cover?",
    a: "Hosting, webhook maintenance, monitoring, updates, bug fixes, and direct support — not ownership of source code.",
  },
  {
    q: "Do you support Telugu and Hindi?",
    a: "Yes — patient flows support English, Telugu, and Hindi.",
  },
  {
    q: "Who supports us after go-live?",
    a: `Direct support from ${site.contactName} — no call-center ticket queue.`,
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <div className="text-center">
          <p className="section-label">FAQ</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Common questions
          </h2>
        </div>

        <div className="mt-12 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white shadow-soft">
          {faqs.map((item, i) => {
            const buttonId = `faq-button-${i}`;
            const panelId = `faq-panel-${i}`;
            const isOpen = open === i;

            return (
              <div key={item.q}>
                <button
                  id={buttonId}
                  type="button"
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                >
                  <span className="font-semibold text-slate-900">{item.q}</span>
                  <span
                    className={`shrink-0 text-brand-600 transition-transform ${
                      isOpen ? "rotate-45" : ""
                    }`}
                    aria-hidden="true"
                  >
                    +
                  </span>
                </button>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  hidden={!isOpen}
                  className="px-6 pb-5 text-slate-600 leading-relaxed"
                >
                  {item.a}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
