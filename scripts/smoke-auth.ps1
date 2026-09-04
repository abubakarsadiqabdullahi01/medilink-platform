<#
    Medilink - Stage 4.2 authentication smoke test.

    Exercises the whole signup and login path against a running local stack,
    including the paths that unit tests cannot reach: Next actually loading
    each route module, the session cookie round-trip, and lockout.

    Reads the one-time code out of the web container log, which is where the
    console SMS adapter writes it, so the run needs no manual step.

    Usage (from the repository root, stack already up):
        powershell -ExecutionPolicy Bypass -File .\scripts\smoke-auth.ps1
#>

param(
    [string]$BaseUrl = "http://localhost:3000"
)

$ErrorActionPreference = "Continue"

$script:failures = 0

function Check {
    param([string]$Label, [bool]$Condition, [string]$Detail = "")
    if ($Condition) {
        Write-Host ("  PASS  " + $Label) -ForegroundColor Green
    } else {
        Write-Host ("  FAIL  " + $Label + "  " + $Detail) -ForegroundColor Red
        $script:failures++
    }
}

function Call {
    param(
        [string]$Method,
        [string]$Path,
        $Body = $null,
        $Session = $null
    )
    $p = @{
        Uri             = "$BaseUrl/api/v1/auth/$Path"
        Method          = $Method
        UseBasicParsing = $true
        TimeoutSec      = 120
    }
    if ($Session) { $p.WebSession = $Session }
    if ($null -ne $Body) {
        $p.ContentType = "application/json"
        $p.Body = ($Body | ConvertTo-Json -Compress)
    }
    try {
        $r = Invoke-WebRequest @p
        return [pscustomobject]@{ Status = [int]$r.StatusCode; Body = $r.Content }
    } catch {
        if ($_.Exception.Response) {
            $sr = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
            return [pscustomobject]@{ Status = [int]$_.Exception.Response.StatusCode.value__; Body = $sr.ReadToEnd() }
        }
        return [pscustomobject]@{ Status = 0; Body = $_.Exception.Message }
    }
}

# A fresh number per run, so the script is repeatable without resetting the
# database and never collides with real seed data.
$suffix = "{0:D7}" -f (Get-Random -Minimum 1000000 -Maximum 9999999)
$phone = "0803$suffix"
$password = "Harmattan-Kaduna-$(Get-Random -Minimum 100 -Maximum 999)"

Write-Host ""
Write-Host "Stage 4.2 auth smoke test  ($phone)" -ForegroundColor Cyan
Write-Host ""

# --- registration -----------------------------------------------------------
$r = Call Post "register" @{ phone = $phone; fullName = "Smoke Test User" }
Check "register accepts a new number (202)" ($r.Status -eq 202) $r.Body

$r = Call Post "register" @{ phone = "0803123456"; fullName = "Bad Phone" }
Check "register rejects a malformed number (422)" ($r.Status -eq 422) $r.Body

# --- one-time code ----------------------------------------------------------
Start-Sleep -Milliseconds 700
$logs = docker compose logs web --tail 200 2>$null
$e164 = "+234" + $phone.Substring(1)
$code = $null
for ($i = $logs.Count - 1; $i -ge 1; $i--) {
    if ($logs[$i - 1] -match [regex]::Escape("to=$e164") -and $logs[$i] -match '(\d{6}) is your code') {
        $code = $Matches[1]
        break
    }
}
Check "one-time code delivered to the console adapter" ($null -ne $code) "no code found in web logs"
if (-not $code) {
    Write-Host ""
    Write-Host "Cannot continue without the code." -ForegroundColor Red
    exit 1
}

$r = Call Post "verify-phone" @{ phone = $phone; code = "000000" }
Check "verify-phone rejects a wrong code (400)" ($r.Status -eq 400 -and $r.Body -match "otp_invalid") $r.Body

$r = Call Post "verify-phone" @{ phone = $phone; code = $code }
Check "verify-phone accepts the real code (200)" ($r.Status -eq 200) $r.Body

$r = Call Post "verify-phone" @{ phone = $phone; code = $code }
Check "the code cannot be replayed" ($r.Status -eq 400) $r.Body

# --- password ---------------------------------------------------------------
$r = Call Post "set-password" @{ phone = $phone; password = "short" }
Check "set-password rejects a weak password (422)" ($r.Status -eq 422) $r.Body

$r = Call Post "set-password" @{ phone = $phone; password = $phone + "aaaa" }
Check "set-password rejects a password containing the phone number" ($r.Status -in 400, 422) $r.Body

$r = Call Post "set-password" @{ phone = $phone; password = $password }
Check "set-password succeeds (200)" ($r.Status -eq 200) $r.Body
Check "set-password does not issue a session" ($r.Body -notmatch "session") $r.Body

$r = Call Post "set-password" @{ phone = $phone; password = $password }
Check "set-password refuses to overwrite an existing password" ($r.Status -ge 400) $r.Body

# --- login and session ------------------------------------------------------
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession

$r = Call Post "login" @{ phone = $phone; password = "Definitely-Wrong-Password" } $null
Check "login rejects a wrong password (401)" ($r.Status -eq 401) $r.Body

$r = Call Post "login" @{ phone = "08039999999"; password = $password } $null
Check "login on an unknown number gives the same 401" ($r.Status -eq 401 -and $r.Body -match "invalid_credentials") $r.Body

$r = Call Post "login" @{ phone = $phone; password = $password } $s
Check "login succeeds (200)" ($r.Status -eq 200) $r.Body

$cookie = $s.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "medilink_session" }
Check "session cookie is set" ($null -ne $cookie)
Check "session cookie is httpOnly" ($cookie -and $cookie.HttpOnly)

$r = Call Get "session" $null $s
Check "session returns the signed-in user (200)" ($r.Status -eq 200 -and $r.Body -match "permissions") $r.Body

$r = Call Get "session" $null (New-Object Microsoft.PowerShell.Commands.WebRequestSession)
Check "session without a cookie is rejected (401)" ($r.Status -eq 401) $r.Body

$r = Call Post "logout" @{} $s
Check "logout succeeds" ($r.Status -in 200, 204) $r.Body

$r = Call Get "session" $null $s
Check "session is dead after logout (401)" ($r.Status -eq 401) $r.Body

# --- lockout ----------------------------------------------------------------
# The successful login above cleared the consecutive-failure count, which is
# the documented behaviour, so this needs a full run of five failures rather
# than topping up the earlier one.
for ($i = 1; $i -le 4; $i++) {
    Call Post "login" @{ phone = $phone; password = "Wrong-Password-$i" } $null | Out-Null
}
$r = Call Post "login" @{ phone = $phone; password = "Wrong-Password-5" } $null
Check "the fifth failure is still a plain 401" ($r.Status -eq 401) $r.Body

# The correct password: proves the refusal is the lock, not the password.
$r = Call Post "login" @{ phone = $phone; password = $password } $null
Check "a locked account refuses the correct password (429)" ($r.Status -eq 429 -and $r.Body -match "account_locked") $r.Body
Check "lockout tells the caller when to retry" ($r.Body -match "retryAfterSeconds") $r.Body

# --- recovery ---------------------------------------------------------------
$r = Call Post "password/reset-request" @{ phone = "08039999999" }
Check "reset-request on an unknown number still returns 202" ($r.Status -eq 202) $r.Body

Write-Host ""
if ($script:failures -eq 0) {
    Write-Host "All checks passed." -ForegroundColor Green
    exit 0
} else {
    Write-Host "$($script:failures) check(s) failed." -ForegroundColor Red
    exit 1
}
