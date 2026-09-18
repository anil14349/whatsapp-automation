import { BrandingForm } from "../details-form";
import { loadSettings, SettingsError } from "../load";

export default async function BrandingSettingsPage() {
    const data = await loadSettings();

    if ("error" in data) {
        return <SettingsError message={data.error} />;
    }

    return <BrandingForm clinic={data.clinic} />;
}
