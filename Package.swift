// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Forge",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "ForgeApp", targets: ["ForgeApp"])
    ],
    targets: [
        .executableTarget(
            name: "ForgeApp",
            path: "apps/macos/Sources/ForgeApp"
        )
    ]
)
