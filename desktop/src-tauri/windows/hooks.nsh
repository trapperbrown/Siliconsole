; Installer hooks for the Tauri NSIS bundle. Values come from config.nsh, generated from
; shared/config/defaults.json by shared/scripts/gen-types.mjs.
!include "LogicLib.nsh"
!include "${__FILEDIR__}\config.nsh"

!define SC_ERROR_SERVICE_DOES_NOT_EXIST 1060
!define SC_SERVICE_PATH "$INSTDIR\${SC_SERVICE_SUBFOLDER}\${SC_SERVICE_EXE}"

!macro NSIS_HOOK_PREINSTALL
  ; Upgrades: stop the running service so its executable can be replaced.
  nsExec::Exec 'sc.exe stop "${SC_SERVICE_NAME}"'
  Pop $0
  Sleep 2000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; ---- PawnIO driver: detect, and offer to run the official signed setup if missing ----
  nsExec::Exec 'sc.exe query "${SC_PAWNIO_SERVICE}"'
  Pop $0
  ${If} $0 == ${SC_ERROR_SERVICE_DOES_NOT_EXIST}
    MessageBox MB_YESNO|MB_ICONQUESTION "${SC_APP_NAME} needs the PawnIO driver to read CPU, motherboard and some memory sensors. It is not installed.$\r$\n$\r$\nDownload and run the official PawnIO setup now?$\r$\n${SC_PAWNIO_URL}" /SD IDNO IDNO sc_pawnio_done
      ; Download, check the Authenticode signer, then run the setup. Exit 2 means the signature check failed.
      nsExec::ExecToLog `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$$ErrorActionPreference='Stop'; $$p=Join-Path $$env:TEMP 'PawnIO_setup.exe'; Invoke-WebRequest -UseBasicParsing '${SC_PAWNIO_URL}' -OutFile $$p; $$s=Get-AuthenticodeSignature $$p; if ($$s.Status -ne 'Valid' -or $$s.SignerCertificate.Subject -notlike '*${SC_PAWNIO_SIGNER}*') { Remove-Item $$p; exit 2 }; $$r=Start-Process $$p -ArgumentList '-install' -Wait -PassThru; Remove-Item $$p; exit $$r.ExitCode"`
      Pop $0
      ${If} $0 != 0
        MessageBox MB_OK|MB_ICONEXCLAMATION "PawnIO setup did not complete (code $0). ${SC_APP_NAME} will still run with fewer sensors. You can install PawnIO later from ${SC_PAWNIO_URL}" /SD IDOK
      ${EndIf}
    sc_pawnio_done:
  ${EndIf}

  ; ---- Sensor service: create or update, then start ----
  nsExec::Exec 'sc.exe query "${SC_SERVICE_NAME}"'
  Pop $0
  ${If} $0 == ${SC_ERROR_SERVICE_DOES_NOT_EXIST}
    nsExec::ExecToLog 'sc.exe create "${SC_SERVICE_NAME}" binPath= "\"${SC_SERVICE_PATH}\"" start= auto DisplayName= "${SC_SERVICE_DISPLAY}"'
  ${Else}
    nsExec::ExecToLog 'sc.exe config "${SC_SERVICE_NAME}" binPath= "\"${SC_SERVICE_PATH}\"" start= auto'
  ${EndIf}
  Pop $0
  nsExec::ExecToLog 'sc.exe description "${SC_SERVICE_NAME}" "${SC_SERVICE_DESCRIPTION}"'
  Pop $0
  nsExec::ExecToLog 'sc.exe failure "${SC_SERVICE_NAME}" reset= 86400 actions= restart/${SC_SERVICE_RESTART_MS}/restart/${SC_SERVICE_RESTART_MS}/restart/${SC_SERVICE_RESTART_MS}'
  Pop $0
  nsExec::ExecToLog 'sc.exe start "${SC_SERVICE_NAME}"'
  Pop $0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  nsExec::Exec 'sc.exe stop "${SC_SERVICE_NAME}"'
  Pop $0
  Sleep 2000
  nsExec::ExecToLog 'sc.exe delete "${SC_SERVICE_NAME}"'
  Pop $0
  ; "Start with Windows" entry written by the autostart plugin for this user.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${SC_APP_NAME}"
!macroend
