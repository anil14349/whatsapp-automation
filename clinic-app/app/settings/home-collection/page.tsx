import { HomeCollectionForm } from "../details-form";
import { loadSettings, SettingsError } from "../load";

export default async function HomeCollectionSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    return <HomeCollectionForm clinic={data.clinic} />;
}
