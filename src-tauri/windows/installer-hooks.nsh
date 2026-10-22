; SPDX-FileCopyrightText: 2026 Habiby LLC
; SPDX-License-Identifier: AGPL-3.0-or-later
;
; The direct download's file types (docs/app/keeping-work/storage-and-file-format.md#STOR-180).
;
; A Mac's bundle owns its play and is an alternate for everything else it
; reads (tauri.conf.json's `rank`). Windows has no rank, and Tauri's installer
; makes every type it is given the type's default, which for .txt or .docx
; would take a writer's double-click away from the app they chose for it. So
; tauri.windows.conf.json gives the installer the play alone, and this adds
; Proscenium to the Open With list of every other type it reads, taking no
; default. The uninstaller takes all of it away again.

!macro PROSCENIUM_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Proscenium.Draft" ""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
!macroend

; Our one value, then the keys the install made for it, each only if nothing
; is left in it: the key may hold other apps' entries. `/ifempty` deletes a
; key with no values and no subkeys (NSIS 3.06 and later; Tauri's is 3.11).
; Without this a clean PC kept an empty `.fdx\OpenWithProgids` for every type.
!macro PROSCENIUM_NOT_OPEN_WITH EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "Proscenium.Draft"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\Proscenium.Draft" "" "Draft for Proscenium"
  WriteRegStr SHCTX "Software\Classes\Proscenium.Draft\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Proscenium.Draft\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro PROSCENIUM_OPEN_WITH "fountain"
  !insertmacro PROSCENIUM_OPEN_WITH "fdx"
  !insertmacro PROSCENIUM_OPEN_WITH "docx"
  !insertmacro PROSCENIUM_OPEN_WITH "odt"
  !insertmacro PROSCENIUM_OPEN_WITH "rtf"
  !insertmacro PROSCENIUM_OPEN_WITH "txt"
  !insertmacro PROSCENIUM_OPEN_WITH "md"
  !insertmacro PROSCENIUM_OPEN_WITH "pages"
  ; File Explorer reads the change now rather than at the next sign-in.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "fountain"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "fdx"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "docx"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "odt"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "rtf"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "txt"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "md"
  !insertmacro PROSCENIUM_NOT_OPEN_WITH "pages"
  DeleteRegKey SHCTX "Software\Classes\Proscenium.Draft"
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey /ifempty SHCTX "Software\Classes\Applications"
  ; Tauri's own unassociate, just before this, put back the play's previous
  ; default from the value it saved it in, and left that value behind, with an
  ; empty default where the type had none. Both are ours to take away.
  Push $0
  DeleteRegValue SHCTX "Software\Classes\.proscenium" "Proscenium Play_backup"
  ReadRegStr $0 SHCTX "Software\Classes\.proscenium" ""
  ${If} $0 == ""
    DeleteRegValue SHCTX "Software\Classes\.proscenium" ""
  ${EndIf}
  DeleteRegKey /ifempty SHCTX "Software\Classes\.proscenium"
  Pop $0
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
