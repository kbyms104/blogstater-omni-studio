# 기여 가이드 (Contributing Guide)

BlogStater Omni Studio 프로젝트에 관심 가져주셔서 감사합니다. 버그 제보, 셀렉터 수정, 기능 제안 및 PR을 환영합니다.

## 로컬 개발 환경 설정

- **권장 환경**: Windows 10/11, Node.js 20 이상
- **설치 및 실행**:

```bash
npm install
npm run dev
```

- **프로덕션 빌드 확인**:

```bash
npm run build
```

## 버그 제보 및 셀렉터 수정

웹 UI 자동화 특성상 대상 AI 서비스나 블로그 플랫폼의 화면 구조가 변경되면 셀렉터가 동작하지 않을 수 있습니다. 관련 이슈를 제보하거나 수정할 때는 다음 주요 파일을 참고해 주세요.

- 웹 AI 연동 드라이버: `electron/webAiDriver.ts`
- 블로그 발행 드라이버: `electron/blogPublisher.ts`
- Aside CLI 연동 드라이버: `electron/asideDriver.ts`

이슈 등록 시 재현 절차, 실행 OS, 대상 플랫폼, 오류 로그(개인정보·쿠키 제외)를 함께 남겨주시면 빠른 확인에 도움이 됩니다.

## Pull Request 규칙

- PR 제출 전 `npm run build`가 정상적으로 통과하는지 확인해 주세요.
- 개인 브라우저 프로필(`.test-*`), 쿠키, 세션 파일, 비밀번호, API 키, 빌드된 바이너리(`.exe`, `dist/`, `release/`)는 절대 커밋하지 마세요.
- 변경 목적에 맞게 범위를 최소화하고, 기존 코드 스타일과 TypeScript 타입 규칙을 따라 주세요.
