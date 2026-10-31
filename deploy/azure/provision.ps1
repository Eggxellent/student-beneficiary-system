<#
.SYNOPSIS
    Idempotent provisioner for SBMS on Azure - architecture A2 (plan section 12, D8).

.DESCRIPTION
    Creates, in order: resource group, Container Apps environment (no log workspace), the container
    app (min replicas 0), the free F1 Windows web app, the $15 budget, and - only when asked - the
    PostgreSQL flexible server that is the single resource with a recurring charge.

    Everything is create-or-update, so running it twice is safe. It never deletes anything: that is
    teardown.ps1's job, and teardown refuses to destroy the database without a dump first.

    Cost (UAE North, verified 31 Oct 2026): resource group, environment, container app at 0
    replicas, F1 web app, budget = $0.00. PostgreSQL B1MS 32 GiB = $4.42/mo whether running or
    stopped, plus $0.02/h while running.

.EXAMPLE
    # Free half only. Costs nothing and can stay.
    .\deploy\azure\provision.ps1

.EXAMPLE
    # Demo day: create the database, schema, first admin, and warm the app.
    .\deploy\azure\provision.ps1 -Image ghcr.io/eggxellent/sbms-api:demo `
        -IncludeDatabase -StartDatabase -BootstrapDatabase -DeployFrontend -WarmUp `
        -AdminEmail you@example.com -AdminPassword 'a-long-passphrase'

.EXAMPLE
    # After a demo, or as the weekly action: back to $4.42/mo.
    .\deploy\azure\teardown.ps1 -Stop
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-sbms',
    [string]$Location = 'uaenorth',

    # Container image to run. Omit to leave the container app untouched.
    [string]$Image,

    [string]$ApiAppName = 'ca-sbms-api',
    [string]$EnvironmentName = 'cae-sbms',
    [string]$WebAppName = 'sbms-web',
    [string]$PlanName = 'asp-sbms-web',

    [string]$DbServerName = 'pg-sbms',
    [string]$DatabaseName = 'sbms',
    [string]$DbAdminUser = 'sbmsadmin',

    # Not 5: a stopped database already costs $4.42/mo, so a $5 ceiling would fire every month and
    # its 50 % band ($2.50) could never fire at all. Plan section 12.14.
    [decimal]$BudgetAmount = 15,
    [string]$BudgetEmail,

    # Frontend origin override. Default: the container app FQDN.
    [string]$FrontendApiOrigin,

    [string]$AdminEmail,
    [string]$AdminPassword,

    [switch]$IncludeDatabase,
    [switch]$StartDatabase,
    [switch]$BootstrapDatabase,
    [switch]$DeployFrontend,
    [switch]$WarmUp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SecretsPath = Join-Path $PSScriptRoot '.secrets.json'
$ApiFqdn = $null

function Write-Step {
    param([string]$Text)
    Write-Host ''
    Write-Host "== $Text" -ForegroundColor Cyan
}

function Write-Ok {
    param([string]$Text)
    Write-Host "   $Text" -ForegroundColor DarkGray
}

function Write-Warn {
    param([string]$Text)
    Write-Host "   ! $Text" -ForegroundColor Yellow
}

function Invoke-Az {
    az @args
    if ($LASTEXITCODE -ne 0) {
        throw "az $($args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Test-AzExists {
    az @args 2>$null | Out-Null
    return ($LASTEXITCODE -eq 0)
}

function Get-Secrets {
    if (Test-Path $SecretsPath) {
        Write-Ok 'reusing generated secrets from deploy/azure/.secrets.json'
        return (Get-Content $SecretsPath -Raw | ConvertFrom-Json)
    }

    # Alphanumeric only: the password is embedded in a URL, so no percent-encoding surprises.
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = New-Object 'byte[]' 40
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $password = -join ($bytes[0..29] | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    $jwt = -join ($bytes | ForEach-Object { $_.ToString('x2') })

    $fresh = [pscustomobject]@{ dbPassword = $password; jwtSecret = $jwt }
    $fresh | ConvertTo-Json | Set-Content -Path $SecretsPath -Encoding UTF8
    Write-Ok 'generated dbPassword + jwtSecret into deploy/azure/.secrets.json (git-ignored)'
    return $fresh
}

# ---------------------------------------------------------------------------------------------
# 1. Preflight
# ---------------------------------------------------------------------------------------------
Write-Step '1. Preflight'

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw 'Azure CLI not found. Install it, or open a shell where `az` resolves.'
}

$account = az account show --query '{name:name, id:id, user:user.name}' -o json 2>$null
if ($LASTEXITCODE -ne 0 -or -not $account) {
    throw 'Not signed in. Run `az login` and try again.'
}
$accountInfo = $account | ConvertFrom-Json
Write-Ok "subscription: $($accountInfo.name) ($($accountInfo.id))"
Write-Ok "signed in as: $($accountInfo.user) - region: $Location"

$secrets = Get-Secrets
$dbHost = '{0}.postgres.database.azure.com' -f $DbServerName
$dbUrl = 'postgresql://{0}:{1}@{2}:5432/{3}?sslmode=require' -f $DbAdminUser, $secrets.dbPassword, $dbHost, $DatabaseName

# ---------------------------------------------------------------------------------------------
# 2. Resource group - $0
# ---------------------------------------------------------------------------------------------
Write-Step "2. Resource group $ResourceGroup"
Invoke-Az group create -n $ResourceGroup -l $Location -o none
Write-Ok 'ready ($0)'

# ---------------------------------------------------------------------------------------------
# 3. Container Apps environment - $0, and no Log Analytics workspace at all
# ---------------------------------------------------------------------------------------------
Write-Step "3. Container Apps environment $EnvironmentName"
if (Test-AzExists containerapp env show -g $ResourceGroup -n $EnvironmentName -o none) {
    Write-Ok 'already exists - left untouched'
} else {
    Invoke-Az containerapp env create -g $ResourceGroup -n $EnvironmentName -l $Location --logs-destination none -o none
    Write-Ok 'created with --logs-destination none ($0 fixed, no ingestion)'
}

# ---------------------------------------------------------------------------------------------
# 4. Container app - $0 while it sits at 0 replicas
# ---------------------------------------------------------------------------------------------
Write-Step "4. Container app $ApiAppName"
if (-not $Image) {
    Write-Warn 'no -Image given: skipping the API deployment (everything else still applies)'
} else {
    $webOrigin = 'https://{0}.azurewebsites.net' -f $WebAppName
    $envVars = @(
        'NODE_ENV=production'
        'PYTHON_EXECUTABLE=/app/ml-service/.venv/bin/python'
        "CORS_ORIGINS=$webOrigin"
        "PUBLIC_APP_URL=$webOrigin"
        'DATABASE_URL=secretref:database-url'
        'JWT_SECRET=secretref:jwt-secret'
    )

    if (Test-AzExists containerapp show -g $ResourceGroup -n $ApiAppName -o none) {
        Invoke-Az containerapp secret set -g $ResourceGroup -n $ApiAppName `
            --secrets "database-url=$dbUrl" "jwt-secret=$($secrets.jwtSecret)" -o none
        Invoke-Az containerapp update -g $ResourceGroup -n $ApiAppName `
            --image $Image --min-replicas 0 --max-replicas 1 --set-env-vars @envVars -o none
        Write-Ok "updated to $Image"
    } else {
        Invoke-Az containerapp create -g $ResourceGroup -n $ApiAppName `
            --environment $EnvironmentName --image $Image `
            --target-port 5000 --ingress external `
            --min-replicas 0 --max-replicas 1 --cpu 0.5 --memory 1Gi `
            --secrets "database-url=$dbUrl" "jwt-secret=$($secrets.jwtSecret)" `
            --env-vars @envVars -o none
        Write-Ok 'created: min-replicas 0, max 1, 0.5 vCPU / 1 GiB, port 5000'
    }

    $ApiFqdn = az containerapp show -g $ResourceGroup -n $ApiAppName --query properties.configuration.ingress.fqdn -o tsv
    Write-Ok "https://$ApiFqdn"
}

# ---------------------------------------------------------------------------------------------
# 5. App Service F1 (Windows) - $0
# ---------------------------------------------------------------------------------------------
Write-Step "5. App Service plan $PlanName (F1) + web app $WebAppName"
if (Test-AzExists appservice plan show -g $ResourceGroup -n $PlanName -o none) {
    Write-Ok 'plan already exists'
} else {
    # No --is-linux on purpose: Windows/IIS serves the built SPA, a Linux plan would need a container.
    Invoke-Az appservice plan create -g $ResourceGroup -n $PlanName --sku F1 -l $Location -o none
    Write-Ok 'plan created (F1 = free, 60 CPU-min/day)'
}

if (Test-AzExists webapp show -g $ResourceGroup -n $WebAppName -o none) {
    Write-Ok 'web app already exists'
} else {
    Invoke-Az webapp create -g $ResourceGroup -n $WebAppName -p $PlanName -o none
    Write-Ok "created https://$WebAppName.azurewebsites.net"
}
Invoke-Az webapp update -g $ResourceGroup -n $WebAppName --https-only true -o none

if ($DeployFrontend) {
    if (-not $ApiFqdn) {
        $ApiFqdn = az containerapp show -g $ResourceGroup -n $ApiAppName --query properties.configuration.ingress.fqdn -o tsv
    }
    $origin = $FrontendApiOrigin
    if (-not $origin) { $origin = 'https://{0}' -f $ApiFqdn }
    Write-Ok "building frontend with VITE_API_ORIGIN=$origin"

    $env:VITE_API_ORIGIN = $origin
    Push-Location $RepoRoot
    try {
        npm --prefix frontend run build
        if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
        $dist = Join-Path $RepoRoot 'frontend\dist'
        if (-not (Test-Path (Join-Path $dist 'web.config'))) {
            Write-Warn 'web.config missing from dist - the SPA rewrite will not be deployed'
        }
        $zip = Join-Path $env:TEMP 'sbms-web.zip'
        Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zip -Force
        Invoke-Az webapp deploy -g $ResourceGroup -n $WebAppName --src-path $zip --type zip -o none
        Write-Ok 'frontend deployed (zip)'
    } finally {
        Pop-Location
        Remove-Item Env:\VITE_API_ORIGIN -ErrorAction SilentlyContinue
    }
} else {
    Write-Ok 'frontend not deployed (pass -DeployFrontend to build and push it)'
}

# ---------------------------------------------------------------------------------------------
# 6. Budget guardrail - $0
# ---------------------------------------------------------------------------------------------
Write-Step "6. Consumption budget `$$BudgetAmount"
$notifications = @()
foreach ($threshold in 50, 75, 100) {
    $entry = @{
        enabled       = $true
        operator      = 'GreaterThan'
        threshold     = [int]$threshold
        thresholdType = 'Actual'
    }
    if ($BudgetEmail) { $entry['contactEmails'] = @($BudgetEmail) } else { $entry['contactRoles'] = @('Owner') }
    $notifications += $entry
}
$notificationJson = ConvertTo-Json -InputObject $notifications -Compress -Depth 5
$startDate = (Get-Date).ToString('yyyy-MM-01')
$endDate = (Get-Date).AddYears(3).ToString('yyyy-MM-dd')

az consumption budget create --budget-name budget-sbms --amount $BudgetAmount --category cost `
    --time-grain Monthly --start-date $startDate --end-date $endDate `
    --notifications $notificationJson -o none 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Ok 'budget created, alerts at 50/75/100 % of the monthly amount'
} else {
    Write-Warn 'budget could not be created from the CLI - set it in the portal (Cost Management > Budgets)'
}

# ---------------------------------------------------------------------------------------------
# 7. PostgreSQL - the only resource that bills
# ---------------------------------------------------------------------------------------------
Write-Step "7. PostgreSQL $DbServerName"
$dbExists = Test-AzExists postgres flexible-server show -g $ResourceGroup -n $DbServerName -o none

if (-not $dbExists) {
    if ($IncludeDatabase) {
        Write-Warn 'creating B1MS / 32 GiB / PG 16 - this starts billing: $4.42/mo storage + $0.02/h'
        az postgres flexible-server create -g $ResourceGroup -n $DbServerName -l $Location `
            --tier Burstable --sku-name Standard_B1ms --storage-size 32 --version 16 `
            --database-name $DatabaseName --admin-user $DbAdminUser `
            --admin-password $secrets.dbPassword --public-access 0.0.0.0 `
            --backup-retention 7 --yes -o none
        if ($LASTEXITCODE -ne 0) {
            throw "database creation failed. If '$DbServerName' is taken, re-run with -DbServerName <unique-name>."
        }
        Write-Ok "created $dbHost/$DatabaseName"
    } else {
        Write-Warn 'no database yet. Pass -IncludeDatabase on demo day (that is the only spending step).'
    }
}

if ($dbExists -or $IncludeDatabase) {
    $state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
    Write-Ok "state: $state"

    if ($StartDatabase -and $state -ne 'Ready') {
        Write-Ok 'starting the server (~1-3 min)...'
        az postgres flexible-server start -g $ResourceGroup -n $DbServerName -o none 2>$null
        if ($LASTEXITCODE -ne 0) { Write-Warn 'start returned non-zero (usually "already starting/running")' }

        $waited = 0
        while ($waited -lt 60) {
            Start-Sleep -Seconds 10
            $waited += 10
            $state = az postgres flexible-server show -g $ResourceGroup -n $DbServerName --query state -o tsv
            if ($state -eq 'Ready') { break }
            Write-Host "   ...$waited s ($state)"
        }
        if ($state -ne 'Ready') { throw "server did not reach Ready within 10 minutes (state: $state)" }
        Write-Ok 'Ready - compute is now billing $0.02/h'
    }

    # Keep the "Azure services only" rule present even if the server predates this script.
    az postgres flexible-server firewall-rule create -g $ResourceGroup -n $DbServerName `
        --name AllowAzureServices --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 -o none 2>$null | Out-Null
}

# ---------------------------------------------------------------------------------------------
# 8. One-time bootstrap (schema, migrations, first admin)
# ---------------------------------------------------------------------------------------------
if ($BootstrapDatabase) {
    Write-Step '8. Bootstrap schema + first admin'
    if (-not (Test-Path (Join-Path $RepoRoot 'backend\node_modules'))) {
        throw 'backend/node_modules is missing - run `npm install --prefix backend` first.'
    }

    $env:DATABASE_URL = $dbUrl
    Push-Location (Join-Path $RepoRoot 'backend')
    try {
        Write-Ok 'db:bootstrap-empty'
        npm run db:bootstrap-empty
        if ($LASTEXITCODE -ne 0) { throw 'db:bootstrap-empty failed' }

        Write-Ok 'migrate'
        npm run migrate
        if ($LASTEXITCODE -ne 0) { throw 'migrate failed' }
    } finally {
        Pop-Location
    }

    if ($AdminEmail -and $AdminPassword) {
        $env:ADMIN_EMAIL = $AdminEmail
        $env:ADMIN_PASSWORD = $AdminPassword
        Write-Ok 'create-admin.mjs'
        node (Join-Path $PSScriptRoot 'create-admin.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'create-admin.mjs failed' }
        Remove-Item Env:\ADMIN_PASSWORD -ErrorAction SilentlyContinue
    } else {
        Write-Warn 'no -AdminEmail/-AdminPassword: create the first admin with deploy/azure/create-admin.mjs'
    }
    Write-Ok 'bootstrap complete'
}

# ---------------------------------------------------------------------------------------------
# 9. Verification
# ---------------------------------------------------------------------------------------------
if ($WarmUp -and $ApiFqdn) {
    Write-Step '9. Warm-up and health check'
    Write-Ok 'the first request can take 10-40 s (scale from zero + model load)'
    foreach ($path in '/api/health', '/api/ready') {
        try {
            $response = Invoke-WebRequest -Uri ('https://{0}{1}' -f $ApiFqdn, $path) -TimeoutSec 90 -UseBasicParsing
            Write-Ok ("{0} -> {1} {2}" -f $path, $response.StatusCode, $response.Content)
        } catch {
            Write-Warn ("{0} -> {1}" -f $path, $_.Exception.Message)
        }
    }
}

# ---------------------------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------------------------
Write-Step 'Summary'
Write-Host @"
   API        https://$ApiFqdn
   Frontend   https://$WebAppName.azurewebsites.net
   Database   $dbHost / $DatabaseName  (secret in deploy/azure/.secrets.json)
   Billing    `$4.42/mo storage always; `$0.02/h only while the database is Ready

   Weekly obligation - run at least every 7 days or the server auto-starts (plan section 12.13):
       .\deploy\azure\teardown.ps1 -Stop
   Check the countdown any time:
       .\deploy\azure\status.ps1
"@ -ForegroundColor Gray






