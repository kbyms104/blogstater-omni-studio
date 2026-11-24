export * from '../electron/types';
import {
  AppDatabaseState,
  BlogPost,
  BlogProfile,
  SEOScoreReport,
  TrendTopic,
  WebAISessionInfo,
  AffiliateItem,
  CompetitorAnalysisReport,
  PostRankInfo,
} from '../electron/types';

export interface ElectronBridgeAPI {
  getState: () => Promise<AppDatabaseState>;
  scoutKeywords: (payload: {
    seedKeyword?: string;
    blogId?: string;
    includeRealtimeTrends?: boolean;
  }) => Promise<{ discovered: TrendTopic[]; allTrends: TrendTopic[] }>;
  deleteTrend: (trendId: string) => Promise<AppDatabaseState>;
  deleteTrendsBatch: (trendIds: string[]) => Promise<AppDatabaseState>;
  clearTrends: (options?: { blogId?: string; onlyUsed?: boolean }) => Promise<AppDatabaseState>;
  deduplicateTrends: () => Promise<{ removedCount: number; state: AppDatabaseState }>;
  togglePinTrend: (trendId: string) => Promise<AppDatabaseState>;
  addManualTrend: (payload: { keyword: string; blogId?: string }) => Promise<AppDatabaseState>;
  generatePost: (payload: {
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
  }) => Promise<BlogPost>;
  batchGeneratePosts: (payload: {
    blogId: string;
    keywords: string[];
    aiProviderId?: string;
    aiModelId?: string;
    scheduledFor?: string;
  }) => Promise<{ createdPosts: BlogPost[]; state: AppDatabaseState; message: string }>;
  analyzeCompetitors: (keyword: string) => Promise<CompetitorAnalysisReport>;
  extractReferenceSource: (urlOrText: string) => Promise<{
    sourceTitle: string;
    extractedSummary: string;
    extractedFacts: string[];
    suggestedKeyword: string;
  }>;
  checkPostRank: (
    postId: string
  ) => Promise<{ rankInfo: PostRankInfo; post: BlogPost; state: AppDatabaseState }>;
  checkAllPostsRank: (blogId?: string) => Promise<{
    checkedCount: number;
    indexedCount: number;
    top10Count: number;
    message: string;
    state: AppDatabaseState;
  }>;
  evaluateSeo: (payload: {
    title: string;
    targetKeyword: string;
    markdownContent: string;
    subKeywords?: string[];
    tags?: string[];
    internalLinkCount?: number;
    affiliateLinkCount?: number;
  }) => Promise<SEOScoreReport>;
  savePost: (post: BlogPost) => Promise<BlogPost>;
  deletePost: (postId: string) => Promise<AppDatabaseState>;
  polishPost: (payload: {
    postId: string;
    mode: 'boost_scores' | 'humanize_tone';
    markdownContent?: string;
  }) => Promise<{ post: BlogPost; message: string; state: AppDatabaseState }>;
  toggleInlineImages: (payload: {
    postId: string;
    markdownContent?: string;
  }) => Promise<{
    post: BlogPost;
    hasInlineImages: boolean;
    imageCount: number;
    message: string;
    state: AppDatabaseState;
  }>;
  pingIndexNow: (postId: string) => Promise<{
    success: boolean;
    pingedEngines: string[];
    timestamp: string;
    message: string;
    state: AppDatabaseState;
  }>;
  publishPost: (payload: {
    postId: string;
    openBrowserEditor?: boolean;
  }) => Promise<{
    success: boolean;
    fullyPublished: boolean;
    publishedUrl: string;
    message: string;
    exportedFolder: string;
    post: BlogPost;
    state: AppDatabaseState;
  }>;
  copyRichHtml: (payload: {
    htmlContent: string;
    markdownContent: string;
  }) => Promise<{ success: boolean; message: string }>;
  openWebAISession: (
    providerId: string
  ) => Promise<{ loggedIn: boolean; message: string; state: AppDatabaseState }>;
  scanLocalCLIs: () => Promise<{ installedCount: number; state: AppDatabaseState }>;
  updateWebAISession: (session: WebAISessionInfo) => Promise<AppDatabaseState>;
  detectAsideBrowser: () => Promise<{ installed: boolean; path?: string; version?: string }>;
  updateSettings: (partial: Partial<AppDatabaseState['settings']>) => Promise<AppDatabaseState>;
  saveBlog: (blog: BlogProfile) => Promise<AppDatabaseState>;
  deleteBlog: (blogId: string) => Promise<AppDatabaseState>;
  openBlogLogin: (
    blogId: string
  ) => Promise<{ loggedIn: boolean; message: string; state: AppDatabaseState }>;
  saveAffiliate: (item: AffiliateItem) => Promise<AppDatabaseState>;
  deleteAffiliate: (id: string) => Promise<AppDatabaseState>;
  runAutoPipelineForBlog: (
    blogId: string
  ) => Promise<{ success: boolean; post?: BlogPost; message: string; state: AppDatabaseState }>;
  openExportFolder: () => Promise<{ path: string }>;
  exportBackupJson: () => Promise<{ success: boolean; filePath?: string; message: string }>;
  importBackupJson: () => Promise<{
    success: boolean;
    state?: AppDatabaseState;
    message: string;
  }>;
  exportWorkReport: (payload: {
    yearMonth: string;
    selectedDate?: string;
  }) => Promise<{ success: boolean; filePath?: string; message: string }>;
  cancelActiveTask: () => Promise<{
    cancelled: boolean;
    message: string;
    state: AppDatabaseState;
  }>;
  onStatePushed: (callback: (state: AppDatabaseState) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronBridgeAPI;
  }
}
