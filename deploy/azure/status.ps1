<#
.SYNOPSIS
    What SBMS is costing right now, and how many days are left before PostgreSQL restarts itself.

.DESCRIPTION
    Read-only: no resource is created, changed or deleted. Prints the database state, the days since
    the last stop recorded by teardown.ps1, the 7-day auto-start deadline, the container app's
    replica floor and FQDN, and the resulting monthly burn.

    Run it when the weekly reminder fires, or before a demo.

.EXAMPLE
    .\deploy\azure\status.ps1
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-sbms',
    [string]$DbServerName = 'pg-sbms',
    [string]$ApiAppName = 'ca-sbms-api',
    [string]$WebAppName = 'sbms-web'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$StatePath = Join-Path $PSScriptRoot '.state.json'

function Write-Step { param([string]$Text) Write-Host ''; Write-Host "== $Text" -ForegroundColor Cyan }
function Write-Ok { param([string]$Text) Write-Host "   $Text" -ForegroundColor DarkGray }

function Test-AzExists {
    az @args 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

if (-not (Test-AzExists account show -o none)) { throw 'Not signed in. Run `az login`.' }

$account = az account show --query '{name:name, id:id}' -o json | ConvertFrom-Json
Write-Step 'Subscription'
Write-Ok "$($account.name) ($($account.id))"

if (-not (Test-AzExists group show -n $ResourceGroup -o none)) {
    Write-Step 'Resource group'
    Write-Ok "$ResourceGroup does not exist - nothing is provisioned, burn is `$0.00"
    return
}

# ---------------------------------------------------------------------------------------------
# Database - the only thing that bills
# ---------------------------------------------------------------------------------------------
Write-Step 'PostgreSQL'
$monthly = 0.0
$dbExists = Test-AzExists postgres flexible-server show -g $ResourceGroup -n $DbServerName -o none

if (-not $dbExists) {
    Write-Ok 'no database provisioned - burn is $0.00'
} else {
    $db = az postgres flexible-server show -g $ResourceGroup -n $DbServerName `
        --query '{state:state, tier:sku.tier, sku:sku.name, gb:storage.storageSizeGb}' -o json | ConvertFrom-Json
    Write-Ok "server    $DbServerName ($($db.tier) $($db.sku), $($db.gb) GiB)"
    Write-Ok "state     $($db.state)"

    switch ($db.state) {
        'Stopped' { $monthly += 4.42; Write-Ok 'billing   $4.42/mo - storage only' }
        'Ready'   { $monthly += 4.42 + (0.02 * 730); Write-Ok 'billing   $4.42/mo + $0.02/h - RUNNING, stop it when the demo ends' }
        default   { $monthly += 4.42 + (0.02 * 730); Write-Ok 'billing   transition state - compute is billing' }
    }

    # Countdown from the last recorded stop (teardown.ps1 writes it; Azure exposes no "stopped since").
    if (Test-Path $StatePath) {
        $state = Get-Content $StatePath -Raw | ConvertFrom-Json
        if ($state.PSObject.Properties.Name -contains 'lastStopAt') {
            $lastStop = [datetime]::Parse($state.lastStopAt)
            $daysSince = [math]::Round(((Get-Date) - $lastStop).TotalDays, 1)
            $daysLeft = [math]::Round((7 - ((Get-Date) - $lastStop).TotalDays), 1)

            Write-Ok "last stop $($lastStop.ToString('yyyy-MM-dd HH:mm')) - $daysSince day(s) ago"
            if ($daysLeft -le 0) {
                Write-Host '   ! the 7-day auto-start window has elapsed: the server may restart on its own. Run teardown.ps1 -Stop now.' -ForegroundColor Red
            } elseif ($daysLeft -lt 1) {
                Write-Host "   ! $daysLeft day(s) left before auto-start - run teardown.ps1 -Stop today." -ForegroundColor Red
            } elseif ($daysLeft -lt 2) {
                Write-Host "   ! $daysLeft day(s) left before auto-start - run teardown.ps1 -Stop tomorrow." -ForegroundColor Yellow
            } else {
                Write-Ok "auto-start in $daysLeft day(s) - no action needed yet"
            }
        }
    } else {
        Write-Ok 'no stop recorded in deploy/azure/.state.json - run teardown.ps1 -Stop to start the countdown'
    }
}

# ---------------------------------------------------------------------------------------------
# API and frontend - both $0 at rest
# ---------------------------------------------------------------------------------------------
Write-Step 'Container app'
if (Test-AzExists containerapp show -g $ResourceGroup -n $ApiAppName -o none) {
    $app = az containerapp show -g $ResourceGroup -n $ApiAppName `
        --query '{fqdn:properties.configuration.ingress.fqdn, min:properties.template.scale.minReplicas, max:properties.template.scale.maxReplicas}' -o json | ConvertFrom-Json
    Write-Ok "url       https://$($app.fqdn)"
    Write-Ok "replicas  min $($app.min) / max $($app.max)"
    if ($app.min -ne 0) {
        Write-Host '   ! min replicas is not 0 - this bills ~$0.054/h while it stays above zero' -ForegroundColor Yellow
    }
} else {
    Write-Ok 'not provisioned'
}

Write-Step 'Frontend'
if (Test-AzExists webapp show -g $ResourceGroup -n $WebAppName -o none) {
    Write-Ok "url       https://$WebAppName.azurewebsites.net"
    Write-Ok 'billing   $0.00 (F1 free plan)'
} else {
    Write-Ok 'not provisioned'
}

# ---------------------------------------------------------------------------------------------
# Total
# ---------------------------------------------------------------------------------------------
Write-Step 'Estimated monthly burn'
Write-Ok ('${0:N2} / month' -f $monthly)
Write-Ok 'resource group, Container Apps environment, F1 web app and budget add $0.00'

if ($monthly -gt 5) {
    Write-Host '   ! above the $15 budget alert - stop the database if no demo is imminent' -ForegroundColor Yellow
}

