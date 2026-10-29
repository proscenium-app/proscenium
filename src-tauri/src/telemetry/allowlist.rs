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
#[cfg(any(target_os = "macos", test))]
pub const WEBVIEW_RULES: &str = r#"[
  {"trigger":{"url-filter":".*"},"action":{"type":"block"}},
  {"trigger":{"url-filter":"^tauri:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^ipc:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^blob:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^about:"},"action":{"type":"ignore-previous-rules"}},
  {"trigger":{"url-filter":"^http://ipc[.]localhost/"},"action":{"type":"ignore-previous-rules"}}
]"#;

#[cfg(target_os = "macos")]
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

/// What the page may load on Windows: its own origin, which WebView2 serves
/// a release build's page from, and its IPC; `data:`, `blob:` and `about:`,
/// which go nowhere. WebView2's resource filter refuses every other request in
/// the webview itself (webview_fence.rs), as WebKit's content rules do on a Mac
/// (docs/engineering/cross-platform.md#PLAT-62), so the content security policy
/// is never the only fence.
#[cfg(any(windows, test))]
const WEBVIEW2_ALLOWED: &[&str] = &[
    "http://tauri.localhost/",
    "http://ipc.localhost/",
    "data:",
    "blob:",
    "about:",
];

/// Whether WebView2 may load `uri` for the page. A development build adds
/// Vite's own server, as `webview_rules` does.
#[cfg(any(windows, test))]
pub fn webview2_allows(uri: &str) -> bool {
    let development = ["http://localhost:1420/", "ws://localhost:1420/"];
    WEBVIEW2_ALLOWED
        .iter()
        .chain(development.iter().filter(|_| cfg!(dev)))
        .any(|prefix| uri.starts_with(prefix))
}

/// The page's own origin, where a release build's page is served on Windows.
/// The main window may navigate there and nowhere else (lib.rs).
pub fn is_page_origin(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" => true,
        "http" => {
            (cfg!(windows) && url.host_str() == Some("tauri.localhost"))
                || (cfg!(dev) && url.host_str() == Some("localhost"))
        }
        _ => false,
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

/// The update proof's stand-in of the update service: an origin on this Mac's
/// loopback address, given at launch to an update-proof build (the Cargo
/// feature `update-proof`, which `scripts/build-app.mjs --update-proof` turns
/// on), and admitted by that build alone. A copy built from a release's line
/// and numbered as the release before it can then update through a stand-in
/// (`wrangler dev --local`) the way a writer's copy updates through the real
/// service. A released app refuses every address but the real ones, and no
/// other build reads the variable at all
/// (docs/engineering/release-engineering.md#REL-29): the tests below run the
/// default build as a proof's copy is started, and it refuses the stand-in.
///
/// Compiled for the tests and for an update-proof build, so the rules are
/// tested by the ordinary `cargo test`; the variable is read only in
/// selftest.rs, which a build without the feature does not have.
#[cfg(any(test, feature = "update-proof"))]
pub mod proof {
    use reqwest::Url;

    /// Where the proof's script gives the origin (scripts/update-proof.mjs `--updates`).
    pub const ORIGIN_VAR: &str = "PROSCENIUM_UPDATE_PROOF_ORIGIN";

    /// What [`loopback_origin`] takes, as a refusal says it.
    #[cfg(feature = "update-proof")]
    pub const SHAPE: &str = "http://127.0.0.1:<port> or http://[::1]:<port>";

    /// The origin, when `given` is one: plain HTTP to a literal loopback
    /// address, `127.0.0.1` or `[::1]`, on a port of its own, and nothing else.
    /// No name is resolved, so no hosts file can point it elsewhere.
    pub fn loopback_origin(given: &str) -> Option<Url> {
        let url = Url::parse(given).ok()?;
        (url.scheme() == "http"
            && matches!(url.host_str(), Some("127.0.0.1" | "[::1]"))
            && url.port().is_some()
            && url.username().is_empty()
            && url.password().is_none()
            && url.path() == "/"
            && url.query().is_none()
            && url.fragment().is_none())
        .then_some(url)
    }

    /// The updater plugin's configuration, pointed at the stand-in: its one
    /// address is the service's own shape (tauri.conf.json's first) on the
    /// stand-in's origin, with no fallback beside it, over plain HTTP, which
    /// the plugin takes only when its configuration says so. The key an update
    /// is verified with stays the build's own. Returns the address.
    pub fn point_updater(
        updater: &mut serde_json::Map<String, serde_json::Value>,
        origin: &Url,
    ) -> String {
        // The origin's path is "/".
        let endpoint = format!("{origin}v1/{{{{target}}}}/{{{{arch}}}}/{{{{current_version}}}}");
        updater.insert("endpoints".into(), serde_json::json!([endpoint]));
        updater.insert(
            "dangerousInsecureTransportProtocol".into(),
            serde_json::json!(true),
        );
        endpoint
    }

    /// Whether `url` is on `origin`: the same scheme, host and port.
    pub fn on(origin: &Url, url: &Url) -> bool {
        url.origin() == origin.origin()
    }

    /// Whether the updater may ask `url` of the stand-in at `origin`: the
    /// service's own routes, under `/v1/`, with no credentials, query or
    /// fragment, as the real service is asked.
    pub fn admits(origin: &Url, url: &Url) -> bool {
        on(origin, url)
            && url.path().starts_with("/v1/")
            && url.username().is_empty()
            && url.password().is_none()
            && url.query().is_none()
            && url.fragment().is_none()
    }
}

/// Updates never use the analytics endpoint, credentials, a nonstandard port,
/// or a host constructed by suffix matching. Applies to initial URLs and hops.
/// The one exception is an update-proof build's stand-in, given at launch
/// ([`proof`]), which no other build has.
#[cfg(all(desktop, feature = "updater"))]
pub fn update_url_allowed(url: &reqwest::Url) -> bool {
    #[cfg(feature = "update-proof")]
    if crate::selftest::proof_origin().is_some_and(|origin| proof::admits(origin, url)) {
        return true;
    }
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
/// the fallback: neither route may redirect into the other. An update proof's
/// stand-in serves its own bytes too: nothing redirects from it or into it.
#[cfg(all(desktop, feature = "updater"))]
pub fn update_redirect_allowed(previous: &[reqwest::Url], next: &reqwest::Url) -> bool {
    #[cfg(feature = "update-proof")]
    if let Some(origin) = crate::selftest::proof_origin() {
        if previous
            .iter()
            .chain(std::iter::once(next))
            .any(|hop| proof::on(origin, hop))
        {
            return false;
        }
    }
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

    /// The stand-in's addresses, as an update proof's copy would ask them.
    const STAND_IN: [&str; 4] = [
        "http://127.0.0.1:8787/v1/darwin/aarch64/1.0.0",
        "http://127.0.0.1:8787/v1/beta/darwin/aarch64/1.0.0",
        "http://127.0.0.1:8787/v1/download/v1.0.1/Proscenium_1.0.1_universal.app.tar.gz",
        "http://[::1]:8787/v1/darwin/aarch64/1.0.0",
    ];

    #[test]
    fn a_proof_origin_is_a_loopback_address_and_a_port() {
        for given in [
            "http://127.0.0.1:8787",
            "http://127.0.0.1:8787/",
            "http://[::1]:8787",
        ] {
            assert!(proof::loopback_origin(given).is_some(), "{given}");
        }
        for given in [
            "",
            "127.0.0.1:8787",
            "https://127.0.0.1:8787",
            "https://updates.proscenium.ink",
            "http://updates.proscenium.ink:8787",
            "http://localhost:8787",
            "http://127.0.0.2:8787",
            "http://127.0.0.1.example.org:8787",
            "http://127.0.0.1",
            "http://127.0.0.1:80",
            "http://user@127.0.0.1:8787",
            "http://127.0.0.1:8787/v1/",
            "http://127.0.0.1:8787/?a=b",
            "http://127.0.0.1:8787/#here",
        ] {
            assert!(proof::loopback_origin(given).is_none(), "{given}");
        }
    }

    #[test]
    fn a_proof_origin_admits_the_service_routes_on_it_and_nothing_else() {
        let origin = proof::loopback_origin("http://127.0.0.1:8787").unwrap();
        let parse = |s: &str| reqwest::Url::parse(s).unwrap();
        for address in &STAND_IN[..3] {
            assert!(proof::admits(&origin, &parse(address)), "{address}");
        }
        for address in [
            STAND_IN[3],
            "http://127.0.0.1:8788/v1/darwin/aarch64/1.0.0",
            "https://127.0.0.1:8787/v1/darwin/aarch64/1.0.0",
            "http://127.0.0.1:8787/admin",
            "http://127.0.0.1:8787/v1/x?address=secret",
            "http://127.0.0.1:8787/v1/x#here",
            "http://user@127.0.0.1:8787/v1/x",
            "https://updates.proscenium.ink/v1/darwin/aarch64/1.0.0",
        ] {
            assert!(!proof::admits(&origin, &parse(address)), "{address}");
        }
    }

    /// What the updater plugin reads, pointed at a stand-in: one address, on
    /// the stand-in, plain HTTP allowed, and the build's own key.
    #[cfg(all(desktop, feature = "updater"))]
    #[test]
    fn a_stand_in_is_the_updater_s_one_address_and_the_key_stays() {
        let origin = proof::loopback_origin("http://127.0.0.1:8787").unwrap();
        let mut updater = conf("tauri.conf.json")["plugins"]["updater"]
            .as_object()
            .unwrap()
            .clone();
        let key = updater["pubkey"].clone();
        let endpoint = proof::point_updater(&mut updater, &origin);
        assert_eq!(
            endpoint,
            "http://127.0.0.1:8787/v1/{{target}}/{{arch}}/{{current_version}}"
        );
        assert_eq!(updater["pubkey"], key);
        let read: tauri_plugin_updater::Config =
            serde_json::from_value(Value::Object(updater)).unwrap();
        assert!(read.dangerous_insecure_transport_protocol);
        assert_eq!(read.endpoints.len(), 1, "no fallback beside the stand-in");
        assert!(proof::admits(&origin, &read.endpoints[0]));
    }

    /// The default build, every release among them, takes no update address at
    /// launch. The test runs itself again as an update proof's copy is started,
    /// its variables set from the first instruction, and there the stand-in is
    /// refused: no route, no download and no redirect.
    #[cfg(all(desktop, feature = "updater", not(feature = "update-proof")))]
    #[test]
    fn only_an_update_proof_build_takes_an_address_at_launch() {
        const NAME: &str =
            "telemetry::allowlist::tests::only_an_update_proof_build_takes_an_address_at_launch";
        if std::env::var_os(proof::ORIGIN_VAR).is_none() {
            let run = std::process::Command::new(std::env::current_exe().unwrap())
                .args([NAME, "--exact", "--test-threads=1", "--nocapture"])
                .env(proof::ORIGIN_VAR, "http://127.0.0.1:8787")
                .env(
                    "PROSCENIUM_UPDATE_PROOF",
                    std::env::temp_dir().join("proscenium-no-proof.log"),
                )
                .env("PROSCENIUM_UPDATE_PROOF_LINE", "Proof line")
                .output()
                .unwrap();
            let said = String::from_utf8_lossy(&run.stdout);
            assert!(run.status.success(), "{said}");
            // A filter that matched nothing would pass as well.
            assert!(
                said.contains("1 passed"),
                "the test did not run again: {said}"
            );
            return;
        }
        let parse = |s: &str| reqwest::Url::parse(s).unwrap();
        for address in STAND_IN {
            assert!(!update_url_allowed(&parse(address)), "{address}");
        }
        assert!(!update_redirect_allowed(
            &[parse(STAND_IN[0])],
            &parse(STAND_IN[2])
        ));
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

    /// WebView2's filter lets the page reach its own origin and IPC, and
    /// refuses every host, every port and every other scheme, whatever the
    /// spelling of the host around ours.
    #[test]
    fn webview2_lets_the_page_reach_its_own_origin_and_nothing_else() {
        for allowed in [
            "http://tauri.localhost/index.html",
            "http://tauri.localhost/assets/index-3f2a.js",
            "http://ipc.localhost/vault_read",
            "data:image/png;base64,AAAA",
            "blob:http://tauri.localhost/0d9f",
            "about:blank",
        ] {
            assert!(webview2_allows(allowed), "{allowed}");
        }
        for refused in [
            "https://reports.proscenium.ink/v1/events",
            "https://attacker.example/?d=SYNTHETIC%20PLAY%20LINE",
            "http://tauri.localhost.attacker.example/",
            "http://tauri.localhost:8080/",
            "https://tauri.localhost/",
            "http://localhost/",
            "ws://attacker.example/",
            "file:///C:/Users/writer/Plays/x.html",
            "ftp://tauri.localhost/",
        ] {
            assert!(!webview2_allows(refused), "{refused}");
        }
        assert_eq!(
            webview2_allows("http://localhost:1420/src/main.tsx"),
            cfg!(dev)
        );
    }
}
