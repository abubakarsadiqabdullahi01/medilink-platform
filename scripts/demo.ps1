<#
Switches the app between the development server and a production build.

  scripts\demo.ps1 on      production build on http://localhost:3000 (use this to present)
  scripts\demo.ps1 off     back to the development server with hot reload
  scripts\demo.ps1 status  which one is running

Why: `next dev` compiles each page the first time it is opened, and on a Windows
bind mount that is seconds per screen. A production build compiles once, here,
and every page after that is instant. The first `on` takes a minute or two.
Code changes are NOT picked up in demo mode; run `off` to work, `on` to present.
#>
param([Parameter(Position = 0)][ValidateSet('on', 'off', 'status')][string]$Mode = 'status')

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

function Wait-Healthy([string]$What) {
  Write-Host "Waiting for $What ..."
  for ($i = 0; $i -lt 120; $i++) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/api/v1/health' -TimeoutSec 3
      if ($r.StatusCode -eq 200) { Write-Host "$What is up at http://localhost:3000"; return }
    } catch { }
    Start-Sleep -Seconds 3
  }
  throw "$What did not become healthy. See: docker compose logs --tail 50 $What"
}

switch ($Mode) {
  'on' {
    docker compose stop web | Out-Null
    docker compose --profile demo up -d --force-recreate demo
    Wait-Healthy 'demo'
  }
  'off' {
    docker compose --profile demo stop demo | Out-Null
    docker compose up -d web
    Wait-Healthy 'web'
  }
  'status' {
    $running = docker compose ps --services --status running
    if ($running -contains 'demo') { 'demo (production build) is serving port 3000' }
    elseif ($running -contains 'web') { 'web (development server) is serving port 3000' }
    else { 'nothing is serving port 3000' }
  }
}
