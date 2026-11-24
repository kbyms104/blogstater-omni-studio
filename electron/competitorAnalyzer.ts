import * as cheerio from 'cheerio';
import {
  BlogPost,
  BlogProfile,
  CompetitorAnalysisReport,
  CompetitorItem,
  PostRankInfo,
} from './types';
import { isPolicyOrFinanceApplyTopic } from './keywordScout';

interface CrawledPostInsights {
  charCount: number;
  headings: string[];
  keyFacts: string[];
  hasTable: boolean;
  hasNumericSimulation: boolean;
  hasDrawbacksOrExceptions: boolean;
  hasStepByStepGuide: boolean;
}

const COMP_TOPIC_STOPWORDS = new Set([
  '핵심', '배경', '전망', '정리', '이유', '방법', '조건', '비교', '신청',
  '가이드', '총정리', '실전', '완벽', '초보자', '위한', '이해', '원인',
  '대응', '점검', '기능', '주요', '쟁점', '흐름', '현황', '실제', '차이',
  '추천', '후기', '단점', '장단점', '포인트', '체크', '기준', '팁', '및',
]);

function extractCoreTopicTokens(keyword: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of (keyword || '').split(/[\s,·"'“”‘’\[\]()!?…:/]+/)) {
    const cleaned = raw
      .replace(/^[^가-힣a-zA-Z0-9]+|[^가-힣a-zA-Z0-9]+$/g, '')
      .replace(/(?:에서|으로|까지|부터|보다|은|는|이|가|을|를|의|에|와|과)$/, (m, offset, full) =>
        full.slice(0, offset).length >= 2 ? '' : m
      )
      .trim()
      .toLowerCase();
    if (cleaned.length < 2 || /^\d+$/.test(cleaned) || COMP_TOPIC_STOPWORDS.has(cleaned)) {
      continue;
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      tokens.push(cleaned);
    }
  }
  return tokens;
}

function isTextRelevantToTokens(text: string, coreTokens: string[]): boolean {
  if (!coreTokens || coreTokens.length === 0) return true;
  const lower = (text || '').toLowerCase();
  return coreTokens.some((tok) => lower.includes(tok));
}

function containsStaleYearReference(text: string): boolean {
  const currentYear = new Date().getFullYear();
  const matches = text.match(/20(2[0-9])\s*년/g);
  if (!matches || matches.length === 0) return false;
  const years = matches.map((m) => Number(m.replace(/\D/g, '')));
  if (years.some((y) => y >= currentYear)) return false;
  return years.some((y) => y >= 2020 && y < currentYear);
}

function isRecentRssDate(pubDateStr: string, maxAgeDays: number): boolean {
  if (!pubDateStr) return true;
  const parsed = Date.parse(pubDateStr);
  if (Number.isNaN(parsed)) return true;
  const ageMs = Date.now() - parsed;
  // Allow slight timezone skew (-1 day) up to maxAgeDays
  return ageMs <= maxAgeDays * 24 * 60 * 60 * 1000 && ageMs >= -48 * 60 * 60 * 1000;
}

/**
 * Crawls an individual Naver Blog or Tistory post (converting Naver PC URLs to mobile m.blog.naver.com
 * to bypass iframe wrapping) and extracts real character count, subheadings, and factual sentences.
 */
async function crawlCompetitorPostDetail(
  url: string,
  coreTokens: string[] = []
): Promise<CrawledPostInsights | null> {
  if (!url || !url.startsWith('http')) return null;
  try {
    const targetUrl = url.replace('://blog.naver.com/', '://m.blog.naver.com/');
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(2600),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    const mainContainer = $(
      '.se-main-container, #viewTypeSelector, .tt_article_useless_p_margin, .entry-content, article'
    ).first();
    const rawBody = (mainContainer.length > 0 ? mainContainer.text() : $('body').text())
      .replace(/\u200B/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (rawBody.length < 250) return null;

    const charCount = rawBody.replace(/\s/g, '').length;
    const headings: string[] = [];
    mainContainer
      .find('.se-sectionTitle, .se-module-text.se-quote, h2, h3')
      .each((_, el) => {
        const h = $(el)
          .text()
          .replace(/\u200B/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (
          h.length >= 6 &&
          h.length <= 56 &&
          !/카테고리|이웃추가|공유하기|저작자|무단전재/.test(h) &&
          !containsStaleYearReference(h) &&
          isTextRelevantToTokens(h, coreTokens) &&
          !headings.includes(h)
        ) {
          headings.push(h);
        }
      });

    // Extract concrete factual or analytical sentences across all topic domains
    const sentences = rawBody
      .split(/(?<=[.?!다요음])\s+/)
      .map((s) => s.trim())
      .filter(
        (s) =>
          s.length >= 26 &&
          s.length <= 125 &&
          /([0-9]+(만\s*원|원|%|개월|년|월|일|세|회|점|명|위|억|조|달러|배)|비과세|기여금|환급|자격|조건|신청|서류|기준|수수료|한도|금리|발표|배경|전망|영향|이유|원인|분석|결과|입장|차이|비교)/.test(
            s
          ) &&
          !/안녕하세요|이웃추가|댓글|공감|포스팅|블로그|저작권|무단/.test(s) &&
          !containsStaleYearReference(s) &&
          isTextRelevantToTokens(s, coreTokens)
      );

    const hasTable = mainContainer.find('table, .se-table').length > 0;
    const numericMatches =
      rawBody.match(/\d+(?:[.,]\d+)?\s*(?:원|만원|억원|%|개월|년|배|GB|ms|초)/g) || [];
    const hasNumericSimulation = numericMatches.length >= 3;
    const hasDrawbacksOrExceptions =
      /단점|주의사항|예외|불이익|거절|실패|오류|제한|한계|아쉬운\s*점|피해야|불가능/.test(rawBody);
    const hasStepByStepGuide =
      /1단계|2단계|첫째|둘째|순서대로|체크리스트|해결\s*방법|트러블슈팅/.test(rawBody);

    return {
      charCount,
      headings: headings.slice(0, 6),
      keyFacts: sentences.slice(0, 5),
      hasTable,
      hasNumericSimulation,
      hasDrawbacksOrExceptions,
      hasStepByStepGuide,
    };
  } catch {
    return null;
  }
}

function isUsableArticlePhotoUrl(url: string): boolean {
  const clean = (url || '').trim();
  if (!/^https?:\/\//i.test(clean)) return false;
  if (/logo|icon|favicon|banner|button|avatar|profile|blank|spacer|1x1|adimg|sprite|emoji/i.test(clean)) {
    return false;
  }
  return /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(clean) || /imgnews\.pstatic\.net|ssl\.pstatic\.net\/mimgnews/i.test(clean);
}

export async function analyzeCompetitorSERP(
  keyword: string
): Promise<CompetitorAnalysisReport> {
  const cleanKw = keyword.trim();
  const coreTokens = extractCoreTopicTokens(cleanKw);
  const topCompetitors: CompetitorItem[] = [];
  const extractedSubKeywords: string[] = [];
  const scrapedImageUrls: string[] = [];

  const serpsToTry = [
    `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&nso=so%3Ar%2Cp%3A3m&query=${encodeURIComponent(
      cleanKw
    )}`,
    `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(
      cleanKw
    )}`,
  ];

  for (let attempt = 0; attempt < serpsToTry.length && topCompetitors.length === 0; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
    try {
      const res = await fetch(serpsToTry[attempt], {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        signal: AbortSignal.timeout(4800),
      });

      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);

        // Extract top blog items from Naver Blog SERP (supports both SDS layout and classic layout)
        $('.sds-comps-vertical-layout.sds-comps-full-layout, .view_wrap, .bx, .total_wrap').each(
          (_, el) => {
            if (topCompetitors.length >= 5) return;
            const $el = $(el);
            if (
              $el.hasClass('sds-comps-vertical-layout') &&
              $el.find('.sds-comps-text-type-headline1').length > 1
            ) {
              return;
            }
            const titleEl = $el
              .find(
                '.sds-comps-text-type-headline1, .title_link, .api_txt_lines.total_tit, a.title_area'
              )
              .first();
            const descEl = $el
              .find('.sds-comps-text-type-body1, .dsc_link, .api_txt_lines.dsc_txt, .dsc_area')
              .first();
            const nameEl = $el
              .find('.sds-comps-profile-info-title-text, .name, .sub_txt.sub_name')
              .first();

            const title = titleEl.text().replace(/\s*새\s*창\s*열림/g, '').trim();
            const link =
              titleEl.attr('href') ||
              titleEl.closest('a').attr('href') ||
              $el
                .find('a[href*="blog.naver.com/"][href*="/2"], a[href*="tistory.com/"]')
                .first()
                .attr('href') ||
              $el
                .find('a[href*="blog.naver.com/"], a[href*="tistory.com/"]')
                .first()
                .attr('href') ||
              '';
            const snippet = descEl.text().trim();
            const blogName = nameEl.text().replace(/\s*새\s*창\s*열림/g, '').trim() || '상위 노출 블로그';

            if (
              title &&
              title.length > 5 &&
              snippet.length > 10 &&
              isTextRelevantToTokens(`${title} ${snippet}`, coreTokens) &&
              !topCompetitors.some((c) => c.title === title)
            ) {
              topCompetitors.push({
                rank: topCompetitors.length + 1,
                title,
                blogName,
                snippet: snippet.slice(0, 120),
                url:
                  link ||
                  `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(
                    cleanKw
                  )}`,
              });
            }
          }
        );

        // Extract related search terms / hashtags from snippets
        $('.lst_related_srch .tit, .related_srch a, .sds-comps-keyword-chip').each((_, el) => {
          const txt = $(el).text().trim();
          if (txt && extractedSubKeywords.length < 8 && !extractedSubKeywords.includes(txt)) {
            extractedSubKeywords.push(txt);
          }
        });
      }
    } catch {
      // Fallback / retry
    }
  }

  // Deep-crawl the top 3 competitor blog posts in parallel to extract real facts, headings, structural gaps, and char counts
  const crawlTargets = topCompetitors.slice(0, 3).map((c) => c.url);
  const crawledInsights = (
    await Promise.all(crawlTargets.map((u) => crawlCompetitorPostDetail(u, coreTokens)))
  ).filter((item): item is CrawledPostInsights => item !== null);

  const competitorHeadings: string[] = [];
  const extractedKeyFacts: string[] = [];

  for (const insight of crawledInsights) {
    for (const h of insight.headings) {
      if (!competitorHeadings.includes(h) && competitorHeadings.length < 8) {
        competitorHeadings.push(h);
      }
    }
    for (const fact of insight.keyFacts) {
      if (!extractedKeyFacts.includes(fact) && extractedKeyFacts.length < 10) {
        extractedKeyFacts.push(fact);
      }
    }
  }

  // Supplement extractedKeyFacts from SERP snippets if deep crawl yielded fewer than 3 facts
  if (extractedKeyFacts.length < 3 && topCompetitors.length > 0) {
    for (const comp of topCompetitors) {
      const cleanSnip = comp.snippet
        .replace(/#[가-힣a-zA-Z0-9_]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleanSnip.length >= 25 && !extractedKeyFacts.includes(cleanSnip)) {
        extractedKeyFacts.push(cleanSnip);
      }
      if (extractedKeyFacts.length >= 5) break;
    }
  }

  // Enrich with live Naver News headlines + article body facts (#dic_area) & real news photos
  if (extractedKeyFacts.length < 8 || scrapedImageUrls.length === 0) {
    try {
      const naverNewsUrl = `https://search.naver.com/search.naver?ssc=tab.news.all&sort=0&query=${encodeURIComponent(
        cleanKw
      )}`;
      const naverNewsRes = await fetch(naverNewsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(2500),
      });
      if (naverNewsRes.ok) {
        const html = await naverNewsRes.text();
        const $n = cheerio.load(html);
        const seenHeadlines = new Set<string>();
        const mnewsUrls: string[] = [];

        $n('a.news_tit, .sds-comps-text-type-headline1, a[data-heatmap-target=".tit"]')
          .slice(0, 8)
          .each((_, el) => {
            const headline = $n(el)
              .text()
              .replace(/\s*새\s*창\s*열림/g, '')
              .replace(/\s+/g, ' ')
              .trim();
            if (
              headline.length >= 14 &&
              !seenHeadlines.has(headline) &&
              !containsStaleYearReference(headline) &&
              isTextRelevantToTokens(headline, coreTokens)
            ) {
              seenHeadlines.add(headline);
              const container = $n(el).closest('.news_wrap, .news_area, .sds-comps-vertical-layout, li, div');
              const directHref = $n(el).attr('href') || '';
              const mnewsHref =
                (directHref.includes('n.news.naver.com/mnews/article/') ? directHref : '') ||
                container.find('a[href*="n.news.naver.com/mnews/article/"]').first().attr('href') ||
                '';
              if (mnewsHref && !mnewsUrls.includes(mnewsHref) && mnewsUrls.length < 2) {
                mnewsUrls.push(mnewsHref);
              }
              if (extractedKeyFacts.length < 6) {
                const factLine = `최신 네이버 뉴스: "${headline}"`;
                if (!extractedKeyFacts.includes(factLine)) {
                  extractedKeyFacts.push(factLine);
                }
              }
            }
          });

        if (mnewsUrls.length > 0 && (extractedKeyFacts.length < 10 || scrapedImageUrls.length < 3)) {
          const articleResults = await Promise.allSettled(
            mnewsUrls.map(async (u) => {
              const r = await fetch(u, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                signal: AbortSignal.timeout(2200),
              });
              if (!r.ok) return { text: '', images: [] as string[] };
              const aHtml = await r.text();
              const $a = cheerio.load(aHtml);
              const imgs: string[] = [];
              $a('#img1, .end_photo_org img, .nbd_im_w img, #dic_area img').each((_, imgEl) => {
                const src =
                  $a(imgEl).attr('data-src') ||
                  $a(imgEl).attr('src') ||
                  '';
                if (isUsableArticlePhotoUrl(src) && !imgs.includes(src)) {
                  imgs.push(src);
                }
              });
              const ogImg = $a('meta[property="og:image"]').attr('content') || '';
              if (imgs.length === 0 && isUsableArticlePhotoUrl(ogImg)) {
                imgs.push(ogImg);
              }
              return {
                text: $a('#dic_area, #articeBody, article').text().replace(/\s+/g, ' ').trim(),
                images: imgs.slice(0, 3),
              };
            })
          );
          for (const ar of articleResults) {
            if (ar.status !== 'fulfilled') continue;
            for (const imgUrl of ar.value.images) {
              if (!scrapedImageUrls.includes(imgUrl) && scrapedImageUrls.length < 4) {
                scrapedImageUrls.push(imgUrl);
              }
            }
            if (!ar.value.text) continue;
            const concreteSentences = ar.value.text
              .split(/(?<=[.?!다])\s+/)
              .map((s) => s.trim())
              .filter(
                (s) =>
                  s.length >= 24 &&
                  s.length <= 165 &&
                  /(?:CVE-\d+|v?\d+\.\d+|Java\s*\d+|자바|OpenJDK|오픈JDK|GraalVM|원격|코드|취약점|업데이트|패치|KISA|보호나라|과기정통부|국가안보실|[0-9]+(?:%|원|달러|명|건|일|개월|위))/i.test(
                    s
                  ) &&
                  !containsStaleYearReference(s) &&
                  isTextRelevantToTokens(s, coreTokens)
              );
            for (const sent of concreteSentences.slice(0, 3)) {
              if (extractedKeyFacts.length >= 10) break;
              const factLine = `기사 확인 팩트: ${sent}`;
              if (!extractedKeyFacts.includes(factLine)) {
                extractedKeyFacts.push(factLine);
              }
            }
          }
        }
      }
    } catch {
      // ignore if offline
    }
  }

  if (extractedKeyFacts.length < 8) {
    try {
      const newsUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
        `${cleanKw} when:14d`
      )}&hl=ko&gl=KR&ceid=KR:ko`;
      const newsRes = await fetch(newsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(2500),
      });
      if (newsRes.ok) {
        const xml = await newsRes.text();
        const $news = cheerio.load(xml, { xmlMode: true });
        $news('item')
          .slice(0, 6)
          .each((_, itemEl) => {
            if (extractedKeyFacts.length >= 8) return;
            const pubDate = $news(itemEl).find('pubDate').first().text().trim();
            if (!isRecentRssDate(pubDate, 14)) return;
            const headline = $news(itemEl)
              .find('title')
              .first()
              .text()
              .replace(/\s*-\s*[^-]+$/, '')
              .trim();
            if (
              headline.length >= 14 &&
              !containsStaleYearReference(headline) &&
              isTextRelevantToTokens(headline, coreTokens) &&
              extractedKeyFacts.length < 8
            ) {
              const factLine = `최근 주요 보도: "${headline}"`;
              if (!extractedKeyFacts.includes(factLine)) {
                extractedKeyFacts.push(factLine);
              }
            }
          });
      }
    } catch {
      // ignore if offline
    }
  }

  // Extract frequent meaningful words from competitor titles/snippets/headings if subKeywords are sparse
  if (extractedSubKeywords.length < 5 && topCompetitors.length > 0) {
    const combinedText = [
      ...topCompetitors.map((c) => `${c.title} ${c.snippet}`),
      ...competitorHeadings,
    ].join(' ');
    const tokens = combinedText
      .replace(/#[가-힣a-zA-Z0-9_]+/g, ' ')
      .replace(/[^가-힣a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(
        (w) =>
          w.length >= 2 &&
          !cleanKw.includes(w) &&
          !/^(총정리|완벽|가이드|알아보기|정리|비교|방법|조건|신청)$/.test(w)
      );
    const freq = new Map<string, number>();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) || 0) + 1);
    }
    const sorted = Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([word]) => word);
    for (const w of sorted) {
      if (!extractedSubKeywords.includes(w)) {
        extractedSubKeywords.push(w);
      }
    }
  }

  const isPolicy = isPolicyOrFinanceApplyTopic(cleanKw);

  if (extractedSubKeywords.length === 0) {
    if (isPolicy) {
      extractedSubKeywords.push(
        `${cleanKw} 거절사유`,
        `${cleanKw} 손익계산`,
        `${cleanKw} 예외기준`,
        `${cleanKw} 서류체크`
      );
    } else {
      extractedSubKeywords.push(
        `${cleanKw} 실제단점`,
        `${cleanKw} 대안비교`,
        `${cleanKw} 오류해결`,
        `${cleanKw} 선택기준`
      );
    }
  }

  if (topCompetitors.length === 0) {
    topCompetitors.push(
      {
        rank: 1,
        title: isPolicy
          ? `${cleanKw} 핵심 조건 및 신청 방법 안내`
          : `${cleanKw}, 꼭 짚고 넘어가야 할 핵심 쟁점과 향후 변화`,
        blogName: '상위 1위 블로그',
        snippet: isPolicy
          ? `${cleanKw} 진행 전 반드시 확인해야 할 자격 기준과 단계별 절차를 상세히 비교했습니다.`
          : `${cleanKw} 관련 주요 경위와 실무·시장에서 주목하는 핵심 포인트를 비교했습니다.`,
        url: `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(
          cleanKw
        )}`,
      },
      {
        rank: 2,
        title: isPolicy
          ? `직접 알아본 ${cleanKw} 장단점과 놓치기 쉬운 체크포인트`
          : `${cleanKw} 전후 맥락과 꼭 체크할 변화 포인트`,
        blogName: '상위 2위 블로그',
        snippet: `실제 데이터와 주요 분석을 바탕으로 정리한 ${cleanKw} 핵심 포인트를 확인하세요.`,
        url: `https://search.naver.com/search.naver?ssc=tab.blog.all&query=${encodeURIComponent(
          cleanKw
        )}`,
      }
    );
  }

  // Derive Information Gaps (what top 1~3 blogs missed) to avoid duplicate-document penalties
  const contentGaps: string[] = [];
  const sampledCount = crawledInsights.length;
  const tableMissingCount = crawledInsights.filter((c) => !c.hasTable).length;
  const simMissingCount = crawledInsights.filter((c) => !c.hasNumericSimulation).length;
  const drawbacksMissingCount = crawledInsights.filter((c) => !c.hasDrawbacksOrExceptions).length;
  const stepMissingCount = crawledInsights.filter((c) => !c.hasStepByStepGuide).length;

  if (sampledCount === 0 || tableMissingCount >= Math.ceil(sampledCount / 2)) {
    contentGaps.push(
      '상위 1~3위 글에 조건·비용·장단점을 한눈에 대조하는 구조화된 비교표가 없음 → 글 초반부에 핵심 비교표를 직접 구성해 차별화'
    );
  }
  if (sampledCount === 0 || drawbacksMissingCount >= Math.ceil(sampledCount / 2)) {
    contentGaps.push(
      '상위 글들이 장점·원론만 나열하고 신청 거절, 오류, 중도해지 손실 등 현실적인 단점·예외 조건을 놓침 → 실패/불이익/예외 케이스를 독립 소제목으로 전진 배치'
    );
  }
  if (sampledCount === 0 || simMissingCount >= Math.ceil(sampledCount / 2)) {
    contentGaps.push(
      '실제 금액·기간·스펙 수치를 대입한 구체적 시뮬레이션 계산 사례가 부족함 → 독자 상황별(A vs B) 수치 계산 및 선택 기준 제시'
    );
  }
  if (contentGaps.length < 3 && (sampledCount === 0 || stepMissingCount >= Math.ceil(sampledCount / 2))) {
    contentGaps.push(
      '추상적 개념 설명 위주이며 독자가 바로 실행할 단계별 해결 순서 및 체크리스트가 약함 → 1·2·3단계 실전 실행 플로우로 차별화'
    );
  }
  if (contentGaps.length < 3) {
    contentGaps.push(
      '상황별 최종 선택 가이드(누구에게 유리하고 누구는 피해야 하는지)가 모호함 → 조건별 명확한 추천·비추천 분기표 추가'
    );
  }

  const differentiationAngle = isPolicy
    ? `기존 상위 글이 단순 공고 요약에 머문 반면, 본 원고는 '${cleanKw}'의 실제 세후/수령액 수치 시뮬레이션과 거절·중도해지 예외 리스크를 최우선으로 파고드는 실전 판단 가이드로 차별화합니다.`
    : `기존 상위 글의 뻔한 나열식 구성을 피하고, '${cleanKw}'에 대해 독자가 가장 먼저 막히는 현실적 단점·오류·트레이드오프와 상황별 대안 선택 기준을 독창적 소제목으로 전개합니다.`;

  const avgCrawledChars =
    crawledInsights.length > 0
      ? Math.round(
          crawledInsights.reduce((sum, item) => sum + item.charCount, 0) / crawledInsights.length
        )
      : 2200;
  const recommendedCharCount = Math.min(3400, Math.max(1800, avgCrawledChars));

  const avgCrawledHeadings =
    crawledInsights.length > 0
      ? Math.round(
          crawledInsights.reduce((sum, item) => sum + Math.max(3, item.headings.length), 0) /
            crawledInsights.length
        )
      : 4;
  const recommendedHeadingCount = Math.min(6, Math.max(4, avgCrawledHeadings));

  const gapsGuide = `\n- **상위 1~3위 글에서 발견된 정보 빈틈(Information Gap — 반드시 독창적 소제목으로 공략할 항목)**:\n${contentGaps
    .slice(0, 3)
    .map((g, i) => `  ${i + 1}. ${g}`)
    .join('\n')}`;

  const headingsGuide =
    competitorHeadings.length > 0
      ? `\n- **상위 글 기존 소제목(절대 그대로 복사하지 말고, 이 주제를 뛰어넘는 더 구체적이고 차별화된 질문형 소제목으로 재설계할 것)**: ${competitorHeadings
          .slice(0, 5)
          .map((h) => `"${h}"`)
          .join(' / ')}`
      : '';

  const factsGuide =
    extractedKeyFacts.length > 0
      ? `\n- **팩트 검증용 참고 데이터(그대로 베껴 쓰지 말고 근거 수치만 선별해 내 문장으로 재구성)**:\n${extractedKeyFacts
          .slice(0, 6)
          .map((f) => `  · ${f}`)
          .join('\n')}`
      : '';

  const winningStrategyPrompt = `[상위 1~5위 경쟁글 빈틈(Information Gap) 역공략 분석 결과]
- 권장 목표 분량: 공백 제외 약 ${recommendedCharCount.toLocaleString()}자 (소제목 ${recommendedHeadingCount}개 구성)
- 핵심 차별화 각도: ${differentiationAngle}
- 본문 자연 분산 연관어: ${extractedSubKeywords.slice(0, 6).join(', ')}${gapsGuide}${headingsGuide}${factsGuide}
- **유사문서 회피 절대 원칙**: 상위 블로그의 소제목·문단 순서를 모방하면 검색엔진이 중복 요약글로 간주합니다. 위 '정보 빈틈'을 글 초반부와 독립 소제목에 배치해 독창적 정보 가치(Information Gain)를 확보하세요.`;

  return {
    keyword: cleanKw,
    analyzedAt: new Date().toISOString(),
    topCompetitors,
    recommendedCharCount,
    recommendedHeadingCount,
    extractedSubKeywords,
    competitorHeadings,
    extractedKeyFacts,
    contentGaps: contentGaps.slice(0, 3),
    differentiationAngle,
    scrapedImageUrls,
    winningStrategyPrompt,
  };
}

export async function checkPostSearchRank(
  post: BlogPost,
  blog?: BlogProfile
): Promise<PostRankInfo> {
  const keyword = post.targetKeyword.trim();
  const blogIdentifier = (blog?.auth.blogIdOrUsername || '').trim().toLowerCase();
  const blogDomain = (blog?.auth.blogUrl || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase();
  const titlePrefix = post.title.slice(0, 14).trim().toLowerCase();

  try {
    const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(
      keyword
    )}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);
      let currentRank = 0;
      let foundRank: number | null = null;
      let matchedTitle = '';
      let matchedUrl = '';

      $('.sds-comps-vertical-layout.sds-comps-full-layout, .view_wrap, .bx, .total_wrap').each(
        (_, el) => {
          if (foundRank !== null) return;
          const titleEl = $(el)
            .find(
              '.sds-comps-text-type-headline1, .title_link, .api_txt_lines.total_tit, a.title_area'
            )
            .first();
          const title = titleEl.text().trim();
          const link = (
            titleEl.attr('href') ||
            titleEl.closest('a').attr('href') ||
            $(el).find('a[href*="blog.naver.com"], a[href*="tistory.com"]').first().attr('href') ||
            ''
          ).toLowerCase();
          if (!title || title.length < 5) return;

          currentRank++;
          const isMyBlog =
            (blogIdentifier && link.includes(blogIdentifier)) ||
            (blogDomain && link.includes(blogDomain)) ||
            (titlePrefix.length >= 8 && title.toLowerCase().includes(titlePrefix));

          if (isMyBlog) {
            foundRank = currentRank;
            matchedTitle = title;
            matchedUrl = link;
          }
        }
      );

      if (foundRank !== null) {
        return {
          checkedAt: new Date().toISOString(),
          keyword,
          platform: blog?.platform || 'naver',
          isIndexed: true,
          rank: foundRank,
          matchedTitle,
          matchedUrl,
          summaryText: `'${keyword}' 검색 결과 ${foundRank}위 노출 중`,
        };
      }
    }
  } catch {
    // ignore network errors
  }

  return {
    checkedAt: new Date().toISOString(),
    keyword,
    platform: blog?.platform || 'naver',
    isIndexed: post.status === 'published',
    rank: null,
    summaryText:
      post.status === 'published'
        ? `검색 색인 반영 대기 중 또는 30위권 외 (발행 직후 검색엔진 반영까지 평균 1~3시간 소요)`
        : `아직 미발행 상태입니다. 발행 후 순위 추적이 가능합니다.`,
  };
}

export async function extractReferenceSourceMaterial(urlOrText: string): Promise<{
  sourceTitle: string;
  extractedSummary: string;
  extractedFacts: string[];
  suggestedKeyword: string;
}> {
  const raw = (urlOrText || '').trim();
  if (!raw) {
    return {
      sourceTitle: '',
      extractedSummary: '',
      extractedFacts: [],
      suggestedKeyword: '',
    };
  }

  const urlMatch = raw.match(/https?:\/\/[^\s]+/i);
  const memoText = raw.replace(/https?:\/\/[^\s]+/gi, '').trim();
  let pageTitle = '';
  let pageBody = '';

  if (urlMatch) {
    let targetUrl = urlMatch[0].trim();
    const naverMatch = targetUrl.match(/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d+)/i);
    if (naverMatch) {
      targetUrl = `https://m.blog.naver.com/${naverMatch[1]}/${naverMatch[2]}`;
    }

    try {
      const res = await fetch(targetUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const html = await res.text();
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, aside, noscript, iframe').remove();
        pageTitle = (
          $('meta[property="og:title"]').attr('content') ||
          $('h1').first().text() ||
          $('title').first().text() ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();

        const containerSelectors = [
          '#dic_area',
          '#newsct_article',
          '.se-main-container',
          '.tt_article_useless_p_margin',
          '.contents_style',
          'article',
          'main',
        ];
        for (const sel of containerSelectors) {
          const txt = $(sel).text().replace(/\s+/g, ' ').trim();
          if (txt.length >= 150) {
            pageBody = txt;
            break;
          }
        }
        if (!pageBody) {
          pageBody = $('p')
            .map((_, el) => $(el).text().trim())
            .get()
            .filter((t) => t.length >= 20)
            .join(' ');
        }
      }
    } catch {
      // fallback to memoText if URL unreachable
    }
  }

  const combinedText = [pageTitle, pageBody.slice(0, 2200), memoText]
    .filter(Boolean)
    .join('\n')
    .trim();

  const sentences = combinedText
    .split(/(?<=[.?!다요죠])\s+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length >= 22 && s.length <= 135);

  const factSentences = sentences
    .filter((s) =>
      /\d+(?:%|퍼센트|원|만원|억|개월|년|일|세|점|배|시간|분)|기준|조건|신청|방법|혜택|지원|차이/.test(s)
    )
    .slice(0, 6);

  const extractedFacts =
    factSentences.length >= 2 ? factSentences : sentences.slice(0, 5);

  const suggestedKeyword = pageTitle
    ? pageTitle
        .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
        .replace(/[^\w\s가-힣]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 5)
        .join(' ')
    : '';

  return {
    sourceTitle: pageTitle || '사용자 입력 참고 자료',
    extractedSummary: combinedText.slice(0, 1800),
    extractedFacts,
    suggestedKeyword,
  };
}
