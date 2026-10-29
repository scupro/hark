// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "Hark",
    platforms: [.macOS(.v14), .iOS(.v17)],
    products: [
        .library(name: "HarkKit", targets: ["HarkKit"]),
        .executable(name: "HarkMac", targets: ["HarkMac"]),
    ],
    targets: [
        .target(
            name: "HarkKit",
            path: "Sources/HarkKit"
        ),
        .executableTarget(
            name: "HarkMac",
            dependencies: ["HarkKit"],
            path: "Sources/HarkMac"
        ),
        .testTarget(
            name: "HarkKitTests",
            dependencies: ["HarkKit"],
            path: "Tests/HarkKitTests",
            resources: [.copy("Fixtures")]
        ),
    ]
    // swift-tools-version 6.0 ⇒ every target builds in the Swift 6 language mode (strict concurrency).
    // Don't add an explicit `swiftLanguageModes: [.v6]`: with the Command Line Tools' Swift Build backend it stops
    // the Swift Testing macro plugin from loading.
)
