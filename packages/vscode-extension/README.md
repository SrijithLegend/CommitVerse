# Commitverse Beacon

Your Commitverse star pulses cyan while you code.

- **Connect:** run `Commitverse: Connect Beacon`, approve the code in your browser. The token can only send heartbeats and lives in VS Code's secret storage.
- **Privacy:** the only data sent is the VS Code language id of the file you're editing (e.g. `typescript`) — never file names, paths, repository names or code. Heartbeats go at most once a minute, only while the window is focused and you edited something in the last two minutes. Pause any time with `Commitverse: Pause/resume Beacon` or turn off *Hide my beacon* in Commitverse settings.
