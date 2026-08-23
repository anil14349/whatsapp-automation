const yours = [
  "WhatsApp number patients message",
  "Google Sheet with shared access",
  "Doctors' Google Calendars",
  "Patient appointment data",
];

const ours = [
  "Meta / WhatsApp Cloud API setup",
  "Booking automation & webhook",
  "Updates, monitoring, fixes",
  "Interactive menus & reminder jobs",
];

export function Ownership() {
  return (
    <section id="ownership" className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <p className="section-label">Clear ownership</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            You run the clinic. We run the tech.
          </h2>
        </div>

        <div className="mt-12 grid gap-8 lg:grid-cols-2">
          <div className="card-hover rounded-2xl border-2 border-brand-200 bg-white p-8 shadow-soft">
            <div className="mb-6 inline-flex rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-800">
              Your clinic keeps
            </div>
            <ul className="space-y-4">
              {yours.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs text-white">
                    ✓
                  </span>
                  <span className="text-slate-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="card-hover rounded-2xl border border-slate-200 bg-slate-900 p-8 text-white shadow-card">
            <div className="mb-6 inline-flex rounded-full bg-white/10 px-3 py-1 text-sm font-semibold text-brand-200">
              We host & maintain
            </div>
            <ul className="space-y-4">
              {ours.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs text-white">
                    ⚡
                  </span>
                  <span className="text-slate-200">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
