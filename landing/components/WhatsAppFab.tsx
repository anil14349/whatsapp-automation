import { demoUrl } from "@/lib/site";
import { WhatsAppIcon } from "@/components/WhatsAppIcon";

export function WhatsAppFab() {
  return (
    <a
      href={demoUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Book a demo on WhatsApp"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-whatsapp text-white shadow-lg transition hover:scale-105 hover:brightness-105 sm:bottom-8 sm:right-8"
    >
      <WhatsAppIcon className="h-7 w-7" />
    </a>
  );
}
