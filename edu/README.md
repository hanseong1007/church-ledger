# 덕신교회 부서업무 (/edu/)

주일학교·교육부서 통합 관리 웹앱입니다. 기존 금전출납부(`/`), 재정보고(`/ppt/`), 중보기도문(`/prayer/`), 포털(`/portal/`)과 분리된 별도 경로입니다.

## 구성
- `index.html` · `style.css` · `core.js` · `ui.js` · `app.js` — 화면과 암호화·동기화 로직
- `manifest.json` · `sw.js` · `icons/` — 홈화면 추가(PWA)
- `apps-script/Code.gs` — 구글 시트 동기화 API (Apps Script 웹앱)

## 동기화
- 구글 계정 `phs76041@gmail.com` 의 「덕신교회 부서업무 동기화 (암호화)」 스프레드시트
- `시트`: https://docs.google.com/spreadsheets/d/11t54SwZaMT6pBVYsWivBu9SVmrnE4x05uTRBLnMe7mM/edit
- `웹앱(/exec)`: Apps Script 「덕신교회 부서업무 동기화 API」 — 주소는 `index.html` 의 `__EDU_SYNC_URL__`
- 모든 업무 자료는 브라우저에서 AES-256-GCM 으로 암호화된 뒤 전송되고, 시트에는 암호문만 남습니다.

## 배포
`gh-pages` 브랜치의 `edu/` 폴더가 그대로 https://hanseong1007.github.io/church-ledger/edu/ 로 서빙됩니다.
