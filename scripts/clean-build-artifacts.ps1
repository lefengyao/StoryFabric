param()

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$targets = @(
  'out',
  'dist-server',
  'release',
  'android/app/build',
  'android/build',
  'android/.gradle'
)

foreach ($relative in $targets) {
  $target = Join-Path $repoRoot $relative
  if (Test-Path -LiteralPath $target) {
    $resolved = (Resolve-Path -LiteralPath $target).Path
    if (-not $resolved.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) {
      throw "拒绝清理仓库外路径: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
    Write-Host "Removed $relative"
  }
}
