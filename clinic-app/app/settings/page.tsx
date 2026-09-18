import { GeneralForm } from "./details-form";
import { loadSettings, SettingsError } from "./load";

export default async function GeneralSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    return <GeneralForm clinic={data.clinic} />;
}

