import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { site } from "@/lib/site";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { WhatsAppFab } from "@/components/WhatsAppFab";

export const metadata: Metadata = {
  title: `${site.brandName} — WhatsApp Booking for Clinics`,
  description:
    "Patients book on your clinic WhatsApp — no app. Hosted platform with shared Google Sheet, reminders, doctor portal. English, Telugu, Hindi.",
  keywords: [
    "WhatsApp clinic booking",
    "doctor appointment WhatsApp",
    "clinic automation India",
    "WhatsApp reminders",
  ],
  openGraph: {
    title: `${site.brandName} — Hosted WhatsApp Booking for Clinics`,
    description:
      "We host the platform. You keep your number, calendars, and shared appointment sheet.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="font-sans">
        <Navbar />
        <main>{children}</main>
        <Footer />
        <WhatsAppFab />
      </body>
    </html>
  );
}
