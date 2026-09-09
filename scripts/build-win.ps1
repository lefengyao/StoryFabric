$ErrorActionPreference = 'Stop'

# Keep download mirrors in the build command rather than npm project config.
# This avoids npm's unsupported-config warnings while keeping Windows builds
# usable in environments where GitHub release downloads are unavailable.
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'

# 先产出随包分发的服务端部署包（electron-builder 的 extraResources 依赖它）
npm run server:bundle
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx electron-vite build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

npx electron-builder --win
exit $LASTEXITCODE
