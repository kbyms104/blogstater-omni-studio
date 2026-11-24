import React, { useEffect, useState } from 'react';
import {
  AppDatabaseState,
  BlogPlatform,
  BlogPost,
  BlogProfile,
  BlogScheduleConfig,
  ThumbnailConfig,
  WebAIProviderId,
  AffiliateItem,
  CompetitorAnalysisReport,
} from './types';
import { ThumbnailCanvas } from './components/ThumbnailCanvas';
import { WorkCalendarView } from './components/WorkCalendarView';
import {
  Sliders,
  Flame,
  LayoutDashboard,
  Globe,
  PenTool,
  Image as ImageIcon,
  Send,
  DollarSign,
  Cpu,
  CheckCircle2,
  AlertCircle,
  Play,
  Copy,
  RefreshCw,
  Plus,
  Trash2,
  ExternalLink,
  Search,
  Eye,
  FileCode,
  TrendingUp,
  Clock,
  ShieldCheck,
  Zap,
  FolderOpen,
  Settings,
  CheckSquare,
  LogIn,
  Calendar as CalendarIcon,
  Download,
  Upload,
  Award,
  ChevronDown,
  ChevronRight,
  X,
  ArrowRight,
  Terminal,
  Pin,
} from 'lucide-react';

type NavTab =
  | 'dashboard'
  | 'scout'
  | 'studio'
  | 'queue'
  | 'blogs'
  | 'ai_sessions';

const PLATFORM_META: Record<
  BlogPlatform,
  { label: string; color: string; badgeBg: string; urlPlaceholder: string }
> = {
  naver: {
    label: '네이버 블로그',
    color: 'text-emerald-700',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    urlPlaceholder: 'https://blog.naver.com/내아이디',
  },
  tistory: {
    label: '티스토리',
    color: 'text-orange-700',
    badgeBg: 'bg-orange-50 text-orange-700 border-orange-200',
    urlPlaceholder: 'https://내블로그.tistory.com',
  },
  wordpress: {
    label: '워드프레스',
    color: 'text-blue-700',
    badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    urlPlaceholder: 'https://내도메인.com',
  },
  velog: {
    label: '벨로그 (Velog)',
    color: 'text-teal-700',
    badgeBg: 'bg-teal-50 text-teal-700 border-teal-200',
    urlPlaceholder: 'https://velog.io/@내아이디',
  },
  medium: {
    label: 'Medium',
    color: 'text-slate-800',
    badgeBg: 'bg-slate-100 text-slate-800 border-slate-300',
    urlPlaceholder: 'https://medium.com/@내아이디',
  },
  ghost: {
    label: 'Ghost CMS',
    color: 'text-violet-700',
    badgeBg: 'bg-violet-50 text-violet-700 border-violet-200',
    urlPlaceholder: 'https://내블로그.ghost.io',
  },
  github_pages: {
    label: 'GitHub Pages',
    color: 'text-sky-700',
    badgeBg: 'bg-sky-50 text-sky-700 border-sky-200',
    urlPlaceholder: 'https://내아이디.github.io',
  },
};

const SCHEDULE_PRESETS = [
  { value: '0 9,20 * * *', label: '하루 2회 (09시, 20시)' },
  { value: '0 9,14,21 * * *', label: '하루 3회 (09, 14, 21시)' },
  { value: '0 10 * * *', label: '하루 1회 (오전 10시)' },
  { value: '0 */3 * * *', label: '3시간마다 자동 실행' },
  { value: '0 */1 * * *', label: '1시간마다 자동 실행' },
] as const;

const QUICK_TIME_PRESETS = ['07:30', '08:30', '10:00', '12:30', '15:00', '18:30', '20:30', '22:00'] as const;

function normalizeHHMM(raw: string): string | null {
  const m = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${String(parseInt(m[2], 10)).padStart(2, '0')}`;
}

function extractTimesFromCron(cronExpr: string): string[] {
  const m = (cronExpr || '').trim().match(/^(\d{1,2})\s+(\d{1,2}(?:,\d{1,2})*)\s+\*\s+\*\s+\*$/);
  if (!m) return [];
  const minVal = parseInt(m[1], 10);
  if (!Number.isFinite(minVal) || minVal < 0 || minVal > 59) return [];
  const minPad = String(minVal).padStart(2, '0');
  const seen = new Set<string>();
  const times: string[] = [];
  for (const rawHour of m[2].split(',')) {
    const hVal = parseInt(rawHour, 10);
    if (!Number.isFinite(hVal) || hVal < 0 || hVal > 23) continue;
    const hhmm = `${String(hVal).padStart(2, '0')}:${minPad}`;
    if (!seen.has(hhmm)) {
      seen.add(hhmm);
      times.push(hhmm);
    }
  }
  return times.sort();
}

function customTimesToCronPreview(times: string[]): string {
  const normalized = times.map(normalizeHHMM).filter((t): t is string => Boolean(t)).sort();
  if (normalized.length === 0) return '0 9,20 * * *';
  const [hh, mm] = normalized[0].split(':').map((v) => parseInt(v, 10));
  return `${mm} ${hh} * * *`;
}

function formatScheduleSummary(schedule: BlogScheduleConfig): string {
  const jitterMin = schedule.randomJitterMinutes ?? 20;
  const jitterLabel = jitterMin <= 0 ? '정각' : `+최대 ${jitterMin}분`;
  if (schedule.scheduleMode === 'custom_times' && schedule.customTimes && schedule.customTimes.length > 0) {
    const sorted = [...schedule.customTimes].sort();
    return `매일 ${sorted.join(', ')} (${jitterLabel})`;
  }
  const preset = SCHEDULE_PRESETS.find((p) => p.value === schedule.cronExpression);
  if (preset) {
    return `${preset.label} (${jitterLabel})`;
  }
  const parsed = extractTimesFromCron(schedule.cronExpression);
  if (parsed.length > 0) {
    return `매일 ${parsed.join(', ')} (${jitterLabel})`;
  }
  return `${schedule.cronExpression} (${jitterLabel})`;
}

function toLocalDateStr(isoOrDate?: string): string {
  if (!isoOrDate) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return isoOrDate.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [state, setState] = useState<AppDatabaseState | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(
    null
  );
  const [asideStatus, setAsideStatus] = useState<{
    installed: boolean;
    path?: string;
    version?: string;
  } | null>(null);
  const taskRunIdRef = React.useRef<number>(0);

  // Selected Blog & Active Post in Studio
  const [selectedBlogId, setSelectedBlogId] = useState<string>('');
  const [currentPost, setCurrentPost] = useState<BlogPost | null>(null);

  // Sub-views inside combined workspaces for cleaner navigation
  const [studioViewMode, setStudioViewMode] = useState<'preview' | 'markdown' | 'thumbnail'>(
    'preview'
  );
  const [queueSubView, setQueueSubView] = useState<'list' | 'calendar'>('list');
  const [blogsSubView, setBlogsSubView] = useState<'profiles' | 'affiliates'>('profiles');

  // Keyword Scout & Batch state
  const [seedInput, setSeedInput] = useState<string>('');
  const [scoutFilterBlogId, setScoutFilterBlogId] = useState<string>('all');
  const [selectedBatchKeywords, setSelectedBatchKeywords] = useState<string[]>([]);
  const [scoutSearchQuery, setScoutSearchQuery] = useState<string>('');
  const [scoutStatusFilter, setScoutStatusFilter] = useState<'all' | 'unused' | 'used'>('all');
  const [scoutSubCategoryFilter, setScoutSubCategoryFilter] = useState<string>('all');
  const [scoutSortBy, setScoutSortBy] = useState<
    'goldenScore' | 'searchVolume' | 'lowCompetition' | 'newest'
  >('goldenScore');
  const [manualKeywordInput, setManualKeywordInput] = useState<string>('');
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  const [competitorReport, setCompetitorReport] = useState<CompetitorAnalysisReport | null>(null);

  // Studio Generation Form state
  const [studioKeyword, setStudioKeyword] = useState<string>('');
  const [studioTitle, setStudioTitle] = useState<string>('');
  const [newTagInput, setNewTagInput] = useState<string>('');
  const [studioAIProvider, setStudioAIProvider] = useState<WebAIProviderId>('agy_cli');
  const [studioAIModel, setStudioAIModel] = useState<string>('');
  const [studioCustomPrompt, setStudioCustomPrompt] = useState<string>('');
  const [showCustomPromptInput, setShowCustomPromptInput] = useState<boolean>(false);
  const [studioReferenceSource, setStudioReferenceSource] = useState<string>('');
  const [showReferenceSourceInput, setShowReferenceSourceInput] = useState<boolean>(false);
  const [extractedRefInfo, setExtractedRefInfo] = useState<{
    sourceTitle: string;
    extractedFacts: string[];
  } | null>(null);

  // Thumbnail state
  const [thumbnailConfig, setThumbnailConfig] = useState<ThumbnailConfig>({
    template: 'viral_card',
    aspectRatio: '1:1',
    badgeText: '2026 핵심 요약 가이드',
    headline: '대표 썸네일 제목을 입력하세요',
    subHeadline: '핵심 비교표 & 3단계 실전 체크리스트',
    footerTag: '@Official Blog',
    bgGradientFrom: '#047857',
    bgGradientTo: '#064e3b',
    accentColor: '#34d399',
    textColor: '#ffffff',
  });

  // Blog Editor Modal state (Basic vs Advanced tabs)
  const [editingBlog, setEditingBlog] = useState<BlogProfile | null>(null);
  const [blogModalTab, setBlogModalTab] = useState<'basic' | 'advanced'>('basic');
  const [nicheInputRaw, setNicheInputRaw] = useState<string>('');
  const [customTimeInput, setCustomTimeInput] = useState<string>('09:30');

  const openEditBlogModal = (blog: BlogProfile) => {
    setNicheInputRaw(blog.nicheKeywords.join(', '));
    setBlogModalTab('basic');
    setCustomTimeInput(blog.schedule.customTimes?.[0] || '09:30');
    setEditingBlog({
      ...blog,
      auth: {
        ...blog.auth,
        loginPassword: '',
      },
    });
  };

  const applyCustomScheduleTimes = (nextTimesRaw: string[]) => {
    const unique = Array.from(
      new Set(nextTimesRaw.map(normalizeHHMM).filter((t): t is string => Boolean(t)))
    ).sort();
    setEditingBlog((prev) =>
      prev
        ? {
            ...prev,
            schedule: {
              ...prev.schedule,
              scheduleMode: 'custom_times',
              customTimes: unique,
              cronExpression: customTimesToCronPreview(unique),
              dailyPostLimit: Math.max(1, unique.length || prev.schedule.dailyPostLimit || 1),
            },
          }
        : prev
    );
  };

  const handleAddCustomScheduleTime = (rawTime: string) => {
    const hhmm = normalizeHHMM(rawTime);
    if (!hhmm || !editingBlog) {
      showToast('올바른 시간 형식(HH:MM)을 선택해주세요.', 'error');
      return;
    }
    const existing = editingBlog.schedule.customTimes || [];
    if (existing.includes(hhmm)) {
      showToast(`${hhmm} 시각은 이미 등록되어 있습니다.`, 'info');
      return;
    }
    applyCustomScheduleTimes([...existing, hhmm]);
  };

  const handleRemoveCustomScheduleTime = (hhmm: string) => {
    if (!editingBlog) return;
    const existing = editingBlog.schedule.customTimes || [];
    if (existing.length <= 1) {
      showToast('자동 발행을 위해 최소 1개 이상의 시각이 필요합니다.', 'info');
      return;
    }
    applyCustomScheduleTimes(existing.filter((t) => t !== hhmm));
  };

  const handleToggleQuickScheduleTime = (hhmm: string) => {
    if (!editingBlog) return;
    const existing = editingBlog.schedule.customTimes || [];
    if (existing.includes(hhmm)) {
      if (existing.length <= 1) {
        showToast('최소 1개 이상의 발행 시각을 유지해야 합니다.', 'info');
        return;
      }
      applyCustomScheduleTimes(existing.filter((t) => t !== hhmm));
    } else {
      applyCustomScheduleTimes([...existing, hhmm]);
    }
  };

  // Affiliate Form state
  const [newAffName, setNewAffName] = useState('');
  const [newAffProduct, setNewAffProduct] = useState('');
  const [newAffUrl, setNewAffUrl] = useState('');
  const [newAffKeywords, setNewAffKeywords] = useState('');

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'success') => {
    setToast({ text, type });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4200);
  };

  const syncStudioAIForBlog = (blogId: string, blogsOverride?: BlogProfile[]) => {
    const blogList = blogsOverride || state?.blogs || [];
    const targetBlog = blogList.find((b) => b.id === blogId);
    if (targetBlog) {
      setStudioAIProvider(targetBlog.schedule.preferredAIProvider);
      setStudioAIModel(targetBlog.schedule.preferredModel || '');
    }
  };

  const refreshState = async () => {
    if (!window.electronAPI) return;
    const data = await window.electronAPI.getState();
    setState(data);
    let activeId = selectedBlogId;
    if (!activeId && data.blogs.length > 0) {
      activeId = data.blogs[0].id;
      setSelectedBlogId(activeId);
      syncStudioAIForBlog(activeId, data.blogs);
    }
    if (!currentPost && data.posts.length > 0) {
      const matchingPost = data.posts.find((p) => p.blogId === activeId) || data.posts[0];
      setCurrentPost(matchingPost);
      if (matchingPost.blogId && matchingPost.blogId !== activeId) {
        setSelectedBlogId(matchingPost.blogId);
        syncStudioAIForBlog(matchingPost.blogId, data.blogs);
      }
      if (matchingPost.thumbnail) {
        setThumbnailConfig(matchingPost.thumbnail);
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    refreshState();
    window.electronAPI?.detectAsideBrowser?.().then(setAsideStatus).catch(() => {});
    if (window.electronAPI?.onStatePushed) {
      const unsubscribe = window.electronAPI.onStatePushed((pushedState) => {
        setState(pushedState);
      });
      return unsubscribe;
    }
  }, []);

  const handleCancelActiveTask = async () => {
    taskRunIdRef.current += 1;
    setBusyMessage(null);
    try {
      const res = await window.electronAPI.cancelActiveTask();
      if (res?.state) {
        setState(res.state);
      }
      showToast(res?.message || '진행 중인 작업이 즉시 중단되었습니다.', 'info');
    } catch {
      showToast('진행 중인 작업이 즉시 중단되었습니다.', 'info');
    }
  };

  useEffect(() => {
    if (!busyMessage) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void handleCancelActiveTask();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busyMessage]);

  const isCancelledError = (err: any) =>
    typeof err?.message === 'string' && err.message.includes('TASK_CANCELLED');

  const formatDateTimeKo = (iso?: string): string => {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}.${mm}.${dd} ${hh}:${min}`;
  };

  // Handlers
  const openPostInStudio = (post: BlogPost, switchTab: boolean = true) => {
    setCurrentPost(post);
    if (post.blogId) {
      setSelectedBlogId(post.blogId);
      syncStudioAIForBlog(post.blogId);
    }
    if (post.thumbnail) {
      setThumbnailConfig(post.thumbnail);
    }
    setStudioKeyword(post.targetKeyword);
    setStudioViewMode('preview');
    if (switchTab) {
      setActiveTab('studio');
    }
  };

  const handleRunAutoPipeline = async (blogId: string): Promise<boolean> => {
    const myRunId = ++taskRunIdRef.current;
    const blog = state?.blogs.find((b) => b.id === blogId);
    const hasUnusedKeyword = Boolean(
      state?.trends.some((t) => !t.usedInPost && t.recommendedBlogId === blogId)
    );
    setBusyMessage(
      hasUnusedKeyword
        ? `[${blog?.name || '블로그'}] 발굴된 미사용 황금 키워드 적용 → AI 원고 작성 → 썸네일 생성 파이프라인 가동 중...`
        : `[${blog?.name || '블로그'}] 황금 키워드 신규 발굴 → AI 원고 작성 → 썸네일 생성 파이프라인 가동 중...`
    );
    try {
      const res = await window.electronAPI.runAutoPipelineForBlog(blogId);
      if (myRunId !== taskRunIdRef.current) return false;
      setState(res.state);
      if (res.post) {
        openPostInStudio(res.post, false);
      }
      showToast(res.message, 'success');
      return true;
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return false;
      showToast(err?.message || '파이프라인 실행 중 오류가 발생했습니다.', 'error');
      return false;
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleScoutKeywords = async (customSeed?: string, targetBlogId?: string) => {
    const myRunId = ++taskRunIdRef.current;
    const effectiveBlogId = targetBlogId || scoutFilterBlogId || 'all';
    const targetBlog =
      effectiveBlogId !== 'all'
        ? state?.blogs.find((b) => b.id === effectiveBlogId)
        : undefined;
    setBusyMessage(
      effectiveBlogId === 'all' && (state?.blogs.length || 0) > 0
        ? `등록된 전체 블로그(${state?.blogs.length}개)별로 대주제 맞춤 실시간 소주제 분해 & 네이버 SERP 경쟁도 실측 중...`
        : `[${targetBlog?.name || '블로그'}] 실시간 자동완성·뉴스 수집 후 AI 소주제 분해 & 네이버 SERP 경쟁도 실측 중...`
    );
    try {
      const res = await window.electronAPI.scoutKeywords({
        seedKeyword: customSeed ?? seedInput,
        blogId: effectiveBlogId,
        includeRealtimeTrends: true,
      });
      if (myRunId !== taskRunIdRef.current) return;
      await refreshState();
      showToast(
        effectiveBlogId === 'all' && (state?.blogs.length || 0) > 1
          ? `전체 ${state?.blogs.length}개 블로그별로 중복 없는 신규 황금 소주제 총 ${res.discovered.length}건을 발굴했습니다!`
          : `중복 없는 신규 황금 소주제 ${res.discovered.length}건을 실시간 발굴했습니다!`,
        'success'
      );
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '키워드 발굴 중 오류 발생', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleGenerateInStudio = async (forceGenerate: boolean = false) => {
    if (!studioKeyword.trim()) {
      showToast('작성할 타겟 키워드를 입력해주세요.', 'error');
      return;
    }
    const targetBlog =
      state?.blogs.find((b) => b.id === selectedBlogId) || state?.blogs[0];
    if (!targetBlog) {
      showToast('먼저 운영하실 블로그를 등록해주세요!', 'info');
      handleCreateNewBlogTemplate();
      return;
    }

    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(
      `[${targetBlog.name}] 맞춤형 문체로 2,500자+ SEO 원고 및 썸네일 생성 중...`
    );
    try {
      const created = await window.electronAPI.generatePost({
        blogId: targetBlog.id,
        keyword: studioKeyword,
        preferredTitle: studioTitle || undefined,
        aiProviderId: studioAIProvider,
        aiModelId: studioAIModel || undefined,
        customInstructions: studioCustomPrompt || undefined,
        referenceSourceUrlOrText: studioReferenceSource || undefined,
        forceGenerate,
      });
      if (myRunId !== taskRunIdRef.current) return;
      setCurrentPost(created);
      setThumbnailConfig(created.thumbnail);
      setStudioTitle('');
      setStudioViewMode('preview');
      await refreshState();
      showToast(
        `원고 생성 완료! (SEO 점수: ${created.seoReport.totalScore}점 / ${created.seoReport.grade}등급)`,
        'success'
      );
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '원고 생성 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleSaveCurrentPost = async (updatedPost: BlogPost) => {
    const saved = await window.electronAPI.savePost(updatedPost);
    setCurrentPost(saved);
    await refreshState();
    showToast('포스팅 내용 및 SEO 점수가 저장되었습니다.', 'success');
  };

  const handleCopyRichHtml = async (post: BlogPost) => {
    const res = await window.electronAPI.copyRichHtml({
      htmlContent: post.htmlContent,
      markdownContent: post.markdownContent,
    });
    showToast(res.message, 'success');
  };

  const handlePublishPost = async (post: BlogPost, openBrowserEditor: boolean) => {
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(
      openBrowserEditor
        ? `브라우저 에디터를 열어 [${post.title}] 자동 입력 및 발행을 진행합니다...`
        : `[${post.title}] 자동 발행 및 로컬 패키지 저장을 진행합니다...`
    );
    try {
      const res = await window.electronAPI.publishPost({
        postId: post.id,
        openBrowserEditor,
      });
      if (myRunId !== taskRunIdRef.current) return;
      setState(res.state);
      setCurrentPost(res.post);
      showToast(res.message, 'success');
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '발행 중 오류 발생', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleOpenWebAISession = async (providerId: string) => {
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(
      'AI 로그인/설치 창이 열렸습니다. 완료 후 창을 닫으면 연결 상태가 저장됩니다...'
    );
    try {
      const res = await window.electronAPI.openWebAISession(providerId);
      if (myRunId !== taskRunIdRef.current) return;
      setState(res.state);
      showToast(res.message, 'success');
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '연결 실행 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleOpenBlogLogin = async (blogId: string) => {
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(
      '블로그 로그인 브라우저 창이 열렸습니다. 로그인 후 창을 닫으면 세션이 저장됩니다...'
    );
    try {
      const res = await window.electronAPI.openBlogLogin(blogId);
      if (myRunId !== taskRunIdRef.current) return;
      setState(res.state);
      showToast(res.message, 'success');
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '블로그 로그인 창 실행 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleAnalyzeCompetitors = async (kw: string) => {
    if (!kw.trim()) {
      showToast('분석할 타겟 키워드를 먼저 입력해주세요.', 'error');
      return;
    }
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(`'${kw}' 상위 1~5위 경쟁 블로그 글 분석 및 필승 전략 추출 중...`);
    try {
      const report = await window.electronAPI.analyzeCompetitors(kw);
      if (myRunId !== taskRunIdRef.current) return;
      setCompetitorReport(report);
      setStudioCustomPrompt(report.winningStrategyPrompt);
      await refreshState();
      showToast(
        `상위 경쟁글 분석 완료! 권장 글자수(${(report.recommendedCharCount || 2200).toLocaleString()}자)와 서브 키워드가 자동 적용되었습니다.`,
        'success'
      );
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '경쟁글 분석 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleBatchGenerate = async () => {
    if (selectedBatchKeywords.length === 0) {
      showToast('일괄 생성할 키워드를 1개 이상 선택해주세요.', 'error');
      return;
    }
    if (!state?.blogs || state.blogs.length === 0) {
      showToast('먼저 운영하실 블로그를 등록해주세요!', 'info');
      handleCreateNewBlogTemplate();
      return;
    }
    const targetBlog =
      scoutFilterBlogId !== 'all'
        ? state.blogs.find((b) => b.id === scoutFilterBlogId)
        : undefined;
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(
      targetBlog
        ? `[${targetBlog.name}] 선택된 ${selectedBatchKeywords.length}개 키워드 연속 원고 생성 중...`
        : `선택된 ${selectedBatchKeywords.length}개 키워드를 각 블로그별로 연속 원고 생성 중...`
    );
    try {
      const res = await window.electronAPI.batchGeneratePosts({
        blogId: targetBlog ? targetBlog.id : 'all',
        keywords: selectedBatchKeywords,
        aiProviderId:
          targetBlog && targetBlog.id === selectedBlogId ? studioAIProvider : undefined,
        aiModelId:
          targetBlog && targetBlog.id === selectedBlogId
            ? studioAIModel || undefined
            : undefined,
      });
      if (myRunId !== taskRunIdRef.current) return;
      setState(res.state);
      if (res.createdPosts.length > 0) {
        setCurrentPost(res.createdPosts[0]);
        setThumbnailConfig(res.createdPosts[0].thumbnail);
      }
      setSelectedBatchKeywords([]);
      showToast(res.message, 'success');
      setQueueSubView('list');
      setActiveTab('queue');
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '일괄 생성 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleCheckPostRank = async (postId: string) => {
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage('네이버 검색 결과에서 내 블로그 글 노출 순위를 확인 중입니다...');
    try {
      const res = await window.electronAPI.checkPostRank(postId);
      if (myRunId !== taskRunIdRef.current) return;
      setState(res.state);
      if (currentPost?.id === postId) {
        setCurrentPost(res.post);
      }
      showToast(res.rankInfo.summaryText, 'info');
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '순위 조회 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleCreatePostForDate = async (
    blogId: string,
    keyword: string,
    dateStr: string
  ) => {
    const myRunId = ++taskRunIdRef.current;
    setBusyMessage(`[${dateStr}] 날짜 배정 원고 생성 중: '${keyword}'...`);
    try {
      const created = await window.electronAPI.generatePost({
        blogId,
        keyword,
        scheduledFor: dateStr,
      });
      if (myRunId !== taskRunIdRef.current) return;
      setCurrentPost(created);
      setThumbnailConfig(created.thumbnail);
      await refreshState();
      showToast(`${dateStr} 날짜로 '${created.title}' 원고가 생성되었습니다!`, 'success');
    } catch (err: any) {
      if (myRunId !== taskRunIdRef.current || isCancelledError(err)) return;
      showToast(err?.message || '원고 생성 실패', 'error');
    } finally {
      if (myRunId === taskRunIdRef.current) {
        setBusyMessage(null);
      }
    }
  };

  const handleExportReport = async (yearMonth: string, selectedDate?: string) => {
    try {
      const res = await window.electronAPI.exportWorkReport({ yearMonth, selectedDate });
      if (res.success) {
        await refreshState();
        showToast(res.message, 'success');
      }
    } catch (err: any) {
      showToast(err?.message || '리포트 내보내기 실패', 'error');
    }
  };

  const handleBackupExport = async () => {
    const res = await window.electronAPI.exportBackupJson();
    if (res.success) {
      await refreshState();
      showToast(res.message, 'success');
    }
  };

  const handleBackupImport = async () => {
    const res = await window.electronAPI.importBackupJson();
    if (res.success && res.state) {
      setState(res.state);
      showToast(res.message, 'success');
    } else if (res.message) {
      showToast(res.message, 'info');
    }
  };

  const handleCreateNewBlogTemplate = () => {
    const newBlog: BlogProfile = {
      id: `blog-${Date.now()}`,
      name: '',
      platform: 'naver',
      description: '',
      nicheKeywords: [],
      automationMode: 'semi_auto',
      persona: {
        id: `persona-${Date.now()}`,
        name: '친절하고 꼼꼼한 전문 에디터',
        tone: '친근하고 신뢰감 있는 존댓말 (~해요, ~정리해 드립니다)',
        targetReader: '실질적인 핵심 정보와 비교표를 원하는 독자층',
        hookFormula: '독자가 모르면 손해 보는 핵심 포인트와 3줄 요약으로 시작',
        structureTemplate: '핵심 요약 → 조건/배경 → 비교표 → 3단계 방법 → FAQ',
        emojiLevel: 'none',
        forbiddenWords: ['무조건', '100% 보장'],
        signatureIntro: '안녕하세요! 반갑습니다 :)',
        signatureOutro: '오늘 정리해 드린 내용이 도움 되셨기를 바랍니다. 궁금한 점은 편하게 댓글 남겨주세요!',
        includeComparisonTable: true,
        includeFaqSection: true,
        includeSummaryBox: true,
      },
      schedule: {
        enabled: true,
        cronExpression: '0 9,20 * * *',
        scheduleMode: 'preset',
        customTimes: ['09:00', '20:00'],
        dailyPostLimit: 2,
        randomJitterMinutes: 20,
        autoScoutKeywords: true,
        autoGenerateThumbnail: true,
        autoInsertAffiliate: true,
        autoInternalLink: true,
        preferredAIProvider: 'agy_cli',
        preferredModel: 'gemini-4-argon-high',
      },
      auth: {
        blogUrl: '',
        blogIdOrUsername: '',
        defaultCategory: '',
        sessionLoggedIn: false,
      },
      stats: {
        totalPublished: 0,
        pendingReview: 0,
        estimatedMonthlyViews: 0,
        averageSeoScore: 92,
      },
      createdAt: new Date().toISOString(),
    };
    openEditBlogModal(newBlog);
  };

  if (loading || !state) {
    return (
      <div className="h-screen w-screen bg-[#F8FAFC] flex items-center justify-center text-slate-700">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-7 h-7 text-slate-900 animate-spin" />
          <p className="text-sm font-semibold">BlogStater Omni Studio 로딩 중...</p>
        </div>
      </div>
    );
  }

  const activeBlog =
    state.blogs.find((b) => b.id === selectedBlogId) || state.blogs[0] || null;
  const readyAICount = state.webAISessions.filter((s) => s.loggedIn).length;
  const scheduledBlogCount = state.blogs.filter((b) => b.schedule.enabled).length;
  const todayIso = toLocalDateStr(new Date().toISOString());

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#F8FAFC] text-slate-900 flex select-none font-sans">
      {/* Global Busy Overlay */}
      {busyMessage && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-[2px] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 shadow-xl flex flex-col items-center text-center gap-4">
            <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-slate-900 animate-spin" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-bold text-slate-900 tracking-tight">자동화 작업 진행 중</h3>
              <p className="text-xs text-slate-600 leading-relaxed">{busyMessage}</p>
            </div>
            <button
              type="button"
              onClick={handleCancelActiveTask}
              className="mt-1 px-4 py-2 rounded-lg bg-rose-50 hover:bg-rose-600 text-rose-700 hover:text-white border border-rose-200 text-xs font-bold flex items-center gap-2 transition shadow-sm"
            >
              <X className="w-4 h-4" />
              작업 즉시 중단 (ESC)
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md">
          <div
            className={`px-4 py-3 rounded-lg border shadow-lg flex items-center gap-2.5 text-xs font-semibold ${
              toast.type === 'error'
                ? 'bg-rose-600 border-rose-700 text-white'
                : toast.type === 'info'
                ? 'bg-slate-900 border-slate-800 text-white'
                : 'bg-slate-900 border-slate-800 text-white'
            }`}
          >
            <CheckCircle2
              className={`w-4 h-4 shrink-0 ${
                toast.type === 'error'
                  ? 'text-white'
                  : toast.type === 'info'
                  ? 'text-sky-400'
                  : 'text-emerald-400'
              }`}
            />
            <span>{toast.text}</span>
          </div>
        </div>
      )}

      {/* ==================== BLOG CREATE / EDIT MODAL DIALOG ==================== */}
      {editingBlog && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Globe className="w-5 h-5 text-slate-700" />
                <h3 className="text-base font-bold text-slate-900 tracking-tight">
                  {editingBlog.name ? `${editingBlog.name} 설정` : '새 블로그 간편 등록'}
                </h3>
              </div>
              <button
                onClick={() => setEditingBlog(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Sub-Tabs: Basic (3 fields) vs Advanced (Persona & Schedule) */}
            <div className="px-6 pt-3 bg-slate-50/50 border-b border-slate-200 flex gap-2">
              <button
                onClick={() => setBlogModalTab('basic')}
                className={`px-4 py-2 text-xs font-bold border-b-2 transition ${
                  blogModalTab === 'basic'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                1. 필수 기본 정보 (3초 등록)
              </button>
              <button
                onClick={() => setBlogModalTab('advanced')}
                className={`px-4 py-2 text-xs font-bold border-b-2 transition ${
                  blogModalTab === 'advanced'
                    ? 'border-slate-900 text-slate-900'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                2. AI 문체 페르소나 & 스케줄 상세 설정
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1 bg-white">
              {blogModalTab === 'basic' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        블로그 별칭 (이름) *
                      </label>
                      <input
                        type="text"
                        value={editingBlog.name}
                        onChange={(e) =>
                          setEditingBlog({ ...editingBlog, name: e.target.value })
                        }
                        placeholder="예: 내 IT 리뷰 블로그 / 재테크 연구소"
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                        블로그 플랫폼 *
                      </label>
                      <select
                        value={editingBlog.platform}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            platform: e.target.value as BlogPlatform,
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 outline-none"
                      >
                        <option value="naver">네이버 블로그 (SmartEditor ONE)</option>
                        <option value="tistory">티스토리 (애드센스 수익형)</option>
                        <option value="wordpress">워드프레스 (REST API & 브라우저)</option>
                        <option value="velog">벨로그 (개발/기술 마크다운)</option>
                        <option value="medium">Medium</option>
                        <option value="ghost">Ghost CMS</option>
                        <option value="github_pages">GitHub Pages</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold text-slate-700">
                        블로그 큰 틀 분야 (대주제 카테고리) *
                      </label>
                      <span className="text-[11px] text-blue-600 font-medium">
                        큰 틀만 넣어두면 매일 새로운 하위 세부 키워드를 자동 파생·발굴합니다
                      </span>
                    </div>
                    <input
                      type="text"
                      value={nicheInputRaw}
                      onChange={(e) => setNicheInputRaw(e.target.value)}
                      placeholder="예: 재테크, 경제, 금융  또는  IT, 가전, 테크  또는  건강, 운동, 웰니스"
                      className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3.5 py-2.5 text-sm text-slate-900 font-semibold placeholder:text-slate-400 outline-none"
                    />
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      <span className="text-[11px] text-slate-500 mr-1">
                        인기 대주제 원클릭 선택:
                      </span>
                      {[
                        { label: '시사·이슈·뉴스·자유주제', value: '시사, 뉴스이슈, 트렌드, 상식, 자유주제' },
                        { label: '경제·재테크·금융', value: '재테크, 금융, 경제, 절세·지원금' },
                        { label: 'IT·테크·가전', value: 'IT, 테크, 가전제품, 디지털기기' },
                        { label: '건강·운동·웰니스', value: '건강, 운동, 영양·식단, 웰니스' },
                        { label: '부동산·인테리어·살림', value: '부동산, 내집마련, 인테리어, 생활꿀팁' },
                        { label: '여행·맛집·라이프', value: '여행, 맛집, 캠핑, 라이프스타일' },
                        { label: '개발·AI·프로그래밍', value: '개발, 프로그래밍, AI·인공지능, 클라우드' },
                        { label: '자동차·모빌리티', value: '자동차, 전기차, 운전·차량관리' },
                        { label: '육아·교육·자기계발', value: '육아, 교육, 자격증, 자기계발' },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => setNicheInputRaw(preset.value)}
                          className="px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 hover:border-slate-400 text-[11px] font-medium text-slate-700 transition"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        {editingBlog.platform === 'naver'
                          ? '내 네이버 블로그 주소 또는 네이버 ID'
                          : editingBlog.platform === 'tistory'
                          ? '내 티스토리 블로그 주소 (URL)'
                          : editingBlog.platform === 'velog'
                          ? '내 벨로그 주소 또는 @아이디'
                          : '내 블로그 주소 (URL)'}
                      </label>
                      <input
                        type="text"
                        value={editingBlog.auth.blogUrl || editingBlog.auth.blogIdOrUsername}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            auth: {
                              ...editingBlog.auth,
                              blogUrl: e.target.value,
                            },
                          })
                        }
                        placeholder={
                          editingBlog.platform === 'naver'
                            ? '예: https://blog.naver.com/hong123 또는 hong123'
                            : editingBlog.platform === 'tistory'
                            ? '예: https://myblog.tistory.com (카카오 이메일 입력 불필요)'
                            : PLATFORM_META[editingBlog.platform].urlPlaceholder
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                      <p className="text-[10px] text-slate-500 mt-1">
                        * [로그인 세션 연결] 창에서 1회 로그인하거나 아래 자동 재로그인 계정을 저장해 두면, 시간이 지나 세션이 만료되어도 백그라운드에서 자동으로 다시 로그인한 뒤 글을 발행합니다.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">
                        기본 발행 게시판/카테고리명 (선택)
                      </label>
                      <input
                        type="text"
                        value={editingBlog.auth.defaultCategory}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            auth: { ...editingBlog.auth, defaultCategory: e.target.value },
                          })
                        }
                        placeholder="비워두면 대주제 이름으로 자동 설정됩니다"
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                    </div>
                  </div>

                  {/* Auto Re-login Account Box (Encrypted with Windows DPAPI) */}
                  {(editingBlog.platform === 'tistory' || editingBlog.platform === 'naver') && (
                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-800">
                          세션 만료 대비 자동 재로그인 계정 (선택 · Windows 안전 암호화 저장)
                        </span>
                        {editingBlog.auth.hasSavedPassword && (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            ● 비밀번호 암호화 저장됨
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            자동 로그인 아이디 ({editingBlog.platform === 'tistory' ? '카카오 이메일 또는 전화번호' : '네이버 아이디'})
                          </label>
                          <input
                            type="text"
                            value={editingBlog.auth.loginId || ''}
                            onChange={(e) =>
                              setEditingBlog({
                                ...editingBlog,
                                auth: { ...editingBlog.auth, loginId: e.target.value },
                              })
                            }
                            placeholder={
                              editingBlog.platform === 'tistory'
                                ? '예: myid@kakao.com'
                                : '예: naver_id'
                            }
                            className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            자동 로그인 비밀번호
                          </label>
                          <input
                            type="password"
                            value={editingBlog.auth.loginPassword || ''}
                            onChange={(e) =>
                              setEditingBlog({
                                ...editingBlog,
                                auth: { ...editingBlog.auth, loginPassword: e.target.value },
                              })
                            }
                            placeholder={
                              editingBlog.auth.hasSavedPassword
                                ? '•••••••• (저장됨 — 변경 시에만 입력)'
                                : '세션 만료 시 자동 입력할 비밀번호'
                            }
                            className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-500 leading-relaxed">
                        * [로그인 세션 연결]으로 한 번 로그인한 계정도 자동으로 기억되며, 비밀번호를 입력해 두면 장기간 경과 후 간편로그인이 만료된 경우에도 자동으로 로그인해 발행을 이어갑니다. (외부 전송 없이 내 PC에 Windows DPAPI로 암호화 저장됩니다.)
                      </p>
                    </div>
                  )}

                  {/* Automation Mode & Schedule Quick Setup */}
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-800">
                        자동화 방식 & 백그라운드 스케줄
                      </span>
                      <label className="flex items-center gap-2 text-xs font-bold text-emerald-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingBlog.schedule.enabled}
                          onChange={(e) =>
                            setEditingBlog({
                              ...editingBlog,
                              schedule: { ...editingBlog.schedule, enabled: e.target.checked },
                            })
                          }
                          className="w-4 h-4 rounded accent-emerald-600"
                        />
                        자동 스케줄러 켜기
                      </label>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">운영 모드</label>
                        <select
                          value={editingBlog.automationMode}
                          onChange={(e) =>
                            setEditingBlog({
                              ...editingBlog,
                              automationMode: e.target.value as 'full_auto' | 'semi_auto',
                            })
                          }
                          className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-2 text-xs text-slate-900 outline-none"
                        >
                          <option value="semi_auto">반자동 (생성 후 검수대기)</option>
                          <option value="full_auto">완전자동 (생성+즉시발행)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">실행 주기</label>
                        {(() => {
                          const isCustomTimes = editingBlog.schedule.scheduleMode === 'custom_times';
                          const isKnownPreset = SCHEDULE_PRESETS.some(
                            (p) => p.value === editingBlog.schedule.cronExpression
                          );
                          const selectVal = isCustomTimes
                            ? '__custom_times__'
                            : editingBlog.schedule.cronExpression;
                          return (
                            <select
                              value={selectVal}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (val === '__custom_times__') {
                                  const existingCustom =
                                    editingBlog.schedule.customTimes &&
                                    editingBlog.schedule.customTimes.length > 0
                                      ? editingBlog.schedule.customTimes
                                      : extractTimesFromCron(editingBlog.schedule.cronExpression);
                                  const seedTimes =
                                    existingCustom.length > 0 ? existingCustom : ['09:30', '20:30'];
                                  setEditingBlog({
                                    ...editingBlog,
                                    schedule: {
                                      ...editingBlog.schedule,
                                      scheduleMode: 'custom_times',
                                      customTimes: seedTimes,
                                      cronExpression: customTimesToCronPreview(seedTimes),
                                      dailyPostLimit: Math.max(1, seedTimes.length),
                                    },
                                  });
                                  return;
                                }
                                setEditingBlog({
                                  ...editingBlog,
                                  schedule: {
                                    ...editingBlog.schedule,
                                    scheduleMode: 'preset',
                                    cronExpression: val,
                                  },
                                });
                              }}
                              className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-2 text-xs text-slate-900 outline-none"
                            >
                              {SCHEDULE_PRESETS.map((p) => (
                                <option key={p.value} value={p.value}>
                                  {p.label}
                                </option>
                              ))}
                              {!isCustomTimes && !isKnownPreset && (
                                <option value={editingBlog.schedule.cronExpression}>
                                  사용자 Cron ({editingBlog.schedule.cronExpression})
                                </option>
                              )}
                              <option value="__custom_times__">
                                내가 원하는 시간 직접 지정 (시:분 자유 추가)
                              </option>
                            </select>
                          );
                        })()}
                      </div>

                      <div>
                        <label className="block text-[11px] text-emerald-700 font-semibold mb-1">
                          저품질 방지 랜덤 시간차 (봇 탐지 예방)
                        </label>
                        <select
                          value={editingBlog.schedule.randomJitterMinutes ?? 20}
                          onChange={(e) =>
                            setEditingBlog({
                              ...editingBlog,
                              schedule: {
                                ...editingBlog.schedule,
                                randomJitterMinutes: parseInt(e.target.value, 10),
                              },
                            })
                          }
                          className="w-full bg-white border border-emerald-300 focus:border-emerald-600 rounded-lg px-2.5 py-2 text-xs text-emerald-700 font-bold outline-none"
                        >
                          <option value={20}>5~20분 랜덤 지연 (권장)</option>
                          <option value={35}>10~35분 랜덤 지연 (초안전)</option>
                          <option value={45}>15~45분 랜덤 지연 (다중 블로그 초안전)</option>
                          <option value={10}>2~10분 랜덤 지연</option>
                          <option value={0}>정각 실행 (15~60초 미세 지연)</option>
                        </select>
                      </div>
                    </div>

                    {editingBlog.schedule.scheduleMode === 'custom_times' && (
                      <div className="p-3.5 rounded-lg bg-white border border-slate-200 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5 text-blue-600" />
                              사용자 지정 유동 발행 시간 (매일 선택한 시·분 실행)
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              원하는 시간(시:분)을 자유롭게 추가·삭제하세요. 등록된 시간 개수에 맞춰 일일 목표도 자동 조정됩니다.
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="time"
                              value={customTimeInput}
                              onChange={(e) => setCustomTimeInput(e.target.value)}
                              className="bg-slate-50 border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-1.5 text-xs font-mono font-semibold text-slate-900 outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleAddCustomScheduleTime(customTimeInput)}
                              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1 transition"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              시간 추가
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          {(editingBlog.schedule.customTimes || []).map((hhmm) => (
                            <span
                              key={hhmm}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-800 text-xs font-mono font-bold"
                            >
                              <Clock className="w-3 h-3 text-blue-600" />
                              {hhmm}
                              <button
                                type="button"
                                onClick={() => handleRemoveCustomScheduleTime(hhmm)}
                                className="p-0.5 rounded-full hover:bg-blue-200/70 text-blue-700 transition"
                                title={`${hhmm} 삭제`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100">
                          <span className="text-[11px] text-slate-500 mr-1">
                            자주 쓰는 시간 원클릭:
                          </span>
                          {QUICK_TIME_PRESETS.map((presetTime) => {
                            const active = (editingBlog.schedule.customTimes || []).includes(presetTime);
                            return (
                              <button
                                key={presetTime}
                                type="button"
                                onClick={() => handleToggleQuickScheduleTime(presetTime)}
                                className={`px-2 py-0.5 rounded-md border text-[11px] font-mono font-semibold transition ${
                                  active
                                    ? 'bg-slate-900 border-slate-900 text-white'
                                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                }`}
                              >
                                {presetTime}
                              </button>
                            );
                          })}
                        </div>

                        <div className="text-[11px] text-emerald-700 font-semibold bg-emerald-50/70 border border-emerald-200/80 rounded-lg px-3 py-1.5">
                          적용 요약: {formatScheduleSummary(editingBlog.schedule)} · 일일 최대{' '}
                          {editingBlog.schedule.dailyPostLimit}건
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          주력 AI 엔진 (블로그별 지정 가능)
                        </label>
                        <select
                          value={editingBlog.schedule.preferredAIProvider}
                          onChange={(e) => {
                            const nextProviderId = e.target.value as WebAIProviderId;
                            const nextSession = state.webAISessions.find(
                              (s) => s.id === nextProviderId
                            );
                            setEditingBlog({
                              ...editingBlog,
                              schedule: {
                                ...editingBlog.schedule,
                                preferredAIProvider: nextProviderId,
                                preferredModel: nextSession?.selectedModel || '',
                              },
                            });
                          }}
                          className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-2 text-xs text-slate-900 font-semibold outline-none"
                        >
                          {state.webAISessions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          이 블로그에서 사용할 세부 AI 모델
                        </label>
                        {(() => {
                          const targetSession = state.webAISessions.find(
                            (s) => s.id === editingBlog.schedule.preferredAIProvider
                          );
                          const models = targetSession?.availableModels || [];
                          return (
                            <select
                              value={editingBlog.schedule.preferredModel || ''}
                              onChange={(e) =>
                                setEditingBlog({
                                  ...editingBlog,
                                  schedule: {
                                    ...editingBlog.schedule,
                                    preferredModel: e.target.value || undefined,
                                  },
                                })
                              }
                              className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-2 text-xs text-slate-900 font-semibold outline-none"
                            >
                              <option value="">
                                AI 엔진 기본 설정 모델 따름 ({targetSession?.selectedModel || '자동'})
                              </option>
                              {models.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.label}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Real Human Blogger Writing Style Presets */}
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-slate-900">
                        실제 한국 블로거 문체 프리셋 (AI 티 완벽 제거)
                      </label>
                      <span className="text-[10px] text-slate-500">
                        선택 시 해당 호흡과 어미 리듬으로 원고를 작성합니다
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {[
                        {
                          id: 'friendly_neighbor' as const,
                          title: '친근한 이웃집 블로거',
                          desc: '~해요/~더라고요 수다형',
                          tone: '이웃에게 직접 겪은 팁을 편하게 이야기하듯 친근하고 생생한 구어체 (~해요, ~더라고요, ~거든요)',
                        },
                        {
                          id: 'practical_expert' as const,
                          title: '실전 재테크/정보 고수',
                          desc: '숫자·실수령·조건 팩트형',
                          tone: '직접 계산해보고 비교해본 실전 고수처럼 핵심 숫자와 신청 팁을 명확하게 짚어주는 실용적 구어체',
                        },
                        {
                          id: 'calm_briefing' as const,
                          title: '차분한 정리 노트',
                          desc: '~입니다/~네요 깔끔 정리형',
                          tone: '과장 없이 차분하고 담백하게 핵심 팩트와 절차를 정리해주는 신뢰감 있는 문체 (~입니다, ~해요)',
                        },
                        {
                          id: 'custom_clone' as const,
                          title: '내 블로그 말투 복제',
                          desc: '아래 샘플 글 호흡 100% 복제',
                          tone: '사용자 샘플 원고의 문장 길이, 어미 습관, 줄바꿈 호흡을 그대로 복제한 맞춤형 문체',
                        },
                      ].map((preset) => {
                        const activePreset =
                          editingBlog.persona.writingStylePreset || 'friendly_neighbor';
                        const isSelected = activePreset === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() =>
                              setEditingBlog({
                                ...editingBlog,
                                persona: {
                                  ...editingBlog.persona,
                                  writingStylePreset: preset.id,
                                  tone: preset.tone,
                                },
                              })
                            }
                            className={`p-2.5 rounded-lg border text-left transition ${
                              isSelected
                                ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                                : 'bg-white border-slate-200 hover:border-slate-300 text-slate-700'
                            }`}
                          >
                            <div
                              className={`text-xs font-bold ${
                                isSelected ? 'text-white' : 'text-slate-900'
                              }`}
                            >
                              {preset.title}
                            </div>
                            <div
                              className={`text-[10px] mt-0.5 ${
                                isSelected ? 'text-slate-300' : 'text-slate-500'
                              }`}
                            >
                              {preset.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    <div className="pt-1">
                      <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                        내 기존 블로그 글 샘플 붙여넣기 (선택 · 넣으면 어미·줄바꿈·문장 호흡을 자동 복제합니다)
                      </label>
                      <textarea
                        rows={3}
                        value={editingBlog.persona.styleSampleText || ''}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            persona: {
                              ...editingBlog.persona,
                              styleSampleText: e.target.value,
                              writingStylePreset: e.target.value.trim()
                                ? 'custom_clone'
                                : editingBlog.persona.writingStylePreset,
                            },
                          })
                        }
                        placeholder="평소 직접 쓰셨던 블로그 본문 2~3문단을 그대로 복사해서 붙여넣어 주세요. AI가 평소 쓰시는 어미(~더라고요, ~했어요 등)와 문단 간격을 분석해 똑같은 호흡으로 글을 작성합니다."
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none leading-relaxed"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        블로그 캐릭터(페르소나) 이름
                      </label>
                      <input
                        type="text"
                        value={editingBlog.persona.name}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            persona: { ...editingBlog.persona, name: e.target.value },
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">말투 및 어조</label>
                      <input
                        type="text"
                        value={editingBlog.persona.tone}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            persona: { ...editingBlog.persona, tone: e.target.value },
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">고정 서론 인사말</label>
                      <input
                        type="text"
                        value={editingBlog.persona.signatureIntro}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            persona: { ...editingBlog.persona, signatureIntro: e.target.value },
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">고정 결론 맺음말</label>
                      <input
                        type="text"
                        value={editingBlog.persona.signatureOutro}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            persona: { ...editingBlog.persona, signatureOutro: e.target.value },
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        일일 최대 자동 포스팅 제한 수
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={20}
                        value={editingBlog.schedule.dailyPostLimit}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            schedule: {
                              ...editingBlog.schedule,
                              dailyPostLimit: Math.max(1, parseInt(e.target.value, 10) || 1),
                            },
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs text-slate-900 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        직접 Cron 스케줄 입력 (고급)
                      </label>
                      <input
                        type="text"
                        value={editingBlog.schedule.cronExpression}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            schedule: {
                              ...editingBlog.schedule,
                              scheduleMode: 'preset',
                              cronExpression: e.target.value,
                            },
                          })
                        }
                        className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs font-mono text-slate-900 outline-none"
                      />
                    </div>
                  </div>

                  {editingBlog.platform === 'wordpress' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                      <input
                        type="text"
                        value={editingBlog.auth.apiUrl || ''}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            auth: { ...editingBlog.auth, apiUrl: e.target.value },
                          })
                        }
                        placeholder="워드프레스 REST API URL (선택)"
                        className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                      />
                      <input
                        type="password"
                        value={editingBlog.auth.apiKeyOrToken || ''}
                        onChange={(e) =>
                          setEditingBlog({
                            ...editingBlog,
                            auth: { ...editingBlog.auth, apiKeyOrToken: e.target.value },
                          })
                        }
                        placeholder="Application Password (선택)"
                        className="bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-slate-50/80 border-t border-slate-200 flex items-center justify-between">
              <span className="text-[11px] text-slate-500">
                * 문체와 스케줄은 언제든 수정할 수 있습니다.
              </span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => setEditingBlog(null)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold transition"
                >
                  취소
                </button>
                <button
                  onClick={async () => {
                    if (!editingBlog.name.trim()) {
                      showToast('블로그 이름을 입력해주세요.', 'error');
                      setBlogModalTab('basic');
                      return;
                    }
                    const parsedKeywords = nicheInputRaw
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (parsedKeywords.length === 0) {
                      showToast('핵심 주제 키워드를 최소 1개 이상 입력해주세요.', 'error');
                      setBlogModalTab('basic');
                      return;
                    }
                    const rawAddr = (
                      editingBlog.auth.blogUrl ||
                      editingBlog.auth.blogIdOrUsername ||
                      ''
                    ).trim();
                    let normalizedUrl = rawAddr;
                    let normalizedId = editingBlog.auth.blogIdOrUsername.trim();

                    if (editingBlog.platform === 'naver') {
                      const cleanId = rawAddr
                        .replace(/^https?:\/\/(m\.)?blog\.naver\.com\//i, '')
                        .split('/')[0]
                        .split('?')[0]
                        .split('@')[0]
                        .trim();
                      normalizedId = cleanId || normalizedId;
                      normalizedUrl = cleanId
                        ? `https://blog.naver.com/${cleanId}`
                        : 'https://blog.naver.com';
                    } else if (editingBlog.platform === 'tistory') {
                      if (rawAddr && !rawAddr.startsWith('http')) {
                        const sub = rawAddr.replace(/\.tistory\.com.*$/i, '').split('@')[0].trim();
                        normalizedUrl = `https://${sub}.tistory.com`;
                        normalizedId = sub;
                      }
                    } else if (editingBlog.platform === 'velog') {
                      if (rawAddr && !rawAddr.startsWith('http')) {
                        const handle = rawAddr.replace(/^@/, '').split('@')[0].trim();
                        normalizedUrl = `https://velog.io/@${handle}`;
                        normalizedId = handle;
                      }
                    } else if (rawAddr && !rawAddr.startsWith('http')) {
                      normalizedUrl = `https://${rawAddr}`;
                    }

                    const normalizedCustomTimes = Array.from(
                      new Set(
                        (editingBlog.schedule.customTimes || [])
                          .map(normalizeHHMM)
                          .filter((t): t is string => Boolean(t))
                      )
                    ).sort();
                    if (
                      editingBlog.schedule.scheduleMode === 'custom_times' &&
                      normalizedCustomTimes.length === 0
                    ) {
                      showToast(
                        '직접 시간 지정 모드에서는 최소 1개 이상의 발행 시각을 추가해주세요.',
                        'error'
                      );
                      setBlogModalTab('basic');
                      return;
                    }

                    const blogToSave: BlogProfile = {
                      ...editingBlog,
                      name: editingBlog.name.trim(),
                      nicheKeywords: parsedKeywords,
                      description:
                        editingBlog.description ||
                        `${parsedKeywords.slice(0, 3).join(' · ')} 전문 블로그`,
                      schedule: {
                        ...editingBlog.schedule,
                        customTimes: normalizedCustomTimes,
                        cronExpression:
                          editingBlog.schedule.scheduleMode === 'custom_times'
                            ? customTimesToCronPreview(normalizedCustomTimes)
                            : editingBlog.schedule.cronExpression,
                      },
                      auth: {
                        ...editingBlog.auth,
                        blogUrl: normalizedUrl || 'https://blog.naver.com',
                        blogIdOrUsername: normalizedId,
                        defaultCategory:
                          editingBlog.auth.defaultCategory.trim() || parsedKeywords[0],
                        loginId: (editingBlog.auth.loginId || '').trim() || undefined,
                        loginPassword: (editingBlog.auth.loginPassword || '').trim() || undefined,
                      },
                    };
                    const newState = await window.electronAPI.saveBlog(blogToSave);
                    setState(newState);
                    setSelectedBlogId(blogToSave.id);
                    setEditingBlog(null);
                    showToast(`'${blogToSave.name}' 블로그가 저장되었습니다!`, 'success');
                  }}
                  className="px-6 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition"
                >
                  블로그 저장 완료
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== LEFT SIDEBAR (CLEAN 6-ITEM NAVIGATION) ==================== */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col justify-between shrink-0">
        <div>
          {/* Brand Logo */}
          <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-3">
            <img
              src="./icon.svg"
              alt="BlogStater Studio"
              className="w-9 h-9 rounded-lg shadow-sm shrink-0"
            />
            <div>
              <h1 className="text-sm font-bold tracking-tight text-slate-900">
                BlogStater <span className="text-blue-600">Studio</span>
              </h1>
              <p className="text-[11px] text-slate-500">멀티 블로그 자동화 스튜디오</p>
            </div>
          </div>

          {/* Active Blog Quick Switcher */}
          <div className="p-3.5 border-b border-slate-200 bg-slate-50/70">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-slate-500">현재 작업 블로그</span>
              <button
                onClick={handleCreateNewBlogTemplate}
                className="text-[11px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-0.5"
              >
                <Plus className="w-3 h-3" /> 추가
              </button>
            </div>
            {state.blogs.length > 0 ? (
              <select
                value={selectedBlogId}
                onChange={(e) => {
                  const nextBlogId = e.target.value;
                  setSelectedBlogId(nextBlogId);
                  syncStudioAIForBlog(nextBlogId);
                  if (currentPost && currentPost.blogId !== nextBlogId) {
                    const nextBlogPost =
                      state.posts.find((p) => p.blogId === nextBlogId) || null;
                    setCurrentPost(nextBlogPost);
                    if (nextBlogPost?.thumbnail) {
                      setThumbnailConfig(nextBlogPost.thumbnail);
                    }
                    setStudioKeyword(nextBlogPost?.targetKeyword || '');
                  }
                }}
                className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 outline-none"
              >
                {state.blogs.map((b) => (
                  <option key={b.id} value={b.id}>
                    [{PLATFORM_META[b.platform].label}] {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={handleCreateNewBlogTemplate}
                className="w-full py-2 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition"
              >
                <Plus className="w-3.5 h-3.5" />첫 블로그 3초 등록하기
              </button>
            )}
          </div>

          {/* Main Navigation Grouped Cleanly */}
          <div className="p-3 space-y-4">
            <div>
              <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                포스팅 워크스페이스
              </div>
              <nav className="space-y-1">
                {[
                  { id: 'dashboard', label: '홈 & 오토파일럿 가동', icon: LayoutDashboard },
                  {
                    id: 'scout',
                    label: '황금 키워드 발굴함',
                    icon: Flame,
                    badge: state.trends.length,
                  },
                  { id: 'studio', label: '글쓰기 & 썸네일 스튜디오', icon: PenTool },
                  {
                    id: 'queue',
                    label: '발행 관리 & 작업 캘린더',
                    icon: CalendarIcon,
                    badge: state.posts.length,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as NavTab)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition ${
                        isActive
                          ? 'bg-slate-900 text-white font-semibold shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span
                          className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div>
              <div className="px-3 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                블로그 & AI 설정
              </div>
              <nav className="space-y-1">
                {[
                  {
                    id: 'blogs',
                    label: '블로그 & 수익화 설정',
                    icon: Globe,
                    badge: state.blogs.length,
                  },
                  {
                    id: 'ai_sessions',
                    label: 'AI 엔진 연결 (CLI / 웹)',
                    icon: Cpu,
                    badge: readyAICount,
                  },
                ].map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id as NavTab)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition ${
                        isActive
                          ? 'bg-slate-900 text-white font-semibold shadow-sm'
                          : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900 font-medium'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Icon className="w-4 h-4" />
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== undefined && item.badge > 0 && (
                        <span
                          className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </div>

        {/* Bottom Status & Backup Bar */}
        <div className="p-3.5 border-t border-slate-200 space-y-2.5 bg-slate-50/70">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500 font-medium">백그라운드 스케줄러</span>
            <span
              className={`font-semibold ${
                scheduledBlogCount > 0 ? 'text-emerald-700' : 'text-slate-500'
              }`}
            >
              {scheduledBlogCount > 0 ? `● ${scheduledBlogCount}개 가동중` : '○ 대기중'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={handleBackupExport}
              className="py-1.5 px-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1 shadow-sm transition"
              title="전체 설정 및 원고 백업"
            >
              <Download className="w-3 h-3 text-slate-600" />
              백업 저장
            </button>
            <button
              onClick={handleBackupImport}
              className="py-1.5 px-2 rounded-lg bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 text-[11px] font-semibold flex items-center justify-center gap-1 shadow-sm transition"
              title="백업 파일 복원"
            >
              <Upload className="w-3 h-3 text-slate-600" />
              백업 복원
            </button>
          </div>
        </div>
      </aside>

      {/* ==================== MAIN WORKSPACE AREA ==================== */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Clean Top Header Bar */}
        <header className="h-14 border-b border-slate-200 bg-white px-6 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {activeBlog ? (
              <>
                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${
                    PLATFORM_META[activeBlog.platform].badgeBg
                  }`}
                >
                  {PLATFORM_META[activeBlog.platform].label}
                </span>
                <span className="text-sm font-bold text-slate-900 tracking-tight">
                  {activeBlog.name}
                </span>
                <span className="text-xs text-slate-500 hidden md:inline">
                  주제: {activeBlog.nicheKeywords.slice(0, 3).join(', ')}
                </span>
              </>
            ) : (
              <span className="text-xs text-amber-700 font-semibold">
                먼저 운영하실 첫 번째 블로그를 등록해 주세요
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setActiveTab('ai_sessions')}
              className="px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition"
            >
              <Terminal className="w-3.5 h-3.5 text-emerald-600" />
              <span>AI 엔진 {readyAICount}개 준비됨</span>
            </button>

            {activeBlog && (
              <button
                onClick={() => handleRunAutoPipeline(activeBlog.id)}
                className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />현 블로그 원클릭 자동 포스팅
              </button>
            )}
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ==================== 1. HOME & AUTOPILOT DASHBOARD ==================== */}
          {activeTab === 'dashboard' && (
            <div className="max-w-6xl mx-auto space-y-6">
              {/* 3-Step Visual Onboarding Guide */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2 tracking-tight">
                    <Sliders className="w-4 h-4 text-slate-700" />
                    무인 블로그 자동화 3단계 빠른 시작 가이드
                  </h2>
                  <span className="text-xs text-slate-500">
                    초기 1회만 설정해 두면 프로그램을 켜두는 것만으로 자동 운영됩니다
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Step 1 */}
                  <div
                    onClick={handleCreateNewBlogTemplate}
                    className={`p-3.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                      state.blogs.length > 0
                        ? 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-300'
                        : 'bg-blue-50/50 border-blue-200 hover:border-blue-300'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-700">STEP 1</span>
                        {state.blogs.length > 0 && (
                          <span className="text-[11px] font-semibold text-emerald-700">
                            ✓ {state.blogs.length}개 등록됨
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-slate-900">블로그 & 주제 등록</div>
                      <div className="text-xs text-slate-600">
                        운영할 블로그와 핵심 키워드 입력
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>

                  {/* Step 2 */}
                  <div
                    onClick={() => setActiveTab('ai_sessions')}
                    className={`p-3.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                      readyAICount > 1
                        ? 'bg-emerald-50/50 border-emerald-200 hover:border-emerald-300'
                        : 'bg-slate-50/70 border-slate-200 hover:bg-slate-100/70'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-700">STEP 2</span>
                        <span className="text-[11px] font-semibold text-emerald-700">
                          ✓ {readyAICount}개 활성
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-900">구독형 AI CLI / 웹 연결</div>
                      <div className="text-xs text-slate-600">
                        Claude·Codex·Gemini CLI 또는 웹 연동
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </div>

                  {/* Step 3 */}
                  <div
                    onClick={() => {
                      if (activeBlog) {
                        handleRunAutoPipeline(activeBlog.id);
                      } else {
                        handleCreateNewBlogTemplate();
                      }
                    }}
                    className="p-3.5 rounded-lg border bg-slate-50/70 border-slate-200 hover:bg-slate-100/70 hover:border-slate-300 cursor-pointer transition flex items-center justify-between"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-slate-700">STEP 3</span>
                        <span className="text-[11px] font-semibold text-amber-700">
                          스케줄 {scheduledBlogCount}개 ON
                        </span>
                      </div>
                      <div className="text-sm font-bold text-slate-900">원클릭 가동 & 자동 스케줄</div>
                      <div className="text-xs text-slate-600">
                        즉시 원고 생성 또는 시간별 무인 발행
                      </div>
                    </div>
                    <Play className="w-4 h-4 text-slate-700 fill-current shrink-0" />
                  </div>
                </div>
              </div>

              {/* My Blogs Grid */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-slate-900 tracking-tight">
                    운영 중인 블로그 ({state.blogs.length})
                  </h2>
                  <div className="flex items-center gap-2">
                    {state.blogs.length > 1 && (
                      <button
                        onClick={async () => {
                          for (const b of state.blogs) {
                            const completed = await handleRunAutoPipeline(b.id);
                            if (!completed) break;
                          }
                        }}
                        className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 shadow-sm text-xs font-semibold text-slate-700 flex items-center gap-1.5 transition"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-500" />
                        전체 블로그 일괄 자동 포스팅
                      </button>
                    )}
                    <button
                      onClick={handleCreateNewBlogTemplate}
                      className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                    >
                      <Plus className="w-3.5 h-3.5" />새 블로그 추가
                    </button>
                  </div>
                </div>

                {state.blogs.length === 0 ? (
                  <div className="p-12 rounded-xl bg-white border border-dashed border-slate-300 text-center space-y-3">
                    <Globe className="w-10 h-10 text-slate-400 mx-auto" />
                    <div className="text-base font-bold text-slate-900">
                      아직 등록된 블로그가 없습니다
                    </div>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">
                      블로그 이름과 관심 주제 키워드만 입력하면 3초 만에 등록이 완료됩니다.
                    </p>
                    <button
                      onClick={handleCreateNewBlogTemplate}
                      className="px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-2 shadow-sm transition"
                    >
                      <Plus className="w-4 h-4" />첫 번째 블로그 등록하기
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {state.blogs.map((blog) => {
                      const pMeta = PLATFORM_META[blog.platform];
                      const todayCount = state.posts.filter(
                        (p) =>
                          p.blogId === blog.id &&
                          toLocalDateStr(p.publishedAt || p.createdAt) === todayIso
                      ).length;
                      const dailyLimit = blog.schedule.dailyPostLimit || 2;

                      return (
                        <div
                          key={blog.id}
                          className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4 transition"
                        >
                          <div className="space-y-3">
                            {/* Top Row: Platform + Auto Schedule Switch */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${pMeta.badgeBg}`}
                                >
                                  {pMeta.label}
                                </span>
                                <span className="text-xs text-slate-500 font-medium">
                                  {blog.automationMode === 'full_auto'
                                    ? '완전자동 발행'
                                    : '반자동 검수'}
                                </span>
                              </div>

                              <button
                                onClick={async () => {
                                  const updated: BlogProfile = {
                                    ...blog,
                                    schedule: {
                                      ...blog.schedule,
                                      enabled: !blog.schedule.enabled,
                                    },
                                  };
                                  const newState = await window.electronAPI.saveBlog(updated);
                                  setState(newState);
                                  showToast(
                                    updated.schedule.enabled
                                      ? `[${blog.name}] 자동 스케줄러가 켜졌습니다.`
                                      : `[${blog.name}] 자동 스케줄러가 꺼졌습니다.`,
                                    'info'
                                  );
                                }}
                                className={`px-3 py-1 rounded-full text-xs font-semibold transition border ${
                                  blog.schedule.enabled
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-100 text-slate-500 border-slate-200'
                                }`}
                              >
                                {blog.schedule.enabled ? '● 자동스케줄 ON' : '○ 자동스케줄 OFF'}
                              </button>
                            </div>

                            {/* Title & Keywords */}
                            <div>
                              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                                {blog.name}
                              </h3>
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {blog.nicheKeywords.map((kw) => (
                                  <span
                                    key={kw}
                                    className="text-xs px-2.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 font-medium"
                                  >
                                    #{kw}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Clean Progress Strip */}
                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5 text-xs">
                              <div className="flex items-center justify-between">
                                <span className="text-slate-600">
                                  오늘 진행률:{' '}
                                  <strong className="text-slate-900">
                                    {todayCount} / {dailyLimit}건
                                  </strong>
                                </span>
                                <span className="text-slate-600">
                                  누적 발행:{' '}
                                  <strong className="text-emerald-700">
                                    {blog.stats.totalPublished}건
                                  </strong>
                                </span>
                                <span className="text-slate-600">
                                  로그인:{' '}
                                  <strong
                                    className={
                                      blog.auth.sessionLoggedIn
                                        ? 'text-emerald-700'
                                        : 'text-amber-700'
                                    }
                                  >
                                    {blog.auth.sessionLoggedIn ? '연결됨' : '미연결'}
                                  </strong>
                                </span>
                              </div>
                              <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between text-[11px]">
                                <span className="text-slate-500">배정 AI 모델:</span>
                                <span className="font-semibold text-slate-800">
                                  {(() => {
                                    const p = state.webAISessions.find(
                                      (s) => s.id === blog.schedule.preferredAIProvider
                                    );
                                    const m =
                                      blog.schedule.preferredModel || p?.selectedModel || '기본 모델';
                                    return `${p?.id.toUpperCase() || 'AI'} · ${m}`;
                                  })()}
                                </span>
                              </div>
                              <div className="pt-1.5 border-t border-slate-200/80 flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-slate-500 shrink-0">자동 발행 시간:</span>
                                <button
                                  type="button"
                                  onClick={() => openEditBlogModal(blog)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 text-slate-700 hover:text-blue-700 font-semibold transition truncate max-w-[230px]"
                                  title="클릭하여 발행 시각·스케줄 유동 변경"
                                >
                                  <Clock className="w-3 h-3 shrink-0 text-blue-600" />
                                  <span className="truncate">
                                    {blog.schedule.enabled
                                      ? formatScheduleSummary(blog.schedule)
                                      : `일시중지 · ${formatScheduleSummary(blog.schedule)}`}
                                  </span>
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 pt-1">
                            <button
                              onClick={() => handleRunAutoPipeline(blog.id)}
                              className="flex-1 py-2.5 px-4 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 shadow-sm transition"
                            >
                              <Play className="w-3.5 h-3.5 fill-current" />
                              지금 자동 포스팅 1건 실행
                            </button>
                            <button
                              onClick={() => handleOpenBlogLogin(blog.id)}
                              className="py-2.5 px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-sm transition"
                              title="블로그 로그인 세션 연결"
                            >
                              로그인 연결
                            </button>
                            <button
                              onClick={() => openEditBlogModal(blog)}
                              className="p-2.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 shadow-sm transition"
                              title="블로그 설정 수정"
                            >
                              <Settings className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Recent Posts & Compact Live Log */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900 tracking-tight">최근 작성된 포스팅</h3>
                    <button
                      onClick={() => {
                        setQueueSubView('list');
                        setActiveTab('queue');
                      }}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      전체 보기 ({state.posts.length}) →
                    </button>
                  </div>

                  {state.posts.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500">
                      아직 생성된 원고가 없습니다. 위 블로그 카드에서 [지금 자동 포스팅 1건 실행]을 눌러보세요!
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {state.posts.slice(0, 4).map((post) => {
                        const blog = state.blogs.find((b) => b.id === post.blogId);
                        return (
                          <div
                            key={post.id}
                            className="p-3 rounded-lg bg-slate-50/70 hover:bg-slate-100/60 border border-slate-200/80 flex items-center justify-between gap-3 transition"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                <span className="text-[11px] font-bold text-slate-700">
                                  {blog?.name || '블로그'}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                    post.status === 'published'
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                      : 'bg-amber-50 text-amber-700 border-amber-200'
                                  }`}
                                >
                                  {post.status === 'published' ? '✓ 발행 완료' : '● 검수 대기'}
                                </span>
                                <span className="text-[11px] font-bold text-emerald-700">
                                  SEO {post.seoReport.totalScore}점
                                </span>
                              </div>
                              <div className="text-xs font-bold text-slate-900 truncate">
                                {post.title}
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                                <span>생성일시: {formatDateTimeKo(post.createdAt)}</span>
                                <span className={post.publishedAt ? 'text-emerald-700 font-medium' : 'text-slate-400'}>
                                  {post.publishedAt
                                    ? `발행일시: ${formatDateTimeKo(post.publishedAt)}`
                                    : '발행일시: 미발행 (검수 대기)'}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => openPostInStudio(post)}
                                className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition"
                              >
                                열기
                              </button>
                              <button
                                onClick={() => handleCopyRichHtml(post)}
                                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition"
                              >
                                HTML 복사
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900 tracking-tight">실시간 작업 상태 로그</h3>
                    <button
                      onClick={() => {
                        setQueueSubView('calendar');
                        setActiveTab('queue');
                      }}
                      className="text-xs text-blue-600 hover:underline font-semibold"
                    >
                      날짜별 기록 보기 →
                    </button>
                  </div>
                  <div className="flex-1 max-h-56 overflow-y-auto space-y-2 pr-1 text-xs">
                    {state.logs.slice(0, 12).map((log) => (
                      <div
                        key={log.id}
                        className="p-2.5 rounded-lg bg-slate-50/70 border border-slate-200/80"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500 mb-0.5">
                          <span className="font-bold text-slate-700">{log.module}</span>
                          <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <div className="text-slate-700 text-xs">{log.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================== 2. COMPACT GOLDEN KEYWORD SCOUT ==================== */}
          {activeTab === 'scout' &&
            (() => {
              const normalizeK = (k: string) =>
                (k || '').toLowerCase().replace(/[\s·,\-_/\[\]()!?'"“”‘’]/g, '').trim();
              const usedPostKeys = new Set(
                state.posts.map((p) => normalizeK(p.targetKeyword))
              );

              const blogFiltered = state.trends.filter(
                (t) =>
                  scoutFilterBlogId === 'all' ||
                  t.recommendedBlogId === scoutFilterBlogId
              );

              const totalBlogCount = blogFiltered.length;
              const usedCount = blogFiltered.filter(
                (t) => t.usedInPost || usedPostKeys.has(normalizeK(t.keyword))
              ).length;
              const unusedCount = totalBlogCount - usedCount;

              const availableSubCategories = Array.from(
                new Set(blogFiltered.map((t) => t.subCategory).filter(Boolean))
              ) as string[];

              const finalFiltered = blogFiltered
                .filter((t) => {
                  const isUsed = t.usedInPost || usedPostKeys.has(normalizeK(t.keyword));
                  if (scoutStatusFilter === 'unused' && isUsed) return false;
                  if (scoutStatusFilter === 'used' && !isUsed) return false;
                  if (scoutSubCategoryFilter !== 'all' && t.subCategory !== scoutSubCategoryFilter) {
                    return false;
                  }
                  if (scoutSearchQuery.trim()) {
                    const q = scoutSearchQuery.trim().toLowerCase();
                    return (
                      t.keyword.toLowerCase().includes(q) ||
                      t.parentSeedKeyword.toLowerCase().includes(q) ||
                      (t.subCategory && t.subCategory.toLowerCase().includes(q)) ||
                      (t.interestReason && t.interestReason.toLowerCase().includes(q))
                    );
                  }
                  return true;
                })
                .sort((a, b) => {
                  if (Boolean(a.pinned) !== Boolean(b.pinned)) {
                    return a.pinned ? -1 : 1;
                  }
                  if (scoutSortBy === 'searchVolume') {
                    return b.estimatedMonthlySearch - a.estimatedMonthlySearch;
                  }
                  if (scoutSortBy === 'lowCompetition') {
                    return a.competitionRatio - b.competitionRatio;
                  }
                  if (scoutSortBy === 'newest') {
                    return (
                      new Date(b.discoveredAt).getTime() - new Date(a.discoveredAt).getTime()
                    );
                  }
                  return b.goldenScore - a.goldenScore;
                });

              const allVisibleSelected =
                finalFiltered.length > 0 &&
                finalFiltered.every((t) => selectedBatchKeywords.includes(t.keyword));

              return (
                <div className="max-w-6xl mx-auto space-y-4">
                  {/* Top Search & Crawl Bar */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 tracking-tight">
                          <Flame className="w-5 h-5 text-amber-500" />
                          대주제 기반 최신 소주제 & 황금 키워드 발굴기
                        </h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          단순 단어 검색이 아닌, 설정하신 대주제 안에서 현재 대한민국 독자들이 가장 뜨겁게 검색하는 실전 소주제와 관심 배경을 실시간 뉴스와 함께 분석 발굴합니다.
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">
                          자동 관리: 속보 48시간 · 일반 7일 자동 만료 · 작성완료 자동 정리 · 블로그당 최대 25개 유지 (고정·직접등록 제외)
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            const res = await window.electronAPI.deduplicateTrends();
                            setState(res.state);
                            setSelectedBatchKeywords([]);
                            showToast(
                              res.removedCount > 0
                                ? `중복·유사 키워드 ${res.removedCount}건이 정리되었습니다.`
                                : '중복된 키워드가 없습니다.',
                              'success'
                            );
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                          중복 자동정리
                        </button>
                        {usedCount > 0 && (
                          <button
                            onClick={async () => {
                              const newState = await window.electronAPI.clearTrends({
                                blogId: scoutFilterBlogId,
                                onlyUsed: true,
                              });
                              setState(newState);
                              setSelectedBatchKeywords([]);
                              showToast(`작성완료 키워드 ${usedCount}건을 비웠습니다.`, 'info');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold transition"
                          >
                            작성완료 비우기 ({usedCount})
                          </button>
                        )}
                        {totalBlogCount > 0 && (
                          <button
                            onClick={async () => {
                              const newState = await window.electronAPI.clearTrends({
                                blogId: scoutFilterBlogId,
                              });
                              setState(newState);
                              setSelectedBatchKeywords([]);
                              showToast('키워드 목록을 전체 비웠습니다.', 'info');
                            }}
                            className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 text-xs font-semibold transition"
                          >
                            전체 비우기
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Crawl Bar */}
                    <div className="flex flex-col md:flex-row gap-2.5">
                      <select
                        value={scoutFilterBlogId}
                        onChange={(e) => setScoutFilterBlogId(e.target.value)}
                        className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-slate-900 md:w-64 outline-none"
                      >
                        <option value="all">전체 블로그 주제 검색</option>
                        {state.blogs.map((b) => (
                          <option key={b.id} value={b.id}>
                            [{PLATFORM_META[b.platform].label}] {b.name}
                          </option>
                        ))}
                      </select>

                      <div className="relative flex-1">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                        <input
                          type="text"
                          value={seedInput}
                          onChange={(e) => setSeedInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleScoutKeywords()}
                          placeholder={
                            scoutFilterBlogId === 'all'
                              ? '대주제 입력 (비워두면 등록된 각 블로그별 대주제에 맞춰 블로그별로 최신 소주제 자동 발굴)'
                              : '대주제 입력 (예: 경제·재테크, IT·가전, 건강·운동) - 비워두면 선택된 블로그 대주제 기반 자동 발굴'
                          }
                          className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg pl-10 pr-4 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                        />
                      </div>

                      <button
                        onClick={() => handleScoutKeywords()}
                        className="py-2.5 px-5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center justify-center gap-2 shrink-0 shadow-sm transition"
                      >
                        <Flame className="w-4 h-4 text-amber-400 fill-current" />
                        최신 소주제 발굴하기
                      </button>
                    </div>

                    {/* Sub-Category Filter Chips Bar */}
                    {availableSubCategories.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[11px] font-semibold text-slate-500 mr-1">
                          소주제 분류 필터:
                        </span>
                        <button
                          onClick={() => setScoutSubCategoryFilter('all')}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                            scoutSubCategoryFilter === 'all'
                              ? 'bg-slate-900 text-white shadow-sm'
                              : 'bg-slate-100 hover:bg-slate-200/80 text-slate-600 border border-slate-200/80'
                          }`}
                        >
                          전체 소주제
                        </button>
                        {availableSubCategories.map((subCat) => (
                          <button
                            key={subCat}
                            onClick={() =>
                              setScoutSubCategoryFilter(
                                scoutSubCategoryFilter === subCat ? 'all' : subCat
                              )
                            }
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition ${
                              scoutSubCategoryFilter === subCat
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'bg-slate-100 hover:bg-slate-200/80 text-slate-600 border border-slate-200/80'
                            }`}
                          >
                            {subCat}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Compact Filter & Sort Row */}
                    <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedBatchKeywords((prev) =>
                                  Array.from(
                                    new Set([...prev, ...finalFiltered.map((t) => t.keyword)])
                                  )
                                );
                              } else {
                                const visibleSet = new Set(finalFiltered.map((t) => t.keyword));
                                setSelectedBatchKeywords((prev) =>
                                  prev.filter((k) => !visibleSet.has(k))
                                );
                              }
                            }}
                            className="w-3.5 h-3.5 rounded accent-slate-900"
                          />
                          전체선택
                        </label>

                        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/80 text-xs">
                          <button
                            onClick={() => setScoutStatusFilter('all')}
                            className={`px-2.5 py-1 rounded-md font-semibold transition ${
                              scoutStatusFilter === 'all'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            전체 ({totalBlogCount})
                          </button>
                          <button
                            onClick={() => setScoutStatusFilter('unused')}
                            className={`px-2.5 py-1 rounded-md font-semibold transition ${
                              scoutStatusFilter === 'unused'
                                ? 'bg-white text-amber-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            미작성 ({unusedCount})
                          </button>
                          <button
                            onClick={() => setScoutStatusFilter('used')}
                            className={`px-2.5 py-1 rounded-md font-semibold transition ${
                              scoutStatusFilter === 'used'
                                ? 'bg-white text-emerald-700 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            작성완료 ({usedCount})
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={scoutSearchQuery}
                          onChange={(e) => setScoutSearchQuery(e.target.value)}
                          placeholder="목록 내 검색..."
                          className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 w-36 outline-none"
                        />
                        <select
                          value={scoutSortBy}
                          onChange={(e) => setScoutSortBy(e.target.value as any)}
                          className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-1.5 text-xs text-slate-700 font-semibold outline-none"
                        >
                          <option value="goldenScore">황금점수순</option>
                          <option value="searchVolume">검색량 높은순</option>
                          <option value="lowCompetition">경쟁 낮은순</option>
                          <option value="newest">최신순</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Floating Batch Action Bar when keywords are checked */}
                  {selectedBatchKeywords.length > 0 && (
                    <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between shadow-md">
                      <span className="text-xs font-bold text-white">
                        ✓ {selectedBatchKeywords.length}개 키워드 선택됨
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setSelectedBatchKeywords([])}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                        >
                          선택 해제
                        </button>
                        <button
                          onClick={async () => {
                            const selectedSet = new Set(selectedBatchKeywords);
                            const idsToDelete = state.trends
                              .filter((t) => selectedSet.has(t.keyword))
                              .map((t) => t.id);
                            const newState = await window.electronAPI.deleteTrendsBatch(
                              idsToDelete
                            );
                            setState(newState);
                            setSelectedBatchKeywords([]);
                            showToast(`${idsToDelete.length}건이 삭제되었습니다.`, 'info');
                          }}
                          className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/40 text-rose-200 border border-rose-500/40 text-xs font-semibold transition"
                        >
                          선택 삭제
                        </button>
                        <button
                          onClick={handleBatchGenerate}
                          className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition"
                        >
                          <Zap className="w-3.5 h-3.5 fill-current" />
                          선택 키워드 {selectedBatchKeywords.length}건 연속 원고 생성
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Compact High-Density Keyword Table List */}
                  {finalFiltered.length === 0 ? (
                    <div className="p-12 rounded-xl bg-white border border-dashed border-slate-300 text-center space-y-2">
                      <Flame className="w-8 h-8 text-amber-500 mx-auto" />
                      <div className="text-sm font-bold text-slate-900">표시할 키워드가 없습니다</div>
                      <p className="text-xs text-slate-500">
                        상단의 [최신 소주제 발굴하기] 버튼을 눌러 조회수 높은 주제를 찾아보세요.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-200/80 shadow-sm">
                      {finalFiltered.map((topic) => {
                        const isUsed =
                          topic.usedInPost || usedPostKeys.has(normalizeK(topic.keyword));
                        const isExpanded = expandedTopicId === topic.id;
                        return (
                          <div key={topic.id} className="transition hover:bg-slate-50/80">
                            <div className="px-4 py-3 flex items-center justify-between gap-3">
                              {/* Left: Checkbox + Score + Keyword */}
                              <div className="flex items-center gap-3 min-w-0 flex-1">
                                <input
                                  type="checkbox"
                                  checked={selectedBatchKeywords.includes(topic.keyword)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedBatchKeywords((prev) => [
                                        ...prev,
                                        topic.keyword,
                                      ]);
                                    } else {
                                      setSelectedBatchKeywords((prev) =>
                                        prev.filter((k) => k !== topic.keyword)
                                      );
                                    }
                                  }}
                                  className="w-4 h-4 rounded accent-slate-900 cursor-pointer shrink-0"
                                />

                                <span className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-700 font-bold text-xs shrink-0">
                                  {topic.goldenScore}점
                                </span>

                                <button
                                  onClick={() =>
                                    setExpandedTopicId(isExpanded ? null : topic.id)
                                  }
                                  className="flex flex-col text-left min-w-0 flex-1 py-1"
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 border ${
                                        topic.source === 'realtime_news'
                                          ? 'bg-rose-50 text-rose-700 border-rose-200'
                                          : topic.source === 'naver_autocomplete'
                                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                          : topic.source === 'google_autocomplete'
                                          ? 'bg-sky-50 text-sky-700 border-sky-200'
                                          : 'bg-violet-50 text-violet-700 border-violet-200'
                                      }`}
                                    >
                                      {topic.source === 'realtime_news'
                                        ? '속보 이슈'
                                        : topic.source === 'naver_autocomplete'
                                        ? '네이버 자동완성'
                                        : topic.source === 'google_autocomplete'
                                        ? '구글 자동완성'
                                        : 'AI 실시간 분해'}
                                    </span>
                                    {topic.subCategory && (
                                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-semibold shrink-0">
                                        {topic.subCategory}
                                      </span>
                                    )}
                                    {topic.recommendedBlogId &&
                                      (() => {
                                        const ownerBlog = state.blogs.find(
                                          (b) => b.id === topic.recommendedBlogId
                                        );
                                        return ownerBlog ? (
                                          <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-semibold shrink-0">
                                            {ownerBlog.name}
                                          </span>
                                        ) : null;
                                      })()}
                                    <span className="text-sm font-bold text-slate-900 truncate">
                                      {topic.keyword}
                                    </span>
                                    {topic.pinned && (
                                      <span className="px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-semibold shrink-0 inline-flex items-center gap-0.5">
                                        <Pin className="w-2.5 h-2.5" />
                                        고정
                                      </span>
                                    )}
                                    {topic.isManual && (
                                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-semibold shrink-0">
                                        직접등록
                                      </span>
                                    )}
                                    {isUsed && (
                                      <span className="px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-semibold shrink-0">
                                        작성완료
                                      </span>
                                    )}
                                    {isExpanded ? (
                                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-auto" />
                                    ) : (
                                      <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-auto" />
                                    )}
                                  </div>
                                  {(topic.interestReason || topic.discoveredAt) && (
                                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-1 flex items-center gap-1.5">
                                      {topic.discoveredAt && (
                                        <span className="md:hidden inline-flex items-center gap-1 text-[10px] font-semibold text-slate-600 shrink-0">
                                          <Clock className="w-3 h-3 text-slate-400" />
                                          {formatDateTimeKo(topic.discoveredAt)}
                                        </span>
                                      )}
                                      {topic.interestReason && (
                                        <>
                                          <span className="text-slate-700 font-semibold shrink-0 text-[10px]">
                                            독자 관심 배경:
                                          </span>
                                          <span className="text-slate-600">{topic.interestReason}</span>
                                        </>
                                      )}
                                    </p>
                                  )}
                                </button>
                              </div>

                              {/* Middle Metrics */}
                              <div className="hidden md:flex items-center gap-4 text-xs text-slate-500 shrink-0">
                                <span>
                                  월 검색량{' '}
                                  <strong className="text-slate-900">
                                    {topic.estimatedMonthlySearch.toLocaleString()}
                                  </strong>
                                </span>
                                <span>
                                  경쟁도{' '}
                                  <strong className="text-emerald-700">
                                    {topic.competitionRatio}
                                  </strong>
                                </span>
                                <span
                                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-50 border border-slate-200/80 px-2 py-0.5 rounded-md tabular-nums"
                                  title="키워드 발굴(생성) 일시"
                                >
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  {topic.discoveredAt ? formatDateTimeKo(topic.discoveredAt) : '-'}
                                </span>
                              </div>

                              {/* Right Actions */}
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => {
                                    if (topic.recommendedBlogId) {
                                      setSelectedBlogId(topic.recommendedBlogId);
                                      syncStudioAIForBlog(topic.recommendedBlogId);
                                    }
                                    setStudioKeyword(topic.keyword);
                                    setStudioTitle('');
                                    setActiveTab('studio');
                                  }}
                                  className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1 transition"
                                >
                                  <PenTool className="w-3 h-3" />글 작성
                                </button>
                                <button
                                  onClick={async () => {
                                    const newState = await window.electronAPI.togglePinTrend(
                                      topic.id
                                    );
                                    setState(newState);
                                    showToast(
                                      topic.pinned
                                        ? `'${topic.keyword}' 고정을 해제했습니다.`
                                        : `'${topic.keyword}' 키워드를 상단에 고정했습니다. (자동 만료·개수 정리에서 제외)`,
                                      'info'
                                    );
                                  }}
                                  className={`p-1.5 rounded-lg transition ${
                                    topic.pinned
                                      ? 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                      : 'text-slate-400 hover:text-indigo-600 hover:bg-indigo-50'
                                  }`}
                                  title={topic.pinned ? '고정 해제' : '키워드 고정 (자동 정리 제외)'}
                                >
                                  <Pin className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={async () => {
                                    const newState = await window.electronAPI.deleteTrend(
                                      topic.id
                                    );
                                    setState(newState);
                                    setSelectedBatchKeywords((prev) =>
                                      prev.filter((k) => k !== topic.keyword)
                                    );
                                  }}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                  title="삭제"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>

                            {/* Collapsible Suggested Titles Drawer */}
                            {isExpanded && (
                              <div className="px-11 pb-3.5 pt-2 bg-slate-50 border-t border-slate-200/80 space-y-2">
                                {topic.interestReason && (
                                  <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs">
                                    <div className="text-[11px] font-bold text-slate-800">
                                      왜 지금 사람들이 이 소주제를 검색할까요?
                                    </div>
                                    <div className="text-slate-600 mt-0.5">
                                      {topic.interestReason}
                                    </div>
                                  </div>
                                )}
                                <div className="text-[11px] font-semibold text-slate-500">
                                  추천 바이럴 제목 (클릭 시 해당 제목으로 글쓰기 스튜디오 이동):
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                  {topic.suggestedTitles.map((st, idx) => (
                                    <button
                                      key={idx}
                                      onClick={() => {
                                        if (topic.recommendedBlogId) {
                                          setSelectedBlogId(topic.recommendedBlogId);
                                          syncStudioAIForBlog(topic.recommendedBlogId);
                                        }
                                        setStudioKeyword(topic.keyword);
                                        setStudioTitle(st);
                                        setActiveTab('studio');
                                      }}
                                      className="text-left text-xs px-3 py-2 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-slate-800 truncate transition"
                                    >
                                      <strong className="text-blue-600 mr-1.5">
                                        {idx + 1}.
                                      </strong>
                                      {st}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

          {/* ==================== 3. UNIFIED WRITING & THUMBNAIL STUDIO ==================== */}
          {activeTab === 'studio' && (
            <div className="max-w-6xl mx-auto space-y-5">
              {/* Clean Generation Control Bar */}
              <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      1. 핵심 타겟 키워드 *
                    </label>
                    <input
                      type="text"
                      value={studioKeyword}
                      onChange={(e) => {
                        const nextKw = e.target.value;
                        setStudioKeyword(nextKw);
                        if (competitorReport && competitorReport.keyword !== nextKw.trim()) {
                          setCompetitorReport(null);
                        }
                        const firstTok = nextKw.trim().split(/\s+/)[0] || '';
                        if (studioTitle && firstTok.length >= 2 && !studioTitle.includes(firstTok)) {
                          setStudioTitle('');
                        }
                      }}
                      placeholder="예: 트럼프 관세 전망 / 청년도약계좌 만기 수령액"
                      className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-slate-900 placeholder:text-slate-400 outline-none"
                    />
                  </div>
                  <div className="md:col-span-4">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      2. 포스팅 제목 (비워두면 자동 작성)
                    </label>
                    <input
                      type="text"
                      value={studioTitle}
                      onChange={(e) => setStudioTitle(e.target.value)}
                      placeholder="비워두면 클릭률 높은 제목으로 자동 생성"
                      className="w-full bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      3. 사용할 AI 엔진
                    </label>
                    <select
                      value={studioAIProvider}
                      onChange={(e) => {
                        const nextId = e.target.value as WebAIProviderId;
                        setStudioAIProvider(nextId);
                        setStudioAIModel('');
                      }}
                      className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2.5 text-xs font-semibold text-slate-900 outline-none"
                    >
                      {state.webAISessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                      4. 세부 모델 선택 (즉시 변경 가능)
                    </label>
                    {(() => {
                      const activeProviderObj = state.webAISessions.find(
                        (s) => s.id === studioAIProvider
                      );
                      const models = activeProviderObj?.availableModels || [];
                      return (
                        <select
                          value={studioAIModel}
                          onChange={(e) => setStudioAIModel(e.target.value)}
                          className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2.5 text-xs font-semibold text-slate-900 outline-none"
                        >
                          <option value="">
                            기본 설정 모델 ({activeProviderObj?.selectedModel || '자동'})
                          </option>
                          {models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.label}
                            </option>
                          ))}
                        </select>
                      );
                    })()}
                  </div>
                </div>

                {/* Action Row */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleAnalyzeCompetitors(studioKeyword)}
                      className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                    >
                      <Award className="w-3.5 h-3.5 text-amber-500" />
                      상위 1~5위 경쟁글 분석 적용
                    </button>
                    <button
                      onClick={() => setShowReferenceSourceInput(!showReferenceSourceInput)}
                      className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                    >
                      <Globe className="w-3.5 h-3.5 text-blue-600" />
                      {showReferenceSourceInput
                        ? '참고 URL/원문 닫기 ▲'
                        : '참고 뉴스 URL / 원문 자료 넣기'}
                    </button>
                    <button
                      onClick={() => setShowCustomPromptInput(!showCustomPromptInput)}
                      className="px-3 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold shadow-sm transition"
                    >
                      {showCustomPromptInput ? '추가 지시사항 닫기 ▲' : '+ 추가 요청사항 입력'}
                    </button>
                  </div>

                  <button
                    onClick={() => handleGenerateInStudio(false)}
                    className="px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-2 shadow-sm transition"
                  >
                    <PenTool className="w-3.5 h-3.5" />
                    AI 원고 & 썸네일 생성하기
                  </button>
                </div>

                {(() => {
                  if (!activeBlog || !studioKeyword.trim()) return null;
                  const cooldownDays = state.settings.duplicateCooldownDays ?? 14;
                  const normInput = studioKeyword
                    .toLowerCase()
                    .replace(/[\s·,\-_/\[\]()!?'"“”‘’|｜]/g, '');
                  if (normInput.length < 2) return null;
                  const inputTokens = studioKeyword
                    .toLowerCase()
                    .split(/[,·~?!…:\s/()\[\]]+/)
                    .map((w) => w.replace(/(은|는|이|가|을|를|의|에|에서|으로|로)$/, '').trim())
                    .filter((w) => w.length >= 2 && !/^202[0-9]년?$/.test(w));

                  const nowMs = Date.now();
                  let matched: { post: BlogPost; ageDays: number; remainingDays: number } | null = null;
                  for (const p of state.posts) {
                    if (p.blogId !== activeBlog.id) continue;
                    const refMs = new Date(p.publishedAt || p.createdAt).getTime();
                    const ageDays = Number.isFinite(refMs)
                      ? Math.max(0, Math.floor((nowMs - refMs) / 86400000))
                      : 0;
                    if (ageDays >= cooldownDays) continue;

                    const normPost = (p.targetKeyword || '')
                      .toLowerCase()
                      .replace(/[\s·,\-_/\[\]()!?'"“”‘’|｜]/g, '');
                    const isSubMatch =
                      normInput === normPost ||
                      (normInput.length >= 5 && normPost.includes(normInput)) ||
                      (normPost.length >= 5 && normInput.includes(normPost));

                    let isTokenMatch = false;
                    if (!isSubMatch && inputTokens.length >= 2) {
                      const postTokens = new Set(
                        (p.targetKeyword || '')
                          .toLowerCase()
                          .split(/[,·~?!…:\s/()\[\]]+/)
                          .map((w) => w.replace(/(은|는|이|가|을|를|의|에|에서|으로|로)$/, '').trim())
                          .filter((w) => w.length >= 2 && !/^202[0-9]년?$/.test(w))
                      );
                      const shared = inputTokens.filter((t) => postTokens.has(t)).length;
                      const minCount = Math.min(inputTokens.length, postTokens.size);
                      if (shared >= 2 && shared / Math.max(1, minCount) >= 0.65) {
                        isTokenMatch = true;
                      }
                    }

                    if (isSubMatch || isTokenMatch) {
                      matched = {
                        post: p,
                        ageDays,
                        remainingDays: Math.max(1, cooldownDays - ageDays),
                      };
                      break;
                    }
                  }
                  if (!matched) return null;

                  return (
                    <div className="p-3.5 rounded-lg bg-amber-50 border border-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-0.5 text-xs">
                        <div className="font-bold text-amber-900 flex items-center gap-1.5">
                          <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                          최근 작성된 동일·유사 주제 감지 (재작성 쿨타임 {matched.remainingDays}일 남음)
                        </div>
                        <div className="text-amber-800">
                          기존 글: <strong className="font-semibold">"{matched.post.title}"</strong> (
                          {formatDateTimeKo(matched.post.publishedAt || matched.post.createdAt)} ·{' '}
                          {matched.post.status === 'published' ? '발행 완료' : '검수 대기'})
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => openPostInStudio(matched!.post, false)}
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-amber-100/50 border border-amber-300 text-amber-900 text-xs font-semibold transition"
                        >
                          기존 원고 열기
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateInStudio(true)}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold transition"
                        >
                          최신 내용으로 강제 새로 작성
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {showReferenceSourceInput && (
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-800">
                        참고할 뉴스 기사 URL 또는 정책 공고문/메모 텍스트 붙여넣기 (본문 팩트 100% 반영 재창작)
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!studioReferenceSource.trim()) {
                            showToast('참고할 URL이나 원문 텍스트를 입력해주세요.', 'error');
                            return;
                          }
                          const myRunId = ++taskRunIdRef.current;
                          setBusyMessage('참고 URL/원문에서 핵심 본문과 숫자 팩트를 추출하고 있습니다...');
                          try {
                            const info = await window.electronAPI.extractReferenceSource(
                              studioReferenceSource
                            );
                            if (myRunId !== taskRunIdRef.current) return;
                            setExtractedRefInfo({
                              sourceTitle: info.sourceTitle,
                              extractedFacts: info.extractedFacts,
                            });
                            if (!studioKeyword.trim() && info.suggestedKeyword) {
                              setStudioKeyword(info.suggestedKeyword);
                            }
                            showToast(
                              `원문 추출 완료: "${info.sourceTitle}" (핵심 팩트 ${info.extractedFacts.length}건 확인)`,
                              'success'
                            );
                          } catch (e: any) {
                            if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                            showToast(e.message || '원문 추출 실패', 'error');
                          } finally {
                            if (myRunId === taskRunIdRef.current) {
                              setBusyMessage(null);
                            }
                          }
                        }}
                        className="px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold shrink-0 transition"
                      >
                        URL 본문·팩트 미리 추출 확인
                      </button>
                    </div>
                    <textarea
                      rows={3}
                      value={studioReferenceSource}
                      onChange={(e) => setStudioReferenceSource(e.target.value)}
                      placeholder="예: https://n.news.naver.com/... 뉴스 링크를 붙여넣거나, 글에 꼭 반영하고 싶은 보도자료/메모 내용을 자유롭게 붙여넣어 주세요. 원고 생성 시 해당 팩트를 내 블로그 말투로 재창작합니다."
                      className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none leading-relaxed"
                    />
                    {extractedRefInfo && (
                      <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-700 space-y-1">
                        <div className="font-bold text-blue-600">
                          ✓ 추출된 출처 제목: {extractedRefInfo.sourceTitle}
                        </div>
                        {extractedRefInfo.extractedFacts.length > 0 && (
                          <div className="text-slate-600">
                            핵심 팩트 {extractedRefInfo.extractedFacts.length}건 반영 준비 완료 (예:{' '}
                            {extractedRefInfo.extractedFacts[0]})
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {showCustomPromptInput && (
                  <input
                    type="text"
                    value={studioCustomPrompt}
                    onChange={(e) => setStudioCustomPrompt(e.target.value)}
                    placeholder="추가 지시사항 (예: 2030 사회초년생 예시를 넣어줘, 장단점 표를 자세히 써줘)"
                    className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                  />
                )}

                {competitorReport && (
                  <div className="p-3.5 rounded-lg bg-amber-50/60 border border-amber-200 flex items-start justify-between gap-3 text-xs">
                    <div className="space-y-1.5">
                      <div className="font-bold text-amber-800">
                        ✓ 네이버 상위 1~5위 본문 정밀 크롤링 완료 (권장 글자수:{' '}
                        {(competitorReport.recommendedCharCount || 2200).toLocaleString()}자 이상)
                      </div>
                      <div className="text-slate-700">
                        <span className="text-slate-500 font-semibold">필수 포함 연관어:</span>{' '}
                        {competitorReport.extractedSubKeywords.join(', ')}
                      </div>
                      {competitorReport.competitorHeadings &&
                        competitorReport.competitorHeadings.length > 0 && (
                          <div className="text-slate-700 text-[11px]">
                            <span className="text-slate-500 font-semibold">상위글 핵심 소제목:</span>{' '}
                            {competitorReport.competitorHeadings.slice(0, 4).join(' · ')}
                          </div>
                        )}
                      {competitorReport.extractedKeyFacts &&
                        competitorReport.extractedKeyFacts.length > 0 && (
                          <div className="text-emerald-700 text-[11px]">
                            <span className="text-slate-500 font-semibold">추출된 실전 팩트:</span>{' '}
                            상위 본문에서 숫자·조건 핵심 문장 {competitorReport.extractedKeyFacts.length}건 원고 자동 반영됨
                          </div>
                        )}
                    </div>
                    <button
                      onClick={() => setCompetitorReport(null)}
                      className="text-slate-400 hover:text-slate-700 shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Editor + Thumbnail + Live SEO Panel */}
              {!currentPost ? (
                <div className="p-14 rounded-xl bg-white border border-dashed border-slate-300 text-center space-y-2">
                  <PenTool className="w-10 h-10 text-slate-400 mx-auto" />
                  <div className="text-sm font-bold text-slate-900">
                    위 입력창에 키워드를 입력하고 [AI 원고 & 썸네일 생성하기]를 눌러주세요
                  </div>
                  <p className="text-xs text-slate-500">
                    생성된 원고 미리보기, 마크다운 편집, 대표 썸네일 커스텀, 실시간 SEO 점수가 이곳에 표시됩니다.
                  </p>
                </div>
              ) : (() => {
                const currentPostBlog =
                  state.blogs.find((b) => b.id === currentPost.blogId) || activeBlog;
                const postPlatformMeta = currentPostBlog
                  ? PLATFORM_META[currentPostBlog.platform]
                  : null;
                return (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                  {/* Left 8 Cols: Preview / Markdown / Thumbnail Switcher */}
                  <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {currentPostBlog && postPlatformMeta && (
                          <span
                            className={`text-[11px] font-bold px-2.5 py-1 rounded-md border ${postPlatformMeta.badgeBg}`}
                            title="현재 열린 원고의 소속 블로그"
                          >
                            [{postPlatformMeta.label}] {currentPostBlog.name}
                          </span>
                        )}
                        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/80">
                        <button
                          onClick={async () => {
                            if (currentPost) {
                              await handleSaveCurrentPost(currentPost);
                            }
                            setStudioViewMode('preview');
                          }}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                            studioViewMode === 'preview'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                          서식 미리보기
                        </button>
                        <button
                          onClick={() => setStudioViewMode('markdown')}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                            studioViewMode === 'markdown'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <FileCode className="w-3.5 h-3.5" />
                          본문 수정
                        </button>
                        <button
                          onClick={() => setStudioViewMode('thumbnail')}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                            studioViewMode === 'thumbnail'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          <ImageIcon className="w-3.5 h-3.5" />
                          썸네일 디자인
                        </button>
                      </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={async () => {
                            try {
                              const res = await window.electronAPI.toggleInlineImages({
                                postId: currentPost.id,
                                markdownContent: currentPost.markdownContent,
                              });
                              setCurrentPost(res.post);
                              setState(res.state);
                              showToast(res.message, 'success');
                            } catch (e: any) {
                              showToast(e.message || '이미지 토글 실패', 'error');
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                          title="글 주제 성격에 맞춰 실사 사진·테크 다이어그램·핵심 요약카드(가벼운 라이프 주제는 AI 일러스트 포함)를 본문 적재적소에 자동 배치하거나 제거합니다"
                        >
                          <ImageIcon className="w-3.5 h-3.5 text-slate-600" />
                          {/!\[[^\]]*\]\((?:https?:\/\/|data:image\/)[^)]+\)/.test(
                            currentPost.markdownContent
                          )
                            ? '본문 맞춤 이미지 제거'
                            : '+ 본문 맞춤 이미지 자동배치'}
                        </button>
                        <button
                          onClick={() => handleCopyRichHtml(currentPost)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          서식 HTML 복사 (Ctrl+V용)
                        </button>
                        {currentPost.status === 'published' ? (
                          <button
                            type="button"
                            disabled
                            className="px-4 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-1.5 cursor-not-allowed opacity-85"
                            title="이미 발행 완료된 원고는 유사문서 저품질 방지를 위해 중복 재발행이 차단됩니다"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            발행 완료됨
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePublishPost(currentPost, true)}
                            className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                          >
                            <Send className="w-3.5 h-3.5" />
                            블로그 자동 발행
                          </button>
                        )}
                      </div>
                    </div>

                    {studioViewMode === 'thumbnail' ? (
                      <ThumbnailCanvas
                        config={thumbnailConfig}
                        onChange={setThumbnailConfig}
                        onApplyToCurrentPost={async (dataUrl) => {
                          const updated: BlogPost = {
                            ...currentPost,
                            thumbnail: { ...thumbnailConfig, dataUrl },
                          };
                          await handleSaveCurrentPost(updated);
                          setStudioViewMode('preview');
                        }}
                      />
                    ) : (
                      <>
                        {/* Editable Title */}
                        <div>
                          <input
                            type="text"
                            value={currentPost.title}
                            onChange={(e) =>
                              setCurrentPost({ ...currentPost, title: e.target.value })
                            }
                            onBlur={() => handleSaveCurrentPost(currentPost)}
                            className="w-full bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white rounded-lg px-4 py-2.5 text-sm font-bold text-slate-900 outline-none transition"
                          />
                        </div>

                        {/* Interactive Tag Editor Bar */}
                        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-50 border border-slate-200/80">
                          <span className="text-[11px] font-semibold text-slate-500 mr-1 shrink-0">
                            발행 태그 ({(currentPost.tags || []).length}/6)
                          </span>
                          {(currentPost.tags || []).map((tag) => (
                            <span
                              key={tag}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-slate-200 text-xs font-medium text-slate-700"
                            >
                              <span>#{tag}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const nextTags = (currentPost.tags || []).filter((t) => t !== tag);
                                  const updated = { ...currentPost, tags: nextTags };
                                  setCurrentPost(updated);
                                  void handleSaveCurrentPost(updated);
                                }}
                                className="text-slate-400 hover:text-rose-600 transition"
                                title="태그 제거"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                          {(currentPost.tags || []).length < 6 && (
                            <input
                              type="text"
                              value={newTagInput}
                              onChange={(e) => setNewTagInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const cleaned = newTagInput
                                    .replace(/[#]/g, '')
                                    .replace(/[,·~?!…:"'“”‘’\[\]()【】「」『』/|]/g, '')
                                    .replace(/\s+/g, '')
                                    .trim();
                                  if (cleaned.length < 2) {
                                    showToast('태그는 2글자 이상 입력해주세요.', 'info');
                                    return;
                                  }
                                  const existing = currentPost.tags || [];
                                  if (existing.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
                                    setNewTagInput('');
                                    return;
                                  }
                                  const nextTags = [...existing, cleaned].slice(0, 6);
                                  const updated = { ...currentPost, tags: nextTags };
                                  setCurrentPost(updated);
                                  setNewTagInput('');
                                  void handleSaveCurrentPost(updated);
                                }
                              }}
                              placeholder="+ 태그 추가 후 Enter"
                              className="bg-white border border-slate-300 focus:border-slate-900 rounded-md px-2 py-0.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none w-36"
                            />
                          )}
                        </div>

                        {studioViewMode === 'preview' ? (
                          <div className="bg-slate-50 p-3 sm:p-4 rounded-xl border border-slate-200">
                            {/* Magazine Header Bar */}
                            <div className="bg-white rounded-t-xl px-6 sm:px-10 pt-7 pb-4 border border-b-slate-100 border-slate-200/80 flex flex-wrap items-center justify-between gap-3 text-xs">
                              <div className="flex items-center gap-2">
                                <span className="px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold text-[11px] border border-blue-200">
                                  {currentPost.category ||
                                    currentPostBlog?.auth.defaultCategory ||
                                    '에디토리얼 매거진'}
                                </span>
                                <span className="text-slate-300">•</span>
                                <span className="font-semibold text-slate-700">
                                  {currentPostBlog?.name || 'BlogStater'}
                                </span>
                              </div>
                              <div className="flex items-center gap-2.5 text-[11px] text-slate-500">
                                <span>예상 독서 시간: 약 {Math.max(1, Math.ceil((currentPost.markdownContent || '').length / 450))}분</span>
                                <span>•</span>
                                <span>{new Date(currentPost.createdAt || Date.now()).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
                              </div>
                            </div>

                            {/* Modern Editorial Reading Canvas */}
                            <div className="bg-white rounded-b-xl p-6 sm:p-10 max-h-[600px] overflow-y-auto article-preview-container select-text border-x border-b border-slate-200/80 shadow-sm">
                              <div
                                dangerouslySetInnerHTML={{ __html: currentPost.htmlContent }}
                              />
                            </div>
                          </div>
                        ) : (
                          <textarea
                            value={currentPost.markdownContent}
                            onChange={(e) =>
                              setCurrentPost({
                                ...currentPost,
                                markdownContent: e.target.value,
                              })
                            }
                            onBlur={() => handleSaveCurrentPost(currentPost)}
                            rows={22}
                            className="w-full bg-slate-50 border border-slate-300 focus:border-slate-900 focus:bg-white rounded-lg p-4 text-xs font-mono text-slate-800 leading-relaxed focus:outline-none select-text transition"
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Right 4 Cols: Multi-Engine SEO + AEO + GEO + D.I.A.+ Scorecard */}
                  <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4 h-fit">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5 tracking-tight">
                          <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          SEO · AEO · GEO 통합 점수
                        </h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          생성 엔진: {currentPost.aiProviderUsed}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-2xl font-bold text-emerald-600 whitespace-nowrap">
                          {currentPost.seoReport.totalScore}점
                        </span>
                      </div>
                    </div>

                    {/* 4-Dimension Sub-score Breakdown (SEO / AEO / GEO / D.I.A.+) */}
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[10px] font-bold text-blue-700">SEO 검색</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          {currentPost.seoReport.seoScore ?? currentPost.seoReport.totalScore}점
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[10px] font-bold text-sky-700">AEO 답변</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          {currentPost.seoReport.aeoScore ?? currentPost.seoReport.totalScore}점
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[10px] font-bold text-violet-700">GEO 인용</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          {currentPost.seoReport.geoScore ?? currentPost.seoReport.totalScore}점
                        </div>
                      </div>
                      <div className="p-2 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[10px] font-bold text-emerald-700">D.I.A.+</div>
                        <div className="text-xs font-bold text-slate-900 mt-0.5">
                          {currentPost.seoReport.diaScore ?? currentPost.seoReport.totalScore}점
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-slate-500 text-[11px]">공백 제외 글자수</div>
                        <div className="text-sm font-bold text-slate-900 mt-0.5">
                          {currentPost.seoReport.charCount.toLocaleString()}자
                        </div>
                      </div>
                      <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-slate-500 text-[11px]">예상 체류시간</div>
                        <div className="text-sm font-bold text-amber-700 mt-0.5">
                          약 {Math.floor(currentPost.seoReport.estimatedDwellSeconds / 60)}분{' '}
                          {currentPost.seoReport.estimatedDwellSeconds % 60}초
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
                      {currentPost.seoReport.checks.map((chk) => {
                        const cat = chk.category || 'SEO';
                        const badgeClass =
                          cat === 'AEO'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : cat === 'GEO'
                            ? 'bg-violet-50 text-violet-700 border-violet-200'
                            : cat === 'DIA'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-blue-50 text-blue-700 border-blue-200';
                        return (
                          <div
                            key={chk.id}
                            className="p-2.5 rounded-lg bg-slate-50/70 border border-slate-200/80 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-slate-800 font-medium min-w-0">
                                {chk.passed ? (
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                ) : (
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                )}
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold border shrink-0 ${badgeClass}`}
                                >
                                  {cat === 'DIA' ? 'D.I.A.+' : cat}
                                </span>
                                <span className="truncate">{chk.label}</span>
                              </span>
                              <span className="text-slate-700 font-bold shrink-0">
                                {chk.score}/{chk.maxScore}
                              </span>
                            </div>
                            {chk.detail && (
                              <div className="text-[10px] text-slate-500 pl-5 truncate">
                                {chk.detail}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* One-Click Auto Polish & IndexNow Actions */}
                    <div className="pt-2 border-t border-slate-200 space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={async () => {
                            const myRunId = ++taskRunIdRef.current;
                            setBusyMessage('SEO · AEO · GEO 감점 요인을 분석하여 본문을 자동 보강하고 있습니다...');
                            try {
                              const res = await window.electronAPI.polishPost({
                                postId: currentPost.id,
                                mode: 'boost_scores',
                                markdownContent: currentPost.markdownContent,
                              });
                              if (myRunId !== taskRunIdRef.current) return;
                              setCurrentPost(res.post);
                              setState(res.state);
                              showToast(res.message, 'success');
                            } catch (e: any) {
                              if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                              showToast(e.message || '자동 보강 실패', 'error');
                            } finally {
                              if (myRunId === taskRunIdRef.current) {
                                setBusyMessage(null);
                              }
                            }
                          }}
                          className="py-2 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          감점 항목 원클릭 보강
                        </button>
                        <button
                          onClick={async () => {
                            const myRunId = ++taskRunIdRef.current;
                            setBusyMessage('사람 말투와 모바일 문단 호흡으로 원고를 자연스럽게 다듬고 있습니다...');
                            try {
                              const res = await window.electronAPI.polishPost({
                                postId: currentPost.id,
                                mode: 'humanize_tone',
                                markdownContent: currentPost.markdownContent,
                              });
                              if (myRunId !== taskRunIdRef.current) return;
                              setCurrentPost(res.post);
                              setState(res.state);
                              showToast(res.message, 'success');
                            } catch (e: any) {
                              if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                              showToast(e.message || '말투 교정 실패', 'error');
                            } finally {
                              if (myRunId === taskRunIdRef.current) {
                                setBusyMessage(null);
                              }
                            }
                          }}
                          className="py-2 px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 text-xs font-bold flex items-center justify-center gap-1.5 transition"
                        >
                          <PenTool className="w-3.5 h-3.5" />
                          사람 말투·호흡 다듬기
                        </button>
                      </div>

                      <button
                        onClick={async () => {
                          const myRunId = ++taskRunIdRef.current;
                          setBusyMessage('AI 검색엔진(IndexNow · Bing · Perplexity)에 즉시 색인 핑을 전송하고 있습니다...');
                          try {
                            const res = await window.electronAPI.pingIndexNow(currentPost.id);
                            if (myRunId !== taskRunIdRef.current) return;
                            setState(res.state);
                            showToast(res.message, 'success');
                          } catch (e: any) {
                            if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                            showToast(e.message || '색인 핑 전송 실패', 'error');
                          } finally {
                            if (myRunId === taskRunIdRef.current) {
                              setBusyMessage(null);
                            }
                          }
                        }}
                        className="w-full py-2 px-3 rounded-lg bg-slate-100 hover:bg-slate-200/80 border border-slate-200 text-slate-800 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                      >
                        <Zap className="w-3.5 h-3.5 text-slate-700" />
                        AI 검색(ChatGPT·Perplexity·Bing) 즉시 색인 핑(IndexNow)
                      </button>
                    </div>
                  </div>
                </div>
                );
              })()}
            </div>
          )}

          {/* ==================== 4. PUBLISHING QUEUE & WORK CALENDAR ==================== */}
          {activeTab === 'queue' && (
            <div className="max-w-6xl mx-auto space-y-5">
              {/* Top View Switcher: List vs Monthly Calendar */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/80">
                  <button
                    onClick={() => setQueueSubView('list')}
                    className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                      queueSubView === 'list'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <CheckSquare className="w-4 h-4" />
                    원고 검수 대기열 & 전체 글 ({state.posts.length})
                  </button>
                  <button
                    onClick={() => setQueueSubView('calendar')}
                    className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                      queueSubView === 'calendar'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <CalendarIcon className="w-4 h-4" />
                    월간 날짜별 작업 캘린더 & 엑셀 리포트
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={async () => {
                      if (state.posts.length === 0) {
                        showToast('조회할 원고가 없습니다.', 'info');
                        return;
                      }
                      const myRunId = ++taskRunIdRef.current;
                      setBusyMessage(
                        `전체 글(${state.posts.length}건)의 네이버 검색 노출 순위를 일괄 조회하고 있습니다...`
                      );
                      try {
                        const res = await window.electronAPI.checkAllPostsRank();
                        if (myRunId !== taskRunIdRef.current) return;
                        setState(res.state);
                        showToast(res.message, 'success');
                      } catch (e: any) {
                        if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                        showToast(e.message || '일괄 순위 조회 실패', 'error');
                      } finally {
                        if (myRunId === taskRunIdRef.current) {
                          setBusyMessage(null);
                        }
                      }
                    }}
                    className="px-3.5 py-2 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-xs font-semibold text-sky-700 flex items-center gap-1.5 transition"
                  >
                    <Search className="w-4 h-4" />
                    전체 글 검색 순위 일괄 조회
                  </button>
                  <button
                    onClick={() => window.electronAPI.openExportFolder()}
                    className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 flex items-center gap-1.5 shadow-sm transition"
                  >
                    <FolderOpen className="w-4 h-4 text-slate-600" />
                    로컬 발행 파일(MD/HTML/PNG) 폴더 열기
                  </button>
                </div>
              </div>

              {queueSubView === 'calendar' ? (
                <WorkCalendarView
                  state={state}
                  onOpenPostInStudio={(post) => openPostInStudio(post)}
                  onCopyRichHtml={handleCopyRichHtml}
                  onPublishPost={handlePublishPost}
                  onCheckRank={handleCheckPostRank}
                  onCreatePostForDate={handleCreatePostForDate}
                  onExportReport={handleExportReport}
                />
              ) : (
                <div className="space-y-3">
                  {state.posts.length === 0 ? (
                    <div className="p-12 rounded-xl bg-white border border-dashed border-slate-300 text-center space-y-2">
                      <CheckSquare className="w-10 h-10 text-emerald-600 mx-auto" />
                      <div className="text-sm font-bold text-slate-900">
                        작성된 포스팅 원고가 없습니다
                      </div>
                    </div>
                  ) : (
                    state.posts.map((post) => {
                      const blog = state.blogs.find((b) => b.id === post.blogId);
                      return (
                        <div
                          key={post.id}
                          className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                        >
                          <div className="space-y-1 flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                                {blog?.name || '블로그'}
                              </span>
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                                  post.status === 'published'
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                                }`}
                              >
                                {post.status === 'published' ? '✓ 발행 완료' : '● 검수 대기'}
                              </span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-violet-50 border border-violet-200 text-violet-700">
                                SEO {post.seoReport.totalScore}점
                              </span>
                              {post.rankInfo && (
                                <span className="text-xs font-semibold px-2 py-0.5 rounded bg-sky-50 border border-sky-200 text-sky-700">
                                  {post.rankInfo.summaryText}
                                </span>
                              )}
                              <span className="text-xs text-slate-500">
                                생성: {formatDateTimeKo(post.createdAt)}
                                {post.publishedAt
                                  ? ` · 발행: ${formatDateTimeKo(post.publishedAt)}`
                                  : ' · 미발행'}
                              </span>
                            </div>
                            <h3 className="text-sm font-bold text-slate-900 truncate">
                              {post.title}
                            </h3>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <button
                              onClick={() => openPostInStudio(post)}
                              className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 transition"
                            >
                              열기/편집
                            </button>
                            <button
                              onClick={async () => {
                                const myRunId = ++taskRunIdRef.current;
                                setBusyMessage(
                                  `[${post.title}] AEO · GEO · 사람 말투 보강 리라이팅을 진행하고 있습니다...`
                                );
                                try {
                                  const res = await window.electronAPI.polishPost({
                                    postId: post.id,
                                    mode: 'boost_scores',
                                    markdownContent: post.markdownContent,
                                  });
                                  if (myRunId !== taskRunIdRef.current) return;
                                  setState(res.state);
                                  openPostInStudio(res.post);
                                  showToast(
                                    `[${res.post.title}] 리라이팅 보강 완료! (통합 점수: ${res.post.seoReport.totalScore}점)`,
                                    'success'
                                  );
                                } catch (e: any) {
                                  if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                                  showToast(e.message || '리라이팅 보강 실패', 'error');
                                } finally {
                                  if (myRunId === taskRunIdRef.current) {
                                    setBusyMessage(null);
                                  }
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-amber-700 text-xs font-semibold transition"
                              title="이 글을 스튜디오로 불러와 AEO·GEO·사람 말투 보강 리라이팅을 즉시 수행합니다"
                            >
                              원클릭 보강 리라이팅
                            </button>
                            <button
                              onClick={() => handleCheckPostRank(post.id)}
                              className="px-3 py-1.5 rounded-lg bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-700 text-xs font-semibold transition"
                            >
                              순위 조회
                            </button>
                            <button
                              onClick={() => handleCopyRichHtml(post)}
                              className="px-3 py-1.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-xs font-semibold transition"
                            >
                              HTML 복사
                            </button>
                            {post.status === 'published' ? (
                              <button
                                type="button"
                                disabled
                                className="px-3.5 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold cursor-not-allowed opacity-85"
                                title="이미 발행 완료된 글은 동일 내용 재발행을 차단합니다"
                              >
                                ✓ 발행 완료됨
                              </button>
                            ) : (
                              <button
                                onClick={() => handlePublishPost(post, true)}
                                className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition"
                              >
                                자동 발행
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                const updated = await window.electronAPI.deletePost(post.id);
                                setState(updated);
                                if (currentPost?.id === post.id) {
                                  const nextPost =
                                    updated.posts.find((p) => p.blogId === selectedBlogId) ||
                                    updated.posts[0] ||
                                    null;
                                  setCurrentPost(nextPost);
                                  if (nextPost?.thumbnail) {
                                    setThumbnailConfig(nextPost.thumbnail);
                                  }
                                }
                                showToast('포스팅이 삭제되었습니다.', 'info');
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* ==================== 5. BLOGS & MONETIZATION SETTINGS ==================== */}
          {activeTab === 'blogs' && (
            <div className="max-w-6xl mx-auto space-y-5">
              {/* Sub-tab Switcher: Blog Profiles vs Monetization Links */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-3">
                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200/80">
                  <button
                    onClick={() => setBlogsSubView('profiles')}
                    className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                      blogsSubView === 'profiles'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Globe className="w-4 h-4" />
                    등록된 블로그 관리 ({state.blogs.length})
                  </button>
                  <button
                    onClick={() => setBlogsSubView('affiliates')}
                    className={`px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-1.5 transition ${
                      blogsSubView === 'affiliates'
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <DollarSign className="w-4 h-4" />
                    쿠팡 파트너스 & 제휴 링크 관리 ({state.affiliates.length})
                  </button>
                </div>

                {blogsSubView === 'profiles' && (
                  <button
                    onClick={handleCreateNewBlogTemplate}
                    className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                  >
                    <Plus className="w-4 h-4" />새 블로그 등록
                  </button>
                )}
              </div>

              {/* Browser Automation Engine (Aside AI Browser Integration) */}
              {blogsSubView === 'profiles' && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900">
                        브라우저 자동 조작 엔진 (Aside AI 브라우저 연동)
                      </span>
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                          asideStatus?.installed
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {asideStatus?.installed
                          ? `● Aside 감지됨 (${asideStatus.version || '설치됨'})`
                          : '○ Aside 미설치'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Aside 브라우저에 블로그를 1회 로그인해 두면 별도 세션 충돌이나 봇 탐지 없이 에디터 자동 입력·발행이 훨씬 안정적으로 동작합니다.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={state.settings.browserAutomationEngine === 'playwright' ? 'playwright' : 'aside'}
                      onChange={async (e) => {
                        const engine = e.target.value as 'aside' | 'playwright';
                        const newState = await window.electronAPI.updateSettings({
                          browserAutomationEngine: engine,
                        });
                        setState(newState);
                        showToast(
                          engine === 'aside'
                            ? '브라우저 자동화 엔진이 [Aside AI 브라우저 (독립 엔진)]으로 설정되었습니다.'
                            : '브라우저 자동화 엔진이 [Playwright 내장 브라우저 (독립 엔진)]으로 설정되었습니다.',
                          'success'
                        );
                      }}
                      className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 outline-none"
                    >
                      <option value="aside">Aside AI 브라우저 (독립 엔진)</option>
                      <option value="playwright">Playwright 내장 브라우저 (독립 엔진)</option>
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await window.electronAPI.detectAsideBrowser();
                        setAsideStatus(res);
                        showToast(
                          res.installed
                            ? `Aside 감지 완료! (${res.version || res.path})`
                            : 'PC에서 Aside 실행 파일을 찾지 못했습니다.',
                          res.installed ? 'success' : 'info'
                        );
                      }}
                      className="p-2 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 shadow-sm transition"
                      title="Aside 설치 상태 다시 확인"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* Duplicate Post Prevention Cooldown Setting */}
              {blogsSubView === 'profiles' && (
                <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span className="text-xs font-bold text-slate-900">
                        중복 게시물 방어 & 오래된 주제 재작성 쿨타임 설정
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      최근 N일 이내에 작성·발행한 동일·유사 주제는 자동 생성과 발행을 차단해 유사문서(저품질)를 막고, 쿨타임이 지난 오래된 주제만 최신 정보로 새로 작성합니다.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={state.settings.duplicateCooldownDays ?? 14}
                      onChange={async (e) => {
                        const days = parseInt(e.target.value, 10) || 14;
                        const newState = await window.electronAPI.updateSettings({
                          duplicateCooldownDays: days,
                        });
                        setState(newState);
                        showToast(
                          days >= 3650
                            ? '중복 게시물 쿨타임이 [영구 차단]으로 설정되었습니다.'
                            : `중복 게시물 방어 쿨타임이 [${days}일]로 설정되었습니다.`,
                          'success'
                        );
                      }}
                      className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 outline-none"
                    >
                      <option value={7}>7일 (최근 1주 내 동일 주제 차단)</option>
                      <option value={14}>14일 (최근 2주 내 차단 · 권장)</option>
                      <option value={30}>30일 (최근 한 달 내 차단)</option>
                      <option value={60}>60일 (최근 두 달 내 차단)</option>
                      <option value={3650}>영구 차단 (이미 쓴 주제는 자동 재작성 안 함)</option>
                    </select>
                  </div>
                </div>
              )}

              {blogsSubView === 'profiles' ? (
                state.blogs.length === 0 ? (
                  <div className="p-12 rounded-xl bg-white border border-dashed border-slate-300 text-center space-y-3">
                    <Globe className="w-10 h-10 text-slate-400 mx-auto" />
                    <div className="text-base font-bold text-slate-900">
                      등록된 블로그가 없습니다
                    </div>
                    <button
                      onClick={handleCreateNewBlogTemplate}
                      className="px-5 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold inline-flex items-center gap-2 shadow-sm transition"
                    >
                      <Plus className="w-4 h-4" />새 블로그 등록하기
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {state.blogs.map((blog) => {
                      const pMeta = PLATFORM_META[blog.platform];
                      return (
                        <div
                          key={blog.id}
                          className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4"
                        >
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-xs font-semibold px-2.5 py-0.5 rounded-md border ${pMeta.badgeBg}`}
                              >
                                {pMeta.label}
                              </span>
                              <span
                                className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${
                                  blog.auth.sessionLoggedIn
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-slate-100 text-slate-600 border-slate-200'
                                }`}
                              >
                                {blog.auth.sessionLoggedIn
                                  ? '● 로그인 세션 연결됨'
                                  : '○ 로그인 필요'}
                              </span>
                            </div>

                            <div>
                              <h3 className="text-base font-bold text-slate-900 tracking-tight">{blog.name}</h3>
                              <p className="text-xs text-slate-500 mt-0.5">{blog.auth.blogUrl}</p>
                            </div>

                            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-xs space-y-1.5">
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500 shrink-0">핵심 주제 키워드:</span>
                                <span className="text-emerald-700 font-semibold text-right">
                                  {blog.nicheKeywords.join(', ')}
                                </span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500 shrink-0">주력 AI & 세부 모델:</span>
                                <span className="text-slate-900 font-bold text-right">
                                  {(() => {
                                    const p = state.webAISessions.find(
                                      (s) => s.id === blog.schedule.preferredAIProvider
                                    );
                                    const modelName =
                                      blog.schedule.preferredModel || p?.selectedModel || '기본 모델';
                                    return `${p?.id.toUpperCase() || 'AI'} · ${modelName}`;
                                  })()}
                                </span>
                              </div>
                              <div className="flex justify-between gap-2">
                                <span className="text-slate-500 shrink-0">페르소나 문체:</span>
                                <span className="text-slate-700 font-medium text-right">{blog.persona.name}</span>
                              </div>
                              <div className="flex justify-between items-center gap-2">
                                <span className="text-slate-500 shrink-0">발행 스케줄:</span>
                                <button
                                  type="button"
                                  onClick={() => openEditBlogModal(blog)}
                                  className="inline-flex items-center gap-1 text-blue-700 hover:underline font-semibold text-right"
                                >
                                  <Clock className="w-3 h-3 shrink-0" />
                                  {blog.schedule.enabled
                                    ? formatScheduleSummary(blog.schedule)
                                    : `일시중지 (${formatScheduleSummary(blog.schedule)})`}
                                </button>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 pt-2 border-t border-slate-200/80">
                            <button
                              onClick={() => handleOpenBlogLogin(blog.id)}
                              className="flex-1 py-2 px-3 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                            >
                              <LogIn className="w-3.5 h-3.5" />
                              로그인 세션 연결
                            </button>
                            <button
                              onClick={() => openEditBlogModal(blog)}
                              className="py-2 px-4 rounded-lg bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold shadow-sm transition"
                            >
                              설정 수정
                            </button>
                            <button
                              onClick={async () => {
                                const updated = await window.electronAPI.deleteBlog(blog.id);
                                setState(updated);
                                showToast('블로그가 삭제되었습니다.', 'info');
                              }}
                              className="p-2 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 transition"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
                    <h3 className="text-sm font-bold text-slate-900">
                      새 제휴 마케팅 링크 등록 (키워드 일치 시 본문에 자동 삽입)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <input
                        type="text"
                        value={newAffProduct}
                        onChange={(e) => setNewAffProduct(e.target.value)}
                        placeholder="본문 노출 상품명 (예: 맥북 에어 M4 최저가)"
                        className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                      <input
                        type="text"
                        value={newAffUrl}
                        onChange={(e) => setNewAffUrl(e.target.value)}
                        placeholder="제휴 링크 URL (https://link.coupang.com/...)"
                        className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                      <input
                        type="text"
                        value={newAffKeywords}
                        onChange={(e) => setNewAffKeywords(e.target.value)}
                        placeholder="자동 매칭 키워드 (쉼표 구분: 노트북, 맥북)"
                        className="bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                      />
                    </div>
                    <button
                      onClick={async () => {
                        if (!newAffProduct.trim() || !newAffUrl.trim()) {
                          showToast('상품명과 URL을 입력해주세요.', 'error');
                          return;
                        }
                        const item: AffiliateItem = {
                          id: `aff-${Date.now()}`,
                          name: newAffName || newAffProduct,
                          platform: 'coupang',
                          productTitle: newAffProduct,
                          affiliateUrl: newAffUrl,
                          priceText: '실시간 최저가 및 혜택 확인',
                          badgeText: '추천 혜택',
                          triggerKeywords: newAffKeywords
                            .split(',')
                            .map((s) => s.trim())
                            .filter(Boolean),
                          disclosureText:
                            '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
                          ctaButtonText: '최저가 혜택 확인하기',
                          clickCount: 0,
                          active: true,
                        };
                        const updated = await window.electronAPI.saveAffiliate(item);
                        setState(updated);
                        setNewAffProduct('');
                        setNewAffUrl('');
                        setNewAffKeywords('');
                        showToast('제휴 링크가 등록되었습니다.', 'success');
                      }}
                      className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition"
                    >
                      + 제휴 링크 추가
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {state.affiliates.map((aff) => (
                      <div
                        key={aff.id}
                        className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="text-sm font-bold text-slate-900 truncate">
                            {aff.productTitle}
                          </div>
                          <div className="text-xs text-blue-600 truncate">
                            {aff.affiliateUrl}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            매칭 키워드: {aff.triggerKeywords.join(', ')}
                          </div>
                        </div>
                        <button
                          onClick={async () => {
                            const updated = await window.electronAPI.deleteAffiliate(aff.id);
                            setState(updated);
                          }}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================== 6. AI ENGINE HUB (LOCAL CLI & WEB SESSIONS) ==================== */}
          {activeTab === 'ai_sessions' &&
            (() => {
              const cliSessions = state.webAISessions.filter(
                (s) =>
                  s.connectionType === 'local_cli' ||
                  s.id.endsWith('_cli') ||
                  s.id === 'ollama_local'
              );
              const webSessions = state.webAISessions.filter(
                (s) =>
                  s.connectionType !== 'local_cli' &&
                  !s.id.endsWith('_cli') &&
                  s.id !== 'ollama_local'
              );

              return (
                <div className="max-w-6xl mx-auto space-y-6">
                  {/* Top Header Card */}
                  <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-base font-bold text-slate-900 flex items-center gap-2 tracking-tight">
                        <Cpu className="w-5 h-5 text-slate-700" />
                        구독형 로컬 CLI & 웹 AI 엔진 및 세부 모델 설정
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">
                        각 AI 엔진마다 기본으로 사용할 세부 모델(예: Gemini 4 Hydrogen/Argon, Claude Fable 5.2 / Opus 5.5, GPT-6.1 Sol/Terra 등)을 미리 지정해 둘 수 있으며, 블로그별 설정에서도 개별 지정이 가능합니다.
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        const myRunId = ++taskRunIdRef.current;
                        setBusyMessage('내 PC에 설치된 CLI 도구와 사용 가능한 모델 목록(agy models / ollama)을 스캔하고 있습니다...');
                        try {
                          const res = await window.electronAPI.scanLocalCLIs();
                          if (myRunId !== taskRunIdRef.current) return;
                          setState(res.state);
                          showToast(
                            `스캔 완료! 설치된 로컬 CLI ${res.installedCount}개 및 최신 모델 목록이 동기화되었습니다.`,
                            'success'
                          );
                        } catch (e: any) {
                          if (myRunId !== taskRunIdRef.current || isCancelledError(e)) return;
                          showToast(e.message || 'CLI 스캔 실패', 'error');
                        } finally {
                          if (myRunId === taskRunIdRef.current) {
                            setBusyMessage(null);
                          }
                        }
                      }}
                      className="px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />내 PC CLI & 사용 가능 모델 다시 스캔
                    </button>
                  </div>

                  {/* Section 1: Local CLIs */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-emerald-600" />
                      1. 내 컴퓨터 로컬 구독형 CLI (브라우저 창 없이 백그라운드 초고속 실행 — 추천)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {cliSessions.map((session) => (
                        <div
                          key={session.id}
                          className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4 transition"
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700">
                                {session.badge}
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  session.loggedIn ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                {session.loggedIn ? '● 준비됨' : '○ 미설치/로그인 필요'}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-slate-900">
                              {session.name}
                            </h4>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {session.description}
                            </p>

                            {/* Model Selector inside AI Engine Card */}
                            {session.availableModels && session.availableModels.length > 0 && (
                              <div className="pt-2 border-t border-slate-200/80">
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                  기본 사용 모델 선택 ({session.availableModels.length}개 지원)
                                </label>
                                <select
                                  value={
                                    session.selectedModel ||
                                    session.availableModels[0]?.id ||
                                    ''
                                  }
                                  onChange={async (e) => {
                                    const updatedSession = {
                                      ...session,
                                      selectedModel: e.target.value,
                                    };
                                    const newState =
                                      await window.electronAPI.updateWebAISession(updatedSession);
                                    setState(newState);
                                    showToast(
                                      `[${session.name}] 기본 모델이 '${e.target.value}'(으)로 설정되었습니다.`,
                                      'success'
                                    );
                                  }}
                                  className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 outline-none"
                                >
                                  {session.availableModels.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          {session.id !== 'ollama_local' ? (
                            <button
                              onClick={() => handleOpenWebAISession(session.id)}
                              className="w-full py-2.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                              {session.loggedIn
                                ? 'CLI 터미널 열기 (로그인 확인)'
                                : '원클릭 자동설치 & 로그인'}
                            </button>
                          ) : (
                            <div className="text-center py-2 text-xs text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-lg">
                              ✓ 로컬 11434 포트 자동 연동
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Section 2: Web Browser Sessions */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-600" />
                      2. 구독형 웹 브라우저 AI 세션 (웹 로그인 쿠키 영구 저장 방식)
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {webSessions.map((session) => (
                        <div
                          key={session.id}
                          className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-5 shadow-sm flex flex-col justify-between gap-4 transition"
                        >
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-700">
                                {session.badge}
                              </span>
                              <span
                                className={`text-xs font-semibold ${
                                  session.loggedIn ? 'text-emerald-700' : 'text-amber-700'
                                }`}
                              >
                                {session.loggedIn ? '● 연결됨' : '○ 로그인 필요'}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-slate-900">
                              {session.name}
                            </h4>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {session.description}
                            </p>

                            {/* Model Selector inside Web AI Card */}
                            {session.availableModels && session.availableModels.length > 0 && (
                              <div className="pt-2 border-t border-slate-200/80">
                                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                  기본 선호 모델 설정
                                </label>
                                <select
                                  value={
                                    session.selectedModel ||
                                    session.availableModels[0]?.id ||
                                    ''
                                  }
                                  onChange={async (e) => {
                                    const updatedSession = {
                                      ...session,
                                      selectedModel: e.target.value,
                                    };
                                    const newState =
                                      await window.electronAPI.updateWebAISession(updatedSession);
                                    setState(newState);
                                    showToast(
                                      `[${session.name}] 선호 모델이 '${e.target.value}'(으)로 설정되었습니다.`,
                                      'success'
                                    );
                                  }}
                                  className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 outline-none"
                                >
                                  {session.availableModels.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.label}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                          </div>

                          <button
                            onClick={() => handleOpenWebAISession(session.id)}
                            className="w-full py-2.5 px-3 rounded-lg bg-white hover:bg-slate-50 border border-slate-300 text-slate-900 text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm transition"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            브라우저 열기 & 로그인 저장
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
        </div>
      </main>
    </div>
  );
};
export default App;
