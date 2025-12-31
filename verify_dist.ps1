# Verify dist file has EMBEDDED_ICONS
$distFile = "dist\pocasimeteo-card.js"

if (!(Test-Path $distFile)) {
    Write-Host "❌ dist/pocasimeteo-card.js not found!"
    exit 1
}

$content = Get-Content $distFile -Raw -Encoding UTF8
$lines = Get-Content $distFile -Encoding UTF8

Write-Host "=== DIST FILE VERIFICATION ==="
Write-Host ""
Write-Host "File size:" ([math]::Round((Get-Item $distFile).Length / 1KB, 1)) "KB"
Write-Host ""

# Check for version log
if ($content -match "Version 2\.2\.3") {
    Write-Host "✅ Version 2.2.3 found"
} else {
    Write-Host "❌ Version 2.2.3 NOT found"
}

# Check for EMBEDDED_ICONS definition
if ($content -match "const EMBEDDED_ICONS = \{") {
    Write-Host "✅ EMBEDDED_ICONS definition found"

    # Find line number
    for ($i = 0; $i -lt $lines.Length; $i++) {
        if ($lines[$i] -match "const EMBEDDED_ICONS = \{") {
            Write-Host "   Line:" ($i + 1)
            break
        }
    }

    # Count icons
    $iconMatches = [regex]::Matches($content, '"a\d+[dn]?": "data:image/png;base64,')
    Write-Host "   Icon count:" $iconMatches.Count

} else {
    Write-Host "❌ EMBEDDED_ICONS definition NOT found"
}

# Check for debug logging
if ($content -match "EMBEDDED_ICONS not found - will load from URLs") {
    Write-Host "✅ Debug logging found"
} else {
    Write-Host "❌ Debug logging NOT found"
}

Write-Host ""
Write-Host "=== FIRST 20 LINES ==="
for ($i = 0; $i -lt 20 -and $i -lt $lines.Length; $i++) {
    Write-Host ("{0,3}: {1}" -f ($i + 1), $lines[$i])
}

Write-Host ""
Write-Host "=== GitHub Raw URL Check ==="
Write-Host "The file on GitHub should be at:"
Write-Host "https://github.com/glaverCZ/pocasimeteo-card/releases/download/v2.2.3/pocasimeteo-card.js"
Write-Host ""
Write-Host "HACS downloads from:"
Write-Host "https://github.com/glaverCZ/pocasimeteo-card/releases/latest/download/dist/pocasimeteo-card.js"
