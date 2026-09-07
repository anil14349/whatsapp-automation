import { LoginForm } from "./LoginForm";

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">Clinic Admin</h1>
        <p className="mt-1 text-sm text-slate-500">Sign in to manage doctors, appointments, and settings.</p>

        <div className="mt-6">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
