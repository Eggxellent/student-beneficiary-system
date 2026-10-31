<#
.SYNOPSIS
    Take SBMS out of its billing window - stop the database, and never lose the data by accident.

.DESCRIPTION
    Default behaviour (no switches) is the weekly action required by plan section 12.13:
    scale the container app to zero replicas and STOP the PostgreSQL server, leaving the 32 GiB of
    storage intact. Cost drops from `$0.02/h to `$4.42/mo.

    A stopped flexible server restarts itself after 7 days ("Server will be automatically started
    after 7 days if you do not perform a manual start operation"), so this must be re-run weekly.
    status.ps1 shows the countdown.

    -Dump    writes a compressed pg_dump to deploy/azure/backups/<timestamp>.dump first.
    -Destroy deletes the whole resource group - refused unless -Dump is also given, because it is
             the only irreversible action in this repository.

.EXAMPLE
    .\deploy\azure\teardown.ps1 -Stop

.EXAMPLE
    .\deploy\azure\teardown.ps1 -Dump -Stop

.EXAMPLE
    # End of project: dump, then delete everything.
    .\deploy\azure\teardown.ps1 -Dump -Destroy
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-sbms',
    [string]$DbServerName = 'pg-sbms',
    [string]$ApiAppName = 'ca-sbms-api',
    [string]$DatabaseName = 'sbms',
    [string]$DbAdminUser = 'sbmsadmin',
    [string]$DumpDirectory,

    [switch]$Stop,
    [switch]$Dump,
    [switch]$Destroy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$SecretsPath = Join-Path $PSScriptRoot '.secrets.json'
$StatePath = Join-Path $PSScriptRoot '.state.json'
if (-not $DumpDirectory) { $DumpDirectory = Join-Path $PSScriptRoot 'backups' }

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
# 1. Container app to zero replicas - free, and the app restarts on the next request anyway
# ---------------------------------------------------------------------------------------------
Write-Step "1. Container app $ApiAppName -> 0 replicas"
if (Test-AzExists containerapp show -g $ResourceGroup -n $ApiAppName -o none) {
    az containerapp update -g $ResourceGroup -n $ApiAppName --min-replicas 0 --max-replicas 1 -o none
    Write-Ok 'min replicas 0 (idle cost $0)'
} else {
    Write-Ok 'no container app found - nothing to scale'
}

# ---------------------------------------------------------------------------------------------
# 2. Optional dump - the safety net before anything irreversible
# ---------------------------------------------------------------------------------------------
if ($Dump) {
    Write-Step '2. Dumping the database'
    if (-not (Get-Command pg_dump -ErrorAction SilentlyContinue)) {
        throw 'pg_dump not found. Install the PostgreSQL client tools (it also ships with pgAdmin), then retry.'
    }
    if (-not (Test-Path $SecretsPath)) {
        throw 'deploy/azure/.secrets.json is missing - cannot authenticate. Use the password stored in the Container App secret instead.'
    }

    $secrets = Get-Content $SecretsPath -Raw | ConvertFrom-Json
    $dbHost = '{0}.postgres.database.azure.com' -f $DbServerName
    $state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
    if ($state -ne 'Ready') { throw "server state is '$state' - start it first (-StartDatabase in provision.ps1) so pg_dump can connect." }

    New-Item -ItemType Directory -Path $DumpDirectory -Force | Out-Null
    $dumpFile = Join-Path $DumpDirectory ('sbms-{0}.dump' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

    $env:PGPASSWORD = $secrets.dbPassword
    $env:PGSSLMODE = 'require'
    try {
        & pg_dump -h $dbHost -U $DbAdminUser -d $DatabaseName -Fc -f $dumpFile
        if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }
        $sizeMb = [math]::Round((Get-Item $dumpFile).Length / 1MB, 2)
        Write-Ok "wrote $dumpFile ($sizeMb MB)"
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        Remove-Item Env:\PGSSLMODE -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------------------------
# 3. Destroy - only with a dump, only when explicitly asked
# ---------------------------------------------------------------------------------------------
if ($Destroy) {
    Write-Step "3. Deleting resource group $ResourceGroup"
    if (-not $Dump) {
        throw 'refusing to destroy without -Dump. Run: .\deploy\azure\teardown.ps1 -Dump -Destroy'
    }
    $answer = Read-Host "Type the resource group name ($ResourceGroup) to confirm irreversible deletion"
    if ($answer -ne $ResourceGroup) { throw 'confirmation did not match - nothing deleted.' }

    az group delete -n $ResourceGroup --yes -o none
    if ($LASTEXITCODE -ne 0) { throw 'resource group deletion failed' }
    if (Test-Path $StatePath) { Remove-Item $StatePath -Force }
    Write-Ok 'resource group deleted - subscription is back to $0.00'
    return
}

# ---------------------------------------------------------------------------------------------
# 4. Stop the database - the weekly action
# ---------------------------------------------------------------------------------------------
Write-Step "4. PostgreSQL $DbServerName -> Stopped"
if (-not (Test-AzExists postgres flexible-server show -g $ResourceGroup -n $DbServerName -o none)) {
    Write-Warn 'no database found - nothing to stop (the free half of the stack stays at $0)'
    return
}

$state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
Write-Ok "current state: $state"

if ($state -eq 'Stopped') {
    Write-Ok 'already stopped - no compute billing'
} else {
    az postgres flexible-server stop -g $ResourceGroup -n $DbServerName -o none
    if ($LASTEXITCODE -ne 0) { throw 'stop failed - check `az postgres flexible-server show` for the state' }

    $waited = 0
    while ($waited -lt 30) {
        Start-Sleep -Seconds 10
        $waited += 10
        $state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
        if ($state -eq 'Stopped') { break }
        Write-Host "   ...$waited s ($state)"
    }
    if ($state -ne 'Stopped') { throw "server did not reach Stopped within 5 minutes (state: $state)" }
    Write-Ok 'stopped - compute billing ended'
}

# ---------------------------------------------------------------------------------------------
# 5. Record the stop so status.ps1 can count the 7 days
# ---------------------------------------------------------------------------------------------
$now = Get-Date
$record = [pscustomobject]@{
    lastStopAt   = $now.ToString('o')
    resourceGroup = $ResourceGroup
    dbServerName = $DbServerName
}

# Keep the previous timestamp too: "days since last stop" is the thing being tracked.
if (Test-Path $StatePath) {
    $previous = Get-Content $StatePath -Raw | ConvertFrom-Json
    if ($previous.PSObject.Properties.Name -contains 'lastStopAt') { $record | Add-Member -NotePropertyName previousStopAt -NotePropertyValue $previous.lastStopAt }
}
$record | ConvertTo-Json | Set-Content -Path $StatePath -Encoding UTF8

$deadline = $now.AddDays(7)
Write-Step 'Summary'
Write-Host @"
   Database state        $state
   Billing now           `$4.42/mo (32 GiB storage only)
   Auto-start deadline   $($deadline.ToString('yyyy-MM-dd HH:mm'))  (7 days from this stop)
   Re-run before then    .\deploy\azure\teardown.ps1 -Stop
   Countdown             .\deploy\azure\status.ps1
"@ -ForegroundColor Gray


