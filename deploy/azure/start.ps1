<#
.SYNOPSIS
    Bring SBMS up for a demonstration or a test session, and prove that it works.

.DESCRIPTION
    Complements provision.ps1 (which creates) and teardown.ps1 (which stops). This is the day-to-day
    "on" switch: start PostgreSQL, wait for Ready, then verify the live backend and frontend instead
    of assuming they are fine.

    Idempotent - safe when everything is already running. Compute costs $0.02/h from the moment the
    server is Ready (about $4.58 for an 8-hour demo), so always finish with stop.ps1.

.EXAMPLE
    .\deploy\azure\start.ps1

.EXAMPLE
    # Skip the HTTP checks (for example when the API image is not deployed yet).
    .\deploy\azure\start.ps1 -SkipVerify
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-sbms',
    [string]$DbServerName = 'pg-sbms',
    [string]$ApiAppName = 'ca-sbms-api',
    [string]$WebAppName = 'sbms-web',

    # A cold flexible server takes 1-3 minutes; the margin is for a slow region.
    [int]$TimeoutSeconds = 600,

    [switch]$SkipVerify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Step { param([string]$Text) Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok { param([string]$Text) Write-Host "   $Text" -ForegroundColor DarkGray }
function Write-Warn { param([string]$Text) Write-Host "   ! $Text" -ForegroundColor Yellow }

function Test-AzExists {
    # `az ... show` on a missing resource writes to stderr, which under 'Stop' is terminating.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & az @args 2>&1 | Out-Null } finally { $ErrorActionPreference = $previous }
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-AzExists account show -o none)) { throw 'Not signed in. Run `az login`.' }

# ---------------------------------------------------------------------------------------------
# 1. PostgreSQL - the only resource whose state changes the bill
# ---------------------------------------------------------------------------------------------
Write-Step "1. PostgreSQL $DbServerName"
if (-not (Test-AzExists postgres flexible-server show -g $ResourceGroup -n $DbServerName -o none)) {
    throw "no database in $ResourceGroup. Create it once with: .\deploy\azure\provision.ps1 -IncludeDatabase -StartDatabase"
}

$state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
Write-Ok "current state: $state"

if ($state -eq 'Ready') {
    Write-Ok 'already running - compute is billing $0.02/h'
} else {
    if ($state -eq 'Stopped') {
        Write-Ok 'starting (~1-3 min)...'
        az postgres flexible-server start -g $ResourceGroup -n $DbServerName -o none 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Warn 'start returned non-zero (usually "already starting") - polling anyway' }
    } else {
        Write-Ok "already in transition ($state) - polling"
    }

    $waited = 0
    while ($waited -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 10
        $waited += 10
        $state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
        if ($state -eq 'Ready') { break }
        Write-Host "   ...$waited s ($state)"
    }
    if ($state -ne 'Ready') { throw "server did not reach Ready within $TimeoutSeconds s (state: $state)" }
    Write-Ok 'Ready - compute billing started'
}

if ($SkipVerify) {
    Write-Ok 'skipping verification (-SkipVerify)'
    return
}

# ---------------------------------------------------------------------------------------------
# 2. Backend - scale-from-zero means the first request can take 10-40 s
# ---------------------------------------------------------------------------------------------
Write-Step '2. Backend health and readiness'
$apiFqdn = az containerapp show -g $ResourceGroup -n $ApiAppName --query properties.configuration.ingress.fqdn -o tsv
if (-not $apiFqdn) { throw "container app $ApiAppName has no ingress FQDN. Run provision.ps1 -Image <image> first." }
Write-Ok "https://$apiFqdn"

$failed = @()
foreach ($path in '/api/health', '/api/ready') {
    $ok = $false
    for ($attempt = 1; $attempt -le 6 -and -not $ok; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri ('https://{0}{1}' -f $apiFqdn, $path) -TimeoutSec 90 -UseBasicParsing
            $body = ($response.Content -replace '\s+', ' ').Trim()
            if ($body.Length -gt 160) { $body = $body.Substring(0, 160) + '...' }
            Write-Ok ("{0} -> {1} {2}" -f $path, $response.StatusCode, $body)
            $ok = ($response.StatusCode -eq 200)
        } catch {
            Write-Warn ("{0} -> attempt {1}/6: {2}" -f $path, $attempt, $_.Exception.Message)
            if ($attempt -lt 6) { Start-Sleep -Seconds 10 }
        }
    }
    if (-not $ok) { $failed += $path }
}

# ---------------------------------------------------------------------------------------------
# 3. Frontend - a 200 alone is not proof that the SPA bundle was deployed
# ---------------------------------------------------------------------------------------------
Write-Step '3. Frontend'
if (Test-AzExists webapp show -g $ResourceGroup -n $WebAppName -o none) {
    $webUrl = 'https://{0}.azurewebsites.net' -f $WebAppName
    try {
        $web = Invoke-WebRequest -Uri $webUrl -TimeoutSec 60 -UseBasicParsing
        Write-Ok ("{0} -> {1}" -f $webUrl, $web.StatusCode)
        if ($web.Content -notmatch 'id="root"') {
            Write-Warn 'the response does not look like the built SPA (no #root element) - redeploy with provision.ps1 -DeployFrontend'
            $failed += 'frontend bundle'
        }
    } catch {
        Write-Warn ("{0} -> {1}" -f $webUrl, $_.Exception.Message)
        $failed += 'frontend'
    }
} else {
    Write-Warn 'web app not provisioned - run provision.ps1 -DeployFrontend'
    $failed += 'frontend'
}

# ---------------------------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------------------------
Write-Step 'Summary'
Write-Host @"
   Frontend   https://$WebAppName.azurewebsites.net
   API        https://$apiFqdn
   Database   Ready - billing `$0.02/h (`$4.58 for an 8-hour demo)
   When done  .\deploy\azure\stop.ps1        (with a backup: stop.ps1 -Dump)
"@ -ForegroundColor Gray

if ($failed.Count -gt 0) {
    throw ("startup verification failed: {0}. The database is running and billing - fix it, or stop it with .\deploy\azure\stop.ps1" -f ($failed -join ', '))
}
Write-Ok 'SBMS is up and verified'
