// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Export delivery: write bytes the frontend rendered (a PDF, a .docx or an
//! .odt — docs/app/formatting/formats-and-layout.md#FMT-145) to a path the
//! user chose in the platform save dialog. Same durability manners as the
//! vault (docs/app/keeping-work/storage-and-file-format.md#STOR-D102 docs/app/keeping-work/storage-and-file-format.md#STOR-106): write a sibling temp file, then rename into place —
//! a crash never leaves a truncated export. Payload arrives base64-encoded
//! (Tauri IPC args are JSON; raw byte arrays would be 3-4× larger on the wire).
//!
//! Or print them (File › Print…, the export dialog's other button): the same bytes an export would save, handed to
//! the system print panel. The page cannot do it — WKWebView ignores
//! `window.print()`, the app's policy refuses the frame a PDF would need, and
//! printing the web view would print the app — so the PDF goes to PDFKit.

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use std::path::PathBuf;
use tauri::AppHandle;
#[cfg(desktop)]
use tauri_plugin_dialog::DialogExt;

const MAX_EXPORT_BYTES: usize = 256 * 1024 * 1024;

fn decode_export(base64: &str) -> Result<Vec<u8>, String> {
    if base64.len() > MAX_EXPORT_BYTES.div_ceil(3) * 4 {
        return Err("the export is too large (maximum 256 MB)".into());
    }
    let bytes = B64.decode(base64.as_bytes()).map_err(estr)?;
    if bytes.len() > MAX_EXPORT_BYTES { return Err("the export is too large (maximum 256 MB)".into()); }
    Ok(bytes)
}

fn estr<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// What the save panel says for one kind of export.
#[derive(Debug, PartialEq, Eq)]
struct ExportKind {
    title: &'static str,
    filter: &'static str,
    extension: &'static str,
    /// The file name when the page's suggestion has none.
    fallback: &'static str,
}

/// The page names the kind; anything else is refused rather than guessed.
fn export_kind(kind: &str) -> Result<ExportKind, String> {
    let (title, filter, extension, fallback) = match kind {
        "pdf" => ("Export PDF", "PDF", "pdf", "Script.pdf"),
        "docx" => ("Export .docx", ".docx", "docx", "Script.docx"),
        "odt" => ("Export .odt", ".odt", "odt", "Script.odt"),
        _ => return Err(format!("cannot export a {kind:?} file")),
    };
    Ok(ExportKind { title, filter, extension, fallback })
}

#[tauri::command]
#[cfg(desktop)]
pub async fn save_export(app: AppHandle, suggested_name: String, base64: String, kind: String) -> Result<Option<String>, String> {
    let ExportKind { title, filter, extension, fallback } = export_kind(&kind)?;
    let bytes = decode_export(&base64)?;
    // The page can suggest only a leaf name. The destination is the
    // native panel's answer inside this command, never a caller-supplied path.
    let name = PathBuf::from(suggested_name).file_name().map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| fallback.into());
    // A self-test answers the one panel it cannot drive, as it does the folder
    // picker's: the file is written for real, where the run keeps its evidence
    // (docs/engineering/release-engineering.md#REL-121).
    #[cfg(feature = "selftest")]
    if let Some(target) = crate::selftest::export_destination(&name) {
        let _ = (&title, &filter, &extension, &app);
        return deliver(&bytes, Some(target));
    }
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(title).set_file_name(name)
            .add_filter(filter, &[extension]).blocking_save_file()
    }).await.map_err(estr)?;
    deliver(&bytes, picked.and_then(|p| p.into_path().ok()))
}

#[tauri::command]
#[cfg(mobile)]
pub async fn save_export(_app: AppHandle, _suggested_name: String, _base64: String, _kind: String) -> Result<Option<String>, String> {
    Err("this platform cannot save an export yet".into())
}

/// Open the print panel on the window for a PDF the page rendered. Resolves
/// once the panel is up; printing, cancelling and "Save as PDF" are the
/// panel's, and the operation keeps the document alive until it ends.
#[tauri::command]
#[cfg(target_os = "macos")]
pub async fn print_export(window: tauri::WebviewWindow, job_title: String, base64: String) -> Result<(), String> {
    let bytes = decode_export(&base64)?;
    let (tx, rx) = std::sync::mpsc::channel();
    // AppKit, so on the main thread, with the NSWindow the panel attaches to.
    window
        .with_webview(move |webview| {
            let _ = tx.send(print::present(webview.ns_window(), &job_title, &bytes));
        })
        .map_err(estr)?;
    tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(std::time::Duration::from_secs(30))
            .map_err(|_| "the print panel did not open".to_string())?
    })
    .await
    .map_err(estr)?
}

#[tauri::command]
#[cfg(not(target_os = "macos"))]
pub async fn print_export(_job_title: String, _base64: String) -> Result<(), String> {
    Err("this platform cannot print yet".into())
}

#[cfg(target_os = "macos")]
mod print {
    use std::ffi::c_void;

    use objc2::rc::Retained;
    use objc2::{AllocAnyThread, MainThreadMarker};
    use objc2_app_kit::{NSPrintInfo, NSWindow};
    use objc2_foundation::{NSCopying, NSData, NSSize, NSString};
    use objc2_pdf_kit::{PDFDisplayBox, PDFDocument, PDFPrintScalingMode};

    /// The PDF as PDFKit reads it, and the size of its first page — the paper
    /// the panel starts on. Any thread: only the print operation needs the main one.
    pub fn read(bytes: &[u8]) -> Result<(Retained<PDFDocument>, Option<NSSize>), String> {
        let data = NSData::with_bytes(bytes);
        // SAFETY: `data` is a live NSData; PDFKit copies what it keeps.
        let document = unsafe { PDFDocument::initWithData(PDFDocument::alloc(), &data) }
            .ok_or("the PDF could not be read for printing")?;
        // SAFETY: page 0 of a document PDFKit just read; bounds is a plain rect.
        let paper = unsafe { document.pageAtIndex(0) }
            .map(|first| unsafe { first.boundsForBox(PDFDisplayBox::MediaBox) }.size);
        Ok((document, paper))
    }

    /// The print panel, as a sheet on `ns_window`.
    ///
    /// At 100%: a script's geometry is its format's, and PDFKit's "scale down
    /// to fit" shrinks every page to the printer's imageable area — measured,
    /// a Letter page came out at 93%, Courier 12 at about 11pt, every margin
    /// moved. The white margins a printer cannot reach are the script's own
    /// inch and more, so nothing is lost at full size. The paper starts at the
    /// PDF's own size, Letter or A4 as the format says; the panel can change it.
    pub fn present(ns_window: *mut c_void, job_title: &str, bytes: &[u8]) -> Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("printing has to start on the main thread")?;
        if ns_window.is_null() {
            return Err("there is no window to print from".into());
        }
        // SAFETY: the webview's own NSWindow, handed over on the main thread
        // for the length of this call.
        let window = unsafe { &*(ns_window as *const NSWindow) };
        if window.attachedSheet().is_some() {
            return Err("another panel is already open on this window".into());
        }
        let (document, paper) = read(bytes)?;
        // A copy: the shared print info is every later print's starting point.
        let info = NSPrintInfo::sharedPrintInfo().copy();
        if let Some(size) = paper {
            info.setPaperSize(size);
        }
        // SAFETY: main thread (mtm), a live document and print info.
        let operation = unsafe {
            document.printOperationForPrintInfo_scalingMode_autoRotate(
                Some(&info),
                PDFPrintScalingMode::PageScaleNone,
                true,
                mtm,
            )
        }
        .ok_or("the print job could not be prepared")?;
        operation.setJobTitle(Some(&NSString::from_str(job_title)));
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);
        // SAFETY: no delegate and no selector, so nothing is called back.
        unsafe {
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                None,
                None,
                std::ptr::null_mut(),
            );
        }
        Ok(())
    }
}

fn deliver(bytes: &[u8], selected: Option<PathBuf>) -> Result<Option<String>, String> {
    let Some(target) = selected else { return Ok(None) };
    if target.parent().is_none() || target.file_name().is_none() {
        return Err("export path has no parent directory or file name".to_string());
    }
    // The vault's own writer: its temp name carries a token and
    // is created exclusively, where the fixed `.<name>.proscenium-tmp` this
    // used to write could be planted ahead of time as a link to any file the
    // writer may change, and truncated by the next export.
    crate::vault::write_atomic(&target, bytes).map_err(estr)?;
    Ok(Some(target.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_panel_for_each_kind_and_refuses_others() {
        assert_eq!(
            export_kind("pdf").unwrap(),
            ExportKind { title: "Export PDF", filter: "PDF", extension: "pdf", fallback: "Script.pdf" }
        );
        assert_eq!(export_kind("docx").unwrap().extension, "docx");
        assert_eq!(export_kind("odt").unwrap().title, "Export .odt");
        assert!(export_kind("exe").is_err());
        assert!(export_kind("").is_err());
    }

    #[test]
    fn round_trips_bytes() {
        let payload = b"%PDF-1.7 test";
        let encoded = B64.encode(payload);
        assert_eq!(B64.decode(encoded.as_bytes()).unwrap(), payload);
        assert_eq!(decode_export(&encoded).unwrap(), payload);
        assert!(decode_export("not base64").is_err());
    }

    /// A one-page PDF of the given size, with a real cross-reference table.
    #[cfg(target_os = "macos")]
    fn one_page_pdf(width: u32, height: u32) -> Vec<u8> {
        let objects = [
            "<< /Type /Catalog /Pages 2 0 R >>".to_string(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".to_string(),
            format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] >>"),
        ];
        let mut out = b"%PDF-1.4\n".to_vec();
        let mut offsets = Vec::new();
        for (i, body) in objects.iter().enumerate() {
            offsets.push(out.len());
            out.extend(format!("{} 0 obj\n{body}\nendobj\n", i + 1).as_bytes());
        }
        let xref = out.len();
        out.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes());
        for offset in offsets {
            out.extend(format!("{offset:010} 00000 n \n").as_bytes());
        }
        out.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).as_bytes());
        out
    }

    /// Print's first step, short of the panel: PDFKit is linked and found,
    /// reads the bytes, and the paper starts at the script's own page size.
    /// A class that did not resolve here would panic on the main thread at the
    /// first ⌘P — the app gone, not an error said.
    #[cfg(target_os = "macos")]
    #[test]
    fn print_reads_the_pdf_and_starts_on_its_own_paper() {
        let (_, letter) = print::read(&one_page_pdf(612, 792)).unwrap();
        let letter = letter.expect("a page");
        assert_eq!((letter.width, letter.height), (612.0, 792.0));
        let (_, a4) = print::read(&one_page_pdf(595, 842)).unwrap();
        let a4 = a4.expect("a page");
        assert_eq!((a4.width, a4.height), (595.0, 842.0));
        assert!(print::read(b"not a pdf").is_err());
    }

    #[test]
    fn a1_03_cancelled_export_writes_nothing_and_only_the_panel_target_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let outside = dir.path().join("unpicked.pdf");
        let selected = dir.path().join("selected.pdf");
        std::fs::write(&outside, b"private").unwrap();
        std::fs::write(&selected, b"old export").unwrap();
        assert_eq!(deliver(b"new export", None).unwrap(), None);
        assert_eq!(std::fs::read(&selected).unwrap(), b"old export");
        assert_eq!(deliver(b"new export", Some(selected.clone())).unwrap(), Some(selected.to_string_lossy().into_owned()));
        assert_eq!(std::fs::read(&selected).unwrap(), b"new export");
        assert_eq!(std::fs::read(&outside).unwrap(), b"private");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
