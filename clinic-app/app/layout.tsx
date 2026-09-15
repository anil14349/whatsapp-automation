import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "Clinic Portal",
    description: "Appointments, collections and staff for your clinic"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
