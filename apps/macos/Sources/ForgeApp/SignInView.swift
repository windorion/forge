import AppKit
import SwiftUI

/// Account connection panel used by onboarding and Settings.
/// GitHub is a real OAuth Device Flow. Hosted Windorion email accounts are
/// intentionally described as unavailable until an account service exists.
struct SignInView: View {
    @EnvironmentObject private var auth: GitHubAuth
    var close: () -> Void

    @State private var showEmailBoundary = false
    @State private var githubClientIDInput = ""
    @State private var now = Date()

    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            if showEmailBoundary {
                emailBoundary
            } else {
                switch auth.phase {
                case .missingClientID:
                    githubSetup
                case .waiting, .requestingCode:
                    deviceFlow
                case let .connected(login):
                    connected(login: login)
                default:
                    welcome
                }
            }
        }
        .frame(width: 460)
        .frame(minHeight: 470)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .forgeShadow(ForgeDesign.ink.opacity(0.85), x: 10, y: 10)
        .onAppear { githubClientIDInput = auth.clientID ?? "" }
        .onReceive(clock) { now = $0 }
    }

    private var welcome: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                ForgeLogo(size: 44)
                    .forgeShadow(ForgeDesign.ink, x: 3, y: 3)
                Text("CONNECT AN ACCOUNT")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(ForgeDesign.muted)
                Text("Forge works locally first.")
                    .font(.system(size: 24, weight: .heavy))
                    .tracking(-0.5)
                Text("Connect GitHub to authorize repository API actions. Your repository, task history and keys stay on this Mac.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 330)
            }
            .padding(.top, 30)
            .padding(.bottom, 22)

            VStack(spacing: 10) {
                Button { auth.start() } label: {
                    primaryLabel("⌥ CONTINUE WITH GITHUB")
                }
                .buttonStyle(.plain)

                Button { showEmailBoundary = true } label: {
                    outlineLabel("EMAIL SIGN-IN STATUS")
                }
                .buttonStyle(.plain)

                if case let .failed(reason) = auth.phase {
                    Text("✗ \(reason)")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.danger)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(auth.clientID == nil ? "GitHub needs a Forge OAuth Client ID; setup is available on the next screen." : "GitHub OAuth is configured on this Mac.")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.dashedBorder)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 18)

            Button("CONTINUE WITHOUT AN ACCOUNT") { close() }
                .font(ForgeDesign.mono(9.5, weight: .bold))
                .buttonStyle(.plain)
                .padding(.bottom, 16)

            securityFooter
        }
    }

    private var githubSetup: some View {
        VStack(spacing: 0) {
            panelHeader("CONFIGURE GITHUB", back: { auth.reset() })

            VStack(alignment: .leading, spacing: 14) {
                Text("ONE-TIME OAUTH APP SETUP")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                Text("GitHub requires Forge to identify its OAuth App before it can issue a device code.")
                    .font(.system(size: 13, weight: .semibold))
                Text("Create or open the Forge OAuth App in GitHub, enable Device Flow, then paste its Client ID here. A Client ID is public app configuration—not a password or client secret.")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .fixedSize(horizontal: false, vertical: true)

                Text("GITHUB OAUTH CLIENT ID")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                TextField("Ov23li…", text: $githubClientIDInput)
                    .textFieldStyle(.plain)
                    .font(ForgeDesign.mono(12))
                    .padding(.horizontal, 12)
                    .frame(height: 38)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .onSubmit(saveClientIDAndStart)

                HStack(spacing: 10) {
                    Button("OPEN GITHUB SETTINGS") {
                        openURL("https://github.com/settings/developers")
                    }
                    .buttonStyle(SignInOutlineButtonStyle())

                    Button { saveClientIDAndStart() } label: {
                        Text("SAVE & REQUEST CODE →")
                            .font(ForgeDesign.mono(10, weight: .bold))
                            .foregroundStyle(ForgeDesign.accent)
                            .frame(maxWidth: .infinity)
                            .frame(height: 36)
                            .background(ForgeDesign.ink)
                    }
                    .buttonStyle(.plain)
                    .disabled(githubClientIDInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }

                Text("Forge stores this Client ID in local preferences. The authorization token is stored separately in Keychain.")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(24)
            .frame(maxHeight: .infinity, alignment: .top)

            securityFooter
        }
    }

    private var deviceFlow: some View {
        VStack(spacing: 0) {
            panelHeader("CONNECT GITHUB", back: { auth.reset() })

            VStack(spacing: 14) {
                Text("STEP 1 — OPEN GITHUB AND ENTER THIS CODE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)

                Text(userCode)
                    .font(ForgeDesign.mono(30, weight: .heavy))
                    .tracking(6)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 12)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .forgeShadow(ForgeDesign.ink, x: 4, y: 4)

                HStack(spacing: 10) {
                    Button("↗ OPEN GITHUB") { openURL(verificationURL) }
                        .buttonStyle(SignInOutlineButtonStyle())
                        .disabled(!isWaiting)
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(userCode, forType: .string)
                    } label: {
                        Text("⧉ COPY CODE")
                    }
                    .buttonStyle(SignInOutlineButtonStyle())
                    .disabled(!isWaiting)
                }

                VStack(spacing: 6) {
                    Text("STEP 2 — FORGE DETECTS AUTHORIZATION AUTOMATICALLY")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .tracking(1)
                        .foregroundStyle(ForgeDesign.muted)
                    Text(expiresText)
                        .font(ForgeDesign.mono(10))
                        .foregroundStyle(ForgeDesign.warning)
                }
            }
            .padding(.vertical, 28)
            .frame(maxHeight: .infinity)

            Text("GitHub OAuth requests the repo scope · the token stays in Keychain")
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Color.white)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
    }

    private func connected(login: String) -> some View {
        VStack(spacing: 0) {
            panelHeader("GITHUB CONNECTED", back: nil)

            VStack(spacing: 16) {
                Text("✓")
                    .font(ForgeDesign.mono(30, weight: .heavy))
                    .frame(width: 60, height: 60)
                    .background(ForgeDesign.accent)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .forgeShadow(ForgeDesign.ink, x: 4, y: 4)
                Text("CONNECTED AS @\(login)")
                    .font(ForgeDesign.mono(14, weight: .bold))
                Text("Forge validated this token against GitHub and stored it in the macOS Keychain.")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 320)

                Button { close() } label: {
                    primaryLabel("CONTINUE TO FORGE →")
                }
                .buttonStyle(.plain)
                .frame(width: 300)

                Button("DISCONNECT GITHUB") { auth.disconnect() }
                    .font(ForgeDesign.mono(9.5, weight: .bold))
                    .foregroundStyle(ForgeDesign.danger)
                    .buttonStyle(.plain)
            }
            .frame(maxHeight: .infinity)

            securityFooter
        }
    }

    private var emailBoundary: some View {
        VStack(spacing: 0) {
            panelHeader("EMAIL SIGN-IN", back: { showEmailBoundary = false })
            VStack(alignment: .leading, spacing: 14) {
                Text("HOSTED ACCOUNT SERVICE NOT CONNECTED")
                    .font(ForgeDesign.mono(10, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.warning)
                Text("Email sign-in is not implemented in this build because Forge does not yet have a Windorion account backend, verification-email service, or sync API.")
                    .font(.system(size: 13, weight: .semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text("The desktop app remains fully usable without an account. Adding an email field here without a real verification service would create a false sign-in flow and would not sync anything.")
                    .font(ForgeDesign.mono(10))
                    .foregroundStyle(ForgeDesign.muted)
                    .fixedSize(horizontal: false, vertical: true)

                Button { close() } label: {
                    primaryLabel("CONTINUE LOCALLY →")
                }
                .buttonStyle(.plain)

                Text("Next product decision: hosted magic-link accounts, or remove email sign-in and stay local-only.")
                    .font(ForgeDesign.mono(9))
                    .foregroundStyle(ForgeDesign.dashedBorder)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(28)
            .frame(maxHeight: .infinity, alignment: .top)
            securityFooter
        }
    }

    private var securityFooter: some View {
        HStack {
            Text("code stays on your machine")
            Spacer()
            Text("tokens live in Keychain")
        }
        .font(ForgeDesign.mono(9))
        .foregroundStyle(ForgeDesign.muted)
        .padding(.horizontal, 18)
        .padding(.vertical, 11)
        .background(Color.white)
        .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private func panelHeader(_ title: String, back: (() -> Void)?) -> some View {
        HStack(spacing: 10) {
            ForgeLogo(size: 16)
            Text(title)
                .font(ForgeDesign.mono(11, weight: .bold))
                .tracking(0.5)
            Spacer()
            if let back {
                Button("← BACK", action: back)
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 42)
        .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
        .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
    }

    private func primaryLabel(_ title: String) -> some View {
        Text(title)
            .font(ForgeDesign.mono(11, weight: .bold))
            .tracking(0.5)
            .foregroundStyle(ForgeDesign.accent)
            .frame(maxWidth: .infinity)
            .frame(height: 44)
            .background(ForgeDesign.ink)
    }

    private func outlineLabel(_ title: String) -> some View {
        Text(title)
            .font(ForgeDesign.mono(10.5, weight: .bold))
            .tracking(0.5)
            .frame(maxWidth: .infinity)
            .frame(height: 42)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
    }

    private var userCode: String {
        if case let .waiting(code, _, _) = auth.phase { return code }
        return "····-····"
    }

    private var verificationURL: String {
        if case let .waiting(_, url, _) = auth.phase { return url }
        return "https://github.com/login/device"
    }

    private var isWaiting: Bool {
        if case .waiting = auth.phase { return true }
        return false
    }

    private var expiresText: String {
        guard case let .waiting(_, _, expiresAt) = auth.phase else { return "requesting code…" }
        let remaining = max(Int(expiresAt.timeIntervalSince(now)), 0)
        return String(format: "expires in %d:%02d", remaining / 60, remaining % 60)
    }

    private func saveClientIDAndStart() {
        if auth.configure(clientID: githubClientIDInput) {
            auth.start()
        }
    }

    private func openURL(_ rawValue: String) {
        guard let url = URL(string: rawValue) else { return }
        NSWorkspace.shared.open(url)
    }
}

private struct SignInOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(ForgeDesign.mono(9.5, weight: .bold))
            .padding(.horizontal, 13)
            .frame(height: 36)
            .background(Color.white)
            .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
            .offset(x: configuration.isPressed ? 1 : 0, y: configuration.isPressed ? 1 : 0)
    }
}
