import type { ReactNode } from "react";
import { demoUrl, site } from "@/lib/site";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";

export function Hero() {
  return (
    <section id="demo" className="gradient-hero pt-28 pb-16 sm:pt-32 sm:pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <p className="section-label mb-4">
              Hosted platform · {site.city}
            </p>
            <h1 className="text-balance text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
              WhatsApp booking for your clinic —{" "}
              <span className="text-brand-700">we host it,</span> you own the
              data
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
              Patients book and get reminders on{" "}
              <strong className="font-semibold text-slate-800">
                your WhatsApp number
              </strong>
              . Appointments live in a{" "}
              <strong className="font-semibold text-slate-800">
                Google Sheet shared with you
              </strong>
              . We handle Meta, webhooks, and updates.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <a
                href={demoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-whatsapp px-6 py-3.5 text-base font-semibold text-white shadow-lg transition hover:brightness-105"
              >
                <WhatsAppIcon className="h-5 w-5" />
                Book a free demo
              </a>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3.5 text-base font-semibold text-slate-700 transition hover:border-brand-300 hover:text-brand-700"
              >
                See how it works
              </a>
            </div>

            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              {[
                "No app for patients",
                "EN · TE · HI",
                "Doctor portal",
                "Auto reminders",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckDot />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-brand-400/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-card">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-red-400" />
                  <span className="h-3 w-3 rounded-full bg-amber-400" />
                  <span className="h-3 w-3 rounded-full bg-green-400" />
                  <span className="ml-2 text-xs font-medium text-slate-500">
                    Clinic WhatsApp
                  </span>
                </div>
              </div>
              <div className="space-y-4 p-5">
                <ChatBubble align="left" muted>
                  Hi
                </ChatBubble>
                <ChatBubble align="left" brand>
                  👋 Welcome to ABC Clinic!
                  <br />
                  <br />
                  1️⃣ Book Appointment
                  <br />
                  2️⃣ My Appointments
                  <br />
                  3️⃣ Cancel
                  <br />
                  4️⃣ Reschedule
                </ChatBubble>
                <ChatBubble align="right">1</ChatBubble>
                <ChatBubble align="left" brand>
                  📅 Select a doctor:
                  <br />
                  1️⃣ Dr. Ravi — General
                </ChatBubble>
              </div>
              <div className="border-t border-slate-100 bg-brand-50/50 px-5 py-4">
                <p className="text-center text-xs font-medium text-brand-800">
                  Tap menus · No typing · Works on every phone
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChatBubble({
  children,
  align,
  brand,
  muted,
}: {
  children: ReactNode;
  align: "left" | "right";
  brand?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          align === "right"
            ? "rounded-br-md bg-brand-600 text-white"
            : brand
              ? "rounded-bl-md bg-white text-slate-800 shadow-soft ring-1 ring-slate-100"
              : muted
                ? "rounded-bl-md bg-slate-100 text-slate-600"
                : "rounded-bl-md bg-white text-slate-800 shadow-soft"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function CheckDot() {
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-brand-700">
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </span>
  );
}

