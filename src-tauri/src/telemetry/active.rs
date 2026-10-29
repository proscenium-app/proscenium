// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Active copies (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-86).
//!
//! A copy counts itself once a UTC day, once an ISO week (Monday to Sunday,
//! UTC) and once a calendar month with one `copy_active`, and says how long
//! ago it first ran, in three bands. Summing a period's events over that
//! period's days is the number of copies active in it, with nothing sent that
//! could tell two copies apart: the copy, not the service, remembers what it
//! has counted.
//!
//! What it remembers is [`Counted`], in app data and never in the Plays
//! folder: the day it first ran, and the last day, week and month it counted
//! itself. None of it is sent. A period is written down only once a batch
//! carrying its event has been answered, so a copy that was offline still
//! counts once it reaches the service — inside the same period. One that
//! reaches it only after the period has ended sends nothing for it: the
//! service counts an event on the day it arrives, and a late one would count
//! the copy twice in the next period.

use std::path::Path;

use chrono::{DateTime, Datelike, NaiveDate, Utc};
use serde::{Deserialize, Serialize};

/// In app data: what this copy has counted of itself.
pub const FILE: &str = "active.json";

/// Which period an event counts the copy in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Period {
    Day,
    Week,
    Month,
}

impl Period {
    pub const ALL: [Period; 3] = [Period::Day, Period::Week, Period::Month];

    pub fn as_str(self) -> &'static str {
        match self {
            Period::Day => "day",
            Period::Week => "week",
            Period::Month => "month",
        }
    }

    /// The period of this kind that `at` falls in, as the copy writes it
    /// down: `2026-10-16`, `2026-W42`, `2026-10`. All in UTC, as the
    /// service's days are.
    pub fn of(self, at: DateTime<Utc>) -> String {
        let day = at.date_naive();
        match self {
            Period::Day => day.format("%Y-%m-%d").to_string(),
            Period::Week => {
                let week = day.iso_week();
                format!("{}-W{:02}", week.year(), week.week())
            }
            Period::Month => day.format("%Y-%m").to_string(),
        }
    }
}

/// How long ago the copy first ran, counting that day as the first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Installed {
    /// Days 1 to 7: the day it first ran and the six after.
    New,
    /// Days 8 to 30.
    Recent,
    /// Day 31 on.
    Earlier,
}

impl Installed {
    /// A first day after today (a clock set back) is `new`.
    pub fn of(first: NaiveDate, today: NaiveDate) -> Self {
        match (today - first).num_days() {
            ..=6 => Installed::New,
            7..=29 => Installed::Recent,
            _ => Installed::Earlier,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Installed::New => "new",
            Installed::Recent => "recent",
            Installed::Earlier => "earlier",
        }
    }
}

/// What the copy remembers of itself. Never sent.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counted {
    /// The UTC day it first ran, `YYYY-MM-DD`.
    pub first: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub week: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub month: Option<String>,
}

impl Counted {
    /// What the file says; a missing or unreadable file, or one without a
    /// first day, begins again from `first_ran`, and is written down at once
    /// so the copy's age stays put from launch to launch.
    pub fn load(file: &Path, first_ran: NaiveDate) -> Self {
        let read = std::fs::read(file)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Counted>(&bytes).ok())
            .filter(|c| first_day(&c.first).is_some());
        read.unwrap_or_else(|| {
            let fresh = Counted {
                first: first_ran.format("%Y-%m-%d").to_string(),
                ..Counted::default()
            };
            fresh.save(file);
            fresh
        })
    }

    pub fn save(&self, file: &Path) {
        if let (Some(dir), Ok(bytes)) = (file.parent(), serde_json::to_vec(self)) {
            let _ = std::fs::create_dir_all(dir);
            let _ = crate::store::write_atomic(file, &bytes);
        }
    }

    fn slot(&mut self, period: Period) -> &mut Option<String> {
        match period {
            Period::Day => &mut self.day,
            Period::Week => &mut self.week,
            Period::Month => &mut self.month,
        }
    }

    /// The periods `now` falls in that the copy has not counted itself in yet.
    pub fn due(&mut self, now: DateTime<Utc>) -> Vec<Period> {
        Period::ALL
            .into_iter()
            .filter(|p| self.slot(*p).as_deref() != Some(p.of(now).as_str()))
            .collect()
    }

    /// The band the copy is in on `now`'s day.
    pub fn installed(&self, now: DateTime<Utc>) -> Installed {
        let first = first_day(&self.first).unwrap_or_else(|| now.date_naive());
        Installed::of(first, now.date_naive())
    }

    /// The copy has been counted in the period `at` falls in. A later period
    /// already written down stays.
    pub fn mark(&mut self, period: Period, at: DateTime<Utc>) {
        let key = period.of(at);
        let slot = self.slot(period);
        // The keys sort as their periods do: an ISO week's year is the year
        // its Thursday falls in, so `2026-W01` may begin in 2025, and still
        // comes after `2025-W52`.
        if slot.as_deref().map_or(true, |before| before < key.as_str()) {
            *slot = Some(key);
        }
    }
}

fn first_day(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").ok()
}

/// The day a copy that ran before it remembered anything first ran: the day
/// its app-data folder was made, which its first launch does. A system that
/// cannot say counts it from today.
pub fn first_ran(data_dir: &Path, now: DateTime<Utc>) -> NaiveDate {
    std::fs::metadata(data_dir)
        .and_then(|m| m.created())
        .ok()
        .map(|made| DateTime::<Utc>::from(made).date_naive())
        .filter(|made| *made <= now.date_naive())
        .unwrap_or_else(|| now.date_naive())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().to_utc()
    }

    fn day(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn periods_are_utc_days_iso_weeks_and_months() {
        let t = at("2026-10-16T23:59:59Z");
        assert_eq!(Period::Day.of(t), "2026-10-16");
        assert_eq!(Period::Week.of(t), "2026-W42");
        assert_eq!(Period::Month.of(t), "2026-10");
        // UTC, whatever the copy's own zone: 01:00 in Paris is still the day before.
        assert_eq!(
            Period::Day.of(at("2026-10-17T01:00:00+02:00")),
            "2026-10-16"
        );
        // A week begins on Monday: Sunday 2026-10-18 and Monday 2026-10-19 differ.
        assert_eq!(Period::Week.of(at("2026-10-18T12:00:00Z")), "2026-W42");
        assert_eq!(Period::Week.of(at("2026-10-19T00:00:00Z")), "2026-W43");
        // An ISO week's year: 2027-01-01 is a Friday in 2026's last week.
        assert_eq!(Period::Week.of(at("2027-01-01T00:00:00Z")), "2026-W53");
        assert_eq!(Period::Week.of(at("2025-12-29T00:00:00Z")), "2026-W01");
    }

    #[test]
    fn installed_bands_count_the_first_day_as_day_one() {
        let first = day("2026-10-01");
        let band = |d: &str| Installed::of(first, day(d)).as_str();
        assert_eq!(band("2026-10-01"), "new");
        assert_eq!(band("2026-10-07"), "new", "day 7");
        assert_eq!(band("2026-10-08"), "recent", "day 8");
        assert_eq!(band("2026-10-30"), "recent", "day 30");
        assert_eq!(band("2026-10-31"), "earlier", "day 31");
        assert_eq!(band("2026-09-01"), "new", "a clock set back");
    }

    #[test]
    fn a_copy_is_due_once_in_each_period_and_only_once_marked() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("data").join(FILE);
        let mut c = Counted::load(&file, day("2026-10-01"));
        // The first day is written down at once, and nothing else yet.
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            r#"{"first":"2026-10-01"}"#
        );
        let monday = at("2026-10-12T09:00:00Z");
        assert_eq!(c.due(monday), Period::ALL);
        // Not marked until answered: still due.
        assert_eq!(c.due(monday), Period::ALL);
        for p in Period::ALL {
            c.mark(p, monday);
        }
        assert!(c.due(at("2026-10-12T23:59:59Z")).is_empty());
        // Past midnight: a new day, the same week and month.
        assert_eq!(c.due(at("2026-10-13T00:00:00Z")), [Period::Day]);
        // The next Monday: a day and a week.
        assert_eq!(
            c.due(at("2026-10-19T00:00:01Z")),
            [Period::Day, Period::Week]
        );
        // November 2nd, a Monday: all three.
        assert_eq!(c.due(at("2026-11-02T08:00:00Z")), Period::ALL);
        assert_eq!(c.installed(monday), Installed::Recent);

        // Written down, it holds across launches; the first day never moves.
        c.save(&file);
        let mut again = Counted::load(&file, day("2026-10-12"));
        assert_eq!(again, c);
        assert!(again.due(monday).is_empty());
    }

    #[test]
    fn a_late_answer_never_moves_a_period_back() {
        let mut c = Counted {
            first: "2026-01-01".into(),
            ..Counted::default()
        };
        c.mark(Period::Week, at("2026-01-05T00:00:00Z"));
        c.mark(Period::Week, at("2025-12-31T00:00:00Z"));
        assert_eq!(c.week.as_deref(), Some("2026-W02"));
        c.mark(Period::Week, at("2027-01-04T00:00:00Z"));
        assert_eq!(c.week.as_deref(), Some("2027-W01"));
    }

    #[test]
    fn an_unreadable_file_begins_again_from_the_first_run() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join(FILE);
        for garbage in [
            "",
            "[]",
            r#"{"first":"yesterday"}"#,
            r#"{"day":"2026-10-16"}"#,
        ] {
            std::fs::write(&file, garbage).unwrap();
            let c = Counted::load(&file, day("2026-09-01"));
            assert_eq!(c.first, "2026-09-01", "{garbage:?}");
            assert_eq!(c.day, None);
        }
    }

    #[test]
    fn a_copy_from_before_counts_from_its_app_data_folder() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        // Made just now: today.
        assert_eq!(first_ran(dir.path(), now), now.date_naive());
        // A folder that is not there: today.
        assert_eq!(
            first_ran(&dir.path().join("missing"), now),
            now.date_naive()
        );
        // A clock behind the folder's birth: never a first day in the future.
        let past = now - chrono::TimeDelta::days(400);
        assert_eq!(first_ran(dir.path(), past), past.date_naive());
    }
}
