# 9a · Notifications — 2026-07-19

Built from Missing: ForgeNotifications supplies the four handoff content
kinds to UNUserNotificationCenter — PR ready (Review/Later actions),
needs-decision (Answer/Later), self-fix info (ALL mode only), budget cap —
with contextual authorization on the first real event (never at launch),
the 22a "Notify me about" ALL/NEEDS ME/NONE gate, completion-sound
setting, and banner presentation while frontmost. Transitions are emitted
from real task-state diffs on every refresh (Completed→PR ready, new
WaitForHumanReview→decision, new rerun evidence→self-fix). Taps and
action buttons deep-link back into the task (AppDelegate delegate).
Delivery verified by firing a real notification through the system center
via the testNotification debug spec; the banner itself is macOS-rendered
(the handoff notes apps only supply icon/title/body/buttons) — a banner
screenshot awaits the human pass. Verified (with notes).
