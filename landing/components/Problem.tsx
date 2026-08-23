const problems = [
  {
    icon: "📞",
    title: "Phone overload",
    text: "Reception repeats the same booking questions all day long.",
  },
  {
    icon: "😶",
    title: "No-shows",
    text: "Patients forget appointments — empty chairs and lost revenue.",
  },
  {
    icon: "🌙",
    title: "After-hours silence",
    text: "Messages at night with no reply until the clinic opens.",
  },
];

export function Problem() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="text-center">
          <p className="section-label">The challenge</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Sound familiar?
          </h2>
        </div>
        <div className="mt-12 grid gap-6 sm:grid-cols-3">
          {problems.map((item) => (
            <div
              key={item.title}
              className="card-hover rounded-2xl border border-slate-200 bg-white p-6 shadow-soft"
            >
              <span className="text-3xl" role="img" aria-hidden>
                {item.icon}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">
                {item.title}
              </h3>
              <p className="mt-2 text-slate-600 leading-relaxed">{item.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
