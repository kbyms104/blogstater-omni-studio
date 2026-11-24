import os from 'os';
import path from 'path';
import fs from 'fs';
import zlib from 'zlib';
import * as cheerio from 'cheerio';
import { spawn, exec, ChildProcess } from 'child_process';
import { clipboard, safeStorage } from 'electron';
import { chromium, BrowserContext } from 'playwright';
import { Marked } from 'marked';

// Disable GFM strikethrough (<del>) so Korean number/price ranges like "0.01~0.02 ... 10~15"
// are never misparsed as crossed-out text.
const blogMarkdownParser = new Marked({
  tokenizer: {
    del() {
      return undefined;
    },
  },
});
import {
  AIModelOption,
  AffiliateItem,
  BlogProfile,
  InternalLinkEntry,
  SEOScoreReport,
  ThumbnailConfig,
  WebAIProviderId,
  WebAISessionInfo,
} from './types';
import {
  buildRelevantPostTags,
  classifySubCategory,
  detectSearchIntent,
  extractCleanKoreanTopicPhrase,
  generateViralTitlesForKeyword,
  isPolicyOrFinanceApplyTopic,
  LEGACY_CLUMSY_TITLE_REGEX,
} from './keywordScout';
import { evaluatePostSEO } from './seoAnalyzer';
import { analyzeCompetitorSERP, extractReferenceSourceMaterial } from './competitorAnalyzer';
import {
  findAsideExecutable,
  checkOrOpenAsideWebAILogin,
  promptWebAIViaAside,
} from './asideDriver';

const activeBrowserContexts = new Map<string, BrowserContext>();
const activeCliProcesses = new Set<ChildProcess>();
const activeNativeLoginProcesses = new Set<ChildProcess>();

let currentTaskAbortController = new AbortController();
let taskCancelSequence = 0;

export function beginCancellableTask(): { seq: number; signal: AbortSignal } {
  currentTaskAbortController = new AbortController();
  return { seq: taskCancelSequence, signal: currentTaskAbortController.signal };
}

export function isTaskCancelled(seq?: number): boolean {
  if (currentTaskAbortController.signal.aborted) return true;
  if (seq !== undefined && seq !== taskCancelSequence) return true;
  return false;
}

export function throwIfTaskCancelled(seq?: number): void {
  if (isTaskCancelled(seq)) {
    throw new Error('TASK_CANCELLED');
  }
}

/** Register an external child process (e.g. Aside CLI) so the global [작업 즉시 중단] can kill it */
export function registerCancellableChild(child: ChildProcess): () => void {
  activeCliProcesses.add(child);
  return () => {
    activeCliProcesses.delete(child);
  };
}

export async function cancelAllActiveTasks(): Promise<void> {
  taskCancelSequence++;
  try {
    currentTaskAbortController.abort();
  } catch {
    // ignore
  }

  for (const child of Array.from(activeCliProcesses)) {
    try {
      if (child.pid && process.platform === 'win32') {
        exec(`taskkill /PID ${child.pid} /T /F`, { windowsHide: true });
      }
      child.kill();
    } catch {
      // ignore
    }
    activeCliProcesses.delete(child);
  }

  for (const child of Array.from(activeNativeLoginProcesses)) {
    try {
      if (child.pid && process.platform === 'win32') {
        exec(`taskkill /PID ${child.pid} /T /F`, { windowsHide: true });
      }
      child.kill();
    } catch {
      // ignore
    }
    activeNativeLoginProcesses.delete(child);
  }

  for (const [dir, ctx] of Array.from(activeBrowserContexts.entries())) {
    try {
      await ctx.close();
    } catch {
      // ignore
    }
    activeBrowserContexts.delete(dir);
  }
}

// ---------------------------------------------------------------------------
// Login cookie backup / restore
// Chrome discards session cookies (cookies without an expiry, e.g. when the user
// logs in without "keep me signed in") whenever the browser process exits.
// To keep the user's own login alive between runs, we periodically back up the
// context cookies (encrypted with OS-level safeStorage / DPAPI) inside the
// profile directory and restore them on the next launch.
// ---------------------------------------------------------------------------
const SESSION_BACKUP_FILE = 'blogstater-session-cookies.json';
const SESSION_COOKIE_EXTEND_SEC = 60 * 60 * 24 * 30; // 30 days

type CookieList = Awaited<ReturnType<BrowserContext['cookies']>>;

function readCookieBackup(profileDir: string): CookieList {
  const file = path.join(profileDir, SESSION_BACKUP_FILE);
  if (!fs.existsSync(file)) return [];
  try {
    const wrapper = JSON.parse(fs.readFileSync(file, 'utf-8')) as { enc: boolean; data: string };
    const buf = Buffer.from(wrapper.data, 'base64');
    const json = wrapper.enc ? safeStorage.decryptString(buf) : buf.toString('utf-8');
    const now = Math.floor(Date.now() / 1000);
    return (JSON.parse(json) as CookieList).filter((c) => !c.expires || c.expires <= 0 || c.expires > now);
  } catch {
    return [];
  }
}

async function backupContextCookies(ctx: BrowserContext, profileDir: string): Promise<void> {
  try {
    const cookies = await ctx.cookies();
    if (cookies.length === 0) return;
    const now = Math.floor(Date.now() / 1000);
    const normalized = cookies.map((c) => ({
      ...c,
      expires: c.expires && c.expires > 0 ? c.expires : now + SESSION_COOKIE_EXTEND_SEC,
    }));
    const json = JSON.stringify(normalized);
    const canEncrypt = safeStorage.isEncryptionAvailable();
    const data = canEncrypt
      ? safeStorage.encryptString(json).toString('base64')
      : Buffer.from(json, 'utf-8').toString('base64');
    fs.writeFileSync(
      path.join(profileDir, SESSION_BACKUP_FILE),
      JSON.stringify({ enc: canEncrypt, data }),
      'utf-8'
    );
  } catch {
    // context may be closing
  }
}

async function restoreContextCookies(ctx: BrowserContext, profileDir: string): Promise<void> {
  const saved = readCookieBackup(profileDir);
  if (saved.length === 0) return;
  try {
    await ctx.addCookies(saved);
  } catch {
    // Fall back to per-cookie restore so one invalid cookie does not block the rest
    for (const c of saved) {
      try {
        await ctx.addCookies([c]);
      } catch {
        // skip invalid cookie
      }
    }
  }
}

export function clearSavedLoginCookies(profileDir: string): void {
  try {
    fs.unlinkSync(path.join(path.resolve(profileDir), SESSION_BACKUP_FILE));
  } catch {
    // ignore
  }
}

export function encryptBlogPassword(plain: string): string {
  const cleaned = (plain || '').trim();
  if (!cleaned) return '';
  try {
    const canEncrypt = safeStorage.isEncryptionAvailable();
    const data = canEncrypt
      ? safeStorage.encryptString(cleaned).toString('base64')
      : Buffer.from(cleaned, 'utf-8').toString('base64');
    return JSON.stringify({ enc: canEncrypt, data });
  } catch {
    return JSON.stringify({ enc: false, data: Buffer.from(cleaned, 'utf-8').toString('base64') });
  }
}

export function decryptBlogPassword(encrypted?: string): string {
  const raw = (encrypted || '').trim();
  if (!raw) return '';
  try {
    const wrapper = JSON.parse(raw) as { enc?: boolean; data?: string };
    if (wrapper && typeof wrapper.data === 'string') {
      const buf = Buffer.from(wrapper.data, 'base64');
      return wrapper.enc ? safeStorage.decryptString(buf) : buf.toString('utf-8');
    }
  } catch {
    // Fall back cleanly if raw value wasn't JSON
  }
  return '';
}

/**
 * Finds the native installed Google Chrome or Microsoft Edge executable on Windows
 */
export function findInstalledBrowserExecutablePath(): { path: string; name: 'chrome' | 'edge' } | null {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

  const chromeCandidates = [
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ];
  for (const c of chromeCandidates) {
    if (fs.existsSync(c)) return { path: c, name: 'chrome' };
  }

  const edgeCandidates = [
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (const e of edgeCandidates) {
    if (fs.existsSync(e)) return { path: e, name: 'edge' };
  }

  return null;
}

/**
 * Launches an authentic, clean native Chrome/Edge browser window for user login.
 * BYPASSES GOOGLE BOT DETECTION 100%:
 * Google Accounts blocks any browser attached to Playwright's remote debugging pipe
 * with "This browser or app may not be secure".
 * By launching the user's authentic installed Chrome directly without CDP/automation flags,
 * Google login, Kakao Google OAuth, passkeys, and 2FA work completely unhindered.
 * Once the user finishes login and closes the window, the session is preserved in the profile.
 */
export async function launchNativeBrowserLoginSession(params: {
  profileDir: string;
  targetUrl: string;
  serviceName: string;
  checkAuthSuccess?: (cookies: CookieList) => boolean;
}): Promise<{ loggedIn: boolean; message: string; cookies: CookieList }> {
  const normalizedDir = path.resolve(params.profileDir);

  // Close any active Playwright context first to release filesystem locks
  const existing = activeBrowserContexts.get(normalizedDir);
  if (existing) {
    try {
      await existing.close();
    } catch {}
    activeBrowserContexts.delete(normalizedDir);
  }

  if (!fs.existsSync(normalizedDir)) {
    fs.mkdirSync(normalizedDir, { recursive: true });
  }

  const lockFile = path.join(normalizedDir, 'SingletonLock');
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }

  const installed = findInstalledBrowserExecutablePath();
  if (!installed) {
    // If no installed Chrome/Edge is found, fallback to Playwright context
    const ctx = await launchPersistentBrowserContext(normalizedDir, false);
    const page = ctx.pages()[0] || (await ctx.newPage());
    await page.goto(params.targetUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await new Promise<void>((resolve) => {
      ctx.on('close', () => resolve());
      page.on('close', async () => {
        try {
          await ctx.close();
        } catch {}
        resolve();
      });
    });
    const finalCookies = await ctx.cookies().catch(() => []);
    const isAuthed = params.checkAuthSuccess
      ? params.checkAuthSuccess(finalCookies)
      : finalCookies.length > 0;
    return {
      loggedIn: isAuthed,
      message: isAuthed
        ? `${params.serviceName} 로그인 세션 저장이 완료되었습니다!`
        : `${params.serviceName} 로그인이 확인되지 않았습니다. 다시 시도해 주세요.`,
      cookies: finalCookies,
    };
  }

  // Launch genuine native Chrome/Edge: zero automation flags, zero CDP pipe
  const child = spawn(
    installed.path,
    [
      `--user-data-dir=${normalizedDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--lang=ko-KR',
      params.targetUrl,
    ],
    {
      detached: false,
      stdio: 'ignore',
    }
  );
  activeNativeLoginProcesses.add(child);

  // Wait for the user to complete login and close the browser window
  await new Promise<void>((resolve) => {
    const done = () => {
      activeNativeLoginProcesses.delete(child);
      resolve();
    };
    child.on('exit', done);
    child.on('close', done);
    child.on('error', done);
  });

  if (isTaskCancelled()) {
    throw new Error('TASK_CANCELLED');
  }

  // Brief delay for Chrome to release file handles
  await new Promise((r) => setTimeout(r, 1200));

  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch {}
  }

  // Open a brief headless Playwright context to inspect and back up the saved cookies
  let cookies: CookieList = [];
  try {
    const ctx = await launchPersistentBrowserContext(normalizedDir, true);
    cookies = await ctx.cookies();
    await backupContextCookies(ctx, normalizedDir);
    await ctx.close();
  } catch {
    // ignore
  }

  const isAuthed = params.checkAuthSuccess ? params.checkAuthSuccess(cookies) : cookies.length > 0;

  return {
    loggedIn: isAuthed,
    message: isAuthed
      ? `${params.serviceName} 로그인 세션 확인 및 프로필 저장이 완료되었습니다!`
      : `${params.serviceName} 브라우저 창이 닫혔습니다. 로그인 완료 후 다시 시도해 주세요.`,
    cookies,
  };
}

export async function launchPersistentBrowserContext(
  profileDir: string,
  headless: boolean = false
): Promise<BrowserContext> {
  const normalizedDir = path.resolve(profileDir);

  // If an existing context for this profileDir is already open, close it cleanly first to avoid Chromium SingletonLock crash
  const existing = activeBrowserContexts.get(normalizedDir);
  if (existing) {
    try {
      await existing.close();
    } catch {
      // ignore
    }
    activeBrowserContexts.delete(normalizedDir);
  }

  if (!fs.existsSync(normalizedDir)) {
    fs.mkdirSync(normalizedDir, { recursive: true });
  }

  // Remove stale SingletonLock file if left behind by an abruptly killed browser process
  const lockFile = path.join(normalizedDir, 'SingletonLock');
  if (fs.existsSync(lockFile)) {
    try {
      fs.unlinkSync(lockFile);
    } catch {
      // ignore if locked
    }
  }

  const baseOptions = {
    headless,
    chromiumSandbox: true,
    ignoreDefaultArgs: [
      '--enable-automation',
      '--no-sandbox',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled',
      '--unsafely-disable-devtools-self-xss-warnings',
      '--enable-unsafe-swiftshader',
    ],
    locale: 'ko-KR',
    viewport: { width: 1366, height: 900 },
    args: [] as string[],
  };

  for (const channel of ['chrome', 'msedge', undefined] as const) {
    try {
      const ctx = await chromium.launchPersistentContext(normalizedDir, {
        ...baseOptions,
        ...(channel ? { channel } : {}),
      });
      await ctx.addInitScript(() => {
        try {
          Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', {
            get: () => false,
            configurable: true,
          });
        } catch {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true,
          });
        }
        Object.defineProperty(navigator, 'languages', {
          get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        });
        if (!(window as any).chrome) {
          (window as any).chrome = {
            runtime: {},
            loadTimes: () => ({}),
            csi: () => ({}),
            app: { isInstalled: false },
          };
        }
        try {
          for (const key of Object.keys(window)) {
            if (/^(cdc_|__pw|__playwright)/i.test(key)) {
              delete (window as any)[key];
            }
          }
        } catch {
          // ignore
        }
      });
      // Restore previously backed-up login cookies (survives Chrome dropping session cookies)
      await restoreContextCookies(ctx, normalizedDir);

      // Back up cookies every 3 seconds while the browser is open, and right before any close()
      const backupTimer = setInterval(() => {
        void backupContextCookies(ctx, normalizedDir);
      }, 3000);
      const originalClose = ctx.close.bind(ctx);
      (ctx as any).close = async (...closeArgs: any[]) => {
        clearInterval(backupTimer);
        await backupContextCookies(ctx, normalizedDir);
        return (originalClose as any)(...closeArgs);
      };

      activeBrowserContexts.set(normalizedDir, ctx);
      ctx.on('close', () => {
        clearInterval(backupTimer);
        if (activeBrowserContexts.get(normalizedDir) === ctx) {
          activeBrowserContexts.delete(normalizedDir);
        }
      });
      return ctx;
    } catch {
      // Try next channel
    }
  }

  throw new Error('브라우저 실행에 실패했습니다. 이미 열려 있는 자동화 브라우저 창이 있다면 닫고 다시 시도해주세요.');
}

function splitHeadlineIntoLines(text: string, maxLenPerLine: number = 15): [string, string] {
  const words = (text || '').trim().split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if ((cur + ' ' + w).length <= maxLenPerLine) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length >= 2) break;
    }
  }
  if (cur && lines.length < 2) {
    lines.push(cur);
  }
  return [lines[0] || text.slice(0, 15), lines[1] || ''];
}

export function generateAutoThumbnailDataUrl(config: ThumbnailConfig): string {
  const width = config.aspectRatio === '1:1' ? 800 : config.aspectRatio === '16:9' ? 960 : 800;
  const height = config.aspectRatio === '1:1' ? 800 : config.aspectRatio === '16:9' ? 540 : 600;
  const escapeXml = (str: string) =>
    (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  const headline = config.headline || '핵심 가이드 총정리';
  const [line1Raw, line2Raw] = splitHeadlineIntoLines(headline, 14);
  const line1 = escapeXml(line1Raw);
  const line2 = escapeXml(line2Raw);
  const badge = escapeXml(config.badgeText || '핵심 요약');
  const sub = escapeXml(config.subHeadline || '한눈에 보는 비교표 & 실전 체크리스트');
  const footer = escapeXml(config.footerTag || '@BlogStater Studio');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${config.bgGradientFrom || '#1e293b'}" />
        <stop offset="100%" stop-color="${config.bgGradientTo || '#0f172a'}" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#bg)" />
    <rect x="44" y="44" width="${width - 88}" height="${height - 88}" rx="28" fill="rgba(15,23,42,0.38)" stroke="rgba(255,255,255,0.2)" stroke-width="2" />
    <rect x="84" y="96" width="${Math.max(180, badge.length * 22 + 44)}" height="46" rx="23" fill="${config.accentColor || '#38bdf8'}" />
    <text x="108" y="127" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="21" font-weight="800" fill="#09090b">${badge}</text>
    <text x="84" y="230" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="50" font-weight="900" fill="${config.textColor || '#ffffff'}">${line1}</text>
    ${line2 ? `<text x="84" y="295" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="50" font-weight="900" fill="${config.textColor || '#ffffff'}">${line2}</text>` : ''}
    <text x="84" y="${line2 ? 365 : 305}" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="25" font-weight="600" fill="rgba(241,245,249,0.9)">${sub}</text>
    <rect x="84" y="${height - 108}" width="90" height="6" fill="${config.accentColor || '#38bdf8'}" />
    <text x="84" y="${height - 70}" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="22" font-weight="700" fill="rgba(255,255,255,0.8)">${footer}</text>
  </svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

const PNG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32Png(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32Png(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function buildFallbackPureNodePngDataUrl(width: number, height: number, seed: string): string {
  const w = Math.max(64, Math.min(1200, Math.round(width)));
  const h = Math.max(64, Math.min(1200, Math.round(height)));
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const r0 = 15 + (hash & 15);
  const g0 = 23 + ((hash >>> 4) & 15);
  const b0 = 42 + ((hash >>> 8) & 31);

  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0;
    const t = y / Math.max(1, h - 1);
    const rr = Math.min(255, Math.round(r0 + t * 18));
    const gg = Math.min(255, Math.round(g0 + t * 24));
    const bb = Math.min(255, Math.round(b0 + t * 30));
    for (let x = 0; x < w; x++) {
      const px = rowStart + 1 + x * 4;
      const isAccentBar = y < 8;
      raw[px] = isAccentBar ? 56 : rr;
      raw[px + 1] = isAccentBar ? 189 : gg;
      raw[px + 2] = isAccentBar ? 248 : bb;
      raw[px + 3] = 255;
    }
  }
  // Unique seed pixels in corner
  raw[1] = hash & 255;
  raw[2] = (hash >>> 8) & 255;

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', idat),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function parseSvgDimensions(svgDataUrl: string): { width: number; height: number } {
  try {
    const b64 = svgDataUrl.replace(/^data:image\/svg\+xml;base64,/i, '');
    const svgText = Buffer.from(b64, 'base64').toString('utf-8');
    const wMatch = svgText.match(/\bwidth="(\d+)"/i);
    const hMatch = svgText.match(/\bheight="(\d+)"/i);
    return {
      width: wMatch ? Number(wMatch[1]) : 800,
      height: hMatch ? Number(hMatch[1]) : 400,
    };
  } catch {
    return { width: 800, height: 400 };
  }
}

const SVG_TO_PNG_BROWSER_SCRIPT = `(async function(svgDataUrl, w, h, seed) {
  const img = new Image();
  img.src = svgDataUrl;
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const dw = Math.max(100, (w || img.naturalWidth || 800) + (hash % 3));
  const dh = Math.max(100, (h || img.naturalHeight || 400) + ((hash >>> 3) % 3));
  const canvas = document.createElement('canvas');
  canvas.width = dw;
  canvas.height = dh;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, dw, dh);
  // Subtle unique corner pixel fingerprint so every generated PNG has a unique binary/perceptual hash
  ctx.fillStyle = 'rgba(' + (hash & 255) + ',' + ((hash >>> 8) & 255) + ',' + ((hash >>> 16) & 255) + ',0.02)';
  ctx.fillRect(0, 0, 2, 2);
  ctx.fillRect(dw - 2, dh - 2, 2, 2);
  return canvas.toDataURL('image/png');
})`;

export async function renderSvgDataUrlToPngDataUrl(
  svgDataUrl: string,
  uniqueSeed: string = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
): Promise<string> {
  if (!svgDataUrl) return svgDataUrl;
  if (/^data:image\/png;base64,/i.test(svgDataUrl)) return svgDataUrl;
  if (!/^data:image\/svg\+xml/i.test(svgDataUrl)) return svgDataUrl;

  const { width, height } = parseSvgDimensions(svgDataUrl);

  // Tier 1: Electron BrowserWindow Canvas 2D renderer (fast, native Korean system fonts)
  if (process.versions && process.versions.electron) {
    try {
      const electronMod = require('electron');
      const electronApp = electronMod?.app;
      const ElectronBrowserWindow = electronMod?.BrowserWindow;
      if (electronApp && electronApp.isReady() && ElectronBrowserWindow) {
        const existingWin = ElectronBrowserWindow.getAllWindows().find(
          (w: any) => w && !w.isDestroyed() && w.webContents && !w.webContents.isLoading()
        );
        if (existingWin) {
          const pngUrl = await existingWin.webContents.executeJavaScript(
            `(${SVG_TO_PNG_BROWSER_SCRIPT})(${JSON.stringify(svgDataUrl)}, ${width}, ${height}, ${JSON.stringify(uniqueSeed)})`
          );
          if (typeof pngUrl === 'string' && pngUrl.startsWith('data:image/png;base64,')) {
            return pngUrl;
          }
        } else {
          const hiddenWin = new ElectronBrowserWindow({
            show: false,
            width: Math.max(800, width + 40),
            height: Math.max(600, height + 40),
            webPreferences: { nodeIntegration: false, contextIsolation: true },
          });
          try {
            await hiddenWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body></body></html>'));
            const pngUrl = await hiddenWin.webContents.executeJavaScript(
              `(${SVG_TO_PNG_BROWSER_SCRIPT})(${JSON.stringify(svgDataUrl)}, ${width}, ${height}, ${JSON.stringify(uniqueSeed)})`
            );
            if (typeof pngUrl === 'string' && pngUrl.startsWith('data:image/png;base64,')) {
              return pngUrl;
            }
          } finally {
            try {
              if (!hiddenWin.isDestroyed()) hiddenWin.destroy();
            } catch {}
          }
        }
      }
    } catch {
      // Fall through to Playwright headless renderer
    }
  }

  // Tier 2: Playwright headless Chromium Canvas renderer (works in Node verification & background scripts)
  for (const channel of ['chrome', 'msedge', undefined] as const) {
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
      });
      const page = await browser.newPage();
      const pngUrl = await page.evaluate(
        async ({ svgUrl, w, h, seed }) => {
          const img = new Image();
          img.src = svgUrl;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('SVG_LOAD_FAILED'));
          });
          let hash = 2166136261;
          for (let i = 0; i < seed.length; i++) {
            hash ^= seed.charCodeAt(i);
            hash = Math.imul(hash, 16777619) >>> 0;
          }
          const dw = Math.max(100, (w || img.naturalWidth || 800) + (hash % 3));
          const dh = Math.max(100, (h || img.naturalHeight || 400) + ((hash >>> 3) % 3));
          const canvas = document.createElement('canvas');
          canvas.width = dw;
          canvas.height = dh;
          const ctx = canvas.getContext('2d');
          if (!ctx) return '';
          ctx.drawImage(img, 0, 0, dw, dh);
          ctx.fillStyle = `rgba(${hash & 255}, ${(hash >>> 8) & 255}, ${(hash >>> 16) & 255}, 0.02)`;
          ctx.fillRect(0, 0, 2, 2);
          ctx.fillRect(dw - 2, dh - 2, 2, 2);
          return canvas.toDataURL('image/png');
        },
        { svgUrl: svgDataUrl, w: width, h: height, seed: uniqueSeed }
      );
      if (typeof pngUrl === 'string' && pngUrl.startsWith('data:image/png;base64,')) {
        return pngUrl;
      }
    } catch {
      // try next channel
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }

  // Tier 3: Pure-Node PNG binary fallback (guarantees zero SVG leakage)
  return buildFallbackPureNodePngDataUrl(width, height, uniqueSeed);
}

export async function generateAutoThumbnailPngDataUrl(
  config: ThumbnailConfig,
  uniqueSeed?: string
): Promise<string> {
  const svgUrl = generateAutoThumbnailDataUrl(config);
  return renderSvgDataUrlToPngDataUrl(
    svgUrl,
    uniqueSeed || `${config.headline}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  );
}

export async function convertInlineSvgsToPngInMarkdown(
  markdown: string,
  uniquePrefix: string = `${Date.now()}`
): Promise<string> {
  if (!markdown || !markdown.includes('data:image/svg+xml')) return markdown;
  const regex = /(!\[[^\]]*\]\()(data:image\/svg\+xml;base64,[^)\s]+)(\))/gi;
  const matches = Array.from(markdown.matchAll(regex));
  if (matches.length === 0) return markdown;

  let result = markdown;
  for (let i = 0; i < matches.length; i++) {
    const fullMatch = matches[i][0];
    const prefix = matches[i][1];
    const svgUrl = matches[i][2];
    const suffix = matches[i][3];
    const pngUrl = await renderSvgDataUrlToPngDataUrl(svgUrl, `${uniquePrefix}-img-${i}`);
    result = result.replace(fullMatch, `${prefix}${pngUrl}${suffix}`);
  }
  return result;
}

export async function convertInlineSvgsToPngInHtml(
  html: string,
  uniquePrefix: string = `${Date.now()}`
): Promise<string> {
  if (!html || !html.includes('data:image/svg+xml')) return html;
  const regex = /(data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+)/gi;
  const matches = Array.from(new Set(html.match(regex) || []));
  let result = html;
  for (let i = 0; i < matches.length; i++) {
    const svgUrl = matches[i];
    const pngUrl = await renderSvgDataUrlToPngDataUrl(svgUrl, `${uniquePrefix}-html-${i}`);
    result = result.split(svgUrl).join(pngUrl);
  }
  return result;
}

/**
 * Unattended Live Web Reference Screenshot Capturer:
 * Discovers an official/authoritative page (or Naver integrated search result) for the target keyword,
 * opens it in Playwright headless Chromium, strips noisy popups/ads, captures a clean viewport screenshot,
 * and frames it into a unique 920x580 browser-bar PNG data URL.
 */
export async function captureLiveWebReferenceScreenshotPngDataUrl(
  keyword: string,
  referenceUrlOrText?: string
): Promise<string | null> {
  const cleanKw = (keyword || '').trim();
  if (!cleanKw || isTaskCancelled()) return null;

  const startedAt = Date.now();
  const naverNexearchUrl = `https://search.naver.com/search.naver?where=nexearch&sm=top_hty&query=${encodeURIComponent(
    cleanKw
  )}`;
  const candidateUrls: string[] = [];

  // 1. User-supplied explicit non-blog URL gets top priority
  if (referenceUrlOrText) {
    const explicitMatch = referenceUrlOrText.match(/https?:\/\/[^\s"'<>]+/i);
    if (
      explicitMatch &&
      !/blog\.naver\.com|tistory\.com|velog\.io|nid\.naver\.com/i.test(explicitMatch[0])
    ) {
      candidateUrls.push(explicitMatch[0].trim());
    }
  }

  // 2. Discover official/authority page URLs from Naver Nexearch
  try {
    const res = await fetch(naverNexearchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      const authoritySelector = [
        'a[href*=".go.kr"]',
        'a[href*=".or.kr"]',
        'a[href*="terms.naver.com"]',
        'a[href*="easylaw.go.kr"]',
        'a[href*="law.go.kr"]',
        'a[href*="bokjiro.go.kr"]',
        'a[href*="kinfa.or.kr"]',
        'a[href*="nhis.or.kr"]',
        'a[href*="nps.or.kr"]',
        'a[href*="hometax.go.kr"]',
        'a[href*="apple.com"]',
        'a[href*="samsung.com"]',
        'a[href*="nextjs.org"]',
        'a[href*="react.dev"]',
        'a[href*="github.com"]',
        'a[href*="developer.mozilla.org"]',
        'a[href*="learn.microsoft.com"]',
        'a[href*="n.news.naver.com/mnews/article/"]',
      ].join(', ');

      $(authoritySelector).each((_, el) => {
        if (candidateUrls.length >= 2) return;
        const href = ($(el).attr('href') || '').trim();
        if (
          /^https?:\/\//i.test(href) &&
          !/nid\.naver\.com|adcr\.naver\.com|searchad|cr\.shopping\.naver|javascript:/i.test(href) &&
          !candidateUrls.includes(href)
        ) {
          candidateUrls.push(href);
        }
      });
    }
  } catch {
    // Fallback cleanly to Naver integrated search capture
  }

  // Always include Naver integrated search result page as reliable final capture target
  if (!candidateUrls.includes(naverNexearchUrl)) {
    candidateUrls.push(naverNexearchUrl);
  }

  for (const channel of ['chrome', 'msedge', undefined] as const) {
    if (isTaskCancelled() || Date.now() - startedAt > 9500) break;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    try {
      browser = await chromium.launch({
        headless: true,
        ...(channel ? { channel } : {}),
      });
      const context = await browser.newContext({
        viewport: { width: 1200, height: 760 },
        locale: 'ko-KR',
        extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
      });
      const page = await context.newPage();

      let rawShotBase64 = '';
      let capturedUrl = '';

      for (const targetUrl of candidateUrls) {
        if (isTaskCancelled() || Date.now() - startedAt > 9200) break;
        try {
          await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 5200 });
          await page.waitForTimeout(850);

          const check = await page.evaluate(() => {
            const text = (document.body?.innerText || '').trim();
            const isBlocked =
              text.length < 80 ||
              /비정상적인\s*접근|로봇이\s*아닙니다|보안\s*확인|access\s*denied|403\s*forbidden|captcha/i.test(
                text.slice(0, 600)
              );
            return { ok: !isBlocked };
          });
          if (!check.ok) continue;

          // Strip noisy popups, fixed cookie banners, and ads before capturing
          await page.evaluate((isNaverSearch) => {
            const hideSelectors = [
              '[class*="popup"]',
              '[class*="modal"]',
              '[class*="cookie"]',
              '[id*="popup"]',
              '[class*="ad_area"]',
              '[class*="banner_ad"]',
              '.sp_ntotal_ad',
              '#ad_top',
              '.header_ad',
              'iframe[src*="ad"]',
            ];
            for (const sel of hideSelectors) {
              document.querySelectorAll(sel).forEach((el) => {
                const style = window.getComputedStyle(el);
                if (
                  style.position === 'fixed' ||
                  style.position === 'sticky' ||
                  sel.includes('ad') ||
                  sel.includes('cookie')
                ) {
                  (el as HTMLElement).style.setProperty('display', 'none', 'important');
                }
              });
            }
            if (isNaverSearch) {
              const header = document.querySelector('#header_wrap, .header_group');
              if (header) (header as HTMLElement).style.setProperty('position', 'static', 'important');
              window.scrollTo(0, 128);
            } else if (/n\.news\.naver\.com/i.test(location.hostname)) {
              window.scrollTo(0, 110);
            }
          }, /search\.naver\.com/i.test(targetUrl));

          await page.waitForTimeout(250);
          const buf = await page.screenshot({
            type: 'png',
            clip: { x: 0, y: 0, width: 1200, height: 680 },
          });
          if (buf && buf.length > 5000) {
            rawShotBase64 = buf.toString('base64');
            capturedUrl = targetUrl;
            break;
          }
        } catch {
          // Try next candidate URL
        }
      }

      if (!rawShotBase64) continue;

      let displayHost = 'search.naver.com';
      try {
        displayHost = new URL(capturedUrl).hostname.replace(/^www\./, '');
      } catch {}

      const seed = `${cleanKw}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const framedPng = await page.evaluate(
        async ({ shotB64, hostLabel, uniqueSeed }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${shotB64}`;
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('SHOT_LOAD_FAIL'));
          });

          let hash = 2166136261;
          for (let i = 0; i < uniqueSeed.length; i++) {
            hash ^= uniqueSeed.charCodeAt(i);
            hash = Math.imul(hash, 16777619) >>> 0;
          }

          const width = 920 + (hash % 3);
          const barHeight = 42;
          const height = 580 + ((hash >>> 3) % 3);
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return '';

          // Outer subtle frame
          ctx.fillStyle = '#f8fafc';
          ctx.fillRect(0, 0, width, height);

          // Top browser chrome bar
          ctx.fillStyle = '#f1f5f9';
          ctx.fillRect(0, 0, width, barHeight);
          ctx.strokeStyle = '#cbd5e1';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, barHeight);
          ctx.lineTo(width, barHeight);
          ctx.stroke();

          // Window dots
          const dotColors = ['#f87171', '#fbbf24', '#34d399'];
          dotColors.forEach((c, idx) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(20 + idx * 16, barHeight / 2, 5, 0, Math.PI * 2);
            ctx.fill();
          });

          // Address pill
          ctx.fillStyle = '#ffffff';
          ctx.strokeStyle = '#e2e8f0';
          ctx.beginPath();
          ctx.roundRect(80, 8, width - 160, 26, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#0f172a';
          ctx.font = '600 12px Pretendard, "Malgun Gothic", sans-serif';
          ctx.fillText(`HTTPS  ·  ${hostLabel}  (실시간 화면 참고)`, 94, 25);

          // Draw captured viewport screenshot
          ctx.drawImage(img, 0, barHeight, width, height - barHeight);

          // Unique edge micro-pixel signature
          ctx.fillStyle = `rgba(${hash & 255}, ${(hash >>> 8) & 255}, ${(hash >>> 16) & 255}, 0.02)`;
          ctx.fillRect(0, 0, 2, 2);
          ctx.fillRect(width - 2, height - 2, 2, 2);

          return canvas.toDataURL('image/png');
        },
        { shotB64: rawShotBase64, hostLabel: displayHost, uniqueSeed: seed }
      );

      if (typeof framedPng === 'string' && framedPng.startsWith('data:image/png;base64,')) {
        return framedPng;
      }
    } catch {
      // Try next browser channel
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }

  return null;
}

function buildStylePresetAndCloneGuide(blog: BlogProfile): string {
  const preset = blog.persona.writingStylePreset || 'friendly_neighbor';
  const sampleText = (blog.persona.styleSampleText || '').trim();

  let presetGuide = '';
  if (preset === 'practical_expert') {
    presetGuide = `- **선택된 문체 프리셋 [깔끔한 실전 노하우형]**: 군더더기 수식어를 줄이고, 실제 해본 사람이 핵심 절차와 팁을 시원시원하게 짚어주는 실용적인 말투(~해요, ~하시면 됩니다, ~가 핵심이에요)로 작성하세요.`;
  } else if (preset === 'calm_briefing') {
    presetGuide = `- **선택된 문체 프리셋 [차분한 금융·정책 브리핑형]**: 신뢰감 있고 차분한 설명 톤(~습니다, ~해요, ~편입니다)을 유지하며, 숫자와 계산 예시를 친절하게 풀어서 설명하세요.`;
  } else {
    presetGuide = `- **선택된 문체 프리셋 [친근한 이웃 경험담형]**: 이웃에게 일상 이야기를 건네듯 따뜻하고 공감 가는 구어체(~해요, ~더라고요, ~거든요, ~해봤어요)로 자연스럽게 작성하세요.`;
  }

  if (!sampleText) {
    return presetGuide;
  }

  // Analyze endings and habits from user's sample text
  const endings: string[] = [];
  if (/더라고요|더라구요/.test(sampleText)) endings.push('~더라고요');
  if (/거든요/.test(sampleText)) endings.push('~거든요');
  if (/네요/.test(sampleText)) endings.push('~네요');
  if (/습니다|ㅂ니다/.test(sampleText)) endings.push('~습니다');
  if (/해요|어요|아요/.test(sampleText)) endings.push('~해요/어요');
  if (/임\b|음\b/.test(sampleText)) endings.push('~임/음(음슴체)');

  const endingHint =
    endings.length > 0 ? `주로 사용하는 종결어미(${endings.join(', ')})` : '샘플 원고의 문장 호흡과 어조';

  return `${presetGuide}
- **[내 말투 복제(Style Cloning) 최우선 지침]**:
  아래는 블로그 운영자가 실제로 직접 작성한 글 샘플입니다. 이 샘플의 **${endingHint}, 문단 줄바꿈 간격, 어휘 선택 습관**을 똑같이 복제하여 같은 사람이 쓴 것처럼 작성하세요 (단, 첫머리 인사말은 넣지 말고 바로 본문으로 시작하세요):
  """
  ${sampleText.slice(0, 700)}
  """`;
}

function getCurrentLocalDateContext() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const halfLabel = month <= 6 ? '상반기' : '하반기';
  const quarter = Math.ceil(month / 3);
  return {
    now,
    year,
    month,
    day,
    halfLabel,
    quarter,
    fullDateKr: `${year}년 ${month}월 ${day}일`,
  };
}

/**
 * Rewrites lingering AI past-year present-tense phrasing (e.g. "2025년 현재",
 * "2025년 하반기 들어", "2025년 11월 기준"), strips opening greetings, awkward
 * opening year-month prefixes (e.g. "2026년 11월 요즘"), horizontal rules,
 * em-dashes, and markdown strikethroughs so posts read like natural human writing.
 */
export function enforceCurrentDateContextInMarkdown(markdown: string): string {
  if (!markdown || !markdown.trim()) return markdown;

  const { now, year, month, halfLabel, quarter } = getCurrentLocalDateContext();
  const staleYears = [year - 2, year - 1].filter((y) => y >= 2020);

  let result = markdown;

  if (staleYears.length > 0) {
    const staleYearPattern = staleYears.join('|');
    const pastReferenceContextRegex = /(?:작년|지난해|전년|전년도|당시|이전|예전|지난\s*해)\s*$/;
    const hasPastContextBefore = (src: string, offset: number): boolean =>
      pastReferenceContextRegex.test(src.slice(Math.max(0, offset - 16), offset));

    // 1. Year ranges framed as current/latest (e.g. "2024~2025년 현재", "2024-2025년 기준")
    result = result.replace(
      new RegExp(
        `(${staleYearPattern})\\s*[~\\-–]\\s*(${staleYearPattern})년(\\s*(?:현재|기준|기준으로|최신|트렌드|시점))`,
        'g'
      ),
      (match, _y1, _y2, suffix, offset: number, whole: string) =>
        hasPastContextBefore(whole, offset) ? match : `${year}년${suffix}`
    );

    // 2. "올해 2025년" / "금년 2025년"
    result = result.replace(
      new RegExp(`(올해|금년|금년도)(?:인)?\\s*(${staleYearPattern})년?`, 'g'),
      `$1 ${year}년`
    );

    // 3. Explicit month/day recency anchors:
    //    - Specific day ("2025년 11월 14일 기준") -> keep current year/valid date
    //    - Month-only ("2025년 11월 기준/현재/들어") -> natural "현재"/"최근" without mechanical year-month
    result = result.replace(
      new RegExp(
        `(${staleYearPattern})년\\s*(1[0-2]|0?[1-9])월(?:\\s*(3[01]|[12]?[0-9])일)?(\\s*(?:기준으로|기준|현재|시점|최신|무렵|들어))`,
        'g'
      ),
      (match, _y, mStr: string, dStr: string | undefined, suffix: string, offset: number, whole: string) => {
        if (hasPastContextBefore(whole, offset)) return match;
        const m = Number(mStr);
        const d = dStr ? Number(dStr) : undefined;
        if (d !== undefined) {
          const candidate = new Date(year, m - 1, d);
          if (candidate.getTime() <= now.getTime()) {
            return `${year}년 ${m}월 ${d}일${suffix}`;
          }
          return `${year}년 ${month}월${suffix}`;
        }
        const trimmedSuffix = suffix.trim();
        if (trimmedSuffix === '들어') return '최근 들어';
        if (trimmedSuffix === '현재' || trimmedSuffix === '시점') return trimmedSuffix;
        if (trimmedSuffix === '기준' || trimmedSuffix === '기준으로') return `최근 ${trimmedSuffix}`;
        return `${year}년 ${m <= month ? m : month}월${suffix}`;
      }
    );

    // 4. Half-year / quarter present-tense anchors ("2025년 하반기 들어", "2025년 상반기 기준")
    result = result.replace(
      new RegExp(
        `(${staleYearPattern})년\\s*(상반기|하반기)([가-힣]*\\s*(?:들어|접어들어|현재|기준으로|기준|시점|최신|트렌드|부터|이후))`,
        'g'
      ),
      (match, _y, _half, suffix: string, offset: number, whole: string) =>
        hasPastContextBefore(whole, offset) ? match : `${year}년 ${halfLabel}${suffix}`
    );
    result = result.replace(
      new RegExp(
        `(${staleYearPattern})년\\s*([1-4]분기)([가-힣]*\\s*(?:들어|접어들어|현재|기준으로|기준|시점|최신|트렌드))`,
        'g'
      ),
      (match, _y, _q, suffix: string, offset: number, whole: string) =>
        hasPastContextBefore(whole, offset) ? match : `${year}년 ${quarter}분기${suffix}`
    );

    // 5. General present-tense / evergreen-guide markers attached to stale years
    result = result.replace(
      new RegExp(
        `(${staleYearPattern})(년도?)(\\s*(?:현재|기준으로|기준|최신|들어|접어들어|시점|지금|오늘날|최근|요즘|올해|핵심\\s*가이드|가이드|총정리|완벽\\s*정리|트렌드))`,
        'g'
      ),
      (match, _y, unit: string, suffix: string, offset: number, whole: string) =>
        hasPastContextBefore(whole, offset) ? match : `${year}${unit}${suffix}`
    );

    // 6. Bare past-year prefix in "YYYY년 ... (기준|현재)" short clauses where month isn't present
    result = result.replace(
      new RegExp(`(${staleYearPattern})년(\\s+(?:초|중순|말|연초|연말)\\s*(?:현재|기준으로|기준|들어))`, 'g'),
      (match, _y, suffix: string, offset: number, whole: string) =>
        hasPastContextBefore(whole, offset) ? match : `${year}년${suffix}`
    );
  }

  // 7. Strip AI-looking markdown strikethroughs, standalone horizontal rules, and em-dashes
  result = result.replace(/~~(.*?)~~/g, '$1');
  result = result.replace(/^\s*[-*_]{3,}\s*$/gm, '');
  result = result.replace(/\s*—\s*/g, ' ');

  // 8. Strip opening greetings at the very start of the article (standalone lines or inline opening sentence)
  result = result.trimStart();
  for (let pass = 0; pass < 3; pass++) {
    const before = result;
    result = result
      .replace(/^(?:안녕하세요|반갑습니다|블로그에\s*오신|방문해\s*주셔서|오늘도\s*방문)[^\n]{0,80}(?:\r?\n+|$)/i, '')
      .replace(
        /^(?:안녕하세요|반갑습니다)[^.!?\n~]*(?:[.!?~]+(?:\s*[:;][)D])?|\s*[:;][)D]|\s*\^\^)\s*(?:반갑습니다[^.!?\n]*(?:[.!?~]+(?:\s*[:;][)D])?|\s*[:;][)D]|\s*\^\^)\s*)?/i,
        ''
      )
      .trimStart();
    if (result === before) break;
  }

  // 9. Remove awkward mechanical year-month date prefixes in openings, sentences, and subheadings
  result = result
    .replace(
      /^202\d년\s*\d{1,2}월(?:\s*\d{1,2}일)?\s*(?:(요즘)|(?:현재|기준으로|기준|들어서는|들어서|들어|최근에는|최근)?)\s*,?\s*/gm,
      (_m, yozm: string | undefined) => (yozm ? '요즘 ' : '')
    )
    .replace(/^202\d년\s*(?:상반기|하반기)?\s*(?:현재|기준으로|기준|들어서는|들어서|들어)\s*,?\s*/gm, '')
    .replace(/요즘\s+202\d년\s*\d{1,2}월\s*(?:들어서는|들어서|들어|현재|기준)?\s*/g, '요즘 ')
    .replace(/오늘은\s+202\d년\s*\d{1,2}월\s*(?:기준으로|기준|현재)\s*/g, '오늘은 ')
    .replace(/(^##+\s+[^\n]*?),\s*202\d년\s*\d{1,2}월\s*(?:현재|기준)\s*/gm, '$1 ')
    .replace(/(^##+\s+[^\n]*?)202\d년\s*\d{1,2}월\s*(?:현재|기준)\s*/gm, '$1')
    .replace(/특히\s+202\d년\s*\d{1,2}월\s*현재는\s*/g, '특히 최근에는 ')
    .replace(/202\d년\s*\d{1,2}월\s*현재\s*/g, '현재 ')
    .replace(/202\d년\s*\d{1,2}월\s*기준으로\s*/g, '최근 기준으로 ')
    .replace(/[^\n]*핵심\s*배경부터\s*(?:주요\s*쟁점[,\s]*(?:그리고\s*)?)?앞으로의\s*전망까지[^\n]*(?:\r?\n+)?/g, '')
    .replace(/\s*새\s*창\s*열림/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return result;
}

export interface TopicDepthProfile {
  id:
    | 'deep_technical_guide'
    | 'deep_policy_finance_simulation'
    | 'comparison_review_decision'
    | 'concise_issue_briefing';
  label: string;
  targetCharRange: string;
  sectionCountGuide: string;
  structuralRules: string[];
}

export function cleanClumsyBlogTitle(rawTitle: string, fallbackKeyword?: string): string {
  const original = (rawTitle || '').trim();
  if (!original) return original;
  const cleaned = original
    .replace(/^(?:요즘\s*주목받는|한눈에\s*읽는|아직도\s*헷갈리는)\s+/i, '')
    .replace(
      /[,·:\s]*(?:왜\s*화제일까\??\s*)?핵심\s*배경과\s*(?:앞으로의\s*)?(?:주요\s*)?(?:쟁점|전망).*$/i,
      ''
    )
    .replace(/[,·:\s]*:\s*핵심\s*쟁점과\s*꼭\s*알아야\s*할\s*포인트\.?$/i, '')
    .replace(/[,·:\s]*복잡한\s*흐름\s*핵심만\s*콕\s*집어.*$/i, '')
    .replace(/[,·:\s]*핵심\s*조건과\s*실제\s*혜택.*$/i, '')
    .replace(/[,·:\s]*무슨\s*일일까\??\s*배경부터\s*실제\s*영향까지.*$/i, '')
    .replace(/[,·:\s]*내가\s*대상일까\??\s*최신\s*기준과.*$/i, '')
    .replace(/[,·:\s]*변경된\s*기준과\s*신청\s*전\s*꼭\s*알아둘\s*점\.?$/i, '')
    .replace(/[,·:\s]*핵심\s*내용과\s*대응\s*방법\s*(?:알기\s*쉽게\s*)?정리\.?$/i, '')
    .replace(/[,·:\s]*핵심만\s*콕\s*집어\s*(?:풀어드립니다|정리했습니다|정리했어요)\.?$/i, '')
    .replace(
      /[,·:\s]*(?:알기\s*쉽게|한눈에|차근차근|쉽게)\s*(?:정리해\s*드릴게요|정리해\s*드립니다|정리했어요|정리했습니다|풀어드릴게요|풀어드립니다)\.?$/i,
      ''
    )
    .replace(/[,·:\s]+(?:정리해\s*드릴게요|정리해드릴게요|정리해\s*드립니다|정리해드립니다|총정리)\.?$/i, '')
    .replace(/[,·:\-\s]+$/, '')
    .trim();

  const isLegacyTemplate = LEGACY_CLUMSY_TITLE_REGEX.test(original);
  const hasDanglingVerbTail = /\s+(?:외쳐|외친|밝혀|밝힌|전해|말해|호소|촉구|열고)$/.test(cleaned);
  if (isLegacyTemplate || hasDanglingVerbTail || (fallbackKeyword && cleaned === fallbackKeyword.trim())) {
    const cleanSeed = extractCleanKoreanTopicPhrase(cleaned || fallbackKeyword || original, fallbackKeyword);
    const candidates = generateViralTitlesForKeyword(cleanSeed || fallbackKeyword || original);
    if (candidates[0]) return candidates[0];
  }

  return cleaned.length >= 8 ? cleaned : original;
}

export function classifyTopicDepthProfile(keyword: string, blog: BlogProfile): TopicDepthProfile {
  const kw = (keyword || '').trim();
  const isPureLaunchOrAwardNews =
    /베스트\s*앱|선정|수상|실적\s*발표|영업이익|인사|체결|출시\s*임박|사전\s*판매/i.test(kw) &&
    !/구현|코드|설치|세팅|설정|사용법|연동|배포|최적화|튜닝|패치|취약점/i.test(kw);

  const isTechKeyword =
    /(?:구현|코드|함수|훅|아키텍처|설치|세팅|설정|연동|배포|최적화|튜닝|패치|취약점|보안\s*점검|cve|next\.?js|react|typescript|타입스크립트|javascript|자바스크립트|python|파이썬|java|자바|openjdk|spring|node\.?js|docker|도커|kubernetes|쿠버네티스|aws|cloudflare|postgresql|mysql|redis|rag|llm|ollama|mcp|github\s*actions|ci\/cd|프롬프트|바이브\s*코딩)/i.test(
      kw
    );

  const isDevBlog = (blog.nicheKeywords || []).some((nk) =>
    /개발|프로그래밍|코딩|클라우드|엔지니어링/i.test(nk)
  );

  if (isTechKeyword || (isDevBlog && !isPureLaunchOrAwardNews && /ai|클라우드|api|서버|앱|에이전트|모델/i.test(kw))) {
    return {
      id: 'deep_technical_guide',
      label: '심층 실무 기술 가이드',
      targetCharRange: '공백 제외 2,600~3,800자 이상',
      sectionCountGuide: 'H2 소제목 5~6개',
      structuralRules: [
        '독자가 바로 복사해 실행할 수 있는 **실전 코드 블록(```) 또는 CLI·설정 예시를 최소 2~3개 이상** 반드시 포함하세요. (추상적인 개념 설명만 나열 금지)',
        '원리(Why) → 단계별 실전 구현·설정(How) → 실무에서 자주 겪는 에러·보안·성능 주의점(Troubleshooting)까지 깊이 있게 전개하세요.',
        '관련 없는 타 분야(법률·금융·다른 프레임워크 등)를 억지로 끼워 넣지 말고 오직 해당 기술 주제의 실무 디테일에 집중하세요.',
      ],
    };
  }

  if (
    isPolicyOrFinanceApplyTopic(kw) ||
    /금리|예금|적금|대출|주담대|청약|전세|월세|부동산|연금|세금|절세|연말정산|종합소득세|건강보험|건보료|지원금|장려금|환급|공제|배당|isa|irp|파킹통장|dsr|보증보험/i.test(
      kw
    )
  ) {
    return {
      id: 'deep_policy_finance_simulation',
      label: '심층 금융·정책 실전 시뮬레이션',
      targetCharRange: '공백 제외 2,400~3,400자 이상',
      sectionCountGuide: 'H2 소제목 4~5개',
      structuralRules: [
        '실제 금액(예: 1,000만 원 / 3억 원 / 월 100만 원 등)과 기간·이자소득세 15.4%·감액률·한도를 직접 대입한 **구체적인 세후 손익 시뮬레이션 계산**을 반드시 포함하세요.',
        '조건이나 기간에 따른 차이를 한눈에 비교할 수 있는 **깔끔한 마크다운 표(Table) 1개**를 본문에 포함하세요.',
        '자격 요건·소득 기준뿐 아니라 중도해지 손실, 지급 정지 조건 등 **모르면 손해 보는 현실적인 예외·주의사항**을 명확히 짚어주세요.',
      ],
    };
  }

  const intent = detectSearchIntent(kw);
  if (
    intent === 'comparison' ||
    intent === 'review' ||
    intent === 'commercial' ||
    /비교|vs|차이|장단점|추천|가성비|스펙|후기|리뷰|단점|고르는법|요금제/i.test(kw)
  ) {
    return {
      id: 'comparison_review_decision',
      label: '비교·선택 결정 가이드',
      targetCharRange: '공백 제외 2,000~2,800자',
      sectionCountGuide: 'H2 소제목 4개',
      structuralRules: [
        '핵심 스펙·가격·유지비용·장단점을 한눈에 대조할 수 있는 **마크다운 비교 표(Table) 1개**를 포함하세요.',
        '단순 스펙 나열에 그치지 말고, "어떤 상황에서는 A가 낫고, 어떤 경우에는 B가 나은지" 명확한 선택 기준과 현실적인 단점(트레이드오프)을 제시하세요.',
      ],
    };
  }

  return {
    id: 'concise_issue_briefing',
    label: '핵심 밀도 이슈 브리핑',
    targetCharRange: '공백 제외 1,300~1,900자 내외',
    sectionCountGuide: 'H2 소제목 3개',
    structuralRules: [
      '단일 이슈·뉴스·가벼운 주제이므로 **억지로 분량을 늘리거나 뜬구름 잡는 미래 전망으로 문단을 부풀리지 마세요.**',
      '1) 지금 주목받는 핵심 사실관계 → 2) 가장 중요한 쟁점 또는 혜택·변화 → 3) 독자가 실제로 확인해야 할 영향·체크포인트 3개 섹션으로 군더더기 없이 압축하세요.',
      '빈약한 추측성 문장 대신 확인된 팩트와 구체적 숫자 위주로 밀도 있게 작성하세요.',
    ],
  };
}

export function buildMasterSEOPrompt(params: {
  blog: BlogProfile;
  keyword: string;
  chosenTitle: string;
  subKeywords: string[];
  internalLinks: InternalLinkEntry[];
  matchedAffiliates: AffiliateItem[];
  customInstructions?: string;
  competitorHeadings?: string[];
  extractedKeyFacts?: string[];
  contentGaps?: string[];
  differentiationAngle?: string;
}): string {
  const {
    blog,
    keyword,
    chosenTitle,
    subKeywords,
    internalLinks,
    matchedAffiliates,
    customInstructions,
    competitorHeadings = [],
    extractedKeyFacts = [],
    contentGaps = [],
    differentiationAngle = '',
  } = params;

  const { year, month, halfLabel, fullDateKr } = getCurrentLocalDateContext();
  const prevYear = year - 1;
  const prevYear2 = year - 2;

  const styleGuide = buildStylePresetAndCloneGuide(blog);
  const depthProfile = classifyTopicDepthProfile(keyword, blog);

  const ragFactsSection =
    competitorHeadings.length > 0 ||
    extractedKeyFacts.length > 0 ||
    contentGaps.length > 0 ||
    Boolean(differentiationAngle)
      ? `\n## 2. 경쟁글 빈틈(Information Gap) 역공략 & 팩트 검증 자료 [유사문서 회피 필수]
${differentiationAngle ? `- **핵심 차별화 각도**: ${differentiationAngle}\n` : ''}${
  contentGaps.length > 0
    ? `- **상위 1~3위 글에서 빠진 정보 빈틈(반드시 본문 초반과 독립 H2 소제목으로 배치할 것)**:\n${contentGaps
        .slice(0, 3)
        .map((g, i) => `  ${i + 1}. ${g}`)
        .join('\n')}\n`
    : ''
}${
  competitorHeadings.length > 0
    ? `- **상위 블로그 기존 소제목 (절대 그대로 베끼거나 순서를 따라 쓰지 말고, 더 구체적인 실전 질문으로 재설계하세요)**: ${competitorHeadings
        .slice(0, 5)
        .map((h) => `"${h}"`)
        .join(' / ')}\n`
    : ''
}${
          extractedKeyFacts.length > 0
            ? `- **팩트 검증 참고 수치 (문장을 복제하지 말고 '${keyword}'와 직접 관련된 수치·기준만 골라 내 경험담 문체로 재구성하세요)**:\n${extractedKeyFacts
                .slice(0, 6)
                .map((f) => `  · ${f}`)
                .join('\n')}\n`
            : ''
        }`
      : '';

  return `[시스템 역할: 대한민국 파워블로거 '${blog.name}']
당신은 실제 사람 블로거 '${blog.name}'입니다.
독자들은 AI가 쓴 글(장황하고 뻔한 제목, 억지 분량 늘리기, 주제와 상관없는 이야기 섞기, 딱딱한 보고서 문체)을 단 1초 만에 알아채고 이탈합니다.
'누가 봐도 사람이 직접 고민하고 핵심을 짚어 쓴 글'처럼 생생하고 밀도 있게 작성하세요.

## 0. 작성 시점 및 최신성 절대 기준 (오늘 날짜: ${fullDateKr})
- **현재 시각**: 오늘은 **${fullDateKr}(${year}년 ${halfLabel})**입니다. 본문 내용은 반드시 현재 기준의 최신 제도·수치·동향을 바탕으로 작성하세요.
- **과거 연도 착오 엄금**: 과거 학습 기억 때문에 **${prevYear2}년, ${prevYear}년**을 마치 '현재', '올해', '최근', '하반기 들어', '${prevYear}년 기준'처럼 쓰는 오류를 절대 범하지 마세요. 이전 연도(${prevYear}년 이전) 사건·제도를 언급할 때는 '지난해(${prevYear}년)', '예전(${prevYear}년)' 등 명확한 과거 비교 맥락으로만 구분하세요.
- **날짜/연월로 글 시작 절대 금지**: 첫 문장이나 문단·소제목 시작에 '${year}년 ${month}월 요즘', '${year}년 ${month}월 현재', '${year}년 ${month}월 기준'처럼 연도·월을 박아서 시작하는 어색한 포맷을 절대 사용하지 마세요.

## 1. 포스팅 정보 & 맞춤형 깊이/분량 프로파일
- **핵심 타겟 키워드**: ${keyword}
- **참고 제목 방향**: ${chosenTitle}
- **관련 관심 주제**: ${subKeywords.join(', ')}
- **주제 분류**: ${classifySubCategory(keyword)}
- **적용 분량 프로파일 [${depthProfile.label}]**:
  · **목표 분량**: **${depthProfile.targetCharRange}** (${depthProfile.sectionCountGuide})
${depthProfile.structuralRules.map((r) => `  · ${r}`).join('\n')}
${styleGuide}
${ragFactsSection}
## 3. 제목·집중도·AI 티 제거 필수 지침 [필독]

0. **[클릭을 부르는 간결한 제목(TITLE) & 단일 주제 100% 집중 원칙]**:
   - 응답의 **가장 첫 번째 줄**에 본문 내용과 주제에 딱 맞고 클릭하고 싶어지는 제목을 'TITLE: 여기에 제목 작성' 형식으로 한 줄 출력하세요.
   - **제목 작성 절대 규칙 (20~36자 내외 권장)**:
     · 독자의 호기심·실익·구체적 수치나 대비가 한눈에 들어오도록 간결하고 임팩트 있게 지으세요.
     · **장황하고 촌스러운 AI식 어미 절대 금지**: '~정리해드릴게요', '~정리해 드립니다', '~정리했어요', '~알기 쉽게 정리했어요', '핵심 배경과 앞으로의 전망 정리', '무슨 일일까?', '총정리' 같은 표현을 제목에 절대 넣지 마세요.
     · 좋은 제목 예: \`Next.js 15 서버 액션, API 라우트 없이 폼 3배 빠르게 만드는 법\` / \`국민연금 5년 일찍 받으면 손해일까? 손익분기점 직접 계산\` / \`금리 오른다는데 예금 3개월 vs 1년, 1천만 원 이자 차이\`
   - **바로 다음 줄**에 검색 유입에 유리한 2~8글자 명사형 핵심 태그 5~6개를 'TAGS: 태그1, 태그2, 태그3, 태그4, 태그5' 형식으로 출력한 뒤, 빈 줄을 두고 본문을 시작하세요. (조사·동사·형용사·'#' 기호 제외, 순수 명사 검색어만)
   - **단일 주제 집중(Topic Purity) 절대 원칙**: 오직 **'${keyword}'** 하나만 깊게 파고드세요. 관련 없는 타 분야 뉴스, 억지 비유, 다른 주제를 억지로 엮는 브릿지 문단을 절대 넣지 마세요. 참고 자료에 '${keyword}'와 무관한 내용이 있더라도 과감히 버리세요.
   - 주제가 인물·뉴스·시사·기술인데도 엉뚱하게 '핵심 조건', '실제 혜택', '신청 방법', '자격 조회' 같은 정책 지원금 용어를 끼워 넣는 행위를 절대 금지합니다.

1. **[인간적인 자연스러운 도입부 — 첫인사 및 뻔한 예고 멘트 절대 금지]**:
   - **첫인사·자기소개 절대 금지**: '안녕하세요', '반갑습니다', '안녕하세요 ○○입니다' 등 어떤 인사말도 넣지 마세요.
   - **뻔한 예고 문장 절대 금지**: '오늘은 ~에 대해 차근차근 정리해 드리려고 합니다', '핵심만 알기 쉽게 풀어드릴게요', '제가 직접 찾아보고 정리해 봤습니다' 같은 상투적 멘트 없이, 첫 문장부터 독자가 바로 겪는 문제나 핵심 사실로 들어가세요.
   - **글 시작에 연·월(날짜) 표기 절대 금지** & **취소선(~~) · 가로 구분선(---) · 긴 대시(—) 절대 금지**.
   - 본문 첫 줄에 '# 제목'을 중복해서 쓰지 마세요 (첫 줄 'TITLE: ...'만 출력).

2. **[주제 성격에 맞는 유동적 구조 — 기계적 붕어빵 공식 금지]**:
   - 모든 글의 분량을 똑같이 맞추려 하지 말고, 위 **적용 분량 프로파일 [${depthProfile.label}]**이 요구하는 깊이(${depthProfile.targetCharRange}, ${depthProfile.sectionCountGuide})에 정확히 맞추세요.
   - 기술·코딩 글은 실제 코드 블록과 트러블슈팅으로, 금융·정책 글은 실제 금액 시뮬레이션으로 깊이를 채우고, 단순 이슈·단신은 억지 늘리기 없이 군더더기만 빼서 날카롭게 쓰세요.

3. **[검색 키워드 억지 반복(Keyword Stuffing) 엄금]**:
   - 소제목마다 '${keyword}' 전체를 기계처럼 복사해 넣지 마세요!
   - 소제목은 독자가 진짜 궁금해하는 구체적 질문이나 핵심 결론으로 작성하세요.

4. **[어색한 번역투·보고서 말투 퇴출]**:
   - '이자 누적 곡선을 그리게 됩니다', '자산 형성을 완주하시길 응원합니다', '결정적 배경', '실전 관리 전략', '마지막 마인드셋' 같은 AI 특유의 표현은 절대 사용하지 마세요.

5. **[AEO (AI 브리핑 · 답변 엔진) 최적화 — 소제목 직후 두괄식 답변]**:
   - 각 소제목(##) 바로 아래 첫 1~2문장(40~200자)에는 독자의 질문에 대한 **핵심 결론이나 수치 요약**을 먼저 명쾌하게 제시한 뒤 상세 설명을 이어가세요.

6. **[GEO (출처 인용) 최적화 — 정량 팩트 밀도]**:
   - 추상적 미사여구 대신 **구체적인 수치(금액, %, 기간, 버전, 성능 지표, 공식 기관/서비스명)**를 본문 곳곳에 5개 이상 자연스럽게 녹여내세요.

7. **[스마트블록(D.I.A.+) & 모바일 가독성]**:
   - 실제 적용·계산 경험 시그널을 녹이고, 스마트폰 독자를 위해 1~2문장마다 엔터(빈 줄)를 넣어 여백을 두세요.

8. **[자연스러운 맺음말]**:
   - 훈계하거나 거창한 마인드셋을 강조하지 말고, '${blog.persona.signatureOutro || '읽어보시면서 궁금한 점이나 다뤄줬으면 하는 내용이 있으면 편하게 댓글 남겨주세요!'}'처럼 담백하게 마무리하세요.

${
  internalLinks.length > 0
    ? `9. **관련 글 자연스러운 연결**: 본문과 직접 관련 있는 아래 글이 흐름에 맞을 때만 자연스럽게 1회 언급하세요:\n${internalLinks
        .map((l) => `- [${l.title}](${l.url})`)
        .join('\n')}`
    : ''
}
${customInstructions ? `\n## 4. 추가 요청사항\n${customInstructions}` : ''}

위 프로파일(${depthProfile.targetCharRange}, ${depthProfile.sectionCountGuide})에 맞춰 군더더기 없이 높은 밀도로 작성해 주세요.`;
}

const WEB_AI_INPUT_SELECTORS: Partial<Record<WebAIProviderId, string[]>> = {
  chatgpt_plus: ['#prompt-textarea', 'div[contenteditable="true"]', 'textarea'],
  claude_pro: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]', 'fieldset textarea'],
  gemini_pro: ['rich-textarea div[contenteditable="true"]', 'div[contenteditable="true"]', 'textarea'],
  perplexity_pro: ['textarea[placeholder]', 'textarea', 'div[contenteditable="true"]'],
  deepseek_web: ['textarea#chat-input', 'textarea', 'div[contenteditable="true"]'],
  ollama_local: [],
};

const WEB_AI_SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="Send"]',
  'button[aria-label*="전송"]',
  'button[aria-label*="보내기"]',
  'button.send-button',
];

export async function openWebAILoginSession(
  provider: WebAISessionInfo,
  browserUserDataPath: string,
  browserAutomationEngine: 'aside' | 'playwright' = 'aside'
): Promise<{ loggedIn: boolean; message: string }> {
  if (browserAutomationEngine === 'aside') {
    if (!findAsideExecutable()) {
      return {
        loggedIn: false,
        message: 'Aside 프로그램이 설치되어 있지 않습니다. aside.com에서 Aside를 설치하거나 설정에서 Playwright 독립 엔진으로 전환해 주세요.',
      };
    }
    const inputSelectors = WEB_AI_INPUT_SELECTORS[provider.id] || ['textarea', 'div[contenteditable="true"]'];
    return checkOrOpenAsideWebAILogin({
      url: provider.url,
      name: provider.name,
      inputSelectors,
    });
  }

  const profileDir = path.join(browserUserDataPath, 'web-ai-shared-profile');

  return launchNativeBrowserLoginSession({
    profileDir,
    targetUrl: provider.url,
    serviceName: provider.name,
    checkAuthSuccess: (cookies) => {
      return cookies.some(
        (c) =>
          /session|token|auth|sid|__Secure|user|cf_clearance|HSID|SSID|APISID|SAPISID|__Host/i.test(
            c.name
          ) && c.value.length > 5
      );
    },
  });
}

async function tryAutomateBrowserWebAI(params: {
  provider: WebAISessionInfo;
  prompt: string;
  browserUserDataPath: string;
  headless: boolean;
  browserAutomationEngine?: 'aside' | 'playwright';
}): Promise<string | null> {
  const { provider, prompt, browserUserDataPath, headless, browserAutomationEngine = 'aside' } = params;
  if (!provider.loggedIn) {
    return null;
  }

  const candidateSelectors = WEB_AI_INPUT_SELECTORS[provider.id] || ['textarea', 'div[contenteditable="true"]'];

  if (browserAutomationEngine === 'aside') {
    if (!findAsideExecutable()) return null;
    const asideResult = await promptWebAIViaAside({
      url: provider.url,
      prompt,
      inputSelectors: candidateSelectors,
      sendButtonSelectors: WEB_AI_SEND_SELECTORS,
    });
    if (isTaskCancelled()) return null;
    return asideResult && asideResult.trim().length >= 200 ? asideResult : null;
  }

  const profileDir = path.join(browserUserDataPath, 'web-ai-shared-profile');
  let context: BrowserContext | null = null;

  try {
    context = await launchPersistentBrowserContext(profileDir, headless);
    const page = context.pages()[0] || (await context.newPage());
    await page.goto(provider.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(2500);

    const sendButtonSelectors = WEB_AI_SEND_SELECTORS;
    let inputFound = false;

    for (const sel of candidateSelectors) {
      const loc = page.locator(sel).first();
      if ((await loc.count()) > 0 && (await loc.isVisible())) {
        await loc.click();
        // Prefer Playwright's native fill() so we don't overwrite the user's OS clipboard; fallback to clipboard paste if fill() fails on custom contenteditable
        let filled = false;
        try {
          await loc.fill(prompt);
          filled = true;
        } catch {
          filled = false;
        }
        if (!filled) {
          const prevClip = clipboard.readText();
          clipboard.writeText(prompt);
          await page.keyboard.press('Control+V');
          await page.waitForTimeout(300);
          try {
            clipboard.writeText(prevClip);
          } catch {}
        }
        await page.waitForTimeout(500);

        // Try explicit Send button first, fallback to Enter
        let clickedSend = false;
        for (const btnSel of sendButtonSelectors) {
          const btn = page.locator(btnSel).first();
          if ((await btn.count()) > 0 && (await btn.isVisible()) && (await btn.isEnabled())) {
            await btn.click();
            clickedSend = true;
            break;
          }
        }
        if (!clickedSend) {
          await page.keyboard.press('Enter');
        }
        inputFound = true;
        break;
      }
    }

    if (!inputFound) {
      await context.close();
      return null;
    }

    await page.waitForTimeout(8000);
    let previousLength = 0;
    let stableChecks = 0;

    for (let i = 0; i < 28; i++) {
      if (isTaskCancelled()) {
        await context.close();
        return null;
      }
      await page.waitForTimeout(2000);
      if (isTaskCancelled()) {
        await context.close();
        return null;
      }

      // Check if Web AI displayed a quota / rate-limit / usage cap alert
      const hitQuotaLimit = await page.evaluate(() => {
        const bodyText = document.body?.innerText || '';
        return /reached your limit|usage cap|rate limit|too many requests|out of free messages|한도에 도달|사용량 초과|사용 한도|일일 한도|다시 시도해 주세요/i.test(
          bodyText.slice(-1500)
        );
      });
      if (hitQuotaLimit) {
        await context.close();
        return null;
      }

      // Convert rendered assistant HTML back to structured Markdown so tables, headings, lists, and blockquotes stay intact
      // Note: Do NOT include bare 'article' selector because ChatGPT wraps user prompts in <article> too!
      const markdownExtracted = await page.evaluate(() => {
        const containers = document.querySelectorAll(
          '[data-message-author-role="assistant"], .font-claude-message, message-content, model-response, .ds-markdown, .prose, .markdown'
        );
        if (containers.length === 0) return '';
        const root = containers[containers.length - 1] as HTMLElement;

        function domToMd(node: Node): string {
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent || '';
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          const el = node as HTMLElement;
          const tag = el.tagName.toLowerCase();
          const childrenMd = Array.from(el.childNodes).map(domToMd).join('');

          switch (tag) {
            case 'h1':
              return `\n# ${childrenMd.trim()}\n\n`;
            case 'h2':
              return `\n## ${childrenMd.trim()}\n\n`;
            case 'h3':
              return `\n### ${childrenMd.trim()}\n\n`;
            case 'h4':
              return `\n#### ${childrenMd.trim()}\n\n`;
            case 'p':
              return `${childrenMd.trim()}\n\n`;
            case 'strong':
            case 'b':
              return `**${childrenMd.trim()}**`;
            case 'em':
            case 'i':
              return `*${childrenMd.trim()}*`;
            case 'blockquote':
              return `\n> ${childrenMd.trim().replace(/\n/g, '\n> ')}\n\n`;
            case 'ul':
              return `\n${Array.from(el.children)
                .map((li) => `- ${domToMd(li).trim()}`)
                .join('\n')}\n\n`;
            case 'ol':
              return `\n${Array.from(el.children)
                .map((li, idx) => `${idx + 1}. ${domToMd(li).trim()}`)
                .join('\n')}\n\n`;
            case 'table': {
              const rows = Array.from(el.querySelectorAll('tr'));
              if (rows.length === 0) return childrenMd;
              const matrix = rows.map((r) =>
                Array.from(r.querySelectorAll('th, td')).map((cell) =>
                  (cell.textContent || '').trim().replace(/\|/g, '\\|').replace(/\n+/g, ' ')
                )
              );
              if (matrix[0].length === 0) return childrenMd;
              const headerLine = `| ${matrix[0].join(' | ')} |`;
              const sepLine = `| ${matrix[0].map(() => '---').join(' | ')} |`;
              const bodyLines = matrix.slice(1).map((row) => `| ${row.join(' | ')} |`);
              return `\n${[headerLine, sepLine, ...bodyLines].join('\n')}\n\n`;
            }
            case 'pre':
              return `\n\`\`\`\n${el.innerText.trim()}\n\`\`\`\n\n`;
            case 'hr':
              return `\n---\n\n`;
            case 'br':
              return '\n';
            default:
              return childrenMd;
          }
        }

        return domToMd(root).replace(/\n{3,}/g, '\n\n').trim();
      });

      if (markdownExtracted.length > 450 && markdownExtracted.length === previousLength) {
        stableChecks++;
        if (stableChecks >= 2) {
          await context.close();
          return markdownExtracted;
        }
      } else {
        stableChecks = 0;
        previousLength = markdownExtracted.length;
      }
    }

    await context.close();
    return null;
  } catch {
    if (context) {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
    return null;
  }
}

function getEnhancedEnv(): NodeJS.ProcessEnv {
  const agyBin = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'agy', 'bin') : '';
  const npmGlobal = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '';
  const localBin = process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.local', 'bin') : '';
  const currentPath = process.env.PATH || process.env.Path || '';
  return {
    ...process.env,
    PATH: [agyBin, npmGlobal, localBin, currentPath].filter(Boolean).join(path.delimiter),
  };
}

function checkCliExecutable(
  baseCmd: string
): Promise<{ installed: boolean; version?: string; resolvedPath?: string }> {
  const binary = baseCmd.trim().split(/\s+/)[0];
  return new Promise((resolve) => {
    exec(
      `where.exe ${binary}`,
      { env: getEnhancedEnv(), timeout: 3500, windowsHide: true },
      (whereErr, whereOut) => {
        if (!whereErr && whereOut.trim()) {
          const firstPath = whereOut.trim().split(/\r?\n/)[0].trim();
          resolve({
            installed: true,
            version: path.basename(firstPath),
            resolvedPath: firstPath,
          });
          return;
        }
        resolve({ installed: false });
      }
    );
  });
}

function queryAgyModels(): Promise<AIModelOption[]> {
  return new Promise((resolve) => {
    exec(
      'agy models',
      { env: getEnhancedEnv(), timeout: 5000, windowsHide: true },
      (_err, stdout) => {
        if (!stdout || !stdout.trim()) {
          resolve([]);
          return;
        }
        const models: AIModelOption[] = [];
        const lines = stdout.trim().split(/\r?\n/);
        for (const line of lines) {
          const parts = line.trim().split(/\t+|\s{2,}/);
          if (parts.length >= 2) {
            const id = parts[0].trim();
            const label = parts.slice(1).join(' ').trim();
            if (id && label) {
              models.push({ id, label: `${label} (${id})` });
            }
          } else if (parts.length === 1 && parts[0].trim()) {
            const id = parts[0].trim();
            models.push({ id, label: id });
          }
        }
        resolve(models);
      }
    );
  });
}

async function queryOllamaModels(): Promise<AIModelOption[]> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    if (!data?.models || data.models.length === 0) return [];
    return data.models.map((m) => ({
      id: m.name,
      label: `${m.name} (내 PC 설치됨)`,
    }));
  } catch {
    return [];
  }
}

export async function detectInstalledCLIs(
  sessions: WebAISessionInfo[]
): Promise<WebAISessionInfo[]> {
  const agyCheck = await checkCliExecutable('agy');
  const liveAgyModels = agyCheck.installed ? await queryAgyModels() : [];
  const liveOllamaModels = await queryOllamaModels();

  const updated: WebAISessionInfo[] = [];
  for (const s of sessions) {
    if (s.id === 'ollama_local') {
      const mergedOllamaModels =
        liveOllamaModels.length > 0 ? liveOllamaModels : s.availableModels || [];
      const chosenOllama =
        s.selectedModel && mergedOllamaModels.some((m) => m.id === s.selectedModel)
          ? s.selectedModel
          : mergedOllamaModels[0]?.id || s.selectedModel;
      updated.push({
        ...s,
        availableModels: mergedOllamaModels,
        selectedModel: chosenOllama,
      });
    } else if (s.connectionType === 'local_cli' || s.id.endsWith('_cli')) {
      const cmd = s.cliCommand || s.id.replace('_cli', '');
      const status = await checkCliExecutable(cmd);
      // If claude_cli is checked and standalone claude isn't installed, but agy is installed, agy provides claude-sonnet-5-5-high!
      const fallbackAgyForClaude = s.id === 'claude_cli' && !status.installed && agyCheck.installed;
      let availableModels = s.availableModels || [];
      if (s.id === 'agy_cli' && liveAgyModels.length > 0) {
        availableModels = liveAgyModels;
      } else if (s.id === 'claude_cli' && fallbackAgyForClaude && liveAgyModels.length > 0) {
        const claudeModelsFromAgy = liveAgyModels.filter((m) =>
          m.id.toLowerCase().includes('claude')
        );
        if (claudeModelsFromAgy.length > 0) {
          availableModels = claudeModelsFromAgy;
        }
      }
      updated.push({
        ...s,
        loggedIn: status.installed || fallbackAgyForClaude ? true : s.loggedIn,
        cliVersion: status.installed
          ? status.version
          : fallbackAgyForClaude
          ? 'agy (Claude 5.5 연동)'
          : s.cliVersion,
        availableModels,
        selectedModel:
          s.selectedModel || availableModels[0]?.id || 'gemini-4-argon-high',
      });
    } else {
      updated.push(s);
    }
  }
  return updated;
}

export async function openCliSetupTerminal(
  provider: WebAISessionInfo
): Promise<{ installed: boolean; version?: string; message: string }> {
  const cmd = (provider.cliCommand || 'agy').trim().split(/\s+/)[0];
  const installCmd = provider.cliInstallCmd || `npm install -g ${cmd}`;
  const beforeStatus = await checkCliExecutable(cmd);

  const psScript = beforeStatus.installed
    ? `Write-Host '====================================================' -ForegroundColor Cyan; Write-Host '[BlogStater] ${provider.name} 구독 계정 로그인/모델 확인 창입니다.' -ForegroundColor Green; Write-Host '로그인 확인 후 창을 닫으시면 됩니다.' -ForegroundColor Yellow; Write-Host '====================================================' -ForegroundColor Cyan; ${cmd}`
    : `Write-Host '====================================================' -ForegroundColor Cyan; Write-Host '[BlogStater] PC에 ${cmd} CLI가 아직 설치되지 않아 설치(${installCmd})를 시작합니다...' -ForegroundColor Yellow; Write-Host '====================================================' -ForegroundColor Cyan; ${installCmd}; if ($?) { ${cmd} }`;

  spawn('cmd.exe', ['/c', 'start', 'powershell.exe', '-NoExit', '-Command', psScript], {
    env: getEnhancedEnv(),
    detached: true,
    stdio: 'ignore',
  }).unref();

  return {
    installed: beforeStatus.installed,
    version: beforeStatus.version,
    message: beforeStatus.installed
      ? `PC에 '${cmd}' CLI(${beforeStatus.resolvedPath || beforeStatus.version})가 설치되어 있습니다! 열린 터미널 창에서 로그인을 확인해주세요.`
      : `열린 PowerShell 창에서 '${installCmd}' 설치 및 로그인을 진행합니다.`,
  };
}

function stripAnsiCodes(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').replace(/\r/g, '');
}

export async function tryGenerateWithSubscriptionCLI(
  provider: WebAISessionInfo,
  prompt: string,
  modelOverride?: string,
  options?: {
    timeoutMs?: number;
    minOutputLength?: number;
    rawOutputMode?: boolean;
  }
): Promise<{ content: string; modelUsed: string } | null> {
  const timeoutMs = options?.timeoutMs ?? 95000;
  const minOutputLength = options?.minOutputLength ?? 500;
  const rawOutputMode = options?.rawOutputMode ?? false;
  const rawCmd = (provider.cliCommand || '').trim();
  let baseBinary = rawCmd.split(/\s+/)[0] || provider.id.replace('_cli', '');
  let check = await checkCliExecutable(baseBinary);

  // If claude_cli is requested and standalone claude isn't installed, use agy --model claude-sonnet-5-5-high
  let useAgyClaudeModel = false;
  if (!check.installed && provider.id === 'claude_cli') {
    const agyCheck = await checkCliExecutable('agy');
    if (agyCheck.installed) {
      baseBinary = 'agy';
      check = agyCheck;
      useAgyClaudeModel = true;
    }
  }

  if (!check.installed) return null;

  // Guard against bare `gh` (GitHub CLI) with no AI subcommand, which would just print CLI --help text
  if (baseBinary.toLowerCase() === 'gh' && rawCmd.split(/\s+/).length < 2) {
    return null;
  }

  const chosenModel =
    (modelOverride && modelOverride.trim() !== '' && modelOverride !== 'default'
      ? modelOverride.trim()
      : provider.selectedModel && provider.selectedModel !== 'default'
      ? provider.selectedModel
      : useAgyClaudeModel
      ? 'claude-sonnet-5-5-high'
      : 'gemini-4-argon-high');

  return new Promise((resolve) => {
    const isAgy = provider.id === 'agy_cli' || baseBinary.toLowerCase().startsWith('agy');
    let spawnCmd = check.resolvedPath || baseBinary;
    let args: string[] = [];
    let useShell = true;
    let pipePromptViaStdin = true;
    let effectiveModelUsed = chosenModel;

    if (isAgy) {
      // Spawn agy.exe directly with shell: false so multiline prompt in -p=... is passed cleanly via Win32 CreateProcessW
      useShell = false;
      pipePromptViaStdin = false;
      const activeAgyModel = useAgyClaudeModel
        ? chosenModel.includes('claude')
          ? chosenModel
          : 'claude-sonnet-5-5-high'
        : chosenModel;
      effectiveModelUsed = activeAgyModel;
      const prefixRule =
        '[최우선 지침: 절대 search_web, read_file, run_command 등 어떤 도구(Tool)도 호출하지 마세요. 이미 아래 프롬프트에 제공된 정보와 지식을 바탕으로 즉시 결과 텍스트만 출력하세요.]\n\n';
      const suffixRule = rawOutputMode
        ? '[필수 규칙: 파일 읽기나 터미널 명령 등 어떤 도구(tool)도 호출하지 말고, 요청된 결과 텍스트(JSON)만 즉시 출력하세요.]'
        : '[필수 규칙: 파일 읽기나 터미널 명령 등 어떤 도구(tool)도 호출하지 말고, 첫 줄에 "TITLE: <클릭을 부르는 자연스러운 블로그 제목>", 둘째 줄에 "TAGS: <명사 태그 5~6개>", 빈 줄 후 마크다운(Markdown) 본문 텍스트를 즉시 출력하세요.]';
      const fullPrompt = `${prefixRule}${prompt}\n\n${suffixRule}`;
      args = [
        '--disable-slash-commands',
        '--dangerously-skip-permissions',
        '--model',
        activeAgyModel,
        `-p=${fullPrompt}`,
      ];
    } else if (provider.id === 'claude_cli' || baseBinary === 'claude') {
      const modelArgs =
        chosenModel && chosenModel !== 'default' ? ['--model', chosenModel] : [];
      args = [
        ...modelArgs,
        '-p',
        rawOutputMode
          ? '표준입력(stdin)으로 전달된 지침을 읽고, 부연 설명 없이 요청된 JSON 배열만 즉시 출력하세요.'
          : '표준입력(stdin)으로 전달된 블로그 원고 작성 지침을 읽고, 부연 설명 없이 첫 줄 "TITLE: ...", 둘째 줄 "TAGS: ..."와 완성된 마크다운(Markdown) 원고 본문만 즉시 출력하세요.',
      ];
    } else if (provider.id === 'codex_cli' || baseBinary === 'codex') {
      const modelArgs =
        chosenModel && chosenModel !== 'default' ? ['-m', chosenModel] : [];
      args = ['exec', ...modelArgs, '-'];
    } else {
      const customParts = rawCmd.split(/\s+/).slice(1);
      args = customParts.length > 0 ? customParts : [];
    }

    let stdoutData = '';
    let stderrData = '';
    let settled = false;
    let streamIdleTimer: ReturnType<typeof setTimeout> | null = null;
    let exitFlushTimer: ReturnType<typeof setTimeout> | null = null;

    if (isTaskCancelled()) {
      resolve(null);
      return;
    }

    const child = spawn(spawnCmd, args, {
      cwd: os.tmpdir(),
      env: getEnhancedEnv(),
      shell: useShell,
      windowsHide: true,
    });
    activeCliProcesses.add(child);

    const finalize = (killProcess: boolean = false) => {
      if (settled) return;
      settled = true;
      activeCliProcesses.delete(child);
      clearTimeout(timeoutTimer);
      if (streamIdleTimer) clearTimeout(streamIdleTimer);
      if (exitFlushTimer) clearTimeout(exitFlushTimer);
      if (killProcess) {
        try {
          if (child.pid && process.platform === 'win32') {
            exec(`taskkill /PID ${child.pid} /T /F`, { windowsHide: true });
          }
          child.kill();
        } catch {
          // ignore
        }
      }

      if (isTaskCancelled()) {
        resolve(null);
        return;
      }

      const cleaned = stripAnsiCodes(stdoutData).trim();
      const combined = `${cleaned}\n${stripAnsiCodes(stderrData)}`;

      // Reject CLI --help or usage outputs
      if (/^Usage\b|Available subcommands:|Work seamlessly with GitHub/im.test(cleaned.slice(0, 500))) {
        resolve(null);
        return;
      }

      // Detect quota / login / tool permission errors when output is short
      if (
        /reached your limit|usage cap|rate limit|too many requests|not logged in|please login|authentication required|no output produced|한도에 도달|사용량 초과/i.test(
          combined.slice(0, 600)
        ) &&
        cleaned.length < minOutputLength
      ) {
        resolve(null);
        return;
      }

      if (cleaned.length >= minOutputLength) {
        resolve({ content: cleaned, modelUsed: effectiveModelUsed });
      } else {
        resolve(null);
      }
    };

    const timeoutTimer = setTimeout(() => {
      finalize(true);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString('utf-8');
      // For agy.exe, once the full markdown stream has arrived (>= minOutputLength) and stdout goes idle for 2.6s,
      // resolve immediately without waiting for language server shutdown or lingering MCP grandchild handles
      if (isAgy && stripAnsiCodes(stdoutData).trim().length >= Math.max(minOutputLength, 700)) {
        if (streamIdleTimer) clearTimeout(streamIdleTimer);
        streamIdleTimer = setTimeout(() => {
          finalize(true);
        }, 2600);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString('utf-8');
    });

    child.on('error', () => {
      finalize(true);
    });

    // Listen to 'exit' as well as 'close' because on Windows, grandchild processes (like MCP servers)
    // can inherit stdio pipe handles and prevent 'close' from ever firing after the CLI process exits!
    child.on('exit', () => {
      if (settled) return;
      exitFlushTimer = setTimeout(() => {
        finalize(false);
      }, 180);
    });

    child.on('close', () => {
      finalize(false);
    });

    if (pipePromptViaStdin) {
      try {
        child.stdin.write(prompt, 'utf-8');
        child.stdin.end();
      } catch {
        // ignore stdin errors
      }
    } else {
      try {
        child.stdin.end();
      } catch {
        // ignore
      }
    }
  });
}

export async function tryGenerateWithOllama(
  prompt: string,
  preferredModel?: string
): Promise<{ content: string; modelUsed: string } | null> {
  try {
    if (isTaskCancelled()) return null;
    const tagsRes = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.any([AbortSignal.timeout(2500), currentTaskAbortController.signal]),
    });
    if (!tagsRes.ok) return null;
    const tagsData = (await tagsRes.json()) as { models?: Array<{ name: string }> };
    const installedNames = (tagsData?.models || []).map((m) => m.name);
    if (installedNames.length === 0) return null;

    const chosenModel =
      preferredModel && installedNames.includes(preferredModel)
        ? preferredModel
        : installedNames[0];

    const genRes = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chosenModel,
        prompt,
        stream: false,
      }),
      signal: AbortSignal.any([AbortSignal.timeout(45000), currentTaskAbortController.signal]),
    });
    if (!genRes.ok) return null;
    const data = (await genRes.json()) as { response?: string };
    return data?.response ? { content: data.response, modelUsed: chosenModel } : null;
  } catch {
    return null;
  }
}

export function synthesizeHighRetentionArticle(params: {
  blog: BlogProfile;
  keyword: string;
  chosenTitle: string;
  subKeywords: string[];
  internalLinks: InternalLinkEntry[];
  matchedAffiliates: AffiliateItem[];
  customInstructions?: string;
  competitorHeadings?: string[];
  extractedKeyFacts?: string[];
  contentGaps?: string[];
  differentiationAngle?: string;
}): string {
  const {
    blog,
    keyword,
    chosenTitle,
    subKeywords,
    internalLinks,
    matchedAffiliates,
    customInstructions,
    extractedKeyFacts = [],
    contentGaps = [],
    differentiationAngle = '',
  } = params;

  const { persona } = blog;
  const year = new Date().getFullYear();
  const isPolicy = isPolicyOrFinanceApplyTopic(keyword);

  // Never clone competitorHeadings directly — use gap-driven, unique reader-question headings instead
  const h1 = isPolicy
    ? `${keyword}, 내가 조건에 맞는지 손익부터 따져볼게요`
    : `${keyword}, 다른 글에서 놓치기 쉬운 현실 단점과 핵심 기준`;
  const h2 = isPolicy
    ? `상황별 실수령 혜택 비교와 숨은 예외 조건은?`
    : `직접 비교해 보면 갈리는 핵심 차이와 선택 기준`;
  const h3 = isPolicy
    ? `신청 거절·중도해지 불이익 피하는 실전 체크리스트`
    : `처음 진행할 때 가장 많이 막히는 오류·주의사항`;
  const h4 = isPolicy
    ? `진행 전 마지막으로 확인할 서류·일정 포인트`
    : `상황별 최종 추천 기준과 앞으로 볼 변수`;
  const gapSummaryNote = differentiationAngle ? `\n> ${differentiationAngle}\n` : '';
  const extraGapHint = contentGaps[0] ? ` (${contentGaps[0].split('→')[0].trim()})` : '';

  const fact1 =
    extractedKeyFacts[0] ||
    (isPolicy
      ? `${year}년 현재 적용되는 기본 자격 조건과 소득·기간 요건을 먼저 확인해야 불필요한 헛걸음을 줄일 수 있습니다.`
      : `${year}년 최근 발표된 주요 보도와 시장 지표를 종합해 보면, 기존 기조에서 새로운 국면으로 전환되는 핵심 신호가 포착되고 있습니다.`);
  const fact2 =
    extractedKeyFacts[1] ||
    (isPolicy
      ? `단순히 표면적인 수치만 비교하기보다 본인의 유지 기간과 우대 조건 충족 여부에 따라 실제 체감 혜택이 크게 달라집니다.`
      : `단편적인 헤드라인 하나만 보기보다 전후 맥락과 이해관계자들의 입장 차이를 함께 살펴봐야 전체 흐름을 정확히 읽을 수 있습니다.`);
  const fact3 =
    extractedKeyFacts[2] ||
    (isPolicy
      ? `온라인이나 모바일 앱을 통해 사전 조회를 진행하면 별도 서류 방문 없이도 대상 여부를 빠르게 확인할 수 있습니다.`
      : `특히 관련 정책 방향이나 거시 경제 지표, 그리고 주요 발언의 시점을 교차해서 확인해 보면 향후 방향성이 훨씬 뚜렷해집니다.`);
  const fact4 =
    extractedKeyFacts[3] ||
    (isPolicy
      ? `중도 변경이나 해지 시에는 기존에 적용받던 비과세나 지원 혜택이 축소될 수 있으므로 예외 인정 사유를 미리 숙지해 두는 것이 좋습니다.`
      : `단기적인 변동성이나 자극적인 해석에 흔들리기보다 공식 발표 일정과 후속 조치가 실제로 어떻게 이어지는지 차분히 지켜보는 것이 중요합니다.`);

  const internalLinkBlock =
    internalLinks.length > 0
      ? `\n함께 읽어보시면 도움 될 만한 글도 아래에 남겨둘게요.\n\n${internalLinks
          .map((link) => `- [${link.title}](${link.url})`)
          .join('\n')}\n`
      : '';

  const affiliateBlock =
    matchedAffiliates.length > 0
      ? matchedAffiliates
          .map(
            (aff) => `
<div class="editorial-recommend-card" style="margin:28px 0;padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
    <span style="font-size:12px;font-weight:700;color:#2563eb;">${aff.badgeText || '추천 정보'}</span>
    <span style="font-size:11px;color:#94a3b8;">${aff.disclosureText}</span>
  </div>
  <div style="margin:0 0 6px 0;font-size:16px;font-weight:700;color:#0f172a;">${aff.productTitle}</div>
  <p style="margin:0 0 12px 0;font-size:14px;color:#475569;line-height:1.6;">${aff.priceText || '상세 내용 확인하기'}</p>
  <a href="${aff.affiliateUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:8px 18px;background:#2563eb;color:#ffffff;font-size:13px;font-weight:600;text-decoration:none;border-radius:8px;">${aff.ctaButtonText} &rarr;</a>
</div>
`
          )
          .join('\n')
      : '';

  const customNote = customInstructions ? `\n참고로 ${customInstructions}\n` : '';
  const outroGreeting =
    persona.signatureOutro ||
    `오늘 정리해 드린 내용이 조금이나마 도움이 되셨기를 바랍니다. 혹시 보시면서 궁금한 점이나 의견이 있으시면 언제든 편하게 댓글 남겨주세요!`;

  if (!isPolicy) {
    return `요즘 뉴스나 커뮤니티를 보다 보면 **${keyword}** 관련 소식이 빠르게 퍼지고 있습니다.

보도 내용이 워낙 많다 보니 이번 사안의 쟁점이 정확히 무엇인지, 실제로 어떤 변화로 이어질지 한 번에 파악하기 쉽지 않은데요.

여러 기사에서 다룬 팩트를 바탕으로 꼭 알아두셔야 할 핵심 대목만 추려봤습니다.${extraGapHint ? ` 특히 기존 글에서 잘 다루지 않는 실제 예외와 비교 기준${extraGapHint}까지 함께 정리했어요.` : ''}
${gapSummaryNote}

## ${h1}

결론부터 말씀드리면 **${keyword}** 사안은 단편적인 해프닝이 아니라 누적된 정책·현장 변화가 맞물려 나타난 결과입니다.

${fact1}

특히 겉으로 드러난 한 줄 요약만 보면 오해하기 쉽지만, 실제로는 **${subKeywords[0] || '전후 경위'}** 대목에서 달라진 온도 차이를 읽는 것이 중요합니다.

- **발단과 경위 짚어보기**: 최근 변화된 대내외 환경과 주요 발언의 전후 맥락을 먼저 확인해야 합니다.
- **주요 쟁점 포인트**: 당사자들 사이의 입장 차이가 어디서 비롯되었는지 비교해 보면 흐름이 훨씬 명확해집니다.
- **주목해야 할 시그널**: 단기적인 반응보다 중장기 방향성에 어떤 신호를 주는지 함께 살펴보는 것이 좋습니다.


## ${h2}

그다음으로 많은 분들이 궁금해하시는 부분이 바로 "그래서 이번 사안에서 가장 핵심이 되는 쟁점은 무엇인가?" 하는 점이에요.

${fact2}

실제로 여러 분석과 현장 반응을 교차해서 살펴보면, **${subKeywords[1] || '주요 쟁점'}**을 둘러싼 해석이 향후 흐름을 좌우하는 가장 큰 변수로 꼽히고 있습니다.

${fact3}

그래서 자극적인 제목만 보고 성급하게 결론을 내리기보다는, 객관적인 수치와 공식 발표 내용을 바탕으로 차분하게 맥락을 짚어보는 시선이 필요해요.
${affiliateBlock}

## ${h3}

그렇다면 앞으로 이 흐름을 볼 때 어떤 포인트를 중점적으로 체크해 두면 좋을까요?

1. 먼저 **${subKeywords[2] || '향후 주요 일정'}**과 관련해서 예정된 공식 발표나 정책 결정 시점을 미리 확인해 두세요.
2. 두 번째로 관련 시장이나 업계에서 실제로 어떤 후속 반응이 나오는지 1~2주 단위로 흐름을 비교해 보는 것이 좋습니다.
3. 마지막으로 단기 뉴스에 일희일비하기보다 핵심 지표가 실제로 움직이는지 여부를 기준으로 판단하시는 걸 추천드려요.

이렇게 세 가지 기준만 잡고 뉴스를 보셔도 복잡한 이슈 속에서 중심을 잃지 않고 핵심을 빠르게 파악하실 수 있습니다.
${internalLinkBlock}

## ${h4}

마지막으로 이번 **${keyword}** 흐름을 정리하면서 기억해 두면 좋을 포인트를 짚어볼게요.

${fact4}

- **단기 변동성과 본질 구분하기**: 당장 쏟아지는 속보보다 실제 결정 권한과 제도적 절차가 어떻게 작동하는지 확인하세요.
- **후속 발표 일정 체크**: 향후 추가로 나오는 공식 입장에 따라 분위기가 다시 반전될 수 있는지도 염두에 두어야 합니다.
${customNote}
지금까지 **${chosenTitle}** 관련 주요 쟁점과 후속 일정을 짚어보았습니다.

복잡해 보이는 사안도 전후 맥락을 알고 보면 훨씬 이해하기 수월해집니다. 오늘 정리해 드린 내용이 전체 흐름을 읽는 데 도움이 되셨기를 바랍니다.

${outroGreeting}`;
  }

  return `요즘 주변에서도 그렇고 **${keyword}** 관련해서 궁금해하시는 분들이 정말 많더라고요.

막상 인터넷에 검색해 보면 글마다 말이 조금씩 다르거나, 정작 내가 알고 싶은 핵심 조건은 복잡하게 적혀 있어서 답답하셨을 텐데요.

저도 이번에 하나하나 직접 찾아보고 비교해 보면서 헷갈렸던 부분들을 깔끔하게 정리해 봤습니다. 바쁘신 분들도 편하게 읽으실 수 있도록 핵심만 알기 쉽게 풀어드릴게요!
${gapSummaryNote}

| 구분 | 핵심 체크 기준 | 실전 주의사항 |
| --- | --- | --- |
| 기본 자격·조건 | ${subKeywords[0] || '대상 요건 충족 여부'} | 사전 조회로 누락 방지 |
| 실수령·체감 차이 | ${subKeywords[1] || '유지 기간 및 우대 조건'} | 중도 변경 시 감액 확인 |
| 진행 전 준비 | ${subKeywords[2] || '필수 서류 및 신청 기한'} | 마감 전 여유 있게 접수 |


## ${h1}

가장 먼저 짚어봐야 할 부분은 내가 해당 기준에 맞는지, 그리고 작년과 비교해서 어떤 점이 달라졌는지예요.

${fact1}

특히 많은 분들이 기본 요건만 대략 보고 넘어가시는데, 실제로는 세부 기준(${subKeywords[0] || '세부 요건'})을 어떻게 맞추느냐에 따라 결과가 꽤 달라지더라고요.

- **사전 대상 여부 확인**: 본인의 현재 조건과 ${year}년 최신 기준이 부합하는지 먼저 체크해 보세요.
- **필수 준비 사항 점검**: 모바일 간편인증이나 기본 확인 서류를 미리 챙겨두면 중간에 막히는 일 없이 훨씬 수월합니다.
- **우대 및 예외 조건 체크**: 나에게 해당되는 추가 혜택이나 예외 인정 항목이 있는지 꼭 함께 살펴보세요.


## ${h2}

그다음으로 가장 많이들 물어보시는 게 "그래서 실제로 얼마나 차이가 나고 어떤 선택이 유리할까?" 하는 점이에요.

${fact2}

직접 계산기를 두드려보거나 조건을 나란히 놓고 비교해 보면, 당장 눈에 보이는 숫자보다 **유지 기간**과 **부가 조건**이 훨씬 중요하다는 걸 알 수 있습니다.

${fact3}

그래서 무조건 남들이 좋다고 하는 방식을 그대로 따라 하기보다는, 내 자금 계획이나 실제 활용 패턴에 맞춰서 무리 없이 유지할 수 있는 방향을 잡으시는 걸 추천드려요.
${affiliateBlock}

## ${h3}

막상 진행하려고 할 때 순서를 미리 알고 시작하면 시간을 정말 많이 아낄 수 있어요.

1. 먼저 공식 홈페이지나 전용 모바일 앱 메뉴에 접속해서 기본 대상 조회를 진행합니다.
2. 조회가 완료되면 안내되는 선택 항목 중에서 나에게 유리한 옵션(${subKeywords[1] || '세부 조건'})을 꼼꼼히 체크해 주세요.
3. 마지막으로 신청 내역이나 적용 상태가 정상적으로 반영되었는지 알림톡이나 마이페이지에서 한 번 더 확인하면 끝입니다.

생각보다 절차 자체는 간단하지만, 중간에 선택 옵션을 기본값으로만 두고 넘기면 받을 수 있는 혜택을 놓치는 경우가 종종 있으니 그 부분만 주의하시면 됩니다.
${internalLinkBlock}

## ${h4}

마지막으로 결정하시기 전에 꼭 기억해 두셔야 할 현실적인 주의사항도 몇 가지 적어볼게요.

${fact4}

- **중도 변경 시 불이익 여부**: 중간에 계획을 바꾸거나 해지할 때 페널티가 없는지 미리 알아두세요.
- **신청 기한 및 예산 소진 확인**: 선착순이나 기간 한정으로 운영되는 경우 마감 시점이 예상보다 빠를 수 있습니다.
${customNote}
지금까지 **${chosenTitle}** 관련해서 제가 직접 알아보고 정리한 핵심 내용을 나누어 보았는데요.

처음엔 용어나 기준이 다소 낯설게 느껴질 수 있지만, 오늘 짚어드린 포인트만 차례대로 확인해 보셔도 손해 보는 일 없이 현명하게 챙기실 수 있을 거예요.

${outroGreeting}`;
}

export function convertMarkdownToNaverRichHtml(
  markdown: string,
  thumbnailDataUrl?: string,
  accentColor: string = '#2563eb'
): string {
  // 1. Strip duplicate H1 title at top of body, double-tilde strikethroughs, and horizontal divider lines
  let cleanMarkdown = (markdown || '')
    .replace(/^#\s+[^\n]+\r?\n+/, '')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .trim();

  // 2. Convert highlighter syntax ==text== into modern pastel highlighter mark
  cleanMarkdown = cleanMarkdown.replace(
    /==(.*?)==/g,
    '<mark style="background:linear-gradient(to top, #fff3b0 65%, transparent 35%);font-weight:700;padding:1px 5px;border-radius:3px;color:#0f172a;">$1</mark>'
  );

  const rawHtml = (blogMarkdownParser.parse(cleanMarkdown, { async: false }) as string)
    .replace(/<\/?(?:del|s|strike)(?:\s+[^>]*)?>/gi, '')
    .replace(/<hr\s*\/?>/gi, '');

  const styledHtml = rawHtml
    // Standalone image paragraphs: keep infographic cards (PNG/SVG data URLs) uncropped; render external photos inside a figure with caption
    .replace(/<p>\s*<img\s+([^>]*?)>\s*<\/p>/gi, (_full, attrs: string) => {
      const srcMatch = attrs.match(/\bsrc="([^"]*)"/i);
      const altMatch = attrs.match(/\balt="([^"]*)"/i);
      const src = srcMatch ? srcMatch[1] : '';
      const alt = (altMatch ? altMatch[1] : '').replace(/[<>]/g, '').trim();
      if (/^data:image\/(?:svg\+xml|png)/i.test(src)) {
        const safeCaption = alt ? `▲ ${alt}` : '';
        return `<figure style="margin:26px 0;text-align:center;"><img ${attrs} style="max-width:100%;height:auto;border-radius:12px;display:block;margin:0 auto;border:1px solid #e2e8f0;" />${
          safeCaption
            ? `<figcaption style="margin-top:8px;font-size:12.5px;color:#64748b;text-align:center;line-height:1.5;">${safeCaption}</figcaption>`
            : ''
        }</figure>`;
      }
      const safeCaption = alt ? `▲ ${alt}` : '';
      return `<figure style="margin:26px 0;text-align:center;"><img ${attrs} style="width:100%;max-width:680px;max-height:400px;object-fit:cover;border-radius:12px;display:block;margin:0 auto;border:1px solid #e2e8f0;" />${
        safeCaption
          ? `<figcaption style="margin-top:8px;font-size:12.5px;color:#64748b;text-align:center;line-height:1.5;">${safeCaption}</figcaption>`
          : ''
      }</figure>`;
    })
    // H2: Clean, 100% natural human blog heading (no artificial bars, boxes, or side borders)
    .replace(
      /<h2>(.*?)<\/h2>/g,
      `<h2 style="margin-top:42px;margin-bottom:16px;font-size:21px;font-weight:800;color:#0f172a;line-height:1.45;letter-spacing:-0.02em;background:transparent;border:none;padding:0;">$1</h2>`
    )
    // H3: Clean sub-heading
    .replace(
      /<h3>(.*?)<\/h3>/g,
      `<h3 style="margin-top:28px;margin-bottom:12px;font-size:17.5px;font-weight:700;color:#1e293b;line-height:1.5;letter-spacing:-0.015em;background:transparent;border:none;padding:0;">$1</h3>`
    )
    // Transform Q&A headers (<h3>Q. ...</h3><p>A. ...</p>) into friendly soft note
    .replace(
      /<h3[^>]*>Q\.\s*(.*?)<\/h3>\s*<p>(?:<strong>)?A\.\s*(?:<\/strong>)?([\s\S]*?)<\/p>/gi,
      `
<div style="margin:20px 0;padding:16px 20px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
  <div style="font-weight:700;font-size:15px;color:#0f172a;margin-bottom:6px;">Q. $1</div>
  <div style="font-size:14.5px;color:#334155;line-height:1.8;">$2</div>
</div>`
    )
    // Transform paragraph Q&A into friendly soft note
    .replace(
      /<p>(?:<strong>)?Q\.\s*(.*?)(?:<\/strong>)?(?:<br\s*\/?>|\n)\s*(?:(?:<strong>)?A\.\s*(?:<\/strong>)?)?([\s\S]*?)<\/p>/gi,
      `
<div style="margin:20px 0;padding:16px 20px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
  <div style="font-weight:700;font-size:15px;color:#0f172a;margin-bottom:6px;">Q. $1</div>
  <div style="font-size:14.5px;color:#334155;line-height:1.8;">$2</div>
</div>`
    )
    // Paragraphs: Comfortable mobile reading line-height and font size
    .replace(
      /<p>(.*?)<\/p>/g,
      `<p style="margin-bottom:18px;color:#334155;font-size:16px;line-height:1.95;letter-spacing:-0.015em;word-break:keep-all;">$1</p>`
    )
    // Blockquote: Clean SmartEditor callout box
    .replace(
      /<blockquote>([\s\S]*?)<\/blockquote>/g,
      `<div style="margin:24px 0;padding:16px 20px;background:#f8fafc;border-left:3px solid #cbd5e1;border-radius:0 8px 8px 0;color:#475569;font-size:15px;line-height:1.8;">$1</div>`
    )
    // Table: Clean, natural table
    .replace(
      /<table>/g,
      `<div style="overflow-x:auto;margin:28px 0;border:1px solid #e2e8f0;border-radius:12px;"><table style="width:100%;border-collapse:collapse;font-size:14.5px;text-align:left;background:#ffffff;">`
    )
    .replace(
      /<\/table>/g,
      `</table></div>`
    )
    .replace(
      /<th>(.*?)<\/th>/g,
      `<th style="background:#f8fafc;color:#0f172a;padding:12px 16px;font-weight:700;font-size:13.5px;border-bottom:2px solid #e2e8f0;letter-spacing:-0.01em;">$1</th>`
    )
    .replace(
      /<td>(.*?)<\/td>/g,
      `<td style="padding:12px 16px;border-bottom:1px solid #f1f5f9;color:#334155;line-height:1.65;font-size:14px;">$1</td>`
    )
    // Natural bullet list
    .replace(
      /<ul>/g,
      `<ul style="margin:16px 0 22px 20px;padding:0;color:#334155;font-size:15.5px;line-height:1.85;">`
    )
    .replace(
      /<ol>/g,
      `<ol style="margin:18px 0 24px 22px;padding:0;color:#334155;font-size:15.5px;line-height:1.85;">`
    )
    .replace(
      /<li>(.*?)<\/li>/g,
      `<li style="margin-bottom:8px;padding-left:4px;">$1</li>`
    )
    .replace(
      /<a (.*?)href="(.*?)"(.*?)>(.*?)<\/a>/g,
      `<a $1href="$2"$3 style="color:#2563eb;font-weight:600;text-decoration:underline;text-underline-offset:3px;">$4</a>`
    )
    .replace(/<img ((?:(?!\bstyle=)[^>])*?)>/gi, (full, attrs: string) => {
      if (/\bstyle=/i.test(full)) return full;
      return `<img ${attrs} style="max-width:100%;height:auto;border-radius:10px;display:block;margin:24px auto;border:1px solid #e2e8f0;" />`;
    });

  // Thumbnails belong to post metadata (representative featured image for the platform),
  // NEVER inject auto-generated synthetic SVG banners directly into the article body!
  return `<div style="font-family:'Pretendard',-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;max-width:740px;margin:0 auto;padding:16px;color:#1e293b;line-height:1.9;word-break:keep-all;letter-spacing:-0.015em;">${styledHtml}</div>`;
}

function wrapKoreanWordsSafely(text: string, maxCharsPerLine: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (!current) {
      current = w;
    } else if ((current + ' ' + w).length <= maxCharsPerLine) {
      current += ' ' + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

export type ArticleVisualPolicy =
  | 'factual_news_issue'
  | 'technical_engineering'
  | 'product_tech_review'
  | 'lifestyle_conceptual_ai';

export interface ArticleVisualPolicyInfo {
  policy: ArticleVisualPolicy;
  label: string;
  allowAiIllustration: boolean;
}

export function classifyArticleVisualPolicy(
  keyword: string,
  title: string = '',
  markdownContent: string = '',
  blog?: BlogProfile
): ArticleVisualPolicyInfo {
  const headerText = `${keyword} ${title}`.trim();
  const sampleBody = markdownContent.slice(0, 600);
  const fullContext = `${headerText} ${sampleBody}`;

  // Light lifestyle/wellness/productivity topics explicitly allow warm vector/AI-style illustrations
  if (
    /혈당|식단|다이어트|스트레칭|수면|영양제|운동|건강|습관|루틴|바이브\s*코딩|생산성|여행|맛집|라이프|취미|독서/i.test(
      headerText
    ) &&
    !/1심|2심|대법원|선고|무죄|유죄|판결|취약점|보안\s*패치|CVE/i.test(headerText)
  ) {
    return {
      policy: 'lifestyle_conceptual_ai',
      label: '라이프·웰니스 (맞춤 인포그래픽 PNG)',
      allowAiIllustration: true,
    };
  }

  // Factual news, court/legal verdicts, exams, politics, policies, finance — clean data infographics + scraped news photos
  if (
    /1심|2심|항소심|상고심|대법원|헌재|선고|무죄|유죄|판결|법원|검찰|구속|재판|수능|리트|LEET|만점자|불출석|공개검증|재난문자|체납|명단|국회|의원|정부|청문회|해프닝|지원금|계좌|청년도약|국민연금|건강보험|피부양자|연말정산|세금|환급|대출|주담대|금리|예금|적금|환율|달러|엔화|유로화|코스피|주가|실적|부동산|청약|전세|월세|물가/i.test(
      headerText
    )
  ) {
    return {
      policy: 'factual_news_issue',
      label: '팩트·이슈 모드 (비교표·팩트 PNG + 기사 실사)',
      allowAiIllustration: false,
    };
  }

  // Hard technical, engineering, and security advisories — architecture diagram + checklist PNG
  if (
    /Java|자바|오픈JDK|OpenJDK|자바포셸|Java4Shell|CVE|취약점|보안|패치|해킹|Next\.js|React|TypeScript|타입스크립트|Python|파이썬|Docker|도커|Kubernetes|AWS|Playwright|MCP|Ollama|LLM|API|서버|트러블슈팅|아키텍처|코딩|프로그래밍/i.test(
      headerText
    )
  ) {
    return {
      policy: 'technical_engineering',
      label: '기술·개발 가이드 (아키텍처·체크리스트 PNG)',
      allowAiIllustration: false,
    };
  }

  // Physical products, devices, robotics, exhibitions, and app/game releases
  if (
    /갤럭시|아이폰|샤오미|맥북|노트북|RTX|게이밍|모니터|로봇|실증|스마트폰|베스트\s*앱|GTA|지스타|전시회|현대차|레이싱|신제품|사전\s*판매/i.test(
      headerText
    )
  ) {
    return {
      policy: 'product_tech_review',
      label: '제품·테크 비교 모드 (비교표·요약 PNG)',
      allowAiIllustration: false,
    };
  }

  // Fallback check against blog niche keywords
  const nicheStr = (blog?.nicheKeywords || []).join(' ');
  if (/재테크|금융|경제|시사|뉴스|정치|부동산|세금/i.test(nicheStr) || /국회|법원|금리|지원금/i.test(fullContext)) {
    return {
      policy: 'factual_news_issue',
      label: '팩트·이슈 모드 (비교표·팩트 PNG + 기사 실사)',
      allowAiIllustration: false,
    };
  }
  if (/개발|프로그래밍|엔지니어링|클라우드/i.test(nicheStr)) {
    return {
      policy: 'technical_engineering',
      label: '기술·개발 가이드 (아키텍처·체크리스트 PNG)',
      allowAiIllustration: false,
    };
  }

  return {
    policy: 'lifestyle_conceptual_ai',
    label: '라이프·웰니스 (맞춤 인포그래픽 PNG)',
    allowAiIllustration: true,
  };
}

function escapeSvgText(s: string): string {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function extractSectionTakeaways(sectionMarkdown: string, maxItems: number = 3): string[] {
  const lines = sectionMarkdown.trim().split(/\r?\n/).slice(1);
  const body = lines
    .join(' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/[#>*_~`|\[\]\(\)==]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = body
    .split(/(?<=[.?!요다죠])\s+/)
    .map((s) => s.replace(/^[-*•·\d.]+\s*/, '').trim())
    .filter((s) => s.length >= 14 && s.length <= 92);

  return sentences.slice(0, maxItems);
}

function buildCleanEditorialNoteSvgDataUrl(params: {
  stepBadge: string;
  sectionTitle: string;
  bulletLines: string[];
}): string {
  const titleLines = wrapKoreanWordsSafely(params.sectionTitle, 26);
  const bullets = params.bulletLines.slice(0, 3).map((b) => {
    const cleaned = b.replace(/^[-*•·\d.]+\s*/, '').trim();
    return cleaned.length > 38 ? cleaned.slice(0, 37) + '…' : cleaned;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="260" viewBox="0 0 680 260">
  <rect width="680" height="260" rx="14" fill="#ffffff"/>
  <rect x="1" y="1" width="678" height="258" rx="13" fill="none" stroke="#cbd5e1" stroke-width="1.5"/>
  <rect x="28" y="24" width="112" height="26" rx="6" fill="#f1f5f9"/>
  <text x="84" y="41" text-anchor="middle" fill="#334155" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="12" font-weight="700">${escapeSvgText(
    params.stepBadge
  )}</text>
  <text x="28" y="78" fill="#0f172a" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="19" font-weight="800">${escapeSvgText(
    titleLines[0] || params.sectionTitle
  )}</text>
  ${
    titleLines[1]
      ? `<text x="28" y="104" fill="#0f172a" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="19" font-weight="800">${escapeSvgText(
          titleLines[1]
        )}</text>`
      : ''
  }
  <line x1="28" y1="${titleLines[1] ? 120 : 98}" x2="652" y2="${
    titleLines[1] ? 120 : 98
  }" stroke="#f1f5f9" stroke-width="1.5"/>
  ${bullets
    .map((b, idx) => {
      const y = (titleLines[1] ? 150 : 132) + idx * 34;
      return `<circle cx="38" cy="${y - 5}" r="3.5" fill="#475569"/>
  <text x="52" y="${y}" fill="#334155" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="14.5" font-weight="600">${escapeSvgText(
        b
      )}</text>`;
    })
    .join('\n  ')}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

function buildTechnicalArchitectureSvgDataUrl(params: {
  badge: string;
  sectionTitle: string;
  steps: string[];
}): string {
  const titleLines = wrapKoreanWordsSafely(params.sectionTitle, 28);
  const steps = params.steps.slice(0, 3).map((s) => (s.length > 36 ? `${s.slice(0, 35)}…` : s));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="270" viewBox="0 0 680 270">
  <rect width="680" height="270" rx="14" fill="#0f172a"/>
  <rect x="1" y="1" width="678" height="268" rx="13" fill="none" stroke="#1e293b" stroke-width="1.5"/>
  <rect x="28" y="22" width="136" height="24" rx="6" fill="#0ea5e9" fill-opacity="0.16" stroke="#38bdf8" stroke-opacity="0.45"/>
  <text x="96" y="38" text-anchor="middle" fill="#7dd3fc" font-family="Pretendard, Malgun Gothic, monospace" font-size="11.5" font-weight="700">${escapeSvgText(
    params.badge
  )}</text>
  <text x="28" y="72" fill="#f8fafc" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="18.5" font-weight="800">${escapeSvgText(
    titleLines[0] || params.sectionTitle
  )}</text>
  ${
    titleLines[1]
      ? `<text x="28" y="96" fill="#e2e8f0" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="18.5" font-weight="700">${escapeSvgText(
          titleLines[1]
        )}</text>`
      : ''
  }
  ${steps
    .map((step, idx) => {
      const boxY = (titleLines[1] ? 114 : 96) + idx * 48;
      return `<rect x="28" y="${boxY}" width="624" height="38" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1"/>
  <rect x="38" y="${boxY + 8}" width="26" height="22" rx="5" fill="#0284c7"/>
  <text x="51" y="${boxY + 23}" text-anchor="middle" fill="#ffffff" font-family="monospace" font-size="11" font-weight="700">0${idx + 1}</text>
  <text x="76" y="${boxY + 24}" fill="#e2e8f0" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="13.5" font-weight="600">${escapeSvgText(
        step
      )}</text>`;
    })
    .join('\n  ')}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

function buildConceptualIllustrationSvgDataUrl(params: {
  badge: string;
  sectionTitle: string;
  takeaways: string[];
  keyword: string;
}): string {
  const titleLines = wrapKoreanWordsSafely(params.sectionTitle, 21);
  const bullets = params.takeaways.slice(0, 3).map((b) => (b.length > 29 ? `${b.slice(0, 28)}…` : b));
  const isHealth = /혈당|식단|다이어트|건강|수면|영양제|운동|스트레칭/.test(params.keyword);
  const bgStart = isHealth ? '#f0fdf4' : '#eef2ff';
  const accent = isHealth ? '#10b981' : '#6366f1';
  const accentSoft = isHealth ? '#d1fae5' : '#e0e7ff';
  const badgeText = isHealth ? '#047857' : '#4338ca';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="270" viewBox="0 0 680 270">
  <defs>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bgStart}"/>
      <stop offset="100%" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect width="680" height="270" rx="16" fill="url(#bgGrad)"/>
  <rect x="1" y="1" width="678" height="268" rx="15" fill="none" stroke="${accentSoft}" stroke-width="1.5"/>
  <!-- Right pastel geometric & organic flat vector illustration -->
  <circle cx="575" cy="135" r="76" fill="${accentSoft}" fill-opacity="0.7"/>
  <circle cx="595" cy="96" r="34" fill="${accent}" fill-opacity="0.18"/>
  <path d="M540 165 C548 118, 598 95, 622 135 C602 178, 558 185, 540 165 Z" fill="${accent}" fill-opacity="0.35"/>
  <rect x="526" y="114" width="96" height="58" rx="12" fill="#ffffff" stroke="${accent}" stroke-opacity="0.35" stroke-width="1.5"/>
  <circle cx="548" cy="136" r="8" fill="${accent}"/>
  <rect x="564" y="131" width="44" height="7" rx="3.5" fill="${accentSoft}"/>
  <rect x="538" y="152" width="70" height="6" rx="3" fill="#e2e8f0"/>
  <!-- Left editorial takeaways -->
  <rect x="28" y="24" width="118" height="24" rx="12" fill="${accentSoft}"/>
  <text x="87" y="40" text-anchor="middle" fill="${badgeText}" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="11.5" font-weight="700">${escapeSvgText(
    params.badge
  )}</text>
  <text x="28" y="76" fill="#0f172a" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="18.5" font-weight="800">${escapeSvgText(
    titleLines[0] || params.sectionTitle
  )}</text>
  ${
    titleLines[1]
      ? `<text x="28" y="100" fill="#0f172a" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="18.5" font-weight="800">${escapeSvgText(
          titleLines[1]
        )}</text>`
      : ''
  }
  ${bullets
    .map((b, idx) => {
      const y = (titleLines[1] ? 132 : 114) + idx * 36;
      return `<circle cx="36" cy="${y - 5}" r="4" fill="${accent}"/>
  <text x="48" y="${y}" fill="#334155" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="14" font-weight="600">${escapeSvgText(
        b
      )}</text>`;
    })
    .join('\n  ')}
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

function extractMarkdownTableForVisual(markdown: string): {
  headers: string[];
  rows: string[][];
} | null {
  const lines = (markdown || '').split(/\r?\n/);
  for (let i = 0; i < lines.length - 2; i++) {
    const headerLine = lines[i].trim();
    const sepLine = lines[i + 1].trim();
    if (!headerLine.startsWith('|') || !/^\|[\s:|-]+\|/.test(sepLine)) continue;
    const parseCells = (line: string) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.replace(/[*_`~=#\[\]]/g, '').replace(/\s+/g, ' ').trim())
        .slice(0, 3);
    const headers = parseCells(headerLine);
    if (headers.length < 2) continue;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && rows.length < 4; j++) {
      const rLine = lines[j].trim();
      if (!rLine.startsWith('|')) break;
      const cells = parseCells(rLine);
      if (cells.length >= 2) rows.push(cells);
    }
    if (rows.length >= 2) {
      return { headers, rows };
    }
  }
  return null;
}

function buildComparisonTableInfographicSvgDataUrl(params: {
  keyword: string;
  sectionTitle: string;
  headers: string[];
  rows: string[][];
}): string {
  const colCount = Math.min(3, Math.max(2, params.headers.length));
  const width = 760;
  const rowHeight = 46;
  const startY = 128;
  const height = startY + (params.rows.length + 1) * rowHeight + 48;
  const tableW = width - 56;
  const colWidths =
    colCount === 2
      ? [Math.round(tableW * 0.34), Math.round(tableW * 0.66)]
      : [Math.round(tableW * 0.24), Math.round(tableW * 0.38), Math.round(tableW * 0.38)];

  const truncateCell = (txt: string, maxChars: number) =>
    txt.length > maxChars ? `${txt.slice(0, maxChars - 1)}…` : txt;

  const colX: number[] = [28];
  for (let c = 0; c < colCount - 1; c++) {
    colX.push(colX[c] + colWidths[c]);
  }

  const headerCellsSvg = params.headers
    .slice(0, colCount)
    .map((h, idx) => {
      const maxLen = idx === 0 ? 11 : colCount === 2 ? 26 : 16;
      return `<text x="${colX[idx] + 14}" y="${startY + 28}" fill="#ffffff" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="13.5" font-weight="800">${escapeSvgText(
        truncateCell(h, maxLen)
      )}</text>`;
    })
    .join('\n  ');

  const rowsSvg = params.rows
    .map((row, rIdx) => {
      const y = startY + (rIdx + 1) * rowHeight;
      const fill = rIdx % 2 === 0 ? '#f8fafc' : '#ffffff';
      const cellsSvg = row
        .slice(0, colCount)
        .map((cell, cIdx) => {
          const maxLen = cIdx === 0 ? 11 : colCount === 2 ? 28 : 17;
          const color = cIdx === 0 ? '#0f172a' : '#334155';
          const weight = cIdx === 0 ? '700' : '500';
          return `<text x="${colX[cIdx] + 14}" y="${y + 28}" fill="${color}" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="13" font-weight="${weight}">${escapeSvgText(
            truncateCell(cell, maxLen)
          )}</text>`;
        })
        .join('\n  ');
      return `<rect x="28" y="${y}" width="${tableW}" height="${rowHeight}" fill="${fill}"/>
  <line x1="28" y1="${y + rowHeight}" x2="${28 + tableW}" y2="${y + rowHeight}" stroke="#e2e8f0" stroke-width="1"/>
  ${cellsSvg}`;
    })
    .join('\n  ');

  const cleanTitle =
    params.sectionTitle.length > 34
      ? `${params.sectionTitle.slice(0, 33)}…`
      : params.sectionTitle;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" rx="16" fill="#ffffff"/>
  <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="15" fill="none" stroke="#cbd5e1" stroke-width="1.5"/>
  <rect x="28" y="24" width="140" height="26" rx="6" fill="#eff6ff" stroke="#bfdbfe" stroke-width="1"/>
  <text x="98" y="41" text-anchor="middle" fill="#1d4ed8" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="11.5" font-weight="800">핵심 데이터 비교표</text>
  <text x="28" y="82" fill="#0f172a" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="20" font-weight="900">${escapeSvgText(
    cleanTitle || `${params.keyword} 핵심 비교`
  )}</text>
  <text x="28" y="106" fill="#64748b" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="12.5" font-weight="600">${escapeSvgText(
    params.keyword
  )}</text>
  <rect x="28" y="${startY}" width="${tableW}" height="${rowHeight}" rx="8" fill="#0f172a"/>
  ${headerCellsSvg}
  ${rowsSvg}
  <text x="${width - 28}" y="${height - 16}" text-anchor="end" fill="#94a3b8" font-family="Pretendard, Malgun Gothic, sans-serif" font-size="11" font-weight="600">핵심 비교 요약 인포그래픽</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

function insertVisualIntoSection(sectionPart: string, markdownVisual: string, isLastSection: boolean): string {
  const paras = sectionPart.trim().split(/\r?\n\s*\r?\n/);
  if (
    isLastSection &&
    paras.length >= 3 &&
    /궁금|댓글|도움|바랍니다|바랄게요/.test(paras[paras.length - 1])
  ) {
    return [
      ...paras.slice(0, paras.length - 1),
      markdownVisual,
      paras[paras.length - 1],
    ].join('\n\n') + '\n\n';
  }
  return `${sectionPart.trim()}\n\n${markdownVisual}\n\n`;
}

export function injectContextualInlineVisuals(
  markdownContent: string,
  targetKeyword: string,
  title: string = '',
  blog?: BlogProfile,
  scrapedImageUrls: string[] = []
): {
  markdownContent: string;
  insertedCount: number;
  policyInfo: ArticleVisualPolicyInfo;
} {
  const policyInfo = classifyArticleVisualPolicy(targetKeyword, title, markdownContent, blog);
  if (!markdownContent || !markdownContent.trim()) {
    return { markdownContent, insertedCount: 0, policyInfo };
  }

  // Skip if markdown already has inline images
  if (/!\[[^\]]*\]\((?:https?:\/\/[^\s)]+|data:image\/[^\s)]+)\)/.test(markdownContent)) {
    return { markdownContent, insertedCount: 0, policyInfo };
  }

  const parts = markdownContent.split(/(?=^##\s+.+$)/m);
  if (parts.length < 2) {
    return { markdownContent, insertedCount: 0, policyInfo };
  }

  const secondTargetIdx = parts.length >= 4 ? 3 : parts.length === 3 ? 2 : -1;
  const tableData = extractMarkdownTableForVisual(markdownContent);
  const validScrapedUrls = (scrapedImageUrls || []).filter((u) =>
    /^(?:https?:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(u)
  );
  const hasLiveScreenshotFirst =
    validScrapedUrls.length > 0 && /^data:image\/png;base64,/i.test(validScrapedUrls[0]);
  let insertedCount = 0;
  let usedTableCard = false;
  let usedTechDiagram = false;
  let usedScrapedIdx = 0;

  const updatedParts = parts.map((part, idx) => {
    if (!part.startsWith('## ')) return part;
    const isLast = idx === parts.length - 1;
    const lines = part.trim().split(/\r?\n/);
    const heading = lines[0].replace(/^##\s+/, '').replace(/[*_~`]/g, '').trim();
    const rawTakeaways = extractSectionTakeaways(part, 3);
    const takeaways =
      rawTakeaways.length >= 2
        ? rawTakeaways
        : [
            `${targetKeyword} 핵심 기준 및 조건 확인`,
            `${heading} 진행 전 예외·주의사항 체크`,
            '실제 적용 시 변경 수치 및 최신 기준 대조',
          ];

    if (idx === 1) {
      if (hasLiveScreenshotFirst) {
        const photoUrl = validScrapedUrls[usedScrapedIdx++];
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} - ${heading} 실제 화면 참고](${photoUrl})`,
          isLast
        );
      }

      if (policyInfo.policy === 'technical_engineering') {
        usedTechDiagram = true;
        const svgUrl = buildTechnicalArchitectureSvgDataUrl({
          badge: 'TECH ARCHITECTURE',
          sectionTitle: heading,
          steps: takeaways,
        });
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} - ${heading} 아키텍처 요약](${svgUrl})`,
          isLast
        );
      }

      if (tableData) {
        usedTableCard = true;
        const tableSvgUrl = buildComparisonTableInfographicSvgDataUrl({
          keyword: targetKeyword,
          sectionTitle: heading,
          headers: tableData.headers,
          rows: tableData.rows,
        });
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} 핵심 비교표 - ${heading}](${tableSvgUrl})`,
          isLast
        );
      }

      if (validScrapedUrls.length > usedScrapedIdx) {
        const photoUrl = validScrapedUrls[usedScrapedIdx++];
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} - ${heading} 관련 참고 이미지](${photoUrl})`,
          isLast
        );
      }

      const firstCardUrl = policyInfo.allowAiIllustration
        ? buildConceptualIllustrationSvgDataUrl({
            badge: 'KEY SUMMARY',
            sectionTitle: heading,
            takeaways,
            keyword: targetKeyword,
          })
        : buildCleanEditorialNoteSvgDataUrl({
            stepBadge: '핵심 요약 노트',
            sectionTitle: heading,
            bulletLines: takeaways,
          });
      insertedCount++;
      return insertVisualIntoSection(
        part,
        `![${targetKeyword} - ${heading} 핵심 요약](${firstCardUrl})`,
        isLast
      );
    }

    if (idx === secondTargetIdx) {
      if (tableData && !usedTableCard) {
        usedTableCard = true;
        const tableSvgUrl = buildComparisonTableInfographicSvgDataUrl({
          keyword: targetKeyword,
          sectionTitle: heading,
          headers: tableData.headers,
          rows: tableData.rows,
        });
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} 핵심 비교표 - ${heading}](${tableSvgUrl})`,
          isLast
        );
      }

      if (policyInfo.policy === 'technical_engineering' && !usedTechDiagram) {
        usedTechDiagram = true;
        const svgUrl = buildTechnicalArchitectureSvgDataUrl({
          badge: 'TECH ARCHITECTURE',
          sectionTitle: heading,
          steps: takeaways,
        });
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} - ${heading} 아키텍처 요약](${svgUrl})`,
          isLast
        );
      }

      if (validScrapedUrls.length > usedScrapedIdx) {
        const photoUrl = validScrapedUrls[usedScrapedIdx++];
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} - ${heading} 현장 참고 자료](${photoUrl})`,
          isLast
        );
      }

      if (policyInfo.allowAiIllustration) {
        const aiCardUrl = buildConceptualIllustrationSvgDataUrl({
          badge: 'PRACTICAL CHECK',
          sectionTitle: heading,
          takeaways,
          keyword: targetKeyword,
        });
        insertedCount++;
        return insertVisualIntoSection(
          part,
          `![${targetKeyword} - ${heading} 실전 가이드 요약](${aiCardUrl})`,
          isLast
        );
      }

      const factCardUrl = buildCleanEditorialNoteSvgDataUrl({
        stepBadge: '실전 체크리스트',
        sectionTitle: heading,
        bulletLines: takeaways,
      });
      insertedCount++;
      return insertVisualIntoSection(
        part,
        `![${targetKeyword} - ${heading} 실전 체크리스트](${factCardUrl})`,
        isLast
      );
    }

    return part;
  });

  return {
    markdownContent: updatedParts.join('').replace(/\n{3,}/g, '\n\n').trim(),
    insertedCount,
    policyInfo,
  };
}

export function toggleInlineSummaryImagesInMarkdown(
  markdownContent: string,
  targetKeyword: string,
  title: string = '',
  blog?: BlogProfile
): { markdownContent: string; hasInlineImages: boolean; imageCount: number; policyLabel: string } {
  const policyInfo = classifyArticleVisualPolicy(targetKeyword, title, markdownContent, blog);
  const inlineImgTestPattern =
    /!\[[^\]]*\]\((?:https?:\/\/[^\s)]+|data:image\/(?:svg\+xml|png|jpeg|webp);base64,[^\s)]+)\)/i;
  const inlineImgReplacePattern =
    /\r?\n*!\[[^\]]*\]\((?:https?:\/\/[^\s)]+|data:image\/(?:svg\+xml|png|jpeg|webp);base64,[^\s)]+)\)\r?\n*/gi;
  if (inlineImgTestPattern.test(markdownContent)) {
    const cleaned = markdownContent
      .replace(inlineImgReplacePattern, '\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return {
      markdownContent: cleaned,
      hasInlineImages: false,
      imageCount: 0,
      policyLabel: policyInfo.label,
    };
  }

  const injected = injectContextualInlineVisuals(markdownContent, targetKeyword, title, blog);
  return {
    markdownContent: injected.markdownContent,
    hasInlineImages: injected.insertedCount > 0,
    imageCount: injected.insertedCount,
    policyLabel: injected.policyInfo.label,
  };
}

function stripNonBodyForMetrics(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}

function softenRigidKoreanEndings(markdown: string): string {
  const softenRigidSentence = (sentence: string): string =>
    sentence
      .replace(/합니다([.?!]*)$/, '해요$1')
      .replace(/됩니다([.?!]*)$/, '돼요$1')
      .replace(/([가-힣])입니다([.?!]*)$/, (m, prevChar: string, punct: string) => {
        if (['보', '쓰', '놓', '쌓', '트', '끼', '다', '이'].includes(prevChar)) return m;
        const code = prevChar.charCodeAt(0);
        const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
        return `${prevChar}${hasBatchim ? '이에요' : '예요'}${punct}`;
      });

  let inFence = false;
  let rigidStreak = 0;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine.startsWith('```')) {
        inFence = !inFence;
        rigidStreak = 0;
        return line;
      }
      if (
        inFence ||
        !trimmedLine ||
        trimmedLine.startsWith('#') ||
        trimmedLine.startsWith('|') ||
        trimmedLine.startsWith('![')
      ) {
        if (!trimmedLine || trimmedLine.startsWith('#') || trimmedLine.startsWith('|')) {
          rigidStreak = 0;
        }
        return line;
      }
      const parts = line.split(/(?<=[.?!])\s+/);
      const updatedParts = parts.map((sent) => {
        if (/(입니다|합니다|됩니다)[.?!]*$/.test(sent.trim())) {
          rigidStreak++;
          if (rigidStreak >= 3) {
            rigidStreak = 0;
            return softenRigidSentence(sent);
          }
        } else {
          rigidStreak = 0;
        }
        return sent;
      });
      return updatedParts.join(' ');
    })
    .join('\n');
}

function splitDenseParagraphsForMobile(markdown: string): string {
  const blocks = markdown.split(/\r?\n\s*\r?\n/);
  const breathingBlocks: string[] = [];

  for (const b of blocks) {
    const trimmed = b.trim();
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('|') ||
      trimmed.startsWith('>') ||
      trimmed.startsWith('-') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('![') ||
      trimmed.startsWith('```') ||
      /^\d+\./.test(trimmed)
    ) {
      if (trimmed) breathingBlocks.push(trimmed);
      continue;
    }

    if (trimmed.length > 170) {
      let sentences = trimmed.split(/(?<=[.?!요다죠])\s+/).filter(Boolean);
      if (sentences.length < 2 && trimmed.includes(', ')) {
        sentences = trimmed
          .split(/,\s+/)
          .map((seg, idx, arr) => (idx < arr.length - 1 ? `${seg},` : seg));
      }
      if (sentences.length >= 2) {
        let curChunk = '';
        for (const s of sentences) {
          if (curChunk && curChunk.length + s.length + 1 > 160) {
            breathingBlocks.push(curChunk.trim());
            curChunk = s;
          } else {
            curChunk = curChunk ? `${curChunk} ${s}` : s;
          }
        }
        if (curChunk.trim()) {
          breathingBlocks.push(curChunk.trim());
        }
        continue;
      }
    }
    breathingBlocks.push(trimmed);
  }
  return breathingBlocks.join('\n\n');
}

function capPrimaryTokenPerBlock(markdown: string, primaryToken: string, maxPerBlock: number = 2): string {
  const token = primaryToken.trim();
  if (token.length < 2) return markdown;
  const rx = new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

  return markdown
    .split(/\r?\n\s*\r?\n/)
    .map((block) => {
      const trimmed = block.trim();
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        trimmed.startsWith('|') ||
        trimmed.startsWith('![') ||
        trimmed.startsWith('```')
      ) {
        return block;
      }
      let seen = 0;
      return block.replace(rx, (match) => {
        seen++;
        return seen <= maxPerBlock ? match : '해당 항목';
      });
    })
    .join('\n\n');
}

export async function polishBlogPostContent(params: {
  markdownContent: string;
  title: string;
  targetKeyword: string;
  blog: BlogProfile;
  mode: 'boost_scores' | 'humanize_tone';
  subKeywords?: string[];
}): Promise<{ markdownContent: string; summaryMessage: string }> {
  const { title, targetKeyword, blog, mode, subKeywords: passedSubKeywords = [] } = params;
  let md = params.markdownContent.trim();

  // 1. Always strip duplicate H1 at the very top
  md = md.replace(/^#\s+[^\n]+\r?\n+/, '').trim();

  // 2. Replace any robotic AI clichés with natural human Korean blogger expressions
  const replacements: Array<[RegExp, string]> = [
    [/안녕하세요!\s*핵심만 알기 쉽게 정리해 드리는 블로그입니다\.?\s*/gi, ''],
    [/이자 누적 곡선을 그리게 됩니다/gi, '이자가 붙는 속도가 생각보다 훨씬 빨라져요'],
    [/자산 형성을 완주하시길 응원합니다/gi, '조금이나마 보탬이 되셨으면 좋겠습니다'],
    [/결정적 배경/gi, '많은 분들이 찾으시는 이유'],
    [/마지막 마인드셋/gi, '마무리 정리'],
    [/현명한 선택을 위한 한 줄 가이드/gi, '한눈에 보는 선택 포인트'],
    [/스탠다드 밸런스형/gi, '가장 무난한 기본형'],
    [/하이엔드 올라운더형/gi, '성능 위주 상위 모델'],
    [/선택이 아닌 필수입니다/gi, '미리 챙겨두시는 게 훨씬 유리해요'],
    [/~라고 할 수 있습니다/gi, '~라고 보시면 돼요'],
    [/확인하는 것이 중요합니다/gi, '꼭 한 번 체크해 보시는 걸 추천해요'],
    [/살펴보도록 하겠습니다/gi, '핵심부터 차근히 정리해 볼게요'],
    [/알아보도록 하겠습니다/gi, '알기 쉽게 짚어볼게요'],
    [/참고하시기 바랍니다/gi, '참고해 보시면 좋아요'],
  ];
  for (const [rx, rep] of replacements) {
    md = md.replace(rx, rep);
  }

  // 3. Remove mechanical H2 keyword stuffing if full targetKeyword is repeated in >2 H2s
  const kwLower = targetKeyword.trim().toLowerCase();
  if (kwLower.length >= 6) {
    let h2Seen = 0;
    md = md.replace(/^##\s+(.+)$/gm, (full, hText: string) => {
      if (hText.toLowerCase().includes(kwLower)) {
        h2Seen++;
        if (h2Seen > 2) {
          const stripped = hText
            .replace(new RegExp(targetKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
            .replace(/^[:·\-\s]+/, '')
            .trim();
          if (stripped.length >= 6) {
            return `## ${stripped}`;
          }
        }
      }
      return full;
    });
  }

  // 3.5 & 4. Break consecutive rigid endings and split long paragraphs for mobile readability
  md = softenRigidKoreanEndings(md);
  md = splitDenseParagraphsForMobile(md);

  if (mode === 'boost_scores') {
    const isPolicy = isPolicyOrFinanceApplyTopic(targetKeyword);
    const coreTokens = targetKeyword
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2);
    const primaryToken = coreTokens[0] || targetKeyword.trim();

    // Check visible intro (strictly excluding embedded base64 images & code blocks)
    const visibleIntroSample = stripNonBodyForMetrics(md).slice(0, 350);
    const firstH2Idx = md.search(/^##\s+/m);
    const introBlockRaw =
      firstH2Idx === -1 ? md.split(/\r?\n\s*\r?\n/).slice(0, 2).join('\n\n') : md.slice(0, firstH2Idx);
    const introPlainLen = stripNonBodyForMetrics(introBlockRaw).replace(
      /[#>*_~`|\[\]\(\)\s-]/g,
      ''
    ).length;

    if (!visibleIntroSample.includes(primaryToken)) {
      const introP1 = isPolicy
        ? `요즘 주변에서도 **${targetKeyword}** 관련해서 실제 조건이나 적용 기준이 어떻게 되는지 찾아보시는 분들이 정말 많더라고요.`
        : `요즘 **${targetKeyword}** 소식이 연이어 올라오면서 핵심 쟁점이 무엇인지 찾아보시는 분들이 꾸준히 늘고 있어요.`;
      const introP2 = isPolicy
        ? `제가 공식 안내 기준과 실전 비교 포인트를 교차해서 확인해 보니 처음 신청할 때 놓치기 쉬운 숫자 2~3가지만 먼저 잡아도 시행착오를 크게 줄일 수 있어요.`
        : `주요 보도와 공개 수치를 교차해 살펴보면 단기 이슈에 휩쓸리지 않고 전체 흐름을 한눈에 가늠하는 데 큰 도움이 됩니다.`;
      md = `${introP1}\n\n${introP2}\n\n${md}`;
    } else if (introPlainLen < 230 && !md.includes('실제 적용 기준까지 한눈에 파악해 보세요')) {
      const complement = isPolicy
        ? `공식 안내 기준과 실제 신청 화면을 비교해 보면 처음 접하시는 분들도 10분 안에 적용 기준을 잡으실 수 있도록 핵심 절차만 골라 정리했어요.`
        : `주요 수치와 배경 맥락을 함께 대조해 보면 단편적인 기사만 볼 때보다 훨씬 객관적으로 핵심 흐름과 변수를 이해하실 수 있어요.`;
      const newFirstH2 = md.search(/^##\s+/m);
      if (newFirstH2 > 0) {
        md = `${md.slice(0, newFirstH2).trimEnd()}\n\n${complement}\n\n${md.slice(newFirstH2)}`;
      } else {
        md = `${complement}\n\n${md}`;
      }
    }

    // Measure actual body deficits using stripped body text
    const visibleText = stripNonBodyForMetrics(md);
    const plainLen = visibleText.replace(/[#>*_~`|\[\]\(\)\s-]/g, '').length;
    const factMatches =
      visibleText.match(
        /\d+(?:[.,]\d+)?\s*(?:%|퍼센트|원|만원|억원|조원|달러|개월|년|월|일|주|세|점|배|건|가지|단계|시간|분|명|위|회|차|표|석|곳|개|대|종|번|호|km|kg|mg|만\s*원)/g
      ) || [];
    const existingH2Count = (visibleText.match(/^##\s+.+$/gm) || []).length;
    const existingQuestionHeadings = (visibleText.match(/^#{2,3}\s+.*[?？]\s*$/gm) || []).length;
    const existingProseCount = visibleText
      .split(/\r?\n\s*\r?\n/)
      .map((b) => b.trim())
      .filter(
        (b) =>
          Boolean(b) &&
          !b.startsWith('#') &&
          !b.startsWith('|') &&
          !b.startsWith('>') &&
          !b.startsWith('-') &&
          !b.startsWith('*') &&
          !/^\d+\./.test(b)
      ).length;
    const hasBlockquote = /^>\s+/m.test(visibleText);
    const visibleLower = visibleText.toLowerCase();
    const initialMissingSubKw = passedSubKeywords.filter(
      (k) => k.trim().length >= 2 && !visibleLower.includes(k.toLowerCase())
    );

    const needsEnrichment =
      plainLen < 1850 ||
      factMatches.length < 7 ||
      existingH2Count < 4 ||
      existingQuestionHeadings < 3 ||
      existingProseCount < 10 ||
      !hasBlockquote ||
      initialMissingSubKw.length > 0;

    if (needsEnrichment) {
      let extraFacts: string[] = [];
      let extraSubKw: string[] = [];
      try {
        throwIfTaskCancelled();
        const comp = await analyzeCompetitorSERP(targetKeyword);
        throwIfTaskCancelled();
        extraFacts = (comp.extractedKeyFacts || []).slice(0, 4);
        extraSubKw = (comp.extractedSubKeywords || []).slice(0, 4);
      } catch (err: any) {
        if (err?.message === 'TASK_CANCELLED') throw err;
        // fallback cleanly to deterministic enrichment blocks
      }

      const combinedSubKw = Array.from(
        new Set([...passedSubKeywords, ...extraSubKw].map((s) => s.trim()).filter(Boolean))
      ).filter((k) => !visibleLower.includes(k.toLowerCase()));

      const chunksToAdd: string[] = [];
      let h2Budget = Math.max(0, 6 - existingH2Count);
      const nextHeadingPrefix = (): string => {
        if (h2Budget > 0) {
          h2Budget--;
          return '##';
        }
        return '###';
      };

      const sanitizedFacts = extraFacts
        .map((f) => capPrimaryTokenPerBlock(f.trim(), primaryToken, 1))
        .filter((f) => f.length >= 12);

      // Block 1: Core Criteria / Issues + Quote + Fact Bullets + first 2 missing LSI terms
      const coreAddedAlready =
        md.includes('실제로 진행할 때 가장 많이 헷갈리는 핵심 기준은?') ||
        md.includes('이번 사안에서 가장 주목해야 할 쟁점은?');
      if (!coreAddedAlready) {
        const lsiSlice1 = combinedSubKw.slice(0, 2);
        const lsiSentence1 =
          lsiSlice1.length > 0
            ? `특히 많은 분들이 놓치시는 부분이 바로 **${lsiSlice1.join('**, **')}** 항목인데요, 두 조건의 우선순위를 구분하면 낭비되는 시간을 크게 줄일 수 있어요.`
            : isPolicy
              ? `특히 **우대 적용 기준**과 **필수 서류 기한**을 미리 대조하지 않고 진행했다가 접수 단계에서 다시 보완하는 경우를 종종 봤거든요.`
              : `특히 **발표 배경 데이터**와 **실제 체감 영향**을 분리해 살펴보면 겉으로 드러난 숫자 이면의 핵심 신호가 또렷하게 보여요.`;

        const factBulletsBlock =
          sanitizedFacts.length >= 2
            ? sanitizedFacts
                .slice(0, 4)
                .map((f, idx) => `- **핵심 체크 ${idx + 1}**: ${f}`)
                .join('\n\n')
            : isPolicy
              ? [
                  '- **사전 준비 기간**: 접수 마감일 기준 최소 1~2주 전에 자격 요건과 100% 증빙 서류를 먼저 점검해 두시는 것이 안전해요.',
                  '- **혜택 차이 비교**: 기본 조건과 우대 요건을 비교하면 실제 수령액이나 지원 폭이 15~30% 이상 달라질 수 있어요.',
                  '- **진행 3단계**: 대상 조회 ➔ 증빙 업로드 ➔ 최종 접수 확인 순으로 진행하면 누락 없이 5분 내외로 마무리돼요.',
                ].join('\n\n')
              : [
                  '- **핵심 분석 3단계**: 발단 원인 ➔ 당사자 입장 비교 ➔ 향후 1~3개월 후속 일정 순으로 확인하면 전체 구도가 잡혀요.',
                  '- **기간별 비교 기준**: 단기 변동(1~2주)과 중장기 흐름(6개월~1년)을 나눠 살펴보아야 일시적 착시를 피할 수 있어요.',
                  '- **교차 검증 원칙**: 최소 2~3개 이상의 공식 발표와 원문 수치를 대조해 과장된 해석을 걸러내는 게 좋아요.',
                ].join('\n\n');

        const hPrefix1 = nextHeadingPrefix();
        const heading1 = isPolicy
          ? `${hPrefix1} 실제로 진행할 때 가장 많이 헷갈리는 핵심 기준은?`
          : `${hPrefix1} 이번 사안에서 가장 주목해야 할 쟁점은?`;
        const lead1 = isPolicy
          ? `결론부터 말씀드리면 이 제도를 활용할 때는 본인 자격과 적용 기준 숫자를 1차로 대조해 보시는 게 시간을 가장 아끼는 방법이에요.`
          : `결론부터 말씀드리면 이번 흐름은 단편적인 제목 하나보다 앞뒤 맥락과 객관적 수치를 나란히 두고 짚어보는 편이 가장 정확해요.`;
        const quote1 = isPolicy
          ? `> 💡 **핵심 한 줄 요약**: 지원 조건의 **15~30%** 차이는 대부분 우대 요건과 사전 신청 시기를 놓치는 데서 갈리므로 2가지 기준을 먼저 확인하세요.`
          : `> 💡 **핵심 한 줄 요약**: 주요 발표 뒤 **1~2주** 구간의 단기 반응보다 향후 **3개월** 지표와 공식 후속 대책을 대조해 보는 것이 핵심이에요.`;

        chunksToAdd.push([heading1, lead1, lsiSentence1, quote1, factBulletsBlock].join('\n\n'));
      }

      // Block 2: Practical Q&A (guarantees question headings + short AEO answer paragraphs + next 2 LSI terms)
      const qaAddedAlready = md.includes('자주 물어보시는 실전 Q&A와 체크포인트 정리');
      if (!qaAddedAlready) {
        const lsiSlice2 = combinedSubKw.slice(2, 4);
        const hPrefix2 = nextHeadingPrefix();
        const qnaLead = isPolicy
          ? `실제로 조건을 따져볼 때 독자분들이 가장 자주 막히시는 핵심 질문 2가지를 현장 기준에 맞춰 바로 풀어봤어요.`
          : `이번 소식과 관련해 독자분들이 가장 궁금해하시는 핵심 질문 두 가지만 추려서 알기 쉽게 짚어드릴게요.`;
        const q1Title = isPolicy
          ? '### Q1. 신청이나 변경 시기는 언제가 가장 유리할까요?'
          : '### Q1. 왜 지금 시점에 이 이슈가 다시 부각되었을까요?';
        const q1Body = isPolicy
          ? `마감 직전 2~3일은 접속과 심사가 몰려 처리 기간이 길어지기 쉬우니 최소 5일 전에는 여유 있게 접수하시는 편이 안전해요.${
              lsiSlice2[0] ? ` 이때 **${lsiSlice2[0]}** 여부도 함께 체크해 두면 재접수를 막을 수 있어요.` : ''
            }`
          : `최근 1~2개월 사이 누적된 대내외 변수와 정책 일정이 맞물리면서 향후 방향성을 가르는 기준점이 되었기 때문이에요.${
              lsiSlice2[0] ? ` 특히 **${lsiSlice2[0]}** 변화가 맞물리며 관심이 커졌어요.` : ''
            }`;
        const q2Title = isPolicy
          ? '### Q2. 중간에 조건이 바뀌거나 해지해야 할 때는 어떻게 될까요?'
          : '### Q2. 앞으로 어떤 후속 흐름을 눈여겨봐야 할까요?';
        const q2Body = isPolicy
          ? `유지 기간(1년~3년 이상)과 우대 충족 여부에 따라 최종 정산 금액이 크게 달라지므로 화면의 요약 기준표를 꼭 저장해 두세요.${
              lsiSlice2[1] ? ` 필요시 **${lsiSlice2[1]}** 규정을 먼저 비교해 보시면 손해를 줄이실 수 있어요.` : ''
            }`
          : `단기 며칠간의 변동보다 앞으로 1~3개월 안에 발표될 후속 조치와 공식 통계 지표를 차분히 확인하시는 걸 추천드려요.${
              lsiSlice2[1] ? ` 더불어 **${lsiSlice2[1]}** 추이까지 같이 보시면 판단이 훨씬 선명해져요.` : ''
            }`;

        chunksToAdd.push(
          [`${hPrefix2} 자주 물어보시는 실전 Q&A와 체크포인트 정리`, qnaLead, q1Title, q1Body, q2Title, q2Body].join(
            '\n\n'
          )
        );
      }

      // Block 3: Depth & Step-by-Step Practical Roadmap (ensures >= 1850 chars, >= 10 short prose paras, multi-section facts, remaining LSI)
      const projectedLen =
        plainLen +
        chunksToAdd.join('\n\n').replace(/[#>*_~`|\[\]\(\)\s-]/g, '').length;
      const stepAddedAlready =
        md.includes('진행 전 손해를 막는 실전 점검 단계는?') ||
        md.includes('핵심 맥락과 변동 추이를 읽는 기준은?');
      if (
        !stepAddedAlready &&
        (projectedLen < 1850 || existingH2Count < 4 || existingProseCount < 9 || combinedSubKw.length > 4)
      ) {
        const lsiSlice3 = combinedSubKw.slice(4, 6);
        const hPrefix3 = nextHeadingPrefix();
        const heading3 = isPolicy
          ? `${hPrefix3} 진행 전 손해를 막는 실전 점검 단계는?`
          : `${hPrefix3} 핵심 맥락과 변동 추이를 읽는 기준은?`;
        const stepLead = isPolicy
          ? `실제 신청 화면으로 넘어가기 전에 딱 10분만 투자해 3가지 실수 요인을 걸러내면 반려나 지급 지연 위험을 크게 낮출 수 있어요.`
          : `정보가 빠르게 쏟아질수록 10분만 들여 3가지 판단 기준을 세워 두면 불필요한 혼선을 피하고 핵심만 추려낼 수 있어요.`;
        const stepP2 = isPolicy
          ? `먼저 최근 6개월~1년 기준의 소득·자격 구간 변동이 반영되었는지 조회하고, 본인이 1순위 대상인지 2순위 해당자인지 확인해 두셔야 해요.`
          : `우선 최근 6개월~1년 단위 추세를 먼저 확인한 뒤 이번 변화가 일회성 이벤트인지 구조적 전환인지 2회 이상 교차 점검해 보세요.`;
        const stepP3 = isPolicy
          ? `또한 안내문 하단의 예외 조항을 놓쳐 10~20%가량 불이익을 받는 사례가 많으니 자주 쓰시는 체크리스트에 1~2일 전 미리 표시해 두세요.${
              lsiSlice3.length > 0 ? ` 마지막으로 **${lsiSlice3.join('**, **')}** 기준도 함께 대조해 보시면 빠짐없이 챙기실 수 있어요.` : ''
            }`
          : `여기에 주요 이해관계자별 입장을 나란히 비교하면 체감 파급력을 가늠할 때 오차를 10~20% 이상 줄여 객관적인 결론을 내릴 수 있어요.${
              lsiSlice3.length > 0 ? ` 끝으로 **${lsiSlice3.join('**, **')}** 지표까지 체크해 두면 흐름 파악이 훨씬 수월해져요.` : ''
            }`;
        const stepBullets = isPolicy
          ? '- **오류 방지 체크**: 제출 버튼 클릭 전 2가지 필수 서류(신분·자격 증빙) 파일 형식을 다시 확인해 주세요.\n\n- **사후 점검 루틴**: 접수 후 3~5영업일 내에 알림톡 또는 마이페이지 승인 상태를 한 번 더 확인하시는 편이 좋아요.'
          : '- **1차 팩트 체크**: 원문 수치와 기준 날짜(연·월)가 누락되지 않았는지 2가지 이상 출처로 확인하세요.\n\n- **후속 모니터링**: 이슈 발표 이후 7일·30일 단위로 후속 공지나 수정 안내가 올라오는지 체크해 두시면 좋습니다.';

        chunksToAdd.push([heading3, stepLead, stepP2, stepP3, stepBullets].join('\n\n'));
      }

      if (chunksToAdd.length > 0) {
        const extraSection = capPrimaryTokenPerBlock(chunksToAdd.join('\n\n'), primaryToken, 2);
        const paras = md.split(/\r?\n\s*\r?\n/);
        if (
          paras.length >= 3 &&
          /댓글|공감|도움|궁금|바랍니다|바랄게요/.test(stripNonBodyForMetrics(paras[paras.length - 1]))
        ) {
          const hasTwoLineOutro =
            paras.length >= 4 && /지금까지|정리해 보았는데요/.test(paras[paras.length - 2]);
          const insertAt = hasTwoLineOutro ? paras.length - 2 : paras.length - 1;
          md = [...paras.slice(0, insertAt), extraSection, ...paras.slice(insertAt)].join('\n\n');
        } else {
          md += `\n\n${extraSection}`;
        }
      }
    }

    // Ensure a concise 3-row Markdown comparison/summary table exists for AEO structured extraction
    const hasComparisonTable = /\|.+\|.+\|\r?\n\|[\s:-]+\|/.test(md);
    if (!hasComparisonTable) {
      const currentH2Total = (stripNonBodyForMetrics(md).match(/^##\s+.+$/gm) || []).length;
      const tableHeadingPrefix = currentH2Total >= 7 ? '###' : '##';
      const cleanH2List = (stripNonBodyForMetrics(md).match(/^##\s+(.+)$/gm) || [])
        .map((h) => h.replace(/^##\s+/, '').replace(/[*_`]/g, '').trim())
        .filter((h) => !/마치며|마무리|요약표/.test(h))
        .slice(0, 3);
      const row1Topic = cleanH2List[0] || '핵심 적용 기준 및 자격';
      const row2Topic = cleanH2List[1] || '실전 Q&A 비교 포인트';
      const row3Topic = cleanH2List[2] || '진행 전 필수 체크사항';
      const summaryTableBlock = [
        `${tableHeadingPrefix} 한눈에 정리하는 핵심 비교 요약표`,
        '',
        '지금까지 정리한 주요 기준과 체크 포인트를 아래 요약표에서 10초 만에 빠르게 대조해 보실 수 있어요.',
        '',
        '| 구분 | 핵심 내용 | 체크 포인트 |',
        '| --- | --- | --- |',
        `| 1. 핵심 주제 | ${row1Topic.slice(0, 28)} | 도입부 핵심 개념·기준 확인 |`,
        `| 2. 실전 분석 | ${row2Topic.slice(0, 28)} | 구체적 수치·조건 대조 필수 |`,
        `| 3. 점검 사항 | ${row3Topic.slice(0, 28)} | 최신 공고 및 변동 사항 체크 |`,
      ].join('\n');

      const parasForTable = md.split(/\r?\n\s*\r?\n/);
      if (
        parasForTable.length >= 3 &&
        /댓글|공감|도움|궁금|바랍니다|바랄게요/.test(
          stripNonBodyForMetrics(parasForTable[parasForTable.length - 1])
        )
      ) {
        const insertIdx = parasForTable.length - 1;
        md = [
          ...parasForTable.slice(0, insertIdx),
          summaryTableBlock,
          ...parasForTable.slice(insertIdx),
        ].join('\n\n');
      } else {
        md += `\n\n${summaryTableBlock}`;
      }
    }

    // Ensure friendly human outro (checking stripped body so trailing base64 images cannot mask it)
    const last300 = stripNonBodyForMetrics(md).slice(-300);
    if (!/댓글|공감|도움|궁금/.test(last300)) {
      md += `\n\n${
        blog.persona?.signatureOutro ||
        '오늘 직접 정리해 드린 내용이 조금이나마 도움 되셨기를 바랍니다! 혹시 보시면서 궁금한 점이 있으시면 편하게 댓글 남겨주세요 :)'
      }`;
    }

    // Final normalization pass so injected blocks follow mobile breathing, gentle endings, and safe density caps
    md = capPrimaryTokenPerBlock(md, primaryToken, 2);
    md = softenRigidKoreanEndings(md);
    md = splitDenseParagraphsForMobile(md);

    return {
      markdownContent: enforceCurrentDateContextInMarkdown(md).replace(/\n{3,}/g, '\n\n').trim(),
      summaryMessage:
        'SEO · AEO(두괄식 답변·요약표) · GEO(수치 팩트 밀도) · D.I.A.+(모바일 문단 호흡·구어체 리듬) 감점 요인이 자동 보강되었습니다!',
    };
  } else {
    // mode === 'humanize_tone'
    md = md
      .replace(/합니다\.\s+/g, '해요. ')
      .replace(/입니다\.\s+그러나\s+/g, '인데요. 다만 ')
      .replace(/또한,\s+/g, '여기에 더해 ')
      .replace(/따라서\s+/g, '그래서 실제로 해보면 ')
      .replace(/결론적으로\s+/g, '정리해 보면 ');

    return {
      markdownContent: enforceCurrentDateContextInMarkdown(md).replace(/\n{3,}/g, '\n\n').trim(),
      summaryMessage:
        '딱딱한 보고서/번역투 표현을 덜어내고 실제 한국 블로거의 친근한 구어체와 모바일 문단 호흡으로 다듬었습니다!',
    };
  }
}

export async function autoSelfPolishPost(params: {
  title: string;
  targetKeyword: string;
  markdownContent: string;
  subKeywords: string[];
  extractedTags?: string[];
  blog: BlogProfile;
  internalLinkCount: number;
  affiliateLinkCount: number;
  minTargetScore?: number;
}): Promise<{
  markdownContent: string;
  tags: string[];
  seoReport: SEOScoreReport;
  metaDescription: string;
  initialScore: number;
  boosted: boolean;
}> {
  const {
    title,
    targetKeyword,
    subKeywords,
    extractedTags = [],
    blog,
    internalLinkCount,
    affiliateLinkCount,
    minTargetScore = 88,
  } = params;

  // Step 1: Always run humanize_tone to soften consecutive rigid endings and improve mobile breathing
  const humanized = await polishBlogPostContent({
    markdownContent: params.markdownContent,
    title,
    targetKeyword,
    blog,
    mode: 'humanize_tone',
  });
  let currentMd = humanized.markdownContent;

  let tags = buildRelevantPostTags({
    keyword: targetKeyword,
    subKeywords,
    blog,
    aiTags: extractedTags,
    markdownContent: currentMd,
  });

  let seoReport = evaluatePostSEO({
    title,
    targetKeyword,
    markdownContent: currentMd,
    subKeywords,
    tags,
    internalLinkCount,
    affiliateLinkCount,
  });
  const initialScore = seoReport.totalScore;
  let boosted = false;

  // Step 2: If below target score, run boost_scores + PNG safeguard automatically
  if (seoReport.totalScore < minTargetScore) {
    const boostedRes = await polishBlogPostContent({
      markdownContent: currentMd,
      title,
      targetKeyword,
      blog,
      mode: 'boost_scores',
      subKeywords,
    });
    currentMd = await convertInlineSvgsToPngInMarkdown(
      boostedRes.markdownContent,
      `${blog.id}-${targetKeyword}-${Date.now()}`
    );
    tags = buildRelevantPostTags({
      keyword: targetKeyword,
      subKeywords,
      blog,
      aiTags: extractedTags,
      markdownContent: currentMd,
    });
    seoReport = evaluatePostSEO({
      title,
      targetKeyword,
      markdownContent: currentMd,
      subKeywords,
      tags,
      internalLinkCount,
      affiliateLinkCount,
    });
    boosted = true;
  }

  const plainSnippet = currentMd
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/[#>*_~`|\[\]\(\)-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 155);

  return {
    markdownContent: currentMd,
    tags,
    seoReport,
    metaDescription: `${plainSnippet}...`,
    initialScore,
    boosted,
  };
}

export async function generateBlogPostContent(params: {
  blog: BlogProfile;
  keyword: string;
  preferredTitle?: string;
  provider: WebAISessionInfo;
  preferredModel?: string;
  allProviders?: WebAISessionInfo[];
  existingPostsForInternalLinks: Array<{ id: string; blogId: string; title: string; publishedUrl?: string; targetKeyword: string }>;
  affiliates: AffiliateItem[];
  browserUserDataPath: string;
  headless: boolean;
  browserAutomationEngine?: 'aside' | 'playwright';
  customInstructions?: string;
  referenceSourceUrlOrText?: string;
}): Promise<{
  title: string;
  alternativeTitles: string[];
  subKeywords: string[];
  extractedTags: string[];
  markdownContent: string;
  htmlContent: string;
  metaDescription: string;
  aiProviderUsed: string;
  internalLinksInserted: InternalLinkEntry[];
  affiliateItemsInserted: string[];
}> {
  const {
    blog,
    keyword,
    preferredTitle,
    provider,
    preferredModel,
    allProviders = [],
    existingPostsForInternalLinks,
    affiliates,
    browserUserDataPath,
    headless,
    browserAutomationEngine = 'aside',
    customInstructions,
    referenceSourceUrlOrText,
  } = params;

  const isPolicy = isPolicyOrFinanceApplyTopic(keyword);
  const viralTitles = generateViralTitlesForKeyword(keyword, blog);

  // Guard against stale policy-template titles or leftover titles from a previous unrelated keyword
  const kwTokens = keyword
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase())
    .filter((t) => t.length >= 2);
  const preferredMatchesKeyword =
    preferredTitle &&
    (kwTokens.length === 0 ||
      kwTokens.some((tok) => preferredTitle.toLowerCase().includes(tok)));

  const cleanedPreferredTitle =
    preferredTitle &&
    preferredMatchesKeyword &&
    !(
      !isPolicy &&
      /핵심 조건과 실제 혜택|내가 대상일까|신청 전 꼭 알아둘|조건 및 신청방법/.test(preferredTitle)
    )
      ? cleanClumsyBlogTitle(preferredTitle)
      : '';

  let chosenTitle = cleanedPreferredTitle || viralTitles[0];

  throwIfTaskCancelled();

  // Real-time Naver Top 3 Competitor Full-Post Gap, Fact & Live Web Screenshot Extraction in parallel
  let competitorHeadings: string[] = [];
  let extractedKeyFacts: string[] = [];
  let competitorSubKeywords: string[] = [];
  let contentGaps: string[] = [];
  let differentiationAngle = '';
  let scrapedImageUrls: string[] = [];
  try {
    const [competitorResult, screenshotResult] = await Promise.allSettled([
      analyzeCompetitorSERP(keyword),
      captureLiveWebReferenceScreenshotPngDataUrl(keyword, referenceSourceUrlOrText),
    ]);
    if (competitorResult.status === 'fulfilled') {
      const competitorReport = competitorResult.value;
      competitorHeadings = competitorReport.competitorHeadings || [];
      extractedKeyFacts = competitorReport.extractedKeyFacts || [];
      competitorSubKeywords = competitorReport.extractedSubKeywords || [];
      contentGaps = competitorReport.contentGaps || [];
      differentiationAngle = competitorReport.differentiationAngle || '';
      scrapedImageUrls = competitorReport.scrapedImageUrls || [];
    }
    if (screenshotResult.status === 'fulfilled' && screenshotResult.value) {
      scrapedImageUrls = [screenshotResult.value, ...scrapedImageUrls];
    }
  } catch {
    // Fallback if offline
  }

  throwIfTaskCancelled();

  let effectiveCustomInstructions = customInstructions || '';
  if (referenceSourceUrlOrText && referenceSourceUrlOrText.trim()) {
    try {
      const refData = await extractReferenceSourceMaterial(referenceSourceUrlOrText);
      if (refData.extractedFacts.length > 0) {
        extractedKeyFacts = [...refData.extractedFacts, ...extractedKeyFacts].slice(0, 10);
      }
      if (refData.extractedSummary) {
        effectiveCustomInstructions = `[참고 원문/기사 핵심 자료 — 아래 팩트와 내용을 바탕으로 내 블로그 말투로 자연스럽게 재창작하세요]\n출처 제목: ${refData.sourceTitle}\n핵심 본문 요약:\n${refData.extractedSummary}\n\n${effectiveCustomInstructions}`.trim();
      }
      if (!cleanedPreferredTitle && refData.sourceTitle && refData.sourceTitle.length >= 10) {
        chosenTitle = cleanClumsyBlogTitle(refData.sourceTitle);
      }
    } catch {
      // ignore
    }
  }

  throwIfTaskCancelled();

  const intent = detectSearchIntent(keyword);
  let subKeywords: string[];
  if (intent === 'comparison') {
    subKeywords = ['핵심 차이점 비교', '실사용 장단점', '가격 및 가성비 기준', '추천 대상 정리'];
  } else if (intent === 'howto') {
    subKeywords = ['사전 준비물과 자격', '단계별 진행 순서', '자주 겪는 오류 해결', '놓치기 쉬운 꿀팁'];
  } else if (intent === 'review') {
    subKeywords = ['솔직한 실사용 후기', '실제 체감 장단점', '구매 전 체크포인트', '최종 만족도 평가'];
  } else if (isPolicy) {
    subKeywords = ['실수령 혜택과 조건', '가장 중요한 핵심 기준', '신청 및 관리 요령', '주의해야 할 점'];
  } else {
    subKeywords = ['발단과 전후 경위', '핵심 쟁점과 반응', '실제 파급 영향', '후속 일정과 변수'];
  }
  if (competitorSubKeywords.length > 0) {
    subKeywords = Array.from(new Set([...competitorSubKeywords.slice(0, 4), ...subKeywords])).slice(0, 6);
  }

  const LINK_STOPWORDS = new Set([
    '방법', '정리', '비교', '이유', '핵심', '가이드', '실무', '초보자',
    '입문', '팁', '조건', '신청', '전망', '배경', '특징', '주의사항',
    '추천', '후기', '장단점', '기준', '총정리', '완벽', '이해', '최신',
  ]);
  const kwDomainTokens = keyword
    .split(/[\s,·"'“”‘’\[\]()!?…:/]+/)
    .map((t) =>
      t
        .replace(/^[^가-힣a-zA-Z0-9]+|[^가-힣a-zA-Z0-9]+$/g, '')
        .replace(/(?:에서|으로|은|는|이|가|을|를|의|에|와|과)$/, (m, offset, full) =>
          full.slice(0, offset).length >= 2 ? '' : m
        )
        .trim()
        .toLowerCase()
    )
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t) && !LINK_STOPWORDS.has(t));

  const internalLinks: InternalLinkEntry[] = existingPostsForInternalLinks
    .filter((p) => {
      if (p.blogId !== blog.id || p.targetKeyword === keyword || !p.publishedUrl) return false;
      if (/\/manage\b|\/admin\b|postwrite|newpost/i.test(p.publishedUrl)) return false;
      if (kwDomainTokens.length === 0) return false;
      const candidateText = `${p.targetKeyword} ${p.title}`.toLowerCase();
      return kwDomainTokens.some((tok) => candidateText.includes(tok));
    })
    .slice(0, 2)
    .map((p) => ({
      postId: p.id,
      blogId: p.blogId,
      title: p.title,
      url: p.publishedUrl!,
      keyword: p.targetKeyword,
    }));

  let matchedAffiliates: AffiliateItem[] = [];
  if (blog.schedule.autoInsertAffiliate) {
    const activeAffs = affiliates.filter((a) => a.active);
    matchedAffiliates = activeAffs.filter((a) =>
      a.triggerKeywords.some((tk) => keyword.toLowerCase().includes(tk.toLowerCase()))
    );
    matchedAffiliates = matchedAffiliates.slice(0, 1);
  }

  const prompt = buildMasterSEOPrompt({
    blog,
    keyword,
    chosenTitle,
    subKeywords,
    internalLinks,
    matchedAffiliates,
    customInstructions: effectiveCustomInstructions,
    competitorHeadings,
    extractedKeyFacts,
    contentGaps,
    differentiationAngle,
  });

  let markdownContent: string | null = null;
  const requestedModel =
    preferredModel ||
    (blog.schedule.preferredAIProvider === provider.id ? blog.schedule.preferredModel : undefined) ||
    provider.selectedModel;
  let aiProviderUsed = `${provider.name}`;

  const isCliProvider = (p: WebAISessionInfo) =>
    p.connectionType === 'local_cli' || p.id.endsWith('_cli');

  // Stage 1: Try primary selected provider (Local Subscription CLI, Local Ollama, or Web Browser Session)
  if (provider.id === 'ollama_local') {
    const ollamaRes = await tryGenerateWithOllama(prompt, requestedModel);
    throwIfTaskCancelled();
    if (ollamaRes) {
      markdownContent = ollamaRes.content;
      aiProviderUsed = `Local Ollama [모델: ${ollamaRes.modelUsed}]`;
    }
  } else if (isCliProvider(provider)) {
    let cliRes = await tryGenerateWithSubscriptionCLI(provider, prompt, requestedModel);
    throwIfTaskCancelled();
    // If agy_cli primary model timed out or hit model capacity, retry once with fast gemini-3.8-flash-high
    if (
      (!cliRes || cliRes.content.trim().length < 500) &&
      provider.id === 'agy_cli' &&
      requestedModel !== 'gemini-3.8-flash-high'
    ) {
      cliRes = await tryGenerateWithSubscriptionCLI(
        provider,
        prompt,
        'gemini-3.8-flash-high',
        { timeoutMs: 65000 }
      );
      throwIfTaskCancelled();
    }
    if (cliRes && cliRes.content.trim().length >= 500) {
      markdownContent = cliRes.content;
      aiProviderUsed = `${provider.name} [모델: ${cliRes.modelUsed}]`;
    } else {
      markdownContent = null;
    }
  } else if (provider.loggedIn) {
    markdownContent = await tryAutomateBrowserWebAI({
      provider,
      prompt,
      browserUserDataPath,
      headless,
      browserAutomationEngine,
    });
    throwIfTaskCancelled();
    if (markdownContent && markdownContent.trim().length >= 500) {
      aiProviderUsed = `${provider.name} [모델: ${requestedModel || '기본 웹 모델'}]`;
    } else {
      markdownContent = null;
    }
  }

  throwIfTaskCancelled();

  // Stage 2: Automatic Failover to Installed Local Subscription CLIs (agy / claude / codex) if primary hit quota
  if (!markdownContent && allProviders.length > 0) {
    const backupCliProviders = allProviders.filter(
      (s) => s.id !== provider.id && isCliProvider(s) && s.enabled && s.loggedIn
    );
    for (const cliBackup of backupCliProviders) {
      throwIfTaskCancelled();
      const cliResult = await tryGenerateWithSubscriptionCLI(cliBackup, prompt);
      throwIfTaskCancelled();
      if (cliResult && cliResult.content.trim().length >= 500) {
        markdownContent = cliResult.content;
        aiProviderUsed = `${cliBackup.name} [모델: ${cliResult.modelUsed} · 자동 전환]`;
        break;
      }
    }
  }

  throwIfTaskCancelled();

  // Stage 3: Automatic Failover Rotation to Logged-in Web Browser AI Sessions
  if (!markdownContent && allProviders.length > 0) {
    const backupWebProviders = allProviders.filter(
      (s) =>
        s.id !== provider.id &&
        s.id !== 'ollama_local' &&
        !isCliProvider(s) &&
        s.loggedIn
    );
    for (const backup of backupWebProviders) {
      throwIfTaskCancelled();
      const backupResult = await tryAutomateBrowserWebAI({
        provider: backup,
        prompt,
        browserUserDataPath,
        headless,
        browserAutomationEngine,
      });
      throwIfTaskCancelled();
      if (backupResult && backupResult.trim().length >= 500) {
        markdownContent = backupResult;
        aiProviderUsed = `${backup.name} [모델: ${backup.selectedModel || '웹 세션'} · 자동 전환]`;
        break;
      }
    }
  }

  throwIfTaskCancelled();

  // Stage 4: Try Unlimited Local Ollama if not already tried
  if (!markdownContent && provider.id !== 'ollama_local') {
    const ollamaFallback = await tryGenerateWithOllama(prompt);
    throwIfTaskCancelled();
    if (ollamaFallback && ollamaFallback.content.trim().length >= 500) {
      markdownContent = ollamaFallback.content;
      aiProviderUsed = `Local Ollama [모델: ${ollamaFallback.modelUsed} · 무제한 백업]`;
    }
  }

  throwIfTaskCancelled();

  // Stage 5: Ultimate Non-Stop Hybrid SEO Synthesis Engine Fallback
  if (!markdownContent || markdownContent.trim().length < 500) {
    markdownContent = synthesizeHighRetentionArticle({
      blog,
      keyword,
      chosenTitle,
      subKeywords,
      internalLinks,
      matchedAffiliates,
      customInstructions: effectiveCustomInstructions,
      competitorHeadings,
      extractedKeyFacts,
      contentGaps,
      differentiationAngle,
    });
    aiProviderUsed = provider.loggedIn
      ? `${provider.name} (사용량 한도 도달 → 무중단 하이브리드 SEO 엔진 자동 백업 가동)`
      : `${provider.name} [의도 맞춤형 다중 아키텍처 엔진 - CLI 또는 웹 AI 연결 시 실시간 구동]`;
  }

  // Extract AI-generated context-matched TITLE: line, TAGS: line, or top-level H1 (# ...) at the start of response
  let extractedTags: string[] = [];
  if (markdownContent) {
    let trimmedMd = markdownContent.trim();
    const titlePrefixMatch = trimmedMd.match(/^[*#\s]*(?:TITLE|제목)[*#\s]*[:：]\s*(.+?)\r?\n+/i);
    if (titlePrefixMatch) {
      const extractedAiTitle = titlePrefixMatch[1]
        .replace(/^["'「『\[*#]+|["'」』\]*#]+$/g, '')
        .trim();
      trimmedMd = trimmedMd.replace(/^[*#\s]*(?:TITLE|제목)[*#\s]*[:：]\s*.+?\r?\n+/i, '').trim();
      if (!cleanedPreferredTitle && extractedAiTitle.length >= 8) {
        chosenTitle = extractedAiTitle;
      }
    }
    const tagLineMatch = trimmedMd.match(
      /^[*#\s]*(?:TAGS|태그|해시태그)[*#\s]*[:：]\s*(.+?)(?:\r?\n|$)/im
    );
    if (tagLineMatch) {
      const rawTagStr = tagLineMatch[1].trim();
      extractedTags = (
        rawTagStr.includes(',') || rawTagStr.includes('，')
          ? rawTagStr.split(/[,，]+/)
          : rawTagStr.split(/[\s#]+/)
      )
        .map((t) => t.replace(/[#*_`"'“”‘’\[\]()]/g, '').trim())
        .filter((t) => t.length >= 2);
      trimmedMd = trimmedMd
        .replace(/^[*#\s]*(?:TAGS|태그|해시태그)[*#\s]*[:：]\s*.+?(?:\r?\n|$)/gim, '')
        .trim();
    }
    const h1Match = trimmedMd.match(/^#\s+([^\n]+)\r?\n+/);
    if (h1Match) {
      const extractedH1Title = h1Match[1]
        .replace(/^[*#\s]*(?:TITLE|제목)[*#\s]*[:：]\s*/i, '')
        .replace(/^["'「『\[*#]+|["'」』\]*#]+$/g, '')
        .trim();
      trimmedMd = trimmedMd.replace(/^#\s+[^\n]+\r?\n+/, '').trim();
      if (!cleanedPreferredTitle && !titlePrefixMatch && extractedH1Title.length >= 8) {
        chosenTitle = extractedH1Title;
      }
    }
    if (!cleanedPreferredTitle && !titlePrefixMatch && !h1Match) {
      const firstH2Match = trimmedMd.match(/^##\s+([^\n]+)/m);
      const h2Candidate = firstH2Match
        ? firstH2Match[1].replace(/[*_`~]/g, '').trim()
        : '';
      if (h2Candidate.length >= 12 && h2Candidate.length <= 42 && !/[?？]$/.test(h2Candidate)) {
        chosenTitle = h2Candidate;
      } else {
        const cleanKw = extractCleanKoreanTopicPhrase(keyword) || keyword;
        chosenTitle = generateViralTitlesForKeyword(cleanKw, blog)[0] || chosenTitle;
      }
    }
    markdownContent = trimmedMd;
  }

  markdownContent = enforceCurrentDateContextInMarkdown(markdownContent);
  if (!cleanedPreferredTitle) {
    chosenTitle = enforceCurrentDateContextInMarkdown(chosenTitle);
  }
  chosenTitle = cleanClumsyBlogTitle(chosenTitle, keyword);
  markdownContent = injectContextualInlineVisuals(
    markdownContent,
    keyword,
    chosenTitle,
    blog,
    scrapedImageUrls
  ).markdownContent;
  markdownContent = await convertInlineSvgsToPngInMarkdown(
    markdownContent,
    `${blog.id}-${keyword}-${Date.now()}`
  );

  const htmlContent = convertMarkdownToNaverRichHtml(markdownContent);
  const plainSnippet = markdownContent
    .replace(/[#>*_~`|\[\]\(\)-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 155);

  return {
    title: chosenTitle,
    alternativeTitles: viralTitles,
    subKeywords,
    extractedTags,
    markdownContent,
    htmlContent,
    metaDescription: `${plainSnippet}...`,
    aiProviderUsed,
    internalLinksInserted: internalLinks,
    affiliateItemsInserted: matchedAffiliates.map((a) => a.id),
  };
}
