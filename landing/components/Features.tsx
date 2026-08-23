const groups = [
  {
    title: "For patients",
    accent: "bg-emerald-500",
    items: [
      "Book appointment 24/7",
      "View my appointments",
      "Cancel or reschedule",
      "Automatic reminders",
      "English, Telugu, Hindi",
    ],
  },
  {
    title: "For doctors",
    accent: "bg-brand-600",
    items: [
      "Today's schedule & next patient",
      "Manage availability & leaves",
      "Cancel/reschedule for patient",
      "Mark completed or no-show",
      "Full Doctor Portal on WhatsApp",
    ],
  },
  {
    title: "For clinic owners",
    accent: "bg-slate-700",
    items: [
      "Shared Google Sheet register",
      "Settings: reminders, hours, languages",
      "Message logs for audit",
      "Optional after-hours auto-reply",
      "Export data anytime",
    ],
  },
];

export function Features() {
  return (
    <section id="features" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <p className="section-label">Features</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Everything a small clinic needs
          </h2>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-3">
          {groups.map((group) => (
            <div
              key={group.title}
              className="card-hover flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-6"
            >
              <div className="flex items-center gap-3">
                <span className={`h-2 w-8 rounded-full ${group.accent}`} />
                <h3 className="text-lg font-bold text-slate-900">
                  {group.title}
                </h3>
              </div>
              <ul className="mt-6 flex-1 space-y-3">
                {group.items.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-2 text-sm text-slate-600"
                  >
                    <span className="text-brand-600">•</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
