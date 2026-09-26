// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

//! Every address Proscenium reaches, and every page it hands to the writer's
//! browser (docs/app/keeping-work/privacy-and-telemetry.md#PRIV-D2).
//!
//! **This file is the only place an address may be written.**
//! `scripts/check-network.mjs` fails the build on an `http://` or `https://`
//! literal anywhere else in `src/` or `src-tauri/src/` outside comments and test
//! code, so a new destination cannot arrive somewhere a reviewer would not look.
//! The page reaches nothing at all: its content security policy
//! (`app.security.csp` in tauri.conf.json) allows the app's own files and IPC,
//! and the tests below hold it to that.
//!
//! Owned update, reports and feedback services; independent GitHub updater fallback.

/// The hosts the app itself connects to, each with what it is asked for.
pub const CONTACTED_HOSTS: &[(&str, &str)] = &[
    (
        "feedback.proscenium.ink",
        "feedback explicitly sent by the writer",
    ),
    (
        "updates.proscenium.ink",
        "the update check and signed release downloads",
    ),
    (
        "github.com",
        "the update check: latest.json, and the update it names",
    ),
    (
        "objects.githubusercontent.com",
        "where GitHub redirects a release download",
    ),
    (
        "release-assets.githubusercontent.com",
        "where GitHub redirects a release download",
    ),
    (
        "reports.proscenium.ink",
        "anonymous usage and crash reports, while they are switched on",
    ),
];

/// Aggregate counts; no per-request records.
pub const REPORTS_EVENTS: &str = "https://reports.proscenium.ink/v1/events";

/// Logical project alias; the actual Sentry project is a Worker secret.
pub const CRASH_ENVELOPE: &str = "https://reports.proscenium.ink/api/proscenium/envelope/";
/// The complete public field-and-reason table.
pub const PRIVACY: &str = "https://go.proscenium.ink/privacy";

/// The license, opened in the writer's own browser from Settings › About.
pub const LICENSE: &str = "https://go.proscenium.ink/license";

/// What a sponsorship pays for, opened in the writer's own browser from
/// Settings › About › The Program (docs/app/preferences-and-help/settings.md#SET-32).
pub const SUPPORT: &str = "https://go.proscenium.ink/support";

/// Every release, and one release's notes under `/v<version>`, opened in
/// the writer's browser from Settings › Updates. A build with no updater has
/// no release notes to open.
#[cfg_attr(not(feature = "updater"), allow(dead_code))]
pub const RELEASES: &str = "https://go.proscenium.ink/releases";

/// Private feedback inbox; no automatic metadata.
pub const FEEDBACK: &str = "https://feedback.proscenium.ink/v1/messages";

/// docs/app/keeping-work/privacy-and-telemetry.md#PRIV-5: installed in WebKit's configuration before the first page loads.
/// Also consumed verbatim by scripts/check-webkit-network.ts's socket test.
pub const WEBVIEW_RULES: &str = r#"[
  {"trigger":{"url-filter":".*"},"action":{"type":"block"}},
  {"trigger":{"url-filter":"^tauri:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^ipc:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^blob:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^about:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^http://ipc[.]localhost/"},"action":{"type":"ignore-previous-rules"}}
]"#;

pub fn webview_rules() -> String {
    if cfg!(dev) {
        // The literal above, which the tests below parse: it cannot fail here.
        let mut rules: Vec<serde_json::Value> =
            serde_json::from_str(WEBVIEW_RULES).expect("embedded rules are valid JSON");
        for filter in ["^http://localhost:1420/", "^ws://localhost:1420/"] {
            rules.push(serde_json::json!({"trigger":{"url-filter":filter},"action":{"type":"ignore-previous-rules"}}));
        }
        // Values serde_json made, serialized back: it cannot fail.
        serde_json::to_string(&rules).expect("rules contain only JSON values")
    } else {
        WEBVIEW_RULES.to_string()
    }
}

/// The host of an `http(s)://host/…` address.
pub fn host_of(url: &str) -> Option<&str> {
    let rest = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))?;
    let host = rest.split(['/', '?', '#']).next()?;
    (!host.is_empty()).then_some(host)
}

/// Whether the app may connect to `url`: https, to a host on the list.
pub fn may_contact(url: &str) -> bool {
    url.starts_with("https://")
        && host_of(url).is_some_and(|host| CONTACTED_HOSTS.iter().any(|(h, _)| *h == host))
}

/// Updates never use the analytics endpoint, credentials, a nonstandard port,
/// or a host constructed by suffix matching. Applies to initial URLs and hops.
#[cfg(all(desktop, feature = "updater"))]
pub fn update_url_allowed(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && match url.host_str() {
            Some("updates.proscenium.ink") => {
                url.path().starts_with("/v1/") && url.query().is_none()
            }
            Some("github.com") => url
                .path()
                .starts_with("/proscenium-app/proscenium/releases/"),
            Some("objects.githubusercontent.com" | "release-assets.githubusercontent.com") => true,
            _ => false,
        }
}

/// Our Worker serves bytes itself. GitHub's asset redirects belong only to
/// the fallback: neither route may redirect into the other.
#[cfg(all(desktop, feature = "updater"))]
pub fn update_redirect_allowed(previous: &[reqwest::Url], next: &reqwest::Url) -> bool {
    previous
        .first()
        .is_some_and(|first| first.host_str() != Some("updates.proscenium.ink"))
        && next.host_str() != Some("updates.proscenium.ink")
        && update_url_allowed(next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    fn hosts() -> Vec<&'static str> {
        CONTACTED_HOSTS.iter().map(|(h, _)| *h).collect()
    }

    #[test]
    fn the_app_contacts_exactly_these_hosts() {
        assert_eq!(
            hosts(),
            [
                "feedback.proscenium.ink",
                "updates.proscenium.ink",
                "github.com",
                "objects.githubusercontent.com",
                "release-assets.githubusercontent.com",
                "reports.proscenium.ink",
            ]
        );
        assert!(may_contact(REPORTS_EVENTS));
        assert!(
            !may_contact("http://reports.proscenium.ink/v1/events"),
            "never in the clear"
        );
        assert!(!may_contact("https://unlisted.example.org/v1/events"));
        assert!(!may_contact("https://reports.proscenium.ink.example.net/"));
    }

    #[cfg(all(desktop, feature = "updater"))]
    #[test]
    fn update_addresses_are_exact_https_hosts_without_credentials() {
        for address in [
            "https://updates.proscenium.ink/v1/darwin/aarch64/0.9.0",
            "https://github.com/proscenium-app/proscenium/releases/latest/download/latest.json",
            "https://objects.githubusercontent.com/asset",
            "https://release-assets.githubusercontent.com/asset",
        ] {
            assert!(update_url_allowed(&reqwest::Url::parse(address).unwrap()));
        }
        for address in [
            "http://github.com/asset",
            "https://github.com.example.org/asset",
            "https://github.com:444/asset",
            "https://user@github.com/asset",
            REPORTS_EVENTS,
            "https://127.0.0.1/asset",
            "https://github.com/another/repository/releases/file",
            "https://updates.proscenium.ink/admin",
            "https://updates.proscenium.ink/v1/x?address=secret",
        ] {
            assert!(
                !update_url_allowed(&reqwest::Url::parse(address).unwrap()),
                "{address}"
            );
        }
    }

    #[cfg(all(desktop, feature = "updater"))]
    #[test]
    fn github_redirects_belong_only_to_the_fallback() {
        let parse = |s| reqwest::Url::parse(s).unwrap();
        let own = parse("https://updates.proscenium.ink/v1/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz");
        let github = parse("https://github.com/proscenium-app/proscenium/releases/download/v0.9.1/Proscenium_0.9.1_universal.app.tar.gz");
        let asset = parse("https://release-assets.githubusercontent.com/asset");
        assert!(!update_redirect_allowed(std::slice::from_ref(&own), &asset));
        assert!(!update_redirect_allowed(std::slice::from_ref(&own), &own));
        assert!(!update_redirect_allowed(
            std::slice::from_ref(&github),
            &own
        ));
        assert!(update_redirect_allowed(&[github], &asset));
    }

    #[test]
    fn the_webview_rules_are_json() {
        let rules: Vec<Value> = serde_json::from_str(WEBVIEW_RULES).unwrap();
        assert!(!rules.is_empty());
    }

    #[test]
    fn the_pages_opened_in_the_browser_are_https() {
        for url in [
            LICENSE,
            SUPPORT,
            RELEASES,
            PRIVACY,
            FEEDBACK,
            CRASH_ENVELOPE,
        ] {
            assert!(
                url.starts_with("https://") && host_of(url).is_some(),
                "{url}"
            );
        }
    }

    fn conf(name: &str) -> Value {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(name);
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap()
    }

    #[test]
    fn the_updater_asks_only_a_listed_host() {
        for name in ["tauri.conf.json", "tauri.release.conf.json"] {
            let endpoints = conf(name)["plugins"]["updater"]["endpoints"].clone();
            for endpoint in endpoints.as_array().into_iter().flatten() {
                let url = endpoint.as_str().unwrap();
                assert!(
                    may_contact(url),
                    "{name}: the updater endpoint {url} is not on the list"
                );
            }
        }
        assert!(
            conf("tauri.conf.json")["plugins"]["updater"]["endpoints"]
                .as_array()
                .is_some_and(|e| !e.is_empty()),
            "the updater has an endpoint to check"
        );
    }

    /// The policy as the webview receives it: `directive → sources`.
    fn csp(key: &str) -> Vec<(String, Vec<String>)> {
        let security = &conf("tauri.conf.json")["app"]["security"];
        let policy = security[key]
            .as_object()
            .unwrap_or_else(|| panic!("security.{key} is a directive map"));
        policy
            .iter()
            .map(|(directive, sources)| {
                let sources = sources
                    .as_str()
                    .unwrap()
                    .split_whitespace()
                    .map(str::to_string)
                    .collect();
                (directive.clone(), sources)
            })
            .collect()
    }

    #[test]
    fn the_page_may_reach_nothing_but_the_app() {
        let policy = csp("csp");
        let get = |directive: &str| {
            policy
                .iter()
                .find(|(d, _)| d == directive)
                .map(|(_, s)| s.clone())
                .unwrap_or_else(|| panic!("the policy sets {directive}"))
        };
        assert_eq!(get("default-src"), ["'self'"]);
        assert_eq!(
            get("connect-src"),
            ["'self'", "ipc:", "http://ipc.localhost"]
        );
        assert_eq!(get("script-src"), ["'self'"]);
        for directive in ["object-src", "frame-src", "base-uri", "form-action"] {
            assert_eq!(get(directive), ["'none'"], "{directive}");
        }
        // No source anywhere may name another host, and no directive may open
        // the page up with a wildcard or a bare scheme.
        for (directive, sources) in &policy {
            for source in sources {
                let remote = source.contains("://") && source != "http://ipc.localhost";
                let wide =
                    source == "*" || source == "https:" || source == "http:" || source == "ws:";
                assert!(!remote && !wide, "{directive} allows {source}");
                assert!(source != "'unsafe-eval'", "{directive} allows eval");
            }
        }
    }

    #[test]
    fn development_allowances_stay_in_the_development_policy() {
        let release: Vec<String> = csp("csp").into_iter().flat_map(|(_, s)| s).collect();
        assert!(
            !release.iter().any(|s| s.contains("localhost:")),
            "the release policy names a dev server"
        );
        assert!(!csp("devCsp").is_empty(), "a development policy exists");
    }
}
