export type BlogPlatform =
  | 'naver'
  | 'tistory'
  | 'wordpress'
  | 'velog'
  | 'medium'
  | 'ghost'
  | 'github_pages';

export type WebAIProviderId =
  | 'agy_cli'
  | 'claude_cli'
  | 'codex_cli'
  | 'gemini_cli'
  | 'copilot_cli'
  | 'chatgpt_plus'
  | 'claude_pro'
  | 'gemini_pro'
  | 'perplexity_pro'
  | 'deepseek_web'
  | 'ollama_local';

export type AutomationMode = 'full_auto' | 'semi_auto';

export type WritingStylePresetId =
  | 'friendly_neighbor'
  | 'practical_expert'
  | 'calm_briefing'
  | 'custom_clone';

export interface PersonaConfig {
  id: string;
  name: string;
  tone: string;
  targetReader: string;
  hookFormula: string;
  structureTemplate: string;
  emojiLevel: 'none' | 'minimal' | 'moderate' | 'rich';
  forbiddenWords: string[];
  signatureIntro: string;
  signatureOutro: string;
  includeComparisonTable: boolean;
  includeFaqSection: boolean;
  includeSummaryBox: boolean;
  writingStylePreset?: WritingStylePresetId;
  styleSampleText?: string;
}

export interface BlogScheduleConfig {
  enabled: boolean;
  cronExpression: string;
  scheduleMode?: 'preset' | 'custom_times';
  customTimes?: string[];
  dailyPostLimit: number;
  randomJitterMinutes?: number;
  autoScoutKeywords: boolean;
  autoGenerateThumbnail: boolean;
  autoInsertAffiliate: boolean;
  autoInternalLink: boolean;
  preferredAIProvider: WebAIProviderId;
  preferredModel?: string;
}

export interface BlogPlatformAuth {
  blogUrl: string;
  blogIdOrUsername: string;
  defaultCategory: string;
  sessionLoggedIn: boolean;
  lastLoginCheckedAt?: string;
  /** Account label (as displayed on the Kakao account picker) the user chose during manual login. Used for Tistory auto re-login. */
  kakaoAccountHint?: string;
  /** Optional login ID (Kakao email/phone or Naver ID) used to automatically re-authenticate when sessions expire. */
  loginId?: string;
  /** Transient plaintext password sent from UI on save or captured on login; immediately encrypted and cleared before persisting. */
  loginPassword?: string;
  /** DPAPI-encrypted password stored safely inside local DB JSON. */
  loginPasswordEncrypted?: string;
  /** Indicates whether an encrypted password is already stored for this blog. */
  hasSavedPassword?: boolean;
  apiUrl?: string;
  apiKeyOrToken?: string;
  localRepoPath?: string;
}

export interface BlogProfile {
  id: string;
  name: string;
  platform: BlogPlatform;
  description: string;
  nicheKeywords: string[];
  automationMode: AutomationMode;
  persona: PersonaConfig;
  schedule: BlogScheduleConfig;
  auth: BlogPlatformAuth;
  stats: {
    totalPublished: number;
    pendingReview: number;
    estimatedMonthlyViews: number;
    averageSeoScore: number;
    lastPublishedAt?: string;
  };
  createdAt: string;
}

export interface AIModelOption {
  id: string;
  label: string;
}

export interface WebAISessionInfo {
  id: WebAIProviderId;
  name: string;
  url: string;
  badge: string;
  description: string;
  loggedIn: boolean;
  lastUsedAt?: string;
  priority: number;
  enabled: boolean;
  connectionType?: 'web_browser' | 'local_cli' | 'local_api';
  cliCommand?: string;
  cliInstallCmd?: string;
  cliVersion?: string;
  availableModels?: AIModelOption[];
  selectedModel?: string;
}

export interface TrendTopic {
  id: string;
  keyword: string;
  parentSeedKeyword: string;
  source: 'google_trends' | 'naver_autocomplete' | 'google_autocomplete' | 'realtime_news' | 'ai_expansion';
  estimatedMonthlySearch: number;
  competitionRatio: number;
  goldenScore: number;
  cpcLevel: 'low' | 'medium' | 'high' | 'ultra';
  searchIntent: 'informational' | 'review' | 'comparison' | 'howto' | 'commercial';
  suggestedTitles: string[];
  recommendedBlogId?: string;
  discoveredAt: string;
  usedInPost?: boolean;
  /** User-pinned trend protected from auto-expiration and per-blog cap pruning */
  pinned?: boolean;
  /** Manually added trend protected from TTL expiration */
  isManual?: boolean;
  /** Concrete sub-topic grouping (e.g. '정책·지원금', '스펙·가성비 비교', '실전 해결 가이드', '절약·환급') */
  subCategory?: string;
  /** Why readers are actively searching for this topic right now */
  interestReason?: string;
  /** Real Naver SERP competition & opportunity signals */
  serpAnalysis?: {
    exactMatchesInTop10: number;
    stalePostsInTop10: number;
    qaForumSignalsInTop10: number;
    influencerCountInTop10: number;
    opportunityLabel: string;
  };
}

export interface CompetitorItem {
  rank: number;
  title: string;
  blogName: string;
  snippet: string;
  url: string;
}

export interface CompetitorAnalysisReport {
  keyword: string;
  analyzedAt: string;
  topCompetitors: CompetitorItem[];
  recommendedCharCount: number;
  recommendedHeadingCount: number;
  extractedSubKeywords: string[];
  competitorHeadings?: string[];
  extractedKeyFacts?: string[];
  contentGaps?: string[];
  differentiationAngle?: string;
  scrapedImageUrls?: string[];
  winningStrategyPrompt: string;
}

export interface PostRankInfo {
  checkedAt: string;
  keyword: string;
  platform: string;
  isIndexed: boolean;
  rank: number | null; // 1 ~ 30, or null if not in top 30
  matchedTitle?: string;
  matchedUrl?: string;
  summaryText: string;
}

export interface SEOCheckItem {
  id: string;
  category?: 'SEO' | 'AEO' | 'GEO' | 'DIA';
  label: string;
  passed: boolean;
  score: number;
  maxScore: number;
  detail: string;
}

export interface SEOScoreReport {
  totalScore: number;
  seoScore?: number;
  aeoScore?: number;
  geoScore?: number;
  diaScore?: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  wordCount: number;
  charCount: number;
  readingTimeMinutes: number;
  estimatedDwellSeconds: number;
  keywordDensityPercent: number;
  headingCount: { h2: number; h3: number };
  hasTable: boolean;
  hasFaq: boolean;
  internalLinkCount: number;
  affiliateLinkCount: number;
  checks: SEOCheckItem[];
  suggestions: string[];
}

export interface ThumbnailConfig {
  template: 'viral_card' | 'minimal_tech' | 'magazine_bold' | 'naver_square' | 'gradient_glass';
  aspectRatio: '1:1' | '16:9' | '4:3';
  badgeText: string;
  headline: string;
  subHeadline: string;
  footerTag: string;
  bgGradientFrom: string;
  bgGradientTo: string;
  accentColor: string;
  textColor: string;
  dataUrl?: string;
}

export interface AffiliateItem {
  id: string;
  name: string;
  platform: 'coupang' | 'aliexpress' | 'amazon' | 'custom_cpa';
  productTitle: string;
  affiliateUrl: string;
  priceText?: string;
  badgeText?: string;
  triggerKeywords: string[];
  disclosureText: string;
  ctaButtonText: string;
  clickCount: number;
  active: boolean;
}

export interface InternalLinkEntry {
  postId: string;
  blogId: string;
  title: string;
  url: string;
  keyword: string;
}

export type PostStatus =
  | 'draft'
  | 'review_pending'
  | 'scheduled'
  | 'publishing'
  | 'published'
  | 'failed';

export interface BlogPost {
  id: string;
  blogId: string;
  title: string;
  alternativeTitles: string[];
  targetKeyword: string;
  subKeywords: string[];
  category: string;
  tags: string[];
  markdownContent: string;
  htmlContent: string;
  metaDescription: string;
  thumbnail: ThumbnailConfig;
  seoReport: SEOScoreReport;
  aiProviderUsed: WebAIProviderId | string;
  status: PostStatus;
  publishedUrl?: string;
  scheduledFor?: string; // YYYY-MM-DD or ISO timestamp for calendar scheduling
  publishedAt?: string;
  errorMessage?: string;
  rankInfo?: PostRankInfo;
  internalLinksInserted: InternalLinkEntry[];
  affiliateItemsInserted: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationLog {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error';
  module: 'SCOUT' | 'WEB_AI' | 'SEO' | 'PUBLISHER' | 'SCHEDULER' | 'SESSION' | 'SERP' | 'BACKUP';
  blogId?: string;
  message: string;
  detail?: string;
}

export interface AppDatabaseState {
  blogs: BlogProfile[];
  webAISessions: WebAISessionInfo[];
  trends: TrendTopic[];
  posts: BlogPost[];
  affiliates: AffiliateItem[];
  logs: AutomationLog[];
  settings: {
    headlessBrowserForAI: boolean;
    headlessBrowserForPublish: boolean;
    defaultFallbackToSynthesis: boolean;
    concurrentTasks: number;
    browserUserDataPath: string;
    /** 'aside' = Aside AI 브라우저 독립 엔진, 'playwright' = Playwright 내장 브라우저 독립 엔진 */
    browserAutomationEngine?: 'aside' | 'playwright';
    /** 동일·유사 주제 재작성/재발행 방어 쿨타임 (기본 14일) */
    duplicateCooldownDays?: number;
  };
}
