# GitHub Actions Configuration

The workflows are ready to use Bun and locally maintained core release sources.

## Required Secrets

- `GITHUB_TOKEN`: provided automatically by GitHub Actions.

## Optional Secrets

- `CORE_DOWNLOAD_TOKEN`: token used by `scripts/prepare.mjs` when core/resource releases are private or rate-limited.
- `UPSTREAM_SYNC_TOKEN`: PAT for creating upstream sync branches and PRs when the default `GITHUB_TOKEN` is not enough.
- `TELEGRAM_BOT_TOKEN`: release notification bot token.
- `AUR_SSH_PRIVATE_KEY`: SSH key for AUR publishing.
- `POMPURIN404_TOKEN`: token used by the WinGet releaser.
- `APPLE_ID`: Apple account for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: Apple app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple developer team ID.
- `CSC_LINK`: base64 or URL certificate value consumed by electron-builder.
- `CSC_KEY_PASSWORD`: password for `CSC_LINK`.
- `CSC_INSTALLER_LINK`: base64 installer certificate for `.pkg` signing.
- `CSC_INSTALLER_KEY_PASSWORD`: password for `CSC_INSTALLER_LINK`.

## Repository Variables

- `BUN_VERSION`: Bun version used by Actions if the workflow is adjusted to read it globally.
- `ELECTRON_MIRROR`: Electron binary mirror. Default: `https://npmmirror.com/mirrors/electron/`.
- `ELECTRON_BUILDER_BINARIES_MIRROR`: electron-builder binary mirror. Default: `https://npmmirror.com/mirrors/electron-builder-binaries/`.
- `UPSTREAM_REPO`: upstream repository for automatic sync. Default: `https://github.com/mihomo-party-org/clash-party.git`.
- `UPSTREAM_BRANCH`: upstream branch for automatic sync. Default: `smart_core`.
- `LOCAL_BRANCH`: local maintenance branch for automatic sync. Default: `smart_core`.
- `APPLE_INSTALLER_IDENTITY`: macOS installer signing identity.
- `MIHOMO_VERSION_URL`: stable mihomo `version.txt` URL.
- `MIHOMO_VERSION`: explicit stable mihomo artifact version. Used when `version.txt` is unavailable.
- `MIHOMO_URL_PREFIX`: stable mihomo release download prefix.
- `MIHOMO_RELEASE_URL_PREFIX`: exact stable mihomo release asset prefix. Use this for fixed tags such as `Prerelease-Alpha`.
- `MIHOMO_ALPHA_VERSION_URL`: alpha mihomo `version.txt` URL.
- `MIHOMO_ALPHA_VERSION`: explicit alpha mihomo artifact version. Used when `version.txt` is unavailable.
- `MIHOMO_ALPHA_URL_PREFIX`: alpha mihomo release download prefix.
- `MIHOMO_SMART_VERSION_URL`: Smart Core `version.txt` URL.
- `MIHOMO_SMART_VERSION`: explicit Smart Core artifact version. Used when `version.txt` is unavailable.
- `MIHOMO_SMART_URL_PREFIX`: Smart Core release download prefix.
- `MIHOMO_SMART_NAME_FLAVOR`: Smart Core artifact naming flavor. Use `standard` for `Tinnci/mihomo`; use `go120` for legacy `vernesong/mihomo` assets.
- `SYSPROXY_RS_VERSION`: sysproxy release version.
- `SYSPROXY_RS_URL_PREFIX`: sysproxy release download prefix.
- `TRAFFIC_MONITOR_URL_PREFIX`: TrafficMonitor download prefix.
- `SUBSTORE_BUNDLE_URL`: Sub-Store backend bundle URL.
- `SUBSTORE_FRONTEND_URL`: Sub-Store frontend zip URL.

By default, the frontend embeds `mihomo`, `mihomo-alpha`, and `mihomo-smart` from `Tinnci/mihomo` `Prerelease-Alpha`. For a private fork, point the `MIHOMO_*` variables at that release and provide `CORE_DOWNLOAD_TOKEN`.
