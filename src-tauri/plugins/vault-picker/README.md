# vault-picker

The mobile folder picker for the vault. App-local plugin — not published.

`tauri-plugin-dialog` gives iOS a *file* picker but no **folder** picker
([plugins-workspace#933](https://github.com/tauri-apps/plugins-workspace/issues/933)),
and a Proscenium vault is a folder. This supplies the missing piece:
`UIDocumentPickerViewController` opened on `UTType.folder`, plus a bookmark so
the writer's grant survives relaunch.

It needs **no entitlement**, which is the reason it exists rather than an
app-owned iCloud container: access comes from the writer choosing a folder, so
the vault can live in any Files location and the app stays out of the sync
business. Android's SAF tree picker is the same shape behind the same type.

Design rationale, the bookmark-renewal rule, and the swift-rs deployment-target
trap are all recorded in [`docs/engineering/cross-platform.md`](../../../docs/engineering/cross-platform.md)
(§iOS). Read that before changing anything here.

Two things to know before editing:

- **No webview commands.** `COMMANDS` is empty on purpose; the app's own
  `vault_pick_folder` calls this from Rust so there stays one guarded path into
  the vault. Adding a command here also adds a permission surface.
- **Swift compiles during `cargo check`.** swift-rs builds the package as part
  of the Rust build and the build script panics on a Swift error, so
  `cargo check --target aarch64-apple-ios` is the fast feedback loop — you do
  not need Xcode to find a Swift mistake.
