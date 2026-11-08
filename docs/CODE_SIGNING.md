# Code signing policy

Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

> Status: Siliconsole has applied for (or is about to apply for) the SignPath Foundation open source program.
> Until the first signed release is published, installers on the Releases page are unsigned. Signed releases say so
> in their release notes.

## What gets signed

- The Windows installer `Siliconsole_<version>_x64-setup.exe` attached to each
  [GitHub release](https://github.com/trapperbrown/Siliconsole/releases).

Only binaries built from this repository's source code are signed. They are built by the public GitHub Actions
workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml) on GitHub-hosted runners, from a version
tag, and submitted to SignPath from that workflow. Nothing built on a personal machine is signed.

Third-party components bundled in the installer (for example the .NET runtime inside the sensor service, and
LibreHardwareMonitorLib) keep their upstream signatures, if any. The optional PawnIO driver is not part of the installer:
the installer downloads PawnIO's own setup, which is signed by its authors.

## Team roles

| Role | Members |
| --- | --- |
| Committers and reviewers | [trapperbrown](https://github.com/trapperbrown) |
| Approvers | [trapperbrown](https://github.com/trapperbrown) |

- **Committers** may change the source code directly.
- **Reviewers**: changes from anyone who is not a committer (for example pull requests) are reviewed by a committer
  before they are merged.
- **Approvers**: every signing request is approved by hand in SignPath before the release is signed.

All team members use multi-factor authentication for GitHub and SignPath.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user
or the person installing or operating it.

In detail:

- The app makes no network requests except **Check for updates**, which runs only when the user clicks it. It sends an
  ordinary HTTPS request to `api.github.com` to read the newest release of this repository. No personal data, hardware
  data or identifiers are sent; GitHub's own [privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)
  applies to that request.
- There is no telemetry, analytics, crash reporting, account or cloud sync.
- The sensor service talks only to the desktop app, over a local named pipe. It has no network listener.
- During installation, if the PawnIO driver is missing, the installer asks first and only on **Yes** downloads PawnIO's
  official setup from its GitHub releases.

## System changes

The installer asks for administrator rights because it installs a Windows service (`Siliconsole Sensor Service`,
running as LocalSystem) that reads hardware sensors, and optionally the PawnIO driver after asking. Both are
described on the [README](../README.md#install). Uninstalling from Settings, Apps removes the app and the service.

## Reporting a problem

If you believe a signed Siliconsole binary violates this policy, please open an issue at
<https://github.com/trapperbrown/Siliconsole/issues>, or contact SignPath Foundation at <https://signpath.org>.
