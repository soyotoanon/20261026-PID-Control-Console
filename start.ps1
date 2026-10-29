param(
    [ValidateRange(1024, 65535)][int]$Port = 8766,
    [switch]$NoOpen
)
$ErrorActionPreference = 'Stop'
$motRoot = $PSScriptRoot
$motTaskName = if ($Port -eq 8766) { 'MOT-PID-Control-Console' } else { "MOT-PID-Control-Console-$Port" }
$motUrl = "http://127.0.0.1:$Port"

function Test-MotReady {
    $motResponse = $null
    try {
        $motRequest = [System.Net.HttpWebRequest]::Create("$motUrl/api/health")
        $motRequest.Proxy = $null
        $motRequest.Timeout = 1500
        try { $motResponse = $motRequest.GetResponse() }
        catch [System.Net.WebException] {
            if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) {
                $motResponse = $_.Exception.Response
            } else { return $false }
        }
        $motReader = New-Object System.IO.StreamReader($motResponse.GetResponseStream())
        try { $motBody = $motReader.ReadToEnd() | ConvertFrom-Json }
        finally { $motReader.Dispose() }
        return $motBody.app -eq 'mot556-console'
    } catch { return $false }
    finally { if ($motResponse) { $motResponse.Close() } }
}

try {
    if (Test-Path -LiteralPath 'D:\mamba\python.exe') {
        $motPython = 'D:\mamba\python.exe'
    } else {
        $motPython = (Get-Command python.exe -ErrorAction Stop).Source
    }
    $motPythonWindowless = Join-Path (Split-Path -Parent $motPython) 'pythonw.exe'
    if (-not (Test-Path -LiteralPath $motPythonWindowless)) {
        throw 'Python 3.10+ with pythonw.exe is required. Install Python and run start.cmd again.'
    }
    $motUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $motAction = New-ScheduledTaskAction -Execute $motPythonWindowless -Argument ('-B -u "{0}" --port {1}' -f (Join-Path $motRoot 'launcher.py'), $Port) -WorkingDirectory $motRoot
    $motTrigger = New-ScheduledTaskTrigger -AtLogOn -User $motUser
    $motPrincipal = New-ScheduledTaskPrincipal -UserId $motUser -LogonType Interactive -RunLevel Limited
    $motSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
    $motDescription = 'MOT PID local console: keep loopback UI available. No automatic instrument configuration.'
    $motExisting = Get-ScheduledTask -TaskName $motTaskName -ErrorAction SilentlyContinue
    if ($motExisting -and $motExisting.Description -ne $motDescription) {
        throw "An unrelated scheduled task already uses $motTaskName. It was not changed."
    }
    $motNeedsInstall = -not $motExisting -or $motExisting.Actions.Execute -ne $motAction.Execute -or $motExisting.Actions.Arguments -ne $motAction.Arguments -or $motExisting.Actions.WorkingDirectory -ne $motRoot
    if ($motNeedsInstall) {
        Register-ScheduledTask -TaskName $motTaskName -Action $motAction -Trigger $motTrigger -Principal $motPrincipal -Settings $motSettings -Description $motDescription -Force | Out-Null
    }
    if ((Get-ScheduledTask -TaskName $motTaskName).State -ne 'Running') {
        Start-ScheduledTask -TaskName $motTaskName
    }
    $motDeadline = [DateTime]::UtcNow.AddSeconds(25)
    while (-not (Test-MotReady)) {
        if ([DateTime]::UtcNow -ge $motDeadline) {
            throw "Local service is unavailable. Logs: $env:LOCALAPPDATA\MOT-PID-Control-Console\$Port"
        }
        Start-Sleep -Milliseconds 300
    }
    if (-not $NoOpen) { Start-Process -FilePath "$motUrl/#overview" }
    [pscustomobject]@{ app = 'mot556-console'; ready = $true; url = $motUrl; task = $motTaskName; state = [string](Get-ScheduledTask -TaskName $motTaskName).State } | ConvertTo-Json -Compress
} catch {
    if (-not $NoOpen) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show("本机控制台启动失败：`n$($_.Exception.Message)", 'MOT 光功率控制台') | Out-Null
    }
    Write-Error $_
    exit 1
}
