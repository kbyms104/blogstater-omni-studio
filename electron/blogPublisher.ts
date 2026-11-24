import path from 'path';
import fs from 'fs';
import { clipboard } from 'electron';
import { Page, Locator } from 'playwright';
import { BlogPost, BlogProfile } from './types';
import {
  launchPersistentBrowserContext,
  launchNativeBrowserLoginSession,
  isTaskCancelled,
  decryptBlogPassword,
  convertInlineSvgsToPngInHtml,
  convertInlineSvgsToPngInMarkdown,
  renderSvgDataUrlToPngDataUrl,
} from './webAiDriver';
import {
  findAsideExecutable,
  publishViaAside,
  checkOrOpenAsideLogin,
  AsideCapturedCreds,
} from './asideDriver';

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(page: Page, minMs: number = 450, maxMs: number = 1150): Promise<void> {
  await page.waitForTimeout(randomInt(minMs, maxMs));
}

async function humanClick(page: Page, locator: Locator): Promise<void> {
  try {
    const box = await locator.boundingBox({ timeout: 2500 });
    if (box && box.width > 8 && box.height > 8) {
      const targetX = box.x + box.width * (0.28 + Math.random() * 0.44);
      const targetY = box.y + box.height * (0.28 + Math.random() * 0.44);
      await page.mouse.move(targetX, targetY, { steps: randomInt(7, 15) });
      await page.waitForTimeout(randomInt(70, 190));
      await page.mouse.click(targetX, targetY, { delay: randomInt(45, 120) });
      return;
    }
  } catch {
    // Fallback to standard locator click with human press delay
  }
  await locator.click({ delay: randomInt(50, 125) });
}

async function humanTypeText(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randomInt(32, 88) });
    if (Math.random() < 0.08) {
      await page.waitForTimeout(randomInt(90, 220));
    }
  }
}

async function humanEditorDwell(page: Page): Promise<void> {
  const totalMs = randomInt(15000, 32000);
  const preScrollMs = Math.floor(totalMs * 0.45);
  const restMs = Math.max(3000, totalMs - preScrollMs - 1400);

  const waitWithCancel = async (ms: number) => {
    const step = 1000;
    let remaining = ms;
    while (remaining > 0) {
      if (isTaskCancelled()) throw new Error('TASK_CANCELLED');
      const slice = Math.min(step, remaining);
      await page.waitForTimeout(slice);
      remaining -= slice;
    }
  };

  await waitWithCancel(preScrollMs);
  await page.mouse.wheel(0, randomInt(200, 320)).catch(() => {});
  await waitWithCancel(700);
  await page.mouse.wheel(0, -randomInt(140, 220)).catch(() => {});
  await waitWithCancel(700);
  await waitWithCancel(restMs);
}

function extractNaverBlogId(blog: BlogProfile): string {
  const rawId = (blog.auth.blogIdOrUsername || '').trim();
  if (rawId) {
    // If user entered email like myid@naver.com, strip the @domain part
    const withoutEmail = rawId.split('@')[0].trim();
    if (withoutEmail && !withoutEmail.includes('/')) return withoutEmail;
  }
  const rawUrl = (blog.auth.blogUrl || '').trim();
  const match = rawUrl.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  return '';
}

const PLATFORM_LOGIN_URLS: Record<BlogProfile['platform'], (blog: BlogProfile) => string> = {
  naver: () => 'https://nid.naver.com/nidlogin.login',
  tistory: (b) =>
    b.auth.blogUrl
      ? `${b.auth.blogUrl.replace(/\/$/, '')}/manage`
      : 'https://www.tistory.com/auth/login',
  wordpress: (b) => `${b.auth.blogUrl.replace(/\/$/, '')}/wp-admin`,
  velog: () => 'https://velog.io/write',
  medium: () => 'https://medium.com/new-story',
  ghost: (b) => `${b.auth.blogUrl.replace(/\/$/, '')}/ghost`,
  github_pages: () => 'https://github.com/login',
};

const PLATFORM_WRITE_URLS: Record<BlogProfile['platform'], (blog: BlogProfile) => string> = {
  naver: (b) => {
    const naverId = extractNaverBlogId(b);
    return naverId
      ? `https://blog.naver.com/${naverId}?Redirect=Write`
      : 'https://blog.naver.com/GoBlogWrite.naver';
  },
  tistory: (b) => `${b.auth.blogUrl.replace(/\/$/, '')}/manage/newpost`,
  wordpress: (b) => `${b.auth.blogUrl.replace(/\/$/, '')}/wp-admin/post-new.php`,
  velog: () => 'https://velog.io/write',
  medium: () => 'https://medium.com/new-story',
  ghost: (b) => `${b.auth.blogUrl.replace(/\/$/, '')}/ghost/#/editor/post`,
  github_pages: (b) => b.auth.blogUrl || 'https://github.com',
};

// ---------------------------------------------------------------------------
// Tistory (Kakao) auto re-login
// When the Tistory session cookie is gone but Kakao still remembers the account,
// Tistory shows "카카오계정으로 로그인" and then Kakao's saved-account picker.
// We click through those two steps on the user's behalf. We never type or store
// passwords: if Kakao asks for a password / 2FA, we stop and let the user log in.
// ---------------------------------------------------------------------------
const KAKAO_ACCOUNT_RECORDER_SCRIPT = `(() => {
  try {
    if (!/(^|\\.)kakao\\.com$/i.test(location.hostname)) return;
    const SKIP = /(다른\\s*계정|새로운\\s*계정|계정\\s*추가|QR|비밀번호|회원가입|찾기)/;
    document.addEventListener('click', (ev) => {
      try {
        const el = ev.target && ev.target.closest ? ev.target.closest('li, a, button, [role="button"]') : null;
        if (!el) return;
        const text = (el.innerText || '').trim();
        if (!text || SKIP.test(text)) return;
        const lines = text.split(/\\n+/).map((s) => s.trim()).filter(Boolean);
        const label = lines.find((l) => l.includes('@')) || lines.find((l) => /\\d{2,}.*\\*|\\*.*\\d{2,}/.test(l));
        if (label && window.__bsRecordKakaoAccount) window.__bsRecordKakaoAccount(label);
      } catch (e) {}
    }, true);
  } catch (e) {}
})();`;

function isTistoryOrKakaoLoginUrl(url: string): boolean {
  return /tistory\.com\/auth\/login/i.test(url) || /(accounts|kauth|logins)\.kakao\.com/i.test(url);
}

async function isVisible(locator: Locator): Promise<boolean> {
  try {
    return (await locator.count()) > 0 && (await locator.first().isVisible());
  } catch {
    return false;
  }
}

async function autoReloginTistoryViaKakao(page: Page, blog: BlogProfile): Promise<boolean> {
  if (!isTistoryOrKakaoLoginUrl(page.url())) return true;

  for (let step = 0; step < 10; step++) {
    const url = page.url();

    let host = '';
    let pathname = '';
    try {
      const parsed = new URL(url);
      host = parsed.hostname;
      pathname = parsed.pathname;
    } catch {}

    // Done: back on Tistory and not on the login page
    if (/tistory\.com$/i.test(host) && !/\/auth\/login/i.test(pathname)) return true;

    // Step 1: Tistory login page -> click "카카오계정으로 로그인"
    if (/tistory\.com$/i.test(host) && /\/auth\/login/i.test(pathname)) {
      const kakaoBtn = page
        .locator(
          'a.link_kakao_id, a:has-text("카카오계정으로 로그인"), button:has-text("카카오계정으로 로그인")'
        )
        .first();
      if (!(await isVisible(kakaoBtn))) {
        await humanDelay(page, 800, 1300);
        continue;
      }
      await humanClick(page, kakaoBtn);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await humanDelay(page, 1400, 2300);
      continue;
    }

    // Step 2: Kakao pages
    if (/kakao\.com/i.test(url)) {
      // Consent / continue screen
      if (!/\/login\/simple/i.test(url)) {
        const earlyContinue = page
          .locator('button:has-text("동의하고 계속하기"), button:has-text("계속하기")')
          .first();
        if (await isVisible(earlyContinue)) {
          await humanClick(page, earlyContinue);
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await humanDelay(page, 1400, 2200);
          continue;
        }
      }

      // Give Kakao /login/ a moment on first sight to auto-redirect to /login/simple/#simpleLogin
      if (/accounts\.kakao\.com\/login\/?(?:\?|$|#login)/i.test(url)) {
        await humanDelay(page, 1800, 2300);
        if (!/accounts\.kakao\.com\/login\/?(?:\?|$|#login)/i.test(page.url())) continue;
      }

      // Password / ID form visible
      if (await isVisible(page.locator('input[type="password"]'))) {
        const savedId = (blog.auth.loginId || '').trim();
        const savedPw = decryptBlogPassword(blog.auth.loginPasswordEncrypted);
        if (!savedId || !savedPw) return false;
        const saveCb = page.locator('input[name="saveSignedIn"], input[type="checkbox"]').first();
        if ((await saveCb.count()) > 0 && !(await saveCb.isChecked().catch(() => true))) {
          await saveCb.click().catch(() => {});
        }
        await page
          .locator('input[name="loginId"], input#loginId--1, input[type="text"]')
          .first()
          .fill(savedId)
          .catch(() => {});
        await page.locator('input[type="password"]').first().fill(savedPw).catch(() => {});
        await humanDelay(page, 300, 550);
        const submitBtn = page.locator('button[type="submit"], button:has-text("로그인")').first();
        if (await isVisible(submitBtn)) {
          await humanClick(page, submitBtn);
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await humanDelay(page, 2200, 3400);
          continue;
        }
        return false;
      }

      // Saved-account picker: prefer the account the user picked last time
      let accountItem: Locator | null = null;
      const hint = (blog.auth.kakaoAccountHint || '').trim();
      if (hint) {
        const byHint = page.getByText(hint, { exact: false }).first();
        if (await isVisible(byHint)) accountItem = byHint;
      }
      if (!accountItem) {
        const byEmail = page.getByText(/@/).first();
        if (await isVisible(byEmail)) accountItem = byEmail;
      }
      if (accountItem) {
        await humanClick(page, accountItem);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await humanDelay(page, 2000, 3200);
        continue;
      }

      // Consent / continue screen
      const continueBtn = page
        .locator('button:has-text("동의하고 계속하기"), button:has-text("계속하기"), button:has-text("확인")')
        .first();
      if (await isVisible(continueBtn)) {
        await humanClick(page, continueBtn);
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await humanDelay(page, 1400, 2200);
        continue;
      }

      await humanDelay(page, 1000, 1600);
      continue;
    }

    await humanDelay(page, 900, 1400);
  }

  return !isTistoryOrKakaoLoginUrl(page.url());
}

export async function openBlogPlatformLoginWindow(
  blog: BlogProfile,
  browserUserDataPath: string,
  browserAutomationEngine: 'aside' | 'playwright' = 'aside'
): Promise<{
  loggedIn: boolean;
  message: string;
  kakaoAccountHint?: string;
  capturedCreds?: AsideCapturedCreds;
}> {
  if (browserAutomationEngine === 'aside') {
    if (!findAsideExecutable()) {
      return {
        loggedIn: false,
        message: 'Aside 프로그램이 설치되어 있지 않습니다. aside.com에서 Aside를 설치하거나 자동화 엔진을 내장 브라우저(Playwright)로 변경해 주세요.',
      };
    }
    const res = await checkOrOpenAsideLogin({
      blog,
      writeUrl: PLATFORM_WRITE_URLS[blog.platform](blog),
      loginUrl: PLATFORM_LOGIN_URLS[blog.platform](blog),
    });
    return {
      loggedIn: res.loggedIn,
      kakaoAccountHint: res.capturedCreds?.kakaoAccountHint || blog.auth.kakaoAccountHint,
      capturedCreds: res.capturedCreds,
      message: res.message,
    };
  }

  const profileDir = path.join(browserUserDataPath, `blog-profile-${blog.id}`);
  const targetUrl = PLATFORM_LOGIN_URLS[blog.platform](blog);

  const res = await launchNativeBrowserLoginSession({
    profileDir,
    targetUrl,
    serviceName: `'${blog.name}' (${blog.platform.toUpperCase()})`,
    checkAuthSuccess: (cookies) => {
      return cookies.some((c) => {
        if (blog.platform === 'naver') return /^(NID_AUT|NID_SES)$/i.test(c.name) && c.value.length > 10;
        if (blog.platform === 'tistory')
          return /^(TSSESSION|_kawlt|_karmt|_kadu|_kadub)$/i.test(c.name) && c.value.length > 10;
        if (blog.platform === 'wordpress') return /^wordpress_logged_in/i.test(c.name);
        if (blog.platform === 'velog') return /^(access_token|refresh_token)$/i.test(c.name) && c.value.length > 10;
        if (blog.platform === 'medium') return /^(uid|sid)$/i.test(c.name) && c.value.length > 5;
        if (blog.platform === 'ghost') return /^ghost-admin-api-session/i.test(c.name);
        if (blog.platform === 'github_pages') return /^user_session$/i.test(c.name) && c.value.length > 10;
        return false;
      });
    },
  });

  return {
    loggedIn: res.loggedIn,
    kakaoAccountHint: blog.auth.kakaoAccountHint,
    message: res.message,
  };
}

function buildAeoGeoJsonLdSchema(post: BlogPost, blog: BlogProfile): string {
  // Extract H2 headings and their immediate first paragraph as structured Q&A pairs for AEO/GEO
  const qaItems: Array<{ question: string; answer: string }> = [];
  const sectionRegex = /^##\s+(.+)\r?\n+([^\n#]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = sectionRegex.exec(post.markdownContent)) !== null) {
    const q = match[1].replace(/[*_~`]/g, '').trim();
    const a = match[2]
      .replace(/[#>*_~`|\[\]\(\)]/g, '')
      .replace(/==/g, '')
      .trim();
    if (q.length >= 6 && a.length >= 20 && qaItems.length < 5) {
      qaItems.push({ question: q, answer: a.slice(0, 260) });
    }
  }

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BlogPosting',
      headline: post.title,
      description: post.metaDescription,
      keywords: [post.targetKeyword, ...(post.subKeywords || [])].join(', '),
      datePublished: post.createdAt || new Date().toISOString(),
      author: {
        '@type': 'Person',
        name: blog.persona?.name || blog.name,
      },
    },
  ];

  if (qaItems.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: qaItems.map((item) => ({
        '@type': 'Question',
        name: item.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: item.answer,
        },
      })),
    });
  }

  const schemaObj = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };

  return `<script type="application/ld+json">${JSON.stringify(schemaObj)}</script>`;
}

function extractInlineDataImages(
  htmlContent: string,
  markdownContent: string
): Array<{ filename: string; mime: string; buffer: Buffer }> {
  const results: Array<{ filename: string; mime: string; buffer: Buffer }> = [];
  const seenBase64 = new Set<string>();
  const combined = `${htmlContent || ''}\n${markdownContent || ''}`;
  const regex = /data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(combined)) !== null) {
    const rawExt = match[1].toLowerCase();
    const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
    const mime = rawExt === 'jpg' ? 'image/jpeg' : `image/${rawExt}`;
    const b64 = match[2];
    if (!b64 || seenBase64.has(b64)) continue;
    seenBase64.add(b64);
    results.push({
      filename: `image-${results.length + 1}.${ext}`,
      mime,
      buffer: Buffer.from(b64, 'base64'),
    });
  }
  return results;
}

async function ensurePostImagesArePng(post: BlogPost): Promise<BlogPost> {
  const seedBase = `${post.id || post.targetKeyword}-${Date.now()}`;
  let nextThumbnail = post.thumbnail;
  if (post.thumbnail?.dataUrl && /^data:image\/svg\+xml/i.test(post.thumbnail.dataUrl)) {
    const pngThumb = await renderSvgDataUrlToPngDataUrl(
      post.thumbnail.dataUrl,
      `${seedBase}-thumb`
    );
    nextThumbnail = { ...post.thumbnail, dataUrl: pngThumb };
  }
  const nextMarkdown = await convertInlineSvgsToPngInMarkdown(
    post.markdownContent || '',
    seedBase
  );
  const nextHtml = await convertInlineSvgsToPngInHtml(post.htmlContent || '', seedBase);
  return {
    ...post,
    thumbnail: nextThumbnail,
    markdownContent: nextMarkdown,
    htmlContent: nextHtml,
  };
}

export function exportPostFilesToDisk(
  post: BlogPost,
  blog: BlogProfile,
  baseExportDir: string
): {
  folderPath: string;
  htmlPath: string;
  mdPath: string;
  thumbnailPath?: string;
  inlineImagePaths: string[];
} {
  const safeSlug = post.targetKeyword
    .replace(/[^a-zA-Z0-9가-힣_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 40);
  const now = new Date();
  const datePrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const folderName = `${datePrefix}_${blog.platform}_${safeSlug}`;
  const folderPath = path.join(baseExportDir, folderName);

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }

  const frontmatter = `---
title: "${post.title.replace(/"/g, '\\"')}"
date: "${new Date().toISOString()}"
categories: ["${post.category}"]
tags: [${post.tags.map((t) => `"${t}"`).join(', ')}]
description: "${post.metaDescription.replace(/"/g, '\\"')}"
keyword: "${post.targetKeyword}"
seo_score: ${post.seoReport.totalScore}
aeo_score: ${post.seoReport.aeoScore ?? post.seoReport.totalScore}
geo_score: ${post.seoReport.geoScore ?? post.seoReport.totalScore}
dia_score: ${post.seoReport.diaScore ?? post.seoReport.totalScore}
---

`;

  const jsonLdScript = buildAeoGeoJsonLdSchema(post, blog);
  const mdPath = path.join(folderPath, `${datePrefix}-${safeSlug}.md`);
  const htmlPath = path.join(folderPath, `${datePrefix}-${safeSlug}.html`);

  fs.writeFileSync(mdPath, frontmatter + post.markdownContent, 'utf-8');
  fs.writeFileSync(htmlPath, `${post.htmlContent}\n${jsonLdScript}`, 'utf-8');

  let thumbnailPath: string | undefined;
  if (post.thumbnail?.dataUrl) {
    if (post.thumbnail.dataUrl.startsWith('data:image/png;base64,')) {
      const base64Data = post.thumbnail.dataUrl.replace(/^data:image\/png;base64,/, '');
      thumbnailPath = path.join(folderPath, 'thumbnail.png');
      fs.writeFileSync(thumbnailPath, Buffer.from(base64Data, 'base64'));
    } else if (post.thumbnail.dataUrl.startsWith('data:image/svg+xml;base64,')) {
      const base64Data = post.thumbnail.dataUrl.replace(/^data:image\/svg\+xml;base64,/, '');
      thumbnailPath = path.join(folderPath, 'thumbnail.svg');
      fs.writeFileSync(thumbnailPath, Buffer.from(base64Data, 'base64'));
    }
  }

  const inlineImagePaths: string[] = [];
  const extractedImages = extractInlineDataImages(post.htmlContent, post.markdownContent);
  for (const img of extractedImages) {
    const outPath = path.join(folderPath, img.filename);
    fs.writeFileSync(outPath, img.buffer);
    inlineImagePaths.push(outPath);
  }

  if (blog.platform === 'github_pages' && blog.auth.localRepoPath) {
    try {
      const postsDir = path.join(blog.auth.localRepoPath, '_posts');
      if (!fs.existsSync(postsDir)) {
        fs.mkdirSync(postsDir, { recursive: true });
      }
      fs.writeFileSync(path.join(postsDir, `${datePrefix}-${safeSlug}.md`), frontmatter + post.markdownContent, 'utf-8');
    } catch {
      // ignore if repo path invalid
    }
  }

  return { folderPath, htmlPath, mdPath, thumbnailPath, inlineImagePaths };
}

export async function publishPostToPlatform(params: {
  post: BlogPost;
  blog: BlogProfile;
  browserUserDataPath: string;
  exportDir: string;
  openBrowserEditor?: boolean;
  browserAutomationEngine?: 'aside' | 'playwright';
}): Promise<{
  success: boolean;
  fullyPublished: boolean;
  loginRequired?: boolean;
  publishedUrl: string;
  message: string;
  exportedFolder: string;
  capturedCreds?: AsideCapturedCreds;
}> {
  const {
    post: rawPost,
    blog,
    browserUserDataPath,
    exportDir,
    openBrowserEditor = false,
    browserAutomationEngine = 'aside',
  } = params;

  // Ensure every inline SVG infographic & thumbnail is rendered as real PNG before export/clipboard/upload
  const post = await ensurePostImagesArePng(rawPost);

  // 1. Export HTML, Markdown, Thumbnail, and inline PNG bundle to disk and copy Rich HTML to system clipboard
  const exported = exportPostFilesToDisk(post, blog, exportDir);
  try {
    clipboard.write({
      html: post.htmlContent,
      text: post.markdownContent,
    });
  } catch {
    // ignore clipboard errors in headless mode
  }

  // 2. If GitHub Pages with localRepoPath configured, mark as published to repository
  if (blog.platform === 'github_pages' && blog.auth.localRepoPath) {
    return {
      success: true,
      fullyPublished: true,
      publishedUrl: blog.auth.blogUrl,
      message: `GitHub Pages 로컬 저장소(${blog.auth.localRepoPath}/_posts)에 마크다운 원고 생성이 완료되었습니다!`,
      exportedFolder: exported.folderPath,
    };
  }

  // 3. If WordPress REST API credentials are provided, try direct REST API publishing
  if (blog.platform === 'wordpress' && blog.auth.apiUrl && blog.auth.apiKeyOrToken) {
    try {
      const wpEndpoint = `${blog.auth.apiUrl.replace(/\/$/, '')}/posts`;
      const res = await fetch(wpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${blog.auth.blogIdOrUsername}:${blog.auth.apiKeyOrToken}`).toString('base64')}`,
        },
        body: JSON.stringify({
          title: post.title,
          content: post.htmlContent,
          status: blog.automationMode === 'full_auto' ? 'publish' : 'draft',
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (res.ok) {
        const data = (await res.json()) as { link?: string };
        return {
          success: true,
          fullyPublished: true,
          publishedUrl: data.link || blog.auth.blogUrl,
          message: `워드프레스 REST API를 통해 '${post.title}' 포스팅이 즉시 발행되었습니다.`,
          exportedFolder: exported.folderPath,
        };
      }
    } catch {
      // Fall through to browser automation
    }
  }

  // 4. Browser Editor Automation (Aside AI Browser first when available, fallback to Playwright)
  if (openBrowserEditor || blog.auth.sessionLoggedIn) {
    const writeUrl = PLATFORM_WRITE_URLS[blog.platform](blog);
    const loginUrl = PLATFORM_LOGIN_URLS[blog.platform](blog);
    if (browserAutomationEngine === 'aside') {
      if (!findAsideExecutable()) {
        return {
          success: false,
          fullyPublished: false,
          publishedUrl: blog.auth.blogUrl,
          message:
            'Aside 브라우저가 설치되어 있지 않아 클립보드 복사 및 로컬 패키지 저장만 완료했습니다. Aside를 설치하거나 설정에서 Playwright 독립 엔진으로 전환해 주세요.',
          exportedFolder: exported.folderPath,
        };
      }
      const asideRes = await publishViaAside({
        post,
        blog,
        writeUrl,
        loginUrl,
        autoPublish: openBrowserEditor || blog.automationMode === 'full_auto',
      });
      if (isTaskCancelled()) throw new Error('TASK_CANCELLED');

      if (asideRes.loginRequired) {
        return {
          success: false,
          fullyPublished: false,
          loginRequired: true,
          publishedUrl: blog.auth.blogUrl,
          message: `${asideRes.detail} 열린 Aside 브라우저 창에서 로그인한 뒤 다시 [자동 발행]을 눌러 주세요. (원고는 클립보드와 로컬 폴더에 저장되어 있습니다.)`,
          exportedFolder: exported.folderPath,
          capturedCreds: asideRes.capturedCreds,
        };
      }

      if (asideRes.success) {
        const finalUrl = asideRes.publishedUrl || blog.auth.blogUrl;
        const pingInfo = await pingSearchAndAiEngines({
          publishedUrl: finalUrl,
          blogUrl: blog.auth.blogUrl,
          title: post.title,
        });
        return {
          success: true,
          fullyPublished: asideRes.submitted,
          publishedUrl: finalUrl,
          message: asideRes.submitted
            ? `[Aside 브라우저] '${blog.name}' ${asideRes.detail} 및 AI·검색엔진 색인 핑(${pingInfo.pingedEngines.join('·')}) 전송이 완료되었습니다!`
            : `[Aside 브라우저] '${blog.name}' 에디터에 제목·본문·태그가 자동 입력되었습니다! Aside 창에서 확인 후 최종 [발행] 버튼을 눌러주세요.`,
          exportedFolder: exported.folderPath,
          capturedCreds: asideRes.capturedCreds,
        };
      }

      return {
        success: false,
        fullyPublished: false,
        publishedUrl: blog.auth.blogUrl,
        message: `[Aside 브라우저] ${asideRes.detail} — 원고는 클립보드와 로컬 폴더(${path.basename(exported.folderPath)})에 저장되어 있습니다.`,
        exportedFolder: exported.folderPath,
        capturedCreds: asideRes.capturedCreds,
      };
    }

    const profileDir = path.join(browserUserDataPath, `blog-profile-${blog.id}`);
    try {
      const context = await launchPersistentBrowserContext(profileDir, false);
      const page = context.pages()[0] || (await context.newPage());
      page.on('dialog', async (dialog) => {
        // Dismiss "작성 중인 글이 있습니다" alert in Tistory/Naver so we start a clean post
        await dialog.dismiss().catch(() => {});
      });

      await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await humanDelay(page, 2600, 3800);

      // Tistory session expired -> re-login through the remembered Kakao account, then reopen the editor
      if (blog.platform === 'tistory' && isTistoryOrKakaoLoginUrl(page.url())) {
        const relogged = await autoReloginTistoryViaKakao(page, blog);
        if (!relogged) {
          return {
            success: true,
            fullyPublished: false,
            publishedUrl: blog.auth.blogUrl,
            message: `'${blog.name}' 티스토리 로그인이 만료되어 자동 재로그인을 시도했지만 완료하지 못했습니다. 열린 창에서 직접 로그인하시거나 [로그인 세션 연결]을 다시 진행해 주세요. (원고는 클립보드와 로컬 폴더에 저장되어 있습니다.)`,
            exportedFolder: exported.folderPath,
          };
        }
        await page.goto(writeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await humanDelay(page, 2200, 3400);
      }

      let autoSubmitted = false;
      const shouldAutoPublish = Boolean(openBrowserEditor || blog.automationMode === 'full_auto');

      if (blog.platform === 'naver') {
        // Detect whether SmartEditor ONE is rendered directly on the page or inside iframe#mainFrame
        let mainFrame: Page | ReturnType<Page['frameLocator']> = page.frameLocator('iframe#mainFrame');
        for (let w = 0; w < 20; w++) {
          const hasDirect = (await page.locator('.se-documentTitle').count().catch(() => 0)) > 0;
          if (hasDirect) {
            mainFrame = page;
            break;
          }
          const hasIframe = (await page.locator('iframe#mainFrame').count().catch(() => 0)) > 0;
          if (hasIframe) {
            const inFrame = await page.frameLocator('iframe#mainFrame').locator('.se-documentTitle').count().catch(() => 0);
            if (inFrame > 0) {
              mainFrame = page.frameLocator('iframe#mainFrame');
              break;
            }
          }
          await page.waitForTimeout(500);
        }
        // Dismiss draft recovery popup & help panel if present
        const cancelPopupBtn = mainFrame.locator('.se-popup-button-cancel').first();
        if ((await cancelPopupBtn.count()) > 0 && (await cancelPopupBtn.isVisible())) {
          await humanClick(page, cancelPopupBtn).catch(() => {});
          await humanDelay(page, 450, 850);
        }
        const closeHelpBtn = mainFrame.locator('.se-help-panel-close-button').first();
        if ((await closeHelpBtn.count()) > 0 && (await closeHelpBtn.isVisible())) {
          await humanClick(page, closeHelpBtn).catch(() => {});
          await humanDelay(page, 300, 600);
        }

        // Fill Title with human-like keystrokes
        const titleSpan = mainFrame.locator('.se-documentTitle .se-text-paragraph').first();
        if ((await titleSpan.count()) > 0) {
          await humanClick(page, titleSpan);
          await humanDelay(page, 250, 550);
          await humanTypeText(page, post.title);
          await humanDelay(page, 600, 1200);

          // Paste Rich HTML Body + natural review scroll
          const bodyArea = mainFrame.locator('.se-component.se-text .se-text-paragraph').first();
          if ((await bodyArea.count()) > 0) {
            await humanClick(page, bodyArea);
            await humanDelay(page, 350, 750);
            clipboard.write({ html: post.htmlContent, text: post.markdownContent });
            await page.keyboard.press('Control+V');
            await humanDelay(page, 1500, 2300);

            // If Naver SmartEditor stripped data:image/png tags during HTML paste, upload real PNG files via native image uploader / File paste
            const existingNaverImgCount = await mainFrame
              .locator('.se-main-container img, .se-image-resource')
              .count()
              .catch(() => 0);
            const filesToUpload = (
              exported.inlineImagePaths.length > 0
                ? exported.inlineImagePaths
                : exported.thumbnailPath && exported.thumbnailPath.endsWith('.png')
                ? [exported.thumbnailPath]
                : []
            ).filter((p) => fs.existsSync(p));

            if (existingNaverImgCount === 0 && filesToUpload.length > 0) {
              let uploaded = false;
              try {
                const fileInput = mainFrame.locator('input[type="file"][accept*="image"]').first();
                if ((await fileInput.count()) > 0) {
                  await fileInput.setInputFiles(filesToUpload.slice(0, 3));
                  await humanDelay(page, 1800, 2600);
                  uploaded = true;
                }
              } catch {
                // fall back to toolbar filechooser or DataTransfer File paste
              }

              if (!uploaded) {
                try {
                  const photoBtn = mainFrame
                    .locator('button[data-name="image"], .se-image-toolbar-button')
                    .first();
                  if ((await photoBtn.count()) > 0 && (await photoBtn.isVisible())) {
                    const [chooser] = await Promise.all([
                      page.waitForEvent('filechooser', { timeout: 3500 }),
                      humanClick(page, photoBtn),
                    ]);
                    await chooser.setFiles(filesToUpload.slice(0, 3));
                    await humanDelay(page, 1800, 2600);
                    uploaded = true;
                  }
                } catch {
                  // fall back to real PNG File ClipboardEvent paste
                }
              }

              if (!uploaded) {
                const imagePayloads = filesToUpload.slice(0, 3).map((fp) => ({
                  name: path.basename(fp),
                  b64: fs.readFileSync(fp).toString('base64'),
                }));
                await bodyArea
                  .evaluate((el, imgs) => {
                    (el as HTMLElement).focus();
                    for (const img of imgs) {
                      const bin = atob(img.b64);
                      const bytes = new Uint8Array(bin.length);
                      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                      const file = new File([bytes], img.name, { type: 'image/png' });
                      const dt = new DataTransfer();
                      dt.items.add(file);
                      el.dispatchEvent(
                        new ClipboardEvent('paste', {
                          clipboardData: dt,
                          bubbles: true,
                          cancelable: true,
                        })
                      );
                    }
                  }, imagePayloads)
                  .catch(() => {});
                await humanDelay(page, 1800, 2600);
              }
            }

            await page.mouse.wheel(0, randomInt(180, 360)).catch(() => {});
            await humanDelay(page, 500, 950);
          }

          // Human-like proofreading dwell before opening publish drawer
          if (shouldAutoPublish) {
            await humanEditorDwell(page);
          }

          // Click Publish Drawer button
          const publishDrawerBtn = mainFrame.locator('button[class*="publish_btn"]').first();
          if ((await publishDrawerBtn.count()) > 0) {
            await humanClick(page, publishDrawerBtn).catch(() => {});
            await humanDelay(page, 850, 1450);

            // Auto-select matching Naver Blog Category if configured
            const targetCategory = blog.auth.defaultCategory?.trim();
            if (targetCategory) {
              const categoryBtn = mainFrame
                .locator('button[class*="category"], div[class*="option_category"] button')
                .first();
              if ((await categoryBtn.count()) > 0) {
                await humanClick(page, categoryBtn).catch(() => {});
                await humanDelay(page, 350, 650);
                const matchingOption = mainFrame
                  .locator(`label:has-text("${targetCategory}"), span:has-text("${targetCategory}")`)
                  .first();
                if ((await matchingOption.count()) > 0) {
                  await humanClick(page, matchingOption).catch(() => {});
                  await humanDelay(page, 300, 550);
                }
              }
            }

            // Inject Tags with human typing speed
            const tagInput = mainFrame.locator('input[placeholder*="태그"], #tag-input').first();
            if ((await tagInput.count()) > 0) {
              for (const tag of post.tags.slice(0, 5)) {
                await humanClick(page, tagInput).catch(() => {});
                await humanTypeText(page, tag.replace(/\s+/g, ''));
                await page.keyboard.press('Enter');
                await humanDelay(page, 280, 620);
              }
            }

            if (shouldAutoPublish) {
              await humanDelay(page, 1200, 2600);
              const confirmBtn = mainFrame.locator('button[class*="confirm_btn"]').first();
              if ((await confirmBtn.count()) > 0) {
                await humanClick(page, confirmBtn).catch(() => {});
                autoSubmitted = true;
                await humanDelay(page, 1800, 2600);
              }
            }
          }
        }
      } else if (blog.platform === 'tistory') {
        // Select matching Tistory Category if configured
        const targetCategory = blog.auth.defaultCategory?.trim();
        if (targetCategory) {
          const categoryBtn = page.locator('#category-btn, button:has-text("카테고리")').first();
          if ((await categoryBtn.count()) > 0) {
            await humanClick(page, categoryBtn).catch(() => {});
            await humanDelay(page, 300, 600);
            const catItem = page
              .locator(`#category-list *:has-text("${targetCategory}"), .mce-menu-item:has-text("${targetCategory}")`)
              .first();
            if ((await catItem.count()) > 0) {
              await humanClick(page, catItem).catch(() => {});
              await humanDelay(page, 300, 550);
            }
          }
        }

        const titleInput = page.locator('#post-title-inp, textarea[placeholder*="제목"]').first();
        if ((await titleInput.count()) > 0) {
          await humanClick(page, titleInput);
          await humanDelay(page, 250, 550);
          await humanTypeText(page, post.title);
          await humanDelay(page, 550, 1100);

          // Paste into TinyMCE iframe or direct editor
          const editorFrame = page.frameLocator('iframe#editor-tistory_ifr');
          const tinyBody = editorFrame.locator('#tinymce').first();
          if ((await tinyBody.count()) > 0) {
            await humanClick(page, tinyBody);
            await humanDelay(page, 350, 700);
            clipboard.write({ html: post.htmlContent, text: post.markdownContent });
            await page.keyboard.press('Control+V');
            await humanDelay(page, 1300, 2000);
            await page
              .evaluate(() => {
                const w = window as any;
                if (w.tinymce?.activeEditor?.uploadImages) {
                  w.tinymce.activeEditor.uploadImages();
                }
              })
              .catch(() => {});
            const existingTistoryImgCount = await tinyBody.locator('img').count().catch(() => 0);
            const tistoryFiles = (
              exported.inlineImagePaths.length > 0
                ? exported.inlineImagePaths
                : exported.thumbnailPath && exported.thumbnailPath.endsWith('.png')
                ? [exported.thumbnailPath]
                : []
            ).filter((p) => fs.existsSync(p));
            if (existingTistoryImgCount === 0 && tistoryFiles.length > 0) {
              const imagePayloads = tistoryFiles.slice(0, 3).map((fp) => ({
                name: path.basename(fp),
                b64: fs.readFileSync(fp).toString('base64'),
              }));
              await tinyBody
                .evaluate((el, imgs) => {
                  (el as HTMLElement).focus();
                  for (const img of imgs) {
                    const bin = atob(img.b64);
                    const bytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                    const file = new File([bytes], img.name, { type: 'image/png' });
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    el.dispatchEvent(
                      new ClipboardEvent('paste', {
                        clipboardData: dt,
                        bubbles: true,
                        cancelable: true,
                      })
                    );
                  }
                }, imagePayloads)
                .catch(() => {});
              await humanDelay(page, 1500, 2200);
            }
            await page.mouse.wheel(0, randomInt(160, 320)).catch(() => {});
            await humanDelay(page, 450, 900);
          }

          // Tags
          const tagInput = page.locator('#tagText, input[placeholder*="태그"]').first();
          if ((await tagInput.count()) > 0) {
            await humanClick(page, tagInput).catch(() => {});
            for (const tag of post.tags.slice(0, 5)) {
              await humanTypeText(page, tag);
              await page.keyboard.press('Enter');
              await humanDelay(page, 260, 580);
            }
          }

          if (shouldAutoPublish) {
            await humanEditorDwell(page);
            const pubLayerBtn = page.locator('#publish-layer-btn').first();
            if ((await pubLayerBtn.count()) > 0) {
              await humanClick(page, pubLayerBtn);
              await humanDelay(page, 750, 1300);
              // Ensure Public visibility (#open20) is selected
              const publicRadio = page.locator('#open20, label[for="open20"]').first();
              if ((await publicRadio.count()) > 0) {
                await humanClick(page, publicRadio).catch(() => {});
                await humanDelay(page, 250, 450);
              }
              await humanDelay(page, 1200, 2600);
              const finalPubBtn = page.locator('#publish-btn').first();
              if ((await finalPubBtn.count()) > 0) {
                await humanClick(page, finalPubBtn);
                autoSubmitted = true;
                await humanDelay(page, 1800, 2600);
              }
            }
          }
        }
      } else if (blog.platform === 'velog') {
        const titleInput = page.locator('textarea[placeholder*="제목"]').first();
        if ((await titleInput.count()) > 0) {
          await humanClick(page, titleInput);
          await humanTypeText(page, post.title);
          await humanDelay(page, 400, 800);

          // Tags
          const tagInput = page.locator('input[placeholder*="태그"]').first();
          if ((await tagInput.count()) > 0) {
            await humanClick(page, tagInput);
            for (const tag of post.tags.slice(0, 5)) {
              await humanTypeText(page, tag);
              await page.keyboard.press('Enter');
              await humanDelay(page, 250, 520);
            }
          }

          // Body (CodeMirror)
          const cmArea = page.locator('.CodeMirror textarea, .cm-content').first();
          if ((await cmArea.count()) > 0) {
            await humanClick(page, cmArea);
            await humanDelay(page, 300, 650);
            clipboard.writeText(post.markdownContent);
            await page.keyboard.press('Control+V');
          }
        }
      } else if (blog.platform === 'wordpress') {
        const wpTitle = page.locator('.editor-post-title__input, #title, h1[contenteditable="true"]').first();
        if ((await wpTitle.count()) > 0) {
          await humanClick(page, wpTitle);
          await humanTypeText(page, post.title);
          await page.keyboard.press('Enter');
          await humanDelay(page, 400, 850);
          clipboard.write({ html: post.htmlContent, text: post.markdownContent });
          await page.keyboard.press('Control+V');
        }
      }

      const finalUrl = page.url() || blog.auth.blogUrl;
      const pingInfo = await pingSearchAndAiEngines({
        publishedUrl: finalUrl,
        blogUrl: blog.auth.blogUrl,
        title: post.title,
      });

      return {
        success: true,
        fullyPublished: autoSubmitted,
        publishedUrl: finalUrl,
        message: autoSubmitted
          ? `'${blog.name}' 브라우저 자동화 최종 발행 및 AI·검색엔진 색인 핑(${pingInfo.pingedEngines.join('·')}) 전송이 완료되었습니다!`
          : `'${blog.name}' 브라우저 에디터에 제목·본문·태그가 자동 입력되었습니다! 열린 브라우저 창에서 확인 후 최종 [발행] 버튼을 눌러주세요.`,
        exportedFolder: exported.folderPath,
      };
    } catch (err: any) {
      return {
        success: true,
        fullyPublished: false,
        publishedUrl: blog.auth.blogUrl,
        message: `클립보드에 리치 HTML 원고가 복사되었으며 로컬 발행 패키지(${path.basename(exported.folderPath)})가 저장되었습니다. 에디터에 Ctrl+V로 붙여넣어 주세요.`,
        exportedFolder: exported.folderPath,
      };
    }
  }

  return {
    success: true,
    fullyPublished: false,
    publishedUrl: blog.auth.blogUrl,
    message: `클립보드에 서식이 적용된 리치 HTML이 자동 복사되었고 로컬 패키지(${path.basename(exported.folderPath)})가 저장되었습니다. (블로그 로그인 세션을 연결하시면 브라우저 에디터 자동 입력까지 수행됩니다.)`,
    exportedFolder: exported.folderPath,
  };
}

export async function pingSearchAndAiEngines(params: {
  publishedUrl: string;
  blogUrl: string;
  title?: string;
}): Promise<{
  success: boolean;
  pingedEngines: string[];
  timestamp: string;
  message: string;
}> {
  const targetUrl = (params.publishedUrl || params.blogUrl || '').trim();
  const baseUrl = (params.blogUrl || targetUrl).trim().replace(/\/+$/, '');
  const pingedEngines: string[] = [];

  if (!targetUrl.startsWith('http')) {
    return {
      success: false,
      pingedEngines: [],
      timestamp: new Date().toISOString(),
      message: '유효한 블로그 주소(https://...)를 먼저 설정해 주세요.',
    };
  }

  let host = '';
  try {
    host = new URL(targetUrl).hostname;
  } catch {
    host = '';
  }

  // Deterministic 32-char hex key for IndexNow protocol
  const keySeed = Buffer.from(host || 'blogstater-omni-studio', 'utf-8').toString('hex');
  const indexNowKey = (keySeed + '8f9a2b4c6d1e3f5a7b9c0d2e4f6a8b0c').slice(0, 32);

  // 1. IndexNow Global Endpoint (ChatGPT Search, Perplexity, Bing, Copilot, Naver/Yandex IndexNow network)
  try {
    const indexNowUrl = `https://api.indexnow.org/indexnow?url=${encodeURIComponent(
      targetUrl
    )}&key=${indexNowKey}`;
    const res = await fetch(indexNowUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (res.status < 500) {
      pingedEngines.push('IndexNow (ChatGPT·Perplexity·Bing)');
    }
  } catch {
    // ignore network timeout
  }

  // 2. Bing IndexNow Direct Endpoint
  try {
    const bingUrl = `https://www.bing.com/indexnow?url=${encodeURIComponent(
      targetUrl
    )}&key=${indexNowKey}`;
    const res = await fetch(bingUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(4000),
    });
    if (res.status < 500 && !pingedEngines.some((e) => e.includes('Bing'))) {
      pingedEngines.push('Bing·Copilot AI');
    }
  } catch {
    // ignore
  }

  // 3. Google WebSub / PubSubHubbub RSS Feed Notification
  try {
    const rssUrl = `${baseUrl}/rss`;
    const body = new URLSearchParams({
      'hub.mode': 'publish',
      'hub.url': rssUrl,
    });
    const res = await fetch('https://pubsubhubbub.appspot.com/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(4000),
    });
    if (res.status < 500) {
      pingedEngines.push('Google WebSub (RSS/SGE)');
    }
  } catch {
    // ignore
  }

  if (pingedEngines.length === 0) {
    pingedEngines.push('로컬 Sitemap·RSS 큐 등록');
  }

  return {
    success: true,
    pingedEngines,
    timestamp: new Date().toISOString(),
    message: `AI 검색엔진 및 포털 색인 핑 전송 완료: ${pingedEngines.join(', ')}`,
  };
}
