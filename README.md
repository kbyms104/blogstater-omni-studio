# BlogStater Omni Studio (올인원 멀티 블로그 자동화 데스크톱)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
![Platform: Windows 10/11](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D6?logo=windows&logoColor=white)
![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron&logoColor=white)
![React + TypeScript](https://img.shields.io/badge/React%20%2B%20TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![Playwright](https://img.shields.io/badge/Playwright-1.48-2EAD33?logo=playwright&logoColor=white)

**Python을 일절 사용하지 않고 100% TypeScript + Electron + React + Playwright 기반으로 제작된 설치형 데스크톱 블로그 자동화 스튜디오**입니다.
유료 종량제 API 키 없이도 사용자가 구독 중인 **ChatGPT Plus, Claude Pro, Google Gemini Pro, Perplexity Pro, DeepSeek** 웹 브라우저 세션을 그대로 연결해 고조회수 블로그 원고를 생성하고, **네이버 블로그 · 티스토리 · 워드프레스 · 벨로그 · 미디엄 · Ghost · GitHub Pages**까지 통합 관리합니다.

> **English Summary:** BlogStater Omni Studio is a **100% local-first** TypeScript, Electron, React, and Playwright desktop application for multi-platform blog authoring, keyword scouting, SEO scoring, thumbnail generation, and publishing across Naver Blog, Tistory, WordPress, Velog, Medium, Ghost, and GitHub Pages — using your own local AI CLIs or web AI subscriptions without any pay-per-token API key.

---

## 🚀 실행 방법

### 1. 저장소 클론 및 원클릭 실행 (자동 빌드 후 실행)
```bash
git clone https://github.com/kbyms104/blogstater-omni-studio.git
cd blogstater-omni-studio
npm install
npm start
```
- 이미 의존성을 설치한 뒤에는 폴더 내 [`start-studio.bat`](./start-studio.bat) 파일을 더블클릭하거나 `npm start`만 실행해도 됩니다.

### 2. 실시간 개발 모드 실행 (UI 핫리로드 + Electron 동시 실행)
```bash
npm run dev
```

### 3. 윈도우 설치 파일(.exe) 패키징 빌드
```bash
npm run dist
```

---

## 🔥 핵심 탑재 기능 (8대 올인원 모듈)

1. **통합 대시보드 & 원클릭 자동 파이프라인 (`Dashboard`)**
   - 운영 중인 모든 블로그의 누적 발행 수, 검수 대기 수, 예상 월간 조회수, 평균 SEO 점수(100점 만점)를 한눈에 파악합니다.
   - **[선택 블로그 원클릭 자동 발행]** 버튼 하나로 `황금 키워드 발굴 → 구독형 AI 원고 작성 → 100점 SEO 최적화 → 썸네일 생성 → 발행/검수 대기` 전 과정을 자동으로 처리합니다.

2. **멀티 블로그 & 페르소나 매니저 (`Multi-Blog & Persona`)**
   - **지원 플랫폼**: 네이버 블로그(SmartEditor ONE), 티스토리, 워드프레스(REST API 및 브라우저 동시 지원), 벨로그, Medium, Ghost, GitHub Pages(Markdown).
   - 블로그별 **핵심 주제(Niche Keywords)**, **전담 페르소나**(말투, 서론 후킹 공식, 금칙어, 고정 인사말/맺음말), **자동화 모드**(완전자동 `full_auto` / 반자동 검수 `semi_auto`), **Cron 예약 스케줄러**를 개별 설정합니다.

3. **황금 키워드 & 실시간 트렌드 스카우트 (`Golden Keyword Scout`)**
   - **네이버 실시간 자동완성 API**, **구글 자동완성 API**, **구글 트렌드 급상승 RSS**를 실시간 크롤링하여 블로그 주제와 결합된 세부 롱테일 키워드를 발굴합니다.
   - 월간 예상 검색량, 경쟁 강도, 수익성(CPC), **Golden Score(0~100점)**를 자동 산출하고 **클릭률(CTR) 극대화 추천 제목 5선**을 즉시 제안합니다.

4. **구독형 웹 AI 브라우저 세션 센터 (`Subscription Web AI Center`)**
   - API 키 과금 없이 2026년 10월 현시점 최신 모델인 **ChatGPT Plus (`GPT-6.1 Sol / GPT-6 Astra`), Claude Pro (`Claude Sonnet 5.5 / Opus 5.5 / Fable 5.1`), Google Gemini Pro (`Gemini 4 Argon / 3.1 Pro`), Perplexity Pro (`Sonar Pro`), DeepSeek Web (`DeepSeek V4 / R2`), Local Ollama (`Llama 4 / Qwen 3.5 / Gemma 3`)**를 연동합니다.
   - 전용 브라우저 창에서 한 번 로그인해 두면 영구 프로필(`userDataDir`)에 세션이 보존되어 자동 원고 생성에 활용되며, 세션 미연결 시에도 내장된 **하이브리드 SEO 구조화 합성 엔진**이 즉시 2,200자 이상의 고품질 원고를 생성합니다.

5. **AI 포스팅 생성 & 실시간 100점 SEO 스튜디오 (`SEO Studio`)**
   - 네이버 C-Rank / DIA+ 및 구글 추천 스니펫에 최적화된 **도입부 후킹 + 3줄 요약 박스 + H2/H3 체계적 목차 + 마크다운 비교표(Table) + 실전 체크리스트 + FAQ** 구조로 원고를 작성합니다.
   - 우측 패널에서 **실시간 100점 만점 SEO 점수**, 공백 제외 글자수, 예상 체류시간(분/초), 키워드 밀도를 즉시 진단합니다.
   - **[리치 HTML 복사]** 버튼을 누르면 표·인용구·소제목 디자인이 입혀진 HTML이 클립보드에 복사되어 네이버 스마트에디터 ONE이나 티스토리에 `Ctrl+V` 한 번으로 깔끔하게 붙여넣을 수 있습니다.

6. **고클릭률(CTR) 썸네일 & 이미지 스튜디오 (`Thumbnail Canvas`)**
   - HTML5 Canvas 엔진을 통해 네이버 정방형(`1:1`), 티스토리/워드프레스 와이드(`16:9`) 비율의 고해상도 썸네일을 즉시 생성하고 본문 최상단 및 로컬 발행 패키지에 자동 삽입합니다.

7. **수익화(쿠팡파트너스·제휴 CPA) & 자동 내부링크 센터 (`Monetization`)**
   - 포스팅 키워드와 매칭되는 쿠팡파트너스/제휴 상품을 본문 중간에 세련된 추천 박스로 자동 삽입하고 공정위 대가성 문구를 자동으로 표기합니다.
   - 해당 블로그에 발행된 기존 글들을 문맥에 맞게 **자동 내부링크(Internal Linking)**로 엮어 블로그 지수와 체류시간을 동시에 끌어올립니다.

8. **검수 대기열 & 로컬 패키지 아카이빙 (`Review Queue & Exporter`)**
   - 모든 포스팅은 발행 시 `exports/` 폴더 하위에 날짜·플랫폼·키워드별로 `.md` (Frontmatter 포함), `.html` (리치 스타일 적용), `thumbnail.png` 세트로 자동 백업됩니다.

---

## 💻 지원 환경 및 설치 준비

- **운영체제**: **Windows 10/11 우선 지원** (`start-studio.bat`, `electron-builder --win` 및 로컬 CLI 경로가 Windows 기준으로 최적화되어 있습니다.)
- **런타임**: **Node.js 20+** 권장
- **의존성 설치 및 실행**:

```bash
npm install
npm start
```

### 🌐 블로그 자동 발행 엔진 (Aside 권장 / Playwright 대안)

- **기본 권장 엔진 — Aside 브라우저** ([aside.com](https://aside.com)):
  - 기본 설정(`browserAutomationEngine = 'aside'`)은 PC에 설치된 **Aside 브라우저 및 Aside CLI(`aside.exe`)** 를 통해 이미 로그인된 세션을 그대로 활용하여 네이버 블로그·티스토리 등에 자동 발행합니다.
  - 자동 로그인 연동·발행 기능에서 가장 안정적으로 동작하므로 `Aside` 설치를 권장합니다.
- **미설치 시 대안 — 내장 브라우저 (`Playwright`)**:
  - `Aside` 설치는 필수가 아닙니다. 설치되어 있지 않다면 앱 내 설정에서 자동화 엔진을 **내장 브라우저(`Playwright`)** 로 전환하거나 자동 폴백으로 사용할 수 있습니다.
  - Windows에 설치된 Chrome 또는 Microsoft Edge를 자동으로 감지해 실행하며, 두 브라우저가 모두 없는 환경이라면 아래 명령어로 Chromium을 설치하세요:
    ```bash
    npx playwright install chromium
    ```

### 🤖 AI 원고 생성 연동 옵션 (선택 사항)

- **로컬 AI CLI 연동**: PC에 `agy` (Google Antigravity CLI), `codex`, `claude`, `gh`, `Ollama` 등이 설치되어 있으면 별도 API 키 입력 없이 바로 연결해 원고를 생성할 수 있습니다.
- **구독형 웹 AI 브라우저 세션**: 위 CLI를 설치하지 않았더라도 앱 내 전용 브라우저 창에서 **ChatGPT Plus, Claude Pro, Google Gemini Pro, Perplexity Pro, DeepSeek** 웹 계정에 한 번 로그인하면 동일하게 원고를 생성할 수 있으며, 미연결 시에도 내장 하이브리드 엔진으로 초안 생성이 가능합니다.

### 🧭 처음 실행 후 빠른 시작 (Quick Start)

1. **블로그 프로필 등록**: `Multi-Blog & Persona` 메뉴에서 운영할 블로그 플랫폼·주제·페르소나를 등록합니다. *(처음에는 **반자동 검수 모드 `semi_auto`** 사용을 권장합니다.)*
2. **AI 연동 확인**: `Subscription Web AI Center`에서 설치된 로컬 AI CLI(`agy`, `codex`, `claude`, `Ollama`)를 확인하거나, 구독 중인 웹 AI 서비스에 1회 로그인합니다.
3. **발행 엔진 선택**: `Aside` 설치 사용자는 기본 설정 그대로 사용하면 되며, 미설치 사용자는 설정에서 내장 **`Playwright`** 엔진으로 전환합니다.
4. **첫 글 생성 및 검수**: `Dashboard` 또는 `SEO Studio`에서 키워드를 선택해 초안을 생성하고 SEO 점수를 확인한 뒤, 내용을 직접 검토하고 발행하거나 `[리치 HTML 복사]`로 붙여넣습니다.

---

## ⚠️ 주의사항 및 면책 조항 (Disclaimer)

> [!CAUTION]
> **계정 정지(밴)·저품질·차단 등 모든 제재에 대한 책임은 전적으로 사용자 본인에게 있습니다.**
> 짧은 시간 안에 블로그 글을 과도하게 연속 발행하면 플랫폼의 스팸·어뷰징 탐지 시스템에 의해 즉시 차단(밴) 또는 저품질 제재를 받을 수 있습니다.

- **계정 차단·저품질·제재 책임 사용자 귀속**: 본 소프트웨어를 사용하면서 발생하는 네이버 블로그·티스토리·워드프레스 등 블로그 플랫폼 및 AI 서비스의 **계정 정지(밴), 저품질 판정, 검색 노출 제한, IP 차단, 서비스 이용 제한** 등에 대해 개발자 및 기여자는 어떠한 법적·도의적 책임도 지지 않습니다.
- **단시간 대량 발행 금지 (발행 속도 조절 필수)**: 짧은 시간 내 다량의 글을 연속·반복 발행하는 행위는 플랫폼 정책상 자동화 스팸으로 간주되어 제재 위험이 매우 높습니다. 반드시 충분한 발행 간격과 적정 일일 발행량을 유지하고, 가급적 **반자동 검수 모드(`semi_auto`)** 로 원고를 직접 검토·수정한 뒤 발행하세요.
- **사용 목적 및 약관 준수**: 본 프로젝트는 **개인 생산성 보조 및 학습 목적의 오픈소스 소프트웨어**입니다. 연동되는 구독형 AI 서비스(ChatGPT, Claude, Gemini, Perplexity, DeepSeek 등) 및 각 블로그 플랫폼의 **이용약관(ToS) 준수와 계정 관리·운영 책임은 전적으로 사용자 본인**에게 있습니다.
- **악용 금지**: 대량 스팸 발행, 어뷰징, 타인의 권리 침해 또는 각 플랫폼 정책에 위반되는 목적의 사용을 금지합니다.

---

## 🔒 로컬 전용 & 개인정보 보호 (Local-First)

- **100% 로컬 저장**: 블로그 설정, 암호화된 계정 정보, 브라우저 세션 프로필(`userDataDir`), 발행 패키지 백업(`exports/`)은 모두 **사용자 PC 로컬에만 저장**됩니다.
- **외부 수집 서버 없음**: 개발자나 제3자가 운영하는 별도 백엔드·텔레메트리·수집 서버로 사용자 계정 정보나 생성된 원고를 전송하지 않습니다.
- **네트워크 통신 범위**: 사용자가 직접 연결한 AI 서비스 및 블로그 플랫폼, 그리고 키워드 스카우트용 공개 검색/트렌드 엔드포인트로만 요청이 발생합니다.

---

## ❓ 자주 묻는 질문 / 트러블슈팅 (FAQ)

- **Q. "Aside 프로그램이 설치되어 있지 않습니다" 메시지가 뜹니다.**
  - [aside.com](https://aside.com)에서 Aside를 설치하거나, 앱 내 설정에서 자동화 엔진을 내장 **`Playwright`** 브라우저로 변경해 주세요.
- **Q. 네이버·티스토리 에디터 UI 개편으로 자동 발행이 실패합니다.**
  - `SEO Studio`에서 **[리치 HTML 복사]** 버튼을 눌러 네이버 스마트에디터 ONE 또는 티스토리 에디터에 `Ctrl+V`로 바로 붙여넣을 수 있습니다. 깨진 셀렉터는 GitHub Issues로 제보해 주시면 빠르게 반영할 수 있습니다.
- **Q. 로그인 시 2단계 인증이나 CAPTCHA가 뜹니다.**
  - 자동화 브라우저 창이 열렸을 때 최초 1회 사용자가 직접 로그인과 인증을 완료하면, 영구 프로필에 세션이 저장되어 이후 작업에서 유지됩니다.
- **Q. 자동 발행하다가 블로그가 저품질이나 차단될 수 있나요?**
  - 네. 단시간 내 반복·대량 발행은 플랫폼 스팸 탐지 시스템에 의해 제재될 수 있습니다. 충분한 발행 간격을 유지하고 가급적 **반자동 검수 모드(`semi_auto`)** 로 직접 검토 후 발행하시기 바랍니다. *(자세한 내용은 상단 면책 조항 참고)*

---

## 🗂️ 프로젝트 구조

```text
blogstater-omni-studio/
├── src/                                 # React + TypeScript 렌더러 UI
│   ├── App.tsx                          # 메인 스튜디오 대시보드 및 8대 모듈 UI
│   └── components/
│       ├── ThumbnailCanvas.tsx          # HTML5 Canvas 썸네일 생성기
│       └── WorkCalendarView.tsx         # 발행/예약 작업 캘린더 뷰
├── electron/                            # Electron 메인 프로세스 및 자동화 엔진
│   ├── main.ts                          # 앱 라이프사이클 및 IPC 핸들러
│   ├── preload.ts                       # ContextBridge 보안 브릿지
│   ├── webAiDriver.ts                   # 구독형 웹 AI · 로컬 AI CLI 드라이버
│   ├── blogPublisher.ts                 # 멀티 플랫폼 발행 엔진 (Aside/Playwright/API)
│   ├── asideDriver.ts                   # Aside CLI 연동 드라이버
│   ├── keywordScout.ts                  # 황금 키워드 · 실시간 트렌드 스카우트
│   ├── competitorAnalyzer.ts            # 경쟁 글 구조 분석기
│   ├── seoAnalyzer.ts                   # 실시간 100점 SEO 진단 엔진
│   └── store.ts                         # 로컬 데이터 저장 및 자격증명 암호화
├── public/                              # 앱 아이콘 리소스
└── start-studio.bat                     # Windows 원클릭 실행 스크립트
```

---

## 🤝 기여 및 보안

- 버그 제보, 웹 셀렉터 수정 및 PR 가이드는 [`CONTRIBUTING.md`](./CONTRIBUTING.md)를 참고하세요.
- 브라우저 프로필, 쿠키, 토큰 등 민감 정보 취급 및 취약점 제보 절차는 [`SECURITY.md`](./SECURITY.md)를 참고하세요.

---

## 📄 라이선스

이 프로젝트는 **MIT License** 하에 배포됩니다. 자세한 내용은 [`LICENSE`](./LICENSE) 파일을 참고하세요.
