// ============================================================
// Logging — part of the ABC Clinic WhatsApp bot
// WhatsApp_Log / WhatsApp_Debug sheet management, retention cleanup, log settings.
// See src/Config.gs for the full file-layout map and Script Properties.
// ============================================================


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
            "Phone",
            "Name",
            "Type",
            "Message",
            "Phone Number ID"
        ]);
    }

    return sheet;
}



function ensureWhatsAppDebugSheet(ss) {

    let sheet =
        ss.getSheetByName("WhatsApp_Debug");

    if (!sheet) {

        sheet =
            ss.insertSheet("WhatsApp_Debug");

        sheet.appendRow([
            "Timestamp",
            "Direction",
            "Phone",
            "Status",
            "Response"
        ]);
    }

    return sheet;
}



function appendInboundWhatsAppLog(
    ss,
    entry
) {

    const settings =
        getLogSettings();

    if (!settings.enableInboundLog) {
        return;
    }

    const sheet =
        ensureWhatsAppLogSheet(ss);

    sheet.appendRow([
        new Date(),
        entry.phone,
        truncateLogText(
            entry.name,
            100
        ),
        entry.type,
        truncateLogText(
            entry.message,
            settings.messageMaxChars
        ),
        entry.phoneNumberId || ""
    ]);

    cleanupLogSheet(
        sheet,
        settings
    );
}



function appendWhatsAppDebugLog(
    ss,
    entry
) {

    const settings =
        getLogSettings();

    if (!settings.enableDebugLog) {
        return;
    }

    const sheet =
        ensureWhatsAppDebugSheet(ss);

    sheet.appendRow([
        new Date(),
        entry.direction || "OUTBOUND",
        entry.phone || "",
        entry.status || "",
        truncateLogText(
            entry.response,
            settings.messageMaxChars
        )
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

    [
        "WhatsApp_Log",
        "WhatsApp_Debug"
    ].forEach(function (name) {

        const sheet =
            ss.getSheetByName(name);

        results.sheets[name] =
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
    });

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
