import { demoUrl } from "@/lib/site";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";

export function FinalCTA() {
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 px-8 py-16 text-center shadow-card sm:px-16">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PGNpcmNsZSBjeD0iMzAiIGN5PSIzMCIgcj0iMiIvPjwvZz48L2c+PC9zdmc+')] opacity-40" />
          <div className="relative">
            <h2 className="text-3xl font-bold text-white sm:text-4xl">
              Stop losing bookings to missed calls
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-brand-100">
              Free 15-minute demo on WhatsApp. See the patient and doctor flow
              live — no obligation.
            </p>
            <a
              href={demoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-8 py-4 text-base font-bold text-brand-800 shadow-lg transition hover:bg-brand-50"
            >
              <WhatsAppIcon className="h-5 w-5 text-whatsapp" />
              WhatsApp demo in 15 minutes
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
