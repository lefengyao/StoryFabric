$ErrorActionPreference = 'Stop'

# Keep download mirrors in the build command rather than npm project config.
# This avoids npm's unsupported-config warnings while keeping Windows builds
# usable in environments where GitHub release downloads are unavailable.
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

npx electron-vite build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx electron-builder --win
exit $LASTEXITCODE
