# az is not always on PATH. The Azure CLI installer adds its wbin directory to the *machine* PATH,
# so an already-open terminal, a child `powershell -NoProfile`, or a shell started by a task runner
# can miss it and every script in this folder fails with "Azure CLI not found". Resolve it once here.
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    $candidates = @(
        (Join-Path ${env:ProgramFiles} 'Microsoft SDKs\Azure\CLI2\wbin\az.cmd'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft SDKs\Azure\CLI2\wbin\az.cmd'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\az.cmd')
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            $env:Path = (Split-Path -Parent $candidate) + ';' + $env:Path
            break
        }
    }
}
