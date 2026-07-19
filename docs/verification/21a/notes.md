# 21a · App Menu — 2026-07-19
The Forge menu now carries the full handoff command set with
registry-driven shortcuts: New Task, Command Palette, Approve Plan & Run,
Pause/Resume Agent, Abort Task, Mission Control, Task Queue, Task
History, Switch Repository, Open Full Diff, Export Audit Log — model
actions call WorkspaceModel directly with real enable/disable state;
surface commands route via notifications into the coordinator. The
dropdown chrome itself is macOS-rendered (the handoff's own README notes
system-rendered surfaces cannot be restyled; the app controls only names,
shortcuts, and enabled state — which now match). Verified (with notes).
