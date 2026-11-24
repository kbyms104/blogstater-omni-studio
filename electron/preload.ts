import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getState: () => ipcRenderer.invoke('get-state'),
  scoutKeywords: (payload: { seedKeyword?: string; blogId?: string; includeRealtimeTrends?: boolean }) =>
    ipcRenderer.invoke('scout-keywords', payload),
  deleteTrend: (trendId: string) => ipcRenderer.invoke('delete-trend', trendId),
  deleteTrendsBatch: (trendIds: string[]) => ipcRenderer.invoke('delete-trends-batch', trendIds),
  clearTrends: (options?: { blogId?: string; onlyUsed?: boolean }) =>
    ipcRenderer.invoke('clear-trends', options),
  deduplicateTrends: () => ipcRenderer.invoke('deduplicate-trends'),
  togglePinTrend: (trendId: string) => ipcRenderer.invoke('toggle-pin-trend', trendId),
  addManualTrend: (payload: { keyword: string; blogId?: string }) =>
    ipcRenderer.invoke('add-manual-trend', payload),
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
  }) => ipcRenderer.invoke('generate-post', payload),
  batchGeneratePosts: (payload: {
    blogId: string;
    keywords: string[];
    aiProviderId?: string;
    aiModelId?: string;
    scheduledFor?: string;
  }) => ipcRenderer.invoke('batch-generate-posts', payload),
  analyzeCompetitors: (keyword: string) => ipcRenderer.invoke('analyze-competitors', keyword),
  extractReferenceSource: (urlOrText: string) =>
    ipcRenderer.invoke('extract-reference-source', urlOrText),
  checkPostRank: (postId: string) => ipcRenderer.invoke('check-post-rank', postId),
  checkAllPostsRank: (blogId?: string) => ipcRenderer.invoke('check-all-posts-rank', blogId),
  evaluateSeo: (payload: {
    title: string;
    targetKeyword: string;
    markdownContent: string;
    subKeywords?: string[];
    tags?: string[];
    internalLinkCount?: number;
    affiliateLinkCount?: number;
  }) => ipcRenderer.invoke('evaluate-seo', payload),
  savePost: (post: any) => ipcRenderer.invoke('save-post', post),
  deletePost: (postId: string) => ipcRenderer.invoke('delete-post', postId),
  polishPost: (payload: {
    postId: string;
    mode: 'boost_scores' | 'humanize_tone';
    markdownContent?: string;
  }) => ipcRenderer.invoke('polish-post', payload),
  toggleInlineImages: (payload: { postId: string; markdownContent?: string }) =>
    ipcRenderer.invoke('toggle-inline-images', payload),
  pingIndexNow: (postId: string) => ipcRenderer.invoke('ping-index-now', postId),
  publishPost: (payload: { postId: string; openBrowserEditor?: boolean }) =>
    ipcRenderer.invoke('publish-post', payload),
  copyRichHtml: (payload: { htmlContent: string; markdownContent: string }) =>
    ipcRenderer.invoke('copy-rich-html', payload),
  openWebAISession: (providerId: string) => ipcRenderer.invoke('open-web-ai-session', providerId),
  scanLocalCLIs: () => ipcRenderer.invoke('scan-local-clis'),
  updateWebAISession: (session: any) => ipcRenderer.invoke('update-web-ai-session', session),
  detectAsideBrowser: () => ipcRenderer.invoke('detect-aside-browser'),
  updateSettings: (partial: any) => ipcRenderer.invoke('update-settings', partial),
  saveBlog: (blog: any) => ipcRenderer.invoke('save-blog', blog),
  deleteBlog: (blogId: string) => ipcRenderer.invoke('delete-blog', blogId),
  openBlogLogin: (blogId: string) => ipcRenderer.invoke('open-blog-login', blogId),
  saveAffiliate: (item: any) => ipcRenderer.invoke('save-affiliate', item),
  deleteAffiliate: (id: string) => ipcRenderer.invoke('delete-affiliate', id),
  runAutoPipelineForBlog: (blogId: string) => ipcRenderer.invoke('run-auto-pipeline-for-blog', blogId),
  openExportFolder: () => ipcRenderer.invoke('open-export-folder'),
  exportBackupJson: () => ipcRenderer.invoke('export-backup-json'),
  importBackupJson: () => ipcRenderer.invoke('import-backup-json'),
  exportWorkReport: (payload: { yearMonth: string; selectedDate?: string }) =>
    ipcRenderer.invoke('export-work-report', payload),
  cancelActiveTask: () => ipcRenderer.invoke('cancel-active-task'),
  onStatePushed: (callback: (state: any) => void) => {
    const handler = (_: any, newState: any) => callback(newState);
    ipcRenderer.on('state-pushed', handler);
    return () => ipcRenderer.removeListener('state-pushed', handler);
  },
});
