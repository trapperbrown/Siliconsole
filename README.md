# Siliconsole

Windows hardware info and sensor monitor for PC gamers and enthusiasts: a CPU-Z style System Info page,
an HWiNFO style Sensors tree, drag-and-drop dashboards (with a preset wizard: Gaming, Thermals, Storage, CPU, GPU,
Memory and network, Power, Compact overlay), swappable themes, a click-through overlay on any or all monitors,
threshold alerts, CSV logging, a first-run tour and an in-app Guide.

## Install

Download `Siliconsole_<version>_x64-setup.exe` from the [Releases](../../releases) page and run it.

- **Windows SmartScreen will warn** that the app is unrecognized, because the installer isn't code-signed.
  Click "More info", then "Run anyway".
- **What gets installed:**
  - the desktop app;
  - a background Windows service (`Siliconsole Sensor Service`) that runs as LocalSystem, because reading
    hardware sensors needs administrator rights;
  - optionally, the [PawnIO](https://github.com/namazso/PawnIO.Setup) driver. The installer asks first, then downloads
    PawnIO's official signed setup.
- **Uninstall** from Settings, Apps. This removes the app and the service. PawnIO stays installed (other tools may use
  it); remove it separately from Apps if you want.
- **Code signing policy:** see [docs/CODE_SIGNING.md](docs/CODE_SIGNING.md) (what gets signed, who approves, privacy).

## Disclaimer

Siliconsole is a free hobby project, provided **as is, with no warranty of any kind**, under the [MIT License](LICENSE).
You use it at your own risk; the authors are not liable for any damage, data loss, crash or other problem that
arises from installing or using it.

Things worth knowing before you install:

- Siliconsole only **reads** sensors. It has no fan control, overclocking or voltage writes, so it doesn't change how
  your hardware runs.
- It installs a service with full system rights and, if you agree, a kernel driver (PawnIO). Only install software
  like this from people you trust.
- Some antivirus tools may flag an unsigned app that installs a driver.
- Some kernel-level anti-cheat systems are strict about hardware-access drivers. PawnIO is designed to be
  anti-cheat friendly (unlike the old WinRing0 driver), but if a game complains, quit Siliconsole or stop its service
  while you play.

## Architecture

Three parts with strict privilege separation:

| Part | Tech | Runs as | Role |
| --- | --- | --- | --- |
| `sensor-service/` | C#, .NET 10, LibreHardwareMonitorLib (PawnIO) | Windows Service, LocalSystem | Polls sensors, keeps a ring buffer, collects static system info. Talks only over a local named pipe. |
| `desktop/` | Tauri 2 (Rust) + React, TypeScript, Vite, Tailwind, uPlot, react-grid-layout | The signed-in user, unprivileged | Rust connects to the pipe and forwards data to the webview as events. Tray, alerts and CSV logging run in Rust. |
| `shared/` | JSON | n/a | The central config, JSON Schemas, built-in themes and starter dashboard templates. |

- **Pipe:** `\\.\pipe\<ipc.pipeName>`. The ACL allows SYSTEM, interactive users (read/write, but they can't create
  pipe instances) and the service account. Remote clients are rejected. There is no TCP listener anywhere.
- **Protocol:** 4 byte little-endian length prefix, then UTF-8 JSON. Message types: `hello`, `system_info`, `sensor_catalog`,
  `sensor_frame`, `history_request` / `history_response`, `set_interval`. See `shared/schemas/protocol.schema.json`.
  The service validates every inbound message against that schema and logs rejections.
- **Sensor ids** are LibreHardwareMonitor `Identifier` strings (for example `/gpu-nvidia/0/temperature/0`), so saved
  dashboards survive restarts.

## Central config

Every tunable lives in `shared/config/defaults.json`: app name, pipe name, poll interval bounds, ring buffer size,
units, dashboard grid, widget defaults, default theme, alert cooldown, overlay hotkey and geometry, logging and so on.
Renaming the product is a one-line change to `appName` (then run the generator below).

`node shared/scripts/gen-types.mjs` turns the schemas into TypeScript (`desktop/src/generated`), C# records
(`sensor-service/src/Generated`) and Rust structs (`desktop/src-tauri/src/generated.rs`). It also syncs
`tauri.conf.json` and the installer's `config.nsh` from the config. `pnpm build` runs it automatically.

Per-user settings (theme, units, alerts, logging, overlay size and so on) are saved to `%APPDATA%\Siliconsole\settings.json`.
Dashboards and custom themes live in `%APPDATA%\Siliconsole\dashboards` and `\themes`.

## Prerequisites

- Windows 11 x64
- .NET 10 SDK
- Rust stable, MSVC toolchain (`rustup default stable-x86_64-pc-windows-msvc`), plus Visual Studio Build Tools
- Node LTS and pnpm
- PawnIO driver for full sensor coverage (https://github.com/namazso/PawnIO.Setup)

## Build

One command builds and tests everything and produces the installer:

```powershell
./scripts/build-installer.ps1
```

The installer is written to `desktop/src-tauri/target/release/bundle/nsis/`.

Step by step:

```powershell
node shared/scripts/gen-types.mjs                     # generated types and synced config
dotnet test sensor-service                            # framing, schema validation, ring buffer, pipe server
dotnet publish sensor-service/src -c Release -o sensor-service/publish --self-contained -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true
cd desktop
pnpm install
node ../scripts/gen-notices.mjs                       # THIRD_PARTY_NOTICES.md from the real dependency graphs
pnpm check                                            # schemas, WCAG contrast, no color literals, no em dashes, no listeners
pnpm tauri build                                      # NSIS installer
```

## Release

Releases are built, signed and published by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)).
To ship a new version:

```powershell
./scripts/release.ps1 -Version 1.0.1 -Notes "What changed."
```

This checks the tree is clean, bumps the version, runs the service tests and `pnpm check` locally (fast fail), commits
"Release v1.0.1", creates an annotated tag `v1.0.1` whose message is the notes, and pushes. The workflow then runs
`scripts/build-installer.ps1` on a GitHub-hosted runner, signs the installer through SignPath when the
`SIGNPATH_API_TOKEN` secret is set (otherwise it publishes the unsigned installer), and creates the GitHub release.
The release body comes from `scripts/release-notes.ps1`: the tag message, install notes and the installer's SHA-256.
Notes can be multi-line Markdown (use a PowerShell here-string).

```powershell
./scripts/release.ps1 -Version 1.0.1 -DryRun                  # bump and check only, files restored, nothing pushed
./scripts/release.ps1 -Version 1.0.1 -Local -Notes "..."      # old flow: build and publish from this machine
./scripts/release.ps1 -Version 1.0.1 -Local -DryRun           # full local build of 1.0.1, nothing published
```

To try the CI build without releasing, run the Release workflow by hand from the Actions tab: it builds and uploads the
installer as a workflow artifact and publishes nothing. Code signing setup is in
[docs/SIGNPATH_APPLICATION.md](docs/SIGNPATH_APPLICATION.md); the winget manifest is in [packaging/winget](packaging/winget).

## Develop

```powershell
# Service in the foreground (elevated terminal, so the hardware is readable):
dotnet run --project sensor-service/src -- --console
# Print the catalog, one frame and the system info as JSON, then exit:
dotnet run --project sensor-service/src -- --dump
# Check a running service from any terminal:
dotnet run --project sensor-service/tools/PipeProbe -- --frames 10

# Install the published service locally (elevated). Files are copied to Program Files first:
./scripts/install-service.ps1 -BinaryDir sensor-service/publish
./scripts/uninstall-service.ps1 -RemoveFiles

# Desktop app with hot reload:
cd desktop; pnpm tauri dev
```

Service logs are in `%ProgramData%\Siliconsole\logs`. When it runs as SYSTEM, the service restricts that folder's ACL
so only SYSTEM and Administrators can write to it.

## Repository layout

```
shared/config/defaults.json     central config
shared/schemas/                 config, dashboard, theme and protocol schemas
shared/themes/                  6 built-in themes
shared/dashboards/              Gaming, Thermals and Storage starter templates (resolved against the live catalog)
shared/scripts/gen-types.mjs    type generation and config sync
sensor-service/src              the Windows Service
sensor-service/tests            xunit tests
sensor-service/tools/PipeProbe  pipe test client
desktop/src-tauri               Rust core: pipe client, storage, tray, overlay, alerts, CSV
desktop/src                     React UI
desktop/scripts/check-frontend.mjs  repository checks
scripts/                        service install/uninstall, notices, installer build
docs/TESTING.md                 manual test steps
docs/CODE_SIGNING.md            code signing policy
.github/workflows/release.yml   CI build, signing and GitHub release
packaging/winget/               winget manifests
```

## Out of scope

No fan control, overclocking, RGB, FPS capture, cloud sync, accounts, telemetry, auto-update, or non-Windows support.
The only network request is "Check for updates", which asks the GitHub API for the newest release when the user clicks it.

## License

[MIT](LICENSE). Third-party components and their licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
