import { demoUrl, site } from "@/lib/site";

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white py-12">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="flex flex-col items-center justify-between gap-6 sm:flex-row">
          <div className="text-center sm:text-left">
            <p className="text-lg font-bold text-slate-900">{site.brandName}</p>
            <p className="mt-1 text-sm text-slate-500">
              Hosted WhatsApp booking for clinics · {site.city}
            </p>
          </div>
          <div className="flex flex-col items-center gap-2 text-sm text-slate-600 sm:items-end">
            <a
              href={`mailto:${site.email}`}
              className="hover:text-brand-700"
            >
              {site.email}
            </a>
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-brand-700 hover:underline"
            >
              Chat on WhatsApp
            </a>
          </div>
        </div>
        <p className="mt-8 border-t border-slate-100 pt-8 text-center text-xs text-slate-400">
          © {year} {site.brandName}. We do not sell patient data. Clinic
          appointment data is visible to you via shared Google Sheet.
        </p>
      </div>
    </footer>
  );
}
