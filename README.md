# 대학 행정 어시스턴트 (통합본)

## 1. 크롬에 바로 로드하기 (이 폴더 자체가 확장프로그램입니다)

1. 이 zip을 다운로드해서 압축을 풉니다.
2. 크롬 주소창에 `chrome://extensions` 입력
3. 우측 상단 "개발자 모드" 켜기
4. "압축해제된 확장 프로그램을 로드합니다" 클릭
5. **방금 압축 푼 폴더(이 README.md가 있는 바로 그 폴더)**를 선택

`manifest.json`이 이 폴더 최상위에 바로 있어서, 서브폴더를 찾아 들어갈 필요 없이
이 폴더 하나만 선택하면 됩니다.

## 2. 폴더 구조

```
kbu-admin-extension/          ← 여기를 "압축해제된 확장 프로그램 로드"에서 선택
├── manifest.json
├── background.bundle.js      ← 실제 로드되는 번들 (project-source에서 빌드된 결과물)
├── background.js             ← 번들 이전 원본 소스 (참고용)
├── content.js
├── icons/
├── dist/                     ← React 앱 빌드 결과물 (project-source/src에서 빌드됨)
└── project-source/           ← 전체 개발 소스. 여기서 수정 → 빌드 → 위로 복사
    ├── src/
    ├── extension/            ← background.js/manifest.json/content.js 원본
    ├── package.json
    ├── vite.config.js
    └── ...
```

## 3. 코드 수정 후 재빌드하는 방법

코드는 항상 `project-source/` 안에서 수정하세요 (최상위 파일들은 빌드 결과물이라
직접 고쳐도 다음 빌드 때 덮어써집니다).

```bash
cd project-source
npm install
npm run build
```

빌드가 끝나면 `project-source/extension/dist`와
`project-source/extension/background.bundle.js`가 새로 생깁니다. 이 두 개를
**이 zip의 최상위 `dist/`, `background.bundle.js`로 덮어 복사**한 다음(또는
아래 한 줄로), 크롬 확장 관리 페이지에서 새로고침 버튼을 누르면 반영됩니다.

```bash
# project-source 안에서 실행 — 빌드 결과를 최상위로 동기화
cp -r extension/dist ../dist
cp extension/background.bundle.js ../background.bundle.js
cp extension/manifest.json ../manifest.json
cp extension/content.js ../content.js
```

## 4. 알아둘 것

- **구글 캘린더 OAuth**: `manifest.json`의 `oauth2.client_id`는 kbu(우진) 계정 쪽에서
  발급된 값을 그대로 가져온 것입니다. 크롬 확장을 "압축해제된 상태로 로드"하면
  확장 ID가 새로 생성되는데, 이 client_id가 그 새 확장 ID를 허용하는지 구글
  클라우드 콘솔에서 확인이 필요합니다. 안 되면 새로 OAuth 클라이언트를 만들거나
  기존 클라이언트에 확장 ID를 추가해야 해요.
- **Claude API 프록시**: 아직 미배포 상태(`project-source/proxy/`가 비어있음)라
  AI 요약/파싱은 동작하지 않고, 규칙 기반 폴백(마감일 추출, 처리필요 키워드 판정)과
  키워드 검색 챗봇으로 대체되어 있습니다. 프록시 배포 후 `project-source/src/lib/claudeApi.js`의
  `PROXY_URL`/`PROXY_SECRET`만 채우면 자동으로 AI 기능이 켜집니다.
