# Confluence → JIRA 티켓 자동 생성

Confluence 페이지에서 스펙 담당자를 지정하면 자동으로 JIRA 티켓을 생성하고 연결하는 웹 애플리케이션입니다.

## 설치 및 실행

### 1. 환경 설정 확인
`.env` 파일의 정보가 올바르게 설정되어 있는지 확인하세요:
```
ATLASSIAN_API_TOKEN=your_token_here
ATLASSIAN_EMAIL=jeongwon@treenod.com
JIRA_URL=https://treenod.atlassian.net
CONFLUENCE_URL=https://treenod.atlassian.net/wiki
JIRA_PROJECT=LT
PORT=3000
```

### 2. 서버 실행
```bash
npm start
```

### 3. 브라우저 접속
```
http://localhost:3000
```

## 사용 방법

### 기본 정보 입력
1. **Confluence URL**: 사양서가 작성된 Confluence 페이지의 전체 URL
   - 예: `https://treenod.atlassian.net/wiki/spaces/pokopokopang/pages/73490302529/PKPK+3330A_...`

2. **제목**: JIRA 티켓의 제목
   - 예: `PKPK 3330A 빌드 작업`

3. **담당자** (선택): 스펙 담당자의 JIRA 사용자명
   - 예: `Ollie` 또는 `@Ollie`
   - 비워두면 담당자 미지정

4. **상위항목** (선택): 상위 Epic 또는 Story
   - 드롭다운에서 선택

5. **시작일**: 개발 시작 예정일

6. **마감일**: 개발 완료 예정일

7. **최초 추정치**: 예상 작업량
   - 형식: `4d`, `5h 30m`, `2w 3d`, `60m` 등
   - w (주), d (일), h (시간), m (분)

### 티켓 생성
- **✨ 티켓 생성** 버튼 클릭
- 성공하면 JIRA 티켓 링크가 표시됨
- Confluence 페이지의 "연결된 업무 항목" 섹션에 JIRA 티켓이 자동 추가됨

## 기능

### ✅ 자동 생성 항목
- JIRA `LT` 프로젝트에 Task 이슈 생성
- 우선순위: 보통 (기본값)
- Confluence 페이지 URL을 설명에 포함
- 담당자 자동 지정
- Confluence 페이지에 JIRA 링크 자동 추가

### 🔧 필드 매핑
| 입력 필드 | JIRA 필드 |
|----------|----------|
| 제목 | Summary |
| 담당자 | Assignee |
| 상위항목 | Parent Issue |
| 시작일 | Start Date |
| 마감일 | Due Date |
| 추정치 | Original Estimate |

## 문제 해결

### "사용자를 찾을 수 없습니다" 오류
- 담당자명이 JIRA에 정확히 등록되어 있는지 확인하세요
- JIRA 계정 이름과 display name을 확인하세요

### Confluence 업데이트 실패
- Confluence 페이지의 편집 권한이 있는지 확인하세요
- API 토큰의 권한이 충분한지 확인하세요

### Start Date 필드 오류
- JIRA 프로젝트의 커스텀 필드 ID가 다를 수 있습니다
- server.js의 `customfield_10016`을 실제 필드 ID로 변경해야 할 수 있습니다

## 개발 환경

- Node.js 14+
- Express.js 4.x
- Axios (HTTP 클라이언트)

## 보안 주의사항

⚠️ **API 토큰은 절대 공개하지 마세요!**
- `.env` 파일을 `.gitignore`에 추가하세요
- 토큰이 유출된 경우 즉시 Atlassian 계정에서 재발급하세요
