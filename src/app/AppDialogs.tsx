// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Dispatch, SetStateAction } from "react";
import type { Doc } from "../fountain/model";
import { Alert } from "../ui";
import { FrontMatterPanel } from "./FrontMatterPanel";
import { ExportDialog, type ExportRequest } from "./ExportDialog";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { GoToScene } from "./GoToScene";
import { FolderAccessNotice } from "./FolderAccessNotice";
import { RawPlaySheet } from "./RawPlaySheet";
import { SettingsSheet, openSettings, type useSettingsSheet } from "./settings";
import { openPlay } from "./settings/launch";
import { FormatDesigner } from "./formats/FormatDesigner";
import { openFormatDesigner, type useFormatDesignerRequest } from "./formats/open";
import { OpenFileSheet } from "./OpenFileSheet";
import type { useFinderOpens } from "./useFinderOpens";
import { quitHoldWords, type useQuitGate } from "./quit";
import { RecoveryPanel } from "./RecoveryPanel";
import { HistoryPanel } from "./HistoryPanel";
import type { Workspace, VersionsTarget } from "./useWorkspace";

interface Props {
  ws: Pick<
    Workspace,
    | "frontMatter"
    | "openScriptKey"
    | "saveFrontMatter"
    | "cards"
    | "scenePages"
    | "openScene"
    | "openFolder"
    | "rawPlay"
    | "closeRawPlay"
    | "retryRawPlay"
    | "revealRawPlay"
    | "vaultRoot"
    | "root"
    | "wherePlaysLive"
    | "canReveal"
    | "plays"
    | "format"
    | "mode"
    | "scriptTitle"
    | "playTitle"
    | "editor"
    | "layoutMeta"
    | "setFormat"
    | "recoveryOffer"
    | "currentScriptText"
    | "recoverOffer"
    | "discardOffer"
    | "listVersions"
    | "readVersion"
    | "restoreVersion"
    | "castWeights"
    | "playLanguage"
    | "exporting"
    | "savePlayLanguage"
    | "exportScript"
    | "layoutForExport"
  >;
  showTitlePage: boolean;
  setShowTitlePage: Dispatch<SetStateAction<boolean>>;
  showExport: ExportRequest | null;
  setShowExport: Dispatch<SetStateAction<ExportRequest | null>>;
  showShortcuts: boolean;
  setShowShortcuts: Dispatch<SetStateAction<boolean>>;
  showGoToScene: boolean;
  setShowGoToScene: Dispatch<SetStateAction<boolean>>;
  settingsSheet: ReturnType<typeof useSettingsSheet>;
  designer: ReturnType<typeof useFormatDesignerRequest>;
  finderOpens: ReturnType<typeof useFinderOpens>;
  quitGate: ReturnType<typeof useQuitGate>;
  showRecovery: boolean;
  setShowRecovery: Dispatch<SetStateAction<boolean>>;
  showHistory: { id: string | null } | null;
  setShowHistoryFor: Dispatch<SetStateAction<{ id: string | null } | null>>;
  historyTarget: VersionsTarget | null;
}

export function AppDialogs({
  ws,
  showTitlePage,
  setShowTitlePage,
  showExport,
  setShowExport,
  showShortcuts,
  setShowShortcuts,
  showGoToScene,
  setShowGoToScene,
  settingsSheet,
  designer,
  finderOpens,
  quitGate,
  showRecovery,
  setShowRecovery,
  showHistory,
  setShowHistoryFor,
  historyTarget,
}: Props) {
  return (
    <>
      {showTitlePage && (
        <FrontMatterPanel
          frontMatter={ws.frontMatter}
          scriptKey={ws.openScriptKey}
          onSave={ws.saveFrontMatter}
          onClose={() => setShowTitlePage(false)}
        />
      )}
      {showExport && (
        <ExportDialog
          ws={ws}
          request={showExport}
          initialSidesFor={showExport.sidesFor}
          action={showExport.action ?? "export"}
          onClose={() => setShowExport(null)}
        />
      )}
      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      {showGoToScene && (
        <GoToScene
          cards={ws.cards}
          scenePages={ws.scenePages}
          onPick={(ord) => {
            setShowGoToScene(false);
            ws.openScene(ord);
          }}
          onClose={() => setShowGoToScene(false)}
        />
      )}
      <FolderAccessNotice chooseFolder={ws.openFolder} />
      {ws.rawPlay && (
        <RawPlaySheet
          details={ws.rawPlay}
          onClose={ws.closeRawPlay}
          onRetry={ws.retryRawPlay}
          onReveal={ws.revealRawPlay}
        />
      )}
      {settingsSheet.section && (
        <SettingsSheet
          section={settingsSheet.section}
          onSection={settingsSheet.setSection}
          onClose={settingsSheet.close}
          playsFolder={ws.vaultRoot ?? ws.root}
          wherePlaysLive={ws.wherePlaysLive}
          canReveal={ws.canReveal}
          onChangePlaysFolder={() => {
            settingsSheet.close();
            ws.openFolder();
          }}
          onShowShortcuts={() => {
            settingsSheet.close();
            setShowShortcuts(true);
          }}
          // The open play's format as it stands now: discovery read the play
          // files before this session's Use for This Play could change one.
          plays={ws.plays.map((p) =>
            p === openPlay(ws.root, ws.vaultRoot, ws.plays) ? { ...p, format: ws.format.id } : p,
          )}
          onOpenDesigner={(request) => {
            settingsSheet.close();
            openFormatDesigner(request);
          }}
        />
      )}
      {designer.request && (
        <FormatDesigner
          request={designer.request}
          play={
            ws.mode === "workspace" && ws.scriptTitle
              ? {
                  title: ws.playTitle || ws.scriptTitle,
                  getDoc: () => (ws.editor?.getJSON() as Doc | undefined) ?? null,
                  meta: ws.layoutMeta,
                  formatId: ws.format.id,
                  onUseFormat: ws.setFormat,
                }
              : null
          }
          onClose={() => {
            const back = designer.request?.returnTo;
            designer.close();
            if (back === "settings") openSettings("formats");
          }}
        />
      )}
      {finderOpens.request && (
        <OpenFileSheet request={finderOpens.request} onAnswer={finderOpens.answer} />
      )}
      {quitGate.hold && (
        /* A quit that would lose words is called off, and asks. ⏎ is Don't
           Quit: nothing brings back what Quit Anyway loses. */
        <Alert
          {...quitHoldWords(quitGate.hold)}
          confirmLabel="Quit Anyway"
          cancelLabel="Don't Quit"
          destructive
          cancelIsDefault
          onConfirm={quitGate.quitAnyway}
          onCancel={quitGate.dontQuit}
        />
      )}
      {showRecovery && ws.recoveryOffer && (
        <RecoveryPanel
          offer={ws.recoveryOffer}
          currentScriptText={ws.currentScriptText}
          onRecover={ws.recoverOffer}
          onDiscard={ws.discardOffer}
          onClose={() => setShowRecovery(false)}
        />
      )}
      {showHistory &&
        (() => {
          const other = historyTarget;
          return other ? (
            <HistoryPanel
              scriptTitle={other.title}
              listVersions={other.list}
              readVersion={other.read}
              restoreVersion={other.restore}
              currentScriptText={other.current}
              onClose={() => setShowHistoryFor(null)}
            />
          ) : (
            <HistoryPanel
              scriptTitle={ws.scriptTitle}
              listVersions={ws.listVersions}
              readVersion={ws.readVersion}
              restoreVersion={ws.restoreVersion}
              currentScriptText={ws.currentScriptText}
              onClose={() => setShowHistoryFor(null)}
            />
          );
        })()}
    </>
  );
}
