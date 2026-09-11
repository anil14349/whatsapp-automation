# Daily Appointment Archive Setup

## Overview

Automatically archive previous day's appointments to a history sheet at a configurable time each day.

**What happens:**
- At your configured time (default: midnight), a trigger runs
- All appointments with date = yesterday are moved to `Appointment_History` sheet
- Rows are deleted from main `Appointments` sheet
- Related caches are invalidated

## Setup Instructions

### 1. Enable the Daily Archive Trigger

In Google Apps Script console, run:

```javascript
createDailyArchiveTask(0, 0);  // Runs at 00:00 (midnight)
```

### 2. Configure Custom Time

To run at a different time, pass hour and minute:

```javascript
createDailyArchiveTask(2, 30);   // Runs at 02:30 AM
createDailyArchiveTask(23, 59);  // Runs at 23:59 (11:59 PM)
```

**Parameters:**
- `hourOfDay`: 0-23 (0 = midnight, 12 = noon)
- `minuteOfHour`: 0-59

### 3. Verify Trigger Created

In Apps Script console → Triggers (left sidebar):
- Look for `archivePreviousDayAppointments`
- Should show "Every day" with your configured time
- Should have "Head" in execution settings

### 4. Check Archive Sheet

After first run or manual test:
- New sheet `Appointment_History` is created (hidden)
- Contains same columns as `Appointments` + `Archived At` timestamp
- Previous day's appointments are moved here

## Manual Testing

To test immediately (without waiting for trigger):

```javascript
archivePreviousDayAppointments();
```

This logs:
```
archivePreviousDayAppointments: Processing date 2026-09-11
archivePreviousDayAppointments: Archived 5 appointments from 2026-09-11
```

## Remove the Trigger

If you want to disable automatic archiving:

```javascript
removeDailyArchiveTask();
```

This:
- Removes all daily archive triggers
- Leaves the `Appointment_History` sheet intact
- Prevents future automatic archiving

## How It Works

### Archive Process

1. **Yesterday's date calculated** using `TIMEZONE` constant
2. **All appointments queried** from `Appointments` sheet
3. **Matching rows identified** where `date === yesterday`
4. **Rows copied** to `Appointment_History` with `Archived At` timestamp
5. **Rows deleted** from `Appointments` sheet (in reverse order to avoid shifts)
6. **Related caches cleared** for session management

### Performance Notes

- Scans from end backwards for efficiency
- Typical run time: < 5 seconds for most clinics
- No impact on WhatsApp message processing
- Runs in project's default timezone (see `Config.gs` → `TIMEZONE`)

## Timezone Consideration

The trigger respects your configured `TIMEZONE` in `Config.gs`:

```javascript
const TIMEZONE = "Asia/Kolkata";  // India Standard Time (IST)
```

Archive runs at your specified time in this timezone.

## Archive Sheet Structure

```
Appointment ID | Date | Time | Doctor ID | Patient Name | Phone | Status | Calendar Event ID | Patient ID | Archived At
```

**Note:** Archive sheet is hidden by default. To view:
- Right-click sheet tab → Unhide sheets
- Or in Scripts: `SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Appointment_History").showSheet()`

## Data Retention

Archives are kept **indefinitely** since they're not read by the script — purely for audit/reference.

If you want to clean up very old records later, you can manually delete rows or create a separate cleanup function.

## Troubleshooting

### Trigger doesn't run at scheduled time

1. **Check trigger configuration**
   ```javascript
   ScriptApp.getProjectTriggers().forEach(t => {
       Logger.log(t.getTriggerSource() + " → " + t.getHandlerFunction());
   });
   ```

2. **Verify timezone** in `Config.gs` matches your location

3. **Check script permissions** — Apps Script will prompt for access on first setup

### Appointments not archiving

1. **Manual test** to see error:
   ```javascript
   const result = archivePreviousDayAppointments();
   Logger.log(result);
   ```

2. **Check logs** in Apps Script → Executions tab for errors

3. **Verify `Appointments` sheet** exists and has data

### Archive sheet not created

First run might fail if sheet creation has permission issues. Try manual test first.

## API Reference

### `archivePreviousDayAppointments()`

Moves all appointments from yesterday to history sheet.

**Returns:**
```javascript
{
  success: true,
  message: "Archived 5 appointments from 2026-09-11",
  archivedCount: 5
}
```

### `createDailyArchiveTask(hourOfDay, minuteOfHour)`

Creates time-based trigger for daily archiving.

**Parameters:**
- `hourOfDay` (number, 0-23): Default 0
- `minuteOfHour` (number, 0-59): Default 0

**Returns:**
```javascript
{
  success: true,
  message: "Daily archive task scheduled at 00:00"
}
```

### `removeDailyArchiveTask()`

Removes all daily archive triggers.

**Returns:**
```javascript
{
  success: true,
  message: "Removed 1 daily archive trigger(s)"
}
```

### `ensureAppointmentHistorySheet()`

Creates or returns the `Appointment_History` sheet.

Used internally; can also call manually to ensure sheet exists before first archive run.
