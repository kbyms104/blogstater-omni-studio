# 보안 정책 (Security Policy)

## 민감 정보 취급 주의

공개 이슈(Issue)나 Pull Request를 작성할 때 다음 민감 정보가 포함되지 않도록 반드시 확인해 주세요.

- 브라우저 프로필 및 세션 디렉터리 (`.test-google-profile/`, `.test-multi-instance/`, `.test-*/`, `userDataDir`)
- 로그인 쿠키, 인증 토큰, 블로그 비밀번호, 개인 이메일/계정 URL
- 로컬 환경 변수 파일 (`.env` 등)

실수로 민감한 세션이나 인증 정보가 포함된 로그를 올린 경우 즉시 해당 서비스에서 로그아웃·세션 폐기 및 비밀번호 재설정을 진행해 주세요.

## 취약점 제보

보안 취약점을 발견한 경우 공개 이슈로 세부 내용을 바로 게시하지 말고, GitHub 저장소의 **Security Advisories (Private vulnerability reporting)** 기능을 통해 비공개로 제보해 주세요.
