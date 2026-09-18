import { AfterHoursForm } from "../details-form";
import { loadSettings, SettingsError } from "../load";

export default async function MessagesSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    return <AfterHoursForm clinic={data.clinic} />;
}
