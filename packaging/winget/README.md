# winget manifest

Manifests for the [Windows Package Manager](https://learn.microsoft.com/windows/package-manager/) community
repository, so users can run `winget install TrapperBrown.Siliconsole`.

`manifests/` mirrors the layout of [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs): one folder per
version, three files each (version, installer, default locale), schema 1.12.0 (what the current `wingetcreate` writes).

Notes on the values:

- `InstallerType: nullsoft`, `Scope: machine`, `ElevationRequirement: elevatesSelf`: the Tauri NSIS installer is
  per-machine (`installMode: perMachine`) and installs a LocalSystem service, so it asks for admin rights itself.
- `ProductCode: Siliconsole` is the installer's uninstall registry key
  (`HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Siliconsole`).
- A silent install (`/S`, what winget uses) answers **No** to the PawnIO prompt, so the driver is not installed; users
  can add PawnIO later.

## Submit (first time or a new version)

Nothing here is submitted automatically.

1. Make sure the GitHub release and its installer exist, and the SHA-256 in the installer manifest matches the one in
   the release notes.
2. Check locally: `winget validate --manifest packaging/winget/manifests/t/TrapperBrown/Siliconsole/<version>`.
   Optionally test the install in Windows Sandbox: `winget install --manifest <that folder>` (needs
   `winget settings --enable LocalManifestFiles`, run from an admin terminal).
3. Fork <https://github.com/microsoft/winget-pkgs>, create a branch, and copy the version folder to
   `manifests/t/TrapperBrown/Siliconsole/<version>/` in the fork.
4. Open a pull request against `microsoft/winget-pkgs` and fill in its checklist. The bots validate the manifest and
   test the installer; reply to any comments. First submissions are reviewed by a moderator.

Shortcut: `wingetcreate submit packaging/winget/manifests/t/TrapperBrown/Siliconsole/<version>` (from
[winget-create](https://github.com/microsoft/winget-create)) does steps 3 and 4 with a GitHub token.

## Bump for a new release

Once the package exists in winget-pkgs, the easiest way is:

```powershell
wingetcreate update TrapperBrown.Siliconsole --version 1.2.2 --urls https://github.com/trapperbrown/Siliconsole/releases/download/v1.2.2/Siliconsole_1.2.2_x64-setup.exe --submit
```

By hand instead:

1. Copy the latest version folder to a new folder named after the new version.
2. In all three files, change `PackageVersion`. In the installer file, change `InstallerUrl`, `InstallerSha256`
   (uppercase hex from the release notes, or `(Get-FileHash <installer>).Hash`) and `ReleaseDate`. In the locale file,
   change `ReleaseNotesUrl`.
3. Validate and submit as above.

When the installer becomes code-signed the manifest does not change, apart from the new hash.
