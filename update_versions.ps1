$files = Get-ChildItem -Path . -Filter *.html
foreach ($file in $files) {
    $content = Get-Content $file.FullName
    $newContent = $content -replace "\?v=\d+", "?v=75"
    if ($content -ne $newContent) {
        Set-Content -Path $file.FullName -Value $newContent
        Write-Host "Updated $($file.Name)"
    }
}
Write-Host "Done."
