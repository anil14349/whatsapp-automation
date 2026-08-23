import { pricingUrl } from "@/lib/site";

const plans = [
  {
    name: "Starter",
    doctors: "1 doctor",
    setup: "₹19,999",
    monthly: "₹2,999",
    features: [
      "Patient booking on WhatsApp",
      "Reminders & shared sheet",
      "Doctor portal basics",
      "30-day launch support",
    ],
    highlighted: false,
  },
  {
    name: "Standard",
    doctors: "2–5 doctors",
    setup: "₹34,999",
    monthly: "₹4,999",
    features: [
      "Everything in Starter",
      "Interactive tap menus",
      "After-hours auto-reply",
      "Completed / no-show workflow",
      "Priority support",
    ],
    highlighted: true,
  },
  {
    name: "Custom",
    doctors: "Multi-branch",
    setup: "Quote",
    monthly: "Quote",
    features: [
      "Multiple locations",
      "Custom workflows",
      "Dedicated onboarding",
      "SLA options",
    ],
    highlighted: false,
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <p className="section-label">Pricing</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Simple plans for small clinics
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-600">
            Setup fee + monthly platform hosting. Meta WhatsApp message charges
            billed separately with an upfront estimate.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`card-hover relative flex flex-col rounded-2xl border p-8 ${
                plan.highlighted
                  ? "border-brand-400 bg-brand-50/30 shadow-card ring-2 ring-brand-500/20"
                  : "border-slate-200 bg-white shadow-soft"
              }`}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">
                  Most popular
                </span>
              )}
              <h3 className="text-xl font-bold text-slate-900">{plan.name}</h3>
              <p className="mt-1 text-sm text-slate-500">{plan.doctors}</p>
              <div className="mt-6">
                <p className="text-sm text-slate-500">Setup</p>
                <p className="text-3xl font-extrabold text-slate-900">
                  {plan.setup}
                </p>
              </div>
              <div className="mt-4">
                <p className="text-sm text-slate-500">Platform / month</p>
                <p className="text-2xl font-bold text-brand-700">
                  {plan.monthly}
                  {plan.monthly !== "Quote" && (
                    <span className="text-base font-normal text-slate-500">
                      /mo
                    </span>
                  )}
                </p>
              </div>
              <ul className="mt-8 flex-1 space-y-3 border-t border-slate-200 pt-6">
                {plan.features.map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-sm text-slate-600"
                  >
                    <span className="text-brand-600">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href={pricingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`mt-8 block rounded-full py-3 text-center text-sm font-semibold transition ${
                  plan.highlighted
                    ? "bg-brand-600 text-white hover:bg-brand-700"
                    : "border border-slate-300 bg-white text-slate-800 hover:border-brand-400"
                }`}
              >
                Get a quote
              </a>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-sm text-slate-500">
          Appointment data exportable anytime. Formal sheet handover on contract
          end. Monthly fee applies while the hosted service is active.
        </p>
      </div>
    </section>
  );
}
