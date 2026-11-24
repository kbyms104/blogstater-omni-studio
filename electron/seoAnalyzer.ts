import { SEOCheckItem, SEOScoreReport } from './types';

// Common robotic AI clichés that make Korean blog posts look machine-generated
const AI_CLICHE_PATTERNS = [
  /핵심만 알기 쉽게 정리해 드리는 블로그/i,
  /이자 누적 곡선을 그리게/i,
  /자산 형성을 완주하시길/i,
  /결정적 배경/i,
  /마지막 마인드셋/i,
  /현명한 선택을 위한 한 줄 가이드/i,
  /스탠다드 밸런스형/i,
  /하이엔드 올라운더형/i,
  /선택이 아닌 필수/i,
  /라고 할 수 있습니다/i,
  /살펴보도록 하겠습니다/i,
  /알아보도록 하겠습니다/i,
  /궁금증을 해결해 드리겠습니다/i,
  /완벽하게 정복/i,
  /빠르게 살펴보시죠/i,
  /지금 바로 확인해 보시죠/i,
];

const BOILERPLATE_LSI_STOPWORDS =
  /^(핵심|배경|원인|주요|쟁점|흐름|실제|영향|시장|반응|향후|전망|요약|실수령|혜택|조건|가장|중요한|기준|신청|관리|요령|주의|차이|차이점|비교|실사용|장단점|가격|가성비|추천|대상|정리|사전|준비물|자격|단계별|진행|순서|오류|해결|꿀팁|솔직한|후기|체감|구매|체크포인트|최종|만족도|평가|자격조건|신청절차|핵심혜택|주의사항|핵심배경|주요쟁점|실제영향|향후전망|배경과|쟁점과|혜택과|영향과|원인과)$/;

const FACT_UNIT_REGEX =
  /\d+(?:[.,]\d+)?\s*(?:%|퍼센트|원|만원|억원|조원|달러|개월|년|월|일|주|세|점|배|건|가지|단계|시간|분|명|위|회|차|곳|개|대|종|호|km|kg|mg|GB|TB|ms|초|만\s*원)/gi;

function extractValidFacts(text: string): string[] {
  const matches = text.match(FACT_UNIT_REGEX) || [];
  return matches
    .map((m) => m.replace(/\s+/g, ''))
    .filter((m) => !/^[123](?:가지|단계)$/.test(m));
}

export function evaluatePostSEO(params: {
  title: string;
  targetKeyword: string;
  markdownContent: string;
  subKeywords?: string[];
  tags?: string[];
  internalLinksCount?: number;
  internalLinkCount?: number;
  affiliateLinkCount?: number;
}): SEOScoreReport {
  const {
    title = '',
    targetKeyword = '',
    markdownContent = '',
    subKeywords = [],
    tags = [],
    internalLinksCount,
    internalLinkCount = internalLinksCount ?? 0,
    affiliateLinkCount = 0,
  } = params;

  // Strip fenced code blocks and inline images/links before computing prose metrics
  const plainText = markdownContent
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_~`|\[\]\(\)-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const charCount = plainText.replace(/\s/g, '').length;
  const words = plainText.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  // Count H2 and H3 headings
  const h2Matches = markdownContent.match(/^##\s+.+$/gm) || [];
  const h3Matches = markdownContent.match(/^###\s+.+$/gm) || [];
  const totalSubheadings = h2Matches.length + h3Matches.length;

  // Visual/structural formatting elements
  const hasTable = /\|.+\|.+\|\r?\n\|[\s:-]+\|/.test(markdownContent);
  const bulletMatches = markdownContent.match(/^(\s*[-*+]|\s*\d+\.)\s+.+$/gm) || [];
  const blockquoteMatches = markdownContent.match(/^>\s+.+$/gm) || [];
  const highlightMatches = markdownContent.match(/==.+?==|\*\*.+?\*\*/g) || [];
  const inlineImageCount = (markdownContent.match(/!\[[^\]]*\]\([^)]+\)/g) || []).length;
  const hasVisualSummaryElement =
    hasTable || bulletMatches.length >= 2 || blockquoteMatches.length >= 1 || inlineImageCount >= 1;

  // Question / Intent headings (AEO)
  const questionHeadings = [...h2Matches, ...h3Matches].filter((h) =>
    /\?|할까|일까|뭔가요|어떻게|얼마|차이|조건|방법|이유|언제|배경|쟁점|전망|원인|영향|기준|비교|순서|주의|해결|장단점/.test(
      h
    )
  );
  const hasFaq =
    /FAQ|자주 묻는 질문|Q1\.|Q\./i.test(markdownContent) || questionHeadings.length >= 2;

  // Keyword tokens
  let coreTokens = targetKeyword
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !/^202[0-9]년?$/.test(t));
  if (coreTokens.length === 0 && targetKeyword.trim()) {
    coreTokens = [targetKeyword.trim()];
  }
  const primaryToken = coreTokens[0] || targetKeyword.trim();
  const primaryEscaped = primaryToken
    ? primaryToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';
  const primaryRegex = primaryEscaped ? new RegExp(primaryEscaped, 'gi') : null;

  const keywordOccurrences = primaryRegex ? (plainText.match(primaryRegex) || []).length : 0;
  const keywordDensityPercent =
    wordCount > 0
      ? Number(((keywordOccurrences / Math.max(1, wordCount)) * 100).toFixed(2))
      : 0;

  const checks: SEOCheckItem[] = [];
  const suggestions: string[] = [];

  // ---------------------------------------------------------------------------
  // 1. [SEO] Title Keyword Front-Loading & Optimal Length (14 pts)
  // ---------------------------------------------------------------------------
  const titleLower = title.toLowerCase();
  const matchedTitleTokens = coreTokens.filter((t) => titleLower.includes(t.toLowerCase()));
  const totalCoreCount = Math.max(1, coreTokens.length);
  const coverageRatio = matchedTitleTokens.length / totalCoreCount;
  const titleCoverageScore =
    coverageRatio >= 1 ? 6 : coverageRatio >= 0.6 ? 4 : matchedTitleTokens.length >= 1 ? 2 : 0;

  let firstIdx = -1;
  for (const t of matchedTitleTokens) {
    const idx = titleLower.indexOf(t.toLowerCase());
    if (idx >= 0 && (firstIdx < 0 || idx < firstIdx)) {
      firstIdx = idx;
    }
  }
  const titleFrontScore =
    firstIdx < 0 ? 0 : firstIdx <= 15 ? 4 : firstIdx <= 26 ? 2 : 1;

  const hasTitleRepetition = coreTokens.some((t) => {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase();
    const matches = titleLower.match(new RegExp(escaped, 'g'));
    return (matches ? matches.length : 0) >= 3;
  });
  const titleLenOptimal = title.length >= 18 && title.length <= 48 && !hasTitleRepetition;
  const titleLenAcceptable = title.length >= 14 && title.length <= 56 && !hasTitleRepetition;
  const titleLengthScore = titleLenOptimal ? 4 : titleLenAcceptable ? 2 : 0;

  const titleScore = titleCoverageScore + titleFrontScore + titleLengthScore;
  const titlePassed =
    firstIdx >= 0 && firstIdx <= 15 && coverageRatio >= 0.6 && titleLenOptimal;

  checks.push({
    id: 'seo_title_opt',
    category: 'SEO',
    label: '제목 핵심 키워드 전진 배치 & 최적 길이 (18~48자)',
    passed: titlePassed,
    score: titleScore,
    maxScore: 14,
    detail:
      firstIdx >= 0
        ? `제목 ${title.length}자 · 핵심어 첫 위치 ${firstIdx + 1}번째 글자 (${
            firstIdx <= 15 ? '전진 배치 우수' : '앞쪽 15자 이내 배치 권장'
          }) · 일치 ${matchedTitleTokens.length}/${totalCoreCount}개`
        : `제목 ${title.length}자 · 핵심 키워드 미포함`,
  });
  if (!titlePassed) {
    suggestions.push(
      `[SEO] 제목 앞쪽 15자 이내에 '${primaryToken}' 핵심어를 자연스럽게 배치하고 18~48자로 맞추세요.`
    );
  }

  // ---------------------------------------------------------------------------
  // 2. [SEO] Content Depth & Anti-Stuffing Keyword Balance (14 pts)
  // ---------------------------------------------------------------------------
  const depthScore =
    charCount >= 1800
      ? 7
      : charCount >= 1450
      ? 6
      : charCount >= 1100
      ? 4
      : charCount >= 750
      ? 2
      : 0;

  const bodyBlocksForDensity = markdownContent
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && !p.startsWith('#') && !p.startsWith('|') && !p.startsWith('!['));

  let maxInSingleParagraph = 0;
  if (primaryRegex) {
    for (const block of bodyBlocksForDensity) {
      const cleanBlock = block.replace(/[#>*_~`|\[\]\(\)-]/g, ' ');
      const cnt = (cleanBlock.match(primaryRegex) || []).length;
      if (cnt > maxInSingleParagraph) maxInSingleParagraph = cnt;
    }
  }

  const fullKwLower = targetKeyword.trim().toLowerCase();
  const stuffedH2Count = h2Matches.filter(
    (h) => fullKwLower.length >= 8 && h.toLowerCase().includes(fullKwLower)
  ).length;

  const isOverStuffed =
    keywordOccurrences > 15 ||
    keywordDensityPercent > 3.5 ||
    stuffedH2Count >= 3 ||
    maxInSingleParagraph >= 4;

  const isOptimalBalance =
    !isOverStuffed &&
    keywordOccurrences >= 3 &&
    keywordOccurrences <= 12 &&
    keywordDensityPercent >= 0.5 &&
    keywordDensityPercent <= 2.8 &&
    stuffedH2Count <= 2 &&
    maxInSingleParagraph <= 3;

  const isAcceptableBalance =
    !isOverStuffed &&
    keywordOccurrences >= 2 &&
    keywordOccurrences <= 15 &&
    keywordDensityPercent <= 3.5 &&
    stuffedH2Count <= 2;

  const balanceScore = isOptimalBalance ? 7 : isAcceptableBalance ? 4 : 1;
  const seoDepthTotal = depthScore + balanceScore;
  const seoDepthPassed = charCount >= 1450 && isOptimalBalance;

  checks.push({
    id: 'seo_depth_balance',
    category: 'SEO',
    label: '검색엔진 선호 본문 분량 & 형태소 스팸 방어 균형',
    passed: seoDepthPassed,
    score: seoDepthTotal,
    maxScore: 14,
    detail: isOverStuffed
      ? `공백 제외 ${charCount.toLocaleString()}자 · 주의: 핵심어 과반복(총 ${keywordOccurrences}회, 밀도 ${keywordDensityPercent}%, 문단 최대 ${maxInSingleParagraph}회) 스팸 위험`
      : `공백 제외 ${charCount.toLocaleString()}자 · 핵심어 ${keywordOccurrences}회 (밀도 ${keywordDensityPercent}%, 문단 최대 ${maxInSingleParagraph}회)`,
  });
  if (charCount < 1450) {
    suggestions.push('[SEO] 정보 깊이 확보를 위해 본문을 공백 제외 1,450자 이상으로 보강하세요.');
  }
  if (isOverStuffed) {
    suggestions.push(
      '[SEO] 동일 핵심어가 특정 문단이나 소제목에 과도하게 반복되어 스팸 위험이 있습니다. 자연스러운 유의어로 분산하세요.'
    );
  }

  // ---------------------------------------------------------------------------
  // 3. [AEO] Structured H2 Sections & Direct Answer Snippets (12 pts)
  // ---------------------------------------------------------------------------
  const h2CountScore =
    h2Matches.length >= 4 && h2Matches.length <= 7
      ? 5
      : h2Matches.length === 3 || h2Matches.length > 7
      ? 3
      : h2Matches.length >= 1
      ? 1
      : 0;

  const sectionsAfterH2 = markdownContent.split(/^##\s+.+$/m).slice(1);
  let directAnswerSections = 0;
  for (const sec of sectionsAfterH2) {
    const firstNonImageBlock = sec
      .trim()
      .split(/\r?\n\s*\r?\n/)
      .map((b) => b.trim())
      .find((b) => b.length > 0 && !b.startsWith('!['));
    if (
      firstNonImageBlock &&
      !firstNonImageBlock.startsWith('#') &&
      !firstNonImageBlock.startsWith('|') &&
      !firstNonImageBlock.startsWith('-') &&
      !firstNonImageBlock.startsWith('*') &&
      !/^\d+\./.test(firstNonImageBlock)
    ) {
      const cleanFirst = firstNonImageBlock
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#>*_~`|\[\]\(\)-]/g, '')
        .trim();
      if (cleanFirst.length >= 35 && cleanFirst.length <= 210) {
        directAnswerSections++;
      }
    }
  }

  const snippetRatioOk =
    h2Matches.length >= 3 && directAnswerSections / Math.max(1, h2Matches.length) >= 0.75;
  const snippetScore =
    directAnswerSections >= 4 || snippetRatioOk
      ? 7
      : directAnswerSections === 3
      ? 5
      : directAnswerSections === 2
      ? 3
      : directAnswerSections === 1
      ? 1
      : 0;

  const aeoDirectScore = h2CountScore + snippetScore;
  const aeoDirectPassed =
    h2Matches.length >= 3 && (directAnswerSections >= 3 || snippetRatioOk);

  checks.push({
    id: 'aeo_direct_snippet',
    category: 'AEO',
    label: 'AI 브리핑 발췌용 소제목(H2) 구조화 & 두괄식 요약 문단',
    passed: aeoDirectPassed,
    score: aeoDirectScore,
    maxScore: 12,
    detail: `소제목 ${h2Matches.length}개 중 ${directAnswerSections}개 섹션 직후 두괄식 핵심 답변(35~210자) 배치됨`,
  });
  if (!aeoDirectPassed) {
    suggestions.push(
      '[AEO] 소제목(4~7개) 바로 아래 첫 문단에 35~210자 길이의 두괄식 핵심 결론을 배치하세요.'
    );
  }

  // ---------------------------------------------------------------------------
  // 4. [AEO] Question Intent Headings & Structured HTML Blocks (12 pts)
  // ---------------------------------------------------------------------------
  const questionScore =
    questionHeadings.length >= 3
      ? 5
      : questionHeadings.length === 2
      ? 3
      : questionHeadings.length === 1
      ? 1
      : 0;

  const tableScore = hasTable ? 4 : 0;
  const bulletScore =
    bulletMatches.length >= 4 ? 3 : bulletMatches.length >= 2 ? 2 : bulletMatches.length >= 1 ? 1 : 0;

  const aeoQueryScore = questionScore + tableScore + bulletScore;
  const aeoQueryPassed = aeoQueryScore >= 9;

  checks.push({
    id: 'aeo_query_structure',
    category: 'AEO',
    label: '질문 의도 매칭 소제목 & 구조화 데이터(비교표·리스트)',
    passed: aeoQueryPassed,
    score: aeoQueryScore,
    maxScore: 12,
    detail: `질문·의도형 소제목 ${questionHeadings.length}개 · 비교표 ${
      hasTable ? '있음' : '없음'
    } · 리스트 항목 ${bulletMatches.length}개`,
  });
  if (!hasTable || questionHeadings.length < 2) {
    suggestions.push(
      '[AEO] 검색 의도에 맞는 질문형 소제목(2개 이상)과 한눈에 비교되는 마크다운 표·리스트를 포함하세요.'
    );
  }

  // ---------------------------------------------------------------------------
  // 5. [GEO] Quantitative Fact Density & Section Distribution (12 pts)
  // ---------------------------------------------------------------------------
  const uniqueFactsCount = new Set(extractValidFacts(plainText)).size;
  let sectionsWithFacts = 0;
  for (const sec of sectionsAfterH2) {
    const secClean = sec
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
      .replace(/[#>*_~`|\[\]\(\)-]/g, ' ');
    if (extractValidFacts(secClean).length > 0) {
      sectionsWithFacts++;
    }
  }

  const geoFactScore =
    uniqueFactsCount >= 7 && sectionsWithFacts >= 3
      ? 12
      : uniqueFactsCount >= 5 && sectionsWithFacts >= 2
      ? 9
      : uniqueFactsCount >= 3
      ? 6
      : uniqueFactsCount >= 1
      ? 3
      : 0;
  const geoFactPassed = uniqueFactsCount >= 5 && sectionsWithFacts >= 2;

  checks.push({
    id: 'geo_fact_density',
    category: 'GEO',
    label: '생성형 AI(Perplexity·ChatGPT) 인용 수치·팩트 밀도 및 분포',
    passed: geoFactPassed,
    score: geoFactScore,
    maxScore: 12,
    detail: `검증 가능한 수치·단위 데이터 ${uniqueFactsCount}종 · ${sectionsWithFacts}개 섹션에 고르게 분포`,
  });
  if (!geoFactPassed) {
    suggestions.push(
      '[GEO] AI 검색엔진 인용률을 높이려면 구체적 수치·단위(%, 금액, 기간, 기준)를 5종 이상 여러 소제목에 분산 배치하세요.'
    );
  }

  // ---------------------------------------------------------------------------
  // 6. [GEO] Opening Entity Definition & Related LSI Coverage (12 pts)
  // ---------------------------------------------------------------------------
  const first220 = plainText.slice(0, 220).toLowerCase();
  const first380 = plainText.slice(0, 380).toLowerCase();
  const introHas220 =
    coreTokens.length > 0 ? coreTokens.some((t) => first220.includes(t.toLowerCase())) : true;
  const introHas380 =
    coreTokens.length > 0 ? coreTokens.some((t) => first380.includes(t.toLowerCase())) : true;
  const hasDuplicateH1 = /^#\s+.+/m.test(markdownContent.trim());

  const openingScore = introHas220 && !hasDuplicateH1 ? 5 : introHas380 ? 3 : 0;

  const coreLowerSet = new Set(coreTokens.map((t) => t.toLowerCase()));
  const lsiCandidatesSet = new Set<string>();
  const addLsiCandidate = (raw: string) => {
    for (const tok of (raw || '').split(/[,·~?!…:\s/]+/)) {
      const clean = tok.replace(/[^가-힣a-zA-Z0-9]/g, '').trim();
      const lower = clean.toLowerCase();
      if (
        clean.length >= 2 &&
        clean.length <= 12 &&
        !/^[0-9]+$/.test(clean) &&
        !coreLowerSet.has(lower) &&
        !BOILERPLATE_LSI_STOPWORDS.test(clean)
      ) {
        lsiCandidatesSet.add(clean);
      }
    }
  };
  for (const sk of subKeywords) addLsiCandidate(sk);
  for (const tg of tags) addLsiCandidate(tg);

  const lsiPool = Array.from(lsiCandidatesSet);
  const plainLower = plainText.toLowerCase();
  const coveredLsi = lsiPool.filter((tok) => plainLower.includes(tok.toLowerCase()));
  const lsiCoveredCount = coveredLsi.length;

  const lsiScore =
    lsiCoveredCount >= 4
      ? 7
      : lsiCoveredCount === 3
      ? 5
      : lsiCoveredCount === 2
      ? 3
      : lsiCoveredCount === 1
      ? 2
      : 0;

  const geoEntityScore = openingScore + lsiScore;
  const entityPassed = openingScore === 5 && lsiCoveredCount >= 3;

  checks.push({
    id: 'geo_entity_context',
    category: 'GEO',
    label: '도입부 엔티티 정의 & 연관 검색어(LSI) 본문 커버리지',
    passed: entityPassed,
    score: geoEntityScore,
    maxScore: 12,
    detail: `초반 220자 엔티티 ${introHas220 ? '명시됨' : '미흡'} · 본문 연관어 ${lsiCoveredCount}/${Math.max(
      lsiPool.length,
      lsiCoveredCount
    )}종 반영됨`,
  });
  if (!entityPassed) {
    suggestions.push(
      '[GEO] 글 도입부 220자 이내에 핵심 주제를 명확히 정의하고, 연관 서브 키워드(태그)를 본문에 3~4개 이상 자연스럽게 녹여 쓰세요.'
    );
  }

  // ---------------------------------------------------------------------------
  // 7. [DIA] Mobile Paragraph Rhythm & Visual Media Elements (12 pts)
  // ---------------------------------------------------------------------------
  const paragraphs = markdownContent
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(
      (p) =>
        p.length > 0 &&
        !p.startsWith('#') &&
        !p.startsWith('|') &&
        !p.startsWith('![') &&
        !/^```/.test(p)
    );
  const avgParagraphChars =
    paragraphs.length > 0
      ? Math.round(paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length)
      : 0;
  const longParaCount = paragraphs.filter((p) => p.length > 220).length;

  const rhythmScore =
    paragraphs.length >= 10 && avgParagraphChars <= 170 && longParaCount === 0
      ? 7
      : paragraphs.length >= 8 && avgParagraphChars <= 200 && longParaCount <= 1
      ? 5
      : paragraphs.length >= 6 && longParaCount <= 3
      ? 3
      : paragraphs.length >= 1
      ? 1
      : 0;

  const visualScore =
    inlineImageCount >= 1 && (blockquoteMatches.length >= 1 || highlightMatches.length >= 4)
      ? 5
      : inlineImageCount >= 1 || (blockquoteMatches.length >= 1 && highlightMatches.length >= 3)
      ? 3
      : highlightMatches.length >= 3
      ? 2
      : 0;

  const diaReadabilityScore = rhythmScore + visualScore;
  const diaReadabilityPassed = rhythmScore >= 5 && visualScore >= 3;

  checks.push({
    id: 'dia_experience_mobile',
    category: 'DIA',
    label: '모바일 문단 호흡(벽돌글 방지) & 시각 자료(이미지·인용)',
    passed: diaReadabilityPassed,
    score: diaReadabilityScore,
    maxScore: 12,
    detail: `총 ${paragraphs.length}문단 (평균 ${avgParagraphChars}자, 장문 220자↑ ${longParaCount}개) · 본문 이미지 ${inlineImageCount}장 · 강조 ${highlightMatches.length}곳`,
  });
  if (rhythmScore < 5) {
    suggestions.push(
      '[D.I.A.+] 모바일 가독성을 위해 220자가 넘는 긴 문단을 1~2문장(평균 170자 이하)씩 끊어 주세요.'
    );
  }
  if (inlineImageCount < 1) {
    suggestions.push(
      '[D.I.A.+] 체류시간 향상을 위해 스튜디오 상단의 [+ 본문 중간 요약이미지]나 이미지 자료를 1장 이상 삽입하세요.'
    );
  }

  // ---------------------------------------------------------------------------
  // 8. [DIA] Sentence Ending Variety & Anti-AI Cliché Check (12 pts)
  // ---------------------------------------------------------------------------
  const clicheHits = AI_CLICHE_PATTERNS.filter((rx) => rx.test(markdownContent)).length;
  const clicheScore = clicheHits === 0 ? 5 : clicheHits === 1 ? 2 : 0;

  // Inspect prose sentences line/punctuation-aware so Korean blog lines without periods count too
  const proseCleanForSentences = markdownContent
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '\n')
    .replace(/^#{1,6}\s+.+$/gm, '\n')
    .replace(/^\|.+\|$/gm, '\n')
    .replace(/[>*_`]/g, ' ');
  const sentences = proseCleanForSentences
    .split(/(?<=[.?!])\s+|\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);

  let maxSameRigidRun = 0;
  let curRigidStem = '';
  let curRun = 0;
  let friendlyEndingCount = 0;

  for (const s of sentences) {
    const rigidMatch = s.match(/(입니다|합니다|됩니다)[.?!]*$/);
    if (rigidMatch) {
      const stem = rigidMatch[1];
      if (stem === curRigidStem) {
        curRun++;
      } else {
        curRigidStem = stem;
        curRun = 1;
      }
      if (curRun > maxSameRigidRun) maxSameRigidRun = curRun;
    } else {
      curRigidStem = '';
      curRun = 0;
    }

    if (
      /(?:해요|거든요|더라고요|네요|죠|세요|편이에요|좋아요|추천해요|보시면\s*돼요|같아요|있어요|없어요|봤어요|했어요|드려요|볼게요|할게요)[.?!~]*$/.test(
        s
      )
    ) {
      friendlyEndingCount++;
    }
  }

  const hasMonotonousRun = maxSameRigidRun >= 4;
  const voiceScore =
    !hasMonotonousRun && friendlyEndingCount >= 4
      ? 7
      : !hasMonotonousRun && friendlyEndingCount >= 2
      ? 5
      : !hasMonotonousRun
      ? 3
      : 1;

  const diaToneScore = clicheScore + voiceScore;
  const diaTonePassed = clicheHits === 0 && !hasMonotonousRun && friendlyEndingCount >= 4;

  checks.push({
    id: 'dia_human_authenticity',
    category: 'DIA',
    label: '문장 어미 다양성(기계적 반복 배제) & AI 상투어 클린 검증',
    passed: diaTonePassed,
    score: diaToneScore,
    maxScore: 12,
    detail: `AI 상투어 ${clicheHits}건 · 동일 딱딱한 어미 연속 최대 ${maxSameRigidRun}문장 · 친근한 구어체 종결 ${friendlyEndingCount}회`,
  });
  if (hasMonotonousRun || friendlyEndingCount < 4) {
    suggestions.push(
      '[D.I.A.+] "~입니다/~합니다" 어미가 4문장 이상 연속되지 않도록 [사람 말투·호흡 다듬기]로 구어체 리듬을 섞어 주세요.'
    );
  }

  // Compute aggregate and per-engine normalized scores (0-100)
  const calcCategoryPercent = (cat: 'SEO' | 'AEO' | 'GEO' | 'DIA') => {
    const items = checks.filter((c) => c.category === cat);
    const earned = items.reduce((s, i) => s + i.score, 0);
    const max = items.reduce((s, i) => s + i.maxScore, 0);
    return max > 0 ? Math.min(100, Math.round((earned / max) * 100)) : 100;
  };

  const seoScore = calcCategoryPercent('SEO');
  const aeoScore = calcCategoryPercent('AEO');
  const geoScore = calcCategoryPercent('GEO');
  const diaScore = calcCategoryPercent('DIA');

  const totalScore = Math.min(
    100,
    checks.reduce((acc, item) => acc + item.score, 0)
  );

  let grade: SEOScoreReport['grade'] = 'B';
  if (totalScore >= 92) grade = 'S';
  else if (totalScore >= 84) grade = 'A';
  else if (totalScore >= 72) grade = 'B';
  else if (totalScore >= 60) grade = 'C';
  else grade = 'D';

  const readingTimeMinutes = Math.max(1, Math.round(charCount / 500));
  const mobileReadable = paragraphs.length >= 8 && avgParagraphChars <= 200 && longParaCount <= 1;
  const estimatedDwellSeconds = Math.round(
    readingTimeMinutes * 60 +
      (hasVisualSummaryElement ? 40 : 0) +
      (mobileReadable ? 35 : 0) +
      inlineImageCount * 20
  );

  return {
    totalScore,
    seoScore,
    aeoScore,
    geoScore,
    diaScore,
    grade,
    wordCount,
    charCount,
    readingTimeMinutes,
    estimatedDwellSeconds,
    keywordDensityPercent,
    headingCount: { h2: h2Matches.length, h3: h3Matches.length },
    hasTable,
    hasFaq,
    internalLinkCount,
    affiliateLinkCount,
    checks,
    suggestions,
  };
}
