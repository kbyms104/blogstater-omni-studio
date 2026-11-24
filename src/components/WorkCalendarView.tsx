import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Flame,
  FileSpreadsheet,
  Plus,
  Send,
  Copy,
  Search,
  Award,
  Activity,
} from 'lucide-react';
import {
  AppDatabaseState,
  BlogPost,
  BlogProfile,
} from '../types';

interface WorkCalendarViewProps {
  state: AppDatabaseState;
  onOpenPostInStudio: (post: BlogPost) => void;
  onCopyRichHtml: (post: BlogPost) => void;
  onPublishPost: (post: BlogPost, openBrowserEditor: boolean) => void;
  onCheckRank: (postId: string) => void;
  onCreatePostForDate: (blogId: string, keyword: string, dateStr: string) => void;
  onExportReport: (yearMonth: string, selectedDate?: string) => void;
}

function toLocalDateString(isoOrDate?: string): string {
  if (!isoOrDate) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(isoOrDate)) return isoOrDate;
  const d = new Date(isoOrDate);
  if (isNaN(d.getTime())) return isoOrDate.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export const WorkCalendarView: React.FC<WorkCalendarViewProps> = ({
  state,
  onOpenPostInStudio,
  onCopyRichHtml,
  onPublishPost,
  onCheckRank,
  onCreatePostForDate,
  onExportReport,
}) => {
  const todayStr = toLocalDateString(new Date().toISOString());
  const [currentMonthDate, setCurrentMonthDate] = useState<Date>(() => new Date());
  const [selectedDateStr, setSelectedDateStr] = useState<string>(todayStr);
  const [filterBlogId, setFilterBlogId] = useState<string>('all');

  // Quick date post creation state
  const [quickKeyword, setQuickKeyword] = useState<string>('');
  const [quickBlogId, setQuickBlogId] = useState<string>(state.blogs[0]?.id || '');

  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth(); // 0-indexed
  const yearMonthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;

  // Build calendar cells (Sunday ~ Saturday)
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);
    const startWeekday = firstDayOfMonth.getDay(); // 0 (Sun) ~ 6 (Sat)
    const totalDays = lastDayOfMonth.getDate();

    const cells: Array<{ dateStr: string; dayNum: number; isCurrentMonth: boolean }> = [];

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevMonthLastDay - i);
      cells.push({
        dateStr: toLocalDateString(d.toISOString()),
        dayNum: d.getDate(),
        isCurrentMonth: false,
      });
    }

    // Current month days
    for (let dNum = 1; dNum <= totalDays; dNum++) {
      const dStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dNum).padStart(2, '0')}`;
      cells.push({
        dateStr: dStr,
        dayNum: dNum,
        isCurrentMonth: true,
      });
    }

    // Next month padding to complete 6 rows (42 cells) or 5 rows (35 cells)
    const targetCells = cells.length > 35 ? 42 : 35;
    let nextDay = 1;
    while (cells.length < targetCells) {
      const d = new Date(year, month + 1, nextDay++);
      cells.push({
        dateStr: toLocalDateString(d.toISOString()),
        dayNum: d.getDate(),
        isCurrentMonth: false,
      });
    }

    return cells;
  }, [year, month]);

  // Filter posts, trends, and logs by blog
  const filteredPosts = useMemo(
    () =>
      state.posts.filter((p) => filterBlogId === 'all' || p.blogId === filterBlogId),
    [state.posts, filterBlogId]
  );

  const filteredTrends = useMemo(
    () =>
      state.trends.filter(
        (t) => filterBlogId === 'all' || !t.recommendedBlogId || t.recommendedBlogId === filterBlogId
      ),
    [state.trends, filterBlogId]
  );

  const filteredLogs = useMemo(
    () =>
      state.logs.filter((l) => filterBlogId === 'all' || !l.blogId || l.blogId === filterBlogId),
    [state.logs, filterBlogId]
  );

  // Group by YYYY-MM-DD
  const dailyMap = useMemo(() => {
    const map = new Map<
      string,
      {
        posts: BlogPost[];
        publishedCount: number;
        pendingCount: number;
        scheduledCount: number;
        trendsCount: number;
        logsCount: number;
      }
    >();

    const ensure = (dStr: string) => {
      if (!map.has(dStr)) {
        map.set(dStr, {
          posts: [],
          publishedCount: 0,
          pendingCount: 0,
          scheduledCount: 0,
          trendsCount: 0,
          logsCount: 0,
        });
      }
      return map.get(dStr)!;
    };

    for (const p of filteredPosts) {
      const primaryDate = toLocalDateString(p.scheduledFor || p.publishedAt || p.createdAt);
      const entry = ensure(primaryDate);
      entry.posts.push(p);
      if (p.status === 'published') entry.publishedCount++;
      else if (p.status === 'scheduled') entry.scheduledCount++;
      else entry.pendingCount++;
    }

    for (const t of filteredTrends) {
      const dStr = toLocalDateString(t.discoveredAt);
      ensure(dStr).trendsCount++;
    }

    for (const l of filteredLogs) {
      const dStr = toLocalDateString(l.timestamp);
      ensure(dStr).logsCount++;
    }

    return map;
  }, [filteredPosts, filteredTrends, filteredLogs]);

  // Selected day details
  const selectedDayPosts = useMemo(
    () => dailyMap.get(selectedDateStr)?.posts || [],
    [dailyMap, selectedDateStr]
  );

  const selectedDayTrends = useMemo(
    () =>
      filteredTrends.filter((t) => toLocalDateString(t.discoveredAt) === selectedDateStr),
    [filteredTrends, selectedDateStr]
  );

  const selectedDayLogs = useMemo(
    () =>
      filteredLogs.filter((l) => toLocalDateString(l.timestamp) === selectedDateStr),
    [filteredLogs, selectedDateStr]
  );

  // Monthly statistics
  const monthPosts = useMemo(
    () =>
      filteredPosts.filter((p) =>
        toLocalDateString(p.scheduledFor || p.publishedAt || p.createdAt).startsWith(yearMonthPrefix)
      ),
    [filteredPosts, yearMonthPrefix]
  );

  const monthPublishedCount = monthPosts.filter((p) => p.status === 'published').length;
  const activeDaysInMonth = useMemo(() => {
    const days = new Set<string>();
    for (const p of monthPosts) {
      days.add(toLocalDateString(p.scheduledFor || p.publishedAt || p.createdAt));
    }
    return days.size;
  }, [monthPosts]);

  // Today's quota progress per blog
  const todayBlogProgress = useMemo(() => {
    return state.blogs.map((blog) => {
      const todayPostsForBlog = state.posts.filter(
        (p) =>
          p.blogId === blog.id &&
          toLocalDateString(p.publishedAt || p.createdAt) === todayStr
      );
      const target = Math.max(1, blog.schedule.dailyPostLimit || 1);
      const done = todayPostsForBlog.length;
      const pct = Math.min(100, Math.round((done / target) * 100));
      return {
        blog,
        done,
        target,
        pct,
      };
    });
  }, [state.blogs, state.posts, todayStr]);

  return (
    <div className="space-y-6">
      {/* Top Header & Summary Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 tracking-tight">
            <CalendarIcon className="w-5 h-5 text-slate-700" />
            날짜별 작업 내역 캘린더 & 일일 타임라인
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            날짜별로 어떤 블로그에 어떤 주제의 글을 작성·발행했는지, 시간대별 자동화 로그와 일일 목표 달성률을 한눈에 관리합니다.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={filterBlogId}
            onChange={(e) => setFilterBlogId(e.target.value)}
            className="bg-white border border-slate-300 focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10 rounded-lg px-3 py-2 text-xs font-semibold text-slate-900 outline-none"
          >
            <option value="all">전체 블로그 통합 내역 보기</option>
            {state.blogs.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.platform.toUpperCase()})
              </option>
            ))}
          </select>

          <button
            onClick={() => onExportReport(yearMonthPrefix, selectedDateStr)}
            className="px-3.5 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <FileSpreadsheet className="w-4 h-4" />
            선택 날짜({selectedDateStr}) 엑셀 CSV 리포트
          </button>

          <button
            onClick={() => onExportReport(yearMonthPrefix)}
            className="px-3.5 py-2 rounded-lg bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 shadow-sm text-xs font-semibold flex items-center gap-1.5 transition"
          >
            <FileSpreadsheet className="w-4 h-4 text-slate-600" />
            이번 달({yearMonthPrefix}) 전체 CSV 내보내기
          </button>
        </div>
      </div>

      {/* Monthly KPI & Today's Blog Quota Progress */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 grid grid-cols-3 gap-3">
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="text-[11px] font-medium text-slate-500">이번 달 총 작업 원고</div>
            <div className="text-xl font-bold text-slate-900 mt-1">{monthPosts.length}건</div>
            <div className="text-[10px] font-semibold text-blue-600 mt-1">
              발행완료 {monthPublishedCount}건
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="text-[11px] font-medium text-slate-500">이번 달 활동 일수</div>
            <div className="text-xl font-bold text-emerald-700 mt-1">
              {activeDaysInMonth}일
            </div>
            <div className="text-[10px] text-slate-500 mt-1">꾸준한 포스팅 지수 관리</div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
            <div className="text-[11px] font-medium text-slate-500">선택일 작업 건수</div>
            <div className="text-xl font-bold text-slate-900 mt-1">
              {selectedDayPosts.length}건
            </div>
            <div className="text-[10px] text-slate-500 mt-1">{selectedDateStr}</div>
          </div>
        </div>

        {/* Today's Quota per Blog */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Flame className="w-4 h-4 text-amber-500" />
              오늘({todayStr}) 블로그별 일일 포스팅 할당량 달성 현황
            </span>
            <span className="text-[11px] text-slate-500">
              일일 목표치 대비 진행률
            </span>
          </div>
          {todayBlogProgress.length === 0 ? (
            <div className="text-xs text-slate-500 py-2">
              등록된 블로그가 없습니다. 블로그를 등록하면 일일 할당량 달성률이 표시됩니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {todayBlogProgress.map(({ blog, done, target, pct }) => (
                <div
                  key={blog.id}
                  className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800 truncate">{blog.name}</span>
                    <span
                      className={`font-bold ${
                        pct >= 100 ? 'text-emerald-700' : 'text-blue-600'
                      }`}
                    >
                      {done} / {target}건 ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-200/80 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct >= 100 ? 'bg-emerald-600' : 'bg-slate-900'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Grid: Left Monthly Calendar (7 cols) + Right Selected Date Work History (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Monthly Calendar Grid */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentMonthDate(new Date(year, month - 1, 1))}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <h3 className="text-base font-bold text-slate-900 px-2 tracking-tight">
                {year}년 {month + 1}월 작업 달력
              </h3>
              <button
                onClick={() => setCurrentMonthDate(new Date(year, month + 1, 1))}
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => {
                const now = new Date();
                setCurrentMonthDate(now);
                setSelectedDateStr(toLocalDateString(now.toISOString()));
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 text-xs font-semibold transition"
            >
              오늘({todayStr}) 선택
            </button>
          </div>

          {/* Weekday Headers */}
          <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-slate-500 pb-1">
            <div className="text-rose-600">일</div>
            <div>월</div>
            <div>화</div>
            <div>수</div>
            <div>목</div>
            <div>금</div>
            <div className="text-blue-600">토</div>
          </div>

          {/* Calendar Cells */}
          <div className="grid grid-cols-7 gap-1.5">
            {calendarDays.map((cell) => {
              const summary = dailyMap.get(cell.dateStr);
              const isSelected = cell.dateStr === selectedDateStr;
              const isToday = cell.dateStr === todayStr;
              const hasPosts = (summary?.posts.length || 0) > 0;
              const hasActivity =
                hasPosts || (summary?.trendsCount || 0) > 0 || (summary?.logsCount || 0) > 0;

              return (
                <button
                  key={cell.dateStr}
                  onClick={() => setSelectedDateStr(cell.dateStr)}
                  className={`min-h-[86px] p-2 rounded-lg border text-left flex flex-col justify-between transition ${
                    isSelected
                      ? 'bg-slate-900/[0.04] border-slate-900 ring-1 ring-slate-900'
                      : isToday
                      ? 'bg-blue-50/40 border-blue-500'
                      : cell.isCurrentMonth
                      ? 'bg-white border-slate-200 hover:border-slate-300 text-slate-800'
                      : 'bg-slate-50/70 border-slate-100 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span
                      className={`text-xs font-bold ${
                        isToday
                          ? 'px-1.5 py-0.5 rounded bg-blue-600 text-white'
                          : cell.isCurrentMonth
                          ? 'text-slate-800'
                          : 'text-slate-400'
                      }`}
                    >
                      {cell.dayNum}
                    </span>
                    {summary && summary.publishedCount > 0 && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold"
                        title="발행 완료"
                      >
                        발행 {summary.publishedCount}
                      </span>
                    )}
                  </div>

                  {/* Badges inside cell */}
                  <div className="space-y-1 mt-1 w-full">
                    {summary && summary.publishedCount > 0 && (
                      <div className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold truncate">
                        발행 {summary.publishedCount}건
                      </div>
                    )}
                    {summary && summary.pendingCount > 0 && (
                      <div className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold truncate">
                        대기 {summary.pendingCount}건
                      </div>
                    )}
                    {summary && summary.scheduledCount > 0 && (
                      <div className="text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 font-semibold truncate">
                        예약 {summary.scheduledCount}건
                      </div>
                    )}
                    {!hasPosts && hasActivity && (
                      <div className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 truncate">
                        로그 {summary?.logsCount || 0}건
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Date Detailed Work Breakdown & Timeline */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                SELECTED DATE WORK LOG
              </span>
              <h3 className="text-base font-bold text-slate-900 mt-0.5 tracking-tight">
                {selectedDateStr} 상세 작업 내역서
              </h3>
            </div>
            <div className="text-right text-xs text-slate-500 font-medium">
              <div>원고 {selectedDayPosts.length}건</div>
              <div>키워드 발굴 {selectedDayTrends.length}건</div>
            </div>
          </div>

          {/* Quick Assign / Create Post for Selected Date */}
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2.5">
            <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-slate-600" />
              {selectedDateStr} 날짜로 원고 즉시 생성 / 예약 배정
            </div>
            <div className="flex flex-col gap-2">
              <select
                value={quickBlogId || state.blogs[0]?.id || ''}
                onChange={(e) => setQuickBlogId(e.target.value)}
                className="w-full bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 outline-none"
              >
                {state.blogs.length === 0 ? (
                  <option value="">먼저 블로그를 등록해주세요</option>
                ) : (
                  state.blogs.map((b) => (
                    <option key={b.id} value={b.id}>
                      [{b.platform.toUpperCase()}] {b.name}
                    </option>
                  ))
                )}
              </select>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickKeyword}
                  onChange={(e) => setQuickKeyword(e.target.value)}
                  placeholder="이 날짜에 작성할 키워드 입력"
                  className="flex-1 bg-white border border-slate-300 focus:border-slate-900 rounded-lg px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none"
                />
                <button
                  onClick={() => {
                    const targetId = quickBlogId || state.blogs[0]?.id;
                    if (!targetId) return;
                    if (!quickKeyword.trim()) return;
                    onCreatePostForDate(targetId, quickKeyword.trim(), selectedDateStr);
                    setQuickKeyword('');
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1 shrink-0 transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  배정 생성
                </button>
              </div>
            </div>
          </div>

          {/* 1. Posts Worked On This Date */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-700 flex items-center justify-between">
              <span>이 날짜의 포스팅 작업 내역 ({selectedDayPosts.length}건)</span>
            </h4>
            {selectedDayPosts.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-500 text-center">
                {selectedDateStr} 날짜에 생성되거나 예약된 포스팅이 없습니다.
              </div>
            ) : (
              <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                {selectedDayPosts.map((post) => {
                  const blog = state.blogs.find((b) => b.id === post.blogId);
                  return (
                    <div
                      key={post.id}
                      className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-200/80 text-slate-700">
                            {blog?.name || '블로그'}
                          </span>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                              post.status === 'published'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : post.status === 'scheduled'
                                ? 'bg-violet-50 text-violet-700 border-violet-200'
                                : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                          >
                            {post.status === 'published'
                              ? '발행완료'
                              : post.status === 'scheduled'
                              ? '예약됨'
                              : '검수대기'}
                          </span>
                          <span className="text-[10px] text-emerald-700 font-bold">
                            SEO {post.seoReport.totalScore}점
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500">
                          {new Date(post.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      <div className="text-xs font-bold text-slate-900 line-clamp-1">
                        {post.title}
                      </div>

                      {post.rankInfo && (
                        <div className="text-[11px] px-2 py-1 rounded bg-white text-amber-700 border border-amber-200">
                          {post.rankInfo.summaryText}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <button
                          onClick={() => onOpenPostInStudio(post)}
                          className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 border border-slate-200 text-[11px] text-slate-700 font-semibold transition"
                        >
                          원고 열기
                        </button>
                        <button
                          onClick={() => onCopyRichHtml(post)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-[11px] text-emerald-700 font-semibold flex items-center gap-1 transition"
                        >
                          <Copy className="w-3 h-3" /> HTML복사
                        </button>
                        {post.status === 'published' ? (
                          <button
                            type="button"
                            disabled
                            className="px-2.5 py-1 rounded-lg bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-700 font-semibold flex items-center gap-1 cursor-not-allowed opacity-85"
                            title="이미 발행 완료된 원고는 재발행이 차단됩니다"
                          >
                            <CheckCircle2 className="w-3 h-3" /> 발행완료됨
                          </button>
                        ) : (
                          <button
                            onClick={() => onPublishPost(post, true)}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-[11px] text-white font-semibold flex items-center gap-1 transition"
                          >
                            <Send className="w-3 h-3" /> 발행
                          </button>
                        )}
                        <button
                          onClick={() => onCheckRank(post.id)}
                          className="px-2.5 py-1 rounded-lg bg-amber-50 hover:bg-amber-100 border border-amber-200 text-[11px] text-amber-700 font-semibold flex items-center gap-1 transition"
                        >
                          <Search className="w-3 h-3" /> 순위조회
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 2. Chronological Activity Timeline for Selected Date */}
          <div className="space-y-2 flex-1 flex flex-col min-h-0">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-slate-600" />
              시간대별 상세 작업 로그 타임라인 ({selectedDayLogs.length}건)
            </h4>
            {selectedDayLogs.length === 0 ? (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-500 text-center">
                해당 날짜에 기록된 자동화 실행 로그가 없습니다.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[210px] overflow-y-auto pr-1 font-mono">
                {selectedDayLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/80 text-[11px]"
                  >
                    <div className="flex items-center justify-between text-slate-500 mb-0.5">
                      <span className="font-bold text-slate-700">[{log.module}]</span>
                      <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-slate-700">{log.message}</div>
                    {log.detail && (
                      <div className="text-slate-500 text-[10px] mt-0.5">{log.detail}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
