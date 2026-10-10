$ErrorActionPreference = 'Stop'

# Keep download mirrors in the build command rather than npm project config.
# This avoids npm's unsupported-config warnings while keeping Windows builds
# usable in environments where GitHub release downloads are unavailable.
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

# electron-builder 26.15 still has transitive spawn sites without
# windowsHide.  Preload a tiny child_process shim for this build only so
# package-manager, 7za and NSIS helpers do not open a console window.
$previousNodeOptions = $env:NODE_OPTIONS
$buildHidePreload = (Join-Path $PSScriptRoot 'hide-windows-child-processes.cjs').Replace('\', '/')
$env:NODE_OPTIONS = if ([string]::IsNullOrWhiteSpace($previousNodeOptions)) {
    "--require=`"$buildHidePreload`""
} else {
    "$previousNodeOptions --require=`"$buildHidePreload`""
}

try {
    npx electron-vite build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    # Native optional dependencies are not rebuilt during packaging.
    npx electron-builder --win --config.npmRebuild=false
    exit $LASTEXITCODE
}
finally {
    $env:NODE_OPTIONS = $previousNodeOptions
}
