import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import {
  AppDatabaseState,
  BlogProfile,
  WebAISessionInfo,
  AffiliateItem,
  AutomationLog,
  TrendTopic,
  BlogPost,
} from './types';
import {
  extractCleanKoreanTopicPhrase,
  generateViralTitlesForKeyword,
  isPolicyOrFinanceApplyTopic,
  buildRelevantPostTags,
  LEGACY_CLUMSY_TITLE_REGEX,
} from './keywordScout';
import { evaluatePostSEO } from './seoAnalyzer';
import { findAsideExecutable } from './asideDriver';
import {
  enforceCurrentDateContextInMarkdown,
  cleanClumsyBlogTitle,
  convertMarkdownToNaverRichHtml,
  injectContextualInlineVisuals,
  encryptBlogPassword,
  decryptBlogPassword,
} from './webAiDriver';

export { encryptBlogPassword, decryptBlogPassword };

const TREND_TTL_REALTIME_NEWS_MS = 48 * 60 * 60 * 1000;
const TREND_TTL_EVERGREEN_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_TRENDS_PER_BLOG = 25;

const DEFAULT_WEB_AI_SESSIONS: WebAISessionInfo[] = [
  {
    id: 'agy_cli',
    name: 'Google Antigravity CLI (agy · Gemini 4 Hydrogen/Argon / Claude 5.5)',
    url: 'agy -p',
    badge: 'agy CLI · 멀티모델 (Gemini 4 / Claude 5.5)',
    description:
      '최신 Google Antigravity 공식 CLI(agy)를 통해 Gemini 4 Hydrogen/Argon, Claude Opus/Sonnet 5.5, GPT-OSS 120B 등 모든 모델을 자유롭게 선택하여 구동합니다.',
    loggedIn: true,
    priority: 1,
    enabled: true,
    connectionType: 'local_cli',
    cliCommand: 'agy',
    cliInstallCmd: 'agy update',
    selectedModel: 'gemini-4-argon-high',
    availableModels: [
      { id: 'gemini-4-hydrogen-xhigh', label: 'Gemini 4 Hydrogen (XHigh) — 최신 초고성능 추론' },
      { id: 'gemini-4-hydrogen-high', label: 'Gemini 4 Hydrogen (High) — 최신 고효율' },
      { id: 'gemini-4-hydrogen-medium', label: 'Gemini 4 Hydrogen (Medium)' },
      { id: 'gemini-4-hydrogen-low', label: 'Gemini 4 Hydrogen (Low) — 초고속' },
      { id: 'gemini-4-argon-high', label: 'Gemini 4 Argon (High) — 최고 추론·품질' },
      { id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium) — 밸런스형' },
      { id: 'gemini-4-argon-low', label: 'Gemini 4 Argon (Low) — 빠른 속도' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High) — 최상위 한국어 필력' },
      { id: 'claude-opus-5-5-medium', label: 'Claude Opus 5.5 (Medium)' },
      { id: 'claude-opus-5-5-low', label: 'Claude Opus 5.5 (Low)' },
      { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High) — 블로그 최적화' },
      { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
      { id: 'claude-sonnet-5-5-low', label: 'Claude Sonnet 5.5 (Low)' },
      { id: 'gemini-3.8-flash-high', label: 'Gemini 3.8 Flash (High) — 초고속 생성' },
      { id: 'gemini-3.8-flash-medium', label: 'Gemini 3.8 Flash (Medium)' },
      { id: 'gemini-3.8-flash-low', label: 'Gemini 3.8 Flash (Low)' },
      { id: 'gpt-oss-120b-medium', label: 'GPT-OSS 120B (Medium)' },
      { id: 'gemini-pro-orchestrator-g1-pro', label: 'Orchestrator (Argon)' },
    ],
  },
  {
    id: 'codex_cli',
    name: 'OpenAI Codex CLI (ChatGPT Plus/Pro 공식 로컬 CLI)',
    url: 'codex exec',
    badge: 'codex CLI · GPT-6.1 Sol / Terra / Astra',
    description:
      '내 PC에 설치된 공식 OpenAI codex CLI를 통해 ChatGPT Plus/Pro 구독 OAuth 인증으로 브라우저 없이 백그라운드 직접 생성합니다.',
    loggedIn: false,
    priority: 2,
    enabled: true,
    connectionType: 'local_cli',
    cliCommand: 'codex',
    cliInstallCmd: 'npm install -g @openai/codex',
    selectedModel: 'gpt-6.1-sol',
    availableModels: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (플래그십 기본)' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra (최상위 심층 분석)' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (자연스러운 문체·고속)' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (초경량·고속)' },
      { id: 'o4-pro', label: 'OpenAI o4-pro (고급 추론)' },
      { id: 'codex-mini-latest', label: 'Codex Mini Latest (초고속·경량)' },
    ],
  },
  {
    id: 'claude_cli',
    name: 'Claude Code CLI (claude / agy Claude 5.5)',
    url: 'claude -p',
    badge: 'claude CLI · Claude 5.5 / Fable 5.2',
    description:
      'Anthropic 공식 claude CLI 또는 agy --model claude-sonnet-5-5-high 엔진을 통해 최고 수준의 한국어 블로그 원고를 생성합니다.',
    loggedIn: false,
    priority: 3,
    enabled: true,
    connectionType: 'local_cli',
    cliCommand: 'claude',
    cliInstallCmd: 'npm install -g @anthropic-ai/claude-code',
    selectedModel: 'claude-sonnet-5-5-high',
    availableModels: [
      { id: 'claude-sonnet-5-5-high', label: 'Claude Sonnet 5.5 (High) — 한국어 문체 특화' },
      { id: 'claude-opus-5-5-high', label: 'Claude Opus 5.5 (High) — 심층 전문 칼럼용' },
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (최상위 프론티어·스토리텔링)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (초고속·대량 생성)' },
      { id: 'claude-sonnet-5-5-medium', label: 'Claude Sonnet 5.5 (Medium)' },
    ],
  },
  {
    id: 'copilot_cli',
    name: 'GitHub Copilot / 커스텀 로컬 AI CLI',
    url: 'gh copilot / custom-cli',
    badge: '커스텀 로컬 CLI 명령어 연동',
    description:
      'GitHub Copilot CLI 또는 PC에 설치된 원하는 AI CLI 실행 명령어를 직접 지정하여 표준 입출력(stdin/stdout)으로 원고를 생성합니다.',
    loggedIn: false,
    priority: 4,
    enabled: true,
    connectionType: 'local_cli',
    cliCommand: 'gh',
    cliInstallCmd: 'winget install GitHub.cli',
    selectedModel: 'default',
    availableModels: [
      { id: 'default', label: 'CLI 기본 설정 모델 (Default)' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen' },
    ],
  },
  {
    id: 'chatgpt_plus',
    name: 'ChatGPT Plus / Pro (GPT-6.1 Sol / Terra 웹 세션)',
    url: 'https://chatgpt.com/',
    badge: 'GPT-6.1 Sol / Terra / Astra',
    description: '최신 GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Astra(Pro) 구독형 웹 세션을 브라우저로 직접 제어하여 초고품질 원고를 작성합니다.',
    loggedIn: false,
    priority: 5,
    enabled: true,
    connectionType: 'web_browser',
    selectedModel: 'gpt-6.1-sol',
    availableModels: [
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol (기본 플래그십)' },
      { id: 'gpt-6-astra', label: 'GPT-6 Astra / Pro (최상위 심층 리서치)' },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra (자연스러운 글쓰기·고속)' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (빠른 속도·경량)' },
      { id: 'o4-pro', label: 'o4-pro (고난도 추론)' },
    ],
  },
  {
    id: 'claude_pro',
    name: 'Claude Pro (Claude 5.5 / Fable 5.2 웹 세션)',
    url: 'https://claude.ai/new',
    badge: 'Claude 5.5 / Fable 5.2',
    description: '1M 컨텍스트와 최고 수준의 한국어 블로그 문체를 자랑하는 Claude Sonnet/Opus/Haiku 5.5 및 Fable 5.2 웹 구독 세션을 활용합니다.',
    loggedIn: false,
    priority: 6,
    enabled: true,
    connectionType: 'web_browser',
    selectedModel: 'claude-sonnet-5-5',
    availableModels: [
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (표준 고품격 한국어)' },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (최상위 심층 분석)' },
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2 (프론티어 추론·감성 리뷰)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (초고속 응답)' },
    ],
  },
  {
    id: 'gemini_pro',
    name: 'Google Gemini Pro / Ultra (Gemini 4 Hydrogen/Argon/Carbon)',
    url: 'https://gemini.google.com/app',
    badge: 'Gemini 4 Hydrogen / Argon / Carbon (Ultra)',
    description: '구글 최신 멀티모달 추론 엔진 Gemini 4 Hydrogen/Argon 및 Ultra 전용 Carbon 웹 구독 세션을 활용합니다.',
    loggedIn: false,
    priority: 7,
    enabled: true,
    connectionType: 'web_browser',
    selectedModel: 'gemini-4-hydrogen',
    availableModels: [
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (최신 고효율 추론 + 구글 검색)' },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon (심층 추론 + 구글 검색)' },
      { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon [Ultra 전용] — 최상위 프론티어 추론' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (초고속 작성)' },
    ],
  },
  {
    id: 'perplexity_pro',
    name: 'Perplexity Pro (Deep Research 웹 세션)',
    url: 'https://www.perplexity.ai/',
    badge: 'Sonar Pro + GPT-6.1 / Claude 5.5 / Gemini 4',
    description: '최신 뉴스, 정책, IT 스펙 등 실시간 출처 기반 심층 리서치형 블로그 포스팅에 최적화된 웹 세션입니다.',
    loggedIn: false,
    priority: 8,
    enabled: true,
    connectionType: 'web_browser',
    selectedModel: 'sonar-reasoning-pro',
    availableModels: [
      { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro (실시간 웹 검색 특화)' },
      { id: 'sonar-pro', label: 'Sonar Pro (빠른 팩트 체크)' },
      { id: 'sonar-deep-research', label: 'Sonar Deep Research (심층 리서치 리포트)' },
      { id: 'claude-sonnet-5-5-search', label: 'Claude 5.5 Sonnet + 실시간 검색' },
      { id: 'gpt-6.1-sol-search', label: 'GPT-6.1 Sol + 실시간 검색' },
      { id: 'gemini-4-hydrogen-search', label: 'Gemini 4 Hydrogen + 실시간 검색' },
    ],
  },
  {
    id: 'deepseek_web',
    name: 'DeepSeek Web (V4 / R2 추론 세션)',
    url: 'https://chat.deepseek.com/',
    badge: 'DeepSeek V4 / R2 Thinking',
    description: '고도화된 심층 추론(R2)과 비교 데이터 구조화에 강력한 차세대 DeepSeek 웹 세션을 활용합니다.',
    loggedIn: false,
    priority: 9,
    enabled: true,
    connectionType: 'web_browser',
    selectedModel: 'deepseek-v4',
    availableModels: [
      { id: 'deepseek-v4', label: 'DeepSeek V4 (표준 고속 생성)' },
      { id: 'deepseek-r2-thinking', label: 'DeepSeek R2 (DeepThink 추론 포함)' },
      { id: 'deepseek-v3.2', label: 'DeepSeek V3.2 (안정형 경량)' },
    ],
  },
  {
    id: 'ollama_local',
    name: 'Local Ollama (Llama 4 / Qwen 3.5 / Gemma 3)',
    url: 'http://127.0.0.1:11434',
    badge: 'Llama 4 · Qwen 3.5 로컬 무료',
    description: 'PC에 설치된 최신 로컬 LLM(Llama 4, Qwen 3.5, Gemma 3, DeepSeek R2 등)과 연동하여 24시간 무제한 동작합니다.',
    loggedIn: true,
    priority: 10,
    enabled: true,
    connectionType: 'local_api',
    selectedModel: 'qwen3.5:latest',
    availableModels: [
      { id: 'qwen3.5:latest', label: 'Qwen 3.5 (한국어·다국어 특화 로컬 모델)' },
      { id: 'llama4:latest', label: 'Llama 4 (범용 로컬 모델)' },
      { id: 'gemma3:latest', label: 'Gemma 3 (구글 경량 로컬 모델)' },
      { id: 'deepseek-r2:latest', label: 'DeepSeek R2 Local (로컬 추론 모델)' },
    ],
  },
];

const DEFAULT_BLOGS: BlogProfile[] = [
  {
    id: 'blog-naver-1',
    name: '머니인사이트 연구소 (네이버)',
    platform: 'naver',
    description: '재테크, 정부지원금, 금융 꿀팁, 절세 전략을 다루는 고조회수 네이버 블로그',
    nicheKeywords: ['정부지원금', '청년도약계좌', '연말정산 환급', '소상공인 대출', '신용카드 추천'],
    automationMode: 'semi_auto',
    persona: {
      id: 'persona-naver-1',
      name: '친절한 금융/정책 가이드 이웃',
      tone: '친근하고 신뢰감 있는 존댓말 (~해요, ~했답니다, 꼭 챙겨보세요!)',
      targetReader: '지원금과 재테크 정보를 쉽고 빠르게 정리해서 보고 싶은 2050 직장인 및 자영업자',
      hookFormula: '실제 내가 겪은 고민과 독자의 질문에 공감하며 자연스럽게 시작',
      structureTemplate: '자연스러운 일상 공감 도입부 → 핵심 수치/혜택 요약 → 실전 팁 & 주의사항 → 친근한 마무리',
      emojiLevel: 'minimal',
      forbiddenWords: ['무조건', '100% 보장', '불법'],
      signatureIntro: '안녕하세요, 머니인사이트입니다! :)',
      signatureOutro: '오늘 정리해 드린 내용이 도움 되셨기를 바라며, 궁금한 점은 편하게 댓글 남겨주세요!',
      includeComparisonTable: true,
      includeFaqSection: true,
      includeSummaryBox: true,
    },
    schedule: {
      enabled: true,
      cronExpression: '0 9,19 * * *',
      dailyPostLimit: 2,
      autoScoutKeywords: true,
      autoGenerateThumbnail: true,
      autoInsertAffiliate: true,
      autoInternalLink: true,
      preferredAIProvider: 'agy_cli',
      preferredModel: 'claude-sonnet-5-5-high',
    },
    auth: {
      blogUrl: 'https://blog.naver.com/money_insight_lab',
      blogIdOrUsername: 'money_insight_lab',
      defaultCategory: '정부지원금·재테크',
      sessionLoggedIn: false,
    },
    stats: {
      totalPublished: 14,
      pendingReview: 2,
      estimatedMonthlyViews: 48500,
      averageSeoScore: 93,
      lastPublishedAt: new Date(Date.now() - 3600 * 1000 * 5).toISOString(),
    },
    createdAt: new Date(Date.now() - 86400 * 1000 * 15).toISOString(),
  },
  {
    id: 'blog-tistory-1',
    name: '테크기어 랩 (티스토리 애드센스)',
    platform: 'tistory',
    description: 'IT 기기 리뷰, 노트북/스마트폰 비교, AI 서비스 활용법 중심의 고단가 애드센스·쿠팡파트너스 수익형 블로그',
    nicheKeywords: ['게이밍 노트북 추천', '아이패드 에어 비교', '무선 노이즈캔슬링 이어폰', '가성비 모니터', 'AI 생산성 툴'],
    automationMode: 'full_auto',
    persona: {
      id: 'persona-tistory-1',
      name: '실사용 기반 IT 테크 리뷰어',
      tone: '전문적이면서도 명확한 분석형 어조 (~입니다, ~로 분석됩니다, 실사용 기준 장단점은 다음과 같습니다)',
      targetReader: '구매 전 스펙 비교와 실사용 단점까지 꼼꼼하게 확인하는 스마트 컨슈머',
      hookFormula: '스펙표 숫자에 속지 마세요! 실제 구매 전 반드시 비교해야 할 핵심 포인트 3가지',
      structureTemplate: '결론 요약 (추천 대상) → 핵심 스펙 비교표 → 실사용 장점 3가지 & 아쉬운 점 → 가성비 구매 가이드 → FAQ',
      emojiLevel: 'minimal',
      forbiddenWords: ['최고급', '무결점'],
      signatureIntro: '스펙 시트 너머의 진짜 사용 가치를 분석하는 테크기어 랩(TechGear Lab)입니다.',
      signatureOutro: '합리적인 IT 기기 선택에 도움이 되었기를 바랍니다. 추가로 비교가 필요한 모델이 있다면 댓글로 남겨주세요.',
      includeComparisonTable: true,
      includeFaqSection: true,
      includeSummaryBox: true,
    },
    schedule: {
      enabled: true,
      cronExpression: '0 8,14,21 * * *',
      dailyPostLimit: 3,
      autoScoutKeywords: true,
      autoGenerateThumbnail: true,
      autoInsertAffiliate: true,
      autoInternalLink: true,
      preferredAIProvider: 'agy_cli',
      preferredModel: 'gemini-4-argon-high',
    },
    auth: {
      blogUrl: 'https://techgear-lab.tistory.com',
      blogIdOrUsername: 'techgear-lab',
      defaultCategory: 'IT 디바이스 비교/리뷰',
      sessionLoggedIn: false,
    },
    stats: {
      totalPublished: 28,
      pendingReview: 1,
      estimatedMonthlyViews: 82400,
      averageSeoScore: 95,
      lastPublishedAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
    },
    createdAt: new Date(Date.now() - 86400 * 1000 * 30).toISOString(),
  },
  {
    id: 'blog-wp-1',
    name: '바이오·헬스 라이프 가이드 (워드프레스)',
    platform: 'wordpress',
    description: '영양제 조합, 수면 건강, 혈당 관리, 운동 루틴을 다루는 구글 SEO 특화 워드프레스 블로그',
    nicheKeywords: ['혈당 스파이크 예방', '마그네슘 추천 복용법', '오메가3 고르는 법', '간헐적 단식 식단', '수면 영양제'],
    automationMode: 'semi_auto',
    persona: {
      id: 'persona-wp-1',
      name: '근거 중심 웰니스 에디터',
      tone: '차분하고 신뢰도 높은 매거진 에디터 문체 (~권장됩니다, ~확인해 보세요)',
      targetReader: '건강 관리와 영양제 섭취법, 식단 관리를 체계적으로 실천하려는 독자',
      hookFormula: '무심코 매일 먹던 습관이 오히려 피로를 부른다면? 과학적 근거로 정리한 핵심 가이드',
      structureTemplate: '핵심 건강 체크리스트 → 주요 효능 및 원리 → 올바른 섭취 타이밍 & 주의사항 비교표 → FAQ',
      emojiLevel: 'minimal',
      forbiddenWords: ['완치', '특효약', '기적의'],
      signatureIntro: '건강한 일상을 위한 과학적 웰니스 아카이브, 바이오·헬스 라이프 가이드입니다.',
      signatureOutro: '※ 본 글은 건강 정보 제공을 목적으로 작성되었으며 전문적인 의학적 진단을 대신하지 않습니다.',
      includeComparisonTable: true,
      includeFaqSection: true,
      includeSummaryBox: true,
    },
    schedule: {
      enabled: false,
      cronExpression: '0 10 * * *',
      dailyPostLimit: 1,
      autoScoutKeywords: true,
      autoGenerateThumbnail: true,
      autoInsertAffiliate: true,
      autoInternalLink: true,
      preferredAIProvider: 'agy_cli',
      preferredModel: 'gemini-4-argon-high',
    },
    auth: {
      blogUrl: 'https://biohealth-guide.example.com',
      blogIdOrUsername: 'admin',
      defaultCategory: '영양·웰니스',
      sessionLoggedIn: false,
      apiUrl: 'https://biohealth-guide.example.com/wp-json/wp/v2',
    },
    stats: {
      totalPublished: 9,
      pendingReview: 0,
      estimatedMonthlyViews: 31200,
      averageSeoScore: 91,
    },
    createdAt: new Date(Date.now() - 86400 * 1000 * 10).toISOString(),
  },
  {
    id: 'blog-velog-1',
    name: 'DevLog 풀스택 아키텍처 (벨로그)',
    platform: 'velog',
    description: 'TypeScript, Rust, AI 에이전트, 클라우드 아키텍처 트러블슈팅을 기록하는 개발자 기술 블로그',
    nicheKeywords: ['TypeScript 성능 최적화', 'Playwright 크롤링 자동화', 'Next.js 서버 액션', 'Rust 웹어셈블리', 'AI 에이전트 설계'],
    automationMode: 'semi_auto',
    persona: {
      id: 'persona-velog-1',
      name: '시니어 풀스택 엔지니어',
      tone: '간결하고 핵심 위주의 개발자 기술 문서 스타일 (~다, ~한다, 코드 예제로 살펴보자)',
      targetReader: '실무 트러블슈팅과 아키텍처 베스트 프랙티스를 찾는 프론트엔드·백엔드 개발자',
      hookFormula: '프로덕션 환경에서 겪은 병목 현상과 이를 해결하며 정리한 실전 아키텍처 가이드',
      structureTemplate: '문제 정의 (Why) → 아키텍처 비교표 → 단계별 구현 및 핵심 포인트 → 성능 벤치마크 요약 → FAQ',
      emojiLevel: 'minimal',
      forbiddenWords: [],
      signatureIntro: '실무에서 부딪히며 검증한 엔지니어링 노트를 기록합니다.',
      signatureOutro: '도움이 되셨다면 벨로그 좋아요와 팔로우 부탁드립니다. 피드백이나 다른 접근법은 댓글로 환영합니다!',
      includeComparisonTable: true,
      includeFaqSection: true,
      includeSummaryBox: true,
    },
    schedule: {
      enabled: false,
      cronExpression: '0 22 * * 1,3,5',
      dailyPostLimit: 1,
      autoScoutKeywords: true,
      autoGenerateThumbnail: true,
      autoInsertAffiliate: false,
      autoInternalLink: true,
      preferredAIProvider: 'agy_cli',
      preferredModel: 'claude-sonnet-5-5-high',
    },
    auth: {
      blogUrl: 'https://velog.io/@devlog_architect',
      blogIdOrUsername: 'devlog_architect',
      defaultCategory: 'Architecture',
      sessionLoggedIn: false,
    },
    stats: {
      totalPublished: 6,
      pendingReview: 1,
      estimatedMonthlyViews: 19400,
      averageSeoScore: 94,
    },
    createdAt: new Date(Date.now() - 86400 * 1000 * 7).toISOString(),
  },
];

const DEFAULT_AFFILIATES: AffiliateItem[] = [
  {
    id: 'aff-1',
    name: '초경량 AI 비즈니스 노트북 특가',
    platform: 'coupang',
    productTitle: '2026 최신형 초경량 고성능 노트북 16GB/512GB 로켓배송 할인',
    affiliateUrl: 'https://link.coupang.com/a/sample-laptop-deal',
    priceText: '할인가 및 카드 즉시할인 확인',
    badgeText: '로켓배송 베스트셀러',
    triggerKeywords: ['노트북', '게이밍 노트북', '대학생 노트북', '사무용 노트북', 'IT 기기', '모니터'],
    disclosureText: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
    ctaButtonText: '최저가 스펙 및 실구매자 후기 확인하기',
    clickCount: 342,
    active: true,
  },
  {
    id: 'aff-2',
    name: '프리미엄 노이즈캔슬링 무선 이어폰/헤드폰',
    platform: 'coupang',
    productTitle: '플래그십 액티브 노이즈캔슬링 블루투스 이어폰 공식몰 특가',
    affiliateUrl: 'https://link.coupang.com/a/sample-anc-earbuds',
    priceText: '오늘만 타임특가 진행 중',
    badgeText: '평점 4.9 인기상품',
    triggerKeywords: ['이어폰', '노이즈캔슬링', '헤드폰', '아이패드', '블루투스'],
    disclosureText: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
    ctaButtonText: '실시간 할인율 & 청음 후기 보러가기',
    clickCount: 218,
    active: true,
  },
  {
    id: 'aff-3',
    name: '킬레이트 마그네슘 & 알티지 오메가3 세트',
    platform: 'coupang',
    productTitle: '흡수율 높은 킬레이트 마그네슘 400mg + 초임계 rTG 오메가3',
    affiliateUrl: 'https://link.coupang.com/a/sample-wellness-pack',
    priceText: '한달분 대용량 특가',
    badgeText: '건강기능식품 베스트',
    triggerKeywords: ['마그네슘', '오메가3', '영양제', '수면', '혈당', '피로회복'],
    disclosureText: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
    ctaButtonText: '성분표 및 최저가 혜택 자세히 보기',
    clickCount: 164,
    active: true,
  },
  {
    id: 'aff-4',
    name: '맞춤형 정부지원금·환급금 무료 조회 서비스',
    platform: 'custom_cpa',
    productTitle: '내가 받을 수 있는 숨은 정부지원금 & 환급금 1분 통합 조회',
    affiliateUrl: 'https://www.gov.kr/portal/rcvfvrSvc/main',
    priceText: '수수료 0원 무료 조회',
    badgeText: '필수 체크',
    triggerKeywords: ['정부지원금', '청년도약계좌', '연말정산', '환급', '대출', '지원금'],
    disclosureText: '독자분들의 편의를 위해 공식 안내 및 제휴 정보 링크를 함께 제공합니다.',
    ctaButtonText: '내 숨은 지원금·환급액 지금 바로 조회하기',
    clickCount: 519,
    active: true,
  },
];

const DEFAULT_TRENDS: TrendTopic[] = [
  {
    id: 'trend-1',
    keyword: '청년도약계좌 일시납입 만기 수령액 계산법',
    parentSeedKeyword: '청년도약계좌',
    source: 'naver_autocomplete',
    estimatedMonthlySearch: 64200,
    competitionRatio: 0.28,
    goldenScore: 96,
    cpcLevel: 'ultra',
    searchIntent: 'informational',
    suggestedTitles: [
      '청년도약계좌 일시납입 만기 수령액 계산법: 중도해지 없이 최대 이자 챙기는 3가지 핵심 전략',
      '모르면 손해 보는 청년도약계좌 지원금 조건 총정리 (소득기준·가구원 동의 완벽 가이드)',
      '청년도약계좌 vs 일반 적금 비교표: 월 70만 원 납입 시 실제 만기 수령액 차이는?',
      '청년도약계좌 신청기간 및 자격 조회 방법 3분 컷 정리',
      '일시납입 전환 시 정부기여금 얼마나 받을까? 실제 시뮬레이션 결과 공개',
    ],
    recommendedBlogId: 'blog-naver-1',
    discoveredAt: new Date().toISOString(),
  },
  {
    id: 'trend-2',
    keyword: '2026 게이밍 노트북 가성비 추천 스펙 비교 (RTX 5060 vs 5070)',
    parentSeedKeyword: '게이밍 노트북 추천',
    source: 'google_autocomplete',
    estimatedMonthlySearch: 48900,
    competitionRatio: 0.34,
    goldenScore: 94,
    cpcLevel: 'ultra',
    searchIntent: 'comparison',
    suggestedTitles: [
      '2026 게이밍 노트북 추천 구매 전 필독! RTX 5060 vs 5070 TGP 전력 제한 확인하는 법',
      '100만 원대 가성비 게이밍 노트북 TOP 5 실사용 장단점 완벽 비교표',
      '스펙표에 속지 마세요: OLED 주사율·발열 설계로 고르는 실패 없는 노트북 가이드',
      '대학생·직장인 겸용 AI NPU 고성능 노트북 추천: 무게와 성능 두 마리 토끼 잡는 모델은?',
      '게이밍 노트북 구매 시기 및 할인 혜택 최대로 받는 체크리스트',
    ],
    recommendedBlogId: 'blog-tistory-1',
    discoveredAt: new Date().toISOString(),
  },
  {
    id: 'trend-3',
    keyword: '식후 혈당 스파이크 예방 습관 및 영양제 복용 순서',
    parentSeedKeyword: '혈당 스파이크 예방',
    source: 'google_trends',
    estimatedMonthlySearch: 39500,
    competitionRatio: 0.22,
    goldenScore: 95,
    cpcLevel: 'high',
    searchIntent: 'howto',
    suggestedTitles: [
      '식후 쏟아지는 졸음과 피로, 혈당 스파이크 예방하는 식사 순서 3단계 공식',
      '혈당 관리에 도움 되는 식전·식후 루틴과 영양제 복용 타이밍 완벽 비교',
      '거꾸로 식사법 실제 효과와 피해야 할 아침 공복 음식 리스트 총정리',
      '혈당 스파이크 증상 자가진단 체크리스트 7가지와 생활습관 교정법',
      '식후 15분 산책이 혈당 곡선에 미치는 놀라운 변화와 실천 팁',
    ],
    recommendedBlogId: 'blog-wp-1',
    discoveredAt: new Date().toISOString(),
  },
  {
    id: 'trend-4',
    keyword: 'Playwright 브라우저 세션 유지 및 자동화 아키텍처 패턴',
    parentSeedKeyword: 'Playwright 크롤링 자동화',
    source: 'ai_expansion',
    estimatedMonthlySearch: 18400,
    competitionRatio: 0.19,
    goldenScore: 92,
    cpcLevel: 'high',
    searchIntent: 'howto',
    suggestedTitles: [
      'Playwright Persistent Context로 로그인 세션을 영구 유지하는 실전 자동화 아키텍처',
      'TypeScript + Electron 환경에서 브라우저 자동화 파이프라인 안정성 200% 높이기',
      'Playwright vs Puppeteer 실무 성능 비교표 및 셀렉터 복원력 설계 패턴',
      '복잡한 SPA 에디터(SmartEditor, TinyMCE) DOM 제어 트러블슈팅 완벽 정리',
      '멀티 프로필 격리(UserDataDir)를 활용한 다계정 안전 운영 가이드',
    ],
    recommendedBlogId: 'blog-velog-1',
    discoveredAt: new Date().toISOString(),
  },
];

export class LocalStore {
  private dbPath: string;
  private state: AppDatabaseState;

  constructor() {
    const userDataPath = app ? app.getPath('userData') : path.join(process.cwd(), '.blogstater-data');
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    this.dbPath = path.join(userDataPath, 'blogstater-omni-db.json');
    this.state = this.load(userDataPath);
  }

  private load(userDataPath: string): AppDatabaseState {
    if (fs.existsSync(this.dbPath)) {
      try {
        const raw = fs.readFileSync(this.dbPath, 'utf-8');
        const parsed = JSON.parse(raw) as AppDatabaseState;
        const mergedSessions = DEFAULT_WEB_AI_SESSIONS.map((def) => {
          const existing = parsed.webAISessions?.find((s) => s.id === def.id);
          if (!existing) return def;
          const defModels = def.availableModels || [];
          const seenModelIds = new Set(defModels.map((m) => m.id));
          const extraExistingModels = (existing.availableModels || []).filter(
            (m) => m?.id && !seenModelIds.has(m.id)
          );
          const mergedModels = [...defModels, ...extraExistingModels];
          return {
            ...def,
            loggedIn: existing.loggedIn,
            lastUsedAt: existing.lastUsedAt,
            enabled: existing.enabled,
            cliCommand: existing.cliCommand || def.cliCommand,
            cliVersion: existing.cliVersion || def.cliVersion,
            selectedModel: existing.selectedModel || def.selectedModel,
            availableModels: mergedModels,
          };
        });
        // Filter out old demo preset blog IDs if present from previous run
        const stripEmoji = (str?: string) =>
          (str || '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
        const demoBlogIds = new Set(['blog-naver-1', 'blog-tistory-1', 'blog-wp-1', 'blog-velog-1']);
        const rawUserBlogs = (parsed.blogs || []).filter((b) => !demoBlogIds.has(b.id));
        const rawUserPosts = (parsed.posts || []).filter((p) => !demoBlogIds.has(p.blogId));

        const needsKeywordRepair = (kw: string) =>
          /^(?:년|월|일|명|원|억|조)\s+/.test(kw) ||
          /\s+(?:외쳐|외친|밝혀|밝힌|전해|말해)\s*$/.test(kw) ||
          /1심\s+결과에/.test(kw);

        let postsUpdated = false;
        const userPosts = rawUserPosts.map((p) => {
          const matchedBlog = rawUserBlogs.find((b) => b.id === p.blogId);
          let cleanedTargetKeyword = (p.targetKeyword || '').replace(/\s*새\s*창\s*열림/g, '').trim();
          if (cleanedTargetKeyword && needsKeywordRepair(cleanedTargetKeyword)) {
            cleanedTargetKeyword =
              extractCleanKoreanTopicPhrase(cleanedTargetKeyword) ||
              cleanedTargetKeyword.replace(/^(?:년|월|일|명|원|억|조)\s+/, '').trim();
          }

          const rawCleanedTitle = (p.title || '').replace(/\s*새\s*창\s*열림/g, '').trim();
          const cleanedTitle = LEGACY_CLUMSY_TITLE_REGEX.test(rawCleanedTitle)
            ? cleanClumsyBlogTitle(rawCleanedTitle, cleanedTargetKeyword)
            : rawCleanedTitle;

          const hasLegacyAltTitles = (p.alternativeTitles || []).some((at) =>
            LEGACY_CLUMSY_TITLE_REGEX.test(at)
          );
          const nextAltTitles = hasLegacyAltTitles
            ? generateViralTitlesForKeyword(cleanedTargetKeyword || cleanedTitle, matchedBlog)
            : p.alternativeTitles;

          const cleanedSubKeywords = (p.subKeywords || [])
            .map((s) => s.replace(/\s*새\s*창\s*열림/g, '').trim())
            .filter(Boolean);
          let sanitizedMarkdown = p.markdownContent
            ? enforceCurrentDateContextInMarkdown(p.markdownContent)
            : p.markdownContent;
          if (
            sanitizedMarkdown &&
            sanitizedMarkdown.trim().length >= 200 &&
            !/!\[[^\]]*\]\((?:https?:\/\/|data:image\/)[^)]+\)/.test(sanitizedMarkdown)
          ) {
            sanitizedMarkdown = injectContextualInlineVisuals(
              sanitizedMarkdown,
              cleanedTargetKeyword,
              cleanedTitle,
              matchedBlog
            ).markdownContent;
          }
          const sanitizedMetaDescription = p.metaDescription
            ? enforceCurrentDateContextInMarkdown(p.metaDescription)
            : p.metaDescription;
          const titleDiffers =
            cleanedTitle !== p.title ||
            cleanedTargetKeyword !== p.targetKeyword ||
            hasLegacyAltTitles;
          const markdownDiffers = sanitizedMarkdown !== p.markdownContent;
          const htmlHasStrikethroughOrHr = /<(?:del|s|strike|hr)\b/i.test(p.htmlContent || '');
          const nextHtmlContent =
            markdownDiffers || htmlHasStrikethroughOrHr
              ? convertMarkdownToNaverRichHtml(
                  sanitizedMarkdown,
                  p.thumbnail?.dataUrl,
                  p.thumbnail?.accentColor || '#2563eb'
                )
              : p.htmlContent;

          const cleanedTags = buildRelevantPostTags({
            keyword: cleanedTargetKeyword,
            subKeywords: cleanedSubKeywords,
            blog: matchedBlog,
            aiTags: (p.tags || []).map((t) => t.replace(/\s*새\s*창\s*열림/g, '').trim()).filter(Boolean),
            markdownContent: sanitizedMarkdown,
          });
          const nextTags =
            JSON.stringify(cleanedTags) !== JSON.stringify(p.tags || [])
              ? cleanedTags
              : p.tags || cleanedTags;
          const updatedSeoReport = evaluatePostSEO({
            title: cleanedTitle,
            targetKeyword: cleanedTargetKeyword,
            markdownContent: sanitizedMarkdown,
            subKeywords: cleanedSubKeywords,
            tags: nextTags,
            internalLinkCount: p.internalLinksInserted?.length || 0,
            affiliateLinkCount: p.affiliateItemsInserted?.length || 0,
          });

          const nextThumbnail =
            p.thumbnail && cleanedTargetKeyword !== p.targetKeyword
              ? {
                  ...p.thumbnail,
                  headline:
                    cleanedTargetKeyword.length > 28
                      ? cleanedTargetKeyword.slice(0, 28)
                      : cleanedTargetKeyword,
                }
              : p.thumbnail;

          const tagsDiffers = JSON.stringify(nextTags) !== JSON.stringify(p.tags || []);
          const seoDiffers =
            !p.seoReport ||
            p.seoReport.totalScore !== updatedSeoReport.totalScore ||
            (p.seoReport.checks || []).map((c) => c.label).join('|') !==
              updatedSeoReport.checks.map((c) => c.label).join('|');

          if (titleDiffers || markdownDiffers || htmlHasStrikethroughOrHr || tagsDiffers || seoDiffers) {
            postsUpdated = true;
            return {
              ...p,
              title: cleanedTitle,
              alternativeTitles: nextAltTitles,
              targetKeyword: cleanedTargetKeyword,
              subKeywords: cleanedSubKeywords,
              markdownContent: sanitizedMarkdown,
              htmlContent: nextHtmlContent,
              metaDescription: sanitizedMetaDescription,
              thumbnail: nextThumbnail,
              tags: nextTags,
              seoReport: updatedSeoReport,
            };
          }
          return p;
        });

        const userBlogs = rawUserBlogs.map((b) => {
          const blogPosts = userPosts.filter((p) => p.blogId === b.id);
          const pendingCount = blogPosts.filter(
            (p) => p.status === 'review_pending' || p.status === 'draft'
          ).length;
          const avgSeo =
            blogPosts.length > 0
              ? Math.round(
                  blogPosts.reduce((acc, cur) => acc + (cur.seoReport?.totalScore || 85), 0) /
                    blogPosts.length
                )
              : 90;
          const rawIntro = stripEmoji(b.persona?.signatureIntro);
          const cleanIntro =
            !rawIntro || /핵심만 알기 쉽게 정리해 드리는 블로그/.test(rawIntro)
              ? `안녕하세요, ${b.name}입니다! :)`
              : rawIntro;
          return {
            ...b,
            auth: {
              ...b.auth,
              loginPassword: undefined,
              hasSavedPassword: Boolean(b.auth?.loginPasswordEncrypted),
            },
            persona: {
              ...b.persona,
              signatureIntro: cleanIntro,
              signatureOutro: stripEmoji(b.persona?.signatureOutro),
            },
            stats: {
              ...b.stats,
              pendingReview: pendingCount,
              averageSeoScore: avgSeo,
            },
          };
        });
        const demoTrendIds = new Set(['trend-1', 'trend-2', 'trend-3', 'trend-4']);
        const staleOrBogusTrendRegex = /북항재개발|신약개발|출시 1년 남은|이루잡|AI 스터디 #02|새\s*창\s*열림/i;
        const rawTrends = parsed.trends || [];
        const filteredRawTrends = rawTrends.filter((t) => {
          if (demoTrendIds.has(t.id)) return false;
          if (!t.usedInPost && (!t.discoveredAt || staleOrBogusTrendRegex.test(t.keyword || ''))) {
            return false;
          }
          return true;
        });
        let trendsUpdated = filteredRawTrends.length !== rawTrends.length;
        const userTrends = filteredRawTrends.map((t) => {
          const cleanedSourceKw = (t.keyword || '').replace(/\s*새\s*창\s*열림/g, '').trim();
          const isPolicy = isPolicyOrFinanceApplyTopic(cleanedSourceKw);
          const keywordNeedsRepair = needsKeywordRepair(cleanedSourceKw);
          const hasLegacyTitles = (t.suggestedTitles || []).some((st) =>
            LEGACY_CLUMSY_TITLE_REGEX.test(st)
          );

          let nextKw = cleanedSourceKw;
          if (keywordNeedsRepair) {
            nextKw =
              extractCleanKoreanTopicPhrase(
                cleanedSourceKw.replace(/\s+핵심 조건 및 신청방법$/, ''),
                t.parentSeedKeyword
              ) || cleanedSourceKw.replace(/^(?:년|월|일|명|원|억|조)\s+/, '').trim();
          } else if (/^어린이 환자와 놀고/.test(cleanedSourceKw)) {
            nextKw = 'KT 병원 AI 로봇 실증';
          }

          if (nextKw !== t.keyword || hasLegacyTitles) {
            trendsUpdated = true;
            const matchedBlog = userBlogs.find((b) => b.id === t.recommendedBlogId);
            return {
              ...t,
              keyword: nextKw || cleanedSourceKw,
              suggestedTitles: generateViralTitlesForKeyword(
                nextKw || cleanedSourceKw,
                matchedBlog
              ),
            };
          }
          return t;
        });
        const prunedTrends = this.pruneTrendsList(userTrends, userPosts);
        if (
          prunedTrends.length !== userTrends.length ||
          prunedTrends.some((t, i) => t.id !== userTrends[i]?.id || Boolean(t.usedInPost) !== Boolean(userTrends[i]?.usedInPost))
        ) {
          trendsUpdated = true;
        }
        const demoAffIds = new Set(['aff-1', 'aff-2', 'aff-3', 'aff-4']);
        const userAffiliates = (parsed.affiliates || [])
          .filter((a) => !demoAffIds.has(a.id))
          .map((a) => ({
            ...a,
            ctaButtonText: stripEmoji(a.ctaButtonText),
          }));

        const loadedState: AppDatabaseState = {
          blogs: userBlogs,
          webAISessions: mergedSessions,
          trends: prunedTrends,
          posts: userPosts,
          affiliates: userAffiliates,
          logs: parsed.logs || [],
          settings: {
            headlessBrowserForAI: parsed.settings?.headlessBrowserForAI ?? false,
            headlessBrowserForPublish: parsed.settings?.headlessBrowserForPublish ?? false,
            defaultFallbackToSynthesis: parsed.settings?.defaultFallbackToSynthesis ?? true,
            concurrentTasks: parsed.settings?.concurrentTasks ?? 2,
            browserUserDataPath:
              parsed.settings?.browserUserDataPath || path.join(userDataPath, 'browser-profiles'),
            browserAutomationEngine:
              parsed.settings?.browserAutomationEngine === 'playwright'
                ? 'playwright'
                : parsed.settings?.browserAutomationEngine === 'aside'
                ? 'aside'
                : findAsideExecutable()
                ? 'aside'
                : 'playwright',
            duplicateCooldownDays: parsed.settings?.duplicateCooldownDays ?? 14,
          },
        };
        if (postsUpdated || trendsUpdated) {
          fs.writeFileSync(this.dbPath, JSON.stringify(loadedState, null, 2), 'utf-8');
        }
        return loadedState;
      } catch (err) {
        console.error('Failed to parse DB file, initializing defaults:', err);
      }
    }

    const initialState: AppDatabaseState = {
      blogs: [],
      webAISessions: DEFAULT_WEB_AI_SESSIONS,
      trends: [],
      posts: [],
      affiliates: [],
      logs: [
        {
          id: 'log-init-1',
          timestamp: new Date().toISOString(),
          level: 'info',
          module: 'SCHEDULER',
          message: 'BlogStater Omni Studio가 시작되었습니다. 운영하실 첫 블로그를 등록해 주세요.',
        },
      ],
      settings: {
        headlessBrowserForAI: false,
        headlessBrowserForPublish: false,
        defaultFallbackToSynthesis: true,
        concurrentTasks: 2,
        browserUserDataPath: path.join(userDataPath, 'browser-profiles'),
        browserAutomationEngine: findAsideExecutable() ? 'aside' : 'playwright',
        duplicateCooldownDays: 14,
      },
    };
    this.save(initialState);
    return initialState;
  }

  public save(newState?: AppDatabaseState): void {
    if (newState) {
      this.state = newState;
    }
    try {
      fs.writeFileSync(this.dbPath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed to save DB file:', err);
    }
  }

  public getState(): AppDatabaseState {
    return this.state;
  }

  public addLog(
    level: AutomationLog['level'],
    module: AutomationLog['module'],
    message: string,
    detail?: string,
    blogId?: string
  ): AutomationLog {
    const entry: AutomationLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      level,
      module,
      blogId,
      message,
      detail,
    };
    this.state.logs.unshift(entry);
    if (this.state.logs.length > 300) {
      this.state.logs = this.state.logs.slice(0, 300);
    }
    this.save();
    return entry;
  }

  public upsertBlog(blog: BlogProfile): BlogProfile {
    const idx = this.state.blogs.findIndex((b) => b.id === blog.id);
    const prev = idx >= 0 ? this.state.blogs[idx] : undefined;

    const incomingPassword = (blog.auth?.loginPassword || '').trim();
    const nextEncryptedPassword = incomingPassword
      ? encryptBlogPassword(incomingPassword)
      : blog.auth?.loginPasswordEncrypted || prev?.auth?.loginPasswordEncrypted;

    const normalizedAuth = {
      ...blog.auth,
      loginId: (blog.auth?.loginId ?? prev?.auth?.loginId ?? '').trim() || undefined,
      loginPasswordEncrypted: nextEncryptedPassword || undefined,
      hasSavedPassword: Boolean(nextEncryptedPassword),
    };
    delete normalizedAuth.loginPassword;

    const normalizedBlog: BlogProfile = {
      ...blog,
      auth: normalizedAuth,
    };

    if (idx >= 0) {
      this.state.blogs[idx] = normalizedBlog;
    } else {
      this.state.blogs.push(normalizedBlog);
    }
    this.save();
    return normalizedBlog;
  }

  public deleteBlog(blogId: string): void {
    this.state.blogs = this.state.blogs.filter((b) => b.id !== blogId);
    this.save();
  }

  public updateWebAISession(session: WebAISessionInfo): void {
    const idx = this.state.webAISessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.state.webAISessions[idx] = session;
      this.save();
    }
  }

  private normalizeKeywordKey(kw: string): string {
    return (kw || '')
      .toLowerCase()
      .replace(/[\s·,\-_/\[\]()!?'"“”‘’]/g, '')
      .trim();
  }

  private areKeywordsNearDuplicate(a: string, b: string): boolean {
    const normA = this.normalizeKeywordKey(a);
    const normB = this.normalizeKeywordKey(b);
    if (!normA || !normB) return false;
    if (normA === normB) return true;
    // Check sorted word tokens (e.g., "청년도약계좌 신청 방법" vs "신청 방법 청년도약계좌")
    const tokensA = a.toLowerCase().trim().split(/\s+/).filter(Boolean).sort().join('|');
    const tokensB = b.toLowerCase().trim().split(/\s+/).filter(Boolean).sort().join('|');
    if (tokensA === tokensB) return true;
    return false;
  }

  private pruneTrendsList(trends: TrendTopic[], posts: BlogPost[]): TrendTopic[] {
    const now = Date.now();
    const usedKeywordKeys = new Set(
      posts.map((p) => this.normalizeKeywordKey(p.targetKeyword)).filter(Boolean)
    );

    const eligible: TrendTopic[] = [];
    for (const t of trends) {
      const isUsed =
        Boolean(t.usedInPost) || usedKeywordKeys.has(this.normalizeKeywordKey(t.keyword));
      if (isUsed) {
        if (t.pinned) {
          eligible.push(t.usedInPost ? t : { ...t, usedInPost: true });
        }
        continue;
      }

      const isProtected = Boolean(t.pinned || t.isManual);
      if (!isProtected) {
        const discoveredMs = t.discoveredAt ? Date.parse(t.discoveredAt) : NaN;
        if (!Number.isFinite(discoveredMs)) continue;
        const maxAgeMs =
          t.source === 'realtime_news' ? TREND_TTL_REALTIME_NEWS_MS : TREND_TTL_EVERGREEN_MS;
        if (now - discoveredMs > maxAgeMs) continue;
      }

      eligible.push(t);
    }

    const grouped = new Map<string, TrendTopic[]>();
    for (const item of eligible) {
      const groupKey = item.recommendedBlogId || '__global__';
      const list = grouped.get(groupKey);
      if (list) list.push(item);
      else grouped.set(groupKey, [item]);
    }

    const combined: TrendTopic[] = [];
    for (const items of grouped.values()) {
      const protectedItems: TrendTopic[] = [];
      const autoItems: TrendTopic[] = [];
      for (const item of items) {
        if (item.pinned || item.isManual) protectedItems.push(item);
        else autoItems.push(item);
      }
      autoItems.sort((a, b) => {
        const msA = a.discoveredAt ? Date.parse(a.discoveredAt) : 0;
        const msB = b.discoveredAt ? Date.parse(b.discoveredAt) : 0;
        const timeDiff = (Number.isFinite(msB) ? msB : 0) - (Number.isFinite(msA) ? msA : 0);
        if (timeDiff !== 0) return timeDiff;
        return (b.goldenScore || 0) - (a.goldenScore || 0);
      });
      combined.push(...protectedItems, ...autoItems.slice(0, MAX_TRENDS_PER_BLOG));
    }

    return combined.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      const msA = a.discoveredAt ? Date.parse(a.discoveredAt) : 0;
      const msB = b.discoveredAt ? Date.parse(b.discoveredAt) : 0;
      const timeDiff = (Number.isFinite(msB) ? msB : 0) - (Number.isFinite(msA) ? msA : 0);
      if (timeDiff !== 0) return timeDiff;
      return (b.goldenScore || 0) - (a.goldenScore || 0);
    });
  }

  public pruneTrends(): TrendTopic[] {
    const prevSig = this.state.trends.map((t) => `${t.id}:${Boolean(t.usedInPost)}`).join('|');
    const next = this.pruneTrendsList(this.state.trends, this.state.posts);
    const nextSig = next.map((t) => `${t.id}:${Boolean(t.usedInPost)}`).join('|');
    if (prevSig !== nextSig) {
      this.state.trends = next;
      this.save();
    }
    return this.state.trends;
  }

  public addTrends(newTrends: TrendTopic[]): TrendTopic[] {
    const usedKeywordKeys = new Set(
      this.state.posts.map((p) => this.normalizeKeywordKey(p.targetKeyword))
    );
    const existingList = this.pruneTrendsList(this.state.trends, this.state.posts);
    const added: TrendTopic[] = [];

    for (const candidate of newTrends) {
      const isDup =
        existingList.some((ex) => this.areKeywordsNearDuplicate(ex.keyword, candidate.keyword)) ||
        added.some((ad) => this.areKeywordsNearDuplicate(ad.keyword, candidate.keyword));
      if (!isDup) {
        const isUsed = usedKeywordKeys.has(this.normalizeKeywordKey(candidate.keyword));
        added.push({
          ...candidate,
          usedInPost: candidate.usedInPost || isUsed,
        });
      }
    }

    this.state.trends = this.pruneTrendsList([...added, ...existingList], this.state.posts);
    this.save();
    return this.state.trends;
  }

  public togglePinTrend(trendId: string): TrendTopic[] {
    const idx = this.state.trends.findIndex((t) => t.id === trendId);
    if (idx >= 0) {
      this.state.trends[idx] = {
        ...this.state.trends[idx],
        pinned: !this.state.trends[idx].pinned,
      };
      this.save();
    }
    return this.state.trends;
  }

  public deleteTrend(trendId: string): TrendTopic[] {
    this.state.trends = this.state.trends.filter((t) => t.id !== trendId);
    this.save();
    return this.state.trends;
  }

  public deleteTrendsBatch(trendIds: string[]): TrendTopic[] {
    const idSet = new Set(trendIds);
    this.state.trends = this.state.trends.filter((t) => !idSet.has(t.id));
    this.save();
    return this.state.trends;
  }

  public clearTrends(options?: { blogId?: string; onlyUsed?: boolean }): TrendTopic[] {
    const usedKeywordKeys = new Set(
      this.state.posts.map((p) => this.normalizeKeywordKey(p.targetKeyword))
    );
    if (options?.onlyUsed) {
      this.state.trends = this.state.trends.filter((t) => {
        const isUsed = t.usedInPost || usedKeywordKeys.has(this.normalizeKeywordKey(t.keyword));
        if (options.blogId && options.blogId !== 'all') {
          return !(isUsed && t.recommendedBlogId === options.blogId);
        }
        return !isUsed;
      });
    } else if (options?.blogId && options.blogId !== 'all') {
      this.state.trends = this.state.trends.filter(
        (t) => t.recommendedBlogId !== options.blogId
      );
    } else {
      this.state.trends = [];
    }
    this.save();
    return this.state.trends;
  }

  public deduplicateTrends(): { removedCount: number; trends: TrendTopic[] } {
    const beforeCount = this.state.trends.length;
    const usedKeywordKeys = new Set(
      this.state.posts.map((p) => this.normalizeKeywordKey(p.targetKeyword))
    );

    // Sort by goldenScore descending so we always keep the highest-scoring entry
    const sorted = [...this.state.trends].sort((a, b) => b.goldenScore - a.goldenScore);
    const unique: TrendTopic[] = [];

    for (const item of sorted) {
      const dup = unique.find((u) => this.areKeywordsNearDuplicate(u.keyword, item.keyword));
      if (!dup) {
        unique.push({
          ...item,
          usedInPost:
            item.usedInPost || usedKeywordKeys.has(this.normalizeKeywordKey(item.keyword)),
        });
      } else if (item.usedInPost) {
        dup.usedInPost = true;
      }
    }

    this.state.trends = this.pruneTrendsList(unique, this.state.posts);
    this.save();
    return {
      removedCount: Math.max(0, beforeCount - this.state.trends.length),
      trends: this.state.trends,
    };
  }

  public upsertPost(post: BlogPost): BlogPost {
    const idx = this.state.posts.findIndex((p) => p.id === post.id);
    if (idx >= 0) {
      this.state.posts[idx] = post;
    } else {
      this.state.posts.unshift(post);
    }
    // Mark matching trend keywords as usedInPost and prune consumed non-pinned trends
    const postKey = this.normalizeKeywordKey(post.targetKeyword);
    if (postKey) {
      for (const t of this.state.trends) {
        if (this.normalizeKeywordKey(t.keyword) === postKey) {
          t.usedInPost = true;
        }
      }
    }
    this.state.trends = this.pruneTrendsList(this.state.trends, this.state.posts);
    // Recalculate blog stats
    const blog = this.state.blogs.find((b) => b.id === post.blogId);
    if (blog) {
      const blogPosts = this.state.posts.filter((p) => p.blogId === blog.id);
      blog.stats.pendingReview = blogPosts.filter((p) => p.status === 'review_pending' || p.status === 'draft').length;
      const publishedCount = blogPosts.filter((p) => p.status === 'published').length;
      if (publishedCount > 0) {
        blog.stats.totalPublished = Math.max(blog.stats.totalPublished, publishedCount);
      }
      if (blogPosts.length > 0) {
        const avgSeo = Math.round(
          blogPosts.reduce((acc, cur) => acc + (cur.seoReport?.totalScore || 85), 0) / blogPosts.length
        );
        blog.stats.averageSeoScore = avgSeo;
      }
    }
    this.save();
    return post;
  }

  public deletePost(postId: string): void {
    this.state.posts = this.state.posts.filter((p) => p.id !== postId);
    const remainingPostKeys = new Set(
      this.state.posts.map((p) => this.normalizeKeywordKey(p.targetKeyword))
    );
    for (const t of this.state.trends) {
      if (t.usedInPost && !remainingPostKeys.has(this.normalizeKeywordKey(t.keyword))) {
        t.usedInPost = false;
      }
    }
    for (const blog of this.state.blogs) {
      const blogPosts = this.state.posts.filter((p) => p.blogId === blog.id);
      blog.stats.pendingReview = blogPosts.filter(
        (p) => p.status === 'review_pending' || p.status === 'draft'
      ).length;
      if (blogPosts.length > 0) {
        blog.stats.averageSeoScore = Math.round(
          blogPosts.reduce((acc, cur) => acc + (cur.seoReport?.totalScore || 85), 0) /
            blogPosts.length
        );
      }
    }
    this.save();
  }

  public upsertAffiliate(item: AffiliateItem): AffiliateItem {
    const idx = this.state.affiliates.findIndex((a) => a.id === item.id);
    if (idx >= 0) {
      this.state.affiliates[idx] = item;
    } else {
      this.state.affiliates.unshift(item);
    }
    this.save();
    return item;
  }

  public deleteAffiliate(id: string): void {
    this.state.affiliates = this.state.affiliates.filter((a) => a.id !== id);
    this.save();
  }

  public updateSettings(settings: Partial<AppDatabaseState['settings']>): AppDatabaseState['settings'] {
    this.state.settings = { ...this.state.settings, ...settings };
    this.save();
    return this.state.settings;
  }
}
