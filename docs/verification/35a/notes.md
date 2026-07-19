# 35a · Desktop Widgets — 2026-07-19 · TIMEBOXED EXPERIMENT, DESCOPED

Outcome: the pre-declared descope fallback fired. The hand-assembled
extension was never discovered by the system after three bounded
attempts.

What was tried (all under ad-hoc signing, no paid Team ID):
1. Real WidgetKit code compiles cleanly as a SwiftPM executable target
   (apps/widgets/Sources/ForgeWidgets: TimelineProvider + S/M views —
   kept in-tree for future reuse).
2. Hand-assembled Contents/PlugIns/ForgeWidgets.appex (Info.plist with
   NSExtensionPointIdentifier com.apple.widgetkit-extension), codesigned
   ad hoc, host app re-signed → `pluginkit -m` never lists it.
3. xattr cleanup + --deep re-sign + lsregister + `pluginkit -a`
   registration → still undiscovered.

Failure modes recorded:
- `codesign --deep` on the packaged app persistently fails with
  "resource fork … detritus not allowed": the embedded Node runtime tree
  (Contents/Resources/runtime) carries resource-fork metadata that ad-hoc
  bundle signing chokes on, so a fully valid host signature is not
  achievable with the current hand-rolled packaging.
- pluginkit/WidgetKit discovery evidently requires a validly signed host
  + extension chain (Xcode-style build); a nominally correct hand-built
  .appex inside an ad-hoc-signed host is not registered.

Unblocking this needs the P6 commercial-packaging work (Developer ID
signing infrastructure, likely an Xcode project or xcodebuild-based
packaging for the extension target). Per the approved plan, this stays an
isolated, documented known gap and must not block anything else.
