/**
 * Aside (aside.com) AI 브라우저 연동 드라이버
 *
 * Aside CLI(`aside.exe`)를 통해 사용자가 Aside 브라우저에 이미 로그인해 둔 세션 그대로
 * 블로그 에디터를 조작합니다.
 *
 *  1단계: `aside repl`  — Playwright 스타일 결정론적 스크립트 (네이버 · 티스토리)
 *  2단계: `aside exec`  — 자연어 브라우저 에이전트 (1단계 실패 시 / 기타 플랫폼)
 *
 * 본문 HTML은 명령줄 길이 제한(32K)을 피하기 위해 인자로 넘기지 않고,
 *  - OS 클립보드(Ctrl+V)와
 *  - 127.0.0.1 일회용 로컬 서버(토큰 보호, 작업 종료 즉시 닫힘)
 * 두 경로로 전달합니다.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import { spawn, execFile, execFileSync } from 'child_process';
import { clipboard } from 'electron';
import { BlogPost, BlogProfile } from './types';
import { registerCancellableChild, isTaskCancelled, decryptBlogPassword } from './webAiDriver';

export interface AsideStatus {
  installed: boolean;
  path?: string;
  version?: string;
}

let cachedAsidePath: string | null | undefined;

export function findAsideExecutable(): string | null {
  if (cachedAsidePath !== undefined && (cachedAsidePath === null || fs.existsSync(cachedAsidePath))) {
    return cachedAsidePath;
  }
  const candidates = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Aside', 'CLI', 'current', 'aside.exe') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Aside', 'aside.exe') : '',
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Aside', 'CLI', 'current', 'aside.exe') : '',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      cachedAsidePath = c;
      return c;
    }
  }
  // PATH lookup
  const pathDirs = (process.env.PATH || process.env.Path || '').split(path.delimiter);
  for (const dir of pathDirs) {
    const p = path.join(dir, 'aside.exe');
    if (dir && fs.existsSync(p)) {
      cachedAsidePath = p;
      return p;
    }
  }
  cachedAsidePath = null;
  return null;
}

export function findAsideGuiExecutable(): string | null {
  const candidates = [
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Aside', 'Application', 'Aside.exe') : '',
    'C:\\Program Files\\Aside\\Application\\Aside.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Aside', 'Application', 'Aside.exe') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Aside', 'Aside.exe') : '',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/** Serializes all Aside browser operations so two tasks never spawn competing Aside windows */
let asideOperationChain: Promise<unknown> = Promise.resolve();

function withAsideLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = asideOperationChain.then(fn, fn);
  asideOperationChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/** Brings an already-open Aside window to the front on Windows using EnumWindows without spawning a duplicate window */
export function focusAsideWindow(): void {
  if (process.platform !== 'win32') return;
  const ps = `
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class AsideWinFocus {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  public static IntPtr FindMainWindow(int[] pidArray) {
    var pids = new HashSet<int>(pidArray);
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      if (!IsWindowVisible(hWnd)) return true;
      if (GetWindow(hWnd, 4) != IntPtr.Zero) return true;
      if (GetWindowTextLength(hWnd) <= 0) return true;
      uint pid = 0;
      GetWindowThreadProcessId(hWnd, out pid);
      if (pids.Contains((int)pid)) { found = hWnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
$procs = Get-Process -Name "Aside" -ErrorAction SilentlyContinue
if ($procs) {
  $hWnd = ($procs | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1 -ExpandProperty MainWindowHandle)
  if (-not $hWnd -or $hWnd -eq 0) {
    $hWnd = [AsideWinFocus]::FindMainWindow([int[]]($procs | Select-Object -ExpandProperty Id))
  }
  if ($hWnd -and $hWnd -ne [IntPtr]::Zero) {
    [AsideWinFocus]::ShowWindowAsync($hWnd, 9) | Out-Null
    [AsideWinFocus]::SetForegroundWindow($hWnd) | Out-Null
  }
}
`.trim();
  try {
    execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { windowsHide: true }, () => {});
  } catch {
    // ignore
  }
}

let lastAsideGuiSpawnAt = 0;

/**
 * Ensures the single Aside Browser GUI window is open (or focuses the existing window without spawning a second one).
 * Checks the OS process list synchronously via tasklist.exe first so Chromium never opens a duplicate window.
 */
export function openUrlInAsideGui(_url: string = ''): boolean {
  if (Date.now() - lastAsideGuiSpawnAt < 30000) {
    focusAsideWindow();
    return true;
  }
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq Aside.exe', '/NH'], {
        timeout: 3000,
        windowsHide: true,
        encoding: 'utf8',
      });
      if (/aside\.exe/i.test(out || '')) {
        focusAsideWindow();
        return true;
      }
    } catch {
      // Fall through only if tasklist itself failed
    }
  }
  const guiExe = findAsideGuiExecutable();
  if (!guiExe) return false;
  try {
    lastAsideGuiSpawnAt = Date.now();
    const child = spawn(guiExe, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function isAsideProcessRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      execFile(
        'tasklist.exe',
        ['/FI', 'IMAGENAME eq Aside.exe', '/NH'],
        { timeout: 5000, windowsHide: true },
        (_err, stdout) => {
          resolve(/aside\.exe/i.test(stdout || ''));
        }
      );
    } catch {
      resolve(false);
    }
  });
}

/** Ensures a single Aside GUI window is awake and connected before attaching a tab */
export async function ensureAsideGuiTab(_url: string): Promise<void> {
  const running = await isAsideProcessRunning();
  if (isTaskCancelled()) throw new Error('TASK_CANCELLED');

  if (running) {
    focusAsideWindow();
    return;
  }

  openUrlInAsideGui('');

  // Wait until Aside.exe appears in tasklist (up to 6s)
  for (let i = 0; i < 12; i++) {
    if (isTaskCancelled()) throw new Error('TASK_CANCELLED');
    if (await isAsideProcessRunning()) break;
    await new Promise((res) => setTimeout(res, 500));
  }

  // Wait 4.5s for Aside.exe to finish creating its single window and connecting to AsideDaemon
  // before the single `aside repl` script executes (prevents `aside repl` from auto-launching a 2nd instance).
  for (let i = 0; i < 9; i++) {
    if (isTaskCancelled()) throw new Error('TASK_CANCELLED');
    await new Promise((res) => setTimeout(res, 500));
  }

  focusAsideWindow();
}

export function detectAside(): Promise<AsideStatus> {
  cachedAsidePath = undefined;
  const exe = findAsideExecutable();
  if (!exe) return Promise.resolve({ installed: false });
  return new Promise((resolve) => {
    execFile(exe, ['-V'], { timeout: 6000, windowsHide: true }, (_err, stdout) => {
      resolve({ installed: true, path: exe, version: (stdout || '').trim().split(/\r?\n/)[0] || undefined });
    });
  });
}

function runAsideProcess(
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string; cancelled: boolean; timedOut: boolean }> {
  const exe = findAsideExecutable();
  if (!exe) {
    return Promise.resolve({ code: -1, stdout: '', stderr: 'Aside CLI not installed', cancelled: false, timedOut: false });
  }
  return new Promise((resolve) => {
    if (isTaskCancelled()) {
      resolve({ code: -1, stdout: '', stderr: '', cancelled: true, timedOut: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const child = spawn(exe, args, {
      cwd: os.tmpdir(),
      shell: false,
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    const unregister = registerCancellableChild(child);

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unregister();
      resolve({ code, stdout, stderr, cancelled: isTaskCancelled(), timedOut });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        // Kill only the CLI child PID (never /T) so the Aside browser GUI process is never terminated
        if (child.pid) execFile('taskkill', ['/PID', String(child.pid), '/F'], { windowsHide: true });
        child.kill();
      } catch {
        // ignore
      }
      finish(null);
    }, timeoutMs);

    child.stdout.on('data', (d) => (stdout += d.toString('utf-8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf-8')));
    child.on('error', (e) => {
      stderr += String(e?.message || e);
      finish(-1);
    });
    child.on('exit', (code) => setTimeout(() => finish(code), 150));
    child.on('close', (code) => finish(code));
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
  });
}

interface ReplResult {
  ok: boolean;
  step: string;
  titled?: boolean;
  bodied?: boolean;
  tagged?: boolean;
  submitted?: boolean;
  loginRequired?: boolean;
  url?: string;
  error?: string;
}

function parseReplResult(stdout: string): ReplResult | null {
  const line = stdout
    .split(/\r?\n/)
    .reverse()
    .find((l) => l.includes('BS_RESULT '));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(line.indexOf('BS_RESULT ') + 'BS_RESULT '.length)) as ReplResult;
  } catch {
    return null;
  }
}

export interface AsideCapturedCreds {
  loginId?: string;
  loginPassword?: string;
  kakaoAccountHint?: string;
}

export interface AsideImagePayload {
  name: string;
  mime: string;
  base64: string;
}

/** One-shot localhost server that serves HTML/prompt text/credentials/PNG images to Aside REPL and receives large results back */
function startContentServer(
  html: string,
  text: string,
  creds?: AsideCapturedCreds,
  images?: AsideImagePayload[]
): Promise<{
  url: string;
  getPostedResult: () => string | null;
  getCapturedCreds: () => AsideCapturedCreds | null;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const token = crypto.randomBytes(16).toString('hex');
    let postedResult: string | null = null;
    let capturedCreds: AsideCapturedCreds | null = null;
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === `/${token}/result`) {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.from(c)));
        req.on('end', () => {
          postedResult = Buffer.concat(chunks).toString('utf-8');
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end('{"ok":true}');
        });
        return;
      }
      if (req.method === 'POST' && req.url === `/${token}/creds`) {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(Buffer.from(c)));
        req.on('end', () => {
          try {
            const incoming = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as AsideCapturedCreds;
            capturedCreds = {
              ...(capturedCreds || {}),
              ...(incoming.loginId?.trim() ? { loginId: incoming.loginId.trim() } : {}),
              ...(incoming.loginPassword?.trim() ? { loginPassword: incoming.loginPassword.trim() } : {}),
              ...(incoming.kakaoAccountHint?.trim() ? { kakaoAccountHint: incoming.kakaoAccountHint.trim() } : {}),
            };
          } catch {
            // ignore malformed JSON
          }
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end('{"ok":true}');
        });
        return;
      }
      if (req.method === 'GET' && req.url === `/${token}/creds`) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(creds || {}));
      } else if (req.method === 'GET' && req.url === `/${token}/images`) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify(images || []));
      } else if (req.url === `/${token}/html`) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(html);
      } else if (req.url === `/${token}/text`) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(text);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/${token}`,
        getPostedResult: () => postedResult,
        getCapturedCreds: () => capturedCreds,
        close: () => {
          try {
            server.close();
          } catch {
            // ignore
          }
        },
      });
    });
  });
}

/** Shared helper JS injected into every REPL script */
const REPL_HELPERS = `
const __R = { ok: false, step: 'start' };
const __done = () => console.log('BS_RESULT ' + JSON.stringify(__R));
const __vis = async (loc) => { try { return await loc.isVisible(); } catch { return false; } };
const __tryClick = async (scope, sels) => {
  for (const s of sels) {
    const l = scope.locator(s).first();
    if (await __vis(l)) { try { await l.click(); return true; } catch {} }
  }
  return false;
};
const __textLen = async (scope, sels) => {
  for (const s of sels) {
    try {
      const n = await scope.locator(s).first().evaluate((el) => (el.innerText || el.textContent || '').replace(/\\s+/g, '').length);
      if (typeof n === 'number') return n;
    } catch {}
  }
  return 0;
};
const __syntheticPaste = async (bodyLoc, src) => {
  const html = await (await fetch(src + '/html')).text();
  const text = await (await fetch(src + '/text')).text();
  await bodyLoc.evaluate((el, payload) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', payload.html);
    dt.setData('text/plain', payload.text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  }, { html, text });
};
const __pastePngImages = async (scope, bodyLoc, src) => {
  try {
    const imgs = await (await fetch(src + '/images')).json();
    if (!Array.isArray(imgs) || imgs.length === 0) return false;
    // Try native file input first when available inside scope
    try {
      const fileInput = scope.locator('input[type="file"][accept*="image"]').first();
      if ((await fileInput.count()) > 0) {
        const injected = await fileInput.evaluate((inp, list) => {
          const dt = new DataTransfer();
          for (const item of list) {
            const bin = atob(item.base64);
            const u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            dt.items.add(new File([u8], item.name, { type: item.mime || 'image/png' }));
          }
          inp.files = dt.files;
          inp.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, imgs.slice(0, 3));
        if (injected) return true;
      }
    } catch {}
    await bodyLoc.evaluate((el, list) => {
      el.focus();
      for (const item of list) {
        const bin = atob(item.base64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const file = new File([u8], item.name, { type: item.mime || 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(file);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }
    }, imgs.slice(0, 3));
    return true;
  } catch {
    return false;
  }
};
const __clickBySnapshotText = async (page, pattern) => {
  try {
    const snap = await snapshot(page, { interactive: true });
    const re = new RegExp(pattern, 'i');
    for (const line of (snap.tree || '').split(/\\r?\\n/)) {
      const m = line.match(/\\[ref=([a-zA-Z0-9]+)\\]/);
      if (m && re.test(line)) {
        await page.locator(m[1]).click();
        return true;
      }
    }
  } catch {}
  return false;
};
const __clickByDomText = async (scope, rootSel, text) => {
  try {
    return await scope.evaluate(({ rootSel, text }) => {
      const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
      const targetText = norm(text);
      if (!targetText) return false;
      const root = rootSel ? document.querySelector(rootSel) : document;
      if (!root) return false;
      const all = Array.from(root.querySelectorAll('[role="option"], [role="menuitem"], .mce-menu-item, .mce-text, li, button, a, label, span, div'));
      const candidates = all.filter((el) => {
        if (el.id === 'category-btn') return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const t = norm(el.innerText || el.textContent);
        if (!t || !t.includes(targetText)) return false;
        const childHas = Array.from(el.children).some((c) => norm(c.innerText || c.textContent).includes(targetText));
        return !childHas;
      });
      candidates.sort((a, b) => norm(a.innerText || a.textContent).length - norm(b.innerText || b.textContent).length);
      const best = candidates[0];
      if (!best) return false;
      const clickTarget = best.closest('[role="option"], [role="menuitem"], .mce-menu-item, li, button, a, label') || best;
      for (const targetEl of [best, clickTarget]) {
        for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
          targetEl.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        if (typeof targetEl.click === 'function') targetEl.click();
      }
      return true;
    }, { rootSel, text });
  } catch {
    return false;
  }
};
const __humanDwell = async (page, targetLoc) => {
  __R.step = 'human_dwell';
  const totalMs = 15000 + Math.floor(Math.random() * 17001);
  const preScrollMs = Math.floor(totalMs * 0.45);
  const restMs = Math.max(3000, totalMs - preScrollMs - 1400);
  await sleep(preScrollMs);
  try {
    if (targetLoc) { try { await targetLoc.hover(); } catch {} }
    await page.mouse.wheel(0, 260);
    await sleep(700);
    await page.mouse.wheel(0, -180);
    await sleep(700);
    if (targetLoc) { try { await targetLoc.scrollIntoViewIfNeeded(); } catch {} }
  } catch {}
  await sleep(restMs);
  __R.humanDwellMs = totalMs;
};
const __reloginTistory = async (page, src, maxNoCredSteps = 8) => {
  let creds = {};
  try { creds = await (await fetch(src + '/creds')).json(); } catch {}
  const cap = {
    loginId: creds.loginId || '',
    loginPassword: creds.loginPassword || '',
    kakaoAccountHint: creds.kakaoAccountHint || '',
  };
  const flushCreds = async (patch) => {
    let changed = false;
    if (patch && patch.loginId && patch.loginId.trim() && patch.loginId.trim() !== cap.loginId) {
      cap.loginId = patch.loginId.trim(); changed = true;
    }
    if (patch && patch.loginPassword && patch.loginPassword.trim() && patch.loginPassword.trim() !== cap.loginPassword) {
      cap.loginPassword = patch.loginPassword.trim(); changed = true;
    }
    if (patch && patch.kakaoAccountHint && patch.kakaoAccountHint.trim() && patch.kakaoAccountHint.trim() !== cap.kakaoAccountHint) {
      cap.kakaoAccountHint = patch.kakaoAccountHint.trim(); changed = true;
    }
    if (changed) {
      try { await fetch(src + '/creds', { method: 'POST', body: JSON.stringify(cap) }); } catch {}
    }
  };
  const installKakaoCaptureHook = async () => {
    try {
      await page.evaluate(() => {
        if (window.__bsKakaoHookInstalled) return;
        window.__bsKakaoHookInstalled = true;
        window.__bsCap = window.__bsCap || {};
        const syncInputs = () => {
          const idEl = document.querySelector('input[name="loginId"], input#loginId--1, input[placeholder*="아이디"]');
          const pwEl = document.querySelector('input[type="password"]');
          if (idEl && idEl.value && idEl.value.trim()) window.__bsCap.loginId = idEl.value.trim();
          if (pwEl && pwEl.value && pwEl.value.trim()) window.__bsCap.loginPassword = pwEl.value.trim();
        };
        document.addEventListener('input', syncInputs, true);
        document.addEventListener('change', syncInputs, true);
        document.addEventListener('submit', syncInputs, true);
        document.addEventListener('click', (ev) => {
          syncInputs();
          const btn = ev.target && ev.target.closest ? ev.target.closest('button, li, a') : null;
          if (!btn) return;
          const t = (btn.innerText || '').trim();
          if (t.includes('@') && !/삭제|새로운|추가|다른/.test(t)) {
            const firstLine = t.split(/\\r?\\n/).map((s) => s.trim()).find((s) => s.includes('@')) || t;
            const tok = firstLine.split(/\\s+/).find((s) => s.includes('@')) || firstLine;
            if (tok) window.__bsCap.kakaoAccountHint = tok;
          }
        }, true);
        syncInputs();
      });
    } catch {}
  };
  const syncDomCapture = async () => {
    try {
      const domCap = await page.evaluate(() => window.__bsCap || null);
      if (domCap) await flushCreds(domCap);
    } catch {}
  };
  const pickSimpleAccount = async () => {
    try {
      const snap = await snapshot(page, { interactive: true });
      const lines = (snap.tree || '').split(/\\r?\\n/);
      const tryMatch = async (pattern) => {
        if (!pattern) return false;
        const re = new RegExp(pattern, 'i');
        for (const line of lines) {
          if (/삭제|새로운|추가|다른/.test(line)) continue;
          const m = line.match(/\\[ref=([a-zA-Z0-9]+)\\]/);
          if (m && re.test(line)) {
            const emailM = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+)/);
            if (emailM && emailM[1]) await flushCreds({ kakaoAccountHint: emailM[1] });
            await page.locator(m[1]).click();
            return true;
          }
        }
        return false;
      };
      if (creds.kakaoAccountHint && (await tryMatch(creds.kakaoAccountHint.replace(/[.*+?^$|()[\\]\\\\]/g, '\\\\$&')))) return true;
      if (creds.loginId && creds.loginId.includes('@') && (await tryMatch(creds.loginId.replace(/[.*+?^$|()[\\]\\\\]/g, '\\\\$&')))) return true;
      if (await tryMatch('@')) return true;
    } catch {}
    return false;
  };

  let pickedSimpleAccount = false;
  let submittedPassword = false;
  let noCredSteps = 0;
  let firstSeenKakaoAt = 0;

  for (let step = 0; step < 36; step++) {
    let u = '';
    let host = '';
    let pathname = '';
    try {
      u = await page.url();
      const parsed = new URL(u);
      host = parsed.hostname;
      pathname = parsed.pathname;
    } catch {}

    if (/tistory\\.com$/i.test(host) && !/\\/auth\\/login/i.test(pathname)) return true;

    if (/tistory\\.com$/i.test(host) && /\\/auth\\/login/i.test(pathname)) {
      try { await page.bringToFront(); } catch {}
      const clicked = (await __tryClick(page, ['a.link_kakao_id'])) ||
        (await __clickBySnapshotText(page, '카카오계정으로 로그인'));
      if (clicked) {
        // Wait until browser actually leaves /auth/login and completes Kakao -> /login/simple redirect
        for (let w = 0; w < 10; w++) {
          await sleep(500);
          let nu = '';
          try { nu = await page.url(); } catch {}
          if (nu && !/tistory\\.com\\/auth\\/login/i.test(nu)) break;
        }
        await sleep(2200);
      } else {
        await sleep(1000);
      }
      continue;
    }

    if (/kakao\\.com$/i.test(host)) {
      if (!firstSeenKakaoAt) {
        firstSeenKakaoAt = Date.now();
        // Give Kakao /login/ time to auto-redirect to /login/simple/#simpleLogin before touching the DOM
        if (/accounts\\.kakao\\.com\\/login\\/?(?:\\?|$|#login)/i.test(u)) {
          await sleep(2200);
          try {
            u = await page.url();
            const reparsed = new URL(u);
            host = reparsed.hostname;
            pathname = reparsed.pathname;
          } catch {}
          if (!/kakao\\.com$/i.test(host)) continue;
        }
      }

      await installKakaoCaptureHook();
      await syncDomCapture();

      // Consent / continue screen (only when not on simple picker)
      if (!/\\/login\\/simple/i.test(u)) {
        const cont = await __clickBySnapshotText(page, '동의하고 계속하기|계속하기');
        if (cont) {
          for (let w = 0; w < 10; w++) {
            await sleep(500);
            try {
              const nu = await page.url();
              if (/tistory\\.com/i.test(nu) && !/\\/auth\\/login/i.test(nu)) return true;
            } catch {}
          }
          continue;
        }
      }

      const hasPwField = await __vis(page.locator('input[type="password"]').first());

      // Simple-login account picker (/login/simple or visible @ account card without password input)
      if (!hasPwField && (/\\/login\\/simple/i.test(u) || !pickedSimpleAccount)) {
        if (!pickedSimpleAccount) {
          const picked = await pickSimpleAccount();
          if (picked) {
            pickedSimpleAccount = true;
            for (let w = 0; w < 16; w++) {
              await sleep(500);
              await syncDomCapture();
              let nu = '';
              try { nu = await page.url(); } catch {}
              if (/tistory\\.com/i.test(nu) && !/\\/auth\\/login/i.test(nu)) return true;
              if (await __vis(page.locator('input[type="password"]').first())) break;
              const needConsent = await __clickBySnapshotText(page, '동의하고 계속하기|계속하기');
              if (needConsent) { await sleep(1500); }
            }
            continue;
          }
        }
      }

      // ID + Password login form
      if (hasPwField) {
        try { await page.bringToFront(); } catch {}
        if (!submittedPassword) {
          try {
            await page.evaluate(() => {
              const cb = document.querySelector('input[name="saveSignedIn"], input[type="checkbox"]');
              if (cb && !cb.checked) cb.click();
            });
          } catch {}

          // Auto-fill stored credentials when available
          if (creds.loginId && creds.loginPassword) {
            try {
              const idLoc = page.locator('input[name="loginId"], input#loginId--1, input[placeholder*="아이디"], input[type="text"]').first();
              const pwLoc = page.locator('input[type="password"]').first();
              const curId = await idLoc.inputValue().catch(() => '');
              if (!curId.trim()) {
                try { await idLoc.fill(creds.loginId); } catch {
                  await idLoc.click();
                  await page.keyboard.insertText(creds.loginId);
                }
              }
              const curPw = await pwLoc.inputValue().catch(() => '');
              if (!curPw.trim()) {
                try { await pwLoc.fill(creds.loginPassword); } catch {
                  await pwLoc.click();
                  await page.keyboard.insertText(creds.loginPassword);
                }
              }
              await sleep(300);
            } catch {}
          }

          const domCreds = await page.evaluate(() => {
            const idEl = document.querySelector('input[name="loginId"], input#loginId--1, input[placeholder*="아이디"], input[type="text"]');
            const pwEl = document.querySelector('input[type="password"]');
            return {
              id: idEl && idEl.value ? idEl.value.trim() : '',
              pw: pwEl && pwEl.value ? pwEl.value.trim() : '',
            };
          }).catch(() => ({ id: '', pw: '' }));

          if (domCreds.id.length > 0 && domCreds.pw.length > 0) {
            await flushCreds({ loginId: domCreds.id, loginPassword: domCreds.pw });
            submittedPassword = true;
            const clickedSubmit =
              (await __tryClick(page, ['button[type="submit"]', 'button.submit'])) ||
              (await __clickBySnapshotText(page, 'button\\\\s+"로그인"'));
            if (clickedSubmit) {
              for (let w = 0; w < 20; w++) {
                await sleep(500);
                await syncDomCapture();
                let nu = '';
                try { nu = await page.url(); } catch {}
                if (/tistory\\.com/i.test(nu) && !/\\/auth\\/login/i.test(nu)) return true;
                if (/\\/login\\/simple/i.test(nu)) break;
                const contBtn = await __clickBySnapshotText(page, '동의하고 계속하기|계속하기');
                if (contBtn) await sleep(1200);
              }
              continue;
            }
          }
        }

        // No saved credentials (or waiting for user/2FA): poll briefly while capturing manual entry
        noCredSteps++;
        for (let p = 0; p < 3; p++) {
          await sleep(400);
          await syncDomCapture();
        }
        if (noCredSteps >= maxNoCredSteps) break;
        continue;
      }

      await sleep(1000);
      continue;
    }

    await sleep(900);
  }
  await syncDomCapture();
  let finalHost = '';
  let finalPath = '';
  try {
    const parsed = new URL(await page.url());
    finalHost = parsed.hostname;
    finalPath = parsed.pathname;
  } catch {}
  return /tistory\\.com$/i.test(finalHost) && !/\\/auth\\/login/i.test(finalPath);
};
const __reloginNaver = async (page, src, maxNoCredSteps = 8) => {
  let creds = {};
  try { creds = await (await fetch(src + '/creds')).json(); } catch {}
  const cap = { loginId: creds.loginId || '', loginPassword: creds.loginPassword || '' };
  const flushNaverCreds = async (patch) => {
    let changed = false;
    if (patch && patch.loginId && patch.loginId.trim() && patch.loginId.trim() !== cap.loginId) {
      cap.loginId = patch.loginId.trim(); changed = true;
    }
    if (patch && patch.loginPassword && patch.loginPassword.trim() && patch.loginPassword.trim() !== cap.loginPassword) {
      cap.loginPassword = patch.loginPassword.trim(); changed = true;
    }
    if (changed) {
      try { await fetch(src + '/creds', { method: 'POST', body: JSON.stringify(cap) }); } catch {}
    }
  };
  let submitted = false;
  let noCredSteps = 0;
  for (let step = 0; step < 24; step++) {
    let u = '';
    try { u = await page.url(); } catch {}
    if (u && !/nid\\.naver\\.com/i.test(u)) return true;
    try {
      await page.evaluate(() => {
        if (window.__bsNaverHook) return;
        window.__bsNaverHook = true;
        window.__bsCap = window.__bsCap || {};
        const sync = () => {
          const idEl = document.querySelector('#id, input[name="id"]');
          const pwEl = document.querySelector('#pw, input[name="pw"]');
          if (idEl && idEl.value && idEl.value.trim()) window.__bsCap.loginId = idEl.value.trim();
          if (pwEl && pwEl.value && pwEl.value.trim()) window.__bsCap.loginPassword = pwEl.value.trim();
        };
        document.addEventListener('input', sync, true);
        document.addEventListener('change', sync, true);
        document.addEventListener('submit', sync, true);
        sync();
      });
    } catch {}
    try {
      const domCap = await page.evaluate(() => window.__bsCap || null);
      if (domCap) await flushNaverCreds(domCap);
    } catch {}
    if (!submitted) {
      try {
        await page.evaluate(() => {
          const keep = document.querySelector('#keep, input[name="nvlong"]');
          if (keep && !keep.checked) keep.click();
        });
      } catch {}
      if (creds.loginId && creds.loginPassword) {
        try {
          const idLoc = page.locator('#id, input[name="id"]').first();
          const pwLoc = page.locator('#pw, input[name="pw"]').first();
          if (await __vis(idLoc) && await __vis(pwLoc)) {
            if (!(await idLoc.inputValue().catch(() => '')).trim()) {
              try { await idLoc.fill(creds.loginId); } catch { await idLoc.click(); await page.keyboard.insertText(creds.loginId); }
            }
            if (!(await pwLoc.inputValue().catch(() => '')).trim()) {
              try { await pwLoc.fill(creds.loginPassword); } catch { await pwLoc.click(); await page.keyboard.insertText(creds.loginPassword); }
            }
            await sleep(300);
          }
        } catch {}
      }
      const domCreds = await page.evaluate(() => {
        const idEl = document.querySelector('#id, input[name="id"]');
        const pwEl = document.querySelector('#pw, input[name="pw"]');
        return {
          id: idEl && idEl.value ? idEl.value.trim() : '',
          pw: pwEl && pwEl.value ? pwEl.value.trim() : '',
        };
      }).catch(() => ({ id: '', pw: '' }));
      if (domCreds.id.length > 0 && domCreds.pw.length > 0) {
        await flushNaverCreds({ loginId: domCreds.id, loginPassword: domCreds.pw });
        submitted = true;
        await __tryClick(page, ['#log\\\\.login', 'button#log\\\\.login', 'button[type="submit"]']);
        for (let w = 0; w < 16; w++) {
          await sleep(500);
          try {
            const nu = await page.url();
            if (nu && !/nid\\.naver\\.com/i.test(nu)) return true;
          } catch {}
        }
        continue;
      }
    }
    noCredSteps++;
    for (let p = 0; p < 3; p++) {
      await sleep(400);
      try {
        const domCap = await page.evaluate(() => window.__bsCap || null);
        if (domCap) await flushNaverCreds(domCap);
      } catch {}
    }
    if (noCredSteps >= maxNoCredSteps) break;
  }
  try { return !/nid\\.naver\\.com/i.test(await page.url()); } catch { return false; }
};
const __safeCloseRedundantTab = async (page) => {
  try {
    const tabs = await listBrowserTabs();
    if (Array.isArray(tabs) && tabs.length > 1) {
      try { await page.close(); } catch {}
      try { await closeTab(page); } catch {}
    }
  } catch {}
};
const __attachOrOpenTab = async (targetUrl) => {
  let targetHost = '';
  try { targetHost = new URL(targetUrl).hostname.replace(/^www\\./, ''); } catch {}
  for (let i = 0; i < 12; i++) {
    try {
      let tabs = await listBrowserTabs();
      const isUsableTabUrl = (u) => !/^(devtools|chrome-extension):/i.test(u || '');
      const usableAll = (tabs || []).filter((t) => t && t.targetId && isUsableTabUrl(t.url || ''));
      if (usableAll.length > 0) {
        const windowIds = Array.from(
          new Set(usableAll.map((t) => t.windowId).filter((w) => typeof w === 'number'))
        );
        let primaryWindowId = windowIds[0];
        if (windowIds.length > 1) {
          const matchingTab =
            usableAll.find((t) => targetHost && (t.url || '').includes(targetHost)) ||
            usableAll.find((t) => t.active && t.focusedWindow) ||
            usableAll.find((t) => t.active) ||
            usableAll[0];
          primaryWindowId = matchingTab ? matchingTab.windowId : windowIds[0];
          for (const extra of usableAll) {
            if (typeof extra.windowId === 'number' && extra.windowId !== primaryWindowId) {
              try {
                const ep = await attachBrowserTab(extra.targetId);
                try { await ep.evaluate(() => { window.onbeforeunload = null; }); } catch {}
                try { await ep.close(); } catch {}
                try { await closeTab(ep); } catch {}
              } catch {}
              try { await closeTab(extra.targetId); } catch {}
            }
          }
          await sleep(300);
          tabs = await listBrowserTabs();
        }
        const candidates = (tabs || []).filter(
          (t) =>
            t &&
            t.targetId &&
            isUsableTabUrl(t.url || '') &&
            (typeof primaryWindowId !== 'number' ||
              typeof t.windowId !== 'number' ||
              t.windowId === primaryWindowId)
        );
        const isBlankOrDocs = (u) =>
          /^(aside|chrome):\\/\\/newtab|^about:blank/i.test(u) || u === '' || /docs\\.aside\\.com/i.test(u);
        const hit =
          candidates.find((t) => t.active && targetHost && ((t.url || '').includes(targetHost) || /kakao\\.com|nid\\.naver\\.com/i.test(t.url || ''))) ||
          candidates.find((t) => targetHost && ((t.url || '').includes(targetHost) || /kakao\\.com|nid\\.naver\\.com/i.test(t.url || ''))) ||
          candidates.find((t) => isBlankOrDocs(t.url || '')) ||
          candidates.find((t) => t.active) ||
          candidates[0];
        if (hit && hit.targetId) {
          for (const stale of candidates) {
            const su = stale.url || '';
            if (
              stale.targetId !== hit.targetId &&
              ((targetHost && su.includes(targetHost)) ||
                /tistory\\.com\\/auth\\/login|accounts\\.kakao\\.com\\/login|nid\\.naver\\.com\\/nidlogin/i.test(su) ||
                isBlankOrDocs(su))
            ) {
              try {
                const sp = await attachBrowserTab(stale.targetId);
                try { await sp.evaluate(() => { window.onbeforeunload = null; }); } catch {}
                try { await sp.close(); } catch {}
                try { await closeTab(sp); } catch {}
              } catch {}
              try { await closeTab(stale.targetId); } catch {}
            }
          }
          const attachedPage = await attachBrowserTab(hit.targetId);
          try { await attachedPage.bringToFront(); } catch {}
          try { await attachedPage.evaluate(() => { window.onbeforeunload = null; }); } catch {}
          let curUrl = '';
          try { curUrl = await attachedPage.url(); } catch {}
          if (!/kakao\\.com|nid\\.naver\\.com|\\/auth\\/login/i.test(curUrl)) {
            try { await attachedPage.goto(targetUrl); } catch {}
            await sleep(1500);
          }
          return { page: attachedPage, owned: false };
        }
      }
    } catch {}
    await sleep(500);
  }
  return { page: await openTab(targetUrl), owned: true };
};
`;

function buildNaverReplScript(params: {
  writeUrl: string;
  title: string;
  tags: string[];
  category: string;
  autoPublish: boolean;
  src: string;
  hasImages?: boolean;
}): string {
  const cfg = JSON.stringify(params);
  return `${REPL_HELPERS}
const C = ${cfg};
await (async () => {
  try {
    const attached = await __attachOrOpenTab(C.writeUrl);
    const page = attached.page;
    try { page.on('dialog', (d) => d.dismiss().catch(() => {})); } catch {}
    __R.step = 'wait_editor';
    let scope = null;
    let triedNaverRelogin = false;
    for (let i = 0; i < 60 && !scope; i++) {
      let st = { f: false, t: false, u: '' };
      try {
        st = await page.evaluate(() => ({
          f: !!document.querySelector('iframe#mainFrame'),
          t: !!document.querySelector('.se-documentTitle'),
          u: location.href,
        }));
      } catch {}
      if (/nid\\.naver\\.com/.test(st.u)) {
        try { await page.bringToFront(); } catch {}
        if (!triedNaverRelogin) {
          triedNaverRelogin = true;
          const relogged = await __reloginNaver(page, C.src, 8);
          if (relogged) {
            try {
              const cur = await page.url();
              if (!cur.includes('blog.naver.com')) await page.goto(C.writeUrl);
            } catch {}
            await sleep(1500);
            i = 0;
            continue;
          }
        }
        __R.loginRequired = true;
        __R.step = 'login_required';
        __R.url = st.u;
        return;
      }
      if (st.t) { scope = page; break; }
      if (st.f) {
        const fl = page.frameLocator('iframe#mainFrame');
        try { await fl.locator('.se-documentTitle').first().waitFor({ timeout: 1200 }); scope = fl; break; } catch {}
      }
      await sleep(500);
    }
    if (!scope) { __R.step = 'editor_not_found'; return; }

    // Dismiss draft-recovery popup / help panel
    await sleep(800);
    await __tryClick(scope, ['.se-popup-button-cancel', '.se-help-panel-close-button', 'button.se-popup-close-button']);
    await sleep(400);

    __R.step = 'title';
    const titleLoc = scope.locator('.se-documentTitle .se-text-paragraph').first();
    await titleLoc.click();
    await sleep(250);
    await page.keyboard.insertText(C.title);
    __R.titled = true;
    await sleep(500);

    __R.step = 'body';
    const bodySels = ['.se-component.se-text .se-text-paragraph', '.se-section-text .se-text-paragraph'];
    let bodyLoc = null;
    for (const s of bodySels) {
      const l = scope.locator(s).first();
      if (await __vis(l)) { bodyLoc = l; break; }
    }
    if (!bodyLoc) {
      // Title Enter usually moves caret to body
      await page.keyboard.press('Enter');
      await sleep(400);
      bodyLoc = scope.locator(bodySels[0]).first();
    }
    try { await bodyLoc.click(); } catch {}
    await sleep(400);
    const lenSels = ['.se-main-container', '.se-content', '.se-components-wrap'];
    const before = await __textLen(scope, lenSels);
    await page.keyboard.press('Control+V');
    await sleep(2500);
    let after = await __textLen(scope, lenSels);
    if (after - before < 150) {
      await __syntheticPaste(bodyLoc, C.src);
      await sleep(2500);
      after = await __textLen(scope, lenSels);
    }
    __R.bodied = after - before >= 150;
    if (!__R.bodied) { __R.step = 'body_paste_failed'; return; }

    if (C.hasImages) {
      let naverImgCnt = 0;
      try { naverImgCnt = await scope.locator('.se-main-container img, .se-image-resource').count(); } catch {}
      if (naverImgCnt === 0) {
        await __pastePngImages(scope, bodyLoc, C.src);
        await sleep(2400);
      }
    }

    if (C.autoPublish) {
      await __humanDwell(page, bodyLoc);
      __R.step = 'publish_drawer';
      const opened = (await __tryClick(scope, ['button[class*="publish_btn"]'])) ||
        (await __tryClick(page, ['button[class*="publish_btn"]'])) ||
        (await __clickBySnapshotText(page, 'button\\\\s+"발행"'));
      if (!opened) { __R.step = 'publish_btn_not_found'; __R.ok = true; return; }
      await sleep(1500);

      if (C.category) {
        if (await __tryClick(scope, ['button[class*="selectbox_button"]', 'button[class*="category"]'])) {
          await sleep(500);
          await __clickByDomText(scope, '', C.category);
          await sleep(400);
        }
      }

      const tagLoc = scope.locator('input[placeholder*="태그"], #tag-input').first();
      if (await __vis(tagLoc)) {
        for (const t of C.tags) {
          try { await tagLoc.click(); await page.keyboard.insertText(t); await page.keyboard.press('Enter'); await sleep(350); } catch {}
        }
        __R.tagged = true;
      }

      await sleep(1200 + Math.floor(Math.random() * 1401));
      __R.step = 'confirm';
      const confirmed = await __tryClick(scope, ['button[class*="confirm_btn"]', 'button[data-testid="seOnePublishBtn"]']);
      if (confirmed) {
        await sleep(3500);
        __R.submitted = true;
      }
    }
    __R.url = await page.url();
    __R.ok = true;
    __R.step = 'done';
  } catch (e) {
    __R.error = String((e && e.message) || e).slice(0, 300);
  } finally {
    __done();
  }
})();
`;
}

function buildTistoryReplScript(params: {
  writeUrl: string;
  title: string;
  tags: string[];
  category: string;
  autoPublish: boolean;
  src: string;
  kakaoAccountHint?: string;
  hasImages?: boolean;
}): string {
  const cfg = JSON.stringify(params);
  return `${REPL_HELPERS}
const C = ${cfg};
await (async () => {
  try {
    const attached = await __attachOrOpenTab(C.writeUrl);
    const page = attached.page;
    try { page.on('dialog', (d) => d.dismiss().catch(() => {})); } catch {}
    __R.step = 'wait_editor';
    let ready = false;
    let triedRelogin = false;
    for (let i = 0; i < 60 && !ready; i++) {
      let u = '';
      try { u = await page.url(); } catch {}
      if (/tistory\\.com\\/auth\\/login|kakao\\.com/.test(u)) {
        if (!triedRelogin) {
          triedRelogin = true;
          const relogged = await __reloginTistory(page, C.src, 8);
          if (relogged) {
            try {
              const cur = await page.url();
              if (!cur.includes('/manage/newpost')) await page.goto(C.writeUrl);
            } catch {}
            await sleep(1500);
            i = 0;
            continue;
          }
        }
        __R.loginRequired = true;
        __R.step = 'login_required';
        __R.url = u;
        return;
      }
      if (await __vis(page.locator('#post-title-inp, textarea[placeholder*="제목"], textarea.textarea_tit').first())) { ready = true; break; }
      await sleep(500);
    }
    if (!ready) {
      let finalU = '';
      try { finalU = await page.url(); } catch {}
      if (/tistory\\.com\\/auth\\/login|kakao\\.com/.test(finalU)) {
        __R.loginRequired = true;
        __R.step = 'login_required';
        __R.url = finalU;
        return;
      }
      __R.step = 'editor_not_found';
      return;
    }
    await sleep(1500);

    try {
      await page.evaluate(() => {
        window.onbeforeunload = null;
        document.querySelectorAll('.editor-tag button, .tag_editor button, a.btn_del, button.btn_del, button[class*="del"]').forEach((b) => {
          if (b instanceof HTMLElement) b.click();
        });
      });
    } catch {}

    if (C.category) {
      __R.step = 'category';
      for (let attempt = 0; attempt < 2; attempt++) {
        const opened =
          (await __tryClick(page, ['#category-btn', 'button[class*="category"]', '#category-btn *'])) ||
          (await __clickBySnapshotText(page, '카테고리|분류'));
        if (opened) {
          await sleep(600);
          const pickedDom =
            (await __clickByDomText(page, '#category-list', C.category)) ||
            (await __clickByDomText(page, '.mce-menu, .mce-container, [role="listbox"], [role="menu"]', C.category)) ||
            (await __clickByDomText(page, '', C.category));
          if (!pickedDom) {
            await __clickBySnapshotText(page, C.category.replace(/[.*+?^$|()[\\]\\\\]/g, '\\\\$&'));
          }
          await sleep(500);
          const btnText = await page.evaluate(() => {
            const b = document.querySelector('#category-btn');
            return b ? (b.innerText || b.textContent || '').trim() : '';
          }).catch(() => '');
          if (btnText && btnText.includes(C.category)) break;
        }
      }
    }

    __R.step = 'title';
    await page.locator('#post-title-inp, textarea[placeholder*="제목"], textarea.textarea_tit').first().click();
    await sleep(150);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(100);
    await page.keyboard.insertText(C.title);
    __R.titled = true;
    await sleep(500);

    __R.step = 'body';
    try {
      await page.evaluate(() => {
        if (window.tinymce && window.tinymce.activeEditor) {
          window.tinymce.activeEditor.setContent('');
          window.tinymce.activeEditor.fire('change');
        }
      });
    } catch {}
    const fl = page.frameLocator('#editor-tistory_ifr');
    const bodyLoc = fl.locator('#tinymce').first();
    await bodyLoc.click();
    await sleep(250);
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await sleep(200);
    const before = await __textLen(fl, ['#tinymce']);
    await page.keyboard.press('Control+V');
    await sleep(2500);
    let after = await __textLen(fl, ['#tinymce']);
    if (after - before < 150) {
      await __syntheticPaste(bodyLoc, C.src);
      await sleep(2000);
      after = await __textLen(fl, ['#tinymce']);
    }
    if (after - before < 150) {
      try {
        const html = await (await fetch(C.src + '/html')).text();
        await page.evaluate((h) => {
          if (window.tinymce && window.tinymce.activeEditor) {
            window.tinymce.activeEditor.setContent(h);
            window.tinymce.activeEditor.fire('change');
          }
        }, html);
        await sleep(1500);
        after = await __textLen(fl, ['#tinymce']);
      } catch {}
    }
    __R.bodied = after - before >= 150;
    if (!__R.bodied) { __R.step = 'body_paste_failed'; return; }

    try {
      await page.evaluate(() => {
        if (window.tinymce && window.tinymce.activeEditor && window.tinymce.activeEditor.uploadImages) {
          window.tinymce.activeEditor.uploadImages();
        }
      });
    } catch {}
    if (C.hasImages) {
      let tisImgCnt = 0;
      try { tisImgCnt = await fl.locator('#tinymce img').count(); } catch {}
      if (tisImgCnt === 0) {
        await __pastePngImages(fl, bodyLoc, C.src);
        await sleep(2000);
      }
    }

    const tagLoc = page.locator('#tagText, input[placeholder*="태그"]').first();
    if (await __vis(tagLoc)) {
      for (const t of C.tags) {
        try { await tagLoc.click(); await page.keyboard.insertText(t); await page.keyboard.press('Enter'); await sleep(300); } catch {}
      }
      __R.tagged = true;
    }

    if (C.autoPublish) {
      await __humanDwell(page, bodyLoc);
      __R.step = 'publish_layer';
      const layerOpened =
        (await __tryClick(page, ['#publish-layer-btn', 'button.btn_publish'])) ||
        (await __clickBySnapshotText(page, 'button\\\\s+"완료"'));
      if (layerOpened) {
        await sleep(1200);
        await __tryClick(page, ['label[for="open20"]', '#open20']);
        await sleep(1200 + Math.floor(Math.random() * 1401));
        const published =
          (await __tryClick(page, ['#publish-btn'])) ||
          (await __clickBySnapshotText(page, 'button\\\\s+"(공개\\\\s*)?발행"'));
        if (published) {
          await sleep(3500);
          __R.submitted = true;
        }
      }
    }
    __R.url = await page.url();
    __R.ok = true;
    __R.step = 'done';
  } catch (e) {
    __R.error = String((e && e.message) || e).slice(0, 300);
  } finally {
    __done();
  }
})();
`;
}

function buildAgentPrompt(params: {
  blog: BlogProfile;
  post: BlogPost;
  writeUrl: string;
  autoPublish: boolean;
  isMarkdownEditor: boolean;
}): string {
  const { blog, post, writeUrl, autoPublish, isMarkdownEditor } = params;
  const tags = post.tags.slice(0, 5).join(', ');
  return [
    `블로그 글쓰기 자동 입력 작업입니다. (${blog.platform} / ${blog.name})`,
    `1. ${writeUrl} 페이지를 열어 글쓰기 에디터가 뜰 때까지 기다리세요. "작성 중인 글이 있습니다" 같은 임시저장 복구 팝업이 뜨면 [취소]를 눌러 새 글로 시작하세요.`,
    `2. 제목 입력칸에 아래 제목을 한 글자도 바꾸지 말고 그대로 입력하세요:\n${post.title}`,
    isMarkdownEditor
      ? `3. 본문 입력칸을 클릭한 뒤 Ctrl+V로 붙여넣으세요. (마크다운 원고가 이미 클립보드에 복사되어 있습니다. 직접 타이핑하거나 내용을 수정하지 마세요.)`
      : `3. 본문 입력칸을 클릭한 뒤 Ctrl+V로 붙여넣으세요. (표·소제목 서식이 포함된 완성 원고가 이미 클립보드에 복사되어 있습니다. 직접 타이핑하거나 내용을 수정하지 마세요.)`,
    tags ? `4. 태그 입력칸이 있으면 다음 태그를 하나씩 입력하고 Enter: ${tags}` : '4. 태그 단계는 건너뛰세요.',
    blog.auth.defaultCategory ? `5. 카테고리 선택이 가능하면 "${blog.auth.defaultCategory}"를 선택하세요.` : '5. 카테고리는 기본값으로 두세요.',
    autoPublish
      ? `6. 모든 입력이 끝나면 [발행] → 공개 설정 확인 → 최종 [발행] 버튼까지 눌러 공개 발행을 완료하세요.`
      : `6. 최종 [발행] 버튼은 절대 누르지 마세요. 입력까지만 완료하고 에디터 화면을 그대로 둔 채 멈추세요.`,
    `로그인 화면이 나오면 비밀번호를 입력하지 말고 즉시 중단한 뒤 "RESULT: LOGIN_REQUIRED"라고 답하세요.`,
    `작업이 끝나면 마지막 줄에 성공 시 "RESULT: OK", 실패 시 "RESULT: FAIL - 이유" 형식으로 답하세요.`,
  ].join('\n');
}

export interface AsidePublishResult {
  attempted: boolean;
  success: boolean;
  submitted: boolean;
  loginRequired: boolean;
  publishedUrl?: string;
  method: 'repl' | 'agent' | 'none';
  detail: string;
  capturedCreds?: AsideCapturedCreds;
}

export async function publishViaAside(params: {
  post: BlogPost;
  blog: BlogProfile;
  writeUrl: string;
  loginUrl: string;
  autoPublish: boolean;
}): Promise<AsidePublishResult> {
  return withAsideLock(async () => {
    const { post, blog, writeUrl, autoPublish } = params;
    if (!findAsideExecutable()) {
      return { attempted: false, success: false, submitted: false, loginRequired: false, method: 'none', detail: 'Aside 미설치' };
    }

    const isMarkdownEditor = blog.platform === 'velog' || blog.platform === 'github_pages';
    const clipboardPayload = () => {
      try {
        if (isMarkdownEditor) clipboard.writeText(post.markdownContent);
        else clipboard.write({ html: post.htmlContent, text: post.markdownContent });
      } catch {
        // ignore
      }
    };

    const asideImages: AsideImagePayload[] = [];
    const seenB64 = new Set<string>();
    const imgMatchRegex = /data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/gi;
    const rawHtmlAndMd = `${post.htmlContent || ''}\n${post.markdownContent || ''}`;
    let mImg: RegExpExecArray | null;
    while ((mImg = imgMatchRegex.exec(rawHtmlAndMd)) !== null) {
      const b64 = mImg[2];
      if (!b64 || seenB64.has(b64)) continue;
      seenB64.add(b64);
      const rawExt = mImg[1].toLowerCase();
      const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
      asideImages.push({
        name: `image-${asideImages.length + 1}.${ext}`,
        mime: rawExt === 'jpg' ? 'image/jpeg' : `image/${rawExt}`,
        base64: b64,
      });
    }
    if (asideImages.length === 0 && post.thumbnail?.dataUrl?.startsWith('data:image/png;base64,')) {
      asideImages.push({
        name: 'thumbnail.png',
        mime: 'image/png',
        base64: post.thumbnail.dataUrl.replace(/^data:image\/png;base64,/, ''),
      });
    }

    const server = await startContentServer(
      post.htmlContent,
      post.markdownContent,
      {
        loginId: (blog.auth.loginId || '').trim() || undefined,
        loginPassword: decryptBlogPassword(blog.auth.loginPasswordEncrypted) || undefined,
        kakaoAccountHint: (blog.auth.kakaoAccountHint || '').trim() || undefined,
      },
      asideImages
    );
    try {
      await ensureAsideGuiTab(writeUrl);

      // ---- Stage 1: deterministic REPL script (Naver / Tistory) ----
      if (blog.platform === 'naver' || blog.platform === 'tistory') {
        const scriptParams = {
          writeUrl,
          title: post.title,
          tags: post.tags.slice(0, 5).map((t) => t.replace(/\s+/g, '')),
          category: (blog.auth.defaultCategory || '').trim(),
          autoPublish,
          src: server.url,
          kakaoAccountHint: (blog.auth.kakaoAccountHint || '').trim(),
          hasImages: asideImages.length > 0,
        };
        const script =
          blog.platform === 'naver' ? buildNaverReplScript(scriptParams) : buildTistoryReplScript(scriptParams);

        clipboardPayload();
        const run = await runAsideProcess(['repl', script], 180000);
        if (run.cancelled) throw new Error('TASK_CANCELLED');
        const r = parseReplResult(run.stdout);
        const capturedCreds = server.getCapturedCreds() || undefined;

        if (r?.loginRequired) {
          focusAsideWindow();
          return {
            attempted: true,
            success: false,
            submitted: false,
            loginRequired: true,
            method: 'repl',
            detail: `Aside 브라우저에 ${blog.platform === 'naver' ? '네이버' : '티스토리'} 로그인이 필요합니다.`,
            capturedCreds,
          };
        }
        if (r?.ok && r.titled && r.bodied) {
          if (!r.submitted) focusAsideWindow();
          return {
            attempted: true,
            success: true,
            submitted: Boolean(r.submitted),
            loginRequired: false,
            publishedUrl: r.url,
            method: 'repl',
            detail: r.submitted ? '스크립트 자동 발행 완료' : '스크립트 자동 입력 완료',
            capturedCreds,
          };
        }
        // Fall through to the agent with the failure context
      }

      // ---- Stage 2: Aside browser agent (natural language) ----
      clipboardPayload();
      const prompt = buildAgentPrompt({ blog, post, writeUrl, autoPublish, isMarkdownEditor });
      const agent = await runAsideProcess(['exec', '--effort', 'medium', prompt], 8 * 60 * 1000);
      if (agent.cancelled) throw new Error('TASK_CANCELLED');
      const capturedCreds = server.getCapturedCreds() || undefined;
      const combined = `${agent.stdout}\n${agent.stderr}`;
      const resultLine = combined
        .split(/\r?\n/)
        .reverse()
        .find((l) => /RESULT:\s*(OK|FAIL|LOGIN_REQUIRED)/i.test(l));

      if (resultLine && /LOGIN_REQUIRED/i.test(resultLine)) {
        focusAsideWindow();
        return {
          attempted: true,
          success: false,
          submitted: false,
          loginRequired: true,
          method: 'agent',
          detail: 'Aside 브라우저에 블로그 로그인이 필요합니다.',
          capturedCreds,
        };
      }
      const ok = Boolean(resultLine && /RESULT:\s*OK/i.test(resultLine)) || (!resultLine && agent.code === 0 && !agent.timedOut);
      if (ok && !autoPublish) focusAsideWindow();
      return {
        attempted: true,
        success: ok,
        submitted: ok && autoPublish,
        loginRequired: false,
        method: 'agent',
        detail: ok
          ? 'Aside 에이전트 자동 입력 완료'
          : `Aside 에이전트 실패${agent.timedOut ? ' (시간 초과)' : ''}: ${(resultLine || combined.trim().split(/\r?\n/).slice(-1)[0] || '').slice(0, 160)}`,
        capturedCreds,
      };
    } finally {
      server.close();
    }
  });
}

/**
 * Checks whether the blog is logged in inside the Aside browser by opening the write page.
 * If not logged in, tries auto-relogin or leaves the login page open in Aside so the user can sign in once.
 */
export async function checkOrOpenAsideLogin(params: {
  blog: BlogProfile;
  writeUrl: string;
  loginUrl: string;
}): Promise<{ loggedIn: boolean; message: string; capturedCreds?: AsideCapturedCreds }> {
  return withAsideLock(async () => {
    const { blog, writeUrl, loginUrl } = params;
    const loginPattern =
      blog.platform === 'naver'
        ? 'nid\\.naver\\.com'
        : blog.platform === 'tistory'
        ? 'tistory\\.com\\/auth\\/login|kakao\\.com'
        : blog.platform === 'velog'
        ? 'velog\\.io\\/?$'
        : 'login|signin|wp-login';

    const server = await startContentServer('', '', {
      loginId: (blog.auth.loginId || '').trim() || undefined,
      loginPassword: decryptBlogPassword(blog.auth.loginPasswordEncrypted) || undefined,
      kakaoAccountHint: (blog.auth.kakaoAccountHint || '').trim() || undefined,
    });

    try {
      await ensureAsideGuiTab(writeUrl);

      const script = `${REPL_HELPERS}
await (async () => {
  const R = { loggedIn: false, url: '' };
  try {
    const attached = await __attachOrOpenTab(${JSON.stringify(writeUrl)});
    const page = attached.page;
    await sleep(2500);
    R.url = await page.url();
    if (${JSON.stringify(blog.platform)} === 'tistory' && new RegExp(${JSON.stringify(loginPattern)}, 'i').test(R.url)) {
      await __reloginTistory(page, ${JSON.stringify(server.url)}, 24);
      await sleep(1500);
      R.url = await page.url();
    } else if (${JSON.stringify(blog.platform)} === 'naver' && new RegExp(${JSON.stringify(loginPattern)}, 'i').test(R.url)) {
      await __reloginNaver(page, ${JSON.stringify(server.url)}, 24);
      await sleep(1500);
      R.url = await page.url();
    }
    R.loggedIn = !new RegExp(${JSON.stringify(loginPattern)}, 'i').test(R.url);
    if (R.loggedIn) {
      await __safeCloseRedundantTab(page);
    } else if (!/kakao\\.com|nid\\.naver\\.com/i.test(R.url)) {
      await page.goto(${JSON.stringify(loginUrl)});
    }
  } catch (e) { R.error = String(e && e.message || e); }
  console.log('BS_LOGIN ' + JSON.stringify(R));
})();
`;
      const run = await runAsideProcess(['repl', script], 125000);
      if (run.cancelled) throw new Error('TASK_CANCELLED');
      const line = run.stdout.split(/\r?\n/).find((l) => l.includes('BS_LOGIN '));
      let parsed: { loggedIn?: boolean; url?: string } = {};
      try {
        parsed = line ? JSON.parse(line.slice(line.indexOf('BS_LOGIN ') + 9)) : {};
      } catch {
        parsed = {};
      }
      const capturedCreds = server.getCapturedCreds() || undefined;
      if (parsed.loggedIn) {
        return {
          loggedIn: true,
          capturedCreds,
          message: `'${blog.name}' Aside 브라우저 로그인 세션이 확인되었습니다! 이제 자동 발행 시 Aside가 에디터를 직접 조작합니다.`,
        };
      }
      focusAsideWindow();
      return {
        loggedIn: false,
        capturedCreds,
        message: `Aside 브라우저에 '${blog.name}' 로그인 페이지를 열었습니다. Aside 창에서 한 번만 로그인하신 뒤 [로그인 연결]을 다시 눌러 확인해 주세요.`,
      };
    } finally {
      server.close();
    }
  });
}

/**
 * Checks whether a Web AI site (ChatGPT / Claude / Gemini / Perplexity / DeepSeek) is logged in
 * inside the Aside browser. If not, leaves the login tab open in Aside for the user.
 */
export async function checkOrOpenAsideWebAILogin(params: {
  url: string;
  name: string;
  inputSelectors: string[];
}): Promise<{ loggedIn: boolean; message: string }> {
  return withAsideLock(async () => {
    if (!findAsideExecutable()) {
      return { loggedIn: false, message: 'Aside CLI가 설치되어 있지 않습니다.' };
    }
    await ensureAsideGuiTab(params.url);

    const cfg = JSON.stringify({ url: params.url, inputSelectors: params.inputSelectors });
    const script = `${REPL_HELPERS}
const C = ${cfg};
await (async () => {
  const R = { loggedIn: false, url: '' };
  try {
    const attached = await __attachOrOpenTab(C.url);
    const page = attached.page;
    await sleep(3000);
    R.url = await page.url();
    const isAuthUrl = /accounts\\.google\\.com|auth0\\.com|\\/auth\\/|\\/login|signin|clerk\\./i.test(R.url);
    let hasInput = false;
    if (!isAuthUrl) {
      for (const s of C.inputSelectors) {
        try {
          if (await page.locator(s).first().isVisible()) { hasInput = true; break; }
        } catch {}
      }
    }
    R.loggedIn = !isAuthUrl && hasInput;
    if (R.loggedIn) {
      await __safeCloseRedundantTab(page);
    }
  } catch (e) { R.error = String(e && e.message || e); }
  console.log('BS_WEBAI_LOGIN ' + JSON.stringify(R));
})();
`;
    const run = await runAsideProcess(['repl', script], 60000);
    if (run.cancelled) throw new Error('TASK_CANCELLED');
    const line = run.stdout.split(/\r?\n/).find((l) => l.includes('BS_WEBAI_LOGIN '));
    let parsed: { loggedIn?: boolean } = {};
    try {
      parsed = line ? JSON.parse(line.slice(line.indexOf('BS_WEBAI_LOGIN ') + 15)) : {};
    } catch {
      parsed = {};
    }
    if (parsed.loggedIn) {
      return {
        loggedIn: true,
        message: `[Aside 브라우저] '${params.name}' 로그인 세션이 확인되었습니다! 원고 생성 시 Aside가 직접 프롬프트를 입력해 응답을 가져옵니다.`,
      };
    }
    focusAsideWindow();
    return {
      loggedIn: false,
      message: `[Aside 브라우저] '${params.name}' 페이지를 열었습니다. Aside 창에서 로그인하신 뒤 [로그인 연결]을 다시 눌러 확인해 주세요.`,
    };
  });
}

/**
 * Sends a prompt to a Web AI chat page inside the user's logged-in Aside browser
 * and returns the extracted Markdown response, or null if login/quota/selector failed.
 */
export async function promptWebAIViaAside(params: {
  url: string;
  prompt: string;
  inputSelectors: string[];
  sendButtonSelectors: string[];
}): Promise<string | null> {
  return withAsideLock(async () => {
    if (!findAsideExecutable()) return null;

    const prevClip = (() => {
      try {
        return clipboard.readText();
      } catch {
        return '';
      }
    })();
    try {
      clipboard.writeText(params.prompt);
    } catch {
      // ignore
    }

    const server = await startContentServer('', params.prompt);
    try {
      await ensureAsideGuiTab(params.url);

      const cfg = JSON.stringify({
        url: params.url,
        src: server.url,
        inputSelectors: params.inputSelectors,
        sendButtonSelectors: params.sendButtonSelectors,
      });
      const script = `${REPL_HELPERS}
const C = ${cfg};
await (async () => {
  const R = { ok: false, step: 'start', markdown: '', loginRequired: false, quotaLimit: false };
  let page = null;
  try {
    const promptText = await (await fetch(C.src + '/text')).text();
    const attached = await __attachOrOpenTab(C.url);
    page = attached.page;
    __R_wait: {
      let inputLoc = null;
      for (let i = 0; i < 16; i++) {
        const curUrl = await page.url();
        if (/accounts\\.google\\.com|auth0\\.com|\\/auth\\/|\\/login|signin/i.test(curUrl)) {
          R.loginRequired = true;
          R.step = 'login_required';
          break __R_wait;
        }
        for (const s of C.inputSelectors) {
          try {
            const loc = page.locator(s).first();
            if (await loc.isVisible()) { inputLoc = loc; break; }
          } catch {}
        }
        if (inputLoc) break;
        await sleep(800);
      }
      if (R.loginRequired || !inputLoc) {
        if (!R.loginRequired) R.step = 'input_not_found';
        break __R_wait;
      }

      R.step = 'fill_prompt';
      await inputLoc.click();
      await sleep(300);
      let filled = false;
      try {
        await inputLoc.fill(promptText);
        filled = true;
      } catch {
        filled = false;
      }
      if (!filled) {
        await page.keyboard.press('Control+V');
        await sleep(400);
      }
      await sleep(500);

      R.step = 'send';
      let clickedSend = false;
      for (const btnSel of C.sendButtonSelectors) {
        try {
          const btn = page.locator(btnSel).first();
          if ((await btn.isVisible()) && (await btn.isEnabled())) {
            await btn.click();
            clickedSend = true;
            break;
          }
        } catch {}
      }
      if (!clickedSend) {
        await page.keyboard.press('Enter');
      }

      R.step = 'wait_response';
      await sleep(6000);
      let previousLength = 0;
      let stableChecks = 0;
      for (let i = 0; i < 35; i++) {
        await sleep(2000);
        const state = await page.evaluate(() => {
          const bodyText = document.body?.innerText || '';
          const quota = /reached your limit|usage cap|rate limit|too many requests|out of free messages|한도에 도달|사용량 초과|사용 한도|일일 한도|다시 시도해 주세요/i.test(
            bodyText.slice(-1500)
          );
          if (quota) return { quota: true, md: '' };
          const containers = document.querySelectorAll(
            '[data-message-author-role="assistant"], .font-claude-message, message-content, model-response, .ds-markdown, .prose, .markdown'
          );
          if (containers.length === 0) return { quota: false, md: '' };
          const root = containers[containers.length - 1];
          function domToMd(node) {
            if (node.nodeType === 3) return node.textContent || '';
            if (node.nodeType !== 1) return '';
            const el = node;
            const tag = el.tagName.toLowerCase();
            const childrenMd = Array.from(el.childNodes).map(domToMd).join('');
            switch (tag) {
              case 'h1': return '\\n# ' + childrenMd.trim() + '\\n\\n';
              case 'h2': return '\\n## ' + childrenMd.trim() + '\\n\\n';
              case 'h3': return '\\n### ' + childrenMd.trim() + '\\n\\n';
              case 'h4': return '\\n#### ' + childrenMd.trim() + '\\n\\n';
              case 'p': return childrenMd.trim() + '\\n\\n';
              case 'strong': case 'b': return '**' + childrenMd.trim() + '**';
              case 'em': case 'i': return '*' + childrenMd.trim() + '*';
              case 'code': return el.parentElement?.tagName.toLowerCase() === 'pre' ? childrenMd : '\`' + childrenMd + '\`';
              case 'pre': return '\\n\`\`\`\\n' + (el.innerText || childrenMd).trim() + '\\n\`\`\`\\n\\n';
              case 'blockquote': return '\\n> ' + childrenMd.trim().replace(/\\n/g, '\\n> ') + '\\n\\n';
              case 'ul': return '\\n' + childrenMd + '\\n';
              case 'ol': return '\\n' + childrenMd + '\\n';
              case 'li': return '- ' + childrenMd.trim().replace(/\\n+/g, ' ') + '\\n';
              case 'br': return '\\n';
              case 'hr': return '\\n---\\n\\n';
              case 'a': {
                const href = el.getAttribute('href') || '';
                return href ? '[' + childrenMd.trim() + '](' + href + ')' : childrenMd;
              }
              case 'table': return '\\n' + childrenMd + '\\n';
              case 'tr': {
                const cells = Array.from(el.querySelectorAll('th, td')).map(c => (c.innerText || '').trim().replace(/\\|/g, '\\\\|'));
                if (!cells.length) return '';
                const row = '| ' + cells.join(' | ') + ' |\\n';
                const isHeader = !!el.querySelector('th') || (el.parentElement?.tagName.toLowerCase() === 'thead');
                return isHeader ? row + '| ' + cells.map(() => '---').join(' | ') + ' |\\n' : row;
              }
              case 'th': case 'td': return '';
              case 'button': case 'svg': return '';
              default: return childrenMd;
            }
          }
          const md = domToMd(root).replace(/\\n{3,}/g, '\\n\\n').trim();
          return { quota: false, md };
        });
        if (state.quota) {
          R.quotaLimit = true;
          R.step = 'quota_limit';
          break;
        }
        const md = state.md || '';
        if (md.length >= 200) {
          if (md.length === previousLength) {
            stableChecks++;
            if (stableChecks >= 2) {
              R.ok = true;
              R.markdown = md;
              R.step = 'done';
              break;
            }
          } else {
            stableChecks = 0;
            previousLength = md.length;
          }
        }
      }
    }
    if (page && !R.loginRequired) {
      await __safeCloseRedundantTab(page);
    }
  } catch (e) {
    R.error = String(e && e.message || e);
  }
  try {
    await fetch(C.src + '/result', { method: 'POST', body: JSON.stringify(R) });
  } catch {}
  console.log('BS_WEBAI_DONE ' + JSON.stringify({ ok: R.ok, step: R.step, len: R.markdown.length, loginRequired: R.loginRequired, quotaLimit: R.quotaLimit }));
})();
`;
      const run = await runAsideProcess(['repl', script], 125000);
      if (run.cancelled) throw new Error('TASK_CANCELLED');
      const posted = server.getPostedResult();
      let skipAgent = false;
      if (posted) {
        try {
          const parsed = JSON.parse(posted) as {
            ok?: boolean;
            markdown?: string;
            loginRequired?: boolean;
            quotaLimit?: boolean;
          };
          if (parsed.ok && parsed.markdown && parsed.markdown.trim().length >= 200) {
            return parsed.markdown.trim();
          }
          if (parsed.loginRequired) {
            focusAsideWindow();
            skipAgent = true;
          }
          if (parsed.quotaLimit) {
            skipAgent = true;
          }
        } catch {
          // ignore
        }
      }

      // Stage 2: Aside native AI Browser Agent (`aside exec`)
      if (!skipAgent) {
        try {
          clipboard.writeText(params.prompt);
        } catch {}
        const agentPrompt = [
          `1. Open ${params.url} in Aside Browser.`,
          `2. If a login page is shown, stop immediately and reply ONLY with "RESULT: LOGIN_REQUIRED".`,
          `3. Focus the chat prompt input box, paste the prompt from the OS clipboard (Ctrl+V), and submit/send it.`,
          `4. Wait until the AI finishes generating its complete response.`,
          `5. Output ONLY the full generated response in clean Markdown (do not add commentary before or after).`,
        ].join('\n');
        const agent = await runAsideProcess(['exec', '--effort', 'medium', agentPrompt], 5 * 60 * 1000);
        if (agent.cancelled) throw new Error('TASK_CANCELLED');
        const out = agent.stdout.trim();
        if (out && !/RESULT:\s*LOGIN_REQUIRED/i.test(out) && out.length >= 200) {
          return out;
        }
      }
      return null;
    } finally {
      server.close();
      try {
        clipboard.writeText(prevClip);
      } catch {
        // ignore
      }
    }
  });
}
