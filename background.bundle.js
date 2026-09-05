// node_modules/idb/build/index.js
var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
var idbProxyableTypes;
var cursorAdvanceMethods;
function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    IDBTransaction
  ]);
}
function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [
    IDBCursor.prototype.advance,
    IDBCursor.prototype.continue,
    IDBCursor.prototype.continuePrimaryKey
  ]);
}
var transactionDoneMap = /* @__PURE__ */ new WeakMap();
var transformCache = /* @__PURE__ */ new WeakMap();
var reverseTransformCache = /* @__PURE__ */ new WeakMap();
function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", success);
      request.removeEventListener("error", error);
    };
    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };
    const error = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener("success", success);
    request.addEventListener("error", error);
  });
  reverseTransformCache.set(promise, request);
  return promise;
}
function cacheDonePromiseForTransaction(tx) {
  if (transactionDoneMap.has(tx))
    return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener("complete", complete);
      tx.removeEventListener("error", error);
      tx.removeEventListener("abort", error);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error = () => {
      reject(tx.error || new DOMException("AbortError", "AbortError"));
      unlisten();
    };
    tx.addEventListener("complete", complete);
    tx.addEventListener("error", error);
    tx.addEventListener("abort", error);
  });
  transactionDoneMap.set(tx, done);
}
var idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      if (prop === "done")
        return transactionDoneMap.get(target);
      if (prop === "store") {
        return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    }
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
      return true;
    }
    return prop in target;
  }
};
function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
  if (getCursorAdvanceMethods().includes(func)) {
    return function(...args) {
      func.apply(unwrap(this), args);
      return wrap(this.request);
    };
  }
  return function(...args) {
    return wrap(func.apply(unwrap(this), args));
  };
}
function transformCachableValue(value) {
  if (typeof value === "function")
    return wrapFunction(value);
  if (value instanceof IDBTransaction)
    cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);
  return value;
}
function wrap(value) {
  if (value instanceof IDBRequest)
    return promisifyRequest(value);
  if (transformCache.has(value))
    return transformCache.get(value);
  const newValue = transformCachableValue(value);
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }
  return newValue;
}
var unwrap = (value) => reverseTransformCache.get(value);
function openDB(name, version, { blocked, upgrade, blocking, terminated } = {}) {
  const request = indexedDB.open(name, version);
  const openPromise = wrap(request);
  if (upgrade) {
    request.addEventListener("upgradeneeded", (event) => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
    });
  }
  if (blocked) {
    request.addEventListener("blocked", (event) => blocked(
      // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
      event.oldVersion,
      event.newVersion,
      event
    ));
  }
  openPromise.then((db) => {
    if (terminated)
      db.addEventListener("close", () => terminated());
    if (blocking) {
      db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
    }
  }).catch(() => {
  });
  return openPromise;
}
var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
var writeMethods = ["put", "add", "delete", "clear"];
var cachedMethods = /* @__PURE__ */ new Map();
function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
    return;
  }
  if (cachedMethods.get(prop))
    return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, "");
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);
  if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
  ) {
    return;
  }
  const method = async function(storeName, ...args) {
    const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
    let target2 = tx.store;
    if (useIndex)
      target2 = target2.index(args.shift());
    return (await Promise.all([
      target2[targetFuncName](...args),
      isWrite && tx.done
    ]))[0];
  };
  cachedMethods.set(prop, method);
  return method;
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));
var advanceMethodProps = ["continue", "continuePrimaryKey", "advance"];
var methodMap = {};
var advanceResults = /* @__PURE__ */ new WeakMap();
var ittrProxiedCursorToOriginalProxy = /* @__PURE__ */ new WeakMap();
var cursorIteratorTraps = {
  get(target, prop) {
    if (!advanceMethodProps.includes(prop))
      return target[prop];
    let cachedFunc = methodMap[prop];
    if (!cachedFunc) {
      cachedFunc = methodMap[prop] = function(...args) {
        advanceResults.set(this, ittrProxiedCursorToOriginalProxy.get(this)[prop](...args));
      };
    }
    return cachedFunc;
  }
};
async function* iterate(...args) {
  let cursor = this;
  if (!(cursor instanceof IDBCursor)) {
    cursor = await cursor.openCursor(...args);
  }
  if (!cursor)
    return;
  cursor = cursor;
  const proxiedCursor = new Proxy(cursor, cursorIteratorTraps);
  ittrProxiedCursorToOriginalProxy.set(proxiedCursor, cursor);
  reverseTransformCache.set(proxiedCursor, unwrap(cursor));
  while (cursor) {
    yield proxiedCursor;
    cursor = await (advanceResults.get(proxiedCursor) || cursor.continue());
    advanceResults.delete(proxiedCursor);
  }
}
function isIteratorProp(target, prop) {
  return prop === Symbol.asyncIterator && instanceOfAny(target, [IDBIndex, IDBObjectStore, IDBCursor]) || prop === "iterate" && instanceOfAny(target, [IDBIndex, IDBObjectStore]);
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get(target, prop, receiver) {
    if (isIteratorProp(target, prop))
      return iterate;
    return oldTraps.get(target, prop, receiver);
  },
  has(target, prop) {
    return isIteratorProp(target, prop) || oldTraps.has(target, prop);
  }
}));

// src/lib/db.js
var DB_NAME = "admin-assistant";
var DB_VERSION = 5;
var STORE_COOP_DOCS = "coopDocs";
var STORE_ATTACHMENT_BLOBS = "attachmentBlobs";
var STORE_TODOS = "todos";
var STORE_NOTES = "notes";
var STORE_APPROVAL_ITEMS = "approvalItems";
var STORE_STATUS_CHANGES = "statusChanges";
var STORE_META = "meta";
var dbPromise = null;
function initDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_COOP_DOCS)) {
          const coopStore = db.createObjectStore(STORE_COOP_DOCS, {
            keyPath: "id"
          });
          coopStore.createIndex("by_is_new", "is_new");
          coopStore.createIndex("by_requires_action", "requires_action");
          coopStore.createIndex("by_is_completed", "is_completed");
          coopStore.createIndex("by_created_at", "created_at");
          coopStore.createIndex("by_deadline", "deadline");
        }
        if (!db.objectStoreNames.contains(STORE_ATTACHMENT_BLOBS)) {
          const attachStore = db.createObjectStore(STORE_ATTACHMENT_BLOBS, {
            keyPath: "key"
          });
          attachStore.createIndex("by_coopId", "coopId");
        }
        if (!db.objectStoreNames.contains(STORE_TODOS)) {
          const todoStore = db.createObjectStore(STORE_TODOS, { keyPath: "id" });
          todoStore.createIndex("by_created_at", "created_at");
        }
        if (!db.objectStoreNames.contains(STORE_NOTES)) {
          const noteStore = db.createObjectStore(STORE_NOTES, { keyPath: "id" });
          noteStore.createIndex("by_created_at", "created_at");
        }
        if (!db.objectStoreNames.contains(STORE_APPROVAL_ITEMS)) {
          db.createObjectStore(STORE_APPROVAL_ITEMS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_STATUS_CHANGES)) {
          const statusStore = db.createObjectStore(STORE_STATUS_CHANGES, { keyPath: "id" });
          statusStore.createIndex("by_created_at", "created_at");
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      }
    });
  }
  return dbPromise;
}
async function upsertCoopDoc(doc) {
  const db = await initDB();
  await db.put(STORE_COOP_DOCS, doc);
  return doc.id;
}
async function getCoopDoc(id) {
  const db = await initDB();
  return db.get(STORE_COOP_DOCS, id);
}
async function getAllCoopDocIds() {
  const db = await initDB();
  const keys = await db.getAllKeys(STORE_COOP_DOCS);
  return new Set(keys);
}
async function hasCoopDocStatusChanged(id, latest) {
  const existing = await getCoopDoc(id);
  if (!existing) return false;
  return latest.stGbn !== void 0 && latest.stGbn !== existing.stGbn || latest.lastStGbn !== void 0 && latest.lastStGbn !== existing.lastStGbn || latest.workStgCd !== void 0 && latest.workStgCd !== existing.workStgCd;
}
async function getAllApprovalItemIds() {
  const db = await initDB();
  const keys = await db.getAllKeys(STORE_APPROVAL_ITEMS);
  return new Set(keys);
}
async function getApprovalItem(id) {
  const db = await initDB();
  return db.get(STORE_APPROVAL_ITEMS, id);
}
async function getAllApprovalItems(source) {
  const db = await initDB();
  const all = await db.getAll(STORE_APPROVAL_ITEMS);
  return source ? all.filter((item) => item.source === source) : all;
}
async function upsertApprovalItem(item) {
  const db = await initDB();
  await db.put(STORE_APPROVAL_ITEMS, item);
}
async function hasApprovalStatusChanged(id, latest) {
  const existing = await getApprovalItem(id);
  if (!existing) return false;
  return latest.stGbn !== void 0 && latest.stGbn !== existing.stGbn || latest.lastStGbn !== void 0 && latest.lastStGbn !== existing.lastStGbn || latest.workStgCd !== void 0 && latest.workStgCd !== existing.workStgCd || latest.aprvLevel !== void 0 && latest.aprvLevel !== existing.aprvLevel || latest.lastAprvUser !== void 0 && latest.lastAprvUser !== existing.lastAprvUser;
}
async function getStatusChange(id) {
  const db = await initDB();
  return db.get(STORE_STATUS_CHANGES, id);
}
async function upsertStatusChange(item) {
  const db = await initDB();
  await db.put(STORE_STATUS_CHANGES, item);
}
async function getMeta(key) {
  const db = await initDB();
  const row = await db.get(STORE_META, key);
  return row ? row.value : null;
}
async function setMeta(key, value) {
  const db = await initDB();
  await db.put(STORE_META, { key, value });
  return value;
}
var SYNC_BASELINE_PREFIX = "syncBaselineDone:";
async function getSyncBaselineDone(key) {
  return Boolean(await getMeta(`${SYNC_BASELINE_PREFIX}${key}`));
}
async function setSyncBaselineDone(key) {
  return setMeta(`${SYNC_BASELINE_PREFIX}${key}`, true);
}
async function getDeptCodes() {
  const list = await getMeta("deptCodes");
  return Array.isArray(list) ? list : [];
}
var DEFAULT_FEATURE_TOGGLES = {
  briefing: true,
  coop: true,
  approval: true,
  calendar: true,
  chat: true,
  status: true
};
async function getFeatureToggles() {
  const stored = await getMeta("featureToggles");
  if (stored && typeof stored === "object") {
    return { ...DEFAULT_FEATURE_TOGGLES, ...stored };
  }
  return { ...DEFAULT_FEATURE_TOGGLES };
}
async function setFeatureEnabled(id, enabled) {
  const cur = await getFeatureToggles();
  cur[id] = !!enabled;
  await setMeta("featureToggles", cur);
  return cur;
}
async function getAiSummaryEnabled() {
  const v = await getMeta("aiSummaryEnabled");
  return v === void 0 || v === null ? true : Boolean(v);
}
var DEFAULT_AI_SUMMARY_MAX_AGE_DAYS = 30;
async function getAiSummaryMaxAgeDays() {
  const v = await getMeta("aiSummaryMaxAgeDays");
  return v === void 0 || v === null ? DEFAULT_AI_SUMMARY_MAX_AGE_DAYS : Number(v) || 0;
}
async function getAutoDetailFetchOnArrival() {
  const v = await getMeta("autoDetailFetchOnArrival");
  return v === void 0 || v === null ? true : v === true;
}

// src/lib/kisApi.js
var BASE_URL = "https://kis.kbu.ac.kr";
var RAW_TEXT_EXTRACT_VERSION = 10;
var RECV_DEPT_SCHEMA_VERSION = 2;
var ENDPOINTS = {
  coopDocList: {
    path: "/com/UmgjCtr/findIntAprvDeptDocList.do",
    // 협조문수신함
    menuId: "M106642",
    pgmId: "P007220"
  },
  // 2026-08-23(8) 실측값 반영 — 별도 프로토타입(chrome.storage.local 기반
  // 초기 검증 버전)에서 Network 탭으로 이미 캡처/재현 테스트까지 끝낸 값을
  // 가져옴. 실측 전에도 menuId/pgmId 없이 이미 정상 데이터가 오긴 했지만
  // (ERP가 이 값들을 엄격히 검증하지 않는 듯), 정확한 값을 알고 있으니 그대로
  // 채워서 TODO/미검증 상태를 없앤다.
  expenseTravelList: {
    path: "/com/UmgjCtr/findDraftList.do",
    // 지출출장결재현황 (내가 기안한 것)
    menuId: "M100034",
    pgmId: "P000024"
  },
  internalDraftList: {
    path: "/com/UmgjCtr/findIntAprvDraftList.do",
    // 내부기안결재현황
    menuId: "M106624",
    pgmId: "P007210"
  },
  detail: {
    path: "/com/UmgjCtr/findIntAprvDtlList.do",
    // 협조문 상세
    menuId: "M106642",
    // 2026-08-19 실측 확인: 협조문수신함과 동일 화면 맞음
    pgmId: "P007220"
  },
  aprvStatus: {
    path: "/com/UmgjCtr/findAprvStatusList.do",
    // 결재단계 상세
    menuId: null,
    // TODO
    pgmId: null
  },
  attachList: {
    // ⚠️ 2026-08-21 정정: findSavedAttachDocList.do + aprvNo는 틀린 엔드포인트였음
    // (실측: 매번 빈 <Rows></Rows>만 응답). 팀원이 findFileDetailList.do +
    // attachNo(첨부그룹 식별자, 목록/상세 응답의 attachNo 필드)로 100% 실측
    // 확인한 걸 그대로 반영. Dataset 형식이 아니라 <Parameters>만 채우는
    // 요청이라 buildParamsOnlyXmlRequest/postParamsOnly를 따로 씀.
    path: "/com/FileCtr/findFileDetailList.do",
    menuId: "M106642",
    pgmId: "P007220"
  },
  fileDownload: {
    // 첨부파일 바이너리 다운로드. Nexacro XML이 아니라 일반 form-urlencoded
    // 요청이고 응답도 XML이 아니라 파일 바이트 그대로 옴 (2026-08-21, 팀원 실측).
    path: "/com/FileCtr/fileDefaultDownload.do",
    menuId: "M106642",
    pgmId: null
  },
  activityLog: {
    path: "/com/SlogCtr/saveBtnLog.do",
    // 활동 로그 (세션 연장 안전장치, 선택)
    menuId: null,
    pgmId: null
  },
  // 지출출장결재하기: 나에게 결재가 올라와서 내가 처리해야 하는 건들.
  //   expenseTravelList(findDraftList.do, 지출출장결재현황)는 "내가 기안한
  //   것"의 진행 상태고, 이건 반대로 "나에게 결재 요청이 온 것" 목록이라
  //   완전히 다른 화면임 — 알림 커버리지에서 빠져있던 4번째 화면 (2026-08-23
  //   추가). menuId/pgmId는 별도 프로토타입(chrome.storage.local 기반 초기
  //   검증 버전)에서 이미 실측 확인된 값을 그대로 가져옴.
  aprvMngList: {
    path: "/com/UmgjCtr/findAprvMngList.do",
    menuId: "M100033",
    pgmId: "P000020"
  },
  // 2026-08-22 실측 완료 — 협조문수신함 화면의 "부서" 드롭다운을 채우는 API.
  // 로그인 계정의 "최근 1년 발령 부서" 전체를 돌려줌(응답 Dataset "DS_DEPT",
  // Col deptCd/deptNm). 이전엔 이 목록을 화면 캡처로 손으로 옮겨써서
  // MY_DEPARTMENTS에 하드코딩했었는데, 이 API로 대체해서 계정마다 자동으로
  // 본인 소속 부서를 가져오게 함(다른 부서 사람에게 배포해도 동작).
  //
  // ⚠️ 2026-08-23(14) 정정 — "부서가 6개여야 하는데 2개만 뜬다" 리포트로
  // Claude in Chrome을 이용해 실제 로그인된 kis.kbu.ac.kr 세션에서 협조문
  // 수신함 화면을 열고 devtools Network 로그를 직접 캡처해서 확인함: 이
  // 화면이 실제로 호출하는 경로는 findPersOford**D**eptList.do (Ofor**d**,
  // o가 하나 더 있음)이었고, 아래 있던 findPersOfr**d**DeptList.do(Ofrd)는
  // 처음부터 오타였다 — 그동안 이 상수를 쓰는 모든 요청이 매번 실패해서
  // (서버가 200 OK로 "페이지를 찾을 수 없습니다" 안내 HTML을 돌려주고,
  // postDataset이 Dataset이 아니라고 판단 → 재시도까지 실패 → 에러) 소속
  // 부서 목록을 한 번도 제대로 받아온 적이 없었음. fetchMyCoopDocList()의
  // catch가 이 실패를 조용히 삼키고 매번 "필터링 없이 전체 반환"으로
  // 빠졌던 것, CoopPage.jsx의 부서 드롭다운이 몇 개 안 뜨던 것 모두 이
  // 오타 하나가 원인. 실측(2026-08-23)으로 이 경로가 정확히 6개 부서
  // (혁신지원사업단/디지털트윈연구원×2(코드 다름, 이름만 같음)/AI디지털트윈
  // 연구원(공백 있음)/빅데이터과/소프트웨어융합과)를 반환하는 것까지 확인 완료.
  persOfrdDeptList: {
    path: "/com/UmgjCtr/findPersOfordDeptList.do",
    menuId: "M106642",
    pgmId: "P007220"
  },
  // 2026-08-22 실측 완료 (Network 탭 캡처) — 로그인 사용자 이름. 응답 Row에
  // Col id="userNm" 필드로 내려옴(예: "김우진"). 앱 로드 시 부트스트랩으로
  // 한 번 호출되는 공통 화면(menuId=M000000/pgmId=P000000 — 특정 업무 화면이
  // 아니라 프레임워크 공통 영역이라 다른 계정도 이 값 그대로 쓸 것으로 보임).
  isLogin: {
    path: "/com/SsoCtr/isLogin.do",
    menuId: "M000000",
    pgmId: "P000000"
  },
  // 2026-08-22 실측 완료 — 로그인 사용자의 소속+직급 정보. 응답 Dataset
  // "DS_USER_GB"에 여러 Row가 올 수 있음(한 계정이 재직/졸업 등 여러 신분을
  // 가질 수 있어서) — currentLoginUser==="1"인 행이 지금 로그인한 프로필.
  // userGbnNm 필드가 이미 "교직원(혁신지원사업단,산단 사-조교)"처럼 소속·직급을
  // ERP 자체 포맷으로 합쳐서 내려주므로, 우리가 "소속1/소속2 직급" 식으로
  // 다시 쪼개 조립하지 않고 이 문자열을 그대로 씀 — 사람마다 신분 표기 포맷이
  // 다를 수 있어서(교직원 vs 학생 행 포맷이 이미 다름, 실측으로 확인) 잘못
  // 쪼개면 다른 부서 사람에게 배포했을 때 이상하게 보일 위험이 있음.
  userGbList: {
    path: "/com/UserCtr/findUserGbList.do",
    menuId: "M000000",
    pgmId: "P000000"
  },
  // 4단계(학적변동대상자목록, kbu-assistant 이식): menuId/pgmId는 kbu 쪽 계정
  // (W님 계정)에서 실측된 값을 그대로 가져옴 — 이 프로젝트(admin) 계정에서는
  // 아직 재검증 안 됐으므로, 권한이 없어 실패하면 background.js가 자동으로
  // 기능 토글을 꺼버리도록 되어있다(runStatusChangeSync 참고).
  statusChangeList: {
    path: "/uni/sreg/SregModiCtr/findSrhregModAccpList.do",
    // 학적변동대상자목록
    menuId: "M104947",
    pgmId: "P005858"
  },
  statusChangeStages: {
    path: "/uni/sreg/SregModiCtr/findSrhregModAccpStgList.do",
    // 학적변동 승인단계별 현황
    menuId: "M104947",
    pgmId: "P005858"
  },
  // 2026-09-05 실측 완료 — 로그인 계정이 실제로 권한을 가진 메뉴 전체 목록.
  // isLogin/userGbList와 마찬가지로 menuId=M000000/pgmId=P000000인 공통 화면
  // (특정 업무 메뉴가 아니라 프레임워크 부트스트랩 영역). 응답 Dataset
  // "DS_MENULIST"에 menuId 컬럼이 있고, 이 목록에 없는 menuId는 그 계정이
  // ERP 메뉴로는 절대 들어갈 수 없는 화면이라는 뜻 — 즉 ERP가 하는 메뉴 권한
  // 검사를 그대로 재현할 수 있음. 실측: 권한 없는 계정(W) 응답엔 학적변동승인처리
  // (M104947)가 없고, 권한 있는 계정 응답엔 있음 — 대조 확인 완료.
  // ⚠️ Content-Type/헤더가 postDataset과 달라서(text/plain + Reqfoundataion:
  // nexacro) postParamsOnly로 호출해야 함(findAttachDocList.do와 동일 패턴).
  authMenuList: {
    path: "/com/MenuCtr/findAuthMenuList.do",
    menuId: "M000000",
    pgmId: "P000000"
  }
};
var COOP_DOC_LIST_SCHEMA = [
  "bussGbn",
  "bussSmClsfGbn",
  "subject",
  "draftEmpNm",
  "aprvNo",
  "draftDtFrom",
  "draftDtTo",
  "lastAprvDtFrom",
  "lastAprvDtTo",
  "bigStGbn",
  "stGbn",
  "docDeptCd"
];
function buildXmlRequest(datasetId, params = {}, columnSchema) {
  const schema = columnSchema && columnSchema.length ? columnSchema : Object.keys(params);
  const columnInfo = schema.map((key) => `<Column id="${key}" type="STRING" size="256"/>`).join("");
  const cols = Object.entries(params).filter(([, value]) => value !== void 0 && value !== null && value !== "").map(([key, value]) => `<Col id="${key}">${escapeXml(String(value))}</Col>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?><Root xmlns="http://www.nexacroplatform.com/platform/dataset"><Parameters><Parameter id="requestTimeStr">${Date.now()}</Parameter></Parameters><Dataset id="${datasetId}"><ColumnInfo>${columnInfo}</ColumnInfo><Rows><Row>${cols}</Row></Rows></Dataset></Root>`;
}
function buildParamsOnlyXmlRequest(params = {}) {
  const paramTags = Object.entries(params).filter(([, value]) => value !== void 0 && value !== null).map(([key, value]) => `<Parameter id="${key}">${escapeXml(String(value))}</Parameter>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><Root xmlns="http://www.nexacroplatform.com/platform/dataset"><Parameters>${paramTags}<Parameter id="requestTimeStr">${Date.now()}</Parameter></Parameters></Root>`;
}
function escapeXml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
var XML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " "
};
function decodeXmlEntities(str) {
  if (!str) return "";
  return str.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === "#") {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const code = isHex ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isNaN(code) ? match : String.fromCharCode(code);
    }
    return XML_ENTITIES[entity] ?? match;
  });
}
function parseXmlResponse(xmlText, datasetId) {
  if (!xmlText) return [];
  const datasetRegex = datasetId ? new RegExp(`<Dataset[^>]*id=["']${datasetId}["'][^>]*>([\\s\\S]*?)<\\/Dataset>`, "i") : /<Dataset[^>]*>([\s\S]*?)<\/Dataset>/i;
  const dsMatch = xmlText.match(datasetRegex);
  if (!dsMatch) return [];
  const datasetXml = dsMatch[1];
  const columnIds = [];
  const columnInfoMatch = datasetXml.match(/<ColumnInfo>([\s\S]*?)<\/ColumnInfo>/i);
  if (columnInfoMatch) {
    const colInfoRegex = /<Column[^>]*id=["']([^"']+)["'][^>]*\/?>/gi;
    let m;
    while ((m = colInfoRegex.exec(columnInfoMatch[1])) !== null) {
      columnIds.push(m[1]);
    }
  }
  const rowsMatch = datasetXml.match(/<Rows>([\s\S]*?)<\/Rows>/i);
  if (!rowsMatch) return [];
  const records = [];
  const rowRegex = /<Row>([\s\S]*?)<\/Row>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(rowsMatch[1])) !== null) {
    const rowXml = rowMatch[1];
    const record = {};
    const colWithIdRegex = /<Col[^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/Col>/gi;
    let colMatch;
    let matchedAny = false;
    while ((colMatch = colWithIdRegex.exec(rowXml)) !== null) {
      matchedAny = true;
      record[colMatch[1]] = decodeXmlEntities(colMatch[2].trim());
    }
    if (!matchedAny) {
      const plainColRegex = /<Col[^>]*>([\s\S]*?)<\/Col>/gi;
      let plainMatch;
      let idx = 0;
      while ((plainMatch = plainColRegex.exec(rowXml)) !== null) {
        const key = columnIds[idx] || `col_${idx}`;
        record[key] = decodeXmlEntities(plainMatch[1].trim());
        idx++;
      }
    }
    records.push(record);
  }
  return records;
}
function decodeRichText(html) {
  if (!html) return "";
  const decoded = decodeXmlEntities(html);
  return decoded.replace(/<\/tr\s*>/gi, "\n").replace(/<\/t[dh]\s*>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li\s*>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<\/div>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\n{3,}/g, "\n\n").trim();
}
var HEADER_CTNT_FIELDS = ["basiCtnt", "intAprvCtnt", "coopCtnt"];
function extractDetailText(detail) {
  if (!detail) return "";
  const parts = [];
  for (const field of HEADER_CTNT_FIELDS) {
    const value = detail[field];
    if (value) parts.push(decodeRichText(value));
  }
  for (let i = 1; i <= 8; i++) {
    const value = detail[`ctnt${i}`] || detail[`ctnt${i}Tmp`];
    if (value) parts.push(decodeRichText(value));
  }
  return parts.join("\n\n").trim();
}
var ALLOWED_HTML_TAGS = /* @__PURE__ */ new Set([
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "colgroup",
  "col",
  "p",
  "br",
  "b",
  "strong",
  "ul",
  "ol",
  "li",
  "div",
  "span"
]);
var PRESERVED_ATTRS_BY_TAG = {
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"]
};
function sanitizeRichHtml(html) {
  if (!html) return "";
  const decoded = decodeXmlEntities(html);
  return decoded.replace(/<(\/?)([a-zA-Z0-9]+)((?:\s[^>]*)?)\/?>/g, (match, closing, tagName, attrsStr) => {
    const lower = tagName.toLowerCase();
    if (!ALLOWED_HTML_TAGS.has(lower)) return "";
    if (closing || !PRESERVED_ATTRS_BY_TAG[lower]) return `<${closing}${lower}>`;
    let kept = "";
    for (const attr of PRESERVED_ATTRS_BY_TAG[lower]) {
      const m = attrsStr.match(new RegExp(`${attr}\\s*=\\s*["']?(\\d+)["']?`, "i"));
      if (m) kept += ` ${attr}="${m[1]}"`;
    }
    return `<${lower}${kept}>`;
  }).replace(/<p>\s*(?:<br>\s*)*<\/p>/gi, "").replace(/(?:<br>\s*){2,}/gi, "<br>").trim();
}
var URL_PATTERN = /(https?:\/\/[^\s<>"'\)]+)/g;
var URL_TRAILING_PUNCT = /[.,;:)\]}]+$/;
var HTML_LETTER_HEADING = /^[가나다라마바사아자차카타파하]\.\s/;
var HTML_BLOCK_START = /^\d+[)\.]\s/;
var HTML_SUB_ITEM = /^[-－–—•·※*]\s/;
function formatParagraphs(html) {
  if (!html) return html;
  let sawHeading = false;
  let afterHeadingNoNumberYet = false;
  return html.replace(/<p>([\s\S]*?)<\/p>/g, (match, inner) => {
    const textStart = inner.replace(/<[^>]+>/g, "").trimStart();
    let style;
    if (HTML_LETTER_HEADING.test(textStart)) {
      style = "margin:0.9rem 0 0.25rem;font-weight:500;";
      sawHeading = true;
      afterHeadingNoNumberYet = true;
    } else if (HTML_BLOCK_START.test(textStart)) {
      const indent = sawHeading ? "1rem" : "0";
      style = `margin:0.75rem 0 0.25rem;padding-left:${indent};`;
      afterHeadingNoNumberYet = false;
    } else if (HTML_SUB_ITEM.test(textStart)) {
      if (afterHeadingNoNumberYet) {
        style = "margin:0.125rem 0;";
      } else {
        const indent = sawHeading ? "2rem" : "1rem";
        style = `margin:0.125rem 0;padding-left:${indent};`;
      }
    } else {
      style = "margin:0.375rem 0;";
      afterHeadingNoNumberYet = false;
    }
    return `<p style="${style}">${inner}</p>`;
  });
}
function linkifyHtml(html) {
  if (!html) return html;
  return html.replace(URL_PATTERN, (url) => {
    const trailMatch = url.match(URL_TRAILING_PUNCT);
    const trail = trailMatch ? trailMatch[0] : "";
    const cleanUrl = trail ? url.slice(0, -trail.length) : url;
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="text-blue-600 underline break-all">${cleanUrl}</a>${trail}`;
  });
}
function extractDetailHtml(detail) {
  if (!detail) return "";
  const parts = [];
  for (const field of HEADER_CTNT_FIELDS) {
    const value = detail[field];
    if (value) parts.push(sanitizeRichHtml(value));
  }
  for (let i = 1; i <= 8; i++) {
    const htmlValue = detail[`ctnt${i}`];
    if (htmlValue) {
      parts.push(sanitizeRichHtml(htmlValue));
      continue;
    }
    const tmpValue = detail[`ctnt${i}Tmp`];
    if (tmpValue) {
      const escaped = decodeXmlEntities(tmpValue).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      parts.push(`<p>${escaped}</p>`);
    }
  }
  return linkifyHtml(formatParagraphs(parts.join("<hr>")));
}
async function fetchWithRetry(url, options, retries = 1) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`ERP \uC694\uCCAD \uC2E4\uD328: ${res.status} ${res.statusText}`);
    return res;
  } catch (err) {
    if (retries > 0) {
      return fetchWithRetry(url, options, retries - 1);
    }
    throw err;
  }
}
async function postDataset(endpoint, requestDatasetId, params, columnSchema, responseDatasetId, _isRetry = false) {
  const body = buildXmlRequest(requestDatasetId, params, columnSchema);
  const query = new URLSearchParams();
  if (endpoint.menuId) query.set("menuId", endpoint.menuId);
  if (endpoint.pgmId) query.set("pgmId", endpoint.pgmId);
  const queryString = query.toString();
  const url = `${BASE_URL}${endpoint.path}${queryString ? `?${queryString}` : ""}`;
  if (!endpoint.menuId || !endpoint.pgmId) {
    console.warn(
      `[kisApi] ${endpoint.path}: menuId/pgmId\uAC00 \uC544\uC9C1 \uBBF8\uAC80\uC99D \uC0C1\uD0DC\uB85C \uD638\uCD9C\uB428. \uC2E4\uD328\uD558\uBA74 Network \uD0ED\uC5D0\uC11C \uCEA1\uCC98\uD574\uC11C ENDPOINTS\uC5D0 \uCC44\uC6CC\uB123\uC744 \uAC83.`
    );
  }
  const res = await fetchWithRetry(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body
  });
  const text = await res.text();
  if (!/<Dataset[\s>]/i.test(text)) {
    if (!_isRetry) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return postDataset(endpoint, requestDatasetId, params, columnSchema, responseDatasetId, true);
    }
    const err = new Error("ERP \uC751\uB2F5\uC774 \uC608\uC0C1\uD55C Dataset XML\uC774 \uC544\uB2D8 (\uC138\uC158 \uB9CC\uB8CC\uB85C \uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uAC00 \uB0B4\uB824\uC654\uC744 \uAC00\uB2A5\uC131)");
    err.code = "SESSION_EXPIRED_OR_UNEXPECTED_RESPONSE";
    err.responseSnippet = text.slice(0, 300);
    throw err;
  }
  return parseXmlResponse(text, responseDatasetId);
}
async function postParamsOnly(endpoint, params, responseDatasetId) {
  const body = buildParamsOnlyXmlRequest(params);
  const query = new URLSearchParams();
  if (endpoint.menuId) query.set("menuId", endpoint.menuId);
  if (endpoint.pgmId) query.set("pgmId", endpoint.pgmId);
  const queryString = query.toString();
  const url = `${BASE_URL}${endpoint.path}${queryString ? `?${queryString}` : ""}`;
  const res = await fetchWithRetry(url, {
    method: "POST",
    credentials: "include",
    referrer: `${BASE_URL}/nx/index.html`,
    headers: {
      "Content-Type": "text/plain;charset=UTF-8",
      "Reqfoundataion": "nexacro"
    },
    body
  });
  const text = await res.text();
  if (!/<Dataset[\s>]/i.test(text)) {
    const err = new Error("ERP \uC751\uB2F5\uC774 \uC608\uC0C1\uD55C Dataset XML\uC774 \uC544\uB2D8 (\uC138\uC158 \uB9CC\uB8CC\uB85C \uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uAC00 \uB0B4\uB824\uC654\uC744 \uAC00\uB2A5\uC131)");
    err.code = "SESSION_EXPIRED_OR_UNEXPECTED_RESPONSE";
    err.responseSnippet = text.slice(0, 300);
    throw err;
  }
  return parseXmlResponse(text, responseDatasetId);
}
function fetchCoopDocList({ stGbn = "03", docDeptCd = "" } = {}) {
  return postDataset(
    ENDPOINTS.coopDocList,
    "DS_COND",
    { stGbn, docDeptCd },
    COOP_DOC_LIST_SCHEMA,
    "DS_BSNS052"
  );
}
async function fetchPersOfrdDeptList() {
  const rows = await postDataset(ENDPOINTS.persOfrdDeptList, "DS_COND", {}, void 0, "DS_DEPT");
  return rows.filter((r) => r.deptCd).map((r) => ({
    code: r.deptCd,
    name: (r.deptNm || r.deptCd).replace(/\s*\(\d+\)\s*$/, "")
  }));
}
async function fetchCoopDocListAllDepts() {
  const items = await fetchCoopDocList({ docDeptCd: "" });
  recordDiscoveredDeptCodes(items).catch(
    (err) => console.warn("[kisApi] \uBD80\uC11C\uCF54\uB4DC \uC790\uB3D9 \uC218\uC9D1 \uC2E4\uD328(\uBB34\uC2DC \uAC00\uB2A5):", err)
  );
  return items;
}
async function recordDiscoveredDeptCodes(items) {
  const found = /* @__PURE__ */ new Map();
  for (const item of items) {
    if (item.rcvDeptCd) found.set(item.rcvDeptCd, item.rcvDeptNm || item.rcvDeptCd);
  }
  if (found.size === 0) return;
  const prev = await getMeta("discoveredDeptCodes") || [];
  const merged = new Map(prev.map((d) => [d.code, d.name]));
  for (const [code, name] of found) merged.set(code, name);
  const list = Array.from(merged, ([code, name]) => ({ code, name }));
  await setMeta("discoveredDeptCodes", list);
}
var cachedMyDeptCodes = null;
async function fetchMyCoopDocList() {
  const listItems = await fetchCoopDocListAllDepts();
  if (!cachedMyDeptCodes) {
    try {
      const depts = await fetchPersOfrdDeptList();
      cachedMyDeptCodes = new Set(depts.map((d) => d.code).filter(Boolean));
    } catch (err) {
      console.warn(
        "[kisApi] \uC18C\uC18D \uBD80\uC11C \uBAA9\uB85D(fetchPersOfrdDeptList) \uC870\uD68C \uC2E4\uD328 \u2014 \uC774\uBC88 \uD3F4\uB9C1\uC740 \uD544\uD130\uB9C1 \uC5C6\uC774 \uC804\uCCB4 \uBC18\uD658:",
        err
      );
      return listItems;
    }
  }
  let manualCodes = [];
  try {
    manualCodes = (await getDeptCodes()).map((d) => d.code).filter(Boolean);
  } catch (err) {
    console.warn("[kisApi] \uC218\uB3D9 \uBD80\uC11C \uCF54\uB4DC \uC870\uD68C \uC2E4\uD328(\uBB34\uC2DC\uD558\uACE0 \uC790\uB3D9\uBC1C\uACAC \uBAA9\uB85D\uB9CC \uC0AC\uC6A9):", err);
  }
  const allowedCodes = /* @__PURE__ */ new Set([...cachedMyDeptCodes, ...manualCodes]);
  if (allowedCodes.size === 0) return listItems;
  return listItems.filter((item) => item.rcvDeptCd && allowedCodes.has(item.rcvDeptCd));
}
function fetchExpenseTravelList() {
  return postDataset(ENDPOINTS.expenseTravelList, "DS_COND", {});
}
function fetchInternalDraftList({ stGbn = "" } = {}) {
  return postDataset(ENDPOINTS.internalDraftList, "DS_COND", { stGbn });
}
function fetchApprovalPendingList({ stGbn = "02" } = {}) {
  return postDataset(ENDPOINTS.aprvMngList, "DS_COND", { stGbn });
}
async function fetchAuthMenuIds() {
  const rows = await postParamsOnly(ENDPOINTS.authMenuList, {}, "DS_MENULIST");
  return new Set(rows.map((r) => r.menuId).filter(Boolean));
}
function fetchStatusChangeList() {
  return postDataset(ENDPOINTS.statusChangeList, "DS_COND", {}, void 0, "DS_SREG260");
}
function fetchStatusChangeStages(stuno, schregModAplyDt, schregModGbn) {
  return postDataset(
    ENDPOINTS.statusChangeStages,
    "DS_COND",
    { stuno, schregModAplyDt, schregModGbn },
    ["stuno", "schregModAplyDt", "schregModGbn"],
    "DS_SREG250"
  );
}
function fetchCoopDocDetail({ aprvNo }) {
  return postDataset(ENDPOINTS.detail, "DS_COND", { aprvNo }, void 0, "DS_BSNS052");
}

// src/lib/claudeApi.js
var PROXY_URL = "https://kbu-admin-proxy.20250147.workers.dev";
var PROXY_SECRET_HEADER = "x-proxy-secret";
var PROXY_SECRET = "b7f00dd4f162baf019d3cae3969d4ee7e85f10f05c13f4a607545d671857e9bc";
var SYSTEM_PROMPT = `\uB2F9\uC2E0\uC740 \uB300\uD559 \uD589\uC815 \uD611\uC870\uBB38\uC744 \uBD84\uC11D\uD558\uB294 \uC5B4\uC2DC\uC2A4\uD134\uD2B8\uC785\uB2C8\uB2E4.
\uC0AC\uC6A9\uC790\uAC00 \uBCF4\uB0B8 \uD611\uC870\uBB38 \uC6D0\uBB38\uC744 \uBD84\uC11D\uD574\uC11C, \uC544\uB798 7\uAC1C \uD544\uB4DC\uB85C\uB9CC \uAD6C\uC131\uB41C JSON \uAC1D\uCCB4 \uD558\uB098\uB97C
\uBC18\uD658\uD558\uC138\uC694. \uCF54\uB4DC\uD39C\uC2A4\uB098 \uC124\uBA85 \uBB38\uC7A5 \uC5C6\uC774 JSON \uAC1D\uCCB4\uB9CC \uBC18\uD658\uD569\uB2C8\uB2E4.

{
  "title": "\uBB38\uC11C \uC81C\uBAA9 (string)",
  "sender_dept": "\uBC1C\uC2E0 \uBD80\uC11C\uBA85 (string, \uC6D0\uBB38\uC5D0\uC11C \uCC3E\uC744 \uC218 \uC5C6\uC73C\uBA74 \uBE48 \uBB38\uC790\uC5F4)",
  "deadline": "\uB9C8\uAC10\uAE30\uD55C, YYYY-MM-DD \uD615\uC2DD\uC758 \uBB38\uC790\uC5F4. \uBA85\uC2DC\uB41C \uB9C8\uAC10\uC77C\uC774 \uC5C6\uC73C\uBA74 null (\uBB38\uC790\uC5F4 \uC544\uB2D8)",
  "requires_action": "\uC870\uAD50/\uB2F4\uB2F9\uC790\uAC00 \uC2E4\uC81C\uB85C \uCC98\uB9AC\uD574\uC57C \uD560 \uC77C\uC774 \uC788\uC73C\uBA74 true, \uB2E8\uC21C \uD1B5\uBCF4/\uCC38\uACE0\uC6A9\uC774\uBA74 false (boolean)",
  "action_type": "requires_action\uC774 true\uC77C \uB54C, \uD574\uC57C \uD560 \uD589\uB3D9\uC744 \uB2E4\uC74C \uC911 \uD558\uB098\uC758 \uC9E7\uC740 \uD55C\uAD6D\uC5B4 \uB2E8\uC5B4\uB85C: \uD68C\uC2E0, \uC81C\uCD9C, \uD655\uC778, \uCC38\uC11D, \uACB0\uC7AC, \uC2E0\uCCAD, \uAE30\uD0C0. requires_action\uC774 false\uBA74 null",
  "action_description": "requires_action\uC774 true\uC77C \uB54C, \uC815\uD655\uD788 \uBB34\uC5C7\uC744 \uB204\uAD6C\uC5D0\uAC8C/\uC5B4\uB514\uB85C \uC81C\uCD9C\xB7\uD68C\uC2E0\uD574\uC57C \uD558\uB294\uC9C0 15~25\uC790 \uC815\uB3C4\uB85C \uC9E7\uAC8C. requires_action\uC774 false\uBA74 null",
  "summary": "\uBB38\uC11C \uC6A9\uAC74\uC744 \uC790\uC5F0\uC2A4\uB7EC\uC6B4 \uD55C \uBB38\uC7A5, 40~60\uC790 \uC815\uB3C4\uB85C \uC694\uC57D. \uC544\uB798 \uC608\uC2DC\uC758 '\uC88B\uC740 \uC608' \uAE38\uC774/\uD1A4\uC744 \uBC18\uB4DC\uC2DC \uB530\uB97C \uAC83"
}

summary \uC791\uC131 \uC608\uC2DC (\uBC18\uB4DC\uC2DC \uC774 \uC815\uB3C4 \uAE38\uC774/\uD1A4\uC744 \uB530\uB97C \uAC83):
- \uB098\uC05C \uC608(\uB108\uBB34 \uAE40): "\uAD6D\uBBFC\uCDE8\uC5C5\uC9C0\uC6D0\uC81C\uB3C4 \uC548\uB0B4\uB97C \uC704\uD574 2026\uB144 9\uC6D4\uBD80\uD130 12\uC6D4\uAE4C\uC9C0 \uD559\uACFC\uC0AC\uBB34\uC2E4\uC744 \uBC29\uBB38\uD558\uB294 \uC124\uBA85\uD68C\uB97C \uC6B4\uC601\uD569\uB2C8\uB2E4. \uD559\uACFC\uB294 \uC704\uD0C1\uAE30\uAD00 \uB2F4\uB2F9\uC790\uC758 \uBC29\uBB38\uC5D0 \uD611\uC870\uD558\uACE0 \uD64D\uBCF4\uBB3C\uC744 \uAC8C\uC2DC\uD574\uC57C \uD558\uBA70, \uD559\uACFC \uB9DE\uCDA4\uD615 \uC124\uBA85\uD68C \uC77C\uC815\uC744 \uD611\uC758\uD574\uC57C \uD569\uB2C8\uB2E4."
- \uB098\uC05C \uC608(\uB108\uBB34 \uC9E7\uC74C, \uBB38\uC7A5\uC774 \uC544\uB2C8\uB77C \uBA85\uC0AC\uAD6C\uB9CC): "\uAD6D\uBBFC\uCDE8\uC5C5\uC9C0\uC6D0\uC81C\uB3C4 \uC124\uBA85\uD68C \uBC29\uBB38 \uD611\uC870 \uC694\uCCAD"
- \uC88B\uC740 \uC608(\uB531 \uC801\uB2F9\uD568): "\uAD6D\uBBFC\uCDE8\uC5C5\uC9C0\uC6D0\uC81C\uB3C4 \uC124\uBA85\uD68C\uB97C \uC704\uD574 \uD559\uACFC\uC0AC\uBB34\uC2E4 \uBC29\uBB38 \uD611\uC870\uC640 \uC77C\uC815 \uD611\uC758\uB97C \uC694\uCCAD\uD558\uB294 \uC548\uB0B4\uC785\uB2C8\uB2E4."
- \uB098\uC05C \uC608(\uB108\uBB34 \uAE40): "2026\uB144 9\uC6D4 7\uC77C\uBD80\uD130 11\uC6D4 2\uC77C\uAE4C\uC9C0 \uAD11\uB989\uD14C\uD06C\uB178\uBC38\uB9AC \uC0B0\uC5C5\uB2E8\uC9C0\uC5D0\uC11C \uC9C4\uD589\uB418\uB294 AI \uC9C1\uBB34\uAD50\uC721\uC744 \uC704\uD574 \uC18C\uD504\uD2B8\uC6E8\uC5B4\uC735\uD569\uD559\uACFC \uACF5\uC6A9\uC7A5\uBE44 \uB178\uD2B8\uBD81 10\uB300\uB97C \uB300\uC5EC\uD569\uB2C8\uB2E4. \uAD50\uC721 \uB2F4\uB2F9\uC790\uAC00 \uC7A5\uBE44\uB97C \uAD00\uB9AC\uD558\uACE0 \uAD50\uC721 \uC885\uB8CC \uD6C4 \uC0C1\uD0DC\uB97C \uD655\uC778\uD558\uC5EC \uC77C\uAD04 \uBC18\uB0A9\uD574\uC57C \uD569\uB2C8\uB2E4."
- \uB098\uC05C \uC608(\uB108\uBB34 \uC9E7\uC74C): "AI \uC9C1\uBB34\uAD50\uC721\uC6A9 \uB178\uD2B8\uBD81 10\uB300 \uB300\uC5EC \uD611\uC870"
- \uC88B\uC740 \uC608(\uB531 \uC801\uB2F9\uD568): "AI \uC9C1\uBB34\uAD50\uC721\uC5D0 \uD544\uC694\uD55C \uACF5\uC6A9 \uB178\uD2B8\uBD81 10\uB300\uB97C \uB300\uC5EC\uD558\uB2C8 \uB2F4\uB2F9\uC790\uAC00 \uAD00\uB9AC\uD574\uB2EC\uB77C\uB294 \uC694\uCCAD\uC785\uB2C8\uB2E4."

summary\uB294 \uBC30\uACBD \uC124\uBA85\xB7\uC138\uBD80 \uC808\uCC28\uB97C \uB298\uC5B4\uB193\uC9C0 \uB9D0\uACE0 \uD575\uC2EC \uC6A9\uAC74 \uD558\uB098\uB9CC \uC790\uC5F0\uC2A4\uB7EC\uC6B4 \uBB38\uC7A5\uC73C\uB85C
\uC4F0\uB418, \uBA85\uC0AC\uAD6C\uB85C \uB69D \uB04A\uC9C0 \uB9D0\uACE0 "~\uC694\uCCAD\uC785\uB2C8\uB2E4/~\uC548\uB0B4\uC785\uB2C8\uB2E4"\uCC98\uB7FC \uBB38\uC7A5\uC73C\uB85C \uB05D\uB9FA\uC73C\uC138\uC694.
\uB450 \uBB38\uC7A5 \uC774\uC0C1 \uC4F0\uC9C0 \uB9C8\uC138\uC694.`;
async function parseCoopDoc(rawText, aprvNo) {
  if (!PROXY_URL) {
    throw new Error(
      "[claudeApi] \uD504\uB85D\uC2DC \uC11C\uBC84 URL\uC774 \uC544\uC9C1 \uC124\uC815\uB418\uC9C0 \uC54A\uC74C (proxy/ \uBC30\uD3EC \uD6C4 PROXY_URL\uC744 \uCC44\uC6B8 \uAC83)"
    );
  }
  return callProxyWithRetry(rawText, aprvNo, 1);
}
async function callProxyWithRetry(rawText, aprvNo, retries) {
  try {
    const res = await fetch(PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [PROXY_SECRET_HEADER]: PROXY_SECRET
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        system: SYSTEM_PROMPT,
        text: rawText,
        // 캐시 키용 문서 고유 ID. 프록시가 이 값으로 "이미 파싱한 문서인지"
        // 먼저 확인하고, 있으면 Claude API 호출 없이 캐시된 결과를 돌려주는
        // 방식을 기대함 — 값이 없어도(aprvNo 미전달) 요청 자체는 그대로 동작.
        doc_id: aprvNo ?? null
      })
    });
    if (!res.ok) throw new Error(`\uD504\uB85D\uC2DC \uC694\uCCAD \uC2E4\uD328: ${res.status} ${res.statusText}`);
    const data = await res.json();
    return normalizeParsedDoc(data);
  } catch (err) {
    if (retries > 0) {
      return callProxyWithRetry(rawText, aprvNo, retries - 1);
    }
    throw err;
  }
}
var SUMMARY_MAX_CHARS = 70;
var ACTION_DESC_MAX_CHARS = 35;
function enforceShortText(text, maxChars) {
  if (!text) return "";
  const firstSentence = text.split(/(?<=[.!?다요함음])\s+/)[0] || text;
  const trimmed = firstSentence.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}\u2026`;
}
var PROMPT_VERSION = 4;
function normalizeParsedDoc(data) {
  return {
    title: data?.title ?? "",
    sender_dept: data?.sender_dept ?? "",
    deadline: data?.deadline ?? null,
    requires_action: Boolean(data?.requires_action),
    action_type: data?.action_type ?? null,
    action_description: data?.action_description ? enforceShortText(data.action_description, ACTION_DESC_MAX_CHARS) : null,
    summary: enforceShortText(data?.summary ?? "", SUMMARY_MAX_CHARS)
  };
}

// src/lib/textUtils.js
function extractDeadline(text) {
  if (!text) return null;
  const now = /* @__PURE__ */ new Date();
  const curYear = now.getFullYear();
  const toIso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const withDeadlineWord = text.match(/(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*\.?\s*(?:\([^)]{1,4}\))?\s*까지/);
  if (withDeadlineWord) {
    const m = parseInt(withDeadlineWord[1], 10);
    const d = parseInt(withDeadlineWord[2], 10);
    let year = curYear;
    if (m < now.getMonth() + 1 - 6) year += 1;
    return toIso(year, m, d);
  }
  const koreanDeadline = text.match(/(\d{1,2})월\s*(\d{1,2})일\s*까지/);
  if (koreanDeadline) {
    return toIso(curYear, parseInt(koreanDeadline[1], 10), parseInt(koreanDeadline[2], 10));
  }
  const fullDate = text.match(/(20\d{2})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})/);
  if (fullDate) {
    return toIso(parseInt(fullDate[1], 10), parseInt(fullDate[2], 10), parseInt(fullDate[3], 10));
  }
  return null;
}
var ACTION_HINTS = [
  "\uC81C\uCD9C",
  "\uD68C\uC2E0",
  "\uC2E0\uCCAD",
  "\uC7AC\uC0C1\uC2E0",
  "\uC7AC\uC81C\uCD9C",
  "\uC791\uC131\uD558\uC5EC \uC81C\uCD9C",
  "\uAE30\uD55C \uB0B4 \uC81C\uCD9C"
];
function guessRequiresAction(text) {
  if (!text) return false;
  return ACTION_HINTS.some((kw) => text.includes(kw));
}
function fillParsedFallback(parsed, rawText) {
  return {
    deadline: parsed?.deadline ?? extractDeadline(rawText),
    requires_action: parsed?.requires_action ?? guessRequiresAction(rawText)
  };
}

// extension/background.js
var POLL_ALARM_NAME = "coopDocPoll";
var POLL_PERIOD_MINUTES = 1;
chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  pollCoopDocs();
  pollApprovalStatus();
  pollStatusChanges();
});
chrome.runtime.onStartup.addListener(() => {
  setupAlarm();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM_NAME) {
    pollCoopDocs();
    pollApprovalStatus();
    pollStatusChanges();
  }
});
function setupAlarm() {
  chrome.alarms.create(POLL_ALARM_NAME, { periodInMinutes: POLL_PERIOD_MINUTES });
}
var APP_URL = chrome.runtime.getURL("dist/index.html");
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
async function diffCoopDocList(listItems, existingIds, checkStatusChanged) {
  const newItems = [];
  const changedItems = [];
  for (const item of listItems) {
    const id = item.aprvNo;
    if (!id) continue;
    if (!existingIds.has(id)) {
      newItems.push(item);
      continue;
    }
    const changed = await checkStatusChanged(id, { stGbn: item.stGbn });
    if (changed) changedItems.push(item);
  }
  return { newItems, changedItems };
}
var POLL_LOG_KEY = "pollLog";
var POLL_LOG_MAX = 300;
var SESSION_EXPIRED_NOTIFY_KEY = "lastSessionExpiredNotifyAt";
var SESSION_EXPIRED_NOTIFY_THROTTLE_MS = 30 * 60 * 1e3;
var COOP_FAIL_STREAK_KEY = "coopPollFailStreak";
var COOP_FAIL_STREAK_THRESHOLD = 2;
async function appendPollLog(entry) {
  try {
    const { [POLL_LOG_KEY]: existing = [] } = await chrome.storage.local.get(POLL_LOG_KEY);
    const next = [...existing, { ts: Date.now(), ...entry }].slice(-POLL_LOG_MAX);
    await chrome.storage.local.set({ [POLL_LOG_KEY]: next });
  } catch (err) {
    console.warn("[background] \uD3F4\uB9C1 \uB85C\uADF8 \uC800\uC7A5 \uC2E4\uD328:", err);
  }
}
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
      title: "ERP \uB85C\uADF8\uC778 \uC138\uC158 \uB9CC\uB8CC",
      message: "\uD611\uC870\uBB38 \uC790\uB3D9 \uC870\uD68C\uAC00 \uC911\uB2E8\uB410\uC2B5\uB2C8\uB2E4. kis.kbu.ac.kr\uC5D0 \uB2E4\uC2DC \uB85C\uADF8\uC778\uD574\uC8FC\uC138\uC694.",
      priority: 2
    });
  } catch (err) {
    console.warn("[background] \uC138\uC158 \uB9CC\uB8CC \uC54C\uB9BC \uC2E4\uD328:", err);
  }
}
var coopPollInProgress = false;
var approvalPollInProgress = false;
var statusChangePollInProgress = false;
async function pollCoopDocs() {
  if (coopPollInProgress) {
    console.log("[background] \uD611\uC870\uBB38 \uD3F4\uB9C1\uC774 \uC544\uC9C1 \uC9C4\uD589 \uC911 \u2014 \uC774\uBC88 \uC54C\uB78C\uC740 \uAC74\uB108\uB701\uB2C8\uB2E4.");
    return;
  }
  coopPollInProgress = true;
  try {
    await pollCoopDocsInner();
  } finally {
    coopPollInProgress = false;
  }
}
async function pollCoopDocsInner() {
  let listItems;
  try {
    listItems = await fetchMyCoopDocList();
  } catch (err) {
    const sessionExpired = err.code === "SESSION_EXPIRED_OR_UNEXPECTED_RESPONSE";
    console.error("[background] \uD611\uC870\uBB38\uC218\uC2E0\uD568 \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328:", err);
    await appendPollLog({
      ok: false,
      sessionExpired,
      error: String(err.message || err),
      responseSnippet: err.responseSnippet || null
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
  await chrome.storage.local.set({ [COOP_FAIL_STREAK_KEY]: 0 });
  await appendPollLog({ ok: true, count: listItems.length });
  const existingIds = await getAllCoopDocIds();
  const { newItems, changedItems } = await diffCoopDocList(
    listItems,
    existingIds,
    hasCoopDocStatusChanged
  );
  const isBaseline = !await getSyncBaselineDone("coop");
  if (isBaseline && newItems.length > 0) {
    console.log(
      `[background] \uD611\uC870\uBB38 \uCD5C\uCD08 \uB3D9\uAE30\uD654 \u2014 \uAE30\uC874 ${newItems.length}\uAC74\uC740 \uC54C\uB9BC \uC5C6\uC774 \uC800\uC7A5\uB9CC \uD569\uB2C8\uB2E4.`
    );
  }
  console.log(
    `[background] \uD611\uC870\uBB38\uC218\uC2E0\uD568 \uD3F4\uB9C1: \uCD1D ${listItems.length}\uAC74 (\uC2E0\uADDC ${newItems.length}, \uC0C1\uD0DC\uBCC0\uACBD ${changedItems.length})`
  );
  for (const item of newItems) {
    await handleNewCoopDoc(item, { silent: isBaseline });
  }
  for (const item of changedItems) {
    await handleChangedCoopDoc(item);
  }
  if (isBaseline) {
    await setSyncBaselineDone("coop");
  }
}
var APPROVAL_SOURCES = [
  { key: "expense", label: "\uC9C0\uCD9C/\uCD9C\uC7A5\uACB0\uC7AC\uD604\uD669", fetch: () => fetchExpenseTravelList() },
  { key: "internal", label: "\uB0B4\uBD80\uAE30\uC548\uACB0\uC7AC\uD604\uD669", fetch: () => fetchInternalDraftList() },
  // stGbn="02" = 진행(결재 대기중) — 나에게 결재 요청이 온 것 중 아직 안
  // 끝난 것만 본다. remindDaily: 처리 안 된 건 매일 REMIND_HOURS에 재알림.
  { key: "aprvMng", label: "\uC9C0\uCD9C\uCD9C\uC7A5\uACB0\uC7AC\uD558\uAE30", fetch: () => fetchApprovalPendingList({ stGbn: "02" }), remindDaily: true }
];
var REMIND_HOURS = [10, 14, 16];
function dateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
async function pollApprovalStatus() {
  if (approvalPollInProgress) {
    console.log("[background] \uACB0\uC7AC\uD604\uD669 \uD3F4\uB9C1\uC774 \uC544\uC9C1 \uC9C4\uD589 \uC911 \u2014 \uC774\uBC88 \uC54C\uB78C\uC740 \uAC74\uB108\uB701\uB2C8\uB2E4.");
    return;
  }
  approvalPollInProgress = true;
  try {
    await pollApprovalStatusInner();
  } finally {
    approvalPollInProgress = false;
  }
}
async function pollApprovalStatusInner() {
  const results = await Promise.allSettled(
    APPROVAL_SOURCES.map(
      (src) => src.fetch().then((rows) => (rows || []).map((r) => ({ ...r, _source: src.key })))
    )
  );
  results.forEach((res, i) => {
    if (res.status === "rejected") {
      console.warn(
        `[background] ${APPROVAL_SOURCES[i].label} \uC870\uD68C \uC2E4\uD328(menuId/pgmId \uBBF8\uAC80\uC99D\uC77C \uC218 \uC788\uC74C):`,
        res.reason
      );
    }
  });
  const bySource = /* @__PURE__ */ new Map();
  results.forEach((res, i) => {
    if (res.status === "fulfilled") bySource.set(APPROVAL_SOURCES[i].key, res.value);
  });
  if (bySource.size === 0) return;
  console.log(
    "[background] \uACB0\uC7AC\uD604\uD669 \uD3F4\uB9C1: " + APPROVAL_SOURCES.map((src) => `${src.label} ${bySource.get(src.key)?.length ?? "\uC2E4\uD328"}\uAC74`).join(", ")
  );
  const existingIds = await getAllApprovalItemIds();
  const isBaseline = !await getSyncBaselineDone("approval");
  for (const src of APPROVAL_SOURCES) {
    const items = bySource.get(src.key);
    if (!items) continue;
    for (const item of items) {
      const id = item.aprvNo;
      if (!id) continue;
      const draftTimestamp = item.draftDt ? new Date(item.draftDt).getTime() : null;
      const existing = existingIds.has(id) ? await getApprovalItem(id) : null;
      const firstSeenAt = draftTimestamp && !Number.isNaN(draftTimestamp) ? draftTimestamp : existing?.firstSeenAt || Date.now();
      const aprvLevel = item.aprvLevel || "";
      const lastAprvUser = item.lastAprvUser || "";
      if (!existingIds.has(id)) {
        if (!isBaseline) notifyNewApprovalItem(src.label, item);
      } else {
        const changed = await hasApprovalStatusChanged(id, {
          stGbn: item.stGbn,
          lastStGbn: item.lastStGbn,
          workStgCd: item.workStgCd,
          aprvLevel,
          lastAprvUser
        });
        if (changed) {
          notifyApprovalStatusChanged(src.label, item, {
            fromStage: existing?.aprvLevel || "",
            toStage: aprvLevel
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
        created_at: existing?.created_at || Date.now()
      });
    }
  }
  if (isBaseline) {
    await setSyncBaselineDone("approval");
  }
  await checkApprovalReminders();
}
function notifyNewApprovalItem(label, item) {
  chrome.notifications.create(`approval-new-${item.aprvNo}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: `\uC0C8 ${label} \uBB38\uC11C`,
    message: item.subject || `\uC0C8 ${label} \uBB38\uC11C\uAC00 \uB4F1\uB85D\uB410\uC2B5\uB2C8\uB2E4.`,
    priority: 1
  });
}
function notifyApprovalStatusChanged(label, item, stageChange) {
  const subjectLine = item.subject || label;
  let detailLine = "";
  if (stageChange?.fromStage && stageChange?.toStage && stageChange.fromStage !== stageChange.toStage) {
    detailLine = `${stageChange.fromStage} \u2192 ${stageChange.toStage}`;
  }
  chrome.notifications.create(`approval-status-${item.aprvNo}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: `${label} \uC0C1\uD0DC \uBCC0\uACBD`,
    message: detailLine ? `${subjectLine}
${detailLine}` : `${subjectLine} \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`,
    priority: 1
  });
}
async function checkApprovalReminders() {
  const pendingItems = await getAllApprovalItems("aprvMng");
  const now = /* @__PURE__ */ new Date();
  const todayKey = dateKey(now);
  for (const item of pendingItems) {
    if (!item.firstSeenAt) continue;
    const draftDate = new Date(item.firstSeenAt);
    const remindStart = new Date(draftDate);
    remindStart.setDate(remindStart.getDate() + 1);
    remindStart.setHours(0, 0, 0, 0);
    if (now < remindStart) continue;
    const sentReminders = item.sentReminders || [];
    let updated = false;
    for (const hour of REMIND_HOURS) {
      const slotKey = `${todayKey}_${hour}`;
      if (sentReminders.includes(slotKey)) continue;
      const triggerTime = new Date(now);
      triggerTime.setHours(hour, 0, 0, 0);
      if (now < triggerTime) continue;
      chrome.notifications.create(`approval-remind-${item.id}-${slotKey}`, {
        type: "basic",
        iconUrl: NOTIFICATION_ICON,
        title: "\uC9C0\uCD9C\uCD9C\uC7A5\uACB0\uC7AC\uD558\uAE30 \u2014 \uC544\uC9C1 \uCC98\uB9AC \uC548 \uB428",
        message: `${item.subject || item.id} \u2014 \uACB0\uC7AC \uB300\uAE30 \uC911\uC785\uB2C8\uB2E4. (${hour}\uC2DC \uB9AC\uB9C8\uC778\uB4DC)`,
        priority: 1
      });
      sentReminders.push(slotKey);
      updated = true;
    }
    if (updated) {
      await upsertApprovalItem({ ...item, sentReminders });
    }
  }
}
var MAX_STATUS_ROWS_PER_SYNC = 20;
var STATUS_SCHEMA_VERSION = 2;
var STATUS_CHANGE_MENU_ID = "M104947";
function statusChangeKey(row) {
  return `SREG-${row.stuno}-${row.schregModAplyDt}-${row.schregModGbn}`;
}
async function pollStatusChanges() {
  if (statusChangePollInProgress) {
    console.log("[background] \uD559\uC801\uBCC0\uB3D9 \uD3F4\uB9C1\uC774 \uC544\uC9C1 \uC9C4\uD589 \uC911 \u2014 \uC774\uBC88 \uC54C\uB78C\uC740 \uAC74\uB108\uB701\uB2C8\uB2E4.");
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, skipped: true, reason: "already_in_progress" };
  }
  statusChangePollInProgress = true;
  try {
    return await pollStatusChangesInner();
  } finally {
    statusChangePollInProgress = false;
  }
}
async function pollStatusChangesInner() {
  const toggles = await getFeatureToggles();
  if (!toggles.status) {
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, skipped: true };
  }
  let authorizedMenus;
  try {
    authorizedMenus = await fetchAuthMenuIds();
  } catch (err) {
    console.warn("[background] \uBA54\uB274 \uAD8C\uD55C \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328 \u2014 \uC548\uC804\uD558\uAC8C \uC774\uBC88 \uD559\uC801\uBCC0\uB3D9 \uD3F4\uB9C1\uC744 \uAC74\uB108\uB701\uB2C8\uB2E4:", err);
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, skipped: true, reason: "menu_check_failed" };
  }
  if (!authorizedMenus.has(STATUS_CHANGE_MENU_ID)) {
    console.warn(
      "[background] \uC774 \uACC4\uC815\uC740 \uD559\uC801\uBCC0\uB3D9\uC2B9\uC778\uCC98\uB9AC \uBA54\uB274 \uAD8C\uD55C\uC774 \uC5C6\uC2B5\uB2C8\uB2E4 \u2014 \uAE30\uB2A5\uC744 \uC790\uB3D9\uC73C\uB85C \uAED0\uC2B5\uB2C8\uB2E4:",
      STATUS_CHANGE_MENU_ID
    );
    await setFeatureEnabled("status", false);
    chrome.notifications.create("status-no-menu-permission", {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title: "\uD559\uC801\uBCC0\uB3D9\uB300\uC0C1\uC790\uBAA9\uB85D \uAE30\uB2A5 \uC790\uB3D9 \uBE44\uD65C\uC131\uD654",
      message: "\uC774 \uACC4\uC815\uC740 \uD559\uC801\uBCC0\uB3D9\uC2B9\uC778\uCC98\uB9AC \uBA54\uB274 \uAD8C\uD55C\uC774 \uC5C6\uC5B4 \uC790\uB3D9\uC73C\uB85C \uAED0\uC2B5\uB2C8\uB2E4.",
      priority: 1
    });
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, skipped: true, autoDisabled: true, reason: "no_menu_permission" };
  }
  let listRows;
  try {
    listRows = await fetchStatusChangeList();
  } catch (err) {
    console.warn(
      "[background] \uD559\uC801\uBCC0\uB3D9\uB300\uC0C1\uC790\uBAA9\uB85D \uC870\uD68C \uC2E4\uD328 \u2014 \uAD8C\uD55C\uC774 \uC5C6\uC744 \uC218 \uC788\uC5B4 \uC790\uB3D9\uC73C\uB85C \uAED0\uC2B5\uB2C8\uB2E4(\uC124\uC815 \uD0ED\uC5D0\uC11C \uB2E4\uC2DC \uCF24 \uC218 \uC788\uC74C):",
      err
    );
    await setFeatureEnabled("status", false);
    chrome.notifications.create("status-auto-disabled", {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title: "\uD559\uC801\uBCC0\uB3D9\uB300\uC0C1\uC790\uBAA9\uB85D \uAE30\uB2A5 \uC790\uB3D9 \uBE44\uD65C\uC131\uD654",
      message: "\uC870\uD68C \uAD8C\uD55C\uC774 \uC5C6\uB294 \uAC83 \uAC19\uC544 \uC790\uB3D9\uC73C\uB85C \uAED0\uC2B5\uB2C8\uB2E4. \uD544\uC694\uD558\uBA74 \uC124\uC815 \uD0ED\uC5D0\uC11C \uB2E4\uC2DC \uCF24 \uC218 \uC788\uC5B4\uC694.",
      priority: 1
    });
    return { total: 0, processed: 0, newCount: 0, changedCount: 0, autoDisabled: true };
  }
  const rows = (listRows || []).filter((r) => r.stuno).slice().sort((a, b) => (b.schregModAplyDt || "").localeCompare(a.schregModAplyDt || "")).slice(0, MAX_STATUS_ROWS_PER_SYNC);
  let newCount = 0;
  let changedCount = 0;
  const isBaseline = !await getSyncBaselineDone("statusChange");
  for (const row of rows) {
    const key = statusChangeKey(row);
    const prev = await getStatusChange(key);
    const changed = !prev || prev.accpCnt !== row.accpCnt || prev.schemaVersion !== STATUS_SCHEMA_VERSION;
    if (!changed) continue;
    let stages = prev ? prev.stages || [] : [];
    try {
      const stageRows = await fetchStatusChangeStages(row.stuno, row.schregModAplyDt, row.schregModGbn);
      stages = (stageRows || []).map((s) => ({
        accpObjGbnNm: s.accpObjGbnNm || "",
        accpGbnNm: s.accpGbnNm || "",
        empNm: s.empNm || "",
        recaResn: s.recaResn || "",
        // 반려 사유
        raw: s
      }));
    } catch (err) {
      console.warn("[background] \uD559\uC801\uBCC0\uB3D9 \uC2B9\uC778\uB2E8\uACC4 \uC870\uD68C \uC2E4\uD328:", key, err);
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
      created_at: prev?.created_at || Date.now()
    };
    if (prev && prev.stages) {
      for (const stage of stages) {
        const prevStage = prev.stages.find((s) => s.accpObjGbnNm === stage.accpObjGbnNm);
        if (prevStage && prevStage.accpGbnNm !== stage.accpGbnNm) {
          chrome.notifications.create({
            type: "basic",
            iconUrl: NOTIFICATION_ICON,
            title: "\uD559\uC801\uBCC0\uB3D9 \uC2B9\uC778 \uC9C4\uD589",
            message: `${doc.stdKorNm}(${doc.stuno}) \xB7 ${doc.schregModGbnNm} \xB7 ${stage.accpObjGbnNm}: ${prevStage.accpGbnNm} \u2192 ${stage.accpGbnNm}`,
            priority: 1
          });
        }
      }
    }
    await upsertStatusChange(doc);
    if (!prev) {
      newCount++;
      if (!isBaseline) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: NOTIFICATION_ICON,
          title: "\uC0C8 \uD559\uC801\uBCC0\uB3D9 \uC2E0\uCCAD",
          message: `${doc.stdKorNm}(${doc.stuno}) \xB7 ${doc.schregModGbnNm} \xB7 ${doc.deptNm}`,
          priority: 1
        });
      }
    } else {
      changedCount++;
    }
  }
  if (isBaseline) {
    await setSyncBaselineDone("statusChange");
  }
  return { total: listRows.length, processed: rows.length, newCount, changedCount };
}
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
function isTooOldForAiSummary(item, maxAgeDays) {
  if (!maxAgeDays || maxAgeDays <= 0) return false;
  const dateStr = normalizeDocDate(item);
  if (!dateStr) return false;
  const docTime = (/* @__PURE__ */ new Date(`${dateStr}T00:00:00`)).getTime();
  if (Number.isNaN(docTime)) return false;
  const ageMs = Date.now() - docTime;
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1e3;
}
async function handleNewCoopDoc(item, { silent = false } = {}) {
  const aprvNo = item.aprvNo;
  let rawText = item.ctnt ?? item.subject ?? "";
  let rawHtml = "";
  let bodyUnavailable = void 0;
  let rawTextVersion = void 0;
  let parsed = null;
  const autoFetch = await getAutoDetailFetchOnArrival();
  if (!autoFetch) {
    await upsertCoopDoc(
      buildCoopDocRecord(item, { rawText, rawHtml, bodyUnavailable, rawTextVersion, parsed, isNew: !silent })
    );
    if (!silent) notifyNewCoopDoc(item);
    return;
  }
  try {
    const detailRows = await fetchCoopDocDetail({ aprvNo });
    const detail = detailRows[0];
    if (detail) {
      const extracted = extractDetailText(detail);
      if (extracted) {
        rawText = extracted;
        rawHtml = extractDetailHtml(detail);
        bodyUnavailable = false;
      } else {
        bodyUnavailable = true;
        rawText = "";
      }
      rawTextVersion = RAW_TEXT_EXTRACT_VERSION;
    }
  } catch (err) {
    console.warn(`[background] \uD611\uC870\uBB38 \uC0C1\uC138 \uC870\uD68C \uC2E4\uD328 (aprvNo=${aprvNo}), \uBAA9\uB85D \uC815\uBCF4\uB85C \uB300\uCCB4:`, err);
  }
  const maxAgeDays = await getAiSummaryMaxAgeDays();
  const tooOld = isTooOldForAiSummary(item, maxAgeDays);
  if (!silent && tooOld) {
    console.log(
      `[background] \uBB38\uC11C\uAC00 AI \uC694\uC57D \uB300\uC0C1 \uAE30\uAC04(${maxAgeDays}\uC77C)\uBCF4\uB2E4 \uC624\uB798\uB3FC\uC11C AI \uD30C\uC2F1\uC744 \uAC74\uB108\uB701\uB2C8\uB2E4 (aprvNo=${aprvNo})`
    );
  }
  if (!silent && !tooOld && await getAiSummaryEnabled()) {
    try {
      parsed = await parseCoopDoc(rawText, aprvNo);
    } catch (err) {
      console.error(`[background] AI \uD30C\uC2F1 \uC2E4\uD328 (aprvNo=${aprvNo}):`, err);
    }
  }
  await upsertCoopDoc(
    buildCoopDocRecord(item, { rawText, rawHtml, bodyUnavailable, rawTextVersion, parsed, isNew: !silent })
  );
  if (!silent) notifyNewCoopDoc(item);
}
function buildCoopDocRecord(item, { rawText, rawHtml, bodyUnavailable, rawTextVersion, parsed, isNew = true }) {
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
    // 2026-09-05(4) 추가: 이 요약이 어느 프롬프트 버전으로 만들어졌는지 기록.
    // parsed가 없으면(AI 스킵/실패) null — useStore.js가 재요약 대상 판단에 씀.
    ai_summary_prompt_version: parsed ? PROMPT_VERSION : null,
    // 2026-09-05(2) 추가: "회신/제출/확인" 등 처리유형을 요약 본문과 분리된
    // 필드로 저장 — CoopCard.jsx가 이 값으로 배지를 바로 보여준다.
    action_type: parsed?.action_type ?? null,
    deadline: fallback.deadline,
    requires_action: fallback.requires_action,
    // 규칙 기반 값인지 AI 값인지 UI에서 구분하고 싶을 때 참고용 플래그
    // ("AI요약" 라벨과 마찬가지로 사용자에게 출처를 숨기지 않기 위함).
    deadline_is_fallback: parsed?.deadline == null,
    requires_action_is_fallback: parsed?.requires_action == null,
    action_description: parsed?.action_description ?? null,
    // 2026-09-05 수정: 예전엔 항상 true였는데, 베이스라인(최초 동기화) 중에
    // silent로 들어온 문서까지 전부 "안 읽음" 배지가 붙는 문제가 있었음 —
    // 알림은 안 뜨는데 정작 화면엔 전부 신규로 표시되는 불일치. 이제 베이스라인
    // 문서는 isNew=false로 저장해서 알림 여부와 화면 표시가 일치한다.
    is_new: isNew,
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
    stGbn: item.stGbn
  };
}
async function handleChangedCoopDoc(item) {
  const existing = await getCoopDoc(item.aprvNo);
  if (!existing) return;
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
    recv_dept_version: RECV_DEPT_SCHEMA_VERSION
  });
  notifyStatusChanged(item);
}
var NOTIFICATION_ICON = "icons/icon128.png";
function notifyNewCoopDoc(item) {
  chrome.notifications.create(`coop-new-${item.aprvNo}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: "\uC0C8 \uD611\uC870\uBB38 \uB3C4\uCC29",
    message: item.subject || "\uC0C8 \uD611\uC870\uBB38\uC774 \uB3C4\uCC29\uD588\uC2B5\uB2C8\uB2E4.",
    priority: 1
  });
}
function notifyStatusChanged(item) {
  chrome.notifications.create(`coop-status-${item.aprvNo}-${Date.now()}`, {
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title: "\uACB0\uC7AC \uC0C1\uD0DC \uBCC0\uACBD",
    message: `${item.subject || "\uD611\uC870\uBB38"} \uC0C1\uD0DC\uAC00 \uBCC0\uACBD\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`,
    priority: 1
  });
}
export {
  diffCoopDocList,
  pollApprovalStatus,
  pollCoopDocs,
  pollStatusChanges
};
