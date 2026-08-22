# macOS Distribution Security

Document role: define Forge's current macOS signing inventory, threat model,
machine-checkable development and release profiles, and the exact boundary
between code-only packaging evidence and credential-dependent distribution.

## Status

The signed-build threat review is implemented, and the release-shaped unsigned
foundation is implemented as well. This does **not** mean Forge has a shipping package. The
repository can now prove what an unsigned development bundle is, what an
explicit ad-hoc bundle is, why neither can satisfy the Developer ID release
profile, and how to produce an optimized per-architecture signing input with a
standalone CLI, component manifest, SPDX SBOM, checksums, and deterministic
archive bytes. Developer ID signing, bundled Runtime selection/signing,
notarization submission, stapling, DMG assembly, a clean-machine rehearsal, a
signed update artifact, and a real WidgetKit extension remain later P6 work.

The versioned source of truth is
`distribution/macos-signing-policy.json`. The checker is
`script/check_macos_distribution.mjs`; CI runs it in
`.github/workflows/macos-distribution.yml`.

The release assembly source of truth is
`distribution/macos-release-manifest.json`. It pins version/build/minimum OS,
release configuration, supported architectures, excluded paths, archive
normalization, output layout, SBOM policy, and the Runtime supply chain.
`script/build_macos_release.mjs` assembles the signing input and
`script/check_macos_release.mjs` independently re-hashes and inspects it.

## Threats And Security Properties

The packaging boundary protects against:

- shipping a compiler-generated debug signature as if it were a release
  signature;
- adding an entitlement without recording and reviewing it;
- enabling runtime relaxations such as `get-task-allow`, JIT, unsigned
  executable memory, DYLD environment variables, or disabled library
  validation in a release;
- signing the outer app while leaving executable nested code unsigned or
  signed by another team;
- claiming that an update feed signature proves Apple notarization;
- enabling update download/install from the current unsigned placeholder
  feed;
- packaging stale smoke-test output from `runtime/dist`;
- copying Finder/resource-fork metadata that makes signing non-deterministic;
- treating the UI-test host, SwiftPM Widget experiment, or `SMAppService`
  main-app registration as production helper/extension targets;
- assuming a clean customer Mac has `node` on `PATH`.

The intended security properties are explicit classification, exact
entitlement comparison, same-team nested-code verification, an independent
update-signature check, independent notarization/stapling/Gatekeeper evidence,
and fail-closed contradictions between policy, source, and built artifact.

## Component Inventory

| Component | Current packaging shape | Entitlements / signing boundary | Release consequence |
| --- | --- | --- | --- |
| Main app | Hand-assembled `Forge.app`, bundle ID `com.windorion.forge` | No entitlement file. App Sandbox is intentionally absent because Forge is a local developer tool. Development assembly is unsigned; an explicit test step may ad-hoc sign the complete bundle. | Developer ID Application identity, hardened runtime, empty reviewed entitlement set, notarization, stapling, and Gatekeeper acceptance are required. |
| Local Runtime | TypeScript/JavaScript under `Contents/Resources/runtime`; launched through `/usr/bin/env node` | JavaScript resources are sealed by the containing app signature and are not independently signed code. The machine's Node executable is currently outside the bundle/trust chain. | Bundle a pinned Node executable or replace it with a signed native service. Any bundled executable must use the main app's team and pass nested-code validation. |
| Login item | `SMAppService.mainApp` | No separate helper executable and no helper entitlement. | Validate the installed signed main-app registration; do not invent a helper target or entitlement. |
| CLI | Standalone SwiftPM `forge-cli` executable, not inside `Forge.app` | No entitlements or shared Keychain group. | Decide whether it ships separately or becomes signed nested code before release packaging. |
| Widget | SwiftPM `ForgeWidgets` executable/source experiment, not an `.appex` | No bundle ID, App Group, or entitlement file. `/tmp` snapshot transport is development-only. | Create a real WidgetKit extension, choose an App Group deliberately, then sign app and extension with one team. Until then it cannot count as a packaged Widget. |
| Updater | Real feed fetch/parse/version comparison; placeholder feed; simulated UI states; no installer | The bundled appcast has no `sparkle:edSignature`. Parser reports that honestly. `installEnabled` is false and the model rejects download/install calls. An update signature never implies notarization. | Connect a signed artifact/install framework, verify EdDSA before install, verify the application package through Apple's distribution chain, and rehearse rollback/recovery. |
| Keychain | Generic-password items scoped by service name | No access group and no cross-target sharing. | Keep the access-group list empty unless a real signed extension/helper requires sharing and the architecture is reviewed first. |
| Local data | `.forge` SQLite/index/backups/reports under the selected repository | Owner-only runtime files, outside the application bundle. | Never copy repository data, credentials, reports, or migration backups into the distributable app/DMG. |

## Release-Shaped Unsigned Foundation

The production-shaped code-only path is deliberately separate from the debug
assembly:

- SwiftPM builds `ForgeApp` and `forge-cli` with `-c release` and strips the
  compiler-generated ad-hoc signatures from the copied executables;
- TypeScript is checked, `runtime/dist` is deleted and rebuilt, and only
  compiled JavaScript plus `runtime/package.json` enter the app;
- tests, fixtures, source maps, TypeScript sources, databases, logs, dSYMs,
  Swift modules, `node_modules`, and generated smoke files fail the release
  root check;
- `Forge.app` and standalone `forge-cli` remain separate signing boundaries;
- `manifests/components.json` records every payload file's path, mode, bytes,
  and SHA-256 plus source revision/configuration evidence;
- `manifests/forge.spdx.json` is an SPDX 2.3 document for the app, CLI,
  JavaScript Runtime, Node requirement, and JetBrains Mono resources;
- `manifests/runtime-supply-chain.json` copies the checked-in Runtime policy
  and binds it to the SHA-256 of the release manifest;
- `manifests/SHA256SUMS` covers every other file in the signing input;
- all entry timestamps are normalized to `sourceDateEpoch`, owners are encoded
  as root/wheel, and ustar plus `gzip -n -9` omits ACLs, flags, macOS metadata,
  and extended attributes. Re-archiving the same root must produce identical
  bytes.

The current pinned Runtime is Node.js `22.18.0`, selected to match the present
development/runtime line rather than an arbitrary `latest` alias. The official
macOS arm64 and x86_64 `.tar.gz` URLs and SHA-256 values, MIT license path, and
expected `bin/node` path are recorded. The verifier accepts only an explicitly
provided local archive with the exact pinned filename and hash; it performs no
network download. This slice intentionally does not extract or bundle that
executable because its Forge re-signing, hardened-runtime, and exact entitlement
decisions have not yet been reviewed. If a Node executable appears in the
release root before that decision, validation fails.

The archive is a signing input, not a customer package. It contains unsigned
code, does not include Node, has no notarization ticket or appcast signature,
and must never be labeled an installable release.

## Signing Profiles

### `development-unsigned`

`script/build_and_run.sh --build-only` builds without launching Forge or
stopping an existing process. SwiftPM normally adds a compiler ad-hoc
signature containing `get-task-allow`; assembly explicitly removes it from the
copied executable. The resulting bundle must be unsigned, non-hardened, and
entitlement-free. It is runnable development output, not distribution output.

The build also removes the previous `runtime/dist` before compiling so stale
smoke fixtures cannot ship, and clears inherited extended attributes from the
assembled tree.

### `development-ad-hoc`

An explicit `codesign --sign -` step signs the complete staged bundle. The
result must be ad-hoc, non-hardened, entitlement-free, internally valid under
`codesign --verify --deep --strict`, and still marked non-distributable. An
ad-hoc signature provides local structural evidence; it provides no identity,
notarization, Gatekeeper, or update trust.

Workspaces under Desktop/iCloud/File Provider may immediately re-add Finder
metadata. `script/stage_macos_distribution.sh` uses `ditto --norsrc
--noextattr`, refuses to overwrite its destination, and verifies that the new
staging bundle has no Finder/resource-fork attributes. Stage into a new path
outside the synced root, such as `$RUNNER_TEMP` in CI or a new private temporary
directory locally.

### `developer-id-release`

This profile is deliberately unsatisfied today. A passing artifact requires
all of the following at once:

1. bundle identifier, executable, package type, runtime server, and appcast
   match the versioned policy;
2. a `Developer ID Application:` authority and non-empty Team Identifier;
3. hardened runtime enabled;
4. the exact reviewed entitlement set (currently empty), with all listed
   relaxations forbidden;
5. a pinned bundled Runtime executable, with every nested Mach-O signed by the
   main app's Developer ID team;
6. an EdDSA signature on the update enclosure;
7. a valid stapled notarization ticket; and
8. Gatekeeper acceptance.

The checks are conjunctive. Passing `codesign --verify` alone is insufficient.
An appcast signature alone is insufficient. Notarization without a matching
update signature is insufficient. The checker reports each missing proof
separately.

## Entitlement Decisions

The current exact entitlement set is empty. This is an intentional inventory,
not an assumption that Forge needs no permissions:

- selected-repository file and command authority is enforced in Forge's
  runtime/review model, not by a fabricated entitlement;
- generic-password Keychain storage needs no shared access group while only
  the main app reads it;
- `SMAppService.mainApp` is not a separate privileged helper;
- notifications and Spotlight integration do not justify broad code-signing
  exceptions;
- the current Widget is not a package target, so no App Group may be invented
  for it;
- App Sandbox remains incompatible with the current official-site
  developer-tool distribution direction unless the product architecture is
  redesigned.

Any future entitlement must update the JSON policy, this inventory, the target
configuration, fixture expectations, and release threat analysis in the same
change. A checked-in `.entitlements` file that the policy does not name fails
the source-posture check.

## Verification

Run policy and source checks on any platform with Node:

```bash
node --test script/macos_distribution_policy_test.mjs
node script/check_macos_distribution.mjs --source
```

On macOS, build and verify a new optimized release root without launching the
application:

```bash
RELEASE_ROOT="/private/tmp/forge-release-root"
RELEASE_ARCHIVE="/private/tmp/forge-release-root.tar.gz"
node script/build_macos_release.mjs \
  --output "$RELEASE_ROOT" \
  --archive "$RELEASE_ARCHIVE"
node script/check_macos_release.mjs --root "$RELEASE_ROOT"
```

Both destinations must be new; the scripts refuse to overwrite them. To prove
archive serialization against the exact same root, create a second new archive
and compare it byte-for-byte:

```bash
node script/archive_macos_release.mjs \
  --root "$RELEASE_ROOT" \
  --output "/private/tmp/forge-release-root-second.tar.gz"
cmp "$RELEASE_ARCHIVE" "/private/tmp/forge-release-root-second.tar.gz"
```

An already-downloaded Runtime archive can be checked without extracting or
executing it:

```bash
node script/verify_pinned_runtime.mjs \
  --archive /path/to/node-v22.18.0-darwin-arm64.tar.gz \
  --architecture arm64
```

On macOS, assemble without UI side effects and verify the real unsigned
artifact:

```bash
./script/build_and_run.sh --build-only
node script/check_macos_distribution.mjs \
  --app dist/Forge.app \
  --profile development-unsigned
```

For a complete ad-hoc bundle, stage into a new non-synced path, sign that copy,
then verify it:

```bash
STAGE_DIR="$(mktemp -d /private/tmp/forge-signing-stage.XXXXXX)"
./script/stage_macos_distribution.sh dist/Forge.app "$STAGE_DIR/Forge.app"
codesign --force --deep --sign - --timestamp=none "$STAGE_DIR/Forge.app"
codesign --verify --deep --strict --verbose=2 "$STAGE_DIR/Forge.app"
node script/check_macos_distribution.mjs \
  --app "$STAGE_DIR/Forge.app" \
  --profile development-ad-hoc
```

The hosted workflow also runs `developer-id-release` against the ad-hoc bundle
as an expected failure. If that negative control ever passes, CI fails. JSON
reports are owner-readable and uploaded for 14 days; they contain signature
metadata and diagnostics, not credentials.

## Credential-Dependent Release Exit

Code-only work now prepares an optimized release root, pinned Runtime manifest,
SPDX/component evidence, and a deterministic unsigned signing-input archive.
Future code-only work may prepare safe pinned-Runtime ingestion, DMG scripts,
and dry-run validation, but it must not fabricate these external proofs:

- founder Apple Developer Team and Developer ID Application identity;
- notarization credentials and accepted submission;
- stapled ticket and clean-machine Gatekeeper assessment;
- hosted signed update artifact/appcast key management;
- live WidgetKit discovery from a signed containing application.

The signed-distribution milestone closes only when those proofs are archived
for the exact shipped artifact.
