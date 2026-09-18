import { OpeningHours } from "../hours";
import { loadSettings, SettingsError } from "../load";

export default async function HoursSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    const openDays = data.hours.filter((d) => !d.closed).length;

    return (
        <>
            {openDays === 0 && (
                <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Every day is marked closed, so patients cannot book anything.
                </p>
            )}

            <OpeningHours hours={data.hours} />
        </>
    );
}
