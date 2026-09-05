$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$server = Join-Path $root 'server'
$package = Get-Content -LiteralPath (Join-Path $server 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
$guide = "OPENCLAW_DEPLOY_V$version.md"

function Invoke-CheckedTests([string]$Directory, [string]$Pattern) {
    Push-Location $Directory
    try {
        $output = & node --test --test-reporter=tap $Pattern 2>&1
        $exitCode = $LASTEXITCODE
        $output | ForEach-Object { Write-Host $_ }
        if ($exitCode -ne 0) { throw "Tests failed in $Directory" }
        $report = $output -join "`n"
        $counts = @{}
        foreach ($key in @('tests', 'pass', 'fail')) {
            $match = [regex]::Match($report, "(?m)^# $key\s+(\d+)\s*$")
            if (-not $match.Success) { throw "Missing test count: $key" }
            $counts[$key] = [int]$match.Groups[1].Value
        }
        if ($counts.fail -ne 0 -or $counts.tests -ne $counts.pass) { throw 'Not every test passed' }
        return $counts
    } finally { Pop-Location }
}

Push-Location $root
try {
    & node (Join-Path $PSScriptRoot 'check-project.js')
    if ($LASTEXITCODE -ne 0) { throw 'Project preflight failed' }
    $miniTests = Invoke-CheckedTests $root 'test/*.test.js'
    $serverTests = Invoke-CheckedTests $server 'test/*.test.js'

    # Explicit allow-list: never recurse through runtime data or dependencies.
    $files = [Collections.Generic.List[object]]::new()
    foreach ($name in @('src', 'sql', 'scripts', 'test', 'nginx')) {
        Get-ChildItem -LiteralPath (Join-Path $server $name) -File -Recurse | ForEach-Object {
            $files.Add($_)
        }
    }
    foreach ($name in @('package.json', 'package-lock.json', '.env.example')) { $files.Add((Get-Item -LiteralPath (Join-Path $server $name))) }
    foreach ($name in @('README.md', $guide)) { $files.Add((Get-Item -LiteralPath (Join-Path $root $name))) }
    $entries = @($files | Sort-Object FullName | ForEach-Object {
        $relative = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
        if ($relative -match '(^|/)(node_modules|data|\.git|backup)(/|$)|\.log$|(^|/)\.env$') { throw "Forbidden release entry: $relative" }
        if ($_.LinkType) { throw "Symbolic links are not allowed in a release: $relative" }
        @{ path = $relative; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant(); source = $_.FullName }
    })
    $manifest = @{
        version = $version
        builtAtUtc = [DateTime]::UtcNow.ToString('o')
        tests = @{ miniprogram = $miniTests; server = $serverTests }
        verification = 'Local mocked tests; no production database migration or device acceptance performed.'
        files = @($entries | ForEach-Object { @{ path = $_.path; bytes = $_.bytes; sha256 = $_.sha256 } })
    }
    $release = Join-Path $root 'release'
    [IO.Directory]::CreateDirectory($release) | Out-Null
    $target = Join-Path $release "couple-space-v$version-openclaw-$(Get-Date -Format yyyyMMdd-HHmmss).zip"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::Open($target, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in $entries) {
            [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $entry.source, $entry.path, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
        $entry = $archive.CreateEntry('release-manifest.json')
        $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
        try { $writer.Write(($manifest | ConvertTo-Json -Depth 8)) } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }

    # Re-open actual ZIP and verify every payload hash, not just source files.
    $archive = [IO.Compression.ZipFile]::OpenRead($target)
    try {
        if ($archive.Entries.Count -ne $entries.Count + 1) { throw 'Archive entry count mismatch' }
        foreach ($entry in $entries) {
            $packed = $archive.GetEntry($entry.path)
            if ($null -eq $packed -or $packed.Length -ne $entry.bytes) { throw "Archive size mismatch: $($entry.path)" }
            $stream = $packed.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
            finally { $stream.Dispose(); $sha.Dispose() }
            if ($hash -ne $entry.sha256) { throw "Archive hash mismatch: $($entry.path)" }
        }
    } finally { $archive.Dispose() }
    Write-Host "Release verified: $target"
    Write-Host "SHA256: $((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash)"
} finally { Pop-Location }
