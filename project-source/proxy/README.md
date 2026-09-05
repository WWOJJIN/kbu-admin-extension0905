# kbu-admin-proxy (Cloudflare Worker)

`src/lib/claudeApi.js`가 호출하는 협조문 파싱 프록시. 확장/웹앱 코드에는 Anthropic API
키가 절대 들어가지 않고, 이 Worker의 비밀 환경변수로만 존재한다.

## 배포 방법 — 이번엔 CLI가 아니라 대시보드로 배포함

원래는 `wrangler deploy`(CLI)로 배포하려 했지만, 이 프로젝트 세션 환경에서는
Cloudflare API(`api.cloudflare.com`, `dash.cloudflare.com` 등)로 나가는 네트워크가
막혀 있어 CLI 로그인/배포 자체가 안 됐다. 그래서 아래처럼 **Cloudflare 대시보드
웹 UI로 직접 배포**하는 방식을 썼다. (본인 컴퓨터에서 직접 `npx wrangler deploy`가
되는 환경이라면 그 방법을 써도 되고, 그러면 이 폴더 그대로 `npm install && npx wrangler deploy`만
하면 된다.)

### 1) Cloudflare 대시보드에서 Worker 생성
1. https://dash.cloudflare.com 접속 → 로그인
2. 좌측 메뉴 **Workers & Pages** → **Create** → **Create Worker**
3. 이름을 `kbu-admin-proxy`로 지정하고 Deploy(기본 "Hello World" 템플릿으로 일단 생성)
4. 생성된 Worker 페이지에서 **Edit code**(온라인 에디터) 열기
5. 에디터에 있는 기본 코드를 지우고, 이 폴더의 `src/index.js` 내용을 통째로 붙여넣기
6. **Deploy** 클릭

### 2) 시크릿(환경변수) 등록
Worker 페이지 → **Settings** → **Variables and Secrets** → **Add**:
- `ANTHROPIC_API_KEY` = console.anthropic.com에서 발급받은 키 (반드시 **Encrypt** 체크)
- `PROXY_SECRET` = 아무 곳에도 노출 안 된 임의의 긴 문자열 (역시 **Encrypt** 체크).
  이 프로젝트에서 실제 사용 중인 값은 `src/lib/claudeApi.js`의 `PROXY_SECRET` 상수와
  반드시 똑같아야 한다(로컬 개발용 값은 `.dev.vars`에도 같은 값이 들어있음).

저장하면 자동으로 재배포된다.

### 3) URL 확인 후 확장 쪽에 연결
Worker 페이지 상단에 있는 기본 URL(`https://kbu-admin-proxy.<계정서브도메인>.workers.dev`)을
복사해서:
- `src/lib/claudeApi.js`의 `PROXY_URL`에 채우기(예: `https://kbu-admin-proxy.xxx.workers.dev`)
- `extension/manifest.json`의 `host_permissions`에 같은 URL 패턴(`https://kbu-admin-proxy.xxx.workers.dev/*`)
  추가 — 확장 서비스워커에서 이 도메인으로 fetch할 때 CORS/권한 문제가 안 생기게 하려면
  필요함(Worker 응답에도 CORS 헤더를 넣어뒀지만, 확장 쪽 host_permissions도 같이 맞춰주는
  쪽이 안전함)

### 4) 동작 확인
아무 터미널에서(사내 네트워크가 막혀있지 않다면):

```bash
curl -X POST "https://kbu-admin-proxy.xxx.workers.dev" \
  -H "Content-Type: application/json" \
  -H "x-proxy-secret: <PROXY_SECRET 값>" \
  -d '{"text":"9월 10일까지 학과 행사 참석 여부 회신 바랍니다."}'
```

정상이면 title/sender_dept/deadline/requires_action/action_description/summary
필드를 가진 JSON이 온다. `x-proxy-secret`이 틀리면 401, `ANTHROPIC_API_KEY`가
비었거나 잘못됐으면 502(원본 Anthropic 에러 메시지 포함)가 온다.

## 로컬 개발(선택)

```bash
cd project-source/proxy
npm install
cp .dev.vars.example .dev.vars   # 이미 만들어져 있으면 생략, 실제 키 값으로 채우기
npm run dev
```
