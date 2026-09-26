// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! System-owned artwork stays on the Mac; no Apple assets are redistributed.
#[tauri::command]
pub fn formatting_symbols() -> Result<std::collections::BTreeMap<String, String>, String> {
    #[cfg(target_os = "macos")]
    {
        use base64::Engine;
        use objc2::AllocAnyThread;
        use objc2_app_kit::{
            NSBitmapImageFileType, NSBitmapImageRep, NSImage, NSImageSymbolConfiguration,
        };
        use objc2_foundation::{NSDictionary, NSString};
        let mut out = std::collections::BTreeMap::new();
        for name in ["bold", "italic", "underline"] {
            let image = NSImage::imageWithSystemSymbolName_accessibilityDescription(
                &NSString::from_str(name),
                None,
            )
            .ok_or_else(|| format!("System symbol {name} is unavailable"))?;
            let config = NSImageSymbolConfiguration::configurationWithPointSize_weight(48.0, 0.0);
            let image = image
                .imageWithSymbolConfiguration(&config)
                .ok_or("Could not size the system symbol")?;
            let tiff = image
                .TIFFRepresentation()
                .ok_or("Could not render the system symbol")?;
            let bitmap = NSBitmapImageRep::initWithData(NSBitmapImageRep::alloc(), &tiff)
                .ok_or("Could not read the system symbol")?;
            // No optional PNG properties; the dictionary is correctly empty.
            let png = unsafe {
                bitmap.representationUsingType_properties(
                    NSBitmapImageFileType::PNG,
                    &NSDictionary::new(),
                )
            }
            .ok_or("Could not encode the system symbol")?;
            out.insert(
                name.to_string(),
                format!(
                    "data:image/png;base64,{}",
                    base64::engine::general_purpose::STANDARD.encode(png.to_vec())
                ),
            );
        }
        Ok(out)
    }
    #[cfg(not(target_os = "macos"))]
    Ok(std::collections::BTreeMap::new())
}
