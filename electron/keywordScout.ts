import * as cheerio from 'cheerio';
import { BlogPost, BlogProfile, TrendTopic, WebAISessionInfo } from './types';

export interface SubtopicDefinition {
  keyword: string;
  subCategory: string;
  interestReason: string;
  searchIntent: TrendTopic['searchIntent'];
  cpcLevel: TrendTopic['cpcLevel'];
  baseSearchVolume: number;
  sourceType?: TrendTopic['source'];
  customTitles?: string[];
  clusterCount?: number;
  autocompleteRank?: number;
}

/**
 * Broad category to live sub-seed clusters.
 * These sub-seeds are queried against Naver Autocomplete, Google Suggest KR,
 * Naver Blog Live SERP, and Google News KR RSS in real time.
 */
const BROAD_CATEGORY_SEED_CLUSTERS: Array<{
  pattern: RegExp;
  categoryName: string;
  liveSeeds: string[];
  curatedFallbacks: SubtopicDefinition[];
}> = [
  {
    pattern: /재테크|금융|경제|돈|투자|자산|절세|세금|은행|지원금|복지|정책|연금|적금|주식|카드/i,
    categoryName: '경제·재테크·금융',
    liveSeeds: [
      '청년도약계좌 중도해지',
      '청년도약계좌 갈아타기',
      '청년내일저축계좌 조건',
      'ISA 계좌 절세',
      '파킹통장 금리 비교',
      '국민연금 조기수령',
      '건강보험료 피부양자 자격',
      '근로장려금 신청자격',
      '종합소득세 환급',
      '연말정산 소득공제',
      '주택청약 월 25만원',
      '개인형 IRP 세액공제',
      '신생아 특례대출 조건',
      '실비보험 청구 서류',
      '미국 배당주 세금',
      'K패스 교통카드 환급',
      '소상공인 정책자금 대출',
      '기초연금 수급자격',
      '전세보증금 반환보증',
      '정기예금 금리 높은곳',
      '부모급여 신청방법',
    ],
    curatedFallbacks: [
      {
        keyword: '청년도약계좌 중도해지 특별중도해지 비과세 유지 조건',
        subCategory: '최신 정책·지원금',
        interestReason: '급전이 필요해 해지할 때 정부기여금과 비과세 혜택을 잃지 않는 특별중도해지 사유 및 부분인출 활용법 검색 급증',
        searchIntent: 'howto',
        cpcLevel: 'ultra',
        baseSearchVolume: 58400,
      },
      {
        keyword: 'ISA 계좌 중개형 만기 해지 후 연금저축 이전 세액공제',
        subCategory: '생활비 절감·환급',
        interestReason: '3년 의무가입 기간 도래 후 만기 자금을 연금저축·IRP로 전환해 최대 300만원 추가 세액공제 받는 방법 관심 집중',
        searchIntent: 'howto',
        cpcLevel: 'ultra',
        baseSearchVolume: 46200,
      },
      {
        keyword: '건강보험료 피부양자 자격 상실 기준 금융소득 연금 합산',
        subCategory: '솔직 리뷰·주의사항',
        interestReason: '이자·배당·연금소득 연 2,000만원 초과 시 지역가입자 전환으로 인한 건보료 폭탄 예방 전략',
        searchIntent: 'informational',
        cpcLevel: 'high',
        baseSearchVolume: 51900,
      },
      {
        keyword: '파킹통장 금리 비교 조건 없이 매일 이자 주는 곳 TOP 5',
        subCategory: '스펙·조건 비교',
        interestReason: '복잡한 카드 실적이나 급여이체 우대조건 없이 하루만 맡겨도 연 3%대 이자를 주는 파킹통장 비교',
        searchIntent: 'comparison',
        cpcLevel: 'high',
        baseSearchVolume: 63100,
      },
    ],
  },
  {
    // Avoid matching '재테크' via negative lookbehind (?<!재)
    pattern: /(?<!재)테크|it|디지털|가전|컴퓨터|모바일|스마트폰|전자기기|가젯|리뷰|노트북|아이폰|갤럭시/i,
    categoryName: 'IT·테크·가전',
    liveSeeds: [
      '로봇청소기 직배수 설치',
      '맥북에어 M4 후기',
      '아이패드 에어 M3 비교',
      '갤럭시 S25 울트라 카메라',
      '아이폰 17 프로 출시',
      '가성비 노트북 추천',
      '4K 모니터 PD충전',
      '노이즈캔슬링 헤드폰 비교',
      '미니PC 추천 가성비',
      '기계식 키보드 저소음 추천',
      '가정용 빔프로젝터 추천',
      '식기세척기 12인용 설치',
      '무선 청소기 흡입력 비교',
      '공기청정기 필터 교체주기',
      '외장SSD 추천 속도',
      '알뜰폰 요금제 비교',
    ],
    curatedFallbacks: [
      {
        keyword: '로봇청소기 물걸레 온수세척 직배수 설치 조건 및 단점',
        subCategory: '솔직 리뷰·주의사항',
        interestReason: '150만원대 플래그십 로봇청소기 구매 전 오수통 악취 문제와 싱크대 직배수 타공 가능 여부 실사용 후기 검색',
        searchIntent: 'review',
        cpcLevel: 'high',
        baseSearchVolume: 44800,
      },
      {
        keyword: '맥북에어 M4 기본형 16GB 램 영상편집 코딩 실사용 후기',
        subCategory: '스펙·가성비 비교',
        interestReason: '기본 램 16GB 탑재로 프로 모델 대신 에어로 4K 편집이 충분한지 가성비 체감 비교',
        searchIntent: 'comparison',
        cpcLevel: 'high',
        baseSearchVolume: 53200,
      },
    ],
  },
  {
    pattern: /건강|의학|운동|웰니스|다이어트|영양제|식단|헬스|뷰티|피부|통증|수면/i,
    categoryName: '건강·운동·웰니스',
    liveSeeds: [
      '식후 혈당 스파이크 예방',
      '연속혈당측정기 다이어트',
      '마그네슘 글리시네이트 효능',
      '알티지 오메가3 고르는법',
      '간헐적 단식 16대8 방법',
      '목디스크 베개 스트레칭',
      '족저근막염 깔창 스트레칭',
      '유산균 복용시간 아침 저녁',
      '비타민D 주사 가격 효과',
      '러닝화 입문 추천',
      '단백질 보충제 유당불내증',
      '역류성식도염 좋은음식 피해야할음식',
      '대상포진 예방접종 가격',
      '수면무호흡증 양압기 임대',
    ],
    curatedFallbacks: [
      {
        keyword: '식후 혈당 스파이크 증상 졸음 막는 거꾸로 식사법 순서',
        subCategory: '실전 해결 가이드',
        interestReason: '점심 식사 후 극심한 피로감과 체지방 축적을 유발하는 혈당 급상승을 식이섬유 선섭취로 잡는 루틴',
        searchIntent: 'howto',
        cpcLevel: 'medium',
        baseSearchVolume: 47300,
      },
    ],
  },
  {
    pattern: /부동산|내집마련|청약|인테리어|살림|자취|생활|라이프|일상|전세|월세|아파트/i,
    categoryName: '부동산·인테리어·살림',
    liveSeeds: [
      '전세사기 예방 특약 문구',
      'HUG 전세보증보험 가입조건',
      '확정일자 전입신고 효력',
      '주택청약 1순위 가점 계산',
      '인버터 에어컨 전기세 절약',
      '화장실 실리콘 곰팡이 제거',
      '건조기 옷 줄어듦 방지',
      '이사 체크리스트 도시가스',
      '생애최초 취득세 감면 조건',
      '청년 월세 특별지원 신청',
      '부동산 중개수수료 계산기',
      '층간소음 매트 시공 단점',
    ],
    curatedFallbacks: [
      {
        keyword: '전세 계약 시 집주인 세금 체납 확인 및 필수 특약 문구 5가지',
        subCategory: '솔직 리뷰·주의사항',
        interestReason: '전입신고 익일 효력 발생 허점을 막고 선순위 근저당 말소 조건을 명시하는 안전 특약 수요',
        searchIntent: 'howto',
        cpcLevel: 'ultra',
        baseSearchVolume: 52400,
      },
    ],
  },
  {
    pattern: /여행|맛집|캠핑|취미|문화|국내여행|해외여행|카페|항공권|호텔/i,
    categoryName: '여행·맛집·라이프',
    liveSeeds: [
      '트래블로그 트래블월렛 비교',
      '인천공항 스마트패스 등록',
      '기내 반입 금지 보조배터리',
      '비짓재팬웹 등록방법',
      '후쿠오카 3박4일 자유여행 코스',
      '제주도 렌트카 완전자차 비교',
      '초보 캠핑 장비 필수 리스트',
      '해외여행자보험 휴대품 손해',
      '인천공항 장기주차장 예약',
    ],
    curatedFallbacks: [
      {
        keyword: '일본 여행 트래블로그 vs 트래블월렛 엔화 환전 ATM 출금 수수료',
        subCategory: '스펙·조건 비교',
        interestReason: '일본 현지 편의점 ATM 무료 출금 한도와 남은 외화 환불 수수료 실사용 비교',
        searchIntent: 'comparison',
        cpcLevel: 'high',
        baseSearchVolume: 61500,
      },
    ],
  },
  {
    pattern: /자동차|모빌리티|전기차|운전|차량|중고차|캠핑카|타이어/i,
    categoryName: '자동차·모빌리티',
    liveSeeds: [
      '전기차 보조금 지자체 조회',
      '자동차보험 다이렉트 비교견적',
      '하이브리드 SUV 연비 비교',
      '타이어 교체주기 가격 비교',
      '운전자보험 필수 특약',
      '자동차세 연납 신청 기간',
      '신차 장기렌트 리스 비교',
      '엔진오일 교환주기 공임나라',
    ],
    curatedFallbacks: [
      {
        keyword: '자동차보험 다이렉트 비교견적 마일리지 특약 환급률 높은 곳',
        subCategory: '생활비 절감·환급',
        interestReason: '주행거리 환급 특약과 티맵·카카오내비 안전운전 할인을 중복 적용해 보험료 아끼는 법',
        searchIntent: 'comparison',
        cpcLevel: 'ultra',
        baseSearchVolume: 57200,
      },
    ],
  },
  {
    pattern: /육아|교육|공부|자기계발|자격증|취업|영어|독서|내일배움카드/i,
    categoryName: '육아·교육·자기계발',
    liveSeeds: [
      '국민내일배움카드 신청자격',
      '부모급여 아동수당 신청',
      '첫만남이용권 사용처 조회',
      '아이돌봄서비스 정부지원 소득기준',
      '직장인 국비지원 자격증 추천',
      '지게차운전기능사 실기 시험',
      '사회복지사 2급 실습 조건',
      '육아휴직 급여 상한액 신청',
    ],
    curatedFallbacks: [
      {
        keyword: '육아휴직 급여 상한액 인상 및 사후지급금 폐지 실수령액 계산',
        subCategory: '최신 정책·지원금',
        interestReason: '육아휴직 기간 중 공제 없이 매달 전액 지급되는 개편안 적용 대상과 부부 동시 사용 혜택 확인',
        searchIntent: 'informational',
        cpcLevel: 'ultra',
        baseSearchVolume: 64100,
      },
    ],
  },
  {
    pattern: /개발|코딩|프로그래밍|ai|인공지능|클라우드|엔지니어링|소프트웨어|자바|java|보안|취약점|백엔드|서버/i,
    categoryName: '개발·AI·프로그래밍',
    liveSeeds: [
      '클로드 프로 챗GPT 플러스 비교',
      '로컬 LLM Ollama 설치',
      '커서 AI 에디터 사용법',
      '깃허브 코파일럿 요금제',
      'Next.js 서버액션 캐싱',
      '파이썬 업무자동화 엑셀',
      '구글 제미나이 API 무료한도',
      'MCP 서버 연동 방법',
      '타입스크립트 제네릭 실무',
      '도커 컴포즈 배포 가이드',
      'AWS EC2 프리티어 요금',
      '클라우드플레어 워커즈 무료',
      'React Query 캐싱 전략',
      'RAG 벡터 DB 비교',
      '바이브 코딩 프롬프트 팁',
      'PostgreSQL 인덱스 튜닝',
      '쿠버네티스 파드 오토스케일링',
      'GitHub Actions CI CD 자동화',
    ],
    curatedFallbacks: [
      {
        keyword: '코딩용 AI 구독 비교 클로드 프로 vs 챗GPT 플러스 실무 장단점',
        subCategory: '스펙·조건 비교',
        interestReason: '실제 코드 리팩토링 정확도와 일일 메시지 제한량을 기준으로 어떤 구독이 이득인지 비교',
        searchIntent: 'comparison',
        cpcLevel: 'high',
        baseSearchVolume: 36500,
      },
      {
        keyword: '로컬 LLM Ollama 설치 및 GPU 사양별 추천 오픈소스 모델 비교',
        subCategory: '실전 해결 가이드',
        interestReason: 'API 비용 없이 내 PC에서 Llama·Qwen 모델을 직접 구동하기 위한 VRAM 기준 및 설치 방법 검색 증가',
        searchIntent: 'howto',
        cpcLevel: 'high',
        baseSearchVolume: 39200,
      },
      {
        keyword: 'MCP Model Context Protocol 개념과 개발 워크플로우 연동 방법',
        subCategory: '개발·AI 트렌드',
        interestReason: 'AI 에이전트에 로컬 파일·DB·브라우저 도구를 연결하는 표준 프로토콜 실무 활용 사례 관심 집중',
        searchIntent: 'informational',
        cpcLevel: 'high',
        baseSearchVolume: 34800,
      },
      {
        keyword: 'AWS vs Cloudflare 무료 티어 웹서비스 배포 유지비용 실전 비교',
        subCategory: '스펙·조건 비교',
        interestReason: '사이드 프로젝트나 API 서버 호스팅 시 트래픽 과금 폭탄을 피하는 클라우드 조합 비교',
        searchIntent: 'comparison',
        cpcLevel: 'high',
        baseSearchVolume: 31600,
      },
    ],
  },
  {
    pattern: /시사|뉴스|이슈|트렌드|상식|자유|국제|외교|정치|사회/i,
    categoryName: '시사·이슈·트렌드',
    liveSeeds: [
      '미국 기준금리 인하 전망',
      '환율 전망 달러 엔화',
      '글로벌 반도체 공급망 이슈',
      '국내 물가 상승률 전망',
      '인공지능 저작권 가이드라인',
      '기후변화 탄소중립 정책',
      '글로벌 빅테크 실적 발표',
    ],
    curatedFallbacks: [
      {
        keyword: '미국 기준금리 및 환율 변동이 국내 증시·체감 물가에 미치는 영향',
        subCategory: '시사·경제 이슈',
        interestReason: '환율 변동 추이와 시중 금리·생활경제에 미치는 영향 정리 수요',
        searchIntent: 'informational',
        cpcLevel: 'high',
        baseSearchVolume: 48500,
      },
    ],
  },
];

const BROAD_CATEGORY_LABEL_REGEX =
  /^(재테크|금융|경제|경제·재테크|절세|지원금|절세·지원금|IT|테크|가전|IT·가전|디지털|건강|운동|웰니스|건강·운동|건강·웰니스|부동산|인테리어|살림|주거|여행|맛집|라이프|자동차|모빌리티|육아|교육|자기계발|개발|코딩|프로그래밍|AI|인공지능|AI·인공지능|클라우드|소프트웨어|엔지니어링|시사|뉴스|이슈|트렌드|상식|자유|자유주제)$/i;

/**
 * Verifies whether a candidate TrendTopic strictly belongs to the target blog and matches its niche topics.
 */
export function isTrendCompatibleWithBlog(
  trend: Pick<TrendTopic, 'keyword' | 'parentSeedKeyword' | 'recommendedBlogId'>,
  blog: BlogProfile
): boolean {
  if (trend.recommendedBlogId !== blog.id) return false;
  if (!blog.nicheKeywords || blog.nicheKeywords.length === 0) return true;

  const matchedClusters = BROAD_CATEGORY_SEED_CLUSTERS.filter((c) =>
    blog.nicheKeywords.some((nk) => c.pattern.test(nk))
  );
  const unmatchedClusters = BROAD_CATEGORY_SEED_CLUSTERS.filter(
    (c) => !matchedClusters.includes(c)
  );

  const isBlogFinanceOrPolicy = blog.nicheKeywords.some((nk) =>
    /재테크|금융|경제|절세|지원금|복지|정책|연금|세금|부동산|청약|전세|시사|뉴스|자유/i.test(nk)
  );
  if (
    !isBlogFinanceOrPolicy &&
    /국민연금|기초연금|청년도약계좌|청년내일저축|근로장려금|정기예금|파킹통장|주택청약|전세보증|실비보험|건강보험료|종합소득세|연말정산|신생아\s*특례|부모급여/i.test(
      trend.keyword
    )
  ) {
    return false;
  }

  if (matchedClusters.length > 0) {
    const combinedText = `${trend.keyword} ${trend.parentSeedKeyword || ''}`.toLowerCase();
    const matchesOwnNiche = blog.nicheKeywords.some((nk) =>
      nk
        .split(/[·,\s]+/)
        .filter((tok) => tok.length >= 2)
        .some((tok) => combinedText.includes(tok.toLowerCase()))
    );
    const matchesOwnCluster = matchedClusters.some(
      (c) =>
        c.pattern.test(combinedText) ||
        c.liveSeeds.some((s) =>
          s
            .split(/\s+/)
            .filter((w) => w.length >= 2)
            .some((w) => combinedText.includes(w.toLowerCase()))
        )
    );
    const matchesOtherCluster = unmatchedClusters.some(
      (c) =>
        c.pattern.test(combinedText) ||
        c.liveSeeds.some((s) => {
          const toks = s.split(/\s+/).filter((w) => w.length >= 2);
          return (
            toks.length >= 2 &&
            toks.filter((w) => combinedText.includes(w.toLowerCase())).length >= 2
          );
        })
    );
    if (matchesOtherCluster && !matchesOwnCluster && !matchesOwnNiche) {
      return false;
    }
  }

  return true;
}

// Filter out community slang / noisy suffixes / lawyer or commercial spam from autocomplete & SERP
const NOISE_WORD_REGEX =
  /디시|더쿠|클리앙|펨코|블라인드|나무위키|찌라시|변호사|법무법인|착수금|무료상담|분양상담/i;

export function normalizeKey(kw: string): string {
  return (kw || '')
    .toLowerCase()
    .replace(/[\s·,\-_/\[\]()!?'"“”‘’|｜]/g, '')
    .trim();
}

function isNearDuplicateKeyword(candidate: string, existingList: string[]): boolean {
  const normA = normalizeKey(candidate);
  if (!normA) return true;
  const tokensA = candidate
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);

  for (const existing of existingList) {
    const normB = normalizeKey(existing);
    if (!normB) continue;
    if (normA === normB) return true;
    // If one is a direct substring of the other and length difference is small
    if ((normA.includes(normB) || normB.includes(normA)) && Math.abs(normA.length - normB.length) <= 4) {
      return true;
    }
    // If 3+ tokens overlap identically
    const tokensB = existing
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2);
    if (tokensA.length >= 3 && tokensB.length >= 3) {
      const overlap = tokensA.filter((t) => tokensB.includes(t)).length;
      if (overlap >= Math.min(tokensA.length, tokensB.length)) {
        return true;
      }
    }
  }
  return false;
}

export function detectSearchIntent(keyword: string): TrendTopic['searchIntent'] {
  if (/비교|vs|차이|순위|스펙|갈아타기|장단점/i.test(keyword)) return 'comparison';
  if (/추천|가성비|구매|가격|할인|특가|TOP|고르는법/i.test(keyword)) return 'commercial';
  if (/후기|단점|실사용|리뷰|부작용|주의사항|거절|탈락|불이익/i.test(keyword)) return 'review';
  if (/방법|해결|설정|순서|신청|계산|조회|가이드|서류|등록|청구|제거|특약|설치|구현|연동|세팅|배포|사용법|입문|패치|점검|튜닝/i.test(keyword)) return 'howto';
  return 'informational';
}

export function classifySubCategory(keyword: string): string {
  if (/지원금|계좌|연금|급여|대출|보조금|청약|제도|개편|자격|조건|특례/i.test(keyword)) {
    return '최신 정책·지원금';
  }
  if (/트럼프|대통령|선거|관세|국회|외교|연준|증시|주가|환율|코스피|나스닥|비트코인|금리/i.test(keyword)) {
    return '시사·경제 이슈';
  }
  if (/아이폰|갤럭시|노트북|모니터|가전|AI|챗GPT|클로드|반도체|엔비디아|젠슨|로봇/i.test(keyword)) {
    return 'IT·테크 트렌드';
  }
  if (/비교|vs|차이|순위|TOP|스펙|가성비|갈아타기/i.test(keyword)) {
    return '스펙·조건 비교';
  }
  if (/환급|절세|공제|절약|할인|수수료|보험료|전기세|이자/i.test(keyword)) {
    return '생활비 절감·환급';
  }
  if (/후기|단점|부작용|주의사항|실사용|거절|상실|해지|불이익/i.test(keyword)) {
    return '솔직 리뷰·주의사항';
  }
  if (/방법|신청|등록|설치|해결|순서|조회|청구|서류|특약/i.test(keyword)) {
    return '실전 해결 가이드';
  }
  return '실시간 포털 이슈';
}

export function detectCpcLevel(keyword: string): TrendTopic['cpcLevel'] {
  if (/대출|보험|지원금|환급|계좌|세금|연금|청약|카드|리스|렌트|보증|공제/i.test(keyword)) {
    return 'ultra';
  }
  if (/노트북|모니터|청소기|아이폰|갤럭시|맥북|영양제|자격증|수수료|금리|미국주식|환율|반도체/i.test(keyword)) {
    return 'high';
  }
  return 'medium';
}

export function isPolicyOrFinanceApplyTopic(keyword: string): boolean {
  return /지원금|계좌|대출|연금|수당|급여|보조금|청약|환급|공제|세금|보험|장려금|바우처|실업급여|내일배움|자격증|적금|예금|카드|특례|감면/i.test(
    keyword
  );
}

const DANGLING_MODIFIER_REGEX =
  /(끈끈한|불가능한|가능한|필요한|중요한|다양한|새로운|특별한|강력한|유리한|불리한|정확한|자세한|간단한|복잡한|심각한|뚜렷한|확실한|미묘한|거대한|위한|대한|따른|통한|관한|인한|없는|있는|낮추려다|높이려다|하려다|몰랐다던|했다던|밝힌|전한|나선|커진|빠진|열린|닫힌)$/;

const TRAILING_ORPHAN_TOKEN_REGEX =
  /\s+(?:\d{1,4}(?:월|일|년|시|분|차|기)|미국|중국|일본|유럽|민주당|공화당|NYT|WSJ|CNN|BBC|로이터|블룸버그)$/i;

const RHETORICAL_HOOK_CLAUSE_REGEX =
  /(나요|가요|까요|던가요|신가요|할까|일까|될까|볼까|어떨까|느껴졌|어렵게만|알고\s*계신|보셨나요)$/;

const HOOK_CLAUSE_ENDING_REGEX =
  /(?:까지|찾으세요|보세요|더니|하자|나서|열고|놀고|가고|오고|높이고|줄이고)$/;

const TRAILING_JOURNALISTIC_VERB_REGEX =
  /\s+(?:외쳐|외친|외치며|밝혀|밝힌|밝히며|전해|전한|전하며|말해|말한|호소|토로|일축|강조|촉구|주장|환호|반발|비판|열어|열고)\s*$/;

/** Shared detector/sanitizer for legacy AI cliché blog titles */
export const LEGACY_CLUMSY_TITLE_REGEX =
  /(?:왜\s*화제일까|핵심\s*배경과\s*(?:앞으로의\s*)?(?:전망|주요\s*쟁점)|무슨\s*일일까\??\s*배경부터|한눈에\s*읽는\s+.+:\s*핵심\s*쟁점과|복잡한\s*흐름\s*핵심만\s*콕|핵심\s*조건과\s*실제\s*혜택\s*(?:알기\s*쉽게\s*)?정리|내가\s*대상일까\?\s*최신\s*기준|신청\s*전\s*꼭\s*알아둘\s*점|핵심\s*내용과\s*대응\s*방법\s*정리|알기\s*쉽게\s*정리했어요|정리해\s*드릴게요)/i;

/**
 * Extracts a clean, grammatically complete Korean topic phrase from a blog title or news headline,
 * preserving natural Korean word order and preventing mid-phrase cutoffs (e.g., dangling adjectives).
 */
export function extractCleanKoreanTopicPhrase(rawTitle: string, seed?: string): string {
  const year = new Date().getFullYear();
  const stripFillerWords = (str: string) =>
    str
      .replace(
        /(?:^|\s)(총정리|완벽|가이드|필독|솔직|후기|정리|알아보기|해봤어요|할까|일까요|떴네요|하네요|네요|봤어요|나만|냈다가|진짜|요즘|드디어|꼭|알아야|어렵게만|느껴졌나요|써먹는|팁이에요|이에요|예요|확|찔끔|오르는데|내리는데|긴급회의|대책회의|민관군|개최|논의|당부|수립|관련)(?=\s|$|[?!…,.:])/g,
        ' '
      )
      .replace(/\s+/g, ' ')
      .trim();

  const rawPreCleaned = (rawTitle || '')
    .replace(/\s*새\s*창\s*열림/g, '')
    .replace(/\s+-\s+[^-]+$/, '')
    .replace(
      /\[(?:속보|단독|종합|포토|영상|인터뷰|사설|칼럼|클릭\s*e종목|핫종목|AI픽|팩플|기획|르포|현장|일문일답|브리핑|단신|게시판|인사|부고|컨콜)[^\]]*\]/gi,
      ' '
    )
    .replace(/\[([^\]]+)\]/g, '$1 ')
    .replace(
      /^(?:과기정통부|과학기술정보통신부|국가안보실|청와대|대통령실|정부|행안부|행정안전부|금융위|금융위원회|금감원|금융감독원|공정위|국토부|보건복지부|환경부|산업부|고용노동부|KISA)\s*[,·]?\s*/g,
      ''
    )
    .replace(/^\d{1,2}[.)]\s+/g, '')
    .replace(/\.{2,}/g, '…')
    .replace(/[\[\]()【】「」『』｜|"'“”‘’]/g, ' ')
    .replace(/\b202[345](년)?\b/g, `${year}`)
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize court verdict / reaction headlines (e.g. "추경호 1심 결과에 국힘 의원들 무죄 외쳐" -> "추경호 1심 무죄 선고")
  const courtVerdictMatch = rawPreCleaned.match(
    /^([가-힣a-zA-Z0-9·]{2,14})\s+(1심|2심|항소심|상고심|대법원|헌재)\s+(?:결과에?|선고에?|판결에?)?[^?!…]{0,36}?(?:^|\s)(무죄|유죄|집행유예|징역\s*\d+년|벌금형?|기각|인용)(?=\s|$|[?!…,.'"])/
  );
  if (courtVerdictMatch) {
    const [, subject, stage, verdict] = courtVerdictMatch;
    if (!/^(?:국힘|민주당|여야|야당|여당|의원들|검찰|특검)$/.test(subject)) {
      return `${subject} ${stage} ${verdict} 선고`.replace(/\s+/g, ' ').trim();
    }
  }

  const normalizeHeadlineTail = (phrase: string) =>
    phrase
      .replace(TRAILING_JOURNALISTIC_VERB_REGEX, '')
      .replace(/(결과|선고|판결|발표|소식|결정)에\s+/g, '$1 ')
      .replace(/(?<=[가-힣]{2})(와|과|에도|에서|으로|이나)$/, '')
      .replace(/^(?:년|월|일|명|원|억|조)\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const seedToks =
    seed && !BROAD_CATEGORY_LABEL_REGEX.test(seed.trim())
      ? seed.split(/\s+/).filter((w) => w.length >= 2)
      : [];

  // Split on clause punctuation (and hook comma clauses like "어린이 환자와 놀고 검사 안내까지, KT...")
  const splitTargetInput = rawPreCleaned.replace(
    /^([^,]{6,36}(?:까지|찾으세요|보세요|더니|하자|놀고|열고))\s*,\s*/,
    '$1… '
  );
  const rawClauses = splitTargetInput
    .split(/[?!…:]/)
    .map((c) => c.trim())
    .filter((c) => c.length >= 6);

  if (rawClauses.length >= 2) {
    const isRhetoricalClause = (c: string) =>
      RHETORICAL_HOOK_CLAUSE_REGEX.test(c.trim()) ||
      HOOK_CLAUSE_ENDING_REGEX.test(c.trim()) ||
      /(나요|가요|까요|던가요|신가요|느껴졌|어렵게만)/.test(c);

    let targetClauseIdx = -1;
    if (seedToks.length > 0) {
      targetClauseIdx = rawClauses.findIndex(
        (c) =>
          !isRhetoricalClause(c) &&
          seedToks.some((st) => c.toLowerCase().includes(st.toLowerCase()))
      );
      if (targetClauseIdx < 0) {
        targetClauseIdx = rawClauses.findIndex((c) => !isRhetoricalClause(c));
      }
      if (targetClauseIdx < 0) {
        targetClauseIdx = rawClauses.findIndex((c) =>
          seedToks.some((st) => c.toLowerCase().includes(st.toLowerCase()))
        );
      }
    } else {
      targetClauseIdx = rawClauses.findIndex((c) => !isRhetoricalClause(c));
    }
    if (targetClauseIdx < 0) targetClauseIdx = 0;

    const primaryClause = stripFillerWords(rawClauses[targetClauseIdx].replace(/[,·~]/g, ' '));
    const firstWords = primaryClause
      .split(/\s+/)
      .filter((w) => w.length >= 2 || /[가-힣]/.test(w));

    if (firstWords.length >= 2 && firstWords.length <= 6 && primaryClause.length >= 7) {
      if (
        firstWords.length <= 3 &&
        rawClauses[targetClauseIdx + 1] &&
        !isRhetoricalClause(rawClauses[targetClauseIdx])
      ) {
        const nextClauseClean = stripFillerWords(rawClauses[targetClauseIdx + 1].replace(/[,·~]/g, ' '));
        const secondWords = nextClauseClean
          .split(/\s+/)
          .filter(
            (w) =>
              (w.length >= 2 || /[가-힣]/.test(w)) &&
              !DANGLING_MODIFIER_REGEX.test(w) &&
              !/^(미국|중국|일본|한국|유럽|민주당|공화당|이유는|이유)$/.test(w) &&
              !firstWords.includes(w)
          );
        if (secondWords.length > 0) {
          return normalizeHeadlineTail(
            [...firstWords, ...secondWords.slice(0, 2)].slice(0, 5).join(' ')
          );
        }
      }
      return normalizeHeadlineTail(
        firstWords.slice(0, 5).join(' ').replace(TRAILING_ORPHAN_TOKEN_REGEX, '').trim()
      );
    }
  }

  const baseCleaned = stripFillerWords(rawPreCleaned);

  const words = baseCleaned
    .replace(/[,·~?!…:]/g, ' ')
    .split(/\s+/)
    .filter(
      (w) =>
        (w.length >= 2 || /[가-힣]/.test(w) || /^\d{1,3}$/.test(w)) &&
        !/^(?:[0-9]{5,}|[0-9]+,[0-9,]+)$/.test(w) &&
        !/네요$|어요$|아요$|까요$/.test(w)
    );

  if (words.length === 0) return (seed || rawTitle).trim();

  let startIdx = 0;
  if (
    seedToks.length > 0 &&
    !words.slice(0, 5).some((w) => seedToks.some((st) => w.toLowerCase().includes(st.toLowerCase())))
  ) {
    const seedWordIdx = words.findIndex((w) =>
      seedToks.some((st) => w.toLowerCase().includes(st.toLowerCase()))
    );
    if (seedWordIdx > 0) {
      startIdx = Math.max(0, Math.min(seedWordIdx - 3, Math.max(0, words.length - 6)));
    }
  }

  const windowSize = words.slice(startIdx, startIdx + 7).some((w) => w.length <= 2 || /^\d/.test(w))
    ? 7
    : 6;
  let chosen = words.slice(startIdx, startIdx + windowSize);
  const joinedLen = chosen.join(' ').length;
  if (joinedLen > 34 && chosen.length > 5) {
    chosen = chosen.slice(0, 5);
  }
  if (chosen.length >= 4 && /^\d/.test(chosen[0]) && startIdx > 0) {
    chosen = words.slice(Math.max(0, startIdx - 2), startIdx + windowSize);
  }
  const lastWord = chosen[chosen.length - 1] || '';
  if (DANGLING_MODIFIER_REGEX.test(lastWord)) {
    const nextIdx = words.indexOf(lastWord, startIdx) + 1;
    const nextWord = words[nextIdx];
    if (nextWord && !DANGLING_MODIFIER_REGEX.test(nextWord)) {
      chosen = [...chosen, nextWord];
    } else if (chosen.length >= 3) {
      chosen = chosen.slice(0, -1);
    }
  }

  let result = chosen.join(' ');
  if (chosen.length >= 4) {
    result = result
      .replace(TRAILING_ORPHAN_TOKEN_REGEX, '')
      .replace(/\s+(?:첫|새|큰|현|전|각|매|더|덜|잘|꼭)$/, '')
      .trim();
  }
  return normalizeHeadlineTail(result);
}

export function generateViralTitlesForKeyword(keyword: string, _blog?: BlogProfile): string[] {
  const clean = keyword.trim();
  const year = new Date().getFullYear();
  const yearRegex = new RegExp(`^(${year}|${year - 1}|${year + 1})(년)?\\s*`, 'i');
  const hasYearAlready = yearRegex.test(clean);
  const coreKeyword =
    clean
      .replace(yearRegex, '')
      .replace(
        /[,·:\s]+(?:핵심\s*배경과\s*(?:앞으로의\s*)?(?:주요\s*)?(?:쟁점|전망)|원인과\s*대응\s*점검\s*방법|긴급\s*패치\s*점검\s*방법|점검\s*방법|핵심\s*조건\s*및\s*신청방법|핵심\s*기능\s*정리|배경과\s*전망|총정리|완벽\s*정리|핵심\s*정리|알기\s*쉽게\s*정리했어요|정리했어요|정리해드릴게요|정리)\s*$/i,
        ''
      )
      .replace(TRAILING_JOURNALISTIC_VERB_REGEX, '')
      .replace(/^(?:년|월|일|명|원|억|조)\s+/, '')
      .trim() || clean.replace(yearRegex, '').trim();

  const intent = detectSearchIntent(coreKeyword) !== 'informational'
    ? detectSearchIntent(coreKeyword)
    : detectSearchIntent(clean);
  const prefix = hasYearAlready ? `${year}년 ` : '';
  const isLong = coreKeyword.length > 22;

  if (/취약점|보안|패치|해킹|유출|자바포셸|cve|랜섬웨어|피싱/i.test(clean)) {
    return isLong
      ? [
          `${prefix}${coreKeyword}, 내 시스템 영향 여부와 1분 점검`,
          `실무 기준 ${coreKeyword} 긴급 대응과 업데이트 절차`,
          `${coreKeyword}, 공격 원인과 버전별 보안 조치`,
          `방치하면 위험한 ${coreKeyword}, 필수 체크리스트`,
        ]
      : [
          `${prefix}${coreKeyword}, 내 서버·PC 영향 여부부터 1분 점검`,
          `실무에서 바로 쓰는 ${coreKeyword} 긴급 대응과 업데이트 절차`,
          `${coreKeyword}, 공격 원인과 버전별 필수 보안 조치`,
          `방치하면 위험한 ${coreKeyword}, 지금 확인할 체크리스트`,
        ];
  }

  if (/1심|2심|항소심|상고심|대법원|헌재|선고|무죄|유죄|판결|기소|재판/i.test(clean)) {
    return isLong
      ? [
          `${prefix}${coreKeyword}, 재판부 판단 이유와 핵심 쟁점`,
          `${coreKeyword}, 선고 의미와 남은 절차`,
          `${prefix}${coreKeyword}, 혐의별 판단과 향후 쟁점`,
          `${coreKeyword}, 정치권 반응이 엇갈린 이유`,
        ]
      : [
          `${prefix}${coreKeyword}, 재판부 판단 이유와 핵심 쟁점 3가지`,
          `${coreKeyword} 이후 여야 반응과 향후 항소 전망`,
          `한번에 읽는 ${coreKeyword}, 혐의 내용부터 선고 의미까지`,
          `${prefix}${coreKeyword}, 법정 판단이 갈린 결정적 대목`,
        ];
  }

  switch (intent) {
    case 'comparison':
      return isLong
        ? [
            `${prefix}${coreKeyword}, 직접 비교해보니 갈리는 핵심`,
            `${coreKeyword}, 내 상황에 맞는 선택 기준`,
            `${prefix}${coreKeyword}, 실제 체감 차이와 선택법`,
            `의외로 갈리는 ${coreKeyword} 장단점`,
          ]
        : [
            `${prefix}${coreKeyword}, 직접 비교해보니 갈리는 핵심 3가지`,
            `${coreKeyword} 고민 끝! 내 상황에 딱 맞는 선택 기준`,
            `${prefix}${coreKeyword}, 실제 체감 차이와 손해 안 보는 선택`,
            `비교해봤더니 의외였던 ${coreKeyword} 장단점`,
          ];
    case 'howto':
      return isLong
        ? [
            `${prefix}${coreKeyword}, 막힘없이 끝내는 실전 순서`,
            `5분 만에 끝내는 ${coreKeyword} 핵심 세팅`,
            `${coreKeyword}, 90%가 놓치는 실수 3가지`,
            `${prefix}${coreKeyword}, 두 번 손 안 가는 실전 팁`,
          ]
        : [
            `${prefix}${coreKeyword}, 막히는 부분 없이 끝내는 실전 순서`,
            `초보자도 5분이면 끝내는 ${coreKeyword} 핵심 세팅`,
            `${coreKeyword} 할 때 90%가 놓치는 실수 3가지`,
            `${prefix}${coreKeyword}, 두 번 손 안 가게 끝내는 실전 팁`,
          ];
    case 'review':
      return isLong
        ? [
            `${prefix}${coreKeyword}, 결정 전 꼭 볼 현실 단점`,
            `직접 따져본 ${coreKeyword} 체크포인트`,
            `${coreKeyword}, 몰라서 손해 보는 핵심 기준`,
            `광고 빼고 본 ${coreKeyword} 체감 장단점`,
          ]
        : [
            `${prefix}${coreKeyword}, 결정 전 꼭 알아야 할 현실적인 단점`,
            `직접 따져본 ${coreKeyword}, 후회 막는 체크포인트`,
            `${coreKeyword} 몰랐다가 손해 보기 쉬운 핵심 기준`,
            `광고 빼고 본 ${coreKeyword} 실제 체감 장단점`,
          ];
    case 'commercial':
      return isLong
        ? [
            `${prefix}${coreKeyword}, 돈 아끼는 선택 기준`,
            `광고 거른 ${coreKeyword} 가격대별 비교`,
            `${coreKeyword}, 구매 전 따질 스펙 3가지`,
            `${prefix}${coreKeyword}, 유지비 포함 현실 추천`,
          ]
        : [
            `${prefix}${coreKeyword}, 돈 아끼는 실패 제로 선택 기준`,
            `광고 거르고 고른 ${coreKeyword} 가격대별 핵심 비교`,
            `${coreKeyword} 사기 전에 꼭 따져봐야 할 스펙 3가지`,
            `${prefix}${coreKeyword}, 유지비까지 계산해본 현실 추천`,
          ];
    default:
      if (isPolicyOrFinanceApplyTopic(clean)) {
        return isLong
          ? [
              `${prefix}${coreKeyword}, 받을 수 있는 금액과 조건`,
              `모르면 못 받는 ${coreKeyword} 신청 타이밍`,
              `${coreKeyword}, 헛걸음 막는 자격·감액 기준`,
              `${prefix}${coreKeyword}, 신청 전 손익부터 따져보세요`,
            ]
          : [
              `${prefix}${coreKeyword}, 내가 받을 수 있는 금액과 숨은 조건`,
              `모르면 못 받는 ${coreKeyword}, 자격 기준과 신청 타이밍`,
              `${coreKeyword} 헛걸음 막는 핵심 자격·감액 기준`,
              `${prefix}${coreKeyword}, 신청 전 손익분기점부터 따져보세요`,
            ];
      }
      if (/환율|달러|엔화|유로화|금리|주가|코스피|나스닥|실적|물가|주담대|코스닥|채권|유가/i.test(clean)) {
        return isLong
          ? [
              `${prefix}${coreKeyword}, 당장 체감되는 변화와 대응`,
              `수치로 짚는 ${coreKeyword} 흐름과 체크 포인트`,
              `${coreKeyword}, 향후 방향을 가를 핵심 변수`,
              `손해 막고 챙기는 ${coreKeyword} 현실 기준`,
            ]
          : [
              `${prefix}${coreKeyword}, 당장 체감되는 변화와 대응 전략`,
              `수치로 짚어보는 ${coreKeyword} 흐름과 체크 포인트`,
              `${coreKeyword}, 향후 방향을 좌우할 핵심 변수 3가지`,
              `지금 주목받는 ${coreKeyword}, 손해 막는 현실 기준`,
            ];
      }
      if (/출시|공개|사전\s*판매|갤럭시|아이폰|샤오미|gta|로봇|실증|베스트\s*앱|신제품|신기능/i.test(clean)) {
        return isLong
          ? [
              `${prefix}${coreKeyword}, 스펙·일정과 눈여겨볼 변화`,
              `실사용 관점으로 본 ${coreKeyword} 강점과 한계`,
              `${coreKeyword}, 기존 세대·경쟁작과 다른 차이점`,
              `기다릴 가치 있을까? ${coreKeyword} 핵심 요약`,
            ]
          : [
              `${prefix}${coreKeyword}, 스펙·일정과 눈여겨볼 변화 3가지`,
              `실사용 관점에서 본 ${coreKeyword} 강점과 아쉬운 점`,
              `${coreKeyword}, 기존 세대·경쟁작과 다른 핵심 차이`,
              `기다릴 가치 있을까? ${coreKeyword} 한눈에 요약`,
            ];
      }
      if (/개발|코딩|프로그래밍|ai|클라우드|next|react|타입스크립트|typescript|자바|java|도커|docker|aws|llm|ollama|mcp|파이썬|python/i.test(clean)) {
        return isLong
          ? [
              `${prefix}${coreKeyword}, 실무 코드 핵심 패턴`,
              `요즘 다들 ${coreKeyword} 쓰는 진짜 이유`,
              `${coreKeyword}, 도입 전 챙길 아키텍처·보안`,
              `삽질 줄이는 ${coreKeyword} 실전 세팅`,
            ]
          : [
              `${prefix}${coreKeyword}, 실무 코드로 보는 핵심 구현 패턴`,
              `왜 요즘 다들 ${coreKeyword} 쓸까? 체감 성능과 적용법`,
              `${coreKeyword} 도입 전 꼭 챙겨야 할 아키텍처·보안 포인트`,
              `삽질 줄여주는 ${coreKeyword} 실전 세팅 노하우`,
            ];
      }
      if (/수능|시험장|재난문자|반입|체납|명단|국회|의원|정부|지자체|시청|구청/i.test(clean)) {
        return isLong
          ? [
              `${prefix}${coreKeyword}, 달라진 기준과 핵심 포인트`,
              `지금 꼭 체크할 ${coreKeyword} 주요 내용`,
              `${coreKeyword}, 실제 적용 기준과 주의사항`,
              `논란이 불거진 ${coreKeyword} 핵심 쟁점`,
            ]
          : [
              `${prefix}${coreKeyword}, 달라진 기준과 핵심 포인트 3가지`,
              `지금 꼭 체크해야 할 ${coreKeyword} 주요 내용`,
              `${coreKeyword}, 실제 적용 기준과 놓치기 쉬운 주의사항`,
              `관심이 집중된 ${coreKeyword}, 핵심 쟁점과 대응 방안`,
            ];
      }
      return isLong
        ? [
            `${prefix}${coreKeyword}, 지금 꼭 볼 핵심 쟁점`,
            `한 번에 읽는 ${coreKeyword} 주요 포인트`,
            `${coreKeyword}, 주목받는 이유와 후속 변화`,
            `체감할 수 있는 ${coreKeyword} 핵심 변화`,
          ]
        : [
            `${prefix}${coreKeyword}, 꼭 짚고 넘어가야 할 핵심 쟁점 3가지`,
            `한 번에 훑어보는 ${coreKeyword} 전후 맥락과 주요 포인트`,
            `${coreKeyword}, 지금 가장 주목받는 이유와 후속 변화`,
            `실제로 알아두면 유익한 ${coreKeyword} 핵심 포인트`,
          ];
  }
}

/**
 * 1. Live Naver Search Autocomplete Fetcher
 */
async function fetchNaverAutocomplete(seed: string): Promise<string[]> {
  try {
    const url = `https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(
      seed
    )}&con=1&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.naver.com/',
      },
      signal: AbortSignal.timeout(2200),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<Array<[string, string]>> };
    const list = data?.items?.[0] || [];
    return list
      .map((entry) => (Array.isArray(entry) ? String(entry[0] || '').trim() : ''))
      .filter(
        (kw) =>
          kw.length >= 5 &&
          kw.length <= 28 &&
          kw.split(/\s+/).length >= 2 &&
          kw.split(/\s+/).length <= 5 &&
          !NOISE_WORD_REGEX.test(kw)
      );
  } catch {
    return [];
  }
}

/**
 * 2. Live Google KR Search Autocomplete Fetcher
 */
async function fetchGoogleAutocomplete(seed: string): Promise<string[]> {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=${encodeURIComponent(
      seed
    )}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(2200),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[]];
    const list = Array.isArray(data?.[1]) ? data[1] : [];
    return list
      .map((kw) => String(kw || '').trim())
      .filter(
        (kw) =>
          kw.length >= 5 &&
          kw.length <= 28 &&
          kw.split(/\s+/).length >= 2 &&
          kw.split(/\s+/).length <= 5 &&
          !NOISE_WORD_REGEX.test(kw) &&
          !/자료를 수집|해당하는 자|관한 법률/.test(kw)
      );
  } catch {
    return [];
  }
}

/**
 * 3. Live Naver Blog SERP Subtopic & Real Reader Pain-Point Harvester
 * Scrapes actual top-ranking Korean blog posts on Naver (`ssc=tab.blog.all`) for a seed,
 * extracting high-performing long-tail subtopics and real summary reasons!
 */
function hasStaleYearOnly(text: string): boolean {
  const currentYear = new Date().getFullYear();
  const matches = text.match(/20(2[0-9])\s*년?/g);
  if (!matches || matches.length === 0) return false;
  const years = matches.map((m) => Number(m.replace(/\D/g, '')));
  if (years.some((y) => y >= currentYear)) return false;
  return years.some((y) => y >= 2020 && y < currentYear);
}

function normalizeStaleYearTokens(text: string): string {
  const currentYear = new Date().getFullYear();
  return text.replace(/20(2[0-9])(년?)/g, (match, yy: string, unit: string) => {
    const parsedYear = Number(`20${yy}`);
    return parsedYear >= 2020 && parsedYear < currentYear ? `${currentYear}${unit}` : match;
  });
}

async function fetchNaverBlogLiveSubtopics(seed: string): Promise<SubtopicDefinition[]> {
  try {
    const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&nso=so%3Ar%2Cp%3A1m&query=${encodeURIComponent(
      seed
    )}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
      signal: AbortSignal.timeout(4200),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const $ = cheerio.load(html);

    const results: SubtopicDefinition[] = [];
    const seedTokens = seed.split(/\s+/).filter((w) => w.length >= 2);
    $('.sds-comps-vertical-layout.sds-comps-full-layout, .view_wrap, .bx').each((_, el) => {
      if (results.length >= 2) return;
      const titleEl = $(el)
        .find('.sds-comps-text-type-headline1, a.title_link, .api_txt_lines.total_tit')
        .first();
      const descEl = $(el)
        .find('.sds-comps-text-type-body1, .dsc_link, .api_txt_lines.dsc_txt')
        .first();

      const rawTitle = titleEl.text().trim();
      const rawDesc = descEl.text().trim();
      if (!rawTitle || rawTitle.length < 10 || NOISE_WORD_REGEX.test(rawTitle) || /#\d+\b|공부기록|일기|서평/i.test(rawTitle)) return;
      if (hasStaleYearOnly(rawTitle) || hasStaleYearOnly(rawDesc)) return;

      const normalizedTitle = normalizeStaleYearTokens(rawTitle);
      const extractedKw = normalizeStaleYearTokens(
        extractCleanKoreanTopicPhrase(normalizedTitle, seed)
      );
      if (
        extractedKw.length < 7 ||
        extractedKw.split(/\s+/).length < 2 ||
        !seedTokens.some((st) => extractedKw.toLowerCase().includes(st.toLowerCase()))
      ) {
        return;
      }

      // Clean description to form a genuine reader interest reason
      const cleanSnippet = normalizeStaleYearTokens(
        rawDesc
          .replace(/#[가-힣a-zA-Z0-9_]+/g, '')
          .replace(/\s+/g, ' ')
          .trim()
      ).slice(0, 78);

      const reason =
        cleanSnippet.length >= 20
          ? `실시간 블로그 핵심 쟁점: "${cleanSnippet}..."`
          : `네이버 블로그 상위권에서 독자 조회수가 집중되고 있는 '${seed}' 핵심 세부 주제`;

      results.push({
        keyword: extractedKw,
        subCategory: classifySubCategory(extractedKw),
        interestReason: reason,
        searchIntent: detectSearchIntent(extractedKw),
        cpcLevel: detectCpcLevel(extractedKw),
        baseSearchVolume: 48500,
        sourceType: 'ai_expansion',
        customTitles: [
          rawTitle.length <= 54 ? rawTitle : generateViralTitlesForKeyword(extractedKw)[0],
          ...generateViralTitlesForKeyword(extractedKw).slice(0, 3),
        ],
      });
    });

    return results;
  } catch {
    return [];
  }
}

/**
 * 4. Real-time Google News KR RSS Crawler (Strictly filtered for actionable consumer/policy news)
 */
const NON_IT_DEVELOPMENT_REGEX =
  /북항재개발|재개발|재건축|도시개발|택지개발|신약개발|자원개발|광물개발|부동산개발|해양개발|지역개발|관광개발|역세권개발|복합개발|법률서비스|법무법인|로펌|변호사|분쟁|시공사|시행사|도급/i;

const NEWS_CLUSTER_STOPWORDS = new Set([
  '관련', '긴급', '발표', '공개', '오늘', '올해', '내년', '국내', '세계', '최대', '대비',
  '논의', '당부', '권고', '점검', '개최', '수립', '확인', '발견', '추진', '확대', '강화',
  '우리', '기업', '기관', '정부', '종합', '속보', '단독',
]);

function normalizeClusterToken(raw: string): string {
  let lower = raw
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, '')
    .replace(/(?:에서|으로|까지|부터|서|도|는|은|이|가|을|를|와|과|에|의)$/, (m, offset, full) =>
      full.slice(0, offset).length >= 2 ? '' : m
    );
  if (lower === 'java' || lower === '자바') return '자바';
  if (lower === '보안취약점' || lower === '취약점' || lower === '보안결함' || lower === '결함') return '취약점';
  if (lower === 'openjdk' || lower === '오픈jdk' || lower === '오픈제이디케이') return '오픈jdk';
  return lower;
}

function buildSearchableHotNewsKeyword(
  title: string,
  lede: string,
  bodyText: string,
  categoryOrSeed: string
): { cleanKeyword: string; summarySnippet: string } {
  const contextText = `${title} ${lede} ${bodyText.slice(0, 4500)}`
    .replace(/\s*새\s*창\s*열림/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Extract the first meaningful factual sentence (skipping journalist email bylines and photo captions)
  const bodySentences = bodyText
    .replace(/\s+/g, ' ')
    .split(/(?<=[.?!다])\s+/)
    .map((s) => s.trim())
    .filter(
      (s) =>
        s.length >= 22 &&
        s.length <= 160 &&
        !/[a-z0-9._%+-]+@[a-z0-9.-]+|자료사진|사진=|기자\s*=|특파원\s*=|^\(/.test(s)
    );
  const summarySnippet = (bodySentences[0] || lede || title).slice(0, 120);

  // Special enrichment for Java / OpenJDK security advisories so LTS version (e.g. 17) & CVE terms surface cleanly
  if (/자바|java/i.test(contextText) && /취약점|보안|해킹|패치|원격\s*코드\s*실행|RCE|뚫렸다/i.test(contextText)) {
    const contextNoShellName = contextText.replace(/Java4Shell|Log4Shell|Spring4Shell/gi, ' ');
    const versionMatch =
      contextNoShellName.match(/(?:Java(?:\s*SE)?|JDK|OpenJDK|자바(?:\s*SE)?)\s*(8|11|17|21|22|23|24|25)(?:\.\d|\b)/i) ||
      contextNoShellName.match(/\b(17|21|11)\.\d+\.\d+/);
    const versionStr = versionMatch ? versionMatch[1] : '';
    const hasOpenJdk = /오픈JDK|OpenJDK|오픈제이디케이/i.test(contextText);
    const aliasMatch = contextText.match(/(자바포셸|Java4Shell)/i);
    const cveMatch = contextText.match(/\b(CVE-\d{4}-\d{4,7})\b/i);
    const parts = [
      versionStr ? `Java ${versionStr}` : '자바 Java',
      hasOpenJdk ? '오픈JDK' : '',
      aliasMatch ? aliasMatch[1] : cveMatch ? cveMatch[1] : '',
      '보안 취약점 긴급 패치 점검 방법',
    ].filter(Boolean);
    return {
      cleanKeyword: parts.join(' ').replace(/\s+/g, ' ').trim(),
      summarySnippet,
    };
  }

  let baseKeyword = normalizeStaleYearTokens(
    extractCleanKoreanTopicPhrase(title, categoryOrSeed)
  );

  // Pull version / CVE / runtime tokens from lede+body, and smartphone/device model tokens ONLY from title (avoids competitor brands in lede/body)
  const contextNoShell = contextText.replace(/Java4Shell|Log4Shell|Spring4Shell/gi, ' ');
  const titleNoShell = title.replace(/Java4Shell|Log4Shell|Spring4Shell/gi, ' ');
  const hasBrandAlready = /갤럭시|아이폰|샤오미|애플|삼성|구글|픽셀|맥북/i.test(baseKeyword);
  const specificTokens =
    contextNoShell.match(
      /(?:\bCVE-\d{4}-\d{4,7}\b|\bJava\s*(?:8|11|17|21|22|23|24)\b|자바\s*(?:SE\s*)?(?:8|11|17|21)\b|오픈JDK|OpenJDK|\bPython\s*3\.\d+\b|\bNext\.js\s*\d+\b|\bReact\s*\d+\b|\bSpring\s*Boot\s*\d+\b)/i
    ) ||
    (!hasBrandAlready
      ? titleNoShell.match(/(?:\biOS\s*\d+\b|갤럭시\s*S\d+|아이폰\s*\d+|샤오미\s*\d+)/i)
      : null) ||
    [];
  if (specificTokens[0] && !baseKeyword.toLowerCase().includes(specificTokens[0].toLowerCase())) {
    const tok = specificTokens[0].trim();
    const firstWord = baseKeyword.split(/\s+/)[0] || '';
    if (firstWord && tok.toLowerCase() !== firstWord.toLowerCase()) {
      baseKeyword = `${tok} ${baseKeyword}`.trim();
    }
  }

  // Append natural search-intent phrase when short headline phrase lacks a query angle (guarding against unrelated exam/crime stories)
  const isCrimeOrExamStory = /수능|총리|시험|부정행위|적발|경찰|검거|구속|재판|유죄|수사|단속/i.test(contextText);
  if (
    baseKeyword.length < 24 &&
    !/(방법|정리|비교|전망|원인|영향|패치|점검|기능|출시|가격|혜택|예방|개선|논란|대응)$/.test(baseKeyword)
  ) {
    if (!isCrimeOrExamStory && /취약점|보안|패치|해킹|유출|오류|장애/.test(contextText)) {
      baseKeyword = `${baseKeyword} 원인과 대응 점검 방법`;
    } else if (/금리|환율|주가|수출|물가|실적|영업이익|매출/.test(contextText)) {
      baseKeyword = `${baseKeyword} 배경과 전망`;
    } else if (!isCrimeOrExamStory && /신제품|출시|기능|플랫폼|모델|버전|스마트폰|아이폰|갤럭시|맥북|AI|공개/.test(contextText)) {
      baseKeyword = `${baseKeyword} 핵심 기능 정리`;
    }
  }

  return {
    cleanKeyword: baseKeyword.replace(/\s+/g, ' ').trim(),
    summarySnippet,
  };
}

/**
 * 4. Real-time Portal Headline Cluster + Google News KR RSS Harvester
 * Harvests live Naver News Section clusters (sorted by reporter coverage volume & reader demand)
 * and reads article bodies (#dic_area) so scouted topics contain real versions, CVE IDs, and facts.
 */
async function fetchCategoryRealtimeNews(
  categoryOrSeed: string,
  isBroadCategory: boolean = false
): Promise<Array<{ title: string; cleanKeyword: string; clusterCount: number; summarySnippet?: string }>> {
  try {
    const isItDev = /개발|코딩|프로그래밍|ai|인공지능|클라우드|소프트웨어|엔지니어링|자바|java|보안|취약점/i.test(
      categoryOrSeed
    );
    const isTechGadget = /(?<!재)테크|\bit\b|디지털|가전|컴퓨터|모바일|스마트폰|노트북/i.test(
      categoryOrSeed
    );
    const isFinanceEconomy = /재테크|금융|경제|절세|지원금|연금|세금|복지|정책|부동산|전세|청약|주식/i.test(
      categoryOrSeed
    );
    const isGeneralIssue = /시사|뉴스|이슈|트렌드|상식|자유|사회/i.test(categoryOrSeed);
    const isHealthLife = /건강|운동|웰니스|다이어트|여행|맛집|라이프|육아|교육/i.test(categoryOrSeed);

    const targetSections: number[] = [];
    if (isItDev || isTechGadget) targetSections.push(105);
    if (isFinanceEconomy) targetSections.push(101);
    if (isGeneralIssue) {
      if (!targetSections.includes(101)) targetSections.push(101);
      if (!targetSections.includes(105)) targetSections.push(105);
      targetSections.push(102);
    }
    if (isHealthLife) {
      targetSections.push(103);
    }
    if (targetSections.length === 0) {
      targetSections.push(105, 101);
    }
    const uniqueSections = Array.from(new Set(targetSections)).slice(0, 3);

    const isStrictItOnly = isItDev && !isFinanceEconomy && !isGeneralIssue;
    const isStrictFinanceOnly = isFinanceEconomy && !isItDev && !isGeneralIssue;
    const isStrictHealthOnly = isHealthLife && !isGeneralIssue && !isFinanceEconomy && !isItDev;

    let broadModifiers = '(핵심 OR 정리 OR 비교 OR 가이드 OR 전망 OR 방법)';
    let broadFilterRegex = /핵심|정리|비교|가이드|전망|방법|출시|개편|업데이트|추천|이유|분석|혜택|조건|취약점|보안|패치/i;
    if (isFinanceEconomy && !isItDev) {
      broadModifiers = '(신청 OR 혜택 OR 금리 OR 환급 OR 지원금 OR 개편 OR 공제 OR 주담대 OR 연말정산)';
      broadFilterRegex = /신청|혜택|금리|환급|지원|비교|개편|조건|할인|공제|특례|연금|해킹|유출|전망|주담대|가계빚|대출|예금|청약|부동산|물가|연말정산/i;
    } else if (isItDev) {
      broadModifiers = '(Java OR 자바 OR 보안 취약점 OR 오픈JDK OR AI OR 개발자 OR 클라우드 OR 오픈소스)';
      broadFilterRegex = /AI|인공지능|개발|프로그래밍|코딩|클라우드|오픈소스|모델|에이전트|API|출시|업데이트|비교|자바|Java|취약점|보안|패치|서버|오픈JDK/i;
    } else if (isTechGadget) {
      broadModifiers = '(출시 OR 스펙 OR 후기 OR 비교 OR 추천 OR 기능 OR 보안)';
      broadFilterRegex = /출시|스펙|후기|비교|추천|기능|성능|할인|신제품|보안|취약점/i;
    } else if (isHealthLife) {
      broadModifiers = '(효능 OR 방법 OR 식단 OR 스트레칭 OR 예방 OR 루틴)';
      broadFilterRegex = /건강|의학|병원|질병|증상|예방|운동|다이어트|식단|혈당|영양제|수면|스트레칭|감기|독감|백신|비타민|노화|피부|치매|당뇨|혈압|관절/i;
    }

    const googleQuery = isBroadCategory
      ? isItDev
        ? '(Java OR 자바 OR 보안 취약점 OR 클라우드 OR AI OR 오픈소스) when:2d'
        : isStrictFinanceOnly
        ? '(금리 OR 주담대 OR 연말정산 OR 청년도약계좌 OR 국민연금 OR 파킹통장 OR 환율) when:3d'
        : isStrictHealthOnly
        ? '(건강 OR 혈당 OR 다이어트 OR 영양제 OR 독감 OR 수면 OR 스트레칭) (예방 OR 방법 OR 효능 OR 식단) when:7d'
        : `${categoryOrSeed.split(/\s+/)[0]} ${broadModifiers} when:2d`
      : `${categoryOrSeed.trim()} when:7d`;
    const googleUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
      googleQuery
    )}&hl=ko&gl=KR&ceid=KR:ko`;

    interface RawSectionCandidate {
      title: string;
      lede: string;
      href: string;
      extraHrefs: string[];
      clusterCount: number;
      isHeadline: boolean;
      effectiveScore: number;
    }

    const rawCandidates: RawSectionCandidate[] = [];
    const rejectNewsRegex = /클릭\s*e종목|특징주|목표가|목표주가|투자의견|장중\s*\d+%|상한가|부고|별세|타계|인사발령|화촉|동정/i;
    const rejectStrictItNonTechRegex = /부정행위|커닝|경찰조사|검거|구속|재판|수능|총리|사기\?/i;
    const rejectStrictFinanceB2BRegex = /어촌|항공우주|발사체|자본주의|해외영토|업무협약|개소식|기공식|착공|준공|수출\s*1조|박람회|대통령상|몽골/i;
    const rejectStrictHealthOffTopicRegex = /수능|국정원장|징역|재판|체포|탄핵|국회|지진|발사체|어촌/i;

    // Fetch Naver News Section clusters (when broad blog category) + Google News RSS in parallel
    const sectionFetches = isBroadCategory
      ? uniqueSections.map((sec) =>
          fetch(`https://news.naver.com/section/${sec}`, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
              'Accept-Language': 'ko-KR,ko;q=0.9',
            },
            signal: AbortSignal.timeout(2800),
          }).then(async (res) => (res.ok ? await res.text() : ''))
        )
      : [];

    const naverSearchUrl = !isBroadCategory
      ? `https://search.naver.com/search.naver?ssc=tab.news.all&sort=0&query=${encodeURIComponent(
          categoryOrSeed.trim()
        )}`
      : '';

    const [sectionOutcomes, googleOutcome, naverSearchOutcome] = await Promise.all([
      Promise.allSettled(sectionFetches),
      fetch(googleUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(2800),
      }).catch(() => null),
      naverSearchUrl
        ? fetch(naverSearchUrl, {
            headers: {
              'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
              'Accept-Language': 'ko-KR,ko;q=0.9',
            },
            signal: AbortSignal.timeout(2600),
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    for (const outcome of sectionOutcomes) {
      if (outcome.status !== 'fulfilled' || !outcome.value) continue;
      const $sec = cheerio.load(outcome.value);
      const tokenFreq = new Map<string, number>();
      const parsedItems: Array<{
        title: string;
        lede: string;
        href: string;
        clusterCount: number;
        isHeadline: boolean;
        tokens: string[];
      }> = [];

      $sec('.sa_item').each((_, el) => {
        const rawTitle = $sec(el)
          .find('.sa_text_strong')
          .text()
          .replace(/\s*새\s*창\s*열림/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (!rawTitle || rawTitle.length < 10) return;
        if (hasStaleYearOnly(rawTitle) || NOISE_WORD_REGEX.test(rawTitle) || rejectNewsRegex.test(rawTitle)) return;
        if (isStrictItOnly && (NON_IT_DEVELOPMENT_REGEX.test(rawTitle) || rejectStrictItNonTechRegex.test(rawTitle))) return;
        if (isStrictFinanceOnly && rejectStrictFinanceB2BRegex.test(rawTitle)) return;
        if (isStrictHealthOnly && rejectStrictHealthOffTopicRegex.test(rawTitle)) return;

        const lede = $sec(el).find('.sa_text_lede').text().replace(/\s+/g, ' ').trim();
        if (isStrictHealthOnly && !broadFilterRegex.test(`${rawTitle} ${lede}`)) return;
        const href = $sec(el).find('a.sa_text_title').attr('href') || '';
        const clusterNum = parseInt($sec(el).find('.sa_text_cluster_num').text().trim() || '1', 10);
        const clusterCount = Number.isFinite(clusterNum) && clusterNum > 0 ? clusterNum : 1;
        const isHeadline = $sec(el).hasClass('_SECTION_HEADLINE');

        const tokens = Array.from(
          new Set(
            rawTitle
              .split(/[\s,·"'“”‘’\[\]()!?…:/]+/)
              .map(normalizeClusterToken)
              .filter((t) => t.length >= 2 && !NEWS_CLUSTER_STOPWORDS.has(t) && !/^\d+$/.test(t))
          )
        );
        for (const tok of tokens) {
          tokenFreq.set(tok, (tokenFreq.get(tok) || 0) + 1);
        }
        parsedItems.push({ title: rawTitle, lede, href, clusterCount, isHeadline, tokens });
      });

      for (const item of parsedItems) {
        const maxFreq = item.tokens.reduce((mx, tok) => Math.max(mx, tokenFreq.get(tok) || 1), 1);
        const domainBonus =
          (isStrictItOnly &&
            /자바|java|오픈jdk|jdk|취약점|보안|해킹|패치|cve|ai|인공지능|개발|프로그래밍|클라우드|서버|오픈소스|api|gpt|클로드|ms|구글|엔비디아|반도체|sw|소프트웨어/i.test(
              `${item.title} ${item.lede}`
            )) ||
          (isStrictFinanceOnly &&
            /금리|대출|주담대|가계빚|예금|적금|청약|부동산|전세|월세|세금|연말정산|공제|환급|지원금|연금|보험|카드|애플페이|주식|증시|코스피|환율|물가|장바구니|김치|생활비|해킹|유출/i.test(
              `${item.title} ${item.lede}`
            ))
            ? 14
            : isStrictHealthOnly && broadFilterRegex.test(`${item.title} ${item.lede}`)
            ? 20
            : 0;
        const effectiveScore =
          item.clusterCount + Math.max(0, maxFreq - 1) * 6 + (item.isHeadline ? 8 : 0) + domainBonus;
        rawCandidates.push({
          title: item.title,
          lede: item.lede,
          href: item.href,
          extraHrefs: [],
          clusterCount: Math.max(item.clusterCount, maxFreq),
          isHeadline: item.isHeadline,
          effectiveScore,
        });
      }
    }

    if (naverSearchOutcome && naverSearchOutcome.ok) {
      const nHtml = await naverSearchOutcome.text();
      const $ns = cheerio.load(nHtml);
      $ns('a.news_tit, .sds-comps-text-type-headline1, a[data-heatmap-target=".tit"]')
        .slice(0, 8)
        .each((idx, el) => {
          const title = $ns(el).text().replace(/\s*새\s*창\s*열림/g, '').replace(/\s+/g, ' ').trim();
          if (!title || title.length < 10 || hasStaleYearOnly(title) || NOISE_WORD_REGEX.test(title)) return;
          if (isStrictItOnly && (NON_IT_DEVELOPMENT_REGEX.test(title) || rejectStrictItNonTechRegex.test(title))) return;
          const container = $ns(el).closest('.news_wrap, .news_area, div');
          const mnewsHref = container.find('a[href*="n.news.naver.com/mnews/article/"]').first().attr('href') || '';
          const lede = container.find('.news_dsc, .dsc_wrap, .sds-comps-text-type-body1').first().text().trim();
          rawCandidates.push({
            title,
            lede,
            href: mnewsHref,
            extraHrefs: [],
            clusterCount: Math.max(4, 12 - idx),
            isHeadline: idx < 3,
            effectiveScore: 18 - idx,
          });
        });
    }

    // Deduplicate overlapping stories while recording up to 2 alternate cluster URLs so version/CVE facts aren't missed
    rawCandidates.sort((a, b) => b.effectiveScore - a.effectiveScore);
    const dedupedSectionStories: RawSectionCandidate[] = [];
    for (const cand of rawCandidates) {
      const candToks = new Set(
        cand.title
          .split(/[\s,·"'“”‘’\[\]()!?…:/]+/)
          .map(normalizeClusterToken)
          .filter((t) => t.length >= 2 && !NEWS_CLUSTER_STOPWORDS.has(t))
      );
      const matchedExisting = dedupedSectionStories.find((existing) => {
        if (areTopicsSimilar(cand.title, existing.title)) return true;
        const exToks = existing.title
          .split(/[\s,·"'“”‘’\[\]()!?…:/]+/)
          .map(normalizeClusterToken)
          .filter((t) => t.length >= 2 && !NEWS_CLUSTER_STOPWORDS.has(t));
        const sharedToks = exToks.filter((t) => candToks.has(t));
        if (sharedToks.length >= 2) return true;
        // Same Java/security cluster check even if another article uses a shorter headline ("자바도 뚫렸다...")
        if (candToks.has('자바') && new Set(exToks).has('자바') && /취약|보안|결함|뚫렸다|패치/.test(cand.title) && /취약|보안|결함|뚫렸다|패치/.test(existing.title)) {
          return true;
        }
        return false;
      });
      if (matchedExisting) {
        if (cand.href && matchedExisting.href !== cand.href && !matchedExisting.extraHrefs.includes(cand.href)) {
          if (cand.isHeadline) {
            matchedExisting.extraHrefs.unshift(cand.href);
          } else if (matchedExisting.extraHrefs.length < 3) {
            matchedExisting.extraHrefs.push(cand.href);
          }
        }
        matchedExisting.lede = `${matchedExisting.lede} ${cand.lede}`.trim();
      } else {
        dedupedSectionStories.push(cand);
      }
    }

    // Fetch #dic_area article bodies (primary + up to 2 cluster alternates for top hot stories) in parallel
    const topForBody = dedupedSectionStories.slice(0, 6);
    const bodyResults = await Promise.allSettled(
      topForBody.map(async (story) => {
        const limit = story.clusterCount >= 15 ? 3 : 2;
        const urls = [story.href, ...story.extraHrefs]
          .filter((u) => Boolean(u) && /^https?:\/\/n\.news\.naver\.com\//i.test(u))
          .slice(0, limit);
        if (urls.length === 0) return '';
        const fetched = await Promise.allSettled(
          urls.map(async (u) => {
            const artRes = await fetch(u, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
              signal: AbortSignal.timeout(2200),
            });
            if (!artRes.ok) return '';
            const artHtml = await artRes.text();
            const $art = cheerio.load(artHtml);
            return $art('#dic_area, #articeBody, article').text().replace(/\s+/g, ' ').trim();
          })
        );
        return fetched
          .map((r) => (r.status === 'fulfilled' ? r.value : ''))
          .filter(Boolean)
          .join(' ');
      })
    );

    const items: Array<{ title: string; cleanKeyword: string; clusterCount: number; summarySnippet?: string }> = [];
    const seenKeywords = new Set<string>();

    topForBody.forEach((story, idx) => {
      const bodyText = bodyResults[idx].status === 'fulfilled' ? bodyResults[idx].value : '';
      const cleanTitle = story.title
        .replace(/\[(?:속보|단독|종합|포토|영상|클릭\s*e종목|핫종목|AI픽|팩플|컨콜)[^\]]*\]/gi, '')
        .replace(/[“”"‘’'…]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const { cleanKeyword, summarySnippet } = buildSearchableHotNewsKeyword(
        cleanTitle,
        story.lede,
        bodyText,
        categoryOrSeed
      );
      const dedupKey = normalizeKey(cleanKeyword);
      const isTooSimilar = items.some((ex) => areTopicsSimilar(ex.cleanKeyword, cleanKeyword));
      if (cleanKeyword.length >= 6 && !seenKeywords.has(dedupKey) && !isTooSimilar) {
        seenKeywords.add(dedupKey);
        items.push({
          title: cleanTitle,
          cleanKeyword,
          clusterCount: story.clusterCount,
          summarySnippet,
        });
      }
    });

    // Supplement with fresh Google News RSS items (when:2d / <= 14d) if still needed
    const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    if (googleOutcome && googleOutcome.ok) {
      const xml = await googleOutcome.text();
      const $ = cheerio.load(xml, { xmlMode: true });
      $('item')
        .slice(0, 14)
        .each((_, itemEl) => {
          if (items.length >= 12) return;
          const pubDateText = $(itemEl).find('pubDate').first().text().trim();
          if (pubDateText) {
            const parsedTime = Date.parse(pubDateText);
            if (!Number.isNaN(parsedTime) && nowMs - parsedTime > maxAgeMs) return;
          }
          const rawTitle = $(itemEl).find('title').first().text().trim();
          const cleanTitle = rawTitle
            .replace(/\s*새\s*창\s*열림/g, '')
            .replace(/\s+-\s+[^-]+$/, '')
            .replace(/[“”"‘’'…·!?]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (!cleanTitle || cleanTitle.length <= 10) return;
          if (hasStaleYearOnly(cleanTitle) || NOISE_WORD_REGEX.test(cleanTitle) || rejectNewsRegex.test(cleanTitle)) return;
          if (isStrictItOnly && (NON_IT_DEVELOPMENT_REGEX.test(cleanTitle) || rejectStrictItNonTechRegex.test(cleanTitle))) return;
          if (isStrictFinanceOnly && rejectStrictFinanceB2BRegex.test(cleanTitle)) return;
          if (isStrictHealthOnly && rejectStrictHealthOffTopicRegex.test(cleanTitle)) return;
          const passesFilter = isBroadCategory ? broadFilterRegex.test(cleanTitle) : true;
          if (!passesFilter) return;

          const { cleanKeyword, summarySnippet } = buildSearchableHotNewsKeyword(
            cleanTitle,
            '',
            '',
            categoryOrSeed
          );
          const alreadyCovered = items.some(
            (ex) =>
              areTopicsSimilar(cleanKeyword, ex.cleanKeyword) ||
              normalizeKey(cleanKeyword) === normalizeKey(ex.cleanKeyword) ||
              (/자바|java/i.test(cleanKeyword) && /취약|보안|결함|패치/.test(cleanKeyword) && /자바|java/i.test(ex.cleanKeyword) && /취약|보안|결함|패치/.test(ex.cleanKeyword))
          );
          if (
            !alreadyCovered &&
            cleanKeyword.length >= 6 &&
            cleanKeyword.split(/\s+/).length >= 2 &&
            !seenKeywords.has(normalizeKey(cleanKeyword))
          ) {
            seenKeywords.add(normalizeKey(cleanKeyword));
            items.push({ title: cleanTitle, cleanKeyword, clusterCount: 3, summarySnippet });
          }
        });
    }

    return items.slice(0, 16);
  } catch {
    return [];
  }
}

/**
 * 5. Real Naver Blog SERP Competition & Saturation Checker
 * Uses Naver's latest `ssc=tab.blog.all` layout + `.sds-comps-text-type-headline1`
 * to extract exact match density, stale posts, Q&A/forum weakness signals, and influencer saturation.
 */
export interface RealNaverSerpSignals {
  exactMatchesInTop10: number;
  totalResultsFetched: number;
  recentPostsInTop10: number;
  stalePostsInTop10: number;
  qaForumSignalsInTop10: number;
  influencerCountInTop10: number;
}

export async function checkRealNaverSerpSaturation(keyword: string): Promise<RealNaverSerpSignals> {
  const url = `https://search.naver.com/search.naver?ssc=tab.blog.all&sm=tab_jum&query=${encodeURIComponent(
    keyword
  )}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) {
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 450));
          continue;
        }
        break;
      }
      const html = await res.text();
      const $ = cheerio.load(html);

      const coreTokens = keyword
        .trim()
        .split(/\s+/)
        .map((t) => t.replace(/[^가-힣a-zA-Z0-9]/g, '').toLowerCase())
        .filter((t) => t.length >= 2);

      const currentYear = new Date().getFullYear();
      const seenTitles = new Set<string>();

      interface ParsedSerpCard {
        title: string;
        link: string;
        dateText: string;
        snippet: string;
        isInfluencer: boolean;
      }
      const topCards: ParsedSerpCard[] = [];

      $('.sds-comps-vertical-layout.sds-comps-full-layout, .view_wrap, .bx, .total_wrap').each(
        (_, el) => {
          if (topCards.length >= 10) return;
          const $el = $(el);
          // Skip outer Naver SDS wrapper containers that hold multiple posts
          if (
            $el.hasClass('sds-comps-vertical-layout') &&
            $el.find('.sds-comps-text-type-headline1').length > 1
          ) {
            return;
          }
          const titleEl = $el
            .find('.sds-comps-text-type-headline1, a.title_link, .api_txt_lines.total_tit, a.title_area')
            .first();
          const title = titleEl
            .text()
            .replace(/\s*새\s*창\s*열림/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          const titleLower = title.toLowerCase();
          if (!title || title.length <= 5 || seenTitles.has(titleLower)) return;
          seenTitles.add(titleLower);

          const link = (
            titleEl.attr('href') ||
            titleEl.closest('a').attr('href') ||
            $el
              .find('a[href*="blog.naver.com/"][href*="/2"], a[href*="tistory.com/"], a[href*="in.naver.com/"]')
              .first()
              .attr('href') ||
            $el.find('a[href*="blog.naver.com/"], a[href*="cafe.naver.com/"], a[href*="kin.naver.com/"]').first().attr('href') ||
            ''
          ).toLowerCase();

          const dateText = $el
            .find('.sds-comps-profile-info-subtext, .sub, .sub_time, .txt_inline')
            .first()
            .text()
            .trim();
          const snippet = $el
            .find('.sds-comps-text-type-body1, .dsc_link, .api_txt_lines.dsc_txt, .dsc_area')
            .first()
            .text()
            .trim();
          const cardText = $el.text();
          const isInfluencer =
            /in\.naver\.com|influencer\.naver\.com/.test(link) ||
            $el.find('[class*="influencer"], [href*="in.naver.com"]').length > 0 ||
            /인플루언서/.test(cardText);

          topCards.push({
            title: titleLower,
            link,
            dateText,
            snippet,
            isInfluencer,
          });
        }
      );

      if (topCards.length === 0 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 450));
        continue;
      }

      let exactMatches = 0;
      let recentCount = 0;
      let staleCount = 0;
      let qaForumSignals = 0;
      let influencerCount = 0;

      const minRequiredTokens =
        coreTokens.length <= 1 ? 1 : Math.max(2, Math.ceil(coreTokens.length * 0.7));

      for (const card of topCards) {
        const matchedTokens = coreTokens.filter((tok) => card.title.includes(tok));
        if (coreTokens.length > 0 && matchedTokens.length >= minRequiredTokens) {
          exactMatches++;
        }

        if (/분 전|시간 전|[1-6]일 전|어제/i.test(card.dateText)) {
          recentCount++;
        }

        // Detect stale posts (>3 months old or from a prior calendar year)
        let isStale = /년 전|([3-9]|1[0-1])개월 전/.test(card.dateText);
        const dateYearMatch = card.dateText.match(/\b(20\d{2})\.\s*\d{1,2}\./);
        if (dateYearMatch && Number(dateYearMatch[1]) < currentYear) {
          isStale = true;
        }
        const titleYearMatch = card.title.match(/\b(20\d{2})\s*년?/);
        if (titleYearMatch && Number(titleYearMatch[1]) >= 2018 && Number(titleYearMatch[1]) < currentYear) {
          isStale = true;
        }
        if (isStale) {
          staleCount++;
        }

        const isWeakQa =
          /cafe\.naver\.com|kin\.naver\.com|post\.naver\.com/.test(card.link) ||
          card.snippet.length < 45 ||
          /\?$|알려주세요|궁금합니다|질문|문의|어떻게\s*하나요/.test(card.title);
        if (isWeakQa) {
          qaForumSignals++;
        }

        if (card.isInfluencer) {
          influencerCount++;
        }
      }

      return {
        exactMatchesInTop10: exactMatches,
        totalResultsFetched: topCards.length,
        recentPostsInTop10: Math.min(10, recentCount),
        stalePostsInTop10: Math.min(10, staleCount),
        qaForumSignalsInTop10: Math.min(10, qaForumSignals),
        influencerCountInTop10: Math.min(10, influencerCount),
      };
    } catch {
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 450));
      }
    }
  }

  return {
    exactMatchesInTop10: 3,
    totalResultsFetched: 0,
    recentPostsInTop10: 2,
    stalePostsInTop10: 2,
    qaForumSignalsInTop10: 1,
    influencerCountInTop10: 1,
  };
}

/**
 * Calculates golden metrics combining real Naver SERP saturation, staleness, influencer density, and long-tail specificity
 */
function computeMetricsWithRealSerp(
  subtopic: SubtopicDefinition,
  serp?: RealNaverSerpSignals
): {
  estimatedMonthlySearch: number;
  competitionRatio: number;
  goldenScore: number;
  cpcLevel: TrendTopic['cpcLevel'];
  searchIntent: TrendTopic['searchIntent'];
  serpBadge: string;
  serpAnalysis?: TrendTopic['serpAnalysis'];
} {
  const words = subtopic.keyword.trim().split(/\s+/).filter(Boolean).length;

  // Estimate realistic monthly search demand from observable signals (no synthetic char-code hash)
  let estimatedMonthlySearch = 3200;
  const recentBoost = serp && serp.totalResultsFetched > 0 ? serp.recentPostsInTop10 * 320 : 0;
  const exactDemandSignal = serp && serp.totalResultsFetched > 0 ? serp.exactMatchesInTop10 * 260 : 0;

  if (subtopic.sourceType === 'realtime_news') {
    const cluster = subtopic.clusterCount ?? Math.max(2, Math.round((subtopic.baseSearchVolume - 54000) / 750));
    estimatedMonthlySearch = Math.min(65000, Math.max(15000, 14500 + cluster * 1550));
  } else if (
    subtopic.sourceType === 'naver_autocomplete' ||
    subtopic.sourceType === 'google_autocomplete'
  ) {
    const rank = subtopic.autocompleteRank ?? 2;
    const rankWeight = Math.max(0.45, 1 - rank * 0.11);
    const tierBase = words <= 2 ? 14200 : words === 3 ? 7400 : 3200;
    estimatedMonthlySearch = Math.round(tierBase * rankWeight + recentBoost + exactDemandSignal * 0.5);
    estimatedMonthlySearch = Math.min(18000, Math.max(1200, estimatedMonthlySearch));
  } else {
    const tierBase = words <= 2 ? 11200 : words === 3 ? 5200 : 2500;
    estimatedMonthlySearch = Math.round(tierBase + recentBoost + exactDemandSignal * 0.6);
    estimatedMonthlySearch = Math.min(15000, Math.max(1200, estimatedMonthlySearch));
  }

  let competitionRatio: number;
  let goldenScore: number;
  let serpBadge = '';
  let serpAnalysis: TrendTopic['serpAnalysis'] | undefined;

  if (serp && serp.totalResultsFetched > 0) {
    const exact = serp.exactMatchesInTop10;
    const stale = serp.stalePostsInTop10;
    const qa = serp.qaForumSignalsInTop10;
    const inf = serp.influencerCountInTop10;

    const rawRatio =
      0.08 +
      exact * 0.075 +
      inf * 0.065 -
      stale * 0.03 -
      qa * 0.025 +
      (words <= 2 ? 0.18 : words >= 4 ? -0.04 : 0);
    competitionRatio = Number(Math.max(0.06, Math.min(0.95, rawRatio)).toFixed(2));

    let opportunityLabel = '중간 경쟁';
    if (exact <= 2 && inf <= 1 && (stale >= 2 || qa >= 1 || words >= 3)) {
      opportunityLabel = '빈집 공략 최상';
    } else if (exact <= 3 && inf <= 2) {
      opportunityLabel = '블루오션 빈집';
    } else if (exact <= 5 && inf <= 3) {
      opportunityLabel = '진입 유리';
    } else if (inf >= 4 || exact >= 7) {
      opportunityLabel = '경쟁 치열(레드오션)';
    }

    const exactScore =
      exact <= 1 ? 22 : exact <= 2 ? 19 : exact <= 4 ? 14 : exact <= 6 ? 7 : 1;
    const opportunityBonus = Math.min(12, stale * 3 + qa * 2);
    const influencerAdj = inf === 0 ? 8 : inf === 1 ? 5 : inf === 2 ? 2 : -(inf - 2) * 5;
    const longTailBonus = words >= 3 && words <= 6 ? 8 : words <= 2 ? -7 : 3;
    const intentBonus =
      subtopic.searchIntent === 'howto' ||
      subtopic.searchIntent === 'comparison' ||
      subtopic.searchIntent === 'review'
        ? 5
        : 2;
    const cpcBonus = subtopic.cpcLevel === 'ultra' ? 4 : subtopic.cpcLevel === 'high' ? 3 : 1;
    const newsBonus = subtopic.sourceType === 'realtime_news' ? 4 : 0;

    const rawGolden =
      46 +
      exactScore +
      opportunityBonus +
      influencerAdj +
      longTailBonus +
      intentBonus +
      cpcBonus +
      newsBonus;
    goldenScore = Math.min(99, Math.max(42, Math.round(rawGolden)));

    serpBadge = ` [상위10 정확일치 ${exact}건 · 오래된글 ${stale}건${
      inf > 0 ? ` · 인플루언서 ${inf}건` : ''
    } · ${opportunityLabel}]`;
    serpAnalysis = {
      exactMatchesInTop10: exact,
      stalePostsInTop10: stale,
      qaForumSignalsInTop10: qa,
      influencerCountInTop10: inf,
      opportunityLabel,
    };
  } else {
    const baseRatio = words >= 4 ? 0.16 : words === 3 ? 0.24 : 0.42;
    competitionRatio = Number(baseRatio.toFixed(2));
    const longTailBonus = words >= 3 && words <= 6 ? 10 : words <= 2 ? -8 : 4;
    const cpcBonus = subtopic.cpcLevel === 'ultra' ? 5 : subtopic.cpcLevel === 'high' ? 3 : 1;
    goldenScore = Math.min(92, Math.max(55, 74 + longTailBonus + cpcBonus));
  }

  return {
    estimatedMonthlySearch,
    competitionRatio,
    goldenScore,
    cpcLevel: subtopic.cpcLevel,
    searchIntent: subtopic.searchIntent,
    serpBadge,
    serpAnalysis,
  };
}

export async function createManualTrendTopic(
  keyword: string,
  blog?: BlogProfile
): Promise<TrendTopic> {
  const clean = keyword.trim();
  const intent = detectSearchIntent(clean);
  const serp = await checkRealNaverSerpSaturation(clean);
  const def: SubtopicDefinition = {
    keyword: clean,
    subCategory: classifySubCategory(clean),
    interestReason: '사용자가 직접 관심 주제로 지정하여 실시간 네이버 SERP 경쟁도를 분석한 타겟 키워드',
    searchIntent: intent,
    cpcLevel: detectCpcLevel(clean),
    baseSearchVolume: 4000,
    sourceType: 'ai_expansion',
  };
  const metrics = computeMetricsWithRealSerp(def, serp);

  return {
    id: `trend-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    keyword: clean,
    parentSeedKeyword: clean,
    source: 'ai_expansion',
    subCategory: def.subCategory,
    interestReason: `${def.interestReason}${metrics.serpBadge}`,
    estimatedMonthlySearch: metrics.estimatedMonthlySearch,
    competitionRatio: metrics.competitionRatio,
    goldenScore: metrics.goldenScore,
    cpcLevel: metrics.cpcLevel,
    searchIntent: metrics.searchIntent,
    serpAnalysis: metrics.serpAnalysis,
    suggestedTitles: generateViralTitlesForKeyword(clean, blog),
    recommendedBlogId: blog?.id,
    discoveredAt: new Date().toISOString(),
    isManual: true,
  };
}

/**
 * Upgraded Real-Time Portal & SERP Long-Tail Gap Miner:
 * 1. Expands broad categories / short <=2-word seeds using domain pain-point suffixes & 2nd-stage autocomplete.
 * 2. Harvests in parallel:
 *    - Live Naver Blog Top SERP Subtopics & Snippets (`fetchNaverBlogLiveSubtopics`)
 *    - Live Naver Search Autocomplete (`fetchNaverAutocomplete`, including 2nd-stage pain-point expansions)
 *    - Live Google KR Suggest (`fetchGoogleAutocomplete`)
 *    - Live Google News KR RSS & Naver News Clusters (`fetchCategoryRealtimeNews`)
 * 3. Strictly deduplicates against `excludeKeywords` and deprioritizes broad <=2-word head terms.
 * 4. Verifies real Naver Blog Top-10 SERP saturation (`checkRealNaverSerpSaturation`) for exact matches,
 *    stale posts, Q&A weakness signals, and influencer saturation.
 */
export async function scoutGoldenKeywords(params: {
  seedKeyword?: string;
  blog?: BlogProfile;
  includeRealtimeTrends?: boolean;
  excludeKeywords?: string[];
  aiProviders?: WebAISessionInfo[];
}): Promise<TrendTopic[]> {
  const {
    seedKeyword,
    blog,
    includeRealtimeTrends = true,
    excludeKeywords = [],
  } = params;

  const acceptedKeywordsList: string[] = [...excludeKeywords.filter(Boolean)];

  // Collect user's broad category seeds
  const rawCategoryInputs: string[] = [];
  if (seedKeyword && seedKeyword.trim()) {
    rawCategoryInputs.push(seedKeyword.trim());
  } else if (blog && blog.nicheKeywords.length > 0) {
    rawCategoryInputs.push(...blog.nicheKeywords);
  } else {
    rawCategoryInputs.push('재테크', 'IT·가전', '건강·웰니스');
  }

  const primaryCategory = rawCategoryInputs[0] || '경제·재테크';

  // Match against broad category clusters
  const matchedClusters = BROAD_CATEGORY_SEED_CLUSTERS.filter((entry) =>
    rawCategoryInputs.some((input) => entry.pattern.test(input))
  );

  // Select live sub-seeds to query against Naver Blog SERP, Naver AC & Google AC
  let activeQuerySeeds: string[] = [];
  const hasExplicitSeed = Boolean(seedKeyword && seedKeyword.trim());
  const isBroadClusterMatch = hasExplicitSeed
    ? matchedClusters.length > 0 && BROAD_CATEGORY_LABEL_REGEX.test(seedKeyword!.trim())
    : matchedClusters.length > 0;

  const cleanUserSeed = primaryCategory.replace(/[,·]/g, ' ').trim();
  const isTechOrDevSeed = /개발|코딩|프로그래밍|ai|클라우드|서버|자바|java|파이썬|python|리액트|next|도커|노트북|가전|아이폰|갤럭시|it/i.test(
    cleanUserSeed
  );
  const painPointModifiers = isTechOrDevSeed
    ? ['오류', '해결', '비교', '차이', '단점', '세팅']
    : isPolicyOrFinanceApplyTopic(cleanUserSeed)
    ? ['조건', '거절', '서류', '계산', '단점', '비교']
    : ['단점', '비교', '차이', '오류', '해결', '조건'];

  if (isBroadClusterMatch) {
    const allLiveSeeds = matchedClusters.flatMap((c) => c.liveSeeds);
    const freshSeeds = allLiveSeeds.filter(
      (s) => !excludeKeywords.some((ex) => normalizeKey(ex).includes(normalizeKey(s)))
    );
    const pool = freshSeeds.length >= 6 ? freshSeeds : allLiveSeeds;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    const baseSeeds = shuffled.slice(0, 4);
    // Add 2 pain-point expanded sub-seeds so autocomplete mines deeper 3~5 word long-tails
    const painExpanded = baseSeeds.slice(0, 2).map((s, idx) => {
      const words = s.split(/\s+/).length;
      return words <= 2 ? `${s} ${painPointModifiers[idx % painPointModifiers.length]}` : s;
    });
    activeQuerySeeds = Array.from(new Set([...baseSeeds, ...painExpanded])).slice(0, 6);
  } else {
    const [directNaverAc, directGoogleAc] = await Promise.all([
      fetchNaverAutocomplete(cleanUserSeed),
      fetchGoogleAutocomplete(cleanUserSeed),
    ]);
    const rawUserWords = cleanUserSeed.split(/\s+/).filter(Boolean).length;
    const painSeeds =
      rawUserWords <= 2
        ? painPointModifiers.slice(0, 4).map((m) => `${cleanUserSeed} ${m}`.trim())
        : [];
    const discoveredRealQueries = Array.from(
      new Set([
        ...directNaverAc.filter((q) => q.split(/\s+/).length >= 3).slice(0, 3),
        ...directGoogleAc.filter((q) => q.split(/\s+/).length >= 3).slice(0, 2),
        ...painSeeds,
        ...directNaverAc.slice(0, 3),
        cleanUserSeed,
      ])
    );
    activeQuerySeeds = discoveredRealQueries.slice(0, 6);
  }

  // Step 1: Harvest Real-Time Signals in parallel (Naver Blog SERP on top 2 seeds + Naver AC + Google AC + News RSS)
  const [blogSerpSubtopicsNested, naverLists, googleLists, newsItems] = await Promise.all([
    Promise.all(activeQuerySeeds.slice(0, 2).map((s) => fetchNaverBlogLiveSubtopics(s))),
    Promise.all(activeQuerySeeds.map((s) => fetchNaverAutocomplete(s))),
    Promise.all(activeQuerySeeds.slice(0, 4).map((s) => fetchGoogleAutocomplete(s))),
    includeRealtimeTrends
      ? fetchCategoryRealtimeNews(
          hasExplicitSeed ? primaryCategory : rawCategoryInputs.join(' '),
          isBroadClusterMatch
        )
      : Promise.resolve([]),
  ]);

  const liveBlogSerpSubtopics = blogSerpSubtopicsNested.flat();

  // 2nd-stage long-tail expansion: if autocomplete returned 2-word queries, expand up to 3 of them with pain-point suffixes
  const twoWordAutoCandidates = Array.from(
    new Set(
      naverLists
        .flat()
        .concat(googleLists.flat())
        .filter((q) => q.split(/\s+/).length === 2)
    )
  ).slice(0, 3);

  const stage2AutoLists =
    twoWordAutoCandidates.length > 0
      ? await Promise.all(
          twoWordAutoCandidates.map((q, idx) =>
            fetchNaverAutocomplete(`${q} ${painPointModifiers[idx % painPointModifiers.length]}`)
          )
        )
      : [];

  const liveAutocompletePool: Array<{
    query: string;
    parentSeed: string;
    origin: 'naver' | 'google';
    rank: number;
  }> = [];

  activeQuerySeeds.forEach((seed, idx) => {
    (naverLists[idx] || []).forEach((q, qIdx) => {
      liveAutocompletePool.push({ query: q, parentSeed: seed, origin: 'naver', rank: qIdx });
    });
    (googleLists[idx] || []).forEach((q, qIdx) => {
      liveAutocompletePool.push({ query: q, parentSeed: seed, origin: 'google', rank: qIdx });
    });
  });

  twoWordAutoCandidates.forEach((seed, idx) => {
    (stage2AutoLists[idx] || []).forEach((q, qIdx) => {
      liveAutocompletePool.push({ query: q, parentSeed: seed, origin: 'naver', rank: qIdx });
    });
  });

  // Sort autocomplete queries to strongly prefer 3~5 word specific long-tail queries
  liveAutocompletePool.sort((a, b) => {
    const wordsA = a.query.split(/\s+/).length;
    const wordsB = b.query.split(/\s+/).length;
    const scoreA = wordsA >= 3 && wordsA <= 5 ? 10 : wordsA >= 6 ? 7 : 1;
    const scoreB = wordsB >= 3 && wordsB <= 5 ? 10 : wordsB >= 6 ? 7 : 1;
    if (scoreB !== scoreA) return scoreB - scoreA;
    return a.rank - b.rank;
  });

  // Step 2: Build candidate SubtopicDefinitions from News & Autocomplete
  const newsSubtopics: SubtopicDefinition[] = [];
  for (const news of newsItems.slice(0, 6)) {
    const clusterBadge =
      news.clusterCount >= 5 ? `[네이버 실시간 클러스터 ${news.clusterCount}건 집중 보도] ` : '';
    const snippetNote = news.summarySnippet ? ` · ${news.summarySnippet}` : '';
    newsSubtopics.push({
      keyword: news.cleanKeyword,
      subCategory: '실시간 핫이슈',
      interestReason: `${clusterBadge}[${news.title.slice(0, 48)}] 실시간 검색 관심 급상승${snippetNote}`,
      searchIntent: detectSearchIntent(news.cleanKeyword),
      cpcLevel: detectCpcLevel(news.cleanKeyword),
      baseSearchVolume: Math.min(98000, 54000 + (news.clusterCount || 1) * 750),
      clusterCount: news.clusterCount || 1,
      sourceType: 'realtime_news',
      customTitles: generateViralTitlesForKeyword(news.cleanKeyword, blog),
    });
  }

  const portalAutoSubtopics: SubtopicDefinition[] = [];
  const perSeedAutoCount = new Map<string, number>();
  const hasRichLongTailPool =
    liveAutocompletePool.filter((item) => item.query.split(/\s+/).length >= 3).length >= 5;

  for (const autoItem of liveAutocompletePool) {
    const q = normalizeStaleYearTokens(autoItem.query).trim();
    const words = q.split(/\s+/).length;
    if (words < 2) continue;
    // Skip broad <=2 word red-ocean queries when 3+ word specific long-tails are already abundant
    if (words === 2 && hasRichLongTailPool) continue;

    const currentCount = perSeedAutoCount.get(autoItem.parentSeed) || 0;
    if (currentCount >= (isBroadClusterMatch ? 2 : 3)) continue;
    perSeedAutoCount.set(autoItem.parentSeed, currentCount + 1);

    let enrichedKw = q;
    if (words === 2) {
      if (isPolicyOrFinanceApplyTopic(q) && !/조건|비교|방법|신청|후기|단점|금리|환급|기준|계산/i.test(q)) {
        enrichedKw = `${q} 신청 거절 사유 및 조건 비교`;
      } else if (!/조건|단점|오류|비교|거절|서류|계산|차이|해결/i.test(q)) {
        enrichedKw = `${q} 현실 단점 및 선택 비교`;
      }
    }

    const portalLabel = autoItem.origin === 'naver' ? '네이버' : '구글';
    portalAutoSubtopics.push({
      keyword: enrichedKw,
      subCategory: classifySubCategory(enrichedKw),
      interestReason: `${portalLabel} 롱테일 자동완성 파생 검색어 ('${autoItem.parentSeed}' 세부 질문 공략)`,
      searchIntent: detectSearchIntent(enrichedKw),
      cpcLevel: detectCpcLevel(enrichedKw),
      baseSearchVolume: words >= 3 ? 5200 : 11000,
      autocompleteRank: autoItem.rank,
      sourceType: autoItem.origin === 'naver' ? 'naver_autocomplete' : 'google_autocomplete',
    });
  }

  const curatedPool: SubtopicDefinition[] = isBroadClusterMatch
    ? matchedClusters.flatMap((c) => c.curatedFallbacks)
    : (isPolicyOrFinanceApplyTopic(cleanUserSeed)
        ? [
            `${cleanUserSeed} 조건 미달 거절 사유 및 예외 기준`,
            `${cleanUserSeed} 실수령 금액 계산 및 중도해지 손실 비교`,
            `${cleanUserSeed} 필수 서류 체크리스트 및 오류 해결`,
          ]
        : [
            `${cleanUserSeed} 실제 사용 단점과 자주 겪는 오류 해결`,
            `${cleanUserSeed} 대안 비교 차이점 및 선택 기준`,
            `${cleanUserSeed} 적용 조건 계산 및 실전 체크리스트`,
          ]
      ).map((kw) => ({
        keyword: kw,
        subCategory: classifySubCategory(kw),
        interestReason: `'${cleanUserSeed}' 세부 문제해결형 롱테일 공략 주제`,
        searchIntent: detectSearchIntent(kw),
        cpcLevel: detectCpcLevel(kw),
        baseSearchVolume: 3600,
        sourceType: 'ai_expansion',
      }));

  // Prioritize real long-tail autocomplete & live blog SERP subtopics alongside breaking news
  const combinedStream: SubtopicDefinition[] = [
    ...portalAutoSubtopics.slice(0, 8),
    ...liveBlogSerpSubtopics.slice(0, 4),
    ...newsSubtopics.slice(0, 4),
    ...portalAutoSubtopics.slice(8),
    ...liveBlogSerpSubtopics.slice(4),
    ...curatedPool,
  ];

  const candidateDefinitions: SubtopicDefinition[] = [];
  for (const def of combinedStream) {
    if (!def.keyword || NOISE_WORD_REGEX.test(def.keyword)) continue;
    if (isNearDuplicateKeyword(def.keyword, acceptedKeywordsList)) continue;
    acceptedKeywordsList.push(def.keyword);
    candidateDefinitions.push(def);
    if (candidateDefinitions.length >= 10) break;
  }

  // Step 3: Verify Real Naver Blog Top-10 SERP Saturation in polite batches of 2 with 260ms spacing to avoid Naver rate-limiting
  const serpResults: RealNaverSerpSignals[] = [];
  const batchSize = 2;
  for (let i = 0; i < candidateDefinitions.length; i += batchSize) {
    const slice = candidateDefinitions.slice(i, i + batchSize);
    const batchRes = await Promise.all(
      slice.map((def) => checkRealNaverSerpSaturation(def.keyword))
    );
    serpResults.push(...batchRes);
    if (i + batchSize < candidateDefinitions.length) {
      await new Promise((r) => setTimeout(r, 260));
    }
  }

  // Step 4: Assemble final TrendTopic items with real SERP competition & opportunity metrics
  const results: TrendTopic[] = candidateDefinitions.map((def, idx) => {
    const serp = serpResults[idx];
    const metrics = computeMetricsWithRealSerp(def, serp);

    return {
      id: `trend-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      keyword: def.keyword,
      parentSeedKeyword: primaryCategory,
      source: def.sourceType || 'ai_expansion',
      subCategory: def.subCategory,
      interestReason: `${def.interestReason}${metrics.serpBadge}`,
      estimatedMonthlySearch: metrics.estimatedMonthlySearch,
      competitionRatio: metrics.competitionRatio,
      goldenScore: metrics.goldenScore,
      cpcLevel: metrics.cpcLevel,
      searchIntent: metrics.searchIntent,
      serpAnalysis: metrics.serpAnalysis,
      suggestedTitles:
        def.customTitles && def.customTitles.length >= 2
          ? def.customTitles
          : generateViralTitlesForKeyword(def.keyword, blog),
      recommendedBlogId: blog?.id,
      discoveredAt: new Date().toISOString(),
    };
  });

  return results.sort((a, b) => b.goldenScore - a.goldenScore).slice(0, 12);
}

const TAG_PREDICATE_ENDING_REGEX =
  /(나요|가요|까요|네요|어요|아요|해요|죠|군요|는데|지만|더니|니까|면서|려고|도록|게만|던데|는지|건지|할까|일까|될까|볼까|봤다|했다|된다|한다|이다|있다|없다|같다|싶다|높은|낮은|좋은|나쁜|쉬운|어려운|많은|적은|빠른|느린|새로운|다양한|중요한|필요한|확실한|간단한|복잡한|특별한|유리한|불리한|클까|작을까|어렵게|쉽게|빠르게|간단히|자세히|꼼꼼히|확실히|솔직히|완전히|써먹는|헷갈리는|놓치기|알아보는|비교하는|정리한|살펴본|따져본|마치며|오르고|내리고|무섭게|체감하는|이에요|예요)$/;

const TAG_FILLER_REGEX =
  /^(어렵게만|느껴졌나요|오르는데|내리는데|찔끔|높은곳|낮은곳|좋은곳|나쁜곳|확|딱|꼭|잘|더|덜|왜|어떻게|언제|어디|무엇|누구|얼마나|과연|진짜|정말|너무|매우|아주|가장|제일|직접|실제로|요즘|최근|드디어|결국|갑자기|바짝|슬쩍|그냥|일단|먼저|바로|혹시|만약|핵심|총정리|정리|완벽|가이드|필독|솔직|후기|리뷰|비교|분석|전망|이유|방법|조건|기준|혜택|신청|절차|순서|주의사항|체크리스트|포인트|차이|차이점|장단점|추천|순위|종류|팁|꿀팁|노하우|배경|원인|쟁점|흐름|영향|반응|요약|해결|대비|확인|조회|계산|선택|활용|기본|실전|실무|중심|관련|내용|부분|정도|경우|가지|단계|체크|비교표|알기|쉽게|한눈에|처음이어도|대해서|위해서|통해서|주요|실사용|실수령|진행|단계별|사전|준비물|가성비|체감|만족도|배경과|쟁점과|혜택과|영향과|원인과|시장|대하는|건강한|포지션|분위기|불만)$/;

const BOILERPLATE_SUBKEYWORD_REGEX =
  /^(핵심 배경과 원인|주요 쟁점과 흐름|실제 영향과 시장 반응|향후 전망 및 핵심 요약|실수령 혜택과 조건|가장 중요한 핵심 기준|신청 및 관리 요령|주의해야 할 점|핵심 차이점 비교|실사용 장단점|가격 및 가성비 기준|추천 대상 정리|사전 준비물과 자격|단계별 진행 순서|자주 겪는 오류 해결|놓치기 쉬운 꿀팁|솔직한 실사용 후기|실제 체감 장단점|구매 전 체크포인트|최종 만족도 평가)$/;

const SINGLE_CHAR_PARTICLE_EXCEPTIONS = /^(가을|마을|노을|고을|사은|보은)$/;
const TRAILING_UI_EXCEPTIONS =
  /^(강의|회의|주의|정의|동의|문의|편의|합의|협의|결의|심의|건의|의의|예의|창의|열의|성의|전문의|주치의|수의|한의|모의|토의|항의|논의)$/;

export function normalizeKoreanTagToken(raw: string): string {
  let tok = (raw || '')
    .replace(/[#]/g, '')
    .replace(/[,·~?!…:"'“”‘’\[\]()【】「」『』/|]/g, '')
    .replace(/\s+/g, '')
    .trim();

  if (tok.length < 2 || tok.length > 10 || /^[0-9]+$/.test(tok)) return '';
  if (TAG_PREDICATE_ENDING_REGEX.test(tok) || TAG_FILLER_REGEX.test(tok)) return '';

  tok = tok.replace(
    /(에서는|에게는|으로는|이라도|이나마|이지만|까지도|부터는|만으로|이라는|라는|에서|에게|으로|부터|까지|보다|처럼|만큼|조차|마저|이나|이란|에는|에도)$/,
    (match, _group, offset, full) => (full.slice(0, offset).length >= 2 ? '' : match)
  );

  if (!SINGLE_CHAR_PARTICLE_EXCEPTIONS.test(tok)) {
    tok = tok.replace(/(은|는|을|를)$/, (match, _group, offset, full) =>
      full.slice(0, offset).length >= 2 ? '' : match
    );
  }

  if (!TRAILING_UI_EXCEPTIONS.test(tok)) {
    tok = tok.replace(/의$/, (match, offset, full) =>
      full.slice(0, offset).length >= 2 ? '' : match
    );
  }

  if (tok.length < 2 || tok.length > 10 || /^[0-9]+$/.test(tok)) return '';
  if (TAG_PREDICATE_ENDING_REGEX.test(tok) || TAG_FILLER_REGEX.test(tok)) return '';

  return tok;
}

export function buildRelevantPostTags(params: {
  keyword: string;
  subKeywords?: string[];
  blog?: BlogProfile;
  aiTags?: string[];
  markdownContent?: string;
}): string[] {
  const { keyword, subKeywords = [], blog, aiTags = [], markdownContent } = params;
  const result: string[] = [];
  const seenLower = new Set<string>();

  const pushTag = (raw: string) => {
    const normalized = normalizeKoreanTagToken(raw);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seenLower.has(key)) return;
    seenLower.add(key);
    result.push(normalized);
  };

  // 1. Validated AI-extracted search tags first
  for (const t of aiTags) {
    pushTag(t);
  }

  // 2. Core nouns extracted from target keyword
  const keywordWords = (keyword || '')
    .split(/[,·~?!…:\s/]+/)
    .map((w) => normalizeKoreanTagToken(w))
    .filter(Boolean);

  for (const w of keywordWords) {
    pushTag(w);
  }

  // 3. Clean nouns from non-boilerplate subKeywords
  for (const sub of subKeywords) {
    const subTrimmed = (sub || '').trim();
    if (!subTrimmed) continue;
    if (BOILERPLATE_SUBKEYWORD_REGEX.test(subTrimmed)) continue;
    if (/(자격조건|신청절차|핵심혜택|주의사항|핵심배경|주요쟁점|실제영향|향후전망)$/.test(subTrimmed)) {
      continue;
    }
    for (const part of subTrimmed.split(/[,·~?!…:\s/]+/)) {
      pushTag(part);
    }
  }

  // 4. Blog niche topic nouns
  if (blog && Array.isArray(blog.nicheKeywords)) {
    for (const niche of blog.nicheKeywords) {
      for (const part of (niche || '').split(/[,·/\s]+/)) {
        pushTag(part);
      }
    }
  }

  // 5. Optional concise 2-noun compound from target keyword if still < 5 tags
  if (result.length < 5 && keywordWords.length >= 2) {
    const compound = `${keywordWords[0]}${keywordWords[1]}`;
    if (compound.length <= 9) {
      pushTag(compound);
    }
  }

  // 6. Supplement from H2 markdown headings if still < 5 tags
  if (result.length < 5 && markdownContent) {
    const headingMatches = markdownContent.match(/^##\s+([^\n]+)/gm) || [];
    for (const line of headingMatches) {
      const cleanHeading = line
        .replace(/^##\s+/, '')
        .replace(/[*_`[\]()]/g, ' ');
      for (const part of cleanHeading.split(/[,·~?!…:\s/]+/)) {
        if (result.length >= 6) break;
        pushTag(part);
      }
      if (result.length >= 6) break;
    }
  }

  return result.slice(0, 6);
}

function extractTopicComparisonTokens(text: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const rawWord of (text || '').split(/[,·~?!…:\s/()\[\]]+/)) {
    const w = rawWord.trim();
    if (!w || /^202[0-9]년?$/.test(w)) continue;
    const normNoun = normalizeKoreanTagToken(w);
    const fallbackWord = w
      .replace(/[#"'“”‘’]/g, '')
      .replace(/(은|는|이|가|을|를|의|에|에서|으로|로)$/, '')
      .trim();
    const chosen = normNoun || (fallbackWord.length >= 2 && !/^[0-9]+$/.test(fallbackWord) ? fallbackWord : '');
    if (!chosen) continue;
    const key = chosen.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(key);
    }
  }
  return tokens;
}

export function areTopicsSimilar(keywordA: string, keywordB: string): boolean {
  const normA = normalizeKey(keywordA);
  const normB = normalizeKey(keywordB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (
    (normA.length >= 5 && normB.includes(normA)) ||
    (normB.length >= 5 && normA.includes(normB))
  ) {
    return true;
  }

  const tokensA = extractTopicComparisonTokens(keywordA);
  const tokensB = extractTopicComparisonTokens(keywordB);
  if (tokensA.length === 0 || tokensB.length === 0) return false;

  const setB = new Set(tokensB);
  const sharedCount = tokensA.filter((t) => setB.has(t)).length;
  const minCount = Math.min(tokensA.length, tokensB.length);
  const overlapRatio = sharedCount / Math.max(1, minCount);

  return sharedCount >= 2 && overlapRatio >= 0.65;
}

function stripMarkdownForSimilarity(md: string): string[] {
  const cleaned = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\|.+\|$/gm, ' ')
    .replace(/[#>*_~`|\[\]\(\)-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return cleaned
    .split(/\s+/)
    .map((w) => w.replace(/[^가-힣a-z0-9]/g, ''))
    .filter((w) => w.length >= 2);
}

export function computeMarkdownSimilarity(mdA: string, mdB: string): number {
  const wordsA = stripMarkdownForSimilarity(mdA);
  const wordsB = stripMarkdownForSimilarity(mdB);
  if (wordsA.length < 10 || wordsB.length < 10) return 0;

  const shinglesA = new Set<string>();
  for (let i = 0; i < wordsA.length - 1; i++) {
    shinglesA.add(`${wordsA[i]} ${wordsA[i + 1]}`);
  }
  const shinglesB = new Set<string>();
  for (let i = 0; i < wordsB.length - 1; i++) {
    shinglesB.add(`${wordsB[i]} ${wordsB[i + 1]}`);
  }
  if (shinglesA.size === 0 || shinglesB.size === 0) return 0;

  let intersection = 0;
  for (const s of shinglesA) {
    if (shinglesB.has(s)) intersection++;
  }
  const union = shinglesA.size + shinglesB.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const containment = intersection / Math.min(shinglesA.size, shinglesB.size);

  // Blend Jaccard and containment so both direct copy-paste and expanded copies are detected
  return Number(Math.max(jaccard, containment * 0.85).toFixed(4));
}

export interface DuplicatePostGuardResult {
  blocked: boolean;
  reason?: 'recent_topic' | 'body_similarity';
  similarityPct?: number;
  matchedPost?: BlogPost;
  ageDays?: number;
  remainingDays?: number;
  refreshedFromOldPost?: BlogPost;
}

export function checkDuplicatePostGuard(params: {
  blogId: string;
  keyword?: string;
  title?: string;
  markdownContent?: string;
  excludePostId?: string;
  posts: BlogPost[];
  cooldownDays?: number;
  onlyPublished?: boolean;
}): DuplicatePostGuardResult {
  const {
    blogId,
    keyword = '',
    title = '',
    markdownContent = '',
    excludePostId,
    posts,
    cooldownDays = 14,
    onlyPublished = false,
  } = params;

  const nowMs = Date.now();
  let refreshedFromOldPost: BlogPost | undefined;

  for (const p of posts) {
    if (p.blogId !== blogId) continue;
    if (excludePostId && p.id === excludePostId) continue;
    if (onlyPublished && p.status !== 'published') continue;

    const refTime = new Date(p.publishedAt || p.createdAt).getTime();
    const ageDays = Number.isFinite(refTime)
      ? Math.max(0, Math.floor((nowMs - refTime) / 86400000))
      : 0;

    if (markdownContent && markdownContent.trim().length >= 120 && p.markdownContent) {
      const sim = computeMarkdownSimilarity(markdownContent, p.markdownContent);
      if (sim >= 0.45) {
        return {
          blocked: true,
          reason: 'body_similarity',
          similarityPct: Math.round(sim * 100),
          matchedPost: p,
          ageDays,
          remainingDays: 0,
        };
      }
    }

    const topicMatches =
      (keyword.trim().length > 0 && areTopicsSimilar(keyword, p.targetKeyword)) ||
      (title.trim().length > 0 && areTopicsSimilar(title, p.title));

    if (topicMatches) {
      if (ageDays < cooldownDays) {
        return {
          blocked: true,
          reason: 'recent_topic',
          matchedPost: p,
          ageDays,
          remainingDays: Math.max(1, cooldownDays - ageDays),
        };
      }
      if (!refreshedFromOldPost) {
        refreshedFromOldPost = p;
      }
    }
  }

  return {
    blocked: false,
    refreshedFromOldPost,
  };
}

export function scoreFullAutoBlueOceanCandidate(trend: TrendTopic): number {
  const words = (trend.keyword || '').trim().split(/\s+/).filter(Boolean).length;
  let score = trend.goldenScore || 75;

  const serp = trend.serpAnalysis;
  if (serp) {
    if (serp.exactMatchesInTop10 <= 1) score += 35;
    else if (serp.exactMatchesInTop10 <= 3) score += 25;
    else if (serp.exactMatchesInTop10 >= 6) score -= 25;

    if (serp.influencerCountInTop10 <= 1) score += 20;
    else if (serp.influencerCountInTop10 >= 3) score -= 30;

    if (serp.stalePostsInTop10 >= 1) score += 10;
    if (serp.qaForumSignalsInTop10 >= 1) score += 8;
  } else {
    score -= 8;
  }

  const isActionableIntent =
    trend.searchIntent === 'howto' ||
    trend.searchIntent === 'comparison' ||
    trend.searchIntent === 'review';
  if (words >= 3 && words <= 6) {
    score += isActionableIntent ? 15 : 5;
  } else if (words <= 2) {
    score -= 20;
  }

  if (trend.source === 'realtime_news') {
    score -= 20;
  }

  return score;
}

export function selectBestFullAutoBlueOceanTrend(
  trends: TrendTopic[],
  blog: BlogProfile,
  posts: BlogPost[],
  cooldownDays: number = 14,
  options?: { requireStrictBlueOcean?: boolean }
): TrendTopic | undefined {
  const eligible = (trends || []).filter((t) => {
    if (t.usedInPost) return false;
    if (!isTrendCompatibleWithBlog(t, blog)) return false;
    const guard = checkDuplicatePostGuard({
      blogId: blog.id,
      keyword: t.keyword,
      posts,
      cooldownDays,
    });
    if (guard.blocked) return false;

    if (options?.requireStrictBlueOcean) {
      if (t.source === 'realtime_news') return false;
      if (!t.serpAnalysis) return false;
      if (t.serpAnalysis.exactMatchesInTop10 > 3) return false;
      if (t.serpAnalysis.influencerCountInTop10 > 1) return false;
    }

    return true;
  });

  if (eligible.length === 0) return undefined;

  eligible.sort((a, b) => {
    const diff = scoreFullAutoBlueOceanCandidate(b) - scoreFullAutoBlueOceanCandidate(a);
    if (diff !== 0) return diff;
    return (b.goldenScore || 0) - (a.goldenScore || 0);
  });

  return eligible[0];
}
