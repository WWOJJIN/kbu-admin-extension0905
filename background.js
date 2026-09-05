// extension/background.js
// Chrome 확장 핵심 로직 (Manifest V3 Service Worker). 지침 "Chrome 확장 동작 규칙" 참고.
// background.js가 핵심 로직 전부 담당하고, content.js는 보조/선택 (핵심 아님).
//
// ⚠️ 이 파일은 직접 로드되지 않는다. Chrome 확장은 자기 폴더(extension/) 밖의 경로
// (../src/lib/*)를 import할 수 없고, db.js가 쓰는 "idb" npm 패키지도 브라우저가
// 네이티브로 resolve 못 해서 그대로 로드하면 서비스워커가 즉시 죽는다(=아이콘 눌러도
// 아무 반응 없음, 실제로 겪은 버그).
// 그래서 esbuild로 이 파일 + 의존성(db.js/kisApi.js/claudeApi.js/idb)을 전부 한 파일로
// 번들링해서 extension/background.bundle.js를 만들고, manifest.json이 그 번들 파일을
// 로드한다. `npm run build`(또는 `npm run build:bg`)를 먼저 돌려야 최신 코드가 반영됨 —
// 이 파일만 수정하고 확장을 리로드해봤자 반영 안 됨.

import {
  upsertCoopDoc,
  getCoopDoc,
  getAllCoopDocIds,
  hasCoopDocStatusChanged,
  getAllApprovalItemIds,
  hasApprovalStatusChanged,
  upsertApprovalItem,
  getApprovalItem,
  getAllApprovalItems,
  getStatusChange,
  upsertStatusChange,
  getFeatureToggles,
  setFeatureEnabled,
  getAutoDetailFetchOnArrival,
} from "../src/lib/db.js";
import {
  fetchMyCoopDocList,
  fetchCoopDocDetail,
  extractDetailText,
  extractDetailHtml,
  fetchExpenseTravelList,
  fetchInternalDraftList,
  fetchApprovalPendingList,
  fetchStatusChangeList,
  fetchStatusChangeStages,
  RAW_TEXT_EXTRACT_VERSION,
  RECV_DEPT_SCHEMA_VERSION,
} from "../src/lib/kisApi.js";
import { parseCoopDoc } from "../src/lib/claudeApi.js";
import { fillParsedFallback } from "../src/lib/textUtils.js";

const POLL_ALARM_NAME = "coopDocPoll";
// 2026-08-23(6): 우진이 예전에 실사용하던 버전은 내부기안 상신 후 1분 이내로
// 알림이 왔다고 함 — chrome.alarms의 실질적 최소 주기(1분)로 맞춤(5분이었던
// 걸 1분으로 단축). MV3 alarms는 periodInMinutes가 1 미만이면 브라우저가
// 강제로 1분으로 올림 — 그래서 이보다 더 빠르게는 못 만듦.
const POLL_PERIOD_MINUTES = 1;

// ---------------------------------------------------------------------------
// 라이프사이클 — chrome.alarms로 1분 주기 실행
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  pollCoopDocs(); // 설치 직후 1회 즉시 실행 (기다리지 않고 바로 확인)
  pollApprovalStatus();
  pollStatusChanges();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    pollCoopDocs();
    // 2026-08-23(5): 결재현황(지출/출장, 내부기안, 지출출장결재하기) 폴링도
    // 같은 알람에 얹어서 같이 돈다 — 협조문/결재현황 모두 1분 주기로 동일하게
    // 돈다는 뜻. pollCoopDocs와 완전히 독립된 함수라 여기서 실패해도 협조문
    // 폴링에는 영향 없음 — pollApprovalStatus 내부에서 자체적으로 에러를 잡는다.
    pollApprovalStatus();
    // 4단계(kbu-assistant 이식): 학적변동대상자목록도 같은 알람에 얹는다.
    // 마찬가지로 완전히 독립된 함수라 실패해도 나머지 폴링에 영향 없음.
    pollStatusChanges();
  }
});

function setupAlarm() {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
}

// ---------------------------------------------------------------------------
// 아이콘 클릭 → 웹 UI 새 탭으로 열기
// ---------------------------------------------------------------------------
// ⚠️ manifest.json의 action에 default_popup을 넣지 않아야 이 리스너가 실제로
// 동작함(popup이 있으면 onClicked 자체가 안 붙음). 캘린더/문서함처럼 화면이
// 넓어야 하는 UI라 팝업 대신 새 탭 방식으로 결정함.
const APP_URL = chrome.runtime.getURL("dist/index.html");

chrome.action.onClicked.addListener(async () => {
  const existingTabs = await chrome.tabs.query({ url: `${APP_URL}*` });
  if (existingTabs.length > 0) {
    const tab = existingTabs[0];
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: APP_URL });
});

// ---------------------------------------------------------------------------
// 협조문수신함 폴링 파이프라인
// ---------------------------------------------------------------------------

/**
 * 목록 조회 결과를 저장된 스냅샷과 비교해서 신규/상태변경 항목을 나눈다.
 * chrome API에 의존하지 않는 순수 로직이라 단독으로 테스트 가능 (checkStatusChanged를
 * 주입받는 구조).
 * @param {Array<Object>} listItems  fetchCoopDocList() 결과 (aprvNo/subject/stGbn 등)
 * @param {Set<string>} existingIds  db.getAllCoopDocIds() 결과
 * @param {(id: string, latest: {stGbn?: string}) => Promise<boolean>} checkStatusChanged
 * @returns {Promise<{newItems: Object[], changedItems: Object[]}>}
 */
export async function diffCoopDocList(listItems, existingIds, checkStatusChanged) {
  const newItems = [];
  const changedItems = [];

  for (const item of listItems) {
    const id = item.aprvNo;
    if (!id) continue; // aprvNo 없는 방어적 케이스는 스킵

    if (!existingIds.has(id)) {
      newItems.push(item);
      continue;
    }

    const changed = await checkStatusChanged(id, { stGbn: item.stGbn });
    if (changed) changedItems.push(item);
  }

  return { newItems, changedItems };
}

// ---------------------------------------------------------------------------
// 폴링 기록 (chrome.storage.local) — 2026-08-19 실사용 중 "10시간 방치 후
// 로그아웃" 사례 발생. MV3 서비스워커는 유휴 시 죽었다 알람 때마다 다시 뜨는데,
// console 로그는 워커가 죽으면 사라져서 "밤사이 정확히 언제부터 폴링이 끊겼는지"를
// 사후에 확인할 방법이 없었다. chrome.storage.local은 워커 재시작과 무관하게
// 남아있으므로, 여기에 매 폴링 결과(성공/실패/세션만료여부)를 남겨서 다음에 같은
// 일이 생기면 타임라인을 실제로 확인할 수 있게 한다.
// ---------------------------------------------------------------------------

const POLL_LOG_KEY = "pollLog";
const POLL_LOG_MAX = 300; // 5분 주기 기준 약 25시간 분량
const SESSION_EXPIRED_NOTIFY_KEY = "lastSessionExpiredNotifyAt";
const SESSION_EXPIRED_NOTIFY_THROTTLE_MS = 30 * 60 * 1000; // 30분 — 세션 만료 알림 중복 방지
// ⚠️ 2026-08-23(11): "실제로는 로그인돼 있는데 세션 만료 알림이 뜬다" 리포트로
// 추가. postDataset이 0.8초 텀을 두고 1번 재시도까지 하는데도 이게 뜬다는 건,
// ERP가 순간적으로(수 초 이상) 이상 응답을 주는 케이스가 있다는 뜻 — 그렇다고
// 바로 "세션 만료"로 단정하면 오탐이 잦다. 그래서 폴링 자체(1분 주기) 레벨에서
// 한 번 더 완충한다: 연속으로 COOP_FAIL_STREAK_THRESHOLD번 실패해야만(=최소
// 2분 이상 계속 실패) 진짜 세션 만료로 보고 알림을 띄운다. 한 번 성공하면
// 스트릭은 0으로 리셋됨 — 매번 계속 실패해야 알림이 뜨므로, 실제 로그아웃
// 상태를 놓치지는 않는다.
const COOP_FAIL_STREAK_KEY = "coopPollFailStreak";
const COOP_FAIL_STREAK_THRESHOLD = 2;

async function appendPollLog(entry) {
  try {
    const { [POLL_LOG_KEY]: existing = [] } = await chrome.storage.local.get(POLL_LOG_KEY);
    const next = [...existing, { ts: Date.now(), ...entry }].slice(-POLL_LOG_MAX);
    await chrome.storage.local.set({ [POLL_LOG_KEY]: next });
  } catch (err) {
    console.warn("[background] 폴링 로그 저장 실패:", err);
  }
}

/**
 * 세션 만료로 폴링이 중단됐을 때 OS 알림. 5분마다 계속 뜨면 스팸이 되니
 * 30분에 한 번만 알리도록 throttle.
 */
async function notifySessionExpiredThrottled() {
  try {
    const { [SESSION_EXPIRED_NOTIFY_KEY]: last = 0 } = await chrome.storage.local.get(
      SESSION_EXPIRED_NOTIFY_KEY
    );
    const now = Date.now();
    if (now - last < SESSION_EXPIRED_NOTIFY_THROTTLE_MS) return;
    await chrome.storage.local.set({ [SESSION_EXPIRED_NOTIFY_KEY]: now });
    chrome.notifications.create(`session-expired-${now}`, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title: "ERP 로그인 세션 만료",
      message: "협조문 자동 조회가 중단됐습니다. kis.kbu.ac.kr에 다시 로그인해주세요.",
      priority: 2,
    });
  } catch (err) {
    console.warn("[background] 세션 만료 알림 실패:", err);
  }
}

/**
 * 1분마다(또는 설치 직후) 실행되는 협조문수신함 폴링 사이클.
 * ⚠️ 2026-08-23(7): "전사문서열람 하지 말고 협조문수신함에 나에게 온 것만"
 * 요청으로, fetchCoopDocListAllDepts() 대신 fetchMyCoopDocList()를 쓴다.
 * 네트워크 요청은 여전히 1번만 보내되(부서별 순회 호출로 돌아가지 않음 —
 * 예전에 그 방식이 "요청 6개 중 하나만 삐끗해도 세션 만료로 오판"하는
 * 문제를 냈었다), 응답을 협조문수신함 화면의 "부서" 드롭다운과 같은 소스
 * (fetchPersOfrdDeptList, 내 소속 부서 목록)로 클라이언트에서 걸러서 내
 * 소속 부서로 온 문서만 새 문서/알림 판단에 포함시킨다. 자세한 이유는
 * kisApi.js의 fetchMyCoopDocList 주석 참고.
 */
export async function pollCoopDocs() {
  let listItems;
  try {
    listItems = await fetchMyCoopDocList();
  } catch (err) {
    const sessionExpired = err.code === "SESSION_EXPIRED_OR_UNEXPECTED_RESPONSE";
    console.error("[background] 협조문수신함 목록 조회 실패:", err);
    // responseSnippet도 같이 남겨서, 다음에 또 이 문제가 생기면 콘솔을 그
    // 순간에 못 봤어도 pollLog(chrome.storage.local)만 열어봐도 ERP가 실제로
    // 어떤 응답을 줬는지 확인할 수 있게 한다.
    await appendPollLog({
      ok: false,
      sessionExpired,
      error: String(err.message || err),
      responseSnippet: err.responseSnippet || null,
    });

    if (sessionExpired) {
      const { [COOP_FAIL_STREAK_KEY]: streak = 0 } = await chrome.storage.local.get(COOP_FAIL_STREAK_KEY);
      const nextStreak = streak + 1;
      await chrome.storage.local.set({ [COOP_FAIL_STREAK_KEY]: nextStreak });
      if (nextStreak >= COOP_FAIL_STREAK_THRESHOLD) {
        await notifySessionExpiredThrottled();
      }
    }
    return;
  }

  // 이번 폴링은 성공했으니 실패 스트릭 리셋 (실패가 계속 이어질 때만 알림이
  // 뜨게 하려는 목적이므로, 한 번이라도 성공하면 처음부터 다시 셈).
  await chrome.storage.local.set({ [COOP_FAIL_STREAK_KEY]: 0 });

  await appendPollLog({ ok: true, count: listItems.length });

  const existingIds = await getAllCoopDocIds();
  const { newItems, changedItems } = await diffCoopDocList(
    listItems,
    existingIds,
    hasCoopDocStatusChanged
  );

  // 2026-09-02: 서비스워커 콘솔(chrome://extensions → 서비스 워커)을 열었을 때
  // "폴링이 살아있긴 한지, 몇 건이나 보고 있는지"를 바로 확인할 수 있는 로그가
  // 전혀 없었다(성공 시엔 pollLog(storage)에만 조용히 남고 console에는 아무것도
  // 안 찍힘) — 매번 pollLog를 storage에서 꺼내보지 않고도 콘솔만 봐도 알 수
  // 있게 한 줄 남긴다.
  console.log(
    `[background] 협조문수신함 폴링: 총 ${listItems.length}건 (신규 ${newItems.length}, 상태변경 ${changedItems.length})`
  );

  for (const item of newItems) {
    await handleNewCoopDoc(item);
  }
  for (const item of changedItems) {
    await handleChangedCoopDoc(item);
  }
}

// ---------------------------------------------------------------------------
// 결재현황(지출/출장, 내부기안, 지출출장결재하기) 폴링 — 2026-08-23(5) 추가,
// 2026-08-23(6)에 지출출장결재하기(aprvMngList) + aprvLevel/lastAprvUser
// 비교 + 리마인더 추가.
// ⚠️ ENDPOINTS.expenseTravelList/internalDraftList의 menuId/pgmId가 아직
// 실측 검증 전(TODO, kisApi.js 참고)이라 이 두 화면은 지금 실패할 가능성이
// 있다. 실패해도 콘솔 경고만 남기고 조용히 종료 — 협조문 폴링에 영향 안
// 주려고 완전히 분리된 함수로 둠. menuId/pgmId만 채워지면 나머지 diff/알림
// 로직은 그대로 동작한다. aprvMngList는 별도 프로토타입에서 이미 실측
// 확인된 값을 쓰므로 정상 동작할 것으로 예상됨.
//
// stGbn/lastStGbn/workStgCd 코드값이 정확히 뭘 뜻하는지는 아직 모르지만,
// coopDocs의 hasCoopDocStatusChanged와 똑같은 방식으로 "값이 바뀌었다"는
// 사실만으로 알림을 띄운다 — 의미를 몰라도 변경 감지 자체는 가능함.
// aprvLevel/lastAprvUser(실제 결재자)도 coopDocs와 동일한 이유로 같이 본다:
// workStgCd만으로는 같은 건 안에서 결재자가 바뀌어도 감지 못 하는 경우가 있음.
// ---------------------------------------------------------------------------

const APPROVAL_SOURCES = [
  { key: "expense", label: "지출/출장결재현황", fetch: () => fetchExpenseTravelList() },
  { key: "internal", label: "내부기안결재현황", fetch: () => fetchInternalDraftList() },
  // stGbn="02" = 진행(결재 대기중) — 나에게 결재 요청이 온 것 중 아직 안
  // 끝난 것만 본다. remindDaily: 처리 안 된 건 매일 REMIND_HOURS에 재알림.
  { key: "aprvMng", label: "지출출장결재하기", fetch: () => fetchApprovalPendingList({ stGbn: "02" }), remindDaily: true },
];

// 리마인드 알림을 매일 보낼 시각들 (로컬 시간 기준, 24시간제). 지출출장결재
// 하기(aprvMng) 항목 중 아직 처리 안 된 게 있으면 매일 이 시각마다 재알림.
const REMIND_HOURS = [10, 14, 16];

function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 결재현황 3종(지출/출장, 내부기안, 지출출장결재하기)을 폴링한다. 각 화면은
 * Promise.allSettled로 서로 독립적으로 처리 — 하나가 실패해도(menuId/pgmId
 * 미검증 등) 나머지는 정상 진행된다.
 */
export async function pollApprovalStatus() {
  const results = await Promise.allSettled(
    APPROVAL_SOURCES.map((src) =>
      src.fetch().then((rows) => (rows || []).map((r) => ({ ...r, _source: src.key })))
    )
  );

  results.forEach((res, i) => {
    if (res.status === "rejected") {
      console.warn(
        `[background] ${APPROVAL_SOURCES[i].label} 조회 실패(menuId/pgmId 미검증일 수 있음):`,
        res.reason
      );
    }
  });

  const bySource = new Map();
  results.forEach((res, i) => {
    if (res.status === "fulfilled") bySource.set(APPROVAL_SOURCES[i].key, res.value);
  });
  if (bySource.size === 0) return; // 전부 실패했으면 더 할 게 없음

  // 2026-09-02: pollCoopDocs와 동일한 이유로, 결재현황 3종도 화면별 건수를
  // 콘솔에 바로 찍어서(예: "지출/출장결재현황: 3건, 내부기안결재현황: 5건")
  // 서비스워커 콘솔만 열어봐도 지금 뭘 몇 건 보고 있는지 알 수 있게 한다.
  console.log(
    "[background] 결재현황 폴링: " +
      APPROVAL_SOURCES.map((src) => `${src.label} ${bySource.get(src.key)?.length ?? "실패"}건`).join(", ")
  );

  const existingIds = await getAllApprovalItemIds();

  for (const src of APPROVAL_SOURCES) {
    const items = bySource.get(src.key);
    if (!items) continue; // 이 화면만 실패한 경우

    for (const item of items) {
      const id = item.aprvNo;
      if (!id) continue;

      const draftTimestamp = item.draftDt ? new Date(item.draftDt).getTime() : null;
      const existing = existingIds.has(id) ? await getApprovalItem(id) : null;
      const firstSeenAt =
        (draftTimestamp && !Number.isNaN(draftTimestamp)) ? draftTimestamp : (existing?.firstSeenAt || Date.now());
      const aprvLevel = item.aprvLevel || "";
      const lastAprvUser = item.lastAprvUser || "";

      if (!existingIds.has(id)) {
        notifyNewApprovalItem(src.label, item);
      } else {
        const changed = await hasApprovalStatusChanged(id, {
          stGbn: item.stGbn,
          lastStGbn: item.lastStGbn,
          workStgCd: item.workStgCd,
          aprvLevel,
          lastAprvUser,
        });
        if (changed) {
          notifyApprovalStatusChanged(src.label, item, {
            fromStage: existing?.aprvLevel || "",
            toStage: aprvLevel,
          });
        }
      }

      await upsertApprovalItem({
        id,
        source: src.key,
        subject: item.subject || "",
        deptNm: item.deptNm || "",
        stGbn: item.stGbn,
        lastStGbn: item.lastStGbn,
        workStgCd: item.workStgCd,
        aprvLevel,
        lastAprvUser,
        firstSeenAt,
        sentReminders: existing?.sentReminders || [],
        created_at: existing?.created_at || Date.now(),
      });
    }
  }

  await checkApprovalReminders();
}

function notifyNewApprovalItem(label, item) {
  chrome.notifications.create(`approval-new-${item.aprvNo}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: `새 ${label} 문서`,
    message: item.subject || `새 ${label} 문서가 등록됐습니다.`,
    priority: 1,
  });
}

function notifyApprovalStatusChanged(label, item, stageChange) {
  const subjectLine = item.subject || label;
  let detailLine = "";
  if (stageChange?.fromStage && stageChange?.toStage && stageChange.fromStage !== stageChange.toStage) {
    // 결재단계(현재 결재자)가 실제로 바뀐 경우: "김양진 결재중 → 정계동 결재중" 처럼 표시
    detailLine = `${stageChange.fromStage} → ${stageChange.toStage}`;
  }
  chrome.notifications.create(`approval-status-${item.aprvNo}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: `${label} 상태 변경`,
    message: detailLine ? `${subjectLine}\n${detailLine}` : `${subjectLine} 상태가 변경되었습니다.`,
    priority: 1,
  });
}

/**
 * 지출출장결재하기(aprvMng, 나에게 결재 요청이 온 것) 중 아직 처리 안 된
 * 건을 기안 "다음날"부터 매일 REMIND_HOURS(10/14/16시)에 리마인드한다.
 * - 이미 처리(결재완료)돼서 최신 목록에 더 이상 안 잡히는 항목은 자연스럽게
 *   리마인드 대상에서 빠진다(이 함수는 approvalItems에 저장된 aprvMng
 *   항목을 순회하는데, pollApprovalStatus가 매번 최신 목록으로만 upsert
 *   하므로 처리된 건은 갱신이 멈추고 결국 리마인드도 안 남).
 * - 같은 날 같은 시각 슬롯엔 한 번만 보냄 (sentReminders에 기록).
 */
async function checkApprovalReminders() {
  const pendingItems = await getAllApprovalItems("aprvMng");
  const now = new Date();
  const todayKey = dateKey(now);

  for (const item of pendingItems) {
    if (!item.firstSeenAt) continue;
    const draftDate = new Date(item.firstSeenAt);
    const remindStart = new Date(draftDate);
    remindStart.setDate(remindStart.getDate() + 1);
    remindStart.setHours(0, 0, 0, 0);
    if (now < remindStart) continue; // 기안 다음날이 아직 안 됨

    const sentReminders = item.sentReminders || [];
    let updated = false;

    for (const hour of REMIND_HOURS) {
      const slotKey = `${todayKey}_${hour}`;
      if (sentReminders.includes(slotKey)) continue;

      const triggerTime = new Date(now);
      triggerTime.setHours(hour, 0, 0, 0);
      if (now < triggerTime) continue; // 아직 그 시각 안 됨

      chrome.notifications.create(`approval-remind-${item.id}-${slotKey}`, {
        type: "basic",
        iconUrl: NOTIFICATION_ICON,
        title: "지출출장결재하기 — 아직 처리 안 됨",
        message: `${item.subject || item.id} — 결재 대기 중입니다. (${hour}시 리마인드)`,
        priority: 1,
      });
      sentReminders.push(slotKey);
      updated = true;
    }

    if (updated) {
      await upsertApprovalItem({ ...item, sentReminders });
    }
  }
}

// ---------------------------------------------------------------------------
// 학적변동대상자목록 폴링 (4단계, kbu-assistant runStatusChangeSync 이식).
// ⚠️ ENDPOINTS.statusChangeList/statusChangeStages의 menuId/pgmId는 kbu
// 계정에서 실측된 값 — 이 프로젝트(admin) 계정에서 권한이 없어 실패하면
// (예: 학적 담당이 아닌 부서 계정) 아래에서 자동으로 기능 토글을 꺼서
// 반복 실패 알림/로그가 안 쌓이게 한다. 설정 탭에서 다시 켤 수 있다.
// ---------------------------------------------------------------------------

const MAX_STATUS_ROWS_PER_SYNC = 20;
// 2026-09-02(3): 2 → 반려 사유가 실제로 어느 컬럼에 오는지 아직 확인이 안 돼서
// (findSrhregModAccpStgList.do 응답 스키마 미검증 — 아래 stages 매핑 주석
// 참고), 우선 원본 행 전체를 저장해서 나중에 필드명이 뭔지 확인되면 화면에
// 바로 꺼내 쓸 수 있게 해뒀다. 버전을 올려서 이미 캐시된 학적변동 항목도
// 다음 폴링에서 상세를 다시 조회해 원본 전체를 채우도록 함.
const STATUS_SCHEMA_VERSION = 2;

function statusChangeKey(row) {
  return `SREG-${row.stuno}-${row.schregModAplyDt}-${row.schregModGbn}`;
}

/**
 * 학적변동대상자목록을 폴링해서 신규 신청/승인 단계 변경을 감지하고 알림을 띄운다.
 * @returns {Promise<{total: number, processed: number, newCount: number, changedCount: number, skipped?: boolean, autoDisabled?: boolean}>}
 */
export async function pollStatusChanges() {
  const toggles = await getFeatureToggles();
  if (!toggles.status) {
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, skipped: true };
  }

  let listRows;
  try {
    listRows = await fetchStatusChangeList();
  } catch (err) {
    console.warn(
      "[background] 학적변동대상자목록 조회 실패 — 권한이 없을 수 있어 자동으로 껐습니다(설정 탭에서 다시 켤 수 있음):",
      err
    );
    await setFeatureEnabled("status", false);
    chrome.notifications.create("status-auto-disabled", {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title: "학적변동대상자목록 기능 자동 비활성화",
      message: "조회 권한이 없는 것 같아 자동으로 껐습니다. 필요하면 설정 탭에서 다시 켤 수 있어요.",
      priority: 1,
    });
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, autoDisabled: true };
  }

  const rows = (listRows || [])
    .filter((r) => r.stuno)
    .slice()
    .sort((a, b) => (b.schregModAplyDt || "").localeCompare(a.schregModAplyDt || ""))
    .slice(0, MAX_STATUS_ROWS_PER_SYNC);

  let newCount = 0;
  let changedCount = 0;

  for (const row of rows) {
    const key = statusChangeKey(row);
    const prev = await getStatusChange(key);
    const changed = !prev || prev.accpCnt !== row.accpCnt || prev.schemaVersion !== STATUS_SCHEMA_VERSION;
    if (!changed) continue;

    // 승인 단계별 현황 (학과조교/지도교수/학과장/최종승인부서 등)
    let stages = prev ? prev.stages || [] : [];
    try {
      const stageRows = await fetchStatusChangeStages(row.stuno, row.schregModAplyDt, row.schregModGbn);
      // ⚠️ 2026-09-02(3): "반려 사유를 볼 수 있냐"는 질문에 답하려고 보니,
      // 지금까지는 응답 행에서 딱 3개 필드(accpObjGbnNm/accpGbnNm/empNm)만
      // 뽑아 쓰고 나머지는 그냥 버리고 있었다 — 반려 사유 같은 필드가 응답에
      // 실제로 있는지조차 코드만 봐서는 알 수 없는 상태였음(이 엔드포인트
      // 자체가 위 함수 주석에 "미검증"이라고 적혀있던 것과 같은 맥락).
      // 원본 행 전체를 같이 저장해두면, 반려된 건을 하나 열어서 stages[].raw를
      // 콘솔에 찍어보는 것만으로 실제 필드명을 바로 확인할 수 있다 — 반려
      // 사유가 있다면 그 필드명을 알아낸 뒤 위 화면에 정식으로 노출하면 됨.
      stages = (stageRows || []).map((s) => ({
        accpObjGbnNm: s.accpObjGbnNm || "",
        accpGbnNm: s.accpGbnNm || "",
        empNm: s.empNm || "",
        raw: s, // 원본 행 전체 (반려 사유 등 아직 못 찾은 필드가 여기 들어있을 수 있음)
      }));
    } catch (err) {
      console.warn("[background] 학적변동 승인단계 조회 실패:", key, err);
    }

    const doc = {
      id: key,
      stuno: row.stuno || "",
      stdKorNm: row.stdKorNm || "",
      deptNm: row.deptNm || "",
      schregModDeptNm: row.schregModDeptNm || "",
      schregModGbnNm: row.schregModGbnNm || "",
      schregModResnGbnNm: row.schregModResnGbnNm || "",
      schregModDetaResnGbnNm: row.schregModDetaResnGbnNm || "",
      schregModAplyDt: row.schregModAplyDt || "",
      hy: row.hy || "",
      class: row.class || "",
      tutorNm: row.tutorNm || "",
      accpCnt: row.accpCnt || "",
      attachNm: row.attachNm || "",
      stages,
      schemaVersion: STATUS_SCHEMA_VERSION,
      created_at: prev?.created_at || Date.now(),
    };

    // 단계별로 뭐가 바뀌었는지 비교해서, 바뀐 단계마다 개별 알림
    if (prev && prev.stages) {
      for (const stage of stages) {
        const prevStage = prev.stages.find((s) => s.accpObjGbnNm === stage.accpObjGbnNm);
        if (prevStage && prevStage.accpGbnNm !== stage.accpGbnNm) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: NOTIFICATION_ICON,
            title: "학적변동 승인 진행",
            message: `${doc.stdKorNm}(${doc.stuno}) · ${doc.schregModGbnNm} · ${stage.accpObjGbnNm}: ${prevStage.accpGbnNm} → ${stage.accpGbnNm}`,
            priority: 1,
          });
        }
      }
    }

    await upsertStatusChange(doc);
    if (!prev) {
      newCount++;
      chrome.notifications.create({
        type: "basic",
        iconUrl: NOTIFICATION_ICON,
        title: "새 학적변동 신청",
        message: `${doc.stdKorNm}(${doc.stuno}) · ${doc.schregModGbnNm} · ${doc.deptNm}`,
        priority: 1,
      });
    } else {
      changedCount++;
    }
  }

  return { total: listRows.length, processed: rows.length, newCount, changedCount };
}

/**
 * 목록 API의 날짜 필드를 항상 "YYYY-MM-DD" 형태로 정규화한다.
 * draftCharDt는 이미 이 형태로 오지만, 없는 경우 draftDt(YYYYMMDDHHmmssSSS)에서
 * 앞 8자리를 잘라 변환한다. db.js의 getAllCoopDocs 최신순 정렬이 문자열 비교에
 * 의존하므로 형식이 섞이면 정렬이 어긋난다 — 반드시 이 함수를 거쳐서 저장할 것.
 * @param {Object} item
 * @returns {string} "YYYY-MM-DD" or ""
 */
function normalizeDocDate(item) {
  if (item.draftCharDt) return item.draftCharDt;
  if (item.draftDt && item.draftDt.length >= 8) {
    const y = item.draftDt.slice(0, 4);
    const m = item.draftDt.slice(4, 6);
    const d = item.draftDt.slice(6, 8);
    return `${y}-${m}-${d}`;
  }
  return "";
}

/**
 * 신규 협조문 처리: (설정에 따라) 상세 조회 → 리치텍스트 디코딩 → AI 파싱 →
 * IndexedDB 저장 → 알림.
 * @param {Object} item  목록 API의 raw record
 */
async function handleNewCoopDoc(item) {
  const aprvNo = item.aprvNo;

  // 상세 조회 실패 시를 대비해 목록에서 얻을 수 있는 값으로 폴백
  let rawText = item.ctnt ?? item.subject ?? "";
  let rawHtml = "";
  // detail 응답을 실제로 받아서 ctnt1~8을 확인해본 경우에만 raw_text_version/
  // body_unavailable을 확정한다 — 조회 자체가 실패(네트워크 에러 등)했으면 아직
  // "확인 안 됨" 상태로 두고, openDetail의 라이브 재조회가 나중에 다시 시도하게
  // 한다(여기서 섣불리 body_unavailable=true로 찍으면 영영 재시도 안 됨).
  let bodyUnavailable = undefined;
  let rawTextVersion = undefined;
  let parsed = null;

  // ⚠️ 2026-09-02 추가: findIntAprvDtlList.do(상세 조회)는 ERP 화면에서 문서를
  // 클릭해 열 때 쓰는 API와 동일하다 — 실사용 리포트로, 백그라운드 폴링이
  // 새 문서를 감지하자마자 이걸 자동 호출하는 것만으로 사용자가 ERP에서 직접
  // 열람하지 않았는데도 협조문수신함의 "열람" 컬럼이 Y로 바뀌는 부작용이
  // 확인됨(정황: 아직 폴링이 안 돈 최신 문서만 열람 공백, 그 이전 문서는
  // 전부 Y). 그래서 기본값은 "자동 조회 안 함"이고, 이 경우 상세/AI요약은
  // useStore.js openDetail의 라이브 재조회 로직이 사용자가 실제로 우리 앱에서
  // 문서를 열 때 가져온다(그 시점엔 ERP 열람 처리가 되는 게 오히려 정상 —
  // 실제로 확인한 시점과 일치하므로). 설정 탭에서 다시 켤 수 있음.
  const autoFetch = await getAutoDetailFetchOnArrival();
  if (!autoFetch) {
    await upsertCoopDoc(buildCoopDocRecord(item, { rawText, rawHtml, bodyUnavailable, rawTextVersion, parsed }));
    notifyNewCoopDoc(item);
    return;
  }

  try {
    const detailRows = await fetchCoopDocDetail({ aprvNo });
    const detail = detailRows[0];
    if (detail) {
      // 2026-08-19 실측 완료: ctnt1~ctnt8 중 값 있는 필드를 전부 이어붙여야
      // 문서 전체가 나온다(예: ctnt3=본문, ctnt4=제출안내로 나뉘는 경우 실측
      // 확인됨). extractDetailText가 원본 HTML 우선 + 다중 필드 병합을 처리.
      const extracted = extractDetailText(detail);
      if (extracted) {
        rawText = extracted;
        rawHtml = extractDetailHtml(detail); // 표를 실제 <table>로 보여주기 위한 정제 HTML
        bodyUnavailable = false;
      } else {
        // ctnt1~8이 응답에 아예 없는 문서(공문 서식형, report_server.jsp가
        // 이미지로 렌더링하는 타입 — 2026-08-22 실측 확인) — useStore.js의 동일
        // 로직 참고. ⚠️ rawText를 위에서 item.subject로 폴백해뒀는데, 여기서
        // "" 로 다시 안 비우면 raw_text에 제목이 그대로 남아서, 모달의
        // `doc.raw_text || (body_unavailable ? 안내문구 : ...)` 순서상 안내
        // 문구 대신 제목만 반복 표시되는 버그가 있었음(실사용 중 발견 — 상세
        // 팝업에 "이 문서는 공문 서식이라 미리보기 지원 안 함" 대신 제목만 뜸).
        bodyUnavailable = true;
        rawText = "";
      }
      rawTextVersion = RAW_TEXT_EXTRACT_VERSION;
    }
  } catch (err) {
    console.warn(`[background] 협조문 상세 조회 실패 (aprvNo=${aprvNo}), 목록 정보로 대체:`, err);
  }

  try {
    parsed = await parseCoopDoc(rawText);
  } catch (err) {
    // 프록시 미배포 상태에서는 항상 여기로 옴 — 정상. ERP 원문은 그래도 저장한다.
    console.error(`[background] AI 파싱 실패 (aprvNo=${aprvNo}):`, err);
  }

  await upsertCoopDoc(buildCoopDocRecord(item, { rawText, rawHtml, bodyUnavailable, rawTextVersion, parsed }));
  notifyNewCoopDoc(item);
}

/**
 * IndexedDB에 저장할 CoopDoc 레코드를 조립한다. 상세를 자동 조회했든(autoFetch)
 * 안 했든(목록 정보만 있는 상태) 공통으로 쓰는 조립 로직 — 두 경로가 갈라지면서
 * 필드 목록이 따로 놀아 나중에 하나만 고치고 잊어버리는 사고를 막기 위해 분리함.
 * @param {Object} item  목록 API의 raw record
 * @param {{rawText: string, rawHtml: string, bodyUnavailable: boolean|undefined, rawTextVersion: number|undefined, parsed: Object|null}} extracted
 */
function buildCoopDocRecord(item, { rawText, rawHtml, bodyUnavailable, rawTextVersion, parsed }) {
  // 3단계(kbu textUtils.js 이식): AI 파싱이 실패/미배포/미실행이라
  // deadline·requires_action이 비어있으면 정규식/키워드 기반 규칙으로 1차
  // 후보값을 채운다. AI 값이 있으면 그 값을 그대로 쓰고(폴백은 덮어쓰지 않음).
  // ⚠️ 상세를 자동 조회 안 하는 경로(autoFetch=false)에서는 rawText가 제목
  // 한 줄뿐이라 폴백 정확도가 낮을 수 있음 — 사용자가 앱에서 문서를 열면
  // useStore.js openDetail이 본문 기준으로 다시 계산해서 갱신한다.
  const fallback = fillParsedFallback(parsed, rawText);

  return {
    id: item.aprvNo,
    title: parsed?.title || item.subject || "",
    sender_dept: parsed?.sender_dept || item.deptNm || "",
    // 2026-08-19: 목록 API 응답에 기안자 이름(draftEmpNm)도 이미 들어있었는데
    // 그동안 안 쓰고 버리고 있었음 — 저장하도록 추가.
    drafter: item.draftEmpNm || "",
    date: normalizeDocDate(item),
    raw_text: rawText,
    raw_html: rawHtml,
    body_unavailable: bodyUnavailable,
    raw_text_version: rawTextVersion,
    ai_summary: parsed?.summary || "",
    deadline: fallback.deadline,
    requires_action: fallback.requires_action,
    // 규칙 기반 값인지 AI 값인지 UI에서 구분하고 싶을 때 참고용 플래그
    // ("AI요약" 라벨과 마찬가지로 사용자에게 출처를 숨기지 않기 위함).
    deadline_is_fallback: parsed?.deadline == null,
    requires_action_is_fallback: parsed?.requires_action == null,
    action_description: parsed?.action_description ?? null,
    is_new: true,
    is_completed: false,
    calendar_registered: false,
    // 2026-08-21 정정: attachments 스텁 대신 attachNo만 저장 — 실제 파일 목록은
    // 상세 팝업을 열 때 kisApi.js fetchAttachments(attachNo)로 라이브 조회함
    // (팀원 실측으로 findFileDetailList.do + attachNo가 맞는 조합임을 확인).
    attachNo: item.attachNo || null,
    // ⚠️ 2026-08-22 정정: "어느 docDeptCd로 조회했는지"가 아니라 응답 Row
    // 자체의 rcvDeptCd/rcvDeptNm("수신부서" 컬럼, 실측 확인)을 그대로 씀 —
    // 부서 드롭다운이 실제로는 목록을 필터링하지 않는다는 게 밝혀졌음.
    recv_dept_code: item.rcvDeptCd || null,
    recv_dept_name: item.rcvDeptNm || null,
    recv_dept_version: RECV_DEPT_SCHEMA_VERSION,
    created_at: Date.now(),
    stGbn: item.stGbn,
  };
}

/**
 * 기존 협조문의 결재 상태(stGbn) 변경 처리: 저장값 갱신 + 알림.
 * @param {Object} item
 */
async function handleChangedCoopDoc(item) {
  const existing = await getCoopDoc(item.aprvNo);
  if (!existing) return; // 방어: diff 시점과 저장 시점 사이 삭제된 경우

  await upsertCoopDoc({
    ...existing,
    stGbn: item.stGbn,
    // drafter/attachNo/recv_dept 필드 추가 전에 저장된 옛날 문서는 상태 변경
    // 시점에 자연스럽게 보정됨. recv_dept는 항상 최신 rcvDeptCd/rcvDeptNm로
    // 덮어쓴다(예전엔 existing 값 있으면 안 건드렸는데, 예전 값이 잘못된 로직
    // 으로 채워졌을 수 있어서 — 2026-08-22 버그 수정 이후엔 매번 최신화).
    drafter: existing.drafter || item.draftEmpNm || "",
    attachNo: existing.attachNo ?? (item.attachNo || null),
    recv_dept_code: item.rcvDeptCd || existing.recv_dept_code || null,
    recv_dept_name: item.rcvDeptNm || existing.recv_dept_name || null,
    recv_dept_version: RECV_DEPT_SCHEMA_VERSION,
  });
  notifyStatusChanged(item);
}

// ---------------------------------------------------------------------------
// 알림 (OS 네이티브). 상단 배너 토스트/벨 드롭다운은 React UI(Navbar)가
// IndexedDB의 is_new/변경 이력을 읽어서 그림 — background.js는 OS 알림만 책임진다.
// ---------------------------------------------------------------------------

// TODO: extension/icons/icon128.png 실제 아이콘 파일 추가 필요. 없으면
// chrome.notifications.create가 조용히 실패할 수 있음.
const NOTIFICATION_ICON = "icons/icon128.png";

function notifyNewCoopDoc(item) {
  chrome.notifications.create(`coop-new-${item.aprvNo}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: "새 협조문 도착",
    message: item.subject || "새 협조문이 도착했습니다.",
    priority: 1,
  });
}

function notifyStatusChanged(item) {
  chrome.notifications.create(`coop-status-${item.aprvNo}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: "결재 상태 변경",
    message: `${item.subject || "협조문"} 상태가 변경되었습니다.`,
    priority: 1,
  });
}
