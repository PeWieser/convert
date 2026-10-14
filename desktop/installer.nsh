!macro customInstall
  DetailPrint "FFmpeg und FFprobe pruefen; fehlenden GPL-Build herunterladen ..."
  nsExec::ExecToLog /TIMEOUT=600000 '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup-ffmpeg.ps1"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Wandler wurde installiert. FFmpeg konnte nicht eingerichtet werden (z. B. keine Verbindung). Beim ersten Start kann der Download erneut versucht werden."
  ${EndIf}
!macroend
