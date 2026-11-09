$ErrorActionPreference = 'Stop'
if ($args.Count -ne 0) { throw 'Do not pass credentials as arguments. Run this script without arguments.' }
Write-Host 'PDGA read-only API test. Nothing is saved to files, environment variables, or Azure.'
Write-Host 'Do not run under PowerShell transcription, screen recording, or command debugging.'
$credential = Get-Credential -Message 'Enter your approved PDGA API account. Password input is hidden.'
if ($null -eq $credential) { throw 'PDGA test cancelled.' }
$process = $null
$password = $null
$payload = $null
try {
  $node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $node
  $start.Arguments = '"' + (Join-Path $PSScriptRoot 'pdga-test.mjs') + '"'
  $start.UseShellExecute = $false
  $start.RedirectStandardInput = $true
  $start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
  $process = [Diagnostics.Process]::Start($start)
  # The password crosses only an anonymous child-process stdin pipe, never argv or a file.
  $password = $credential.GetNetworkCredential().Password
  $payload = @{ username = $credential.UserName; password = $password } | ConvertTo-Json -Compress
  $process.StandardInput.WriteLine($payload)
  $process.StandardInput.Close()
  $password = $null
  $payload = $null
  $process.WaitForExit()
  if ($process.ExitCode -ne 0) { throw 'PDGA test failed. See the sanitized error above.' }
} finally {
  $password = $null
  $payload = $null
  $credential = $null
  if ($null -ne $process) {
    if (!$process.HasExited) { $process.Kill() }
    $process.Dispose()
  }
}
