export const site = {
  brandName: process.env.NEXT_PUBLIC_BRAND_NAME || "SlotWA",
  tagline:
    process.env.NEXT_PUBLIC_TAGLINE ||
    "Hosted WhatsApp booking for clinics",
  city: process.env.NEXT_PUBLIC_CITY || "India",
  whatsappNumber:
    process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "919876543210",
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@example.com",
  contactName: process.env.NEXT_PUBLIC_CONTACT_NAME || "Your Name",
};

export function whatsAppUrl(message: string): string {
  const digits = site.whatsappNumber.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export const demoUrl = whatsAppUrl(
  "Hi, I'd like a free demo of hosted WhatsApp booking for my clinic."
);

export const pricingUrl = whatsAppUrl(
  "Hi, please share pricing for hosted WhatsApp booking for my clinic."
);
