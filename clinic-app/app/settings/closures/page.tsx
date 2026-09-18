import { AddClosureForm } from "../details-form";
import { Closures } from "../hours";
import { loadSettings, SettingsError } from "../load";

export default async function ClosuresSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    return (
        <section className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
            <h2 className="mb-1 text-base font-semibold">Closures</h2>
            <p className="mb-3 text-xs text-slate-500">
                Holidays and one-off closed days. The bot will not offer these dates.
            </p>

            <AddClosureForm />
            <Closures holidays={data.holidays} />
        </section>
    );
}
