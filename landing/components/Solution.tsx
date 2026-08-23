export function Solution() {
  return (
    <section id="solution" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-label">The solution</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Your WhatsApp number. Our hosted engine.
          </h2>
          <p className="mt-6 text-lg leading-relaxed text-slate-600">
            We connect your clinic number to a managed booking platform. Patients
            send <strong className="text-slate-800">Hi</strong> → book, cancel,
            reschedule, get reminders. Doctors use{" "}
            <strong className="text-slate-800">Doctor Portal</strong> on WhatsApp.
            You see everything in a shared spreadsheet — no hospital software
            required.
          </p>
        </div>

        <div className="mt-14 flex flex-wrap items-center justify-center gap-4">
          {[
            "Patient sends Hi",
            "Books a slot",
            "Gets reminder",
            "Doctor sees schedule",
          ].map((step, i, arr) => (
            <div key={step} className="flex items-center gap-4">
              <span className="rounded-full bg-brand-100 px-4 py-2 text-sm font-semibold text-brand-800">
                {step}
              </span>
              {i < arr.length - 1 && (
                <span className="hidden text-slate-300 sm:inline">→</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
