const steps = [
  {
    num: "01",
    title: "Discovery call",
    text: "15 minutes — doctors, timings, languages, and goals.",
  },
  {
    num: "02",
    title: "WhatsApp + Meta",
    text: "We connect your clinic number to the official Cloud API.",
  },
  {
    num: "03",
    title: "Sheet + calendars",
    text: "Dedicated appointment register shared with your clinic.",
  },
  {
    num: "04",
    title: "Training",
    text: "Walkthrough for reception and at least one doctor.",
  },
  {
    num: "05",
    title: "Go-live",
    text: "30 days priority support included from launch day.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="section-label">Setup</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Live in 3–7 working days
            </h2>
          </div>
          <span className="rounded-full bg-brand-100 px-4 py-2 text-sm font-semibold text-brand-800">
            No app · No IT team required
          </span>
        </div>

        <div className="mt-12 space-y-4">
          {steps.map((step) => (
            <div
              key={step.num}
              className="card-hover flex gap-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft sm:items-center"
            >
              <span className="text-3xl font-extrabold text-brand-200">
                {step.num}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {step.title}
                </h3>
                <p className="mt-1 text-slate-600">{step.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
