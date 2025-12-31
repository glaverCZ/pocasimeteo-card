# Build script to create separate icons file
$pngFiles = Get-ChildItem -Path "." -Filter "*.png" | Sort-Object Name

if ($pngFiles.Count -eq 0) {
    Write-Host "No PNG files found!"
    exit 1
}

Write-Host "Found $($pngFiles.Count) PNG files"

# Generate Base64 data object
$base64Data = @()
$totalSize = 0

foreach ($pngFile in $pngFiles) {
    $pngBytes = [System.IO.File]::ReadAllBytes($pngFile.FullName)
    $b64String = [Convert]::ToBase64String($pngBytes)
    $iconName = $pngFile.BaseName
    $base64Data += "  `"$iconName`": `"data:image/png;base64,$b64String`""
    $totalSize += $pngBytes.Length
}

Write-Host "Total PNG size: $([math]::Round($totalSize / 1KB, 1)) KB"
Write-Host "Base64 size: $([math]::Round($totalSize * 1.37 / 1KB, 1)) KB (estimated)"

# Create the icons file
$iconsContent = @"
// PočasíMeteo Weather Icons (Base64 embedded)
// Auto-generated - DO NOT EDIT
// Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
// Icon count: $($pngFiles.Count)

const EMBEDDED_ICONS = {
$($base64Data -join ",`r`n")
};

// Make available globally
if (typeof window !== 'undefined') {
  window.POCASIMETEO_EMBEDDED_ICONS = EMBEDDED_ICONS;
}
"@

# Write with UTF-8 without BOM
$Utf8NoBomEncoding = New-Object System.Text.UTF8Encoding $False
$outputFile = "pocasimeteo-icons.js"
[System.IO.File]::WriteAllText($outputFile, $iconsContent, $Utf8NoBomEncoding)

Write-Host "SUCCESS: Created $outputFile with $($pngFiles.Count) icons"
Write-Host "File size: $([math]::Round($iconsContent.Length / 1KB, 1)) KB"
