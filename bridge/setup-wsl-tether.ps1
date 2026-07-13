<#
.SYNOPSIS
  Prepare and run the MOTK Shoot gphoto2 camera agent through WSL2/usbipd-win.

.DESCRIPTION
  The default Check action is read-only. Actions that install packages, bind a
  USB device, or attach it to WSL run only when explicitly selected.

.EXAMPLE
  .\bridge\setup-wsl-tether.ps1
  .\bridge\setup-wsl-tether.ps1 -Action List
  .\bridge\setup-wsl-tether.ps1 -Action Bind -BusId 4-4       # elevated
  .\bridge\setup-wsl-tether.ps1 -Action Attach -BusId 4-4
  .\bridge\setup-wsl-tether.ps1 -Action PrepareWsl
  .\bridge\setup-wsl-tether.ps1 -Action RunAgent -OutputDir ~/shoots/scene01
#>
[CmdletBinding()]
param(
  [ValidateSet('Check', 'InstallHost', 'List', 'Bind', 'Attach', 'Detach', 'PrepareWsl', 'RunAgent')]
  [string]$Action = 'Check',

  [ValidatePattern('^[0-9]+-[0-9]+(?:\.[0-9]+)*$')]
  [string]$BusId,

  [ValidatePattern('^[A-Za-z0-9._ -]+$')]
  [string]$Distro = 'Ubuntu',

  [string]$OutputDir = '~/motk-shoot-originals'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Assert-Command([string]$Name, [string]$InstallHint) {
  if (-not (Test-Command $Name)) {
    throw "$Name was not found. $InstallHint"
  }
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Administrator {
  if (-not (Test-Administrator)) {
    throw 'This action requires an elevated PowerShell window (Run as administrator).'
  }
}

function Assert-BusId {
  if (-not $BusId) {
    throw 'This action requires -BusId. Run -Action List and copy the camera BUSID exactly.'
  }
}

function Invoke-Checked([string]$FilePath, [string[]]$ArgumentList) {
  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath exited with code $LASTEXITCODE."
  }
}

function Invoke-WslScript([string]$Script, [string[]]$ArgumentList = @()) {
  $Script | & wsl.exe -d $Distro -- bash -s -- @ArgumentList
}

function Show-Check {
  Write-Output 'MOTK Shoot WSL tether prerequisites'
  Write-Output (('PowerShell elevated: {0}' -f (Test-Administrator)))

  if (Test-Command 'wsl.exe') {
    Write-Output 'WSL: found'
    & wsl.exe --status
    & wsl.exe --list --verbose
    $probe = @'
set +e
. /etc/os-release
printf 'WSL distro: %s\n' "$PRETTY_NAME"
printf 'gphoto2: '
if command -v gphoto2 >/dev/null; then gphoto2 --version | head -1; else printf 'missing\n'; fi
printf 'node: '
if command -v node >/dev/null; then node --version; else printf 'missing\n'; fi
printf 'lsusb: '
if command -v lsusb >/dev/null; then command -v lsusb; else printf 'missing\n'; fi
# End of streamed script (keeps Windows CRLF away from a command token).
'@
    Invoke-WslScript $probe
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Could not inspect WSL distribution '$Distro'. Confirm its name with: wsl --list --verbose"
    }
  } else {
    Write-Warning 'WSL is missing. In elevated PowerShell run: wsl --install -d Ubuntu'
  }

  if (Test-Command 'usbipd.exe') {
    Write-Output ('usbipd-win: ' + (& usbipd.exe --version | Out-String).Trim())
    & usbipd.exe list
  } else {
    Write-Warning 'usbipd-win is missing. Install it from an elevated PowerShell window with: winget install --interactive --exact dorssel.usbipd-win'
  }
}

switch ($Action) {
  'Check' {
    Show-Check
  }
  'InstallHost' {
    Assert-Administrator
    Assert-Command 'wsl.exe' 'Windows 10 2004+ or Windows 11 is required.'
    $distroText = ((& wsl.exe --list --quiet | Out-String) -replace "`0", '')
    $installedDistros = @($distroText -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($installedDistros -notcontains $Distro) {
      Invoke-Checked 'wsl.exe' @('--install', '-d', $Distro)
    } else {
      Write-Output "WSL distribution '$Distro' is already installed."
    }
    Invoke-Checked 'wsl.exe' @('--update')
    if (Test-Command 'usbipd.exe') {
      Write-Output 'usbipd-win is already installed.'
    } else {
      Assert-Command 'winget.exe' 'Install or update Microsoft App Installer, or use the usbipd-win MSI.'
      Invoke-Checked 'winget.exe' @('install', '--interactive', '--exact', 'dorssel.usbipd-win')
    }
    Write-Output 'Host setup finished. Restart Windows if either installer requests it, then run -Action Check.'
  }
  'List' {
    Assert-Command 'usbipd.exe' 'Install with: winget install --interactive --exact dorssel.usbipd-win'
    Invoke-Checked 'usbipd.exe' @('list')
  }
  'Bind' {
    Assert-BusId
    Assert-Administrator
    Assert-Command 'usbipd.exe' 'Install with: winget install --interactive --exact dorssel.usbipd-win'
    Invoke-Checked 'usbipd.exe' @('bind', '--busid', $BusId)
    Write-Output "BUSID $BusId is shared persistently. Close the elevated window; Attach does not require elevation."
  }
  'Attach' {
    Assert-BusId
    Assert-Command 'wsl.exe' 'Install WSL2 with: wsl --install -d Ubuntu'
    Assert-Command 'usbipd.exe' 'Install with: winget install --interactive --exact dorssel.usbipd-win'
    Invoke-Checked 'wsl.exe' @('-d', $Distro, '--', 'true')
    Invoke-Checked 'usbipd.exe' @('attach', '--wsl', '--busid', $BusId)
    Write-Output "BUSID $BusId is attached to WSL2. It is unavailable to Windows until detached or unplugged."
    & wsl.exe -d $Distro -- bash -c 'command -v lsusb >/dev/null && exec lsusb'
    if ($LASTEXITCODE -ne 0) {
      Write-Warning 'Could not run lsusb inside WSL. Run -Action PrepareWsl, then detach and attach the camera again.'
    }
  }
  'Detach' {
    Assert-BusId
    Assert-Command 'usbipd.exe' 'Install with: winget install --interactive --exact dorssel.usbipd-win'
    Invoke-Checked 'usbipd.exe' @('detach', '--busid', $BusId)
    Write-Output "BUSID $BusId is detached and available to Windows again."
  }
  'PrepareWsl' {
    Assert-Command 'wsl.exe' 'Install WSL2 with: wsl --install -d Ubuntu'
    $install = @'
set -e
sudo apt-get update
sudo apt-get install -y gphoto2 nodejs usbutils
printf 'gphoto2: '
gphoto2 --version | head -1
printf 'node: '
node --version
node -e 'if (+process.versions.node.split(".")[0] < 18) process.exit(18)'
# End of streamed script.
'@
    Invoke-WslScript $install
    if ($LASTEXITCODE -eq 18) {
      throw 'Node.js is older than 18 in this distribution. Install Node 18+ inside WSL, then rerun -Action Check.'
    }
    if ($LASTEXITCODE -ne 0) {
      throw "WSL package preparation failed with code $LASTEXITCODE."
    }
  }
  'RunAgent' {
    Assert-Command 'wsl.exe' 'Install WSL2 with: wsl --install -d Ubuntu'
    $agentWindows = Join-Path $PSScriptRoot 'camera-agent.mjs'
    $agentPathBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($agentWindows))
    $translate = @'
windows_path=$(printf '%s' "$1" | base64 -d)
wslpath -a "$windows_path"
# End of streamed script.
'@
    $agentLinux = (Invoke-WslScript $translate @($agentPathBase64) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $agentLinux) {
      throw 'Could not translate the camera-agent path into WSL.'
    }
    $verify = @'
command -v gphoto2 >/dev/null || exit 17
command -v node >/dev/null || exit 17
node -e 'if (+process.versions.node.split(".")[0] < 18) process.exit(18)'
# End of streamed script.
'@
    Invoke-WslScript $verify
    if ($LASTEXITCODE -eq 18) { throw 'Node.js 18+ is required inside WSL.' }
    if ($LASTEXITCODE -ne 0) { throw 'gphoto2 or Node.js is missing inside WSL. Run -Action PrepareWsl first.' }
    Write-Output "Starting the gphoto2 agent in $Distro. Press Ctrl+C to stop it."
    $run = @'
exec node "$1" --backend gphoto2 --dir "$2"
# End of streamed script.
'@
    Invoke-WslScript $run @($agentLinux, $OutputDir)
    if ($LASTEXITCODE -ne 0) { throw "The camera agent exited with code $LASTEXITCODE." }
  }
}
