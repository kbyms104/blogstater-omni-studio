import { app, BrowserWindow, ipcMain, clipboard, shell, Menu, dialog, powerSaveBlocker } from 'electron';
import path from 'path';
import fs from 'fs';
import cron, { ScheduledTask } from 'node-cron';
import { LocalStore } from './store';
import {
  scoutGoldenKeywords,
  createManualTrendTopic,
  classifySubCategory,
  detectSearchIntent,
  isPolicyOrFinanceApplyTopic,
  isTrendCompatibleWithBlog,
  checkDuplicatePostGuard,
  selectBestFullAutoBlueOceanTrend,
} from './keywordScout';
import { evaluatePostSEO } from './seoAnalyzer';
import {
  generateBlogPostContent,
  openWebAILoginSession,
  convertMarkdownToNaverRichHtml,
  generateAutoThumbnailDataUrl,
  generateAutoThumbnailPngDataUrl,
  convertInlineSvgsToPngInMarkdown,
  autoSelfPolishPost,
  detectInstalledCLIs,
  openCliSetupTerminal,
  polishBlogPostContent,
  toggleInlineSummaryImagesInMarkdown,
  beginCancellableTask,
  isTaskCancelled,
  throwIfTaskCancelled,
  cancelAllActiveTasks,
} from './webAiDriver';
import {
  openBlogPlatformLoginWindow,
  publishPostToPlatform,
  pingSearchAndAiEngines,
} from './blogPublisher';
import { detectAside, AsideCapturedCreds } from './asideDriver';
import {
  analyzeCompetitorSERP,
  checkPostSearchRank,
  extractReferenceSourceMaterial,
} from './competitorAnalyzer';
import { AppDatabaseState, BlogPost, BlogProfile, ThumbnailConfig, TrendTopic } from './types';

// Prevent Electron 33 GPU compositor command-buffer faults on Windows GPU drivers
app.disableHardwareAcceleration();

function applyCapturedCredsToBlog(blog: BlogProfile, captured?: AsideCapturedCreds): boolean {
  if (!captured) return false;
  let updated = false;
  if (captured.loginId?.trim() && captured.loginId.trim() !== blog.auth.loginId) {
    blog.auth.loginId = captured.loginId.trim();
    updated = true;
  }
  if (captured.loginPassword?.trim()) {
    blog.auth.loginPassword = captured.loginPassword.trim();
    updated = true;
  }
  if (
    captured.kakaoAccountHint?.trim() &&
    captured.kakaoAccountHint.trim() !== blog.auth.kakaoAccountHint
  ) {
    blog.auth.kakaoAccountHint = captured.kakaoAccountHint.trim();
    updated = true;
  }
  return updated;
}

interface PipelineResult {
  success: boolean;
  post?: BlogPost;
  message: string;
}

interface PipelineQueueItem {
  blogId: string;
  blogName: string;
  source: 'schedule' | 'manual';
  resolve: (result: PipelineResult) => void;
}

let mainWindow: BrowserWindow | null = null;
let store: LocalStore;
const activeCronJobs: Map<string, ScheduledTask[]> = new Map();
const pendingJitterTimers: Map<string, NodeJS.Timeout> = new Map();
const pipelineQueue: PipelineQueueItem[] = [];
let activePipelineBlogId: string | null = null;
let activePipelineBlogName: string | null = null;
let isProcessingPipelineQueue = false;
let lastScheduledTriggerTargetMs = 0;

function toLocalDateStr(isoOrDate?: string | Date): string {
  if (!isoOrDate) return '';
  if (typeof isoOrDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) {
    return isoOrDate;
  }
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(d.getTime())) {
    return typeof isoOrDate === 'string' ? isoOrDate.slice(0, 10) : '';
  }
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getExportDirectory(): string {
  const baseDir = app.isPackaged
    ? path.join(app.getPath('desktop'), 'BlogStater_발행패키지')
    : path.join(process.cwd(), 'exports');
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  return baseDir;
}

function createDefaultThumbnailConfig(title: string, keyword: string, blog: BlogProfile): ThumbnailConfig {
  const paletteByPlatform: Record<BlogProfile['platform'], { from: string; to: string; accent: string }> = {
    naver: { from: '#065f46', to: '#022c22', accent: '#34d399' },
    tistory: { from: '#0f172a', to: '#1e293b', accent: '#38bdf8' },
    wordpress: { from: '#1e1b4b', to: '#0f172a', accent: '#818cf8' },
    velog: { from: '#064e3b', to: '#022c22', accent: '#10b981' },
    medium: { from: '#18181b', to: '#09090b', accent: '#f4f4f5' },
    ghost: { from: '#312e81', to: '#1e1b4b', accent: '#a5b4fc' },
    github_pages: { from: '#0f172a', to: '#020617', accent: '#38bdf8' },
  };
  const pal = paletteByPlatform[blog.platform] || paletteByPlatform.naver;
  const isPolicy = isPolicyOrFinanceApplyTopic(keyword);
  const intent = detectSearchIntent(keyword);
  const topicBadge = classifySubCategory(keyword) || blog.auth.defaultCategory || '핵심 요약';

  let subHeadline = '핵심 배경부터 주요 쟁점·전망까지 한눈에 정리';
  if (isPolicy) {
    subHeadline = '핵심 조건 비교 & 놓치면 아까운 실전 포인트';
  } else if (intent === 'comparison') {
    subHeadline = '핵심 차이점 비교 & 선택 기준 한눈에 정리';
  } else if (intent === 'review') {
    subHeadline = '실제 장단점 비교 & 핵심 체크포인트 정리';
  } else if (intent === 'howto') {
    subHeadline = '처음이어도 한눈에 이해하는 단계별 핵심 정리';
  }

  const config: ThumbnailConfig = {
    template: 'viral_card',
    aspectRatio: blog.platform === 'naver' ? '1:1' : '16:9',
    badgeText: topicBadge,
    headline: keyword.length > 28 ? keyword.slice(0, 28) : keyword,
    subHeadline,
    footerTag: `@${blog.name}`,
    bgGradientFrom: pal.from,
    bgGradientTo: pal.to,
    accentColor: pal.accent,
    textColor: '#ffffff',
  };
  config.dataUrl = generateAutoThumbnailDataUrl(config);
  return config;
}

async function createDefaultThumbnailConfigAsync(
  title: string,
  keyword: string,
  blog: BlogProfile
): Promise<ThumbnailConfig> {
  const config = createDefaultThumbnailConfig(title, keyword, blog);
  try {
    config.dataUrl = await generateAutoThumbnailPngDataUrl(
      config,
      `${blog.id}-${keyword}-${Date.now()}`
    );
  } catch {
    // keep fallback SVG dataUrl if PNG conversion unexpectedly throws
  }
  return config;
}

async function executeAutomatedPipelineForBlog(blogId: string): Promise<PipelineResult> {
  const { seq } = beginCancellableTask();
  store.pruneTrends();
  const state = store.getState();
  const blog = state.blogs.find((b) => b.id === blogId);
  if (!blog) {
    return { success: false, message: '대상 블로그를 찾을 수 없습니다.' };
  }

  const cooldownDays = state.settings.duplicateCooldownDays ?? 14;
  const todayLocalStr = toLocalDateStr(new Date());

  // Prioritize any due calendar-scheduled post for this blog instead of creating another post from scratch
  const dueScheduledPost = state.posts
    .filter((p) => {
      if (p.blogId !== blog.id || p.status !== 'scheduled') return false;
      const schedDate = toLocalDateStr(p.scheduledFor || p.createdAt);
      return Boolean(schedDate && schedDate <= todayLocalStr);
    })
    .sort((a, b) =>
      (a.scheduledFor || a.createdAt).localeCompare(b.scheduledFor || b.createdAt)
    )[0];

  if (dueScheduledPost) {
    store.addLog(
      'info',
      'SCHEDULER',
      `[${blog.name}] 캘린더 예약 원고 발견 — 신규 생성 대신 예약 원고를 우선 처리합니다: "${dueScheduledPost.title}"`,
      dueScheduledPost.scheduledFor ? `예약일: ${dueScheduledPost.scheduledFor}` : undefined,
      blog.id
    );

    const updatedPost: BlogPost = {
      ...dueScheduledPost,
      updatedAt: new Date().toISOString(),
    };

    if (blog.automationMode === 'full_auto') {
      const schedPubGuard = checkDuplicatePostGuard({
        blogId: blog.id,
        keyword: updatedPost.targetKeyword,
        title: updatedPost.title,
        markdownContent: updatedPost.markdownContent,
        excludePostId: updatedPost.id,
        posts: state.posts,
        cooldownDays,
        onlyPublished: true,
      });

      if (schedPubGuard.blocked && schedPubGuard.matchedPost) {
        updatedPost.status = 'review_pending';
        store.addLog(
          'warn',
          'PUBLISHER',
          `[${blog.name}] 예약 원고 유사·중복 자동 발행 차단 (검수 대기열로 전환): 기존 "${schedPubGuard.matchedPost.title}" 글과 ${
            schedPubGuard.reason === 'body_similarity'
              ? `본문 유사도 ${schedPubGuard.similarityPct}%`
              : `최근 ${schedPubGuard.ageDays}일 내 주제 중복`
          }`,
          `제목: ${updatedPost.title}`,
          blog.id
        );
      } else {
        const pubResult = await publishPostToPlatform({
          post: updatedPost,
          blog,
          browserUserDataPath: state.settings.browserUserDataPath,
          exportDir: getExportDirectory(),
          openBrowserEditor: true,
          browserAutomationEngine: state.settings.browserAutomationEngine,
        });
        throwIfTaskCancelled(seq);
        if (pubResult.fullyPublished) {
          updatedPost.status = 'published';
          updatedPost.publishedUrl = pubResult.publishedUrl;
          updatedPost.publishedAt = new Date().toISOString();
        } else {
          updatedPost.publishedUrl = pubResult.publishedUrl;
          updatedPost.status = 'review_pending';
        }
        const credChanged = applyCapturedCredsToBlog(blog, pubResult.capturedCreds);
        if (pubResult.success && !pubResult.loginRequired) {
          blog.auth.sessionLoggedIn = true;
          blog.auth.lastLoginCheckedAt = new Date().toISOString();
          store.upsertBlog(blog);
        } else if (credChanged) {
          store.upsertBlog(blog);
        }
        store.addLog(
          pubResult.loginRequired || !pubResult.success ? 'warn' : 'success',
          'PUBLISHER',
          `[${blog.name}] 캘린더 예약 원고 처리 완료: "${updatedPost.title}"`,
          pubResult.message,
          blog.id
        );
      }
    } else {
      updatedPost.status = 'review_pending';
      store.addLog(
        'success',
        'SCHEDULER',
        `[${blog.name}] 캘린더 예약 원고를 반자동 검수 대기열로 전환했습니다: "${updatedPost.title}"`,
        undefined,
        blog.id
      );
    }

    store.upsertPost(updatedPost);
    return {
      success: true,
      post: updatedPost,
      message:
        updatedPost.status === 'published'
          ? `[${blog.name}] 캘린더에 예약된 원고 "${updatedPost.title}" 발행을 완료했습니다!`
          : `[${blog.name}] 캘린더 예약 원고 "${updatedPost.title}"를 검수 대기열로 전환했습니다.`,
    };
  }

  const nowMs = Date.now();
  const recentBlogPosts = state.posts.filter((p) => {
    if (p.blogId !== blog.id) return false;
    const refMs = new Date(p.publishedAt || p.createdAt).getTime();
    const ageDays = Number.isFinite(refMs)
      ? Math.max(0, Math.floor((nowMs - refMs) / 86400000))
      : 0;
    return ageDays < cooldownDays;
  });

  let bestTrend = selectBestFullAutoBlueOceanTrend(
    state.trends,
    blog,
    state.posts,
    cooldownDays,
    { requireStrictBlueOcean: true }
  );

  if (bestTrend) {
    const serpNote = bestTrend.serpAnalysis
      ? `정확일치 ${bestTrend.serpAnalysis.exactMatchesInTop10}건 · 인플루언서 ${bestTrend.serpAnalysis.influencerCountInTop10}건 · ${bestTrend.serpAnalysis.opportunityLabel}`
      : `Golden Score ${bestTrend.goldenScore}점`;
    store.addLog(
      'info',
      'SCOUT',
      `[${blog.name}] 무인 빈집 롱테일 키워드 자동 선별: "${bestTrend.keyword}" (${serpNote})`,
      undefined,
      blog.id
    );
  } else {
    store.addLog(
      'info',
      'SCHEDULER',
      `[${blog.name}] 기존 풀에 빈집 조건(정확일치≤3 · 인플루언서≤1)을 충족하는 롱테일 키워드가 없어 신규 빈집 롱테일 탐색을 시작합니다...`,
      undefined,
      blog.id
    );

    const excludeKeywords = recentBlogPosts.map((p) => p.targetKeyword);
    const discovered = await scoutGoldenKeywords({
      blog,
      includeRealtimeTrends: false,
      excludeKeywords,
      aiProviders: state.webAISessions,
    });
    throwIfTaskCancelled(seq);

    if (discovered.length > 0) {
      store.addTrends(discovered);
    }

    bestTrend =
      selectBestFullAutoBlueOceanTrend(discovered, blog, state.posts, cooldownDays) ||
      selectBestFullAutoBlueOceanTrend(store.getState().trends, blog, state.posts, cooldownDays) ||
      discovered[0];

    const serpNote = bestTrend?.serpAnalysis
      ? `정확일치 ${bestTrend.serpAnalysis.exactMatchesInTop10}건 · 인플루언서 ${bestTrend.serpAnalysis.influencerCountInTop10}건 · ${bestTrend.serpAnalysis.opportunityLabel}`
      : `Golden Score ${bestTrend?.goldenScore || 88}점`;
    store.addLog(
      'info',
      'SCOUT',
      `[${blog.name}] 무인 빈집 롱테일 키워드 발굴 및 선정 완료: "${
        bestTrend ? bestTrend.keyword : blog.nicheKeywords[0] || '생활 실전 가이드'
      }" (${serpNote})`,
      undefined,
      blog.id
    );
  }

  const targetKeyword = bestTrend ? bestTrend.keyword : `${blog.nicheKeywords[0] || '최신 트렌드'}`;
  const preferredTitle = undefined;

  const preferredAI =
    state.webAISessions.find((s) => s.id === blog.schedule.preferredAIProvider) ||
    state.webAISessions[0];

  const generated = await generateBlogPostContent({
    blog,
    keyword: targetKeyword,
    preferredTitle,
    provider: preferredAI,
    preferredModel: blog.schedule.preferredModel,
    allProviders: state.webAISessions,
    existingPostsForInternalLinks: state.posts,
    affiliates: state.affiliates,
    browserUserDataPath: state.settings.browserUserDataPath,
    headless: state.settings.headlessBrowserForAI,
    browserAutomationEngine: state.settings.browserAutomationEngine,
  });
  throwIfTaskCancelled(seq);

  const polished = await autoSelfPolishPost({
    title: generated.title,
    targetKeyword,
    markdownContent: generated.markdownContent,
    subKeywords: generated.subKeywords,
    extractedTags: generated.extractedTags,
    blog,
    internalLinkCount: generated.internalLinksInserted.length,
    affiliateLinkCount: generated.affiliateItemsInserted.length,
    minTargetScore: 88,
  });
  throwIfTaskCancelled(seq);

  if (polished.boosted) {
    store.addLog(
      'info',
      'SEO',
      `[${blog.name}] 무인 품질 자가교정 완료: SEO ${polished.initialScore}점 → ${polished.seoReport.totalScore}점 (${polished.seoReport.grade}등급)`,
      `키워드: ${targetKeyword}`,
      blog.id
    );
  }

  const tags = polished.tags;
  const seoReport = polished.seoReport;

  const thumbnail = await createDefaultThumbnailConfigAsync(generated.title, targetKeyword, blog);
  const htmlContent = convertMarkdownToNaverRichHtml(
    polished.markdownContent,
    thumbnail.dataUrl,
    thumbnail.accentColor
  );

  const newPost: BlogPost = {
    id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    blogId: blog.id,
    title: generated.title,
    alternativeTitles: generated.alternativeTitles,
    targetKeyword,
    subKeywords: generated.subKeywords,
    category: classifySubCategory(targetKeyword) || blog.auth.defaultCategory || '일반',
    tags,
    markdownContent: polished.markdownContent,
    htmlContent,
    metaDescription: polished.metaDescription,
    thumbnail,
    seoReport,
    aiProviderUsed: generated.aiProviderUsed,
    status: 'review_pending',
    internalLinksInserted: generated.internalLinksInserted,
    affiliateItemsInserted: generated.affiliateItemsInserted,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (blog.automationMode === 'full_auto') {
    const autoPubGuard = checkDuplicatePostGuard({
      blogId: blog.id,
      keyword: newPost.targetKeyword,
      title: newPost.title,
      markdownContent: newPost.markdownContent,
      posts: state.posts,
      cooldownDays,
      onlyPublished: true,
    });
    if (autoPubGuard.blocked && autoPubGuard.matchedPost) {
      store.addLog(
        'warn',
        'PUBLISHER',
        `[${blog.name}] 유사·중복 게시물 자동 발행 차단 (검수 대기열로 전환): 기존 "${autoPubGuard.matchedPost.title}" 글과 ${
          autoPubGuard.reason === 'body_similarity'
            ? `본문 유사도 ${autoPubGuard.similarityPct}%`
            : `최근 ${autoPubGuard.ageDays}일 내 주제 중복`
        }`,
        `제목: ${newPost.title}`,
        blog.id
      );
    } else {
      const pubResult = await publishPostToPlatform({
        post: newPost,
        blog,
        browserUserDataPath: state.settings.browserUserDataPath,
        exportDir: getExportDirectory(),
        openBrowserEditor: true,
        browserAutomationEngine: state.settings.browserAutomationEngine,
      });
      throwIfTaskCancelled(seq);
      if (pubResult.fullyPublished) {
        newPost.status = 'published';
        newPost.publishedUrl = pubResult.publishedUrl;
        newPost.publishedAt = new Date().toISOString();
      }
      const credChanged = applyCapturedCredsToBlog(blog, pubResult.capturedCreds);
      if (pubResult.success && !pubResult.loginRequired) {
        blog.auth.sessionLoggedIn = true;
        blog.auth.lastLoginCheckedAt = new Date().toISOString();
        store.upsertBlog(blog);
      } else if (credChanged) {
        store.upsertBlog(blog);
      }
      store.addLog(
        pubResult.loginRequired || !pubResult.success ? 'warn' : 'success',
        'PUBLISHER',
        `[${blog.name}] 자동 파이프라인 완료: "${newPost.title}" (SEO ${seoReport.totalScore}점)`,
        pubResult.message,
        blog.id
      );
    }
  } else {
    store.addLog(
      'success',
      'WEB_AI',
      `[${blog.name}] 원고 생성 완료 (검수 대기열 등록): "${newPost.title}" (SEO ${seoReport.totalScore}점)`,
      `사용된 엔진: ${generated.aiProviderUsed}`,
      blog.id
    );
  }

  store.upsertPost(newPost);

  return {
    success: true,
    post: newPost,
    message:
      newPost.status === 'published'
        ? `[${blog.name}] 황금 키워드 발굴부터 원고 작성·썸네일 생성·자동 발행까지 원스톱 완료되었습니다!`
        : `[${blog.name}] 고조회수 원고 및 대표 썸네일 생성 완료! 검수 대기열 또는 스튜디오에서 확인 후 발행할 수 있습니다.`,
  };
}

function pushStateToRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state-pushed', store.getState());
  }
}

function clearPendingPipelineQueue(
  reason = '사용자 요청에 의해 대기 중이던 자동 포스팅 작업이 취소되었습니다.'
): void {
  for (const timer of pendingJitterTimers.values()) {
    clearTimeout(timer);
  }
  pendingJitterTimers.clear();
  lastScheduledTriggerTargetMs = 0;

  while (pipelineQueue.length > 0) {
    const dropped = pipelineQueue.shift();
    if (dropped) {
      store.addLog('warn', 'SCHEDULER', `[${dropped.blogName}] ${reason}`, undefined, dropped.blogId);
      dropped.resolve({ success: false, message: reason });
    }
  }
}

async function processPipelineQueue(): Promise<void> {
  if (isProcessingPipelineQueue) return;
  isProcessingPipelineQueue = true;

  try {
    while (pipelineQueue.length > 0) {
      const item = pipelineQueue.shift()!;
      activePipelineBlogId = item.blogId;
      activePipelineBlogName = item.blogName;

      let result: PipelineResult;
      try {
        result = await executeAutomatedPipelineForBlog(item.blogId);
      } catch (err: any) {
        const errMsg = err?.message || '자동 파이프라인 실행 중 오류가 발생했습니다.';
        store.addLog('error', 'SCHEDULER', `[${item.blogName}] 스케줄 실행 오류: ${errMsg}`, undefined, item.blogId);
        result = { success: false, message: errMsg };
      } finally {
        activePipelineBlogId = null;
        activePipelineBlogName = null;
      }

      item.resolve(result);
      pushStateToRenderer();

      // Allow clipboard & Aside browser tabs to settle cleanly before starting next blog
      if (pipelineQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
    }
  } finally {
    isProcessingPipelineQueue = false;
  }
}

function enqueueAutomatedPipelineForBlog(
  blogId: string,
  source: 'schedule' | 'manual' = 'manual'
): Promise<PipelineResult> {
  const blog = store.getState().blogs.find((b) => b.id === blogId);
  if (!blog) {
    return Promise.resolve({ success: false, message: '대상 블로그를 찾을 수 없습니다.' });
  }

  if (activePipelineBlogId === blogId) {
    const msg = `[${blog.name}] 이미 자동 포스팅 파이프라인이 실행 중입니다.`;
    if (source === 'schedule') {
      store.addLog('info', 'SCHEDULER', msg, undefined, blog.id);
      pushStateToRenderer();
    }
    return Promise.resolve({ success: false, message: msg });
  }

  if (pipelineQueue.some((item) => item.blogId === blogId)) {
    const msg = `[${blog.name}] 이미 순차 실행 대기열에 등록되어 있습니다. 앞선 작업 완료 후 자동으로 이어서 실행됩니다.`;
    if (source === 'schedule') {
      store.addLog('info', 'SCHEDULER', msg, undefined, blog.id);
      pushStateToRenderer();
    }
    return Promise.resolve({ success: false, message: msg });
  }

  const queueBusy =
    isProcessingPipelineQueue || activePipelineBlogId !== null || pipelineQueue.length > 0;
  if (queueBusy) {
    const rank = pipelineQueue.length + 1;
    const runningName = activePipelineBlogName || '다른 블로그';
    store.addLog(
      'info',
      'SCHEDULER',
      `[${blog.name}] 현재 다른 블로그(${runningName}) 자동 파이프라인이 진행 중이므로 순차 대기열(${rank}순위)에 등록되었습니다. 앞선 작업 완료 후 자동으로 이어서 실행됩니다.`,
      undefined,
      blog.id
    );
    pushStateToRenderer();
  }

  return new Promise<PipelineResult>((resolve) => {
    pipelineQueue.push({
      blogId: blog.id,
      blogName: blog.name,
      source,
      resolve,
    });
    void processPipelineQueue();
  });
}

async function runAutomatedPipelineForBlog(
  blogId: string,
  source: 'schedule' | 'manual' = 'manual'
): Promise<PipelineResult> {
  return enqueueAutomatedPipelineForBlog(blogId, source);
}

function resolveBlogCronExpressions(blog: BlogProfile): string[] {
  const { schedule } = blog;
  if (
    schedule.scheduleMode === 'custom_times' &&
    Array.isArray(schedule.customTimes) &&
    schedule.customTimes.length > 0
  ) {
    const seen = new Set<string>();
    const exprs: string[] = [];
    for (const raw of schedule.customTimes) {
      const match = String(raw || '')
        .trim()
        .match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!match) continue;
      const hour = parseInt(match[1], 10);
      const min = parseInt(match[2], 10);
      const expr = `${min} ${hour} * * *`;
      if (!seen.has(expr) && cron.validate(expr)) {
        seen.add(expr);
        exprs.push(expr);
      }
    }
    if (exprs.length > 0) return exprs;
  }

  if (schedule.cronExpression && cron.validate(schedule.cronExpression)) {
    return [schedule.cronExpression];
  }
  return [];
}

function syncCronJobs(): void {
  for (const jobs of activeCronJobs.values()) {
    for (const job of jobs) {
      job.stop();
    }
  }
  activeCronJobs.clear();
  for (const timer of pendingJitterTimers.values()) {
    clearTimeout(timer);
  }
  pendingJitterTimers.clear();
  lastScheduledTriggerTargetMs = 0;

  const state = store.getState();
  for (const blog of state.blogs) {
    if (!blog.schedule.enabled) continue;
    const cronExpressions = resolveBlogCronExpressions(blog);
    if (cronExpressions.length === 0) continue;

    const tasksForBlog: ScheduledTask[] = [];
    for (const cronExpr of cronExpressions) {
      const task = cron.schedule(cronExpr, () => {
        const currentState = store.getState();
        const latestBlog = currentState.blogs.find((b) => b.id === blog.id);
        if (!latestBlog || !latestBlog.schedule.enabled) return;

        // Check daily post limit for today (in local timezone, e.g. KST)
        const todayStr = toLocalDateStr(new Date());
        const todayCount = currentState.posts.filter(
          (p) =>
            p.blogId === latestBlog.id &&
            toLocalDateStr(p.publishedAt || p.createdAt) === todayStr
        ).length;

        if (todayCount >= (latestBlog.schedule.dailyPostLimit || 2)) {
          store.addLog(
            'info',
            'SCHEDULER',
            `[${latestBlog.name}] 오늘 일일 목표 포스팅 수(${latestBlog.schedule.dailyPostLimit}건)를 이미 달성하여 이번 스케줄은 건너뜁니다.`,
            undefined,
            latestBlog.id
          );
          pushStateToRenderer();
          return;
        }

        // Apply human-like random time jitter AND stagger simultaneous blog schedules (8-15 min gap, or 90-180s in prompt mode)
        const maxJitterMin =
          latestBlog.schedule.randomJitterMinutes !== undefined
            ? latestBlog.schedule.randomJitterMinutes
            : 20;
        const baseJitterSeconds =
          maxJitterMin <= 0
            ? Math.floor(Math.random() * 60) + 15
            : Math.floor(Math.random() * Math.max(30, maxJitterMin * 60 - 90)) + 90;
        const randomGapSec =
          maxJitterMin <= 0
            ? Math.floor(Math.random() * 91) + 90
            : Math.floor(Math.random() * 421) + 480;
        const minGapMs = randomGapSec * 1000;
        const nowMs = Date.now();
        const desiredTargetMs = nowMs + baseJitterSeconds * 1000;
        const scheduledTargetMs = Math.max(desiredTargetMs, lastScheduledTriggerTargetMs + minGapMs);
        lastScheduledTriggerTargetMs = scheduledTargetMs;

        const finalDelayMs = Math.max(1000, scheduledTargetMs - nowMs);
        const jitterSeconds = Math.round(finalDelayMs / 1000);
        const staggered = scheduledTargetMs > desiredTargetMs + 1000;
        const displayMin = Math.floor(jitterSeconds / 60);
        const displaySec = jitterSeconds % 60;

        store.addLog(
          'info',
          'SCHEDULER',
          `[${latestBlog.name}] 스케줄 시간 도달 — ${
            staggered ? '타 블로그와 동시 실행 충돌·대량 스팸 의심 방지를 위해 자동 분산(' : '저품질·봇 패턴 방지를 위해 '
          }${displayMin > 0 ? `${displayMin}분 ${displaySec}초` : `${displaySec}초`}${
            staggered ? ' 후) 순차' : ' 랜덤 시간차(Jitter) 후 자연스럽게'
          } 포스팅을 시작합니다.`,
          undefined,
          latestBlog.id
        );
        pushStateToRenderer();

        const prevTimer = pendingJitterTimers.get(latestBlog.id);
        if (prevTimer) {
          clearTimeout(prevTimer);
        }

        const timer = setTimeout(() => {
          pendingJitterTimers.delete(latestBlog.id);
          runAutomatedPipelineForBlog(latestBlog.id, 'schedule')
            .then(() => {
              pushStateToRenderer();
            })
            .catch((err) => {
              store.addLog(
                'error',
                'SCHEDULER',
                `[${latestBlog.name}] 스케줄 실행 오류: ${err?.message}`,
                undefined,
                latestBlog.id
              );
              pushStateToRenderer();
            });
        }, finalDelayMs);
        pendingJitterTimers.set(latestBlog.id, timer);
      });
      tasksForBlog.push(task);
    }

    activeCronJobs.set(blog.id, tasksForBlog);
  }
}

function setupAppShortcutsMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  setupAppShortcutsMenu();
  const iconCandidates = [
    path.join(__dirname, '../dist/icon.ico'),
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../dist/icon.png'),
    path.join(__dirname, '../public/icon.png'),
  ];
  const appIconPath = iconCandidates.find((p) => fs.existsSync(p));

  mainWindow = new BrowserWindow({
    width: 1560,
    height: 950,
    minWidth: 1180,
    minHeight: 760,
    title: 'BlogStater Omni Studio - 올인원 멀티 블로그 자동화 데스크톱',
    backgroundColor: '#f8fafc',
    ...(appIconPath ? { icon: appIconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').catch(() => {
      mainWindow?.loadFile(path.join(__dirname, '../dist/index.html'));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  try {
    powerSaveBlocker.start('prevent-app-suspension');
  } catch {
    // ignore
  }
  store = new LocalStore();
  store.deduplicateTrends();
  syncCronJobs();
  createWindow();

  // Auto-detect installed local subscription CLIs (claude, codex, gemini, gh) in background
  detectInstalledCLIs(store.getState().webAISessions)
    .then((scannedSessions) => {
      for (const s of scannedSessions) {
        store.updateWebAISession(s);
      }
      pushStateToRenderer();
    })
    .catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('get-state', async () => {
  return store.getState();
});

ipcMain.handle('cancel-active-task', async () => {
  clearPendingPipelineQueue('사용자 요청에 의해 대기 중이던 자동 포스팅 작업이 취소되었습니다.');
  await cancelAllActiveTasks();
  store.addLog('warn', 'SCHEDULER', '사용자 요청에 의해 진행 중인 작업이 즉시 중단되었습니다.');
  pushStateToRenderer();
  return {
    cancelled: true,
    message: '진행 중인 작업이 즉시 중단되었습니다.',
    state: store.getState(),
  };
});

ipcMain.handle(
  'scout-keywords',
  async (_, payload: { seedKeyword?: string; blogId?: string; includeRealtimeTrends?: boolean }) => {
    const { seq } = beginCancellableTask();
    store.pruneTrends();
    const state = store.getState();
    const isAllBlogs = !payload.blogId || payload.blogId === 'all';
    const targetBlogs = isAllBlogs
      ? state.blogs
      : state.blogs.filter((b) => b.id === payload.blogId);

    const excludeKeywords = [
      ...state.posts.map((p) => p.targetKeyword),
      ...state.trends.map((t) => t.keyword),
    ];

    const discovered: TrendTopic[] = [];

    if (targetBlogs.length > 0) {
      for (const blog of targetBlogs) {
        throwIfTaskCancelled(seq);
        const blogDiscovered = await scoutGoldenKeywords({
          seedKeyword: payload.seedKeyword,
          blog,
          includeRealtimeTrends: payload.includeRealtimeTrends ?? true,
          excludeKeywords,
          aiProviders: state.webAISessions,
        });
        throwIfTaskCancelled(seq);
        discovered.push(...blogDiscovered);
        for (const item of blogDiscovered) {
          excludeKeywords.push(item.keyword);
        }
        store.addLog(
          'success',
          'SCOUT',
          `[${blog.name}] 맞춤 황금 소주제 ${blogDiscovered.length}건 발굴 완료`,
          payload.seedKeyword?.trim()
            ? `지정 대주제: ${payload.seedKeyword.trim()}`
            : `블로그 대주제: ${blog.nicheKeywords.join(', ') || '전체 트렌드'}`,
          blog.id
        );
      }
    } else {
      const fallbackDiscovered = await scoutGoldenKeywords({
        seedKeyword: payload.seedKeyword,
        blog: undefined,
        includeRealtimeTrends: payload.includeRealtimeTrends ?? true,
        excludeKeywords,
        aiProviders: state.webAISessions,
      });
      throwIfTaskCancelled(seq);
      discovered.push(...fallbackDiscovered);
      store.addLog(
        'success',
        'SCOUT',
        `황금 키워드 및 실시간 트렌드 ${fallbackDiscovered.length}건 발굴 완료`,
        `시드 키워드: ${payload.seedKeyword || '전체 트렌드'}`
      );
    }

    store.addTrends(discovered);
    return {
      discovered,
      allTrends: store.getState().trends,
    };
  }
);

ipcMain.handle('delete-trend', async (_, trendId: string) => {
  store.deleteTrend(trendId);
  return store.getState();
});

ipcMain.handle('delete-trends-batch', async (_, trendIds: string[]) => {
  store.deleteTrendsBatch(trendIds);
  store.addLog('info', 'SCOUT', `선택된 황금 키워드 ${trendIds.length}건 일괄 삭제 완료`);
  return store.getState();
});

ipcMain.handle(
  'clear-trends',
  async (_, options?: { blogId?: string; onlyUsed?: boolean }) => {
    store.clearTrends(options);
    store.addLog(
      'info',
      'SCOUT',
      options?.onlyUsed ? '작성 완료된 황금 키워드 일괄 정리 완료' : '황금 키워드 목록 초기화 완료'
    );
    return store.getState();
  }
);

ipcMain.handle('deduplicate-trends', async () => {
  const res = store.deduplicateTrends();
  store.addLog(
    'info',
    'SCOUT',
    `중복·유사 황금 키워드 자동 정리 완료 (중복 ${res.removedCount}건 제거)`
  );
  return {
    removedCount: res.removedCount,
    state: store.getState(),
  };
});

ipcMain.handle('toggle-pin-trend', async (_, trendId: string) => {
  store.togglePinTrend(trendId);
  return store.getState();
});

ipcMain.handle(
  'add-manual-trend',
  async (_, payload: { keyword: string; blogId?: string }) => {
    const { seq } = beginCancellableTask();
    const state = store.getState();
    const blog =
      payload.blogId && payload.blogId !== 'all'
        ? state.blogs.find((b) => b.id === payload.blogId)
        : state.blogs[0];
    const topic = await createManualTrendTopic(payload.keyword, blog);
    throwIfTaskCancelled(seq);
    store.addTrends([topic]);
    store.addLog(
      'success',
      'SCOUT',
      `수동 황금 키워드 등록 완료: "${topic.keyword}" (Golden Score: ${topic.goldenScore}점)`,
      undefined,
      blog?.id
    );
    return store.getState();
  }
);

ipcMain.handle(
  'generate-post',
  async (
    _,
    payload: {
      blogId: string;
      keyword: string;
      preferredTitle?: string;
      aiProviderId?: string;
      aiModelId?: string;
      customInstructions?: string;
      referenceSourceUrlOrText?: string;
      thumbnailDataUrl?: string;
      scheduledFor?: string;
      forceGenerate?: boolean;
    }
  ) => {
    const { seq } = beginCancellableTask();
    const state = store.getState();
    const blog = state.blogs.find((b) => b.id === payload.blogId) || state.blogs[0];
    if (!blog) {
      throw new Error('먼저 운영하실 블로그를 1개 이상 등록해주세요.');
    }

    const cooldownDays = state.settings.duplicateCooldownDays ?? 14;
    if (!payload.forceGenerate) {
      const guard = checkDuplicatePostGuard({
        blogId: blog.id,
        keyword: payload.keyword,
        title: payload.preferredTitle,
        posts: state.posts,
        cooldownDays,
      });
      if (guard.blocked && guard.matchedPost) {
        const msg = `[중복 게시물 방어] '${blog.name}' 블로그에 ${
          guard.ageDays === 0 ? '오늘' : `${guard.ageDays}일 전`
        } 작성된 동일·유사 주제의 글("${guard.matchedPost.title}")이 있습니다. (재작성 쿨타임 ${
          guard.remainingDays
        }일 남음)`;
        store.addLog('warn', 'SEO', msg, `키워드: ${payload.keyword}`, blog.id);
        throw new Error(msg);
      }
    }
    const provider =
      state.webAISessions.find((s) => s.id === (payload.aiProviderId || blog.schedule.preferredAIProvider)) ||
      state.webAISessions[0];

    const chosenModel =
      payload.aiModelId ||
      (provider.id === blog.schedule.preferredAIProvider ? blog.schedule.preferredModel : undefined) ||
      provider.selectedModel;

    store.addLog(
      'info',
      'WEB_AI',
      `[${blog.name}] '${payload.keyword}' 고조회수 포스팅 원고 생성 시작 (${provider.name}${chosenModel ? ` · 모델: ${chosenModel}` : ''})`,
      payload.scheduledFor ? `배정 날짜: ${payload.scheduledFor}` : undefined,
      blog.id
    );

    const generated = await generateBlogPostContent({
      blog,
      keyword: payload.keyword,
      preferredTitle: payload.preferredTitle,
      provider,
      preferredModel: chosenModel,
      allProviders: state.webAISessions,
      existingPostsForInternalLinks: state.posts,
      affiliates: state.affiliates,
      browserUserDataPath: state.settings.browserUserDataPath,
      headless: state.settings.headlessBrowserForAI,
      browserAutomationEngine: state.settings.browserAutomationEngine,
      customInstructions: payload.customInstructions,
      referenceSourceUrlOrText: payload.referenceSourceUrlOrText,
    });
    throwIfTaskCancelled(seq);

    const polished = await autoSelfPolishPost({
      title: generated.title,
      targetKeyword: payload.keyword,
      markdownContent: generated.markdownContent,
      subKeywords: generated.subKeywords,
      extractedTags: generated.extractedTags,
      blog,
      internalLinkCount: generated.internalLinksInserted.length,
      affiliateLinkCount: generated.affiliateItemsInserted.length,
      minTargetScore: 88,
    });
    throwIfTaskCancelled(seq);

    const tags = polished.tags;
    const seoReport = polished.seoReport;

    const thumbnail = await createDefaultThumbnailConfigAsync(generated.title, payload.keyword, blog);
    if (payload.thumbnailDataUrl && payload.thumbnailDataUrl.startsWith('data:image/png')) {
      thumbnail.dataUrl = payload.thumbnailDataUrl;
    }

    const htmlContent = convertMarkdownToNaverRichHtml(
      polished.markdownContent,
      thumbnail.dataUrl,
      thumbnail.accentColor
    );

    const createdTimestamp = payload.scheduledFor
      ? new Date(`${payload.scheduledFor}T09:00:00`).toISOString()
      : new Date().toISOString();

    const newPost: BlogPost = {
      id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      blogId: blog.id,
      title: generated.title,
      alternativeTitles: generated.alternativeTitles,
      targetKeyword: payload.keyword,
      subKeywords: generated.subKeywords,
      category: classifySubCategory(payload.keyword) || blog.auth.defaultCategory || '일반',
      tags,
      markdownContent: polished.markdownContent,
      htmlContent,
      metaDescription: polished.metaDescription,
      thumbnail,
      seoReport,
      aiProviderUsed: generated.aiProviderUsed,
      status: payload.scheduledFor ? 'scheduled' : 'review_pending',
      scheduledFor: payload.scheduledFor,
      internalLinksInserted: generated.internalLinksInserted,
      affiliateItemsInserted: generated.affiliateItemsInserted,
      createdAt: createdTimestamp,
      updatedAt: new Date().toISOString(),
    };

    throwIfTaskCancelled(seq);
    store.upsertPost(newPost);
    store.addLog(
      'success',
      'SEO',
      `[${blog.name}] 원고 생성 및 SEO 검증 완료 (SEO 점수: ${seoReport.totalScore}점 / 등급: ${seoReport.grade})`,
      `제목: ${newPost.title}`,
      blog.id
    );

    return newPost;
  }
);

ipcMain.handle(
  'batch-generate-posts',
  async (
    _,
    payload: {
      blogId: string;
      keywords: string[];
      aiProviderId?: string;
      aiModelId?: string;
      scheduledFor?: string;
    }
  ) => {
    const { seq } = beginCancellableTask();
    const state = store.getState();
    const explicitBlog =
      payload.blogId && payload.blogId !== 'all'
        ? state.blogs.find((b) => b.id === payload.blogId)
        : undefined;
    const defaultBlog = explicitBlog || state.blogs[0];
    if (!defaultBlog) {
      throw new Error('먼저 운영하실 블로그를 등록해주세요.');
    }

    const cooldownDays = state.settings.duplicateCooldownDays ?? 14;
    const createdPosts: BlogPost[] = [];
    const skippedDuplicates: string[] = [];

    for (const kw of payload.keywords) {
      throwIfTaskCancelled(seq);
      const matchedTrend = state.trends.find((t) => t.keyword === kw && t.recommendedBlogId);
      const blog =
        explicitBlog ||
        (matchedTrend?.recommendedBlogId
          ? state.blogs.find((b) => b.id === matchedTrend.recommendedBlogId)
          : undefined) ||
        defaultBlog;

      const provider =
        state.webAISessions.find((s) => s.id === (payload.aiProviderId || blog.schedule.preferredAIProvider)) ||
        state.webAISessions[0];
      const chosenModel =
        payload.aiModelId ||
        (provider.id === blog.schedule.preferredAIProvider ? blog.schedule.preferredModel : undefined) ||
        provider.selectedModel;

      const latestPosts = store.getState().posts;
      const dupGuard = checkDuplicatePostGuard({
        blogId: blog.id,
        keyword: kw,
        posts: latestPosts,
        cooldownDays,
      });
      if (dupGuard.blocked && dupGuard.matchedPost) {
        skippedDuplicates.push(kw);
        store.addLog(
          'warn',
          'SEO',
          `[일괄 생성 건너뜀 · 중복 방어] '${kw}' 키워드는 최근 작성된 "${dupGuard.matchedPost.title}" 글과 중복되어 건너뜁니다. (쿨타임 ${dupGuard.remainingDays}일 남음)`,
          undefined,
          blog.id
        );
        continue;
      }

      const generated = await generateBlogPostContent({
        blog,
        keyword: kw,
        provider,
        preferredModel: chosenModel,
        allProviders: state.webAISessions,
        existingPostsForInternalLinks: latestPosts,
        affiliates: state.affiliates,
        browserUserDataPath: state.settings.browserUserDataPath,
        headless: state.settings.headlessBrowserForAI,
        browserAutomationEngine: state.settings.browserAutomationEngine,
      });
      throwIfTaskCancelled(seq);

      const polished = await autoSelfPolishPost({
        title: generated.title,
        targetKeyword: kw,
        markdownContent: generated.markdownContent,
        subKeywords: generated.subKeywords,
        extractedTags: generated.extractedTags,
        blog,
        internalLinkCount: generated.internalLinksInserted.length,
        affiliateLinkCount: generated.affiliateItemsInserted.length,
        minTargetScore: 88,
      });
      throwIfTaskCancelled(seq);

      const tags = polished.tags;
      const seoReport = polished.seoReport;

      const thumbnail = await createDefaultThumbnailConfigAsync(generated.title, kw, blog);
      const htmlContent = convertMarkdownToNaverRichHtml(
        polished.markdownContent,
        thumbnail.dataUrl,
        thumbnail.accentColor
      );

      const post: BlogPost = {
        id: `post-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        blogId: blog.id,
        title: generated.title,
        alternativeTitles: generated.alternativeTitles,
        targetKeyword: kw,
        subKeywords: generated.subKeywords,
        category: classifySubCategory(kw) || blog.auth.defaultCategory || '일반',
        tags,
        markdownContent: polished.markdownContent,
        htmlContent,
        metaDescription: polished.metaDescription,
        thumbnail,
        seoReport,
        aiProviderUsed: generated.aiProviderUsed,
        status: payload.scheduledFor ? 'scheduled' : 'review_pending',
        scheduledFor: payload.scheduledFor,
        internalLinksInserted: generated.internalLinksInserted,
        affiliateItemsInserted: generated.affiliateItemsInserted,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      throwIfTaskCancelled(seq);
      store.upsertPost(post);
      createdPosts.push(post);
    }

    if (createdPosts.length === 0 && skippedDuplicates.length > 0) {
      throw new Error(
        `선택하신 키워드(${skippedDuplicates.join(', ')})가 모두 최근 ${cooldownDays}일 내 작성 이력과 중복되어 일괄 생성을 중단했습니다.`
      );
    }

    const batchLabel = explicitBlog ? explicitBlog.name : '전체 블로그';
    const message =
      skippedDuplicates.length > 0
        ? `[${batchLabel}] 신규 원고 ${createdPosts.length}건 생성 완료! (중복 방어로 ${skippedDuplicates.length}건 건너뜀: ${skippedDuplicates.join(', ')})`
        : `선택하신 ${createdPosts.length}개 키워드의 고조회수 원고 및 썸네일이 일괄 생성되었습니다!`;

    store.addLog(
      'success',
      'WEB_AI',
      `[${batchLabel}] 다중 키워드 일괄(Batch) 원고 ${createdPosts.length}건 연속 생성 완료!`,
      skippedDuplicates.length > 0
        ? `생성: ${createdPosts.map((p) => p.targetKeyword).join(', ')} / 중복 제외: ${skippedDuplicates.join(', ')}`
        : `키워드: ${payload.keywords.join(', ')}`,
      explicitBlog?.id
    );

    return {
      createdPosts,
      state: store.getState(),
      message,
    };
  }
);

ipcMain.handle('analyze-competitors', async (_, keyword: string) => {
  const { seq } = beginCancellableTask();
  const report = await analyzeCompetitorSERP(keyword);
  throwIfTaskCancelled(seq);
  store.addLog(
    'info',
    'SERP',
    `'${keyword}' 상위노출 경쟁글 ${report.topCompetitors.length}건 및 필승 전략 분석 완료`,
    `추출된 핵심 연관어: ${report.extractedSubKeywords.slice(0, 5).join(', ')}`
  );
  return report;
});

ipcMain.handle('check-post-rank', async (_, postId: string) => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const post = state.posts.find((p) => p.id === postId);
  if (!post) throw new Error('포스팅을 찾을 수 없습니다.');
  const blog = state.blogs.find((b) => b.id === post.blogId);

  const rankInfo = await checkPostSearchRank(post, blog);
  throwIfTaskCancelled(seq);
  post.rankInfo = rankInfo;
  store.upsertPost(post);
  store.addLog('info', 'SERP', `[순위 조회] '${post.targetKeyword}': ${rankInfo.summaryText}`, undefined, blog?.id);

  return {
    rankInfo,
    post,
    state: store.getState(),
  };
});

ipcMain.handle('check-all-posts-rank', async (_, blogId?: string) => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const targetPosts = blogId
    ? state.posts.filter((p) => p.blogId === blogId)
    : state.posts;

  let checkedCount = 0;
  let indexedCount = 0;
  let top10Count = 0;

  for (const post of targetPosts) {
    if (isTaskCancelled(seq)) break;
    const blog = state.blogs.find((b) => b.id === post.blogId);
    const rankInfo = await checkPostSearchRank(post, blog);
    if (isTaskCancelled(seq)) break;
    post.rankInfo = rankInfo;
    store.upsertPost(post);
    checkedCount++;
    if (rankInfo.rank !== null) {
      indexedCount++;
      if (rankInfo.rank <= 10) top10Count++;
    }
  }
  throwIfTaskCancelled(seq);

  const message = `총 ${checkedCount}건의 글 검색 순위 일괄 조회 완료! (1페이지 상위노출: ${top10Count}건 / 30위 내 노출: ${indexedCount}건)`;
  store.addLog('success', 'SERP', message);

  return {
    checkedCount,
    indexedCount,
    top10Count,
    message,
    state: store.getState(),
  };
});

ipcMain.handle('extract-reference-source', async (_, urlOrText: string) => {
  const { seq } = beginCancellableTask();
  const extracted = await extractReferenceSourceMaterial(urlOrText);
  throwIfTaskCancelled(seq);
  return extracted;
});

ipcMain.handle(
  'evaluate-seo',
  async (
    _,
    payload: {
      title: string;
      targetKeyword: string;
      markdownContent: string;
      subKeywords?: string[];
      tags?: string[];
      internalLinkCount?: number;
      affiliateLinkCount?: number;
    }
  ) => {
    return evaluatePostSEO(payload);
  }
);

ipcMain.handle('save-post', async (_, post: BlogPost) => {
  post.updatedAt = new Date().toISOString();
  post.seoReport = evaluatePostSEO({
    title: post.title,
    targetKeyword: post.targetKeyword,
    markdownContent: post.markdownContent,
    subKeywords: post.subKeywords,
    tags: post.tags,
    internalLinkCount: post.internalLinksInserted?.length || 0,
    affiliateLinkCount: post.affiliateItemsInserted?.length || 0,
  });
  post.htmlContent = convertMarkdownToNaverRichHtml(
    post.markdownContent,
    post.thumbnail?.dataUrl,
    post.thumbnail?.accentColor || '#4f46e5'
  );
  return store.upsertPost(post);
});

ipcMain.handle('delete-post', async (_, postId: string) => {
  store.deletePost(postId);
  return store.getState();
});

ipcMain.handle(
  'polish-post',
  async (
    _,
    payload: {
      postId: string;
      mode: 'boost_scores' | 'humanize_tone';
      markdownContent?: string;
    }
  ) => {
    const { seq } = beginCancellableTask();
    const state = store.getState();
    const post = state.posts.find((p) => p.id === payload.postId);
    if (!post) throw new Error('포스팅을 찾을 수 없습니다.');
    const blog = state.blogs.find((b) => b.id === post.blogId) || state.blogs[0];
    if (!blog) throw new Error('블로그 프로필을 찾을 수 없습니다.');

    const res = await polishBlogPostContent({
      markdownContent: payload.markdownContent ?? post.markdownContent,
      title: post.title,
      targetKeyword: post.targetKeyword,
      blog,
      mode: payload.mode,
      subKeywords: post.subKeywords,
    });
    throwIfTaskCancelled(seq);

    post.markdownContent = res.markdownContent;
    post.updatedAt = new Date().toISOString();
    post.seoReport = evaluatePostSEO({
      title: post.title,
      targetKeyword: post.targetKeyword,
      markdownContent: post.markdownContent,
      subKeywords: post.subKeywords,
      tags: post.tags,
      internalLinkCount: post.internalLinksInserted?.length || 0,
      affiliateLinkCount: post.affiliateItemsInserted?.length || 0,
    });
    post.htmlContent = convertMarkdownToNaverRichHtml(
      post.markdownContent,
      post.thumbnail?.dataUrl,
      post.thumbnail?.accentColor || '#2563eb'
    );
    store.upsertPost(post);
    store.addLog(
      'success',
      'SEO',
      `[${blog.name}] ${res.summaryMessage} (통합 점수: ${post.seoReport.totalScore}점)`,
      `제목: ${post.title}`,
      blog.id
    );

    return {
      post,
      message: res.summaryMessage,
      state: store.getState(),
    };
  }
);

ipcMain.handle(
  'toggle-inline-images',
  async (_, payload: { postId: string; markdownContent?: string }) => {
    const state = store.getState();
    const post = state.posts.find((p) => p.id === payload.postId);
    if (!post) throw new Error('포스팅을 찾을 수 없습니다.');

    const blog = state.blogs.find((b) => b.id === post.blogId);
    const toggled = toggleInlineSummaryImagesInMarkdown(
      payload.markdownContent ?? post.markdownContent,
      post.targetKeyword,
      post.title,
      blog
    );

    post.markdownContent = toggled.hasInlineImages
      ? await convertInlineSvgsToPngInMarkdown(toggled.markdownContent, `${post.id}-${Date.now()}`)
      : toggled.markdownContent;
    post.updatedAt = new Date().toISOString();
    post.seoReport = evaluatePostSEO({
      title: post.title,
      targetKeyword: post.targetKeyword,
      markdownContent: post.markdownContent,
      subKeywords: post.subKeywords,
      tags: post.tags,
      internalLinkCount: post.internalLinksInserted?.length || 0,
      affiliateLinkCount: post.affiliateItemsInserted?.length || 0,
    });
    post.htmlContent = convertMarkdownToNaverRichHtml(
      post.markdownContent,
      post.thumbnail?.dataUrl,
      post.thumbnail?.accentColor || '#2563eb'
    );
    store.upsertPost(post);

    const message = toggled.hasInlineImages
      ? `[주제 맞춤: ${toggled.policyLabel}] 본문 적재적소에 문맥 맞춤 시각자료 ${toggled.imageCount}장이 배치되었습니다!`
      : '본문 중간 이미지·시각자료가 제거되어 순수 텍스트 서식으로 전환되었습니다.';

    return {
      post,
      hasInlineImages: toggled.hasInlineImages,
      imageCount: toggled.imageCount,
      message,
      state: store.getState(),
    };
  }
);

ipcMain.handle('ping-index-now', async (_, postId: string) => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const post = state.posts.find((p) => p.id === postId);
  if (!post) throw new Error('포스팅을 찾을 수 없습니다.');
  const blog = state.blogs.find((b) => b.id === post.blogId) || state.blogs[0];
  const res = await pingSearchAndAiEngines({
    publishedUrl: post.publishedUrl || blog?.auth.blogUrl || '',
    blogUrl: blog?.auth.blogUrl || '',
    title: post.title,
  });
  throwIfTaskCancelled(seq);
  store.addLog('success', 'PUBLISHER', res.message, `대상 글: ${post.title}`, blog?.id);
  return {
    ...res,
    state: store.getState(),
  };
});

ipcMain.handle('publish-post', async (_, payload: { postId: string; openBrowserEditor?: boolean }) => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const post = state.posts.find((p) => p.id === payload.postId);
  if (!post) throw new Error('포스팅을 찾을 수 없습니다.');
  const blog = state.blogs.find((b) => b.id === post.blogId) || state.blogs[0];
  if (!blog) throw new Error('연결된 블로그 프로필이 없습니다.');

  if (post.status === 'published') {
    const msg =
      '[중복 발행 차단] 이미 발행 완료된 원고입니다. 동일한 글을 그대로 재발행하면 검색엔진 유사문서(저품질) 페널티를 받을 수 있습니다.';
    store.addLog('warn', 'PUBLISHER', msg, `대상 글: ${post.title}`, blog.id);
    throw new Error(msg);
  }

  const cooldownDays = state.settings.duplicateCooldownDays ?? 14;
  const pubGuard = checkDuplicatePostGuard({
    blogId: blog.id,
    keyword: post.targetKeyword,
    title: post.title,
    markdownContent: post.markdownContent,
    excludePostId: post.id,
    posts: state.posts,
    cooldownDays,
    onlyPublished: true,
  });
  if (pubGuard.blocked && pubGuard.matchedPost) {
    const blockMsg =
      pubGuard.reason === 'body_similarity'
        ? `[유사문서 발행 차단] 이미 발행된 "${pubGuard.matchedPost.title}" 글과 본문 유사도가 ${pubGuard.similarityPct}%로 매우 높습니다. 유사문서 저품질 방지를 위해 발행을 중단했습니다.`
        : `[중복 발행 차단] ${
            pubGuard.ageDays === 0 ? '오늘' : `${pubGuard.ageDays}일 전`
          } 동일·유사 주제("${pubGuard.matchedPost.title}")를 이미 발행했습니다. (쿨타임 ${
            pubGuard.remainingDays
          }일 남음)`;
    store.addLog('warn', 'PUBLISHER', blockMsg, `시도한 글: ${post.title}`, blog.id);
    throw new Error(blockMsg);
  }

  const result = await publishPostToPlatform({
    post,
    blog,
    browserUserDataPath: state.settings.browserUserDataPath,
    exportDir: getExportDirectory(),
    openBrowserEditor: payload.openBrowserEditor,
    browserAutomationEngine: state.settings.browserAutomationEngine,
  });
  throwIfTaskCancelled(seq);

  if (result.fullyPublished) {
    post.status = 'published';
    post.publishedUrl = result.publishedUrl;
    post.publishedAt = new Date().toISOString();
  } else {
    post.publishedUrl = result.publishedUrl;
  }
  store.upsertPost(post);

  const credChanged = applyCapturedCredsToBlog(blog, result.capturedCreds);
  if (result.success && !result.loginRequired) {
    blog.auth.sessionLoggedIn = true;
    blog.auth.lastLoginCheckedAt = new Date().toISOString();
    store.upsertBlog(blog);
  } else if (credChanged) {
    store.upsertBlog(blog);
  }

  store.addLog(
    result.loginRequired || !result.success ? 'warn' : 'success',
    'PUBLISHER',
    result.message,
    `저장 경로: ${result.exportedFolder}`,
    blog.id
  );

  return {
    ...result,
    post,
    state: store.getState(),
  };
});

ipcMain.handle('copy-rich-html', async (_, payload: { htmlContent: string; markdownContent: string }) => {
  clipboard.write({
    html: payload.htmlContent,
    text: payload.markdownContent,
  });
  return {
    success: true,
    message: '클립보드에 서식(표·인용구·소제목 디자인)이 포함된 리치 HTML이 복사되었습니다! 네이버/티스토리/벨로그 에디터에 바로 붙여넣기(Ctrl+V) 하세요.',
  };
});

ipcMain.handle('open-web-ai-session', async (_, providerId: string) => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const provider = state.webAISessions.find((s) => s.id === providerId);
  if (!provider) throw new Error('AI 프로바이더를 찾을 수 없습니다.');

  if (provider.connectionType === 'local_cli' || provider.id.endsWith('_cli')) {
    const cliRes = await openCliSetupTerminal(provider);
    throwIfTaskCancelled(seq);
    if (cliRes.installed) {
      provider.loggedIn = true;
      provider.cliVersion = cliRes.version;
    }
    provider.lastUsedAt = new Date().toISOString();
    store.updateWebAISession(provider);
    store.addLog('info', 'SESSION', cliRes.message);
    return {
      loggedIn: provider.loggedIn,
      message: cliRes.message,
      state: store.getState(),
    };
  }

  store.addLog(
    'info',
    'SESSION',
    `[${provider.name}] 브라우저 로그인 세션 창을 실행합니다. 로그인 완료 후 창을 닫으면 세션이 영구 저장됩니다.`
  );

  const res = await openWebAILoginSession(
    provider,
    state.settings.browserUserDataPath,
    state.settings.browserAutomationEngine
  );
  throwIfTaskCancelled(seq);
  provider.loggedIn = res.loggedIn;
  provider.lastUsedAt = new Date().toISOString();
  store.updateWebAISession(provider);
  store.addLog(res.loggedIn ? 'success' : 'warn', 'SESSION', res.message);

  return {
    ...res,
    state: store.getState(),
  };
});

ipcMain.handle('scan-local-clis', async () => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const scanned = await detectInstalledCLIs(state.webAISessions);
  throwIfTaskCancelled(seq);
  let installedCount = 0;
  for (const s of scanned) {
    if ((s.connectionType === 'local_cli' || s.id.endsWith('_cli')) && s.loggedIn) {
      installedCount++;
    }
    store.updateWebAISession(s);
  }
  store.addLog(
    'success',
    'SESSION',
    `내 PC 로컬 구독형 AI CLI 스캔 완료: 설치/연동 확인된 CLI ${installedCount}개`
  );
  return {
    installedCount,
    state: store.getState(),
  };
});

ipcMain.handle('update-web-ai-session', async (_, session) => {
  store.updateWebAISession(session);
  return store.getState();
});

ipcMain.handle('detect-aside-browser', async () => {
  return detectAside();
});

ipcMain.handle('update-settings', async (_, partial: Partial<AppDatabaseState['settings']>) => {
  store.updateSettings(partial);
  return store.getState();
});

ipcMain.handle('save-blog', async (_, blog: BlogProfile) => {
  store.upsertBlog(blog);
  syncCronJobs();
  store.addLog('info', 'SCHEDULER', `[${blog.name}] 블로그 설정 및 자동화 스케줄이 업데이트되었습니다.`, undefined, blog.id);
  return store.getState();
});

ipcMain.handle('delete-blog', async (_, blogId: string) => {
  store.deleteBlog(blogId);
  syncCronJobs();
  return store.getState();
});

ipcMain.handle('open-blog-login', async (_, blogId: string) => {
  const { seq } = beginCancellableTask();
  const state = store.getState();
  const blog = state.blogs.find((b) => b.id === blogId);
  if (!blog) throw new Error('블로그를 찾을 수 없습니다.');

  store.addLog(
    'info',
    'SESSION',
    `[${blog.name}] (${blog.platform.toUpperCase()}) 로그인 전용 브라우저 창을 엽니다.`,
    undefined,
    blog.id
  );

  const res = await openBlogPlatformLoginWindow(
    blog,
    state.settings.browserUserDataPath,
    state.settings.browserAutomationEngine
  );
  throwIfTaskCancelled(seq);
  blog.auth.sessionLoggedIn = res.loggedIn;
  blog.auth.lastLoginCheckedAt = new Date().toISOString();
  applyCapturedCredsToBlog(blog, res.capturedCreds);
  if (res.kakaoAccountHint) {
    blog.auth.kakaoAccountHint = res.kakaoAccountHint;
  }
  store.upsertBlog(blog);
  store.addLog(res.loggedIn ? 'success' : 'warn', 'SESSION', res.message, undefined, blog.id);

  return {
    ...res,
    state: store.getState(),
  };
});

ipcMain.handle('save-affiliate', async (_, item) => {
  store.upsertAffiliate(item);
  return store.getState();
});

ipcMain.handle('delete-affiliate', async (_, id: string) => {
  store.deleteAffiliate(id);
  return store.getState();
});

ipcMain.handle('run-auto-pipeline-for-blog', async (_, blogId: string) => {
  const res = await runAutomatedPipelineForBlog(blogId, 'manual');
  return {
    ...res,
    state: store.getState(),
  };
});

ipcMain.handle('open-export-folder', async () => {
  const dir = getExportDirectory();
  await shell.openPath(dir);
  return { path: dir };
});

ipcMain.handle('export-backup-json', async () => {
  const state = store.getState();
  const defaultPath = path.join(
    getExportDirectory(),
    `blogstater-backup-${toLocalDateStr(new Date())}.json`
  );
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: '블로그 자동화 전체 데이터 백업 저장',
    defaultPath,
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) {
    return { success: false, message: '백업 저장이 취소되었습니다.' };
  }
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
  store.addLog('success', 'BACKUP', `전체 데이터 백업 완료: ${path.basename(filePath)}`);
  return {
    success: true,
    filePath,
    message: `전체 데이터 백업 파일이 저장되었습니다 (${path.basename(filePath)})`,
  };
});

ipcMain.handle('import-backup-json', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: '백업 JSON 파일 불러오기 (복원)',
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) {
    return { success: false, message: '복원이 취소되었습니다.' };
  }
  try {
    const raw = fs.readFileSync(filePaths[0], 'utf-8');
    const parsed = JSON.parse(raw) as AppDatabaseState;
    if (!Array.isArray(parsed.blogs) || !Array.isArray(parsed.posts)) {
      throw new Error('올바른 BlogStater 백업 파일 형식이 아닙니다.');
    }
    store.save(parsed);
    syncCronJobs();
    store.addLog('success', 'BACKUP', `데이터 백업 복원 완료: 블로그 ${parsed.blogs.length}개, 원고 ${parsed.posts.length}건`);
    return {
      success: true,
      state: store.getState(),
      message: `백업 데이터가 성공적으로 복원되었습니다!`,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `백업 복원 실패: ${err?.message || '파일 오류'}`,
    };
  }
});

ipcMain.handle(
  'export-work-report',
  async (_, payload: { yearMonth: string; selectedDate?: string }) => {
    const state = store.getState();
    const exportDir = getExportDirectory();
    const filterPrefix = payload.selectedDate || payload.yearMonth;

    const matchingPosts = state.posts.filter((p) => {
      const pDate = toLocalDateStr(p.publishedAt || p.scheduledFor || p.createdAt);
      return pDate.startsWith(filterPrefix);
    });

    const csvRows = [
      ['날짜', '블로그명', '플랫폼', '상태', '타겟키워드', '제목', 'SEO점수', '글자수', '검색순위'].join(','),
      ...matchingPosts.map((p) => {
        const blog = state.blogs.find((b) => b.id === p.blogId);
        const dateStr = toLocalDateStr(p.publishedAt || p.scheduledFor || p.createdAt);
        const rankStr = p.rankInfo?.rank ? `${p.rankInfo.rank}위` : '미측정';
        return [
          dateStr,
          `"${(blog?.name || '블로그').replace(/"/g, '""')}"`,
          blog?.platform || '',
          p.status,
          `"${p.targetKeyword.replace(/"/g, '""')}"`,
          `"${p.title.replace(/"/g, '""')}"`,
          p.seoReport.totalScore,
          p.seoReport.charCount,
          rankStr,
        ].join(',');
      }),
    ];

    const fileName = `작업내역리포트_${filterPrefix}.csv`;
    const filePath = path.join(exportDir, fileName);
    // Add UTF-8 BOM so Excel opens Korean CSV cleanly
    fs.writeFileSync(filePath, '\uFEFF' + csvRows.join('\n'), 'utf-8');
    await shell.openPath(exportDir);

    store.addLog('success', 'BACKUP', `날짜별 작업 내역 CSV 리포트 내보내기 완료: ${fileName}`);
    return {
      success: true,
      filePath,
      message: `'${fileName}' 리포트가 생성되어 폴더가 열렸습니다! (엑셀에서 바로 열람 가능)`,
    };
  }
);
