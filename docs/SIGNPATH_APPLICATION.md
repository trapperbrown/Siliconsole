# SignPath Foundation: application and setup

Checklist for getting free code signing for Siliconsole from [SignPath Foundation](https://signpath.org).
Part 1 is what to paste into the application. Part 2 is what to do after approval. The release workflow
([`.github/workflows/release.yml`](../.github/workflows/release.yml)) already contains the signing step; it stays
skipped until the secret from step 2.4 exists.

## Before applying

Requirements from <https://signpath.org/terms> (checked November 2026), and where Siliconsole stands:

- [x] OSI-approved license for all components, no commercial dual licensing: MIT (bundled dependencies are listed in
  `THIRD_PARTY_NOTICES.md`; all are open source).
- [x] No proprietary components.
- [x] Actively maintained and already released in the form to be signed (NSIS installer on GitHub Releases).
- [x] Functionality described on the download page: README and release notes.
- [x] Built from source in an automated, verifiable way: GitHub Actions on GitHub-hosted runners.
- [x] No hacking tools, no features that circumvent security measures. Siliconsole only reads sensors.
- [x] Privacy: no data transfer except the user-initiated Check for updates. See the policy page.
- [x] System changes are disclosed (service, optional driver) and the installer asks for elevation.
- [x] Uninstaller provided (Settings, Apps removes the app and the service).
- [x] Code signing policy page: [docs/CODE_SIGNING.md](CODE_SIGNING.md), linked from the README as
  "Code signing policy". Signed releases also link it from the release notes.
- [ ] **Turn on multi-factor authentication** on the GitHub account (and later on the SignPath account). Required for
  all team members.
- [ ] Optional but helpful: a GitHub branch ruleset on `main` (block force pushes and deletion). SignPath can enforce
  rulesets through `github-scm-policies`.

Worth mentioning honestly in the application, since reviewers look for it: the installer installs a LocalSystem
service and can, after asking, download and run the third-party PawnIO driver setup (signed by its own authors).
SignPath's terms do not forbid drivers or services, but they do require clear warnings, which the installer and README give.

## Part 1: application answers

Apply at <https://signpath.org/apply>. The form itself could not be read automatically (the page renders it with
scripts), so the field names below are the usual ones; map them to whatever the form asks.

| Field | Answer |
| --- | --- |
| Project name | Siliconsole |
| Repository URL | https://github.com/trapperbrown/Siliconsole |
| Homepage / download page | https://github.com/trapperbrown/Siliconsole/releases |
| License | MIT |
| Maintainer / contact | trapperbrown (GitHub) |
| Code signing policy URL | https://github.com/trapperbrown/Siliconsole/blob/main/docs/CODE_SIGNING.md |
| Build system | GitHub Actions, GitHub-hosted `windows-latest` runner |
| Artifact to sign | `Siliconsole_<version>_x64-setup.exe` (NSIS installer, Windows x64) |
| Release frequency | Occasional; each release is approved by hand |

**Short description**

> Siliconsole is a free, open source hardware info and sensor monitor for Windows 10/11 (a CPU-Z style System Info page,
> an HWiNFO style Sensors tree, customizable dashboards and a game overlay). It is read-only: no fan control,
> overclocking or voltage writes. It consists of a .NET 10 Windows service that reads sensors through
> LibreHardwareMonitorLib and a Tauri 2 + React desktop app that talks to it over a local named pipe.

**How builds are produced**

> Releases are built only by the public workflow `.github/workflows/release.yml`, triggered by pushing a version tag.
> On a GitHub-hosted Windows runner it runs `scripts/build-installer.ps1`: generates types, runs the .NET tests,
> publishes the service, runs the frontend checks and builds the Tauri NSIS installer. The unsigned installer is uploaded
> as a workflow artifact and submitted with `signpath/github-action-submit-signing-request`. After manual approval in
> SignPath, the workflow publishes the signed installer and its SHA-256 to GitHub Releases.

**What gets signed**

> The NSIS installer. Later we may also sign the inner executables (`Siliconsole.exe` and `sensor-service.exe`)
> before they are packed into the installer.

## Part 2: after approval

SignPath Foundation sets up the organization (OSS plan). Then:

1. **Connect GitHub.**
   - Install the SignPath GitHub App on `trapperbrown/Siliconsole` (linked from the SignPath docs at
     <https://docs.signpath.io/trusted-build-systems/github>). It lets SignPath read the workflow run that requests signing.
   - In SignPath, add the predefined **GitHub.com** Trusted Build System to the organization (Foundation projects may
     already have it).

2. **Create the project** in SignPath with exactly these slugs (the workflow uses them):
   1. Project slug: `siliconsole`. Link the GitHub.com Trusted Build System to it, and set the repository URL.
   2. Artifact configuration slug: `initial` (the default one), content below.
   3. Signing policy slug: `release-signing`, using the SignPath Foundation certificate, with trapperbrown as
      approver (manual approval for every request, which the Foundation requires anyway).
   4. In GitHub, Settings, Secrets and variables, Actions:
      - **Secret** `SIGNPATH_API_TOKEN`: an API token of a SignPath user (or CI user) that is a submitter for the
        `release-signing` policy.
      - **Variable** `SIGNPATH_ORGANIZATION_ID`: the organization ID shown in SignPath (organization settings).

   Artifact configuration `initial`. GitHub zips workflow artifacts, so the root is `<zip-file>`; the `version`
   parameter is passed by the workflow, and the metadata restrictions satisfy the Foundation's rule that the product name
   matches the project and the version matches the build:

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <parameters>
       <parameter name="version" required="true" />
     </parameters>
     <zip-file>
       <pe-file path="Siliconsole_${version}_x64-setup.exe" product-name="Siliconsole" product-version="${version}">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   The installer's version resource currently reads ProductName `Siliconsole`, ProductVersion `1.2.1` (checked on the
   v1.2.1 asset), so these restrictions match what Tauri produces.

3. **Test it** without publishing: Actions tab, Release, Run workflow, tick "sign". Approve the request in SignPath.
   The run's `installer-release` artifact should contain a signed installer (the workflow checks the signature and
   prints the signer).

4. **Release** as usual with `./scripts/release.ps1 -Version x.y.z -Notes "..."`. The workflow waits up to an hour for
   approval in SignPath, then publishes. If nobody approves in time, the job fails and nothing is published; re-run it.

5. **Update the wording** once the first signed release is out: remove the "Status" note at the top of
   `docs/CODE_SIGNING.md`, and update the SmartScreen paragraph in README's Install section and step 1 of
   `docs/TESTING.md` (the release notes switch automatically).

## Later: signing the inner executables

v1 signs only the installer. To sign `Siliconsole.exe` and `sensor-service.exe` as well, they must be signed before
NSIS packs them, which means splitting the build: build the service and the Tauri app, upload the two exes, sign them
through a second artifact configuration (a `<zip-file>` with two `<pe-file>` entries), put the signed files back, then
run the NSIS bundling step and sign the installer. Tauri can also call a custom sign command per binary
(`bundle.windows.signCommand`), which could submit to SignPath, but each call would be a separate approval. Not needed
for v1.

## Not verified

- The exact questions on the application form at <https://signpath.org/apply> (the page content was not readable by a
  script). The answers above cover what the terms ask for.
- Whether SignPath's `product-version` check compares against the string ProductVersion (`1.2.1`) or the numeric
  file version (`1.2.1.0`). If the first signing request is rejected for a version mismatch, drop `product-version`
  or adjust it in the artifact configuration.
- The signing action is pinned to v3.0 (commit `f6d0478`), the version the SignPath docs currently show. Its GitHub
  releases page still marks 2.x as latest.
