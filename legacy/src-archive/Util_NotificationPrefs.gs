// ============================================================
// Util_NotificationPrefs — part of the ABC Clinic WhatsApp bot
// Manage patient notification preferences (opt-in/out, channel selection)
// ============================================================



// Add notification preference columns to WhatsApp_Sessions sheet
function ensureNotificationPrefColumns() {

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {
        return false;
    }

    const headers =
        sheet.getRange(1, 1, 1, 20).getValues()[0];

    const headerMap = {};
    for (let i = 0; i < headers.length; i++) {
        headerMap[String(headers[i]).trim().toLowerCase()] =
            i + 1;
    }

    // Check if column exists (assuming Location is col 15)
    // Add new columns after existing ones

    if (!headerMap["notification_enabled"]) {
        sheet.getRange(1, 16).setValue("Notifications Enabled");
    }

    if (!headerMap["notification_channel"]) {
        sheet.getRange(1, 17).setValue("Notification Channel");
    }

    if (!headerMap["quiet_hours_start"]) {
        sheet.getRange(1, 18).setValue("Quiet Hours Start");
    }

    if (!headerMap["quiet_hours_end"]) {
        sheet.getRange(1, 19).setValue("Quiet Hours End");
    }

    return true;
}



// Get patient's notification preferences
// Returns: {enabled: bool, channel: "whatsapp"|"sms"|"both", quietHoursStart: time, quietHoursEnd: time}
function getNotificationPreferences(patientPhone) {

    if (!patientPhone) {

        return {
            enabled: true,
            channel: "whatsapp",
            quietHoursStart: "",
            quietHoursEnd: ""
        };
    }

    const session =
        getWhatsAppSession(patientPhone);

    if (!session) {

        return {
            enabled: true,
            channel: "whatsapp",
            quietHoursStart: "",
            quietHoursEnd: ""
        };
    }

    // For now, return defaults
    // In future, would read from sheet columns 16-19

    return {
        enabled: true,
        channel: "whatsapp",
        quietHoursStart: "",
        quietHoursEnd: ""
    };
}



// Update notification preferences
function setNotificationPreferences(
    patientPhone,
    enabled,
    channel,
    quietHoursStart,
    quietHoursEnd
) {

    if (!patientPhone) {
        return false;
    }

    // Validate channel
    const validChannels = [
        "whatsapp",
        "sms",
        "both",
        "none"
    ];

    if (
        channel &&
        validChannels.indexOf(
            String(channel).toLowerCase()
        ) === -1
    ) {

        return false;
    }

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const sheet =
        ss.getSheetByName("WhatsApp_Sessions");

    if (!sheet) {
        return false;
    }

    const data = sheet.getDataRange().getValues();

    for (
        let i = 1;
        i < data.length;
        i++
    ) {

        if (
            !phonesMatch(data[i][0], patientPhone)
        ) {
            continue;
        }

        // Update columns 16-19
        sheet.getRange(i + 1, 16).setValue(
            enabled ? "YES" : "NO"
        );

        if (channel) {
            sheet.getRange(i + 1, 17).setValue(
                String(channel).toLowerCase()
            );
        }

        if (quietHoursStart) {
            sheet.getRange(i + 1, 18).setValue(
                quietHoursStart
            );
        }

        if (quietHoursEnd) {
            sheet.getRange(i + 1, 19).setValue(
                quietHoursEnd
            );
        }

        return true;
    }

    return false;
}



// Check if patient should receive notification
// Respects preferences and quiet hours
function shouldSendNotification(
    patientPhone,
    notificationType
) {

    if (!patientPhone) {
        return true;
    }

    const prefs =
        getNotificationPreferences(patientPhone);

    // Check if notifications disabled
    if (!prefs.enabled) {
        return false;
    }

    // Check quiet hours
    if (
        prefs.quietHoursStart &&
        prefs.quietHoursEnd
    ) {

        const now = new Date();
        const currentHour =
            Utilities.formatDate(now, TIMEZONE, "HH:mm");

        if (
            currentHour >= prefs.quietHoursStart &&
            currentHour <= prefs.quietHoursEnd
        ) {

            return false;
        }
    }

    return true;
}



// Build notification preferences menu
function buildNotificationPreferencesMenu() {

    return {
        title: "🔔 Notification Settings",
        rows: [
            {
                id: "notif_enable",
                title: "Enable Notifications",
                description: "Get appointment reminders"
            },
            {
                id: "notif_disable",
                title: "Disable Notifications",
                description: "Don't send me reminders"
            },
            {
                id: "notif_channel",
                title: "Notification Channel",
                description: "Choose WhatsApp or SMS"
            },
            {
                id: "notif_quiet",
                title: "Set Quiet Hours",
                description: "Don't notify between times"
            },
            {
                id: "notif_view",
                title: "View My Preferences",
                description: "See current settings"
            }
        ]
    };
}



// Format preferences as WhatsApp message
function formatPreferencesMessage(patientPhone) {

    const prefs =
        getNotificationPreferences(patientPhone);

    let message =
        "🔔 *Your Notification Settings*\n\n";

    message +=
        "Notifications: " +
        (prefs.enabled ? "✅ Enabled" : "❌ Disabled") +
        "\n";

    message +=
        "Channel: " + prefs.channel.toUpperCase() + "\n";

    if (
        prefs.quietHoursStart &&
        prefs.quietHoursEnd
    ) {

        message +=
            "Quiet Hours: " +
            prefs.quietHoursStart + " - " +
            prefs.quietHoursEnd + "\n";

    } else {

        message +=
            "Quiet Hours: None set\n";
    }

    return message;
}
