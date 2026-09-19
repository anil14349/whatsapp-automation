# Drives a whole conversation through the live webhook and checks what it left
# behind.
#
# `drive-flow.ps1` proved the flow by printing states for a human to read. This
# asserts instead, and cleans up after itself, so a scenario can be re-run after
# every change and answered with an exit code.
#
# The number matters. Forging an inbound message does not open a 24-hour window
# at Meta, so every reply the bot sends to it fails 131047 - harmless today. The
# moment a template is approved those sends can be delivered, so this defaults
# to the test handset rather than inventing a number that might belong to
# somebody. Pass -Phone deliberately.
#
# Cleanup covers appointments, their reminders, feedback and audit rows, and the
# session. Feedback is on that list because a survey for a COMPLETED appointment
# is queued by the scheduler within the minute, and a hand-written cleanup
# missed it once.

param(
    [ValidateSet("home-collection", "consultation")]
    [string] $Scenario = "home-collection",

    [string] $Phone = "919052452905",

    # The handler takes a typed "HH:MM" as readily as a tapped slot_HH:MM, and
    # the offered slots are never stored on the session, so there is nothing to
    # read back. Inside the lab's 07:00-19:00 window and past its 8h notice.
    [string] $Time = "10:00",

    [switch] $KeepData
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Setting([string] $name) {
    $match = Select-String -Path .env.local -Pattern "^$name=(.+)$"

    if (-not $match) {
        throw "$name is not set in .env.local"
    }

    return $match.Matches[0].Groups[1].Value.Trim()
}

$key = Setting "SU_SERVICE_ROLE_KEY"
$hookToken = Setting "WHATSAPP_WEBHOOK_POST_TOKEN"
$base = (Setting "SU_URL").TrimEnd("/")

$rest = "$base/rest/v1"
$hook = "$base/functions/v1/webhook"
$clinic = "402ae46c-56ed-40b0-a4b0-df63d6b43acc"
$auth = @("--ssl-revoke-best-effort", "-H", "apikey: $key", "-H", "Authorization: Bearer $key")

$secret = ((& curl.exe -s @auth "$rest/clinics?id=eq.$clinic&select=whatsapp_app_secret") |
    ConvertFrom-Json)[0].whatsapp_app_secret

if (-not $secret) {
    throw "The clinic has no whatsapp_app_secret, so the webhook will refuse a signed call"
}

function Get-Rows([string] $query) {
    $text = ((& curl.exe -s @auth "$rest/$query") -join "")

    if (-not $text.Trim()) {
        return @()
    }

    # An empty result parses to $null, and @($null) has a count of one, so a
    # table with no matching rows otherwise reads as a table with one.
    $rows = ConvertFrom-Json $text

    if ($null -eq $rows) {
        return @()
    }

    # Let this unroll and let every call site wrap it in @(). Returning ",@()"
    # as well nested it one level: Count read 1 against three rows, and the id
    # built into the delete URL was three ids separated by spaces.
    return @($rows | Where-Object { $null -ne $_ })
}

function Remove-Rows([string] $query) {
    & curl.exe -s @auth -X DELETE "$rest/$query" | Out-Null
}

# Meta signs the exact bytes, so the body is written once and both hashed and
# sent from the same file. Re-serialising it produces a different signature.
function Send-Hook([string] $inner) {
    $id = "wamid.t" + [guid]::NewGuid().ToString("N").Substring(0, 14)

    $json = '{"object":"whatsapp_business_account","entry":[{"id":"E1","changes":[{"value":' +
        '{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550000000",' +
        '"phone_number_id":"1319200444602973"},"contacts":[{"profile":{"name":"Flow test"},"wa_id":"' +
        $Phone + '"}],"messages":[{"from":"' + $Phone + '","id":"' + $id +
        '","timestamp":"1758200000",' + $inner + '}]},"field":"messages"}]}]}'

    $file = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($file, $json)

    $mac = New-Object System.Security.Cryptography.HMACSHA256
    $mac.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    $signature = ($mac.ComputeHash([Text.Encoding]::UTF8.GetBytes($json)) |
        ForEach-Object { $_.ToString("x2") }) -join ""

    & curl.exe -s --ssl-revoke-best-effort -X POST -H "Content-Type: application/json" `
        -H "X-Hub-Signature-256: sha256=$signature" --data-binary "@$file" `
        "$hook`?token=$hookToken" | Out-Null

    Remove-Item $file
}

function Text([string] $body) { '"text":{"body":"' + $body + '"},"type":"text"' }
function Tap([string] $id) { '"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"' + $id + '","title":"x"}}' }
function Row([string] $id) { '"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"' + $id + '","title":"x"}}' }
function Pin([double] $lat, [double] $lon) { '"type":"location","location":{"latitude":' + $lat + ',"longitude":' + $lon + '}' }

$script:failures = 0

function Check([string] $what, [bool] $ok, [string] $detail = "") {
    if ($ok) {
        "  PASS  $what"
    } else {
        $script:failures++
        "  FAIL  $what$(if ($detail) { " -- $detail" })"
    }
}

function State() {
    $session = Get-Rows "whatsapp_sessions?phone=eq.$Phone&clinic_id=eq.$clinic&select=state"
    return $session[0].state
}

# ---------------------------------------------------------------------------

"Scenario : $Scenario"
"Number   : $Phone"
"Project  : $base"
""

$before = @(Get-Rows "appointments?patient_phone=eq.$Phone&select=id" |
    ForEach-Object { [string] $_.id })

# One active booking per patient, so a leftover from a previous run sends the
# flow back to the menu and every assertion below reads as a broken app.
$active = @(Get-Rows "appointments?patient_phone=eq.$Phone&status=eq.CONFIRMED&select=id")

if ($active.Count -gt 0) {
    "This number already has a confirmed appointment ($($active[0].id))."
    "The flow allows one at a time, so cancel or remove it before running."
    exit 1
}

Send-Hook (Text "hi")
Send-Hook (Tap "lang_en")

if ($Scenario -eq "home-collection") {
    Send-Hook (Tap "menu_home_collection")

    # A typed address carries no coordinates, so accepting one would skip the
    # distance check entirely.
    Send-Hook (Text "14 Rajpath, opposite the post office")
    Check "a typed address does not become the visit address" ((State) -eq "BOOK_ADDRESS")

    Send-Hook (Pin 13.0827 80.2707)
    Check "a pin 580km away is refused" ((State) -eq "BOOK_ADDRESS")

    Send-Hook (Pin 17.5389 78.2614)
    Check "a pin inside the radius is accepted" ((State) -ne "BOOK_ADDRESS")

    Send-Hook (Text "Flat 3B, above the chemist")
    Send-Hook (Tap "date_tomorrow")
    Send-Hook (Text $Time)
    Send-Hook (Text "Flow Test Patient")
    Send-Hook (Tap "confirm_yes")
} else {
    Send-Hook (Tap "menu_book")
    Send-Hook (Row "svc_5b444eed-c3ee-4fae-8e8e-34cc58e5ef6a")
    Send-Hook (Tap "date_tomorrow")
    Send-Hook (Text $Time)
    Send-Hook (Text "Flow Test Patient")
    Send-Hook (Tap "confirm_yes")
}

# ---------------------------------------------------------------------------

$after = @(Get-Rows "appointments?patient_phone=eq.$Phone&select=id,status,location_type,service_latitude,collector_id,appointment_date")
$fresh = @($after | Where-Object { $before -notcontains [string] $_.id })

Check "exactly one appointment was created" ($fresh.Count -eq 1) "created $($fresh.Count), conversation stopped at $(State)"

if ($fresh.Count -eq 1) {
    $booking = $fresh | Select-Object -First 1

    # Cast before comparing: a property read off an array silently enumerates,
    # and the comparison then returns the matching rows rather than a boolean.
    $status = [string] $booking.status
    $where = [string] $booking.location_type

    Check "it is confirmed" ($status -eq "CONFIRMED") $status

    if ($Scenario -eq "home-collection") {
        Check "it is a home visit" ($where -eq "HOME") $where
        Check "the pin was stored" ($null -ne $booking.service_latitude)
        Check "a collector was assigned" ($null -ne $booking.collector_id) "unassigned"
    }

    $reminders = @(Get-Rows "appointment_reminders?appointment_id=eq.$($booking.id)&select=reminder_type,status")
    Check "reminders were queued" ($reminders.Count -gt 0) "$($reminders.Count) queued"

    if (-not $KeepData) {
        $id = [string] $booking.id

        # Only ever an id this run watched appear. A cleanup that deletes rows
        # it did not create is worse than one that leaves litter behind.
        if (-not $id -or $before -contains $id) {
            Check "cleanup targets only what this run created" $false "refusing to delete '$id'"
        } else {
            "`nCleaning up $id"
            Remove-Rows "appointment_reminders?appointment_id=eq.$id"
            Remove-Rows "feedback?appointment_id=eq.$id"
            Remove-Rows "audit_log?entity_id=eq.$id"
            Remove-Rows "appointments?id=eq.$id"

            $left = @(Get-Rows "appointments?id=eq.$id&select=id")
            Check "the test appointment is gone" ($left.Count -eq 0)
        }
    }
}

if (-not $KeepData) {
    Remove-Rows "whatsapp_sessions?phone=eq.$Phone&clinic_id=eq.$clinic"
}

""
if ($script:failures -eq 0) {
    "flow: $Scenario passed"
    exit 0
}

"flow: $Scenario failed ($script:failures checks)"
exit 1
