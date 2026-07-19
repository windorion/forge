// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Forge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "ForgeApp", targets: ["ForgeApp"]),
        .executable(name: "forge-cli", targets: ["ForgeCLI"]),
        .executable(name: "ForgeWidgets", targets: ["ForgeWidgets"])
    ],
    targets: [
        .executableTarget(
            name: "ForgeApp",
            path: "apps/macos/Sources/ForgeApp"
        ),
        .executableTarget(
            name: "ForgeCLI",
            path: "apps/cli/Sources/ForgeCLI"
        ),
        .executableTarget(
            name: "ForgeWidgets",
            path: "apps/widgets/Sources/ForgeWidgets"
        )
    ]
)
