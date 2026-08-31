// ============================================================
// Logging — part of the ABC Clinic WhatsApp bot
// Single-sheet WhatsApp_Log: inbound messages, send/webhook errors, and the
// reminder dedup ledger all live in one sheet with a shared schema. Only
// inbound messages, errors, and reminder outcomes are logged — successful
// outbound replies are not (their content is already the reply the patient/
// doctor received; logging them doubled write volume for little value).
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================


// WhatsApp_Log columns:
//   Timestamp | Direction | Phone | Name | Status | Message | Appointment ID | Hours Before | Phone Number ID
// Direction: INBOUND | OUTBOUND (errors only) | WEBHOOK (fatal errors) | REMINDER
// Appointment ID / Hours Before are only populated for REMINDER rows
// (the reminder dedup ledger — see hasReminderBeenSent/markReminderSent).
// Phone Number ID is only populated for INBOUND rows.
// NOTE: the sheet name "WhatsApp_Log" is intentionally repeated as a string
// literal (not a shared constant) in each function below — this file is
// synced into the single-file monolith by function body only, so a
// module-level const here would not carry over. See src/Config.gs for how
// its own top-level consts are duplicated manually into the monolith header.


function trimWhatsAppLogSheet(sheet) {

    cleanupLogSheet(
        sheet,
        getLogSettings()
    );
}



function loadLogSettingsFromSheet() {

    const retentionKey =
        normalizeLogRetention(
            getSetting(
                "LOG_RETENTION",
                "month"
            )
        );

    const maxRows =
        Number(
            getSetting(
                "LOG_MAX_ROWS",
                LOG_SHEET_MAX_ROWS
            )
        );

    const messageMaxChars =
        Number(
            getSetting(
                "LOG_MESSAGE_MAX_CHARS",
                500
            )
        );

    return {
        retentionKey: retentionKey,
        retentionDays:
            getLogRetentionDays(
                retentionKey
            ),
        maxRows:
            maxRows > 0
                ? maxRows
                : LOG_SHEET_MAX_ROWS,
        messageMaxChars:
            messageMaxChars > 0
                ? messageMaxChars
                : 500,
        enableInboundLog:
            parseSettingsBoolean(
                getSetting(
                    "ENABLE_INBOUND_LOG",
                    "TRUE"
                ),
                true
            ),
        enableDebugLog:
            parseSettingsBoolean(
                getSetting(
                    "ENABLE_DEBUG_LOG",
                    "TRUE"
                ),
                true
            )
    };
}



function getLogSettings() {

    const cache =
        CacheService.getScriptCache();

    const cached =
        cache.get(LOG_SETTINGS_CACHE_KEY);

    if (cached) {
        return JSON.parse(cached);
    }

    const settings =
        loadLogSettingsFromSheet();

    cache.put(
        LOG_SETTINGS_CACHE_KEY,
        JSON.stringify(settings),
        LOG_SETTINGS_CACHE_SECONDS
    );

    return settings;
}



function clearLogSettingsCache() {

    CacheService.getScriptCache().remove(
        LOG_SETTINGS_CACHE_KEY
    );
}



function parseLogTimestamp(value) {

    if (
        value instanceof Date &&
        !isNaN(value.getTime())
    ) {
        return value;
    }

    const parsed =
        new Date(value);

    return isNaN(parsed.getTime())
        ? null
        : parsed;
}



function truncateLogText(text, maxChars) {

    const value =
        String(text || "");

    if (
        !maxChars ||
        value.length <= maxChars
    ) {
        return value;
    }

    return (
        value.substring(0, maxChars) +
        "…"
    );
}



function cleanupLogSheet(sheet, settings) {

    if (
        !sheet ||
        sheet.getLastRow() < 2
    ) {
        return {
            deletedByAge: 0,
            deletedByCap: 0,
            retentionKey:
                settings.retentionKey
        };
    }

    const opts = settings || getLogSettings();
    let deletedByAge = 0;

    if (opts.retentionDays > 0) {

        const cutoff =
            new Date(
                Date.now() -
                opts.retentionDays *
                24 *
                60 *
                60 *
                1000
            );

        const data =
            sheet.getDataRange().getValues();

        const rowsToDelete = [];

        for (
            let i = 1;
            i < data.length;
            i++
        ) {

            const timestamp =
                parseLogTimestamp(
                    data[i][0]
                );

            if (
                timestamp &&
                timestamp.getTime() <
                cutoff.getTime()
            ) {
                rowsToDelete.push(i + 1);
            }
        }

        rowsToDelete
            .sort(function (a, b) {
                return b - a;
            })
            .forEach(function (row) {
                sheet.deleteRow(row);
                deletedByAge++;
            });
    }

    let deletedByCap = 0;
    const maxRows =
        opts.maxRows + 1;

    while (sheet.getLastRow() > maxRows) {
        sheet.deleteRows(
            2,
            sheet.getLastRow() - maxRows
        );
        deletedByCap++;
    }

    return {
        deletedByAge: deletedByAge,
        deletedByCap: deletedByCap,
        retentionKey: opts.retentionKey
    };
}



function ensureWhatsAppLogSheet(ss) {

    let sheet =
        ss.getSheetByName("WhatsApp_Log");

    if (!sheet) {

        sheet =
            ss.insertSheet("WhatsApp_Log");

        sheet.appendRow([
            "Timestamp",
            "Direction",
            "Phone",
            "Name",
            "Status",
            "Message",
            "Appointment ID",
            "Hours Before",
            "Phone Number ID"
        ]);
    }

    return sheet;
}



// Single entry point for every diagnostic log row (inbound messages, send
// errors, webhook errors).
//   INBOUND         — gated by ENABLE_INBOUND_LOG
//   WEBHOOK         — always written; these are rare, fatal doPost crashes,
//                      not routine diagnostics, so they aren't silenceable
//   anything else   — gated by ENABLE_DEBUG_LOG (currently just OUTBOUND
//                      send errors — successful sends are not logged here)
// Reminder ledger rows do NOT go through here — see markReminderSent,
// which always writes regardless of these settings, since it's the
// functional dedup record reminders depend on, not just diagnostics.
function appendWhatsAppLogEntry(
    ss,
    entry
) {

    const settings =
        getLogSettings();

    if (
        entry.direction === "INBOUND" &&
        !settings.enableInboundLog
    ) {
        return;
    }

    if (
        entry.direction !== "INBOUND" &&
        entry.direction !== "WEBHOOK" &&
        !settings.enableDebugLog
    ) {
        return;
    }

    const sheet =
        ensureWhatsAppLogSheet(ss);

    sheet.appendRow([
        new Date(),
        entry.direction || "",
        entry.phone || "",
        truncateLogText(
            entry.name,
            100
        ),
        entry.status || "",
        truncateLogText(
            entry.message,
            settings.messageMaxChars
        ),
        "",
        "",
        entry.phoneNumberId || ""
    ]);

    cleanupLogSheet(
        sheet,
        settings
    );
}



function cleanupAllWhatsAppLogs() {

    clearLogSettingsCache();

    const ss =
        SpreadsheetApp.getActiveSpreadsheet();

    const settings =
        getLogSettings();

    const results = {
        settings: settings,
        sheets: {}
    };

    const sheet =
        ss.getSheetByName("WhatsApp_Log");

    results.sheets["WhatsApp_Log"] =
        sheet
            ? cleanupLogSheet(
                sheet,
                settings
            )
            : {
                deletedByAge: 0,
                deletedByCap: 0,
                retentionKey:
                    settings.retentionKey
            };

    Logger.log(
        "cleanupAllWhatsAppLogs: " +
        JSON.stringify(results)
    );

    return results;
}



function installDailyLogCleanupTrigger() {

    requireDebugMode(
        "installDailyLogCleanupTrigger"
    );

    ScriptApp.getProjectTriggers()
        .forEach(function (trigger) {

            if (
                trigger.getHandlerFunction() ===
                "cleanupAllWhatsAppLogs"
            ) {
                ScriptApp.deleteTrigger(
                    trigger
                );
            }
        });

    ScriptApp.newTrigger(
        "cleanupAllWhatsAppLogs"
    )
        .timeBased()
        .everyDays(1)
        .atHour(3)
        .create();

    return {
        success: true,
        message:
            "Daily log cleanup trigger installed (3 AM)."
    };
}
