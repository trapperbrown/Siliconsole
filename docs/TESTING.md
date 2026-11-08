# Testing

## Automated

```powershell
dotnet test sensor-service        # 31 tests: framing, schema validation, ring buffer, driver version format, pipe server
cd desktop; pnpm check            # schemas, WCAG AA contrast of all themes, color literals, em dashes, network listeners
```

The pipe server tests run against a fake telemetry source, so they need no hardware or elevation.

## Manual test plan (clean Windows 11 x64 machine)

Use a machine (or VM with real hardware passthrough) that has never had Siliconsole installed.

### 1. Install

1. Run `Siliconsole_<version>_x64-setup.exe`. Accept the UAC prompt. The installer isn't code-signed yet,
   so SmartScreen may warn ("More info", then "Run anyway").
2. **Without PawnIO installed:** the installer asks to download and run the official PawnIO setup.
   - Choose **Yes**: PawnIO's own setup window appears; finish it. Expect `sc query PawnIO` to show `RUNNING`.
   - Repeat on another machine and choose **No**: the install completes; the app runs with fewer sensors.
3. **With PawnIO already installed:** no PawnIO prompt appears.
4. After install, in an elevated PowerShell:
   - `Get-Service SiliconsoleSensorService` shows `Running`, start type `Automatic`.
   - `sc.exe qc SiliconsoleSensorService` shows the binary under `C:\Program Files\Siliconsole\sensor-service\`, running as `LocalSystem`.
   - `Get-NetTCPConnection -OwningProcess (Get-Process sensor-service).Id` returns nothing (no network listener).
   - `(Get-Acl C:\ProgramData\Siliconsole).Access` lists only SYSTEM and Administrators (full control) and Users (read).

### 2. Connection states

1. Launch Siliconsole from the Start menu. The header shows **Connected** with the poll interval.
2. `Stop-Service SiliconsoleSensorService` (elevated): the header switches to **Reconnecting** within a few seconds.
   `Start-Service SiliconsoleSensorService`: it returns to **Connected** and data resumes.
3. `sc.exe stop SiliconsoleSensorService; sc.exe delete SiliconsoleSensorService`: the header shows **Service not installed**,
   with help text. Reinstall to restore.

### 3. System Info

1. Each tab (CPU, Mainboard, Memory, GPU, Storage, OS) shows values that match Task Manager and Windows Settings.
2. **Copy** puts the current tab on the clipboard as a Markdown table.
3. **Export JSON** and **Export Markdown** open a save dialog; the saved files open and contain every section.

### 4. Sensors

1. Every hardware group is listed with current, min, max and average values updating each second.
2. Type in search (for example `temp`): only matching sensors remain and groups expand.
3. **Reset min/max** sets min, max and average to the current value.
4. Click **+** on a sensor: a header notice says "Pinned to <dashboard>"; the widget appears at the bottom of that dashboard.
5. In Settings, switch the unit to **°F**: every temperature on every page converts.

### 5. Dashboards

1. On first launch (once the service is connected) Gaming, Thermals and Storage exist and show live data. Widgets for sensors
   this hardware lacks (for example GPU Hotspot on NVIDIA Blackwell) are left out.
2. **Edit**: drag and resize widgets (they snap to the grid), **Add widget** for each of the 8 types, open the gear to change
   label, unit, decimals, range, warning/critical thresholds (the value color changes at each) and history window.
   **Done editing**, restart the app: the layout persists (`%APPDATA%\Siliconsole\dashboards`).
3. **New**, **Duplicate**, **Rename**, **Delete** behave as named.
4. **Export** a dashboard, **Delete** it, **Import** the file: it comes back unchanged. Importing a non-dashboard JSON
   file shows a validation error.

### 6. Themes

1. Click each of the 6 themes: every page repaints, including charts, gauges and the heatmap.
2. **Duplicate and edit**: change colors, sliders, background (solid, gradient, image file). The app repaints live and the
   contrast checker lists any pair below WCAG AA. **Save theme**, restart: it persists.
3. **Export** and **Import** a theme; **Delete** a custom theme.

### 7. Overlay

1. Press **Ctrl+Shift+F10**: a borderless, always-on-top overlay appears in the configured corner. Clicks pass through it
   to the window underneath. Press again to hide it.
2. Settings, Tray and overlay: change size, corner, scale or "fit", and opacity while the overlay is visible. It resizes and
   moves immediately. With **fit** on, every row of the chosen dashboard is visible at any size.
3. On the Dashboards page, **Use for overlay** switches which dashboard the overlay shows.
4. Start a game in borderless windowed mode: the overlay stays on top.

### 8. Tray, startup

1. Settings, **Tray icon value**: choose a temperature. The tray icon shows its value as digits; hover shows the sensor name
   and full value.
2. Close the main window: the app stays in the tray. Left-click the tray icon to reopen it; **Quit** in the tray menu exits.
3. Enable **Start minimized**, quit, relaunch: only the tray icon appears.
4. Enable **Start with Windows**, sign out and back in: Siliconsole starts minimized in the tray.

### 9. Alerts

1. Settings, Alerts, **Send test alert**: a Windows notification titled "Siliconsole alert" appears.
2. **Add alert** for a CPU temperature with "above" set a few degrees under the current value: a notification appears
   within a second, then at most once per cooldown period (`alerts.cooldownSeconds`).

### 10. CSV logging

1. Choose a folder, add a few sensors (include a temperature), enable logging. The Settings page shows the file being written.
2. After 60 seconds, disable logging. Open the file in Excel: one header row (sensor, hardware, unit) and about 60 data rows,
   numbers in numeric cells, timestamps recognized as dates, and the degree sign displayed correctly.

### 11. Uninstall

1. Apps, Installed apps, Siliconsole, **Uninstall**.
2. `Get-Service SiliconsoleSensorService` reports the service doesn't exist; `C:\Program Files\Siliconsole` is gone.
3. The "Start with Windows" entry is removed. `%APPDATA%\Siliconsole` (your dashboards and themes) and
   `%ProgramData%\Siliconsole\logs` are kept on purpose.
