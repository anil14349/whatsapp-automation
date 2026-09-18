# Drives the live webhook with correctly signed payloads, for manual testing.
# Not part of any gate; safe to delete.
#
# This books REAL appointments against the LIVE database. It used to name a real
# patient's number in the script itself; a run once left a confirmed booking
# behind, which then sent that patient two reminders for a service they had
# never asked for - and blocked their own booking, because only one can be
# active at a time. The number is now a parameter defaulting to the test
# handset, and the run cancels whatever it created before it exits.

param(
    [string] $Phone = "919052452905"
)

$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

$key = (Select-String -Path .env.local -Pattern '^SU_SERVICE_ROLE_KEY=(.+)$').Matches[0].Groups[1].Value.Trim()
$wt = (Select-String -Path .env.local -Pattern '^WHATSAPP_WEBHOOK_POST_TOKEN=(.+)$').Matches[0].Groups[1].Value.Trim()
# Read the project from .env.local rather than naming it here, so this follows
# the app when it moves rather than quietly driving the old one.
$base = (Select-String -Path .env.local -Pattern '^SU_URL=(.+)$').Matches[0].Groups[1].Value.Trim().TrimEnd('/')
$rest = "$base/rest/v1"
$hook = "$base/functions/v1/webhook"
$clinic = "402ae46c-56ed-40b0-a4b0-df63d6b43acc"
$srv = @("--ssl-revoke-best-effort", "-H", "apikey: $key", "-H", "Authorization: Bearer $key")

$secret = ((& curl.exe -s @srv "$rest/clinics?id=eq.$clinic&select=whatsapp_app_secret") | ConvertFrom-Json)[0].whatsapp_app_secret

$PATIENT = $Phone

function Appointments() {
    return (& curl.exe -s @srv "$rest/appointments?patient_phone=eq.$PATIENT&status=eq.CONFIRMED&select=id") | ConvertFrom-Json
}

$before = @(Appointments | ForEach-Object { $_.id })

function Send-Hook([string] $from, [string] $inner) {
    $mid = "wamid.t" + [guid]::NewGuid().ToString("N").Substring(0, 14)

    $json = '{"object":"whatsapp_business_account","entry":[{"id":"E1","changes":[{"value":' +
        '{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550000000",' +
        '"phone_number_id":"1319200444602973"},"contacts":[{"profile":{"name":"Tester"},"wa_id":"' + $from + '"}],' +
        '"messages":[{"from":"' + $from + '","id":"' + $mid + '","timestamp":"1758200000",' + $inner +
        '}]},"field":"messages"}]}]}'

    $f = [IO.Path]::GetTempFileName()
    [IO.File]::WriteAllText($f, $json)

    $h = New-Object System.Security.Cryptography.HMACSHA256
    $h.Key = [Text.Encoding]::UTF8.GetBytes($secret)
    $sig = ($h.ComputeHash([Text.Encoding]::UTF8.GetBytes($json)) | ForEach-Object { $_.ToString("x2") }) -join ""

    $reply = & curl.exe -s --ssl-revoke-best-effort -X POST -H "Content-Type: application/json" `
        -H "X-Hub-Signature-256: sha256=$sig" --data-binary "@$f" "$hook`?token=$wt"

    Remove-Item $f
    return $reply
}

function Text([string] $body) { '"text":{"body":"' + $body + '"},"type":"text"' }
function Tap([string] $id) { '"type":"interactive","interactive":{"type":"button_reply","button_reply":{"id":"' + $id + '","title":"x"}}' }
function Row([string] $id) { '"type":"interactive","interactive":{"type":"list_reply","list_reply":{"id":"' + $id + '","title":"x"}}' }
function Pin([double] $lat, [double] $lon) { '"type":"location","location":{"latitude":' + $lat + ',"longitude":' + $lon + '}' }

function Show([string] $label) {
    $s = ((& curl.exe -s @srv "$rest/whatsapp_sessions?phone=eq.$PATIENT&select=state,data") | ConvertFrom-Json)[0]
    $d = $s.data
    $extra = @()
    if ($d.serviceName) { $extra += "service=$($d.serviceName)" }
    if ($d.locationType) { $extra += "where=$($d.locationType)" }
    if ($null -ne $d.serviceLatitude) { $extra += "lat=$($d.serviceLatitude)" }
    if ($d.serviceAddress) { $extra += "detail=$($d.serviceAddress)" }
    "{0,-34} -> {1} {2}" -f $label, $s.state, ($extra -join " ")
}

# A number the bot has never heard from is asked to pick a language first, and
# every tap before that choice lands on the language prompt rather than the
# menu - which reads exactly like a broken flow.
"--- start a conversation ---"
Send-Hook $PATIENT (Text "hi") | Out-Null
Show "said hi"

Send-Hook $PATIENT (Tap "lang_en") | Out-Null
Show "chose English"

"`n--- home collection, pin required ---"
Send-Hook $PATIENT (Tap "menu_home_collection") | Out-Null
Show "tapped Home Collection"

Send-Hook $PATIENT (Text "14 Rajpath, opposite the post office") | Out-Null
Show "typed a full address"

Send-Hook $PATIENT (Pin 13.0827 80.2707) | Out-Null
Show "shared a pin in Chennai"

# Isnapur, a couple of kilometres from the clinic in Patancheru. The clinic
# moved from Delhi, so the pin this script used to send is now 1,500 km away
# and would be refused - which would have looked like the flow was broken.
Send-Hook $PATIENT (Pin 17.5389 78.2614) | Out-Null
Show "shared a pin nearby"

Send-Hook $PATIENT (Text "Flat 3B, above the chemist") | Out-Null
Show "gave a landmark"

"`n--- finish the booking ---"
Send-Hook $PATIENT (Tap "date_tomorrow") | Out-Null
Show "chose tomorrow"

Send-Hook $PATIENT (Row "slot_10:00") | Out-Null
Show "chose 10:00"

Send-Hook $PATIENT (Text "Anil") | Out-Null
Show "gave a name"

Send-Hook $PATIENT (Tap "confirm_yes") | Out-Null
Show "confirmed"

# Anything this run booked is test data on a real patient's number. Leaving it
# confirmed sends them reminders and blocks their own booking.
$created = @(Appointments | ForEach-Object { $_.id } | Where-Object { $before -notcontains $_ })

if ($created.Count -eq 0) {
    "`nnothing was booked, so nothing to undo"
}
else {
    $f = [IO.Path]::GetTempFileName()

    foreach ($id in $created) {
        [IO.File]::WriteAllText($f, '{"status":"CANCELLED"}')
        & curl.exe -s @srv -H "Content-Type: application/json" -X PATCH --data-binary "@$f" `
            "$rest/appointments?id=eq.$id" | Out-Null

        [IO.File]::WriteAllText($f, '{"status":"SKIPPED"}')
        & curl.exe -s @srv -H "Content-Type: application/json" -X PATCH --data-binary "@$f" `
            "$rest/appointment_reminders?appointment_id=eq.$id&status=eq.PENDING" | Out-Null

        "`ncleaned up $id (cancelled, reminders skipped)"
    }

    Remove-Item $f
}