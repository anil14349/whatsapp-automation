import { BookingRulesForm } from "../details-form";
import { loadSettings, SettingsError } from "../load";

export default async function BookingSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    return <BookingRulesForm clinic={data.clinic} />;
}
