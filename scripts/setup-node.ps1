# Run in Windows PowerShell. Installs a private runtime without administrator access.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (Get-Command node -ErrorAction SilentlyContinue) {
    Write-Host 'Existing Node.js detected. It will NOT be updated, replaced or reconfigured.'
    $versionText = & node --version
    Write-Host $versionText
    $versionMatch = [regex]::Match([string]$versionText, '^v([0-9]+)\.([0-9]+)\.([0-9]+)$')
    if ($LASTEXITCODE -ne 0 -or -not $versionMatch.Success -or ([int]$versionMatch.Groups[1].Value -lt 20) -or ([int]$versionMatch.Groups[1].Value -eq 20 -and [int]$versionMatch.Groups[2].Value -lt 10)) { throw 'Diagnose requires Node.js 20.10+. Nothing was changed. Ask your diagnostician about a separate compatible runtime.' }
    foreach ($tool in @('npm.cmd', 'npx.cmd')) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Existing Node.js is missing $tool. Nothing was changed; ask your diagnostician for help." }
        & $tool --version
        if ($LASTEXITCODE -ne 0) { throw "$tool verification failed. Nothing was changed." }
    }
    Write-Host 'Setup complete. Existing Node.js, npm and npx were reused without changes.'
    return
}
    $cpu = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
    if (-not $cpu) { $cpu = $env:PROCESSOR_ARCHITECTURE }
    if (-not $cpu) { throw 'Could not identify CPU architecture.' }
    switch ($cpu.ToUpperInvariant()) { 'AMD64' { $arch = 'x64' } 'ARM64' { $arch = 'arm64' } default { throw 'Unsupported CPU. Ask your diagnostician for help.' } }
    $prefix = Join-Path $env:USERPROFILE '.diagnose\node'
    New-Item -ItemType Directory -Force -Path $prefix | Out-Null
    $stage = Join-Path $prefix ('.setup-' + [Guid]::NewGuid().ToString())
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        Write-Host 'Finding the current Node.js 22 release on nodejs.org...'
        $manifest = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt').Content
        $match = [regex]::Match($manifest, "(?m)^([a-f0-9]{64})\s+(node-v22\.([0-9]+)\.[0-9]+-win-$arch\.zip)\s*$")
        if (-not $match.Success -or [int]$match.Groups[3].Value -lt 18) { throw 'Could not identify a supported official release.' }
        $filename = $match.Groups[2].Value
        $archive = Join-Path $stage 'node.zip'
        $release = [regex]::Match($filename, '^node-(v22\.[0-9]+\.[0-9]+)-').Groups[1].Value
        Write-Host "Downloading $filename from nodejs.org..."
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            & curl.exe --fail --silent --show-error --location --connect-timeout 15 --max-time 120 --output $archive ('https://nodejs.org/dist/' + $release + '/' + $filename)
            if ($LASTEXITCODE -eq 0) { break }
            if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
        }
        if ($LASTEXITCODE -ne 0) { throw 'Could not download Node.js from nodejs.org. Nothing was installed. Try another network or the official Windows installer at https://nodejs.org/en/download.' }
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $match.Groups[1].Value) { throw 'Checksum mismatch. Nothing was installed. Run setup again.' }
        Write-Host 'Checksum verified. Installing into your private .diagnose\node directory...'
        Expand-Archive -LiteralPath $archive -DestinationPath $stage
        $directory = $filename.Substring(0, $filename.Length - 4)
        $destination = Join-Path $prefix $directory
        if (-not (Test-Path -LiteralPath $destination)) { Move-Item -LiteralPath (Join-Path $stage $directory) -Destination $destination }
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (($userPath -split ';') -notcontains $destination) { [Environment]::SetEnvironmentVariable('Path', ($destination + ';' + $userPath), 'User') }
        $env:Path = $destination + ';' + $env:Path
    } finally { Remove-Item -LiteralPath $stage -Recurse -Force }

Write-Host 'Checking Node.js, npm and npx:'
& node --version
if ($LASTEXITCODE -ne 0) { throw 'Node.js verification failed.' }
& npm.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'npm verification failed.' }
& npx.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'npx verification failed.' }
Write-Host 'Setup complete. You can now run: npx.cmd @masstensor/diagnose@latest start'
