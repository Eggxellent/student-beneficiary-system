<#
.SYNOPSIS
    Shut SBMS back down to its $4.42/mo idle floor, keeping every record.

.DESCRIPTION
    A thin wrapper around teardown.ps1 -Stop, so the day-to-day command is symmetrical with
    start.ps1. It does not reimplement the stopping logic: teardown.ps1 already stops the server,
    waits for the Stopped state, records the timestamp that drives the 7-day countdown and refuses
    to destroy anything unless a dump has been taken.

    What keeps existing: the database, its 32 GiB of storage, the container image, the web app and
    every configuration. What stops: PostgreSQL compute ($0.02/h) and the container app replicas.

    The 7-day auto-start trap still applies - a stopped flexible server restarts itself after a
    week, so this has to be re-run. status.ps1 shows the countdown.

.EXAMPLE
    .\deploy\azure\stop.ps1

.EXAMPLE
    # Back up first, then stop.
    .\deploy\azure\stop.ps1 -Dump
#>
[CmdletBinding()]
param(
    [string]$ResourceGroup = 'rg-sbms',
    [string]$DbServerName = 'pg-sbms',
    [string]$ApiAppName = 'ca-sbms-api',
    [string]$DumpDirectory,

    [switch]$Dump
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$teardown = Join-Path $PSScriptRoot 'teardown.ps1'
if (-not (Test-Path $teardown)) { throw "teardown.ps1 is missing from $PSScriptRoot" }

$forward = @{
    ResourceGroup = $ResourceGroup
    DbServerName  = $DbServerName
    ApiAppName    = $ApiAppName
    Stop          = $true
}
if ($Dump) { $forward['Dump'] = $true }
if ($DumpDirectory) { $forward['DumpDirectory'] = $DumpDirectory }

& $teardown @forward

Write-Host ''
Write-Host '   Data preserved: server, database and storage are untouched - only compute stopped.' -ForegroundColor DarkGray
Write-Host '   Check the countdown with .\deploy\azure\status.ps1 and re-run this before day 7.' -ForegroundColor DarkGray
