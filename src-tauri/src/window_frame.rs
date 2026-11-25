// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The main window opens where it was left: its size, its place, and whether
//! it filled the screen (docs/engineering/cross-platform.md#PLAT-81). The first
//! launch, with nothing kept, opens on the whole of the main screen's work
//! area. A window that kept a fixed 1100 × 760 made every writer resize it by
//! hand at every launch.
//!
//! The frame is kept in `window.json` in the app's own config folder, beside
//! settings.json, in points (logical pixels), and written atomically a moment
//! after the window stops moving. It travels with nothing and names no file.
//! A frame that no longer fits (a screen unplugged, a smaller display) is
//! brought onto the screen it overlaps most, or the main screen, never left
//! where no one can reach its title bar.

// A self-test build sizes its window per check (selftest.rs), so it neither
// opens where a writer left the window nor keeps where it was.
#![cfg_attr(feature = "selftest", allow(dead_code))]

use serde::{Deserialize, Serialize};

/// Where and how large the window was, in points; `maximized` keeps the
/// frame it had before it filled the screen (Windows' Maximize, a Mac's Zoom).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
}

/// A screen's work area in points: the screen less the menu bar, Dock or taskbar.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// How much of a kept frame's top strip must be on a screen for the frame to
/// stay where it was: enough of the title bar to take hold of and drag.
const GRIP_WIDTH: f64 = 120.0;
const GRIP_HEIGHT: f64 = 28.0;

fn overlap(a: (f64, f64, f64, f64), b: &Area) -> f64 {
    let w = (a.0 + a.2).min(b.x + b.width) - a.0.max(b.x);
    let h = (a.1 + a.3).min(b.y + b.height) - a.1.max(b.y);
    if w > 0.0 && h > 0.0 {
        w * h
    } else {
        0.0
    }
}

/// The frame to open at. `areas[0]` is the main screen; `min` is the window's
/// smallest size. Nothing kept, or nothing on any screen: the main screen's
/// work area, whole.
pub fn place(saved: Option<Frame>, areas: &[Area], min: (f64, f64)) -> Option<Frame> {
    let main = *areas.first()?;
    let whole = |area: Area| Frame {
        x: area.x,
        y: area.y,
        width: area.width.max(min.0),
        height: area.height.max(min.1),
        maximized: false,
    };
    let Some(saved) = saved.filter(|f| {
        [f.x, f.y, f.width, f.height].iter().all(|v| v.is_finite())
            && f.width > 0.0
            && f.height > 0.0
    }) else {
        return Some(whole(main));
    };
    // The screen holding most of the title bar's grip, then most of the frame.
    let grip = (
        saved.x,
        saved.y,
        saved.width.min(GRIP_WIDTH * 4.0),
        GRIP_HEIGHT,
    );
    let gripped = areas
        .iter()
        .filter(|a| overlap(grip, a) >= GRIP_WIDTH.min(saved.width) * GRIP_HEIGHT * 0.5)
        .max_by(|a, b| {
            let frame = (saved.x, saved.y, saved.width, saved.height);
            overlap(frame, a).total_cmp(&overlap(frame, b))
        })
        .copied();
    let Some(area) = gripped else {
        // Off every screen: its size, on the main screen, centred.
        let width = saved.width.clamp(min.0, main.width.max(min.0));
        let height = saved.height.clamp(min.1, main.height.max(min.1));
        return Some(Frame {
            x: main.x + ((main.width - width) / 2.0).max(0.0),
            y: main.y + ((main.height - height) / 2.0).max(0.0),
            width,
            height,
            maximized: saved.maximized,
        });
    };
    // On a screen: no larger than it, and moved in until it is wholly on it.
    let width = saved.width.clamp(min.0, area.width.max(min.0));
    let height = saved.height.clamp(min.1, area.height.max(min.1));
    let x = saved
        .x
        .clamp(area.x, (area.x + area.width - width).max(area.x));
    let y = saved
        .y
        .clamp(area.y, (area.y + area.height - height).max(area.y));
    Some(Frame {
        x,
        y,
        width,
        height,
        maximized: saved.maximized,
    })
}

#[cfg(not(feature = "selftest"))]
pub use native::{follow, open_at};

#[cfg(not(feature = "selftest"))]
mod native {
    use super::{place, Area, Frame};
    use std::path::PathBuf;
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::{Mutex, OnceLock};
    use std::time::Duration;
    use tauri::{utils::config::WindowConfig, AppHandle, Manager, Runtime, Window, WindowEvent};

    fn file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
        app.path()
            .app_config_dir()
            .ok()
            .map(|d| d.join("window.json"))
    }

    fn kept<R: Runtime>(app: &AppHandle<R>) -> Option<Frame> {
        let bytes = std::fs::read(file(app)?).ok()?;
        serde_json::from_slice(&bytes).ok()
    }

    /// The screens' work areas in points, the main screen first.
    fn areas<R: Runtime>(app: &AppHandle<R>) -> Vec<Area> {
        let main = app.primary_monitor().ok().flatten();
        let mut monitors = app.available_monitors().unwrap_or_default();
        if let Some(main) = &main {
            if let Some(i) = monitors.iter().position(|m| m.name() == main.name()) {
                let first = monitors.remove(i);
                monitors.insert(0, first);
            } else {
                monitors.insert(0, main.clone());
            }
        }
        monitors
            .iter()
            .map(|m| {
                let scale = m.scale_factor();
                let work = m.work_area();
                Area {
                    x: work.position.x as f64 / scale,
                    y: work.position.y as f64 / scale,
                    width: work.size.width as f64 / scale,
                    height: work.size.height as f64 / scale,
                }
            })
            .collect()
    }

    /// The main window's config, set to open where it was left.
    pub fn open_at<R: Runtime>(app: &AppHandle<R>, mut config: WindowConfig) -> WindowConfig {
        let min = (
            config.min_width.unwrap_or(0.0),
            config.min_height.unwrap_or(0.0),
        );
        if let Some(frame) = place(kept(app), &areas(app), min) {
            config.x = Some(frame.x);
            config.y = Some(frame.y);
            config.width = frame.width;
            config.height = frame.height;
            config.center = false;
            config.maximized = frame.maximized;
        }
        config
    }

    /// The frame last written, so a maximized window keeps the size it had.
    static LAST: Mutex<Option<Frame>> = Mutex::new(None);
    static WRITER: OnceLock<Sender<Frame>> = OnceLock::new();

    /// One thread writes the frame once the window has been still for half a
    /// second, so a drag is one write, not hundreds.
    fn writer<R: Runtime>(app: &AppHandle<R>) -> Option<&'static Sender<Frame>> {
        let path = file(app)?;
        Some(WRITER.get_or_init(|| {
            let (send, receive) = channel::<Frame>();
            std::thread::spawn(move || {
                while let Ok(mut frame) = receive.recv() {
                    loop {
                        match receive.recv_timeout(Duration::from_millis(500)) {
                            Ok(newer) => frame = newer,
                            Err(RecvTimeoutError::Timeout) => break,
                            Err(RecvTimeoutError::Disconnected) => return,
                        }
                    }
                    if let Some(dir) = path.parent() {
                        let _ = std::fs::create_dir_all(dir);
                    }
                    if let Ok(json) = serde_json::to_vec_pretty(&frame) {
                        let _ = crate::vault::write_atomic(&path, &json);
                    }
                }
            });
            send
        }))
    }

    /// Called for every window event: the main window's moves and resizes are
    /// kept. A minimized or full-screen window keeps the frame it had.
    pub fn follow<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
        if window.label() != "main"
            || !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_))
        {
            return;
        }
        if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
            return;
        }
        let maximized = window.is_maximized().unwrap_or(false);
        let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
        let frame = if maximized {
            match *last {
                Some(before) => Frame {
                    maximized: true,
                    ..before
                },
                // Opened maximized: what it opened at stays the frame to return to.
                None => return,
            }
        } else {
            let (Ok(scale), Ok(at), Ok(size)) = (
                window.scale_factor(),
                window.outer_position(),
                window.inner_size(),
            ) else {
                return;
            };
            let at = at.to_logical::<f64>(scale);
            let size = size.to_logical::<f64>(scale);
            Frame {
                x: at.x,
                y: at.y,
                width: size.width,
                height: size.height,
                maximized: false,
            }
        };
        if *last == Some(frame) {
            return;
        }
        *last = Some(frame);
        if let Some(send) = writer(window.app_handle()) {
            let _ = send.send(frame);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: (f64, f64) = (820.0, 560.0);
    const LAPTOP: Area = Area {
        x: 0.0,
        y: 25.0,
        width: 1512.0,
        height: 920.0,
    };
    // A second screen to the laptop's right.
    const BESIDE: Area = Area {
        x: 1512.0,
        y: 0.0,
        width: 2560.0,
        height: 1415.0,
    };

    fn frame(x: f64, y: f64, width: f64, height: f64) -> Frame {
        Frame {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    #[test]
    fn first_launch_fills_the_main_screens_work_area() {
        assert_eq!(
            place(None, &[LAPTOP, BESIDE], MIN),
            Some(frame(0.0, 25.0, 1512.0, 920.0))
        );
    }

    #[test]
    fn a_kept_frame_that_fits_opens_as_it_was() {
        let kept = frame(100.0, 60.0, 1200.0, 800.0);
        assert_eq!(place(Some(kept), &[LAPTOP], MIN), Some(kept));
        let there = frame(1700.0, 100.0, 1800.0, 1200.0);
        assert_eq!(place(Some(there), &[LAPTOP, BESIDE], MIN), Some(there));
    }

    #[test]
    fn maximized_is_kept_with_the_frame_under_it() {
        let kept = Frame {
            maximized: true,
            ..frame(100.0, 60.0, 1200.0, 800.0)
        };
        assert_eq!(place(Some(kept), &[LAPTOP], MIN), Some(kept));
    }

    #[test]
    fn a_frame_on_a_screen_now_gone_comes_to_the_main_screen_at_its_size() {
        let there = frame(1700.0, 100.0, 1000.0, 700.0);
        assert_eq!(
            place(Some(there), &[LAPTOP], MIN),
            Some(frame(256.0, 135.0, 1000.0, 700.0))
        );
    }

    #[test]
    fn a_frame_larger_than_its_screen_shrinks_to_it() {
        let big = frame(1600.0, 50.0, 1800.0, 1200.0);
        assert_eq!(
            place(Some(big), &[LAPTOP], MIN),
            Some(frame(0.0, 25.0, 1512.0, 920.0))
        );
    }

    #[test]
    fn a_frame_hanging_off_its_screen_moves_onto_it() {
        let hanging = frame(900.0, 400.0, 1000.0, 700.0);
        assert_eq!(
            place(Some(hanging), &[LAPTOP], MIN),
            Some(frame(512.0, 245.0, 1000.0, 700.0))
        );
    }

    #[test]
    fn never_smaller_than_the_window_allows() {
        let tiny = frame(10.0, 30.0, 200.0, 100.0);
        assert_eq!(
            place(Some(tiny), &[LAPTOP], MIN),
            Some(frame(10.0, 30.0, 820.0, 560.0))
        );
    }

    #[test]
    fn a_broken_frame_is_ignored() {
        let broken = frame(f64::NAN, 0.0, 1000.0, 700.0);
        assert_eq!(
            place(Some(broken), &[LAPTOP], MIN),
            Some(frame(0.0, 25.0, 1512.0, 920.0))
        );
        assert_eq!(place(Some(frame(0.0, 0.0, 1000.0, 700.0)), &[], MIN), None);
    }

    #[test]
    fn the_kept_file_reads_back() {
        let json = r#"{"x":100.0,"y":60.0,"width":1200.0,"height":800.0}"#;
        let read: Frame = serde_json::from_str(json).unwrap();
        assert_eq!(read, frame(100.0, 60.0, 1200.0, 800.0));
    }
}
