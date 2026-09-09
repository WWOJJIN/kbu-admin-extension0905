// extension/content.js
// KBU ERP(kis.kbu.ac.kr) 페이지에 주입되는 콘텐츠 스크립트.
//
// 2026-09-08 신규: "협조문/내부기안 초안 작성 챗봇" 기능 추가 — 챗봇 탭
// (ChatPage.jsx)에서 AI가 만든 초안을 실제 ERP 작성화면에 자동으로 채워주는
// 역할을 이 파일이 맡는다. 기존 지침 문서의 "필요해지면(예: ERP 화면에 버튼을
// 얹는 등 DOM 조작이 실제로 필요한 기능이 생기면) 여기에 추가한다"가 바로 이
// 케이스라 그동안 비워뒀던 이 파일을 처음 채운다. 협조문 자동 감지(폴링)는
// 여전히 background.js가 전담 — 이 파일은 그 역할과 무관하다.
//
// ⚠️ 절대 원칙(코딩 규칙 "조회 전용" 철학과 동일한 맥락): 이 스크립트는 화면
// 이동 + 입력칸 채움까지만 한다. "임시저장"이나 "상신하기" 같은 저장/제출
// 버튼은 어떤 경우에도 자동으로 누르지 않는다 — 사람이 반드시 마지막으로
// 내용을 확인하고 직접 저장/상신해야 한다.
//
// 주요내용(가.목적 등) 팝업은 채운 뒤 "확인"까지 자동으로 누른다(2026-09-08(2)
// 변경 — 처음엔 사람이 직접 확인/취소를 누르게 열어뒀는데, 채워야 할 칸이
// 목적 하나에서 목적/대상/진행절차 세 개로 늘면서 그 방식이 안 통하게 됨:
// 팝업이 모달이라 하나를 열어둔 채로는 다음 칸 팝업을 못 연다). 그래도 서버
// 저장은 전혀 아니다 — "확인"은 그 칸의 내용을 화면(아직 저장 전 초안 폼)에
// 반영하는 것뿐이고, 언제든 그 칸을 다시 열어 고치거나 지울 수 있다. 최종
// 검토는 모든 칸을 다 채운 뒤 사람이 화면 전체를 보고 하게 된다.
//
// 여기 쓰인 DOM 선택자들은 2026-09-08 실측(Claude in Chrome으로 내부기안/협조문
// 작성화면 직접 열어서 확인)을 기준으로 한다. Nexacro 프레임워크가 이 ERP를
// 캔버스가 아니라 진짜 HTML5 DOM으로 렌더링한다는 걸 그때 확인했음 — 그래서
// 아래처럼 input.value/iframe.body.innerHTML을 직접 다루는 방식이 통한다.
// id 문자열 안의 "M106970" 같은 탭 인스턴스 번호는 화면을 열 때마다 바뀌므로
// 절대 하드코딩하지 않고, 끝부분 패턴([id$="..."])으로만 찾는다.

const SCREEN_LOAD_TIMEOUT_MS = 15000;
const POLL_INTERVAL_MS = 400;

// 문서 종류별로 "메뉴에서 찾을 텍스트"와, payload의 어느 필드를 주요내용
// 그리드의 어느 행(라벨 그대로, 번호+공백 포함)에 채울지를 정의한다.
// 2026-09-08(2): 우진이 준 실제 경복대 내부기안 4건을 보고 목적 한 칸이
// 아니라 목적/대상/진행절차 세 칸을 다 채우는 걸로 넓혔다(claudeApi.js
// draftDocument의 스키마 변경과 짝). 예산(라.예산) 칸은 일부러 뺐다 — 그
// 칸은 "내용입력" 리치텍스트 팝업이 아니라 드롭다운+금액 입력이라 이 채움
// 방식 자체가 안 통한다(실측 확인). 협조문은 아직 실제 예시를 못 받아서
// 기존 방식(협조내용 한 칸만) 그대로 둔다 — 예시 받으면 같이 넓힐 예정.
const DOC_TYPE_CONFIG = {
  내부기안: {
    menuLabel: "내부기안",
    contentRows: [
      { field: "purposeHtml", label: "가. 목적" },
      { field: "targetHtml", label: "라. 대상" },
      { field: "procedureHtml", label: "마. 진행절차" },
    ],
  },
  협조문: {
    menuLabel: "협조문",
    contentRows: [{ field: "purposeHtml", label: "다. 협조내용" }],
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "KBU_ASSISTANT_FILL_DRAFT") return; // 다른 메시지는 무시
  fillDraft(message.payload)
    .then(() => sendResponse({ ok: true }))
    .catch((err) => {
      console.error("[content.js] 초안 자동 채움 실패:", err);
      sendResponse({ ok: false, error: String(err?.message || err) });
    });
  return true; // 비동기로 sendResponse를 쓰겠다는 표시 (chrome 확장 메시징 관례)
});

async function fillDraft(payload) {
  const { docType, title, overview } = payload || {};
  const config = DOC_TYPE_CONFIG[docType];
  if (!config) throw new Error(`알 수 없는 문서 종류: ${docType}`);

  await openWriteScreen(config.menuLabel);
  await waitForTitleInput();

  fillTextInput(findTitleInput(), title);
  fillTextArea(findOverviewTextArea(), overview);

  // 팝업이 모달이라 한 번에 하나씩, 순서대로(이전 칸 팝업이 완전히 닫힌 뒤에)
  // 처리해야 한다 — Promise.all로 동시에 열면 서로 겹쳐서 꼬인다.
  for (const row of config.contentRows) {
    const html = payload?.[row.field];
    if (!html) continue;
    await fillMainContentCell(row.label, html);
  }
}

// ---------------------------------------------------------------------------
// 화면 이동 (왼쪽 MY 메뉴 목록에서 더블클릭)
// ---------------------------------------------------------------------------

function findByExactText(text) {
  const els = [...document.querySelectorAll("div,span")].filter(
    (el) => el.children.length === 0 && el.textContent.trim() === text
  );
  // 팝업/메뉴가 여러 겹 떠 있을 수 있으니 실제로 화면에 그려진(레이아웃 잡힌)
  // 것만 남긴다.
  return els.filter((el) => el.getClientRects().length > 0);
}

function dblClick(el) {
  const opts = { bubbles: true, cancelable: true, view: window };
  // Nexacro 그리드/메뉴는 mousedown/mouseup/click 두 번 + dblclick까지 받아야
  // 반응하는 걸 실측으로 확인 — 브라우저 네이티브 더블클릭 이벤트 하나만
  // dispatch해서는 안 먹는 경우가 있어 전체 시퀀스를 순서대로 보낸다.
  ["mousedown", "mouseup", "click", "mousedown", "mouseup", "click", "dblclick"].forEach((type) => {
    el.dispatchEvent(new MouseEvent(type, opts));
  });
}

async function openWriteScreen(menuLabel) {
  let candidates = findByExactText(menuLabel);
  if (candidates.length === 0) {
    // MY 탭이 아니라 다른 화면을 보고 있었을 수 있음 — MY 탭을 눌러보고 재시도.
    const myTab = findByExactText("MY")[0];
    if (myTab) {
      myTab.click();
      await sleep(400);
      candidates = findByExactText(menuLabel);
    }
  }
  const el = candidates[0];
  if (!el) {
    throw new Error(
      `"${menuLabel}" 메뉴를 화면에서 찾지 못했어요. ERP 왼쪽 MY 메뉴 목록이 보이는 상태에서 다시 시도해주세요.`
    );
  }
  dblClick(el);
}

// ---------------------------------------------------------------------------
// 제목 / 사업개요-머리글 (일반 input·textarea)
// ---------------------------------------------------------------------------

function findTitleInput() {
  return document.querySelector('input[id$="_edt_title_input"]');
}
function findOverviewTextArea() {
  return document.querySelector('textarea[id$="_txa_title_textarea"]');
}

async function waitForTitleInput() {
  const start = Date.now();
  while (Date.now() - start < SCREEN_LOAD_TIMEOUT_MS) {
    if (findTitleInput()) return;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error("작성 화면이 열리는 데 시간이 너무 오래 걸려요. ERP 화면을 확인해주세요.");
}

function fillTextInput(el, value) {
  if (!el || !value) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillTextArea(el, value) {
  if (!el || !value) return;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// 주요내용 그리드의 "내용입력" 리치텍스트 팝업 (SmartEditor2, se2_iframe)
// ---------------------------------------------------------------------------
// 팝업 iframe 구조 (실측): 팝업 자체가 하나의 iframe(id가 "...webEdt_..._WebBrowser"
// 로 끝남) → 그 안의 <form> 안에 또 iframe → 그 안에 SmartEditor2가 id="se2_iframe"
// 인 iframe으로 실제 글쓰기 영역을 렌더링한다. designMode는 꺼져있지만
// se2_iframe의 <body>는 contentEditable="true"인 진짜 편집 가능 영역이라
// body.innerHTML을 그대로 덮어써도 화면에 반영된다(실측 확인).

function findGridRowContainer(labelEl) {
  // "가. 목적" 같은 라벨 셀에서 위로 올라가며, 그 행 전체(라벨 칸 + 내용입력
  // 버튼 칸을 모두 포함하는) 컨테이너를 찾는다 — id가 "..._gridrow_<N>" 로
  // 끝나는 지점(Nexacro 그리드는 행별로 이렇게 감싸는 컨테이너가 있음, 실측
  // 확인). 그리드 이름(bsns074 등)은 화면마다 달라서 여기엔 넣지 않는다.
  let node = labelEl;
  for (let i = 0; i < 8 && node; i++) {
    if (node.id && /_gridrow_\d+$/.test(node.id)) return node;
    node = node.parentElement;
  }
  return null;
}

function findMainContentButton(label) {
  const labelEl = findByExactText(label)[0];
  if (!labelEl) return null;
  const row = findGridRowContainer(labelEl);
  if (!row) return null;
  // 같은 행 안에서 클릭 가능한 "내용입력" 버튼 요소를 찾는다. 날짜/드롭다운
  // 행에는 이 요소가 없어서(예: 내부기안의 "나. 일시") null이 나올 수 있음 —
  // 그럴 땐 그 행에 본문을 못 채우는 게 정상이다.
  return row.querySelector('[id$="_controlbutton"]');
}

async function fillMainContentCell(label, html) {
  const btn = findMainContentButton(label);
  if (!btn) {
    console.warn(`[content.js] "${label}" 행을 화면에서 찾지 못해 이 항목은 건너뜁니다.`);
    return;
  }
  const opts = { bubbles: true, cancelable: true, view: window };
  btn.dispatchEvent(new MouseEvent("mousedown", opts));
  btn.dispatchEvent(new MouseEvent("mouseup", opts));
  btn.dispatchEvent(new MouseEvent("click", opts));

  const se2Body = await waitForSe2EditorBody();
  if (!se2Body) {
    console.warn(`[content.js] "${label}" 팝업의 에디터 영역을 찾지 못해 이 항목은 건너뜁니다.`);
    return;
  }
  se2Body.innerHTML = html;
  se2Body.dispatchEvent(new Event("input", { bubbles: true }));

  // 다음 칸을 채우려면 이 팝업(모달)을 닫아야 해서 "확인"을 자동으로 누른다 —
  // 파일 상단 주석 참고. 서버 저장이 아니라 화면(초안 폼)에 반영하는 것뿐이라
  // 안전하고, 이후 언제든 이 칸을 다시 열어 고칠 수 있다.
  // iframe과 같은 이유로 [0]이 아니라 마지막(가장 최근에 뜬 팝업의) 매치를 쓴다.
  const confirmMatches = findByExactText("확인");
  const confirmBtn = confirmMatches[confirmMatches.length - 1];
  if (!confirmBtn) {
    console.warn(`[content.js] "${label}" 팝업의 확인 버튼을 찾지 못했어요. 팝업이 열린 채로 남아있을 수 있어요.`);
    return;
  }
  confirmBtn.dispatchEvent(new MouseEvent("mousedown", opts));
  confirmBtn.dispatchEvent(new MouseEvent("mouseup", opts));
  confirmBtn.dispatchEvent(new MouseEvent("click", opts));
  await waitForPopupClose();
}

function findVisiblePopupIframes() {
  // id 패턴("...webEdt_utilizAprvCtnt_WebBrowser")은 팝업 인스턴스 번호(pop7/
  // pop8...)만 다르고 매번 같아서, 칸을 여러 개 연달아 채우면 이전에 닫힌
  // 팝업의 iframe이 DOM에서 완전히 제거되지 않고 남아있는 경우 querySelector
  // (첫 매치 하나만 반환)가 그 죽은 iframe을 집어서 계속 같은 칸에 잘못
  // 쓰는 버그가 있었다("목적만 채워지고 대상/진행절차는 안 채워짐" 리포트의
  // 원인으로 추정). getClientRects().length로 실제 화면에 렌더링된 것만
  // 걸러내고, 여러 개가 남아있어도 가장 나중에(=가장 최근에 연) 걸 쓴다.
  return [...document.querySelectorAll('iframe[id$="_webEdt_utilizAprvCtnt_WebBrowser"]')].filter(
    (el) => el.getClientRects().length > 0
  );
}

async function waitForSe2EditorBody() {
  const start = Date.now();
  while (Date.now() - start < SCREEN_LOAD_TIMEOUT_MS) {
    const visible = findVisiblePopupIframes();
    const outer = visible[visible.length - 1];
    const body = outer && drillToSe2Body(outer);
    if (body) return body;
    await sleep(POLL_INTERVAL_MS);
  }
  return null;
}

async function waitForPopupClose() {
  // 다음 행의 "내용입력" 버튼을 찾기 전에, 이번 팝업이 화면에서 완전히
  // 사라질 때까지 기다린다 — 안 그러면 아직 닫히는 중인 팝업 잔상 때문에
  // 다음 행 탐색이 꼬일 수 있음.
  const start = Date.now();
  while (Date.now() - start < SCREEN_LOAD_TIMEOUT_MS) {
    if (findVisiblePopupIframes().length === 0) return;
    await sleep(POLL_INTERVAL_MS);
  }
}

function drillToSe2Body(outerIframe) {
  try {
    const outerDoc = outerIframe.contentDocument;
    const formIframe = outerDoc?.querySelector("form iframe");
    const formDoc = formIframe?.contentDocument;
    const se2Iframe = formDoc?.getElementById("se2_iframe");
    const se2Doc = se2Iframe?.contentDocument;
    return se2Doc?.body || null;
  } catch (e) {
    return null; // 같은 origin이 아니거나 아직 안 실려있으면 여기서 걸러짐
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
