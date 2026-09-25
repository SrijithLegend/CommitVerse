/**
 * Commitverse Beacon (F16). Auth: OAuth-style device flow against Commitverse → a write-only beacon token kept in
 * VS Code SecretStorage. Heartbeat every 60 s while focused + recently editing. Status bar shows your star's class.
 */
import * as vscode from 'vscode';
import { type BeaconState, type DeviceStart, payload, shouldSend } from './beacon';

const SECRET = 'commitverse.beaconToken';

export function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration('commitverse');
  const base = () => String(cfg().get('baseUrl') ?? 'https://commitverse.dev').replace(/\/$/, '');
  const state: BeaconState = {
    focused: vscode.window.state.focused,
    lastEditAt: 0,
    lastSentAt: 0,
    enabled: cfg().get('enabled') !== false,
    language: vscode.window.activeTextEditor?.document.languageId ?? null,
  };
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  bar.command = 'commitverse.openStar';
  bar.text = '$(star-empty) Commitverse';
  bar.tooltip = 'Connect your Commitverse Beacon';
  bar.show();
  ctx.subscriptions.push(bar);

  let login: string | null = ctx.globalState.get('commitverse.login') ?? null;

  const setBar = (text: string, tooltip: string) => {
    bar.text = text;
    bar.tooltip = tooltip;
  };

  const refreshStar = async () => {
    if (!login) return;
    try {
      const r = await fetch(`${base()}/api/v1/stars/${encodeURIComponent(login)}`);
      if (!r.ok) return;
      const d = (await r.json()) as { body: { subclass: string; state: string } };
      setBar(`$(star-full) ${d.body.subclass}`, `@${login} · ${d.body.subclass} ${d.body.state.replace('_', ' ')} — click to open your star`);
    } catch {}
  };

  const beat = async () => {
    const now = Date.now();
    if (!shouldSend(state, now)) return;
    const token = await ctx.secrets.get(SECRET);
    if (!token) return;
    state.lastSentAt = now;
    try {
      const r = await fetch(`${base()}/api/v1/beacon/heartbeat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload(state)),
      });
      if (r.status === 401) {
        await ctx.secrets.delete(SECRET);
        setBar('$(star-empty) Commitverse', 'Beacon token revoked — reconnect');
      }
    } catch {
      // offline: try again next minute
    }
  };

  ctx.subscriptions.push(
    vscode.window.onDidChangeWindowState((s) => {
      state.focused = s.focused;
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.scheme !== 'file' && e.document.uri.scheme !== 'untitled') return;
      state.lastEditAt = Date.now();
      state.language = e.document.languageId;
      void beat();
    }),
    vscode.window.onDidChangeActiveTextEditor((ed) => {
      if (ed) state.language = ed.document.languageId;
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('commitverse.enabled')) state.enabled = cfg().get('enabled') !== false;
    }),
  );
  const timer = setInterval(() => void beat(), 15_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) });

  ctx.subscriptions.push(
    vscode.commands.registerCommand('commitverse.signIn', async () => {
      const r = await fetch(`${base()}/api/v1/beacon/device`, { method: 'POST' });
      if (!r.ok) return void vscode.window.showErrorMessage('Commitverse: could not start sign-in');
      const d = (await r.json()) as DeviceStart;
      const open = await vscode.window.showInformationMessage(`Your Commitverse code: ${d.user_code}`, { modal: true }, 'Open browser');
      if (open) await vscode.env.openExternal(vscode.Uri.parse(d.verification_uri_complete));
      const deadline = Date.now() + d.expires_in * 1000;
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Waiting for approval in the browser…', cancellable: true }, async (_p, cancel) => {
        while (Date.now() < deadline && !cancel.isCancellationRequested) {
          await new Promise((res) => setTimeout(res, d.interval * 1000));
          const t = await fetch(`${base()}/api/v1/beacon/device/token`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ device_code: d.device_code }),
          });
          if (t.status === 428) continue;
          if (!t.ok) break;
          const { access_token } = (await t.json()) as { access_token: string };
          await ctx.secrets.store(SECRET, access_token);
          const who = await vscode.window.showInputBox({ prompt: 'Your GitHub username (for the status bar)', ignoreFocusOut: true });
          login = who?.replace(/^@/, '').trim() || null;
          await ctx.globalState.update('commitverse.login', login);
          vscode.window.showInformationMessage('Commitverse Beacon connected. Your star pulses while you code.');
          void refreshStar();
          return;
        }
      });
    }),
    vscode.commands.registerCommand('commitverse.signOut', async () => {
      await ctx.secrets.delete(SECRET);
      await ctx.globalState.update('commitverse.login', undefined);
      login = null;
      setBar('$(star-empty) Commitverse', 'Connect your Commitverse Beacon');
    }),
    vscode.commands.registerCommand('commitverse.openStar', async () => {
      if (!(await ctx.secrets.get(SECRET))) return vscode.commands.executeCommand('commitverse.signIn');
      await vscode.env.openExternal(vscode.Uri.parse(login ? `${base()}/@${login}` : base()));
    }),
    vscode.commands.registerCommand('commitverse.togglePrivacy', async () => {
      await cfg().update('enabled', !state.enabled, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Commitverse Beacon ${state.enabled ? 'paused' : 'resumed'}.`);
    }),
  );
  void refreshStar();
  const starTimer = setInterval(() => void refreshStar(), 30 * 60_000);
  ctx.subscriptions.push({ dispose: () => clearInterval(starTimer) });
}

export function deactivate() {}
