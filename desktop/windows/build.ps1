param (
    [string] $Compiler = 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe',
    [string] $Output = (Join-Path $PWD 'windows-installer'),
    [string] $SignCommand
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtime = (Get-Command node.exe).Source
if ((& $runtime -p 'process.arch') -ne 'x64') { throw 'Build the x64 installer with an x64 Windows Node.js runtime.' }
if (-not (Test-Path -LiteralPath $Compiler)) { throw 'Inno Setup compiler not found.' }
$metadata = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$stage = Join-Path ([IO.Path]::GetTempPath()) ('diagnose-probe-' + [Guid]::NewGuid())
New-Item -ItemType Directory $stage, $Output -Force | Out-Null
$Output = (Resolve-Path $Output).Path
try {
    Push-Location $root
    try {
        & npm.cmd run build
        if ($LASTEXITCODE) { throw 'TypeScript build failed.' }
    } finally { Pop-Location }
    Copy-Item -LiteralPath (Join-Path $root 'dist') -Destination $stage -Recurse
    foreach ($file in @('package.json', 'npm-shrinkwrap.json', 'LICENSE')) {
        Copy-Item -LiteralPath (Join-Path $root $file) -Destination $stage
    }
    Copy-Item -LiteralPath $runtime -Destination (Join-Path $stage 'node.exe')
    Copy-Item -LiteralPath (Join-Path (Split-Path -Parent $runtime) 'LICENSE') -Destination (Join-Path $stage 'NODE-LICENSE.txt')
    Push-Location $stage
    try {
        & npm.cmd ci --omit=dev --no-audit --no-fund --loglevel=error
        if ($LASTEXITCODE) { throw 'Could not bundle the locked runtime dependencies.' }
        & .\node.exe .\dist\cli.js help
        if ($LASTEXITCODE) { throw 'Bundled probe could not start.' }
    } finally { Pop-Location }
    $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    $launcher = Join-Path $stage 'Diagnose Probe.exe'
    & $csc /nologo /target:winexe /codepage:65001 /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/out:$launcher" (Join-Path $PSScriptRoot 'Probe.cs')
    if ($LASTEXITCODE) { throw 'Could not compile the Windows launcher.' }
    $options = @("/DStage=$stage", "/DVersion=$($metadata.version)", "/O$Output")
    if ($SignCommand) {
        & $env:ComSpec /d /c ($SignCommand.Replace('$f', '"' + $launcher + '"'))
        if ($LASTEXITCODE) { throw 'Could not sign the Windows launcher.' }
        $options += @('/DSignProbe=1', "/SDiagnoseSign=$SignCommand")
    }
    & $Compiler @options (Join-Path $PSScriptRoot 'probe.iss')
    if ($LASTEXITCODE) { throw 'Could not compile the Windows installer.' }
    $installer = Join-Path $Output 'Diagnose-Probe-Windows-x64.exe'
    if ($SignCommand -and (Get-AuthenticodeSignature $installer).Status -ne 'Valid') { throw 'Installer signature could not be verified.' }
    $checksum = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -Encoding ascii -LiteralPath ($installer + '.sha256') -Value "$checksum  Diagnose-Probe-Windows-x64.exe"
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force
}
