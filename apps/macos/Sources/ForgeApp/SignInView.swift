import AppKit
import SwiftUI

/// `15a` sign-in: welcome state plus the GitHub device-flow waiting state.
/// GitHub is the one truly wired action; email/hosted-account sign-in is a
/// visible but inert affordance until the hosted-account product decision
/// lands (recorded in the plan).
struct SignInView: View {
    @EnvironmentObject private var auth: GitHubAuth
    var close: () -> Void

    @State private var emailNote = false
    @State private var now = Date()

    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 0) {
            switch auth.phase {
            case .waiting, .requestingCode:
                deviceFlow
            default:
                welcome
            }
        }
        .frame(width: 460)
        .background(ForgeDesign.paper)
        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
        .forgeShadow(ForgeDesign.ink.opacity(0.85), x: 10, y: 10)
        .onReceive(clock) { now = $0 }
    }

    private var welcome: some View {
        VStack(spacing: 0) {
            VStack(spacing: 10) {
                ForgeLogo(size: 44)
                    .forgeShadow(ForgeDesign.ink, x: 3, y: 3)
                Text("WELCOME TO FORGE")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(2)
                    .foregroundStyle(ForgeDesign.muted)
                Text("Ship while you sleep.")
                    .font(.system(size: 24, weight: .heavy))
                    .tracking(-0.5)
                Text("Sign in with your Windorion account to sync settings, budget and task history.")
                    .font(.system(size: 12.5))
                    .foregroundStyle(ForgeDesign.muted)
                    .multilineTextAlignment(.center)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 320)
            }
            .padding(.top, 30)
            .padding(.bottom, 22)

            VStack(spacing: 10) {
                Button {
                    auth.start()
                } label: {
                    Text("⌥ CONTINUE WITH GITHUB")
                        .font(ForgeDesign.mono(11.5, weight: .bold))
                        .tracking(0.5)
                        .foregroundStyle(ForgeDesign.accent)
                        .frame(maxWidth: .infinity)
                        .frame(height: 46)
                        .background(ForgeDesign.ink)
                        .forgeShadow(ForgeDesign.ink.opacity(0.35), x: 3, y: 3)
                }
                .buttonStyle(.plain)

                Button {
                    emailNote = true
                } label: {
                    Text("CONTINUE WITH EMAIL")
                        .font(ForgeDesign.mono(11, weight: .bold))
                        .tracking(0.5)
                        .frame(maxWidth: .infinity)
                        .frame(height: 42)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)

                if case .missingClientID = auth.phase {
                    Text("▸ GitHub OAuth App is not registered yet — set forge.githubClientID once the founder creates it")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.warning)
                        .multilineTextAlignment(.center)
                } else if emailNote {
                    Text("▸ hosted Windorion accounts are not part of the local-first build yet")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.muted)
                } else if case let .connected(login) = auth.phase {
                    Text("✓ connected as \(login)")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .foregroundStyle(ForgeDesign.success)
                } else if case let .failed(reason) = auth.phase {
                    Text("✗ \(reason)")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.danger)
                        .lineLimit(2)
                } else {
                    Text("no account? one gets created on first sign-in")
                        .font(ForgeDesign.mono(9))
                        .foregroundStyle(ForgeDesign.dashedBorder)
                }
            }
            .padding(.horizontal, 40)
            .padding(.bottom, 18)

            (Text("by continuing you accept the ")
                + Text("terms").underline()
                + Text(" · ")
                + Text("privacy").underline())
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.dashedBorder)
                .padding(.bottom, 14)

            HStack {
                Text("code stays on your machine")
                Spacer()
                Text("keys live in Keychain")
            }
            .font(ForgeDesign.mono(9))
            .foregroundStyle(ForgeDesign.muted)
            .padding(.horizontal, 18)
            .padding(.vertical, 11)
            .background(Color.white)
            .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
    }

    private var deviceFlow: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                ForgeLogo(size: 16)
                Text("CONNECT GITHUB")
                    .font(ForgeDesign.mono(11, weight: .bold))
                    .tracking(0.5)
                Spacer()
                Button("← BACK") { auth.reset() }
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .buttonStyle(.plain)
            }
            .padding(.horizontal, 16)
            .frame(height: 42)
            .background(Color(red: 236 / 255, green: 236 / 255, blue: 234 / 255))
            .overlay(alignment: .bottom) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }

            VStack(spacing: 14) {
                Text("STEP 1 — ENTER THIS CODE AT")
                    .font(ForgeDesign.mono(9, weight: .bold))
                    .tracking(1)
                    .foregroundStyle(ForgeDesign.muted)
                Text(verificationHost)
                    .font(ForgeDesign.mono(12, weight: .bold))
                    .underline()

                Text(userCode)
                    .font(ForgeDesign.mono(30, weight: .heavy))
                    .tracking(6)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 12)
                    .background(Color.white)
                    .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                    .forgeShadow(ForgeDesign.ink, x: 4, y: 4)

                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(userCode, forType: .string)
                } label: {
                    Text("⧉ COPY CODE")
                        .font(ForgeDesign.mono(10, weight: .bold))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 8)
                        .background(Color.white)
                        .overlay(Rectangle().stroke(ForgeDesign.ink, lineWidth: 1.5))
                }
                .buttonStyle(.plain)

                VStack(spacing: 6) {
                    Text("STEP 2 — WE'LL DETECT IT AUTOMATICALLY")
                        .font(ForgeDesign.mono(9, weight: .bold))
                        .tracking(1)
                        .foregroundStyle(ForgeDesign.muted)
                    Text(expiresText)
                        .font(ForgeDesign.mono(10))
                        .foregroundStyle(ForgeDesign.warning)
                }
            }
            .padding(.vertical, 24)

            Text("requests 3 scopes only — read · branch · pr")
                .font(ForgeDesign.mono(9))
                .foregroundStyle(ForgeDesign.muted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 11)
                .background(Color.white)
                .overlay(alignment: .top) { Rectangle().fill(ForgeDesign.ink).frame(height: 1.5) }
        }
    }

    private var userCode: String {
        if case let .waiting(code, _, _) = auth.phase { return code }
        return "····-····"
    }

    private var verificationHost: String {
        if case let .waiting(_, url, _) = auth.phase {
            return url.replacingOccurrences(of: "https://", with: "")
        }
        return "github.com/login/device"
    }

    private var expiresText: String {
        guard case let .waiting(_, _, expiresAt) = auth.phase else { return "requesting code…" }
        let remaining = max(Int(expiresAt.timeIntervalSince(now)), 0)
        return String(format: "expires in %d:%02d", remaining / 60, remaining % 60)
    }
}
