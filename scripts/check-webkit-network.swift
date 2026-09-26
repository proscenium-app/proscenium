// SPDX-FileCopyrightText: 2026 Habiby LLC
// SPDX-License-Identifier: AGPL-3.0-or-later

import AppKit
import WebKit

// A preconnect link can open a connection past the CSP, unseen by request interception: an offscreen real WKWebView, with the release CSP and the exact
// content rules used by the app. The parent process counts TCP accepts.
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let rulesPath = CommandLine.arguments[1]
let port = CommandLine.arguments[2]
let control = CommandLine.arguments[3] == "control"
let policy = CommandLine.arguments[4]
let config = WKWebViewConfiguration()
config.websiteDataStore = .nonPersistent()

final class Scheme: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let url = task.request.url!
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "text/html", "Content-Security-Policy": policy])!
        task.didReceive(response)
        task.didReceive(Data("<!doctype html><html><head></head><body>Local page</body></html>".utf8))
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
final class Observer: NSObject, WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("""
            for (const rel of ['preconnect', 'dns-prefetch']) {
                const link = document.createElement('link');
                link.rel = rel;
                link.href = 'http://127.0.0.1:\(port)';
                document.head.append(link);
            }
            document.body.textContent = 'probe inserted';
            """) { _, error in
                if let error = error { fputs("probe failed: \(error)\n", stderr); exit(1) }
                print("probe inserted")
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { exit(0) }
            }
    }
}
let scheme = Scheme()
config.setURLSchemeHandler(scheme, forURLScheme: "tauri")
let observer = Observer()
var web: WKWebView?
func load() {
    let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 800, height: 600), configuration: config)
    view.navigationDelegate = observer
    web = view
    view.load(URLRequest(url: URL(string: "tauri://localhost/index.html")!))
}
if control {
    load()
} else {
    let rules = try String(contentsOfFile: rulesPath, encoding: .utf8)
    WKContentRuleListStore.default().compileContentRuleList(forIdentifier: "proscenium-socket-test", encodedContentRuleList: rules) { list, error in
        guard let list = list, error == nil else { fputs("rules failed: \(String(describing: error))\n", stderr); exit(1) }
        config.userContentController.add(list)
        load()
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 12) { fputs("probe timed out\n", stderr); exit(1) }
app.run()
