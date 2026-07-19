// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Forge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "ForgeApp", targets: ["ForgeApp"]),
        .executable(name: "forge-cli", targets: ["ForgeCLI"])
    ],
    targets: [
        .executableTarget(
            name: "ForgeApp",
            path: "apps/macos/Sources/ForgeApp"
        ),
        .executableTarget(
            name: "ForgeCLI",
            path: "apps/cli/Sources/ForgeCLI"
        )
    ]
)
