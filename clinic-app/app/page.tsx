import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">ABC Clinic</h1>
      <p className="max-w-md text-slate-600">
        This is the backend + admin console. The WhatsApp bot lives at{" "}
        <code className="rounded bg-slate-200 px-1.5 py-0.5">
          /api/whatsapp/webhook
        </code>
        .
      </p>
      <Link
        href="/admin"
        className="rounded-md bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700"
      >
        Go to Admin Console
      </Link>
    </main>
  );
}
