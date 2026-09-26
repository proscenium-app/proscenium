// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! The settings model against real files. The command layer is a thin
//! `AppHandle` → path wrapper, so everything that decides what lands on disk is
//! reachable from here with a temp directory.

use super::*;
use serde_json::json;

fn temp_settings() -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("settings.json");
    (dir, path)
}

fn write_json(path: &Path, value: Value) {
    fs::write(path, serde_json::to_vec_pretty(&value).unwrap()).unwrap();
}

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn patch(value: Value) -> SettingsPatch {
    serde_json::from_value(value).unwrap()
}

/// A real bookmark is ~1,100 characters of base64; the test only needs one that
/// is long and would be noticed if a single byte moved.
fn bookmark() -> String {
    "Ym9va21hcms".repeat(100)
}

/// The file every installed copy has today, in the shape the old struct wrote.
fn legacy_file() -> Value {
    json!({
        "lastVault": "/Users/writer/Library/Mobile Documents/com~apple~CloudDocs/Writing/Plays",
        "lastVaultBookmark": bookmark(),
        "learnedWords": ["Jonah", "Mara", "Vronsky"],
        "accent": "iris",
        "runningTimeStrip": false
    })
}

#[test]
fn every_existing_preference_survives_the_upgrade() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    let s = from_object(&read_object(&path));
    assert_eq!(s.accent, "iris");
    assert!(!s.running_time_strip);
    assert_eq!(s.learned_words, vec!["Jonah", "Mara", "Vronsky"]);
    // Preferences the old file never had come back as their defaults — launch
    // included, which goes back where the writer left off (2026-09-16).
    assert!(s.spellcheck);
    assert_eq!(s.open_at_launch, OpenAtLaunch::LastPlay);
    assert_eq!(s.last_play, None);
}

#[test]
fn a_missing_file_is_every_default() {
    let (_dir, path) = temp_settings();
    let s = from_object(&read_object(&path));
    assert_eq!(
        s,
        Settings {
            accent: "gilt".into(),
            appearance: "system".into(),
            format_order: vec![],
            scene_statuses: DEFAULT_SCENE_STATUSES.iter().map(|s| s.to_string()).collect(),
            interface_text_size: 100,
            running_time_strip: true,
            spellcheck: true,
            learned_words: vec![],
            play_statuses: DEFAULT_PLAY_STATUSES.iter().map(|s| s.to_string()).collect(),
            show_progress: true,
            open_at_launch: OpenAtLaunch::LastPlay,
            last_play: None,
            check_for_updates: true,
            update_track: UpdateTrack::Stable,
            has_update_track_key: false,
            default_format: None,
            share_analytics: true,
            privacy_notice_seen: false,
        }
    );
}

#[test]
fn an_update_leaves_the_vault_its_bookmark_and_unknown_keys_alone() {
    let (_dir, path) = temp_settings();
    let mut before = legacy_file();
    // A key from a newer build, or a thread that has not merged yet.
    before["telemetry"] = json!({ "enabled": false, "noticeSeen": true });
    write_json(&path, before.clone());

    let s = update_at(&path, patch(json!({ "accent": "velvet", "spellcheck": false }))).unwrap();
    assert_eq!(s.accent, "velvet");
    assert!(!s.spellcheck);

    let after = read_json(&path);
    assert_eq!(after["lastVault"], before["lastVault"]);
    assert_eq!(after["lastVaultBookmark"], before["lastVaultBookmark"]);
    assert_eq!(after["telemetry"], before["telemetry"]);
    assert_eq!(after["learnedWords"], before["learnedWords"]);
    assert_eq!(after["runningTimeStrip"], json!(false));
    assert_eq!(after["accent"], json!("velvet"));
    assert_eq!(after["spellcheck"], json!(false));
}

#[test]
fn an_invalid_patch_writes_nothing_at_all() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    let bytes = fs::read(&path).unwrap();

    // A good field beside a bad one: all or nothing, so neither lands.
    let err = update_at(&path, patch(json!({ "spellcheck": false, "accent": "chartreuse" })));
    assert!(err.unwrap_err().contains("chartreuse"));
    let err = update_at(&path, patch(json!({ "lastPlay": "  " })));
    assert!(err.is_err());
    let err = update_at(&path, patch(json!({ "lastPlay": "The Lighthouse\u{0}" })));
    assert!(err.is_err());
    let err = update_at(&path, patch(json!({ "learnedWords": { "add": ["   "] } })));
    assert!(err.is_err());

    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn a_patch_cannot_name_the_vault_or_anything_unknown() {
    // Refused at the boundary, before `update_settings` runs: docs/app/keeping-work/storage-and-file-format.md#STOR-D12 owns
    // `lastVault`, and a misspelt key must fail rather than save nothing.
    for bad in [
        json!({ "lastVault": "/tmp/elsewhere" }),
        json!({ "lastVaultBookmark": "AAAA" }),
        json!({ "accnet": "iris" }),
        json!({ "spellcheck": "no" }),
        json!({ "openAtLaunch": "lastScene" }),
        json!({ "learnedWords": ["replace", "the", "list"] }),
        json!({ "learnedWords": { "set": ["x"] } }),
    ] {
        assert!(
            serde_json::from_value::<SettingsPatch>(bad.clone()).is_err(),
            "accepted {bad}"
        );
    }
}

#[test]
fn null_in_a_patch_means_leave_it() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    let s = update_at(&path, patch(json!({ "accent": null }))).unwrap();
    assert_eq!(s.accent, "iris");
}

#[test]
fn the_dictionary_changes_by_word_never_by_list() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());

    // Taught once whatever the case, trimmed, and kept sorted.
    let s = update_at(
        &path,
        patch(json!({ "learnedWords": { "add": ["  Ophelia ", "vronsky", "anouilh"] } })),
    )
    .unwrap();
    assert_eq!(s.learned_words, vec!["anouilh", "Jonah", "Mara", "Ophelia", "Vronsky"]);

    // Forgotten whatever the case.
    let s = update_at(&path, patch(json!({ "learnedWords": { "remove": ["MARA"] } }))).unwrap();
    assert_eq!(s.learned_words, vec!["anouilh", "Jonah", "Ophelia", "Vronsky"]);

    // A word in both lists is forgotten.
    let s = update_at(
        &path,
        patch(json!({ "learnedWords": { "add": ["Hedda"], "remove": ["hedda"] } })),
    )
    .unwrap();
    assert!(!s.learned_words.iter().any(|w| w == "Hedda"));

    // Case-insensitive beyond ASCII too, as the checker's comparison is.
    let s = update_at(&path, patch(json!({ "learnedWords": { "add": ["Éponine"] } }))).unwrap();
    let s2 = update_at(&path, patch(json!({ "learnedWords": { "add": ["éponine"] } }))).unwrap();
    assert_eq!(s.learned_words, s2.learned_words);

    // An emptied dictionary leaves no key behind.
    let all = s2.learned_words.clone();
    update_at(&path, patch(json!({ "learnedWords": { "remove": all } }))).unwrap();
    assert!(read_json(&path).get("learnedWords").is_none());
}

#[test]
fn remembering_the_vault_keeps_every_preference_and_a_good_bookmark() {
    let (_dir, path) = temp_settings();
    let mut before = legacy_file();
    before["openAtLaunch"] = json!("lastPlay");
    write_json(&path, before.clone());

    // Path known, grant not: the stored bookmark stays — for the same folder.
    let plays = before["lastVault"].as_str().unwrap().to_string();
    remember_vault_at(&path, plays.clone(), None).unwrap();
    let after = read_json(&path);
    assert_eq!(after["lastVault"], json!(plays));
    assert_eq!(after["lastVaultBookmark"], before["lastVaultBookmark"]);
    assert_eq!(after["accent"], json!("iris"));
    assert_eq!(after["learnedWords"], before["learnedWords"]);
    assert_eq!(after["openAtLaunch"], json!("lastPlay"));

    // A renewed grant replaces it.
    remember_vault_at(&path, plays, Some("RENEWED".into())).unwrap();
    assert_eq!(read_json(&path)["lastVaultBookmark"], json!("RENEWED"));
}

/// A grant belongs to its folder. Keeping the old one for a new folder (iCloud
/// Drive after a picked folder, a play's folder opened from Finder) made
/// `vault_reopen_last` resolve it and reopen the OLD Plays folder next launch.
#[test]
fn another_folder_never_inherits_the_last_ones_grant() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    remember_vault_at(&path, "/Users/writer/Dropbox/Plays".into(), None).unwrap();
    let after = read_json(&path);
    assert_eq!(after["lastVault"], json!("/Users/writer/Dropbox/Plays"));
    assert!(after.get("lastVaultBookmark").is_none(), "the old folder's grant came along");
    assert_eq!(after["accent"], json!("iris"));
}

#[test]
fn a_new_bookmark_always_wins_and_a_spelling_is_not_a_folder() {
    let by_text = |a: &str, b: &str| a == b;
    let kept = bookmark_to_keep(Some("/a"), Some("old".into()), "/b", Some("new".into()), by_text);
    assert_eq!(kept.as_deref(), Some("new"));

    #[cfg(unix)]
    {
        let tmp = tempfile::tempdir().unwrap();
        let real = tmp.path().join("Plays");
        std::fs::create_dir(&real).unwrap();
        let link = tmp.path().join("Plays link");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        // The vault root arrives canonicalized; the picker's spelling may not be.
        assert!(same_folder(&link.to_string_lossy(), &real.to_string_lossy()));
        assert!(!same_folder(&real.to_string_lossy(), &tmp.path().to_string_lossy()));
    }
}

/// A Plays folder chosen one level too high, then moved down into the folder
/// its plays are in (docs/app/keeping-work/storage-and-file-format.md#STOR-D12). Under the App Sandbox the old folder's grant
/// reaches the new one only while the app runs, so the new one is bookmarked as
/// it is remembered. Every other folder is left to `remember_vault`'s rule.
#[test]
fn a_folder_inside_the_plays_folder_takes_a_bookmark_of_its_own() {
    let tmp = tempfile::tempdir().unwrap();
    let writing = tmp.path().join("Writing");
    let plays = writing.join("Plays");
    let beside = tmp.path().join("Writing 2");
    std::fs::create_dir_all(&plays).unwrap();
    std::fs::create_dir(&beside).unwrap();
    let (writing, plays, beside) = (
        writing.to_string_lossy().to_string(),
        plays.to_string_lossy().to_string(),
        beside.to_string_lossy().to_string(),
    );
    let mint = |path: &str| Some(format!("GRANT {path}"));

    assert_eq!(bookmark_below(Some(&writing), &plays, mint), Some(format!("GRANT {plays}")));
    // The same folder, one beside it (a shared prefix is not a folder), the
    // folder around it, or nothing stored: no new grant.
    assert_eq!(bookmark_below(Some(&writing), &writing, mint), None);
    assert_eq!(bookmark_below(Some(&writing), &beside, mint), None);
    assert_eq!(bookmark_below(Some(&plays), &writing, mint), None);
    assert_eq!(bookmark_below(None, &plays, mint), None);
    // A folder that is not there is inside nothing.
    assert_eq!(bookmark_below(Some(&writing), &format!("{writing}/Gone"), mint), None);
    // A grant that cannot be made changes nothing.
    assert_eq!(bookmark_below(Some(&writing), &plays, |_| None), None);

    #[cfg(unix)]
    {
        // The vault root arrives canonicalized; the stored path may be spelled
        // through a link.
        let link = tmp.path().join("Writing link");
        std::os::unix::fs::symlink(&writing, &link).unwrap();
        assert!(folder_inside(&plays, &link.to_string_lossy()));
    }
}

/// Where no bookmark of its own can be made (iOS, or a grant that refuses),
/// the folder inside keeps the grant of the folder around it, and the next
/// launch opens it inside the folder that grant reopens. Dropping the grant
/// there lost the Plays folder on the next launch.
#[test]
fn without_a_bookmark_of_its_own_a_folder_inside_keeps_the_grant_around_it() {
    let tmp = tempfile::tempdir().unwrap();
    let writing = tmp.path().join("Writing");
    let plays = writing.join("Plays");
    std::fs::create_dir_all(&plays).unwrap();
    let (writing, plays) = (writing.to_string_lossy().to_string(), plays.to_string_lossy().to_string());
    let (_dir, path) = temp_settings();
    write_json(&path, json!({ "lastVault": writing, "lastVaultBookmark": "GRANT FOR WRITING" }));

    remember_vault_at(&path, plays.clone(), None).unwrap();
    let after = read_json(&path);
    assert_eq!(after["lastVault"], json!(plays));
    assert_eq!(after["lastVaultBookmark"], json!("GRANT FOR WRITING"));

    // Next launch: the bookmark resolves to Writing, and Plays is what opens.
    assert_eq!(reopen_path(writing.clone(), Some(plays.clone())), plays);
    // The folder the bookmark names, when the remembered one is that folder,
    // outside it, gone, or not remembered.
    assert_eq!(reopen_path(writing.clone(), Some(writing.clone())), writing);
    assert_eq!(reopen_path(plays.clone(), Some(writing.clone())), plays);
    assert_eq!(reopen_path(writing.clone(), Some(format!("{writing}/Gone"))), writing);
    assert_eq!(reopen_path(writing.clone(), None), writing);

    // Leaving for a folder beside it still drops the grant.
    let beside = tmp.path().join("Elsewhere");
    std::fs::create_dir(&beside).unwrap();
    remember_vault_at(&path, beside.to_string_lossy().to_string(), None).unwrap();
    assert!(read_json(&path).get("lastVaultBookmark").is_none());
}

#[test]
fn a_wrong_value_costs_only_that_preference() {
    let (_dir, path) = temp_settings();
    write_json(
        &path,
        json!({
            "accent": 42,
            "runningTimeStrip": "yes",
            "spellcheck": false,
            "learnedWords": ["Mara", 7, null, "Jonah"],
            "openAtLaunch": "somewhere",
            "lastPlay": "\n"
        }),
    );
    let s = from_object(&read_object(&path));
    assert_eq!(s.accent, "gilt");
    assert!(s.running_time_strip);
    assert!(!s.spellcheck);
    assert_eq!(s.learned_words, vec!["Mara", "Jonah"]);
    assert_eq!(s.open_at_launch, OpenAtLaunch::LastPlay);
    assert_eq!(s.last_play, None);
}

#[test]
fn an_unreadable_file_is_set_aside_not_written_over() {
    let (dir, path) = temp_settings();
    fs::write(&path, b"{ \"lastVault\": \"/Users/writer/Pl").unwrap();

    // Reads degrade to defaults rather than failing.
    assert_eq!(from_object(&read_object(&path)).accent, "gilt");

    let s = update_at(&path, patch(json!({ "accent": "iris" }))).unwrap();
    assert_eq!(s.accent, "iris");
    let aside = dir.path().join("settings.json.unreadable");
    assert_eq!(fs::read(&aside).unwrap(), b"{ \"lastVault\": \"/Users/writer/Pl");
    assert_eq!(read_json(&path)["accent"], json!("iris"));
}

#[test]
fn a_write_leaves_only_the_file_behind() {
    let (dir, path) = temp_settings();
    update_at(&path, patch(json!({ "openAtLaunch": "lastPlay", "lastPlay": "01J8ZQ4M7X3K9V2B6N5P0R1S2T" })))
        .unwrap();
    let names: Vec<String> = fs::read_dir(dir.path())
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names, vec!["settings.json"]);
    let s = from_object(&read_object(&path));
    assert_eq!(s.open_at_launch, OpenAtLaunch::LastPlay);
    assert_eq!(s.last_play.as_deref(), Some("01J8ZQ4M7X3K9V2B6N5P0R1S2T"));
}

#[test]
fn concurrent_writers_lose_nothing() {
    // The race the lock exists for: many read-modify-writes at once, one of
    // them the launch path's `remember_vault`. Without the lock, a writer that
    // read before another wrote puts the older object back.
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    let handles: Vec<_> = (0..24)
        .map(|i| {
            let path = path.clone();
            std::thread::spawn(move || {
                if i == 11 {
                    remember_vault_at(&path, "/Users/writer/Plays".into(), Some("GRANT".into()))
                        .unwrap();
                } else {
                    update_at(&path, patch(json!({ "learnedWords": { "add": [format!("word{i}")] } })))
                        .unwrap();
                }
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    let s = from_object(&read_object(&path));
    for i in (0..24).filter(|i| *i != 11) {
        assert!(s.learned_words.contains(&format!("word{i}")), "lost word{i}");
    }
    assert_eq!(read_json(&path)["lastVaultBookmark"], json!("GRANT"));
}

#[test]
fn the_model_serializes_under_the_names_the_frontend_reads() {
    let s = from_object(&Map::new());
    let v = serde_json::to_value(&s).unwrap();
    let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec![
            "accent",
            "appearance",
            "checkForUpdates",
            "defaultFormat",
            "formatOrder",
            "hasUpdateTrackKey",
            "interfaceTextSize",
            "lastPlay",
            "learnedWords",
            "openAtLaunch",
            "playStatuses",
            "privacyNoticeSeen",
            "runningTimeStrip",
            "sceneStatuses",
            "shareAnalytics",
            "showProgress",
            "spellcheck",
            "updateTrack"
        ]
    );
    assert_eq!(v["openAtLaunch"], json!("lastPlay"));
    assert_eq!(v["lastPlay"], Value::Null);
}

#[test]
fn the_last_play_is_set_and_cleared_by_patch() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());

    let s = update_at(&path, patch(json!({ "lastPlay": "01KYFQCPT4C7J7D6VPZPJMSSJ5" }))).unwrap();
    assert_eq!(s.last_play.as_deref(), Some("01KYFQCPT4C7J7D6VPZPJMSSJ5"));

    // Absent leaves it; null — the writer went back to the Plays screen —
    // clears it, and leaves no key behind.
    let s = update_at(&path, patch(json!({ "spellcheck": false }))).unwrap();
    assert_eq!(s.last_play.as_deref(), Some("01KYFQCPT4C7J7D6VPZPJMSSJ5"));
    let s = update_at(&path, patch(json!({ "lastPlay": null }))).unwrap();
    assert_eq!(s.last_play, None);
    assert!(read_json(&path).get("lastPlay").is_none());
    assert_eq!(read_json(&path)["accent"], json!("iris"));

    // Not a play: refused whole.
    let bytes = fs::read(&path).unwrap();
    assert!(update_at(&path, patch(json!({ "lastPlay": "  " }))).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn the_default_format_is_set_and_cleared_by_patch() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());

    let s = update_at(&path, patch(json!({ "defaultFormat": "my-house" }))).unwrap();
    assert_eq!(s.default_format.as_deref(), Some("my-house"));
    assert_eq!(read_json(&path)["defaultFormat"], json!("my-house"));

    // Absent leaves it; null clears it, and clearing leaves no key behind.
    let s = update_at(&path, patch(json!({ "spellcheck": false }))).unwrap();
    assert_eq!(s.default_format.as_deref(), Some("my-house"));
    let s = update_at(&path, patch(json!({ "defaultFormat": null }))).unwrap();
    assert_eq!(s.default_format, None);
    assert!(read_json(&path).get("defaultFormat").is_none());

    // Not an id: refused whole, nothing written.
    let bytes = fs::read(&path).unwrap();
    assert!(update_at(&path, patch(json!({ "defaultFormat": "My House" }))).is_err());
    assert!(update_at(&path, patch(json!({ "defaultFormat": "../x" }))).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);

    // A hand-mangled value reads as no choice at all.
    write_json(&path, json!({ "defaultFormat": 7 }));
    assert_eq!(from_object(&read_object(&path)).default_format, None);
}

#[test]
fn the_update_track_is_stable_until_chosen() {
    let (_dir, path) = temp_settings();
    assert_eq!(from_object(&read_object(&path)).update_track, UpdateTrack::Stable);

    for (word, track) in [("alpha", UpdateTrack::Alpha), ("beta", UpdateTrack::Beta), ("stable", UpdateTrack::Stable)] {
        let s = update_at(&path, patch(json!({ "updateTrack": word }))).unwrap();
        assert_eq!(s.update_track, track);
        assert_eq!(read_json(&path)["updateTrack"], json!(word));
    }

    // Only a track reaches the file.
    assert!(serde_json::from_value::<SettingsPatch>(json!({ "updateTrack": "nightly" })).is_err());
    assert!(serde_json::from_value::<SettingsPatch>(json!({ "updateTrack": "Alpha" })).is_err());

    // A hand-mangled value falls back to stable, like every preference.
    write_json(&path, json!({ "updateTrack": "nightly" }));
    assert_eq!(from_object(&read_object(&path)).update_track, UpdateTrack::Stable);
}

#[test]
fn alphas_key_is_written_by_patch_and_never_read_back() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    let key = "k".repeat(22) + "Ey_-0123456789abcdefg";
    assert!(!from_object(&read_object(&path)).has_update_track_key);

    let s = update_at(&path, patch(json!({ "updateTrackKey": key }))).unwrap();
    assert!(s.has_update_track_key);
    assert_eq!(read_json(&path)["updateTrackKey"], json!(key));
    // The page is told there is one, and never what it is.
    let answered = serde_json::to_string(&s).unwrap();
    assert!(answered.contains("\"hasUpdateTrackKey\":true"));
    assert!(!answered.contains(&key));
    // Another preference leaves it where it is.
    assert!(update_at(&path, patch(json!({ "updateTrack": "alpha" }))).unwrap().has_update_track_key);
    assert_eq!(read_json(&path)["updateTrackKey"], json!(key));

    // Only a key's shape reaches the file, and a refused patch writes nothing.
    let bytes = fs::read(&path).unwrap();
    for bad in [json!(""), json!(&key[1..]), json!(format!("{key}=")), json!(key.replace('k', "+")), json!(7), json!(null)] {
        let refused = serde_json::from_value::<SettingsPatch>(json!({ "updateTrackKey": bad }))
            .map_err(|e| e.to_string())
            .and_then(|p| update_at(&path, p).map(|s| s.has_update_track_key));
        assert!(refused.is_err() || refused == Ok(true), "{bad}");
    }
    assert_eq!(fs::read(&path).unwrap(), bytes);

    // A hand-mangled key is no key.
    write_json(&path, json!({ "updateTrack": "alpha", "updateTrackKey": "short" }));
    let s = from_object(&read_object(&path));
    assert_eq!((s.update_track, s.has_update_track_key), (UpdateTrack::Alpha, false));
}

#[test]
fn the_reports_switch_is_on_until_switched_off() {
    let (_dir, path) = temp_settings();
    let s = from_object(&read_object(&path));
    assert!(s.share_analytics, "on by default (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D3)");
    assert!(!s.privacy_notice_seen);

    let s = update_at(&path, patch(json!({ "shareAnalytics": false, "privacyNoticeSeen": true }))).unwrap();
    assert!(!s.share_analytics);
    assert!(s.privacy_notice_seen);
    let stored = read_json(&path);
    assert_eq!(stored["shareAnalytics"], json!(false));
    assert_eq!(stored["privacyNoticeSeen"], json!(true));

    // Only a true or false reaches the file.
    assert!(serde_json::from_value::<SettingsPatch>(json!({ "shareAnalytics": "no" })).is_err());

    // A hand-mangled value falls back to the default, like every preference.
    write_json(&path, json!({ "shareAnalytics": "off" }));
    assert!(from_object(&read_object(&path)).share_analytics);
}

#[test]
fn a6_05_interface_text_size_is_bounded_and_persisted() {
    let (_dir, path) = temp_settings();
    for size in [100, 125, 150, 175, 200] {
        let saved = update_at(&path, patch(json!({ "interfaceTextSize": size }))).unwrap();
        assert_eq!(saved.interface_text_size, size);
        assert_eq!(from_object(&read_object(&path)).interface_text_size, size);
    }
    for size in [0, 99, 201] {
        assert!(update_at(&path, patch(json!({ "interfaceTextSize": size }))).is_err());
        assert_eq!(from_object(&read_object(&path)).interface_text_size, 200);
    }
}

#[test]
fn the_status_list_is_patched_whole_and_read_softly() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());

    // Absent: the list the Plays screen always had, and Progress shown.
    let s = from_object(&read_object(&path));
    assert_eq!(s.play_statuses, DEFAULT_PLAY_STATUSES.to_vec());
    assert!(s.show_progress);

    // A reordered, renamed list goes in whole and comes back as given.
    let list = json!(["in rehearsal", "idea", "drafting"]);
    let s = update_at(&path, patch(json!({ "playStatuses": list, "showProgress": false }))).unwrap();
    assert_eq!(s.play_statuses, vec!["in rehearsal", "idea", "drafting"]);
    assert!(!s.show_progress);
    assert_eq!(read_json(&path)["playStatuses"], list);
    assert_eq!(read_json(&path)["accent"], json!("iris"));

    // Emptied is a choice, not a missing list.
    let s = update_at(&path, patch(json!({ "playStatuses": [] }))).unwrap();
    assert!(s.play_statuses.is_empty());

    // Any wrong status refuses the whole patch, and nothing is written.
    let bytes = fs::read(&path).unwrap();
    let too_many: Vec<String> = (0..=MAX_STATUSES).map(|i| format!("status {i}")).collect();
    for bad in [
        json!(["idea", "Idea"]),
        json!(["idea", ""]),
        json!([" idea"]),
        json!(["x".repeat(41)]),
        json!(["tab\there"]),
        json!(too_many),
    ] {
        assert!(update_at(&path, patch(json!({ "playStatuses": bad }))).is_err(), "accepted {bad}");
    }
    // Not a list at all never becomes a patch.
    assert!(serde_json::from_value::<SettingsPatch>(json!({ "playStatuses": "idea" })).is_err());
    assert_eq!(fs::read(&path).unwrap(), bytes);

    // Mangled by hand: what is usable survives, in order, once each.
    write_json(&path, json!({ "playStatuses": ["drafting", "", 7, " padded ", "Drafting", "idea"], "showProgress": "no" }));
    let s = from_object(&read_object(&path));
    assert_eq!(s.play_statuses, vec!["drafting", "idea"]);
    assert!(s.show_progress);
}

#[test]
fn appearance_format_order_and_scene_statuses_persist_without_changing_other_settings() {
    let (_dir, path) = temp_settings();
    write_json(&path, legacy_file());
    let changed = update_at(&path, patch(json!({
        "appearance": "dark", "formatOrder": ["stage-us-modern", "dg-modern"],
        "sceneStatuses": ["sketch", "ready for reading"]
    }))).unwrap();
    assert_eq!(changed.appearance, "dark");
    assert_eq!(changed.format_order, vec!["stage-us-modern", "dg-modern"]);
    assert_eq!(changed.scene_statuses, vec!["sketch", "ready for reading"]);
    assert_eq!(from_object(&read_object(&path)), changed);
    for invalid in [json!({ "appearance": "sepia" }), json!({ "formatOrder": ["dg-modern", "dg-modern"] }), json!({ "sceneStatuses": ["draft", "DRAFT"] })] {
        assert!(update_at(&path, patch(invalid)).is_err());
        assert_eq!(from_object(&read_object(&path)), changed);
    }
}
