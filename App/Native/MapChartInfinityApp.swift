import SwiftUI

@main
struct MapChartInfinityApp: App {
    var body: some Scene {
        WindowGroup {
            EditorWebView()
                .ignoresSafeArea()
        }
    }
}
