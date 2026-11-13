import Foundation
import Security
import SwiftUI
import UIKit
import WebKit

struct EditorWebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.userContentController.add(context.coordinator, name: "native")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 17 / 255, green: 26 / 255, blue: 28 / 255, alpha: 1)
        context.coordinator.webView = webView

        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            webView.loadHTMLString("<h1>無法載入地圖編輯器</h1><p>請確認 App 內含 Web 資源。</p>", baseURL: nil)
            return webView
        }
        webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "native")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private let keychainService = "org.mapchart.infinity.ai"

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "native", message.frameInfo.isMainFrame,
                  message.webView === webView,
                  let body = message.body as? [String: Any],
                  let id = body["id"] as? Int,
                  let method = body["method"] as? String,
                  let arguments = body["args"] as? [String: Any] else { return }

            Task { @MainActor in
                do {
                    let result = try await handle(method: method, arguments: arguments)
                    reply(id: id, result: result, error: nil)
                } catch {
                    reply(id: id, result: nil, error: error.localizedDescription)
                }
            }
        }

        @MainActor
        private func handle(method: String, arguments: [String: Any]) async throws -> Any {
            switch method {
            case "saveKey":
                let endpoint = try endpointURL(arguments["endpoint"])
                guard let key = arguments["key"] as? String, !key.isEmpty else {
                    throw BridgeError.message("請輸入 API 金鑰")
                }
                try saveKey(key, account: endpoint.absoluteString)
                return true
            case "ai":
                let endpoint = try endpointURL(arguments["endpoint"])
                guard let payload = arguments["payload"] as? [String: Any],
                      JSONSerialization.isValidJSONObject(payload) else {
                    throw BridgeError.message("AI 請求格式無效")
                }
                let key = try loadKey(account: endpoint.absoluteString)
                var request = URLRequest(url: endpoint)
                request.httpMethod = "POST"
                request.timeoutInterval = 110
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
                request.httpBody = try JSONSerialization.data(withJSONObject: payload)
                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw BridgeError.message("AI 服務沒有回傳 HTTP 回應")
                }
                guard (200...299).contains(http.statusCode) else {
                    throw BridgeError.message("AI 服務回傳 HTTP \(http.statusCode)")
                }
                return try JSONSerialization.jsonObject(with: data)
            case "share":
                guard let name = arguments["name"] as? String,
                      let encoded = arguments["content"] as? String,
                      let data = Data(base64Encoded: encoded) else {
                    throw BridgeError.message("匯出資料無效")
                }
                let fileName = URL(fileURLWithPath: name).lastPathComponent
                guard !fileName.isEmpty, fileName != ".", fileName != ".." else {
                    throw BridgeError.message("檔案名稱無效")
                }
                let directory = FileManager.default.temporaryDirectory
                    .appendingPathComponent("MapChartExports", isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent(fileName)
                try data.write(to: url, options: .atomic)
                guard let presenter = topViewController() else {
                    throw BridgeError.message("找不到匯出畫面")
                }
                let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
                presenter.present(picker, animated: true)
                return true
            case "openExternal":
                guard let raw = arguments["url"] as? String,
                      let url = URL(string: raw), url.scheme == "https",
                      url.host == "www.symbol.army" else {
                    throw BridgeError.message("無法開啟此網址")
                }
                await UIApplication.shared.open(url)
                return true
            default:
                throw BridgeError.message("不支援的操作")
            }
        }

        private func endpointURL(_ value: Any?) throws -> URL {
            guard let raw = value as? String, let components = URLComponents(string: raw),
                  components.scheme?.lowercased() == "https", components.host != nil,
                  components.user == nil, components.password == nil,
                  components.fragment == nil, let url = components.url else {
                throw BridgeError.message("AI 接口需要有效的 HTTPS 網址")
            }
            return url
        }

        private func saveKey(_ key: String, account: String) throws {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                        kSecAttrService as String: keychainService,
                                        kSecAttrAccount as String: account]
            let data = Data(key.utf8)
            let update: [String: Any] = [kSecValueData as String: data,
                                         kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
            if status == errSecItemNotFound {
                var newItem = query
                update.forEach { newItem[$0.key] = $0.value }
                let added = SecItemAdd(newItem as CFDictionary, nil)
                guard added == errSecSuccess else { throw BridgeError.keychain(added) }
            } else if status != errSecSuccess {
                throw BridgeError.keychain(status)
            }
        }

        private func loadKey(account: String) throws -> String {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                        kSecAttrService as String: keychainService,
                                        kSecAttrAccount as String: account,
                                        kSecReturnData as String: true,
                                        kSecMatchLimit as String: kSecMatchLimitOne]
            var result: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &result)
            guard status == errSecSuccess, let data = result as? Data,
                  let key = String(data: data, encoding: .utf8) else {
                throw BridgeError.message("找不到此接口的 API 金鑰，請至設定輸入")
            }
            return key
        }

        @MainActor
        private func reply(id: Int, result: Any?, error: String?) {
            let arguments: [Any] = [id, result ?? NSNull(), (error as Any?) ?? NSNull()]
            guard JSONSerialization.isValidJSONObject(arguments),
                  let data = try? JSONSerialization.data(withJSONObject: arguments),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.nativeReceive.apply(null, \(json));")
        }

        private func topViewController() -> UIViewController? {
            var current = webView?.window?.rootViewController
            while let presented = current?.presentedViewController { current = presented }
            return current
        }

        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            guard webView === self.webView, frame.isMainFrame, let presenter = topViewController() else {
                completionHandler()
                return
            }
            let dialog = UIAlertController(title: "MapChart ∞", message: message, preferredStyle: .alert)
            dialog.addAction(UIAlertAction(title: "確定", style: .default) { _ in completionHandler() })
            presenter.present(dialog, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            guard webView === self.webView, frame.isMainFrame, let presenter = topViewController() else {
                completionHandler(false)
                return
            }
            let dialog = UIAlertController(title: "MapChart ∞", message: message, preferredStyle: .alert)
            dialog.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
            dialog.addAction(UIAlertAction(title: "確定", style: .default) { _ in completionHandler(true) })
            presenter.present(dialog, animated: true)
        }

        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            guard webView === self.webView, frame.isMainFrame, let presenter = topViewController() else {
                completionHandler(nil)
                return
            }
            let dialog = UIAlertController(title: "MapChart ∞", message: prompt, preferredStyle: .alert)
            dialog.addTextField { $0.text = defaultText }
            dialog.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
            dialog.addAction(UIAlertAction(title: "確定", style: .default) { [weak dialog] _ in
                completionHandler(dialog?.textFields?.first?.text)
            })
            presenter.present(dialog, animated: true)
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            decisionHandler(url.isFileURL || url.absoluteString == "about:blank" ? .allow : .cancel)
        }
    }
}

private enum BridgeError: LocalizedError {
    case message(String)
    case keychain(OSStatus)

    var errorDescription: String? {
        switch self {
        case .message(let message): return message
        case .keychain(let status): return "無法保存金鑰（\(status)）"
        }
    }
}
