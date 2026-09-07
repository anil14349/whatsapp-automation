import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ABC Clinic — Admin",
  description: "Receptionist/admin console for the ABC Clinic WhatsApp bot"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
