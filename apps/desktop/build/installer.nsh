; Orca-Strator NSIS install/uninstall controller safety (Change 026).
;
; Policy enforced here (fail-safe):
;   - refuse upgrade/uninstall while a controller has active campaigns;
;   - automatically stop it ONLY when it is confirmed idle AND ownership
;     identity is proven through the authenticated lifecycle contract;
;   - abort the installer/uninstaller when safe shutdown cannot be proven.
;
; There are no product-name-wildcard task kills and no foreign-PID
; termination anywhere in this script.

!macro _orcaEnsureControllerSafe mode
  ; The helper ships in install resources; during first-ever install there can
  ; be no prior controller from us, and a missing helper simply skips the check.
  ${If} ${FileExists} "$INSTDIR\resources\controller-safety.ps1"
    nsExec::ExecToStack `powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\controller-safety.ps1" ${mode}`
    Pop $0
    ${If} $0 == 2
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "A running Orca-Strator controller could not be safely verified.$\n$\nClose Orca-Strator (and quit its background controller) before installing or uninstalling, then run setup again."
      Abort
    ${ElseIf} $0 == 4
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "Orca-Strator still has ACTIVE CAMPAIGNS running in the background.$\n$\nOpen Orca-Strator, stop or finish the campaigns, then retry. This installer never terminates running work."
      Abort
    ${ElseIf} $0 == 3
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "The background controller acknowledged shutdown but did not exit in time.$\n$\nWait a moment and retry once it has stopped."
      Abort
    ${ElseIf} $0 == 5
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "The background controller refused graceful shutdown (unsafe state).$\n$\nResolve the running work via Orca-Strator and retry."
      Abort
    ${ElseIf} $0 != 0
      ; Any other failure means safety could NOT be proven: fail closed.
      MessageBox MB_ICONEXCLAMATION|MB_OK \
        "Unable to prove that no Orca-Strator controller is running (safety check failed).$\n$\nReboot or stop Orca-Strator manually, then retry."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  !insertmacro _orcaEnsureControllerSafe "stop"
!macroend

!macro customUnInit
  !insertmacro _orcaEnsureControllerSafe "stop"
!macroend
