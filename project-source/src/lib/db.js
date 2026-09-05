// src/lib/db.js
// IndexedDB 헬퍼 모듈. 모든 IndexedDB 작업은 반드시 이 파일을 통해서만 수행한다.
// (지침 "코딩 규칙" — IndexedDB 작업은 반드시 lib/db.js 헬퍼 함수로 추상화)

import { openDB } from "idb";

const DB_NAME = "admin-assistant";
// 2026-08-23(4): 캘린더 탭 "투두 리스트 + 메모" 기능 추가하면서 todos/notes
// 스토어 신설 — DB_VERSION을 1→2로 올림. openDB의 upgrade 콜백은
// objectStoreNames.contains 체크로 스토어별 추가 여부를 판단하므로(기존
// coopDocs/attachmentBlobs는 이미 있어서 스킵, 새 스토어만 생성) 기존 사용자
// 데이터는 그대로 보존됨.
// 2026-08-23(5): 결재현황(지출/출장, 내부기안) 폴링용 스냅샷 스토어 추가로
// 2→3.
// 4단계 계속 + 5단계(kbu-assistant 이식): 부서코드/기능토글 설정을 담을
// meta 스토어 추가로 4→5.
const DB_VERSION = 5;

const STORE_COOP_DOCS = "coopDocs";
const STORE_ATTACHMENT_BLOBS = "attachmentBlobs";
const STORE_TODOS = "todos";
const STORE_NOTES = "notes";
const STORE_APPROVAL_ITEMS = "approvalItems";
const STORE_STATUS_CHANGES = "statusChanges";
const STORE_META = "meta";

/**
 * @typedef {Object} Attachment
 * @property {string} name
 * @property {string} blobKey
 */

/**
 * @typedef {Object} CoopDoc
 * @property {string} id                    ERP aprvNo를 그대로 사용 (신규/변경 스냅샷 비교 키)
 * @property {string} title
 * @property {string} sender_dept
 * @property {string} [drafter]              기안자 이름 (목록 API의 draftEmpNm, 2026-08-19 추가)
 * @property {string} date
 * @property {string} raw_text
 * @property {string} [raw_html]             표/목록 구조가 살아있는 정제 HTML
 *   (kisApi.js extractDetailHtml 결과). 있으면 CoopDetailModal이 이걸 우선
 *   렌더링해서 실제 <table>로 보여줌 — 2026-08-19 추가
 * @property {boolean} [body_unavailable]    ERP 응답에 본문 텍스트 필드가 아예 없는
 *   문서(공문 서식형, 2026-08-19 실측)로 확인됨 — true면 재조회 스킵
 * @property {number} [raw_text_version]     raw_text를 추출할 때 사용한
 *   kisApi.js RAW_TEXT_EXTRACT_VERSION 값. 이 값이 현재 버전보다 낮으면 상세
 *   팝업을 열 때 한 번 재추출해서 최신 포맷(예: 표 구분자)으로 갱신함
 * @property {string} ai_summary
 * @property {string|null} deadline          YYYY-MM-DD or null
 * @property {boolean} requires_action
 * @property {string|null} action_description
 * @property {boolean} is_new
 * @property {boolean} is_completed
 * @property {boolean} calendar_registered
 * @property {Attachment[]} attachments  ⚠️ 사실상 미사용 (2026-08-21 이전 스텁).
 *   첨부파일은 이제 attachNo로 라이브 조회하는 방식으로 바뀜 — 아래 attachNo 참고
 * @property {string|null} [attachNo]  첨부그룹 식별자 (목록/상세 API의 attachNo
 *   필드, 2026-08-21 추가). null/미설정이면 첨부파일 없는 문서. 값이 있으면
 *   상세 팝업을 열 때 kisApi.js fetchAttachments(attachNo)로 실제 파일 목록을
 *   라이브 조회한다(파일 자체를 폴링마다 미리 안 받아옴 — 팀원 실측 방식 그대로)
 * @property {string|null} [recv_dept_code]  이 문서의 실제 수신 부서 코드.
 *   2026-08-21 추가, 2026-08-22 정정: 처음엔 "어느 docDeptCd로 조회했을 때
 *   받아왔는지"로 잘못 채웠었는데(ERP "부서" 드롭다운이 목록을 필터링한다고
 *   오해), 실측(ERP 스크린샷 3장 + findIntAprvDeptDocList.do 실제 응답 XML)으로
 *   드롭다운이 필터링을 안 한다는 게 밝혀짐. 올바른 값은 응답 Row 자체의
 *   rcvDeptCd 필드("수신부서" 컬럼) — kisApi.js가 파싱한 row에서 그대로 가져옴.
 * @property {string|null} [recv_dept_name]  위 코드에 대응하는 부서명(rcvDeptNm).
 *   드롭다운 필터(DeptFilterSelect)/그룹 헤더 표시용
 * @property {number} [recv_dept_version]  recv_dept_code/name을 채운 로직의
 *   버전(kisApi.js RECV_DEPT_SCHEMA_VERSION). 2 미만(또는 없음)이면 옛날 버그
 *   로직(v1)으로 채워졌을 수 있으므로 useStore.js backfillMissingDrafters가
 *   강제로 재보정 대상에 포함시킨다.
 * @property {number|null} [out_of_scope_flagged_at]  useStore.js
 *   pruneOutOfScopeCoopDocs가 이 문서를 부서 범위 밖으로 처음 감지한 시각
 *   (Date.now()). 2026-08-22 추가 — 감지 즉시 삭제하면 ERP 조회가 일시적으로
 *   불완전했을 때 멀쩡한 문서가 지워졌다가 다음 폴링에서 "신규 문서"로 오판돼
 *   NEW 배지가 잘못 붙는 문제가 있어서, 2회 연속 범위 밖으로 확인돼야 실제
 *   삭제하도록 유예 기간을 둠. 범위 안으로 돌아오면 null로 초기화됨.
 * @property {number} created_at             Date.now()
 * @property {string} [stGbn]                ERP 상태값 (변경 감지용, 선택)
 * @property {string} [lastStGbn]
 * @property {string} [workStgCd]
 * @property {string|null} [memo]  캘린더 탭 투두 리스트에서 이 문서(처리해야
 *   할 일로 뜬 것)에 남긴 개인 메모. 2026-08-23(4) 추가.
 */

/**
 * @typedef {Object} AttachmentBlob
 * @property {string} key       PK (예: `${coopId}_${fileName}`)
 * @property {string} fileName
 * @property {string} mimeType
 * @property {Blob} blob
 * @property {string} coopId
 * @property {number} saved_at
 */

/** @type {Promise<import("idb").IDBPDatabase>|null} */
let dbPromise = null;

/**
 * DB 연결을 초기화하고 캐싱된 connection promise를 반환한다.
 * 여러 곳에서 호출해도 실제 openDB는 1회만 실행됨.
 * @returns {Promise<import("idb").IDBPDatabase>}
 */
export function initDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_COOP_DOCS)) {
          const coopStore = db.createObjectStore(STORE_COOP_DOCS, {
            keyPath: "id",
          });
          coopStore.createIndex("by_is_new", "is_new");
          coopStore.createIndex("by_requires_action", "requires_action");
          coopStore.createIndex("by_is_completed", "is_completed");
          coopStore.createIndex("by_created_at", "created_at");
          coopStore.createIndex("by_deadline", "deadline");
        }

        if (!db.objectStoreNames.contains(STORE_ATTACHMENT_BLOBS)) {
          const attachStore = db.createObjectStore(STORE_ATTACHMENT_BLOBS, {
            keyPath: "key",
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
      },
    });
  }
  return dbPromise;
}

function makeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// coopDocs
// ---------------------------------------------------------------------------

/**
 * 협조문 문서를 새로 추가하거나(id 없으면) 기존 문서를 덮어쓴다(id 있으면).
 * background.js가 목록 API 스냅샷 비교 후 신규/변경 항목을 저장할 때 사용.
 * @param {CoopDoc} doc
 * @returns {Promise<string>} 저장된 문서의 id
 */
export async function upsertCoopDoc(doc) {
  const db = await initDB();
  await db.put(STORE_COOP_DOCS, doc);
  return doc.id;
}

/**
 * id로 단일 협조문 조회.
 * @param {string} id
 * @returns {Promise<CoopDoc|undefined>}
 */
export async function getCoopDoc(id) {
  const db = await initDB();
  return db.get(STORE_COOP_DOCS, id);
}

/**
 * 모든 협조문 조회 (최신순 정렬).
 * @returns {Promise<CoopDoc[]>}
 */
export async function getAllCoopDocs() {
  const db = await initDB();
  const all = await db.getAll(STORE_COOP_DOCS);
  // created_at(=우리가 저장한 시각)이 아니라 실제 문서 날짜(date, YYYY-MM-DD) 기준
  // 내림차순 정렬. 한 번의 폴링에서 여러 건이 거의 동시에 저장되면 created_at으로는
  // 정렬이 안 된 것처럼 보이는 문제가 있었음. 같은 날짜면 aprvNo(=id, ERP가 순차
  // 발급하는 번호라 최근일수록 큼) 내림차순으로 2차 정렬.
  return all.sort((a, b) => {
    const dateA = a.date || "";
    const dateB = b.date || "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return (b.id || "").localeCompare(a.id || "");
  });
}

/**
 * background.js의 신규/변경 감지용 — 현재 저장된 모든 문서의 id 집합을 반환.
 * (aprvNo 기준 이전 스냅샷과 비교하는 데 사용)
 * @returns {Promise<Set<string>>}
 */
export async function getAllCoopDocIds() {
  const db = await initDB();
  const keys = await db.getAllKeys(STORE_COOP_DOCS);
  return new Set(keys);
}

/**
 * 새로 도착한 협조문만 조회 (Navbar 벨 드롭다운 / 토스트용).
 * ⚠️ by_is_new 인덱스로 IDBKeyRange.only(true/false)를 쓰면 안 됨 — IndexedDB는
 * boolean을 유효한 key 타입으로 인정하지 않아서 매번 DataError로 조용히 실패했었음
 * (실측: 콘솔에 "Failed to execute 'only' on 'IDBKeyRange': The parameter is not
 * a valid key" 반복 발생, 새 협조문 토스트가 동작 안 하던 원인). getAll() 후 JS
 * filter로 대체.
 * @returns {Promise<CoopDoc[]>}
 */
export async function getNewCoopDocs() {
  const db = await initDB();
  const all = await db.getAll(STORE_COOP_DOCS);
  return all.filter((doc) => doc.is_new === true).sort((a, b) => b.created_at - a.created_at);
}

/**
 * 처리 필요(requires_action=true) && 미완료(is_completed=false) 문서 조회.
 * CalendarPage의 TaskPanel에서 사용. (⚠️ 위 getNewCoopDocs와 동일한 이유로
 * by_requires_action 인덱스의 IDBKeyRange.only(true) 대신 getAll()+filter 사용)
 * @returns {Promise<CoopDoc[]>}
 */
export async function getPendingActionDocs() {
  const db = await initDB();
  const all = await db.getAll(STORE_COOP_DOCS);
  return all
    .filter((doc) => doc.requires_action === true && !doc.is_completed)
    .sort((a, b) => {
      // deadline 있는 문서를 먼저, 그 중 임박한 순
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return b.created_at - a.created_at;
    });
}

/**
 * 문서를 "읽음" 처리 (is_new -> false). 상세 팝업을 열 때 호출.
 * @param {string} id
 */
export async function markCoopDocRead(id) {
  const db = await initDB();
  const doc = await db.get(STORE_COOP_DOCS, id);
  if (!doc) return;
  doc.is_new = false;
  await db.put(STORE_COOP_DOCS, doc);
}

/**
 * 처리 완료 표시. TaskPanel 액션 목록에서 제거되지만 캘린더 dot은 유지됨
 * (UI 규칙: 완료 처리 = 액션 목록에서 제거 + 캘린더 dot 유지).
 * @param {string} id
 */
export async function markCoopDocCompleted(id) {
  const db = await initDB();
  const doc = await db.get(STORE_COOP_DOCS, id);
  if (!doc) return;
  doc.is_completed = true;
  await db.put(STORE_COOP_DOCS, doc);
}

/**
 * 협조문(처리해야 할 일로 뜬 문서)에 개인 메모 저장. TaskPanel의 항목별 +
 * 버튼에서 사용. 2026-08-23(4) 추가.
 * @param {string} id
 * @param {string} memo
 */
export async function setCoopDocMemo(id, memo) {
  const db = await initDB();
  const doc = await db.get(STORE_COOP_DOCS, id);
  if (!doc) return;
  doc.memo = memo && memo.trim() ? memo.trim() : null;
  await db.put(STORE_COOP_DOCS, doc);
}

/**
 * 캘린더 등록 완료 표시. "캘린더 등록됨" 버튼 비활성화 및 그리드 dot 표시에 사용.
 * @param {string} id
 */
export async function markCoopDocCalendarRegistered(id) {
  const db = await initDB();
  const doc = await db.get(STORE_COOP_DOCS, id);
  if (!doc) return;
  doc.calendar_registered = true;
  await db.put(STORE_COOP_DOCS, doc);
}

/**
 * ERP 상태값(stGbn/lastStGbn/workStgCd)이 이전 저장값과 달라졌는지 비교.
 * background.js가 5분 폴링마다 "결재 상태 변경" 알림을 띄울지 판단하는 데 사용.
 * @param {string} id
 * @param {{stGbn?: string, lastStGbn?: string, workStgCd?: string}} latest
 * @returns {Promise<boolean>} 변경되었으면 true
 */
export async function hasCoopDocStatusChanged(id, latest) {
  const existing = await getCoopDoc(id);
  if (!existing) return false; // 신규 문서는 "변경"이 아니라 "신규" 알림 쪽에서 처리
  return (
    (latest.stGbn !== undefined && latest.stGbn !== existing.stGbn) ||
    (latest.lastStGbn !== undefined && latest.lastStGbn !== existing.lastStGbn) ||
    (latest.workStgCd !== undefined && latest.workStgCd !== existing.workStgCd)
  );
}

/**
 * 협조문 삭제 (관련 첨부파일 blob도 함께 정리).
 * @param {string} id
 */
export async function deleteCoopDoc(id) {
  const db = await initDB();
  const attachments = await db.getAllFromIndex(STORE_ATTACHMENT_BLOBS, "by_coopId", id);
  const tx = db.transaction([STORE_COOP_DOCS, STORE_ATTACHMENT_BLOBS], "readwrite");
  await tx.objectStore(STORE_COOP_DOCS).delete(id);
  await Promise.all(
    attachments.map((a) => tx.objectStore(STORE_ATTACHMENT_BLOBS).delete(a.key))
  );
  await tx.done;
}

// ---------------------------------------------------------------------------
// attachmentBlobs
// ---------------------------------------------------------------------------

/**
 * 첨부파일 blob 저장.
 * @param {AttachmentBlob} attachment
 * @returns {Promise<string>} key
 */
export async function saveAttachmentBlob(attachment) {
  const db = await initDB();
  await db.put(STORE_ATTACHMENT_BLOBS, attachment);
  return attachment.key;
}

/**
 * key로 첨부파일 blob 조회.
 * @param {string} key
 * @returns {Promise<AttachmentBlob|undefined>}
 */
export async function getAttachmentBlob(key) {
  const db = await initDB();
  return db.get(STORE_ATTACHMENT_BLOBS, key);
}

/**
 * 특정 협조문에 속한 모든 첨부파일 조회.
 * @param {string} coopId
 * @returns {Promise<AttachmentBlob[]>}
 */
export async function getAttachmentsByCoopId(coopId) {
  const db = await initDB();
  return db.getAllFromIndex(STORE_ATTACHMENT_BLOBS, "by_coopId", coopId);
}

/**
 * 첨부파일 blob 삭제.
 * @param {string} key
 */
export async function deleteAttachmentBlob(key) {
  const db = await initDB();
  await db.delete(STORE_ATTACHMENT_BLOBS, key);
}

// ---------------------------------------------------------------------------
// todos — 캘린더 탭 "투두 리스트" (2026-08-23(4) 추가). 협조문에서 자동으로
// 뽑히는 "처리해야 할 일"(requires_action 문서, getPendingActionDocs)과는
// 별개로, 사용자가 직접 자유롭게 추가하는 할 일. 항목마다 memo(간단 메모)를
// 붙일 수 있음(Stitch 시안의 "항목별 + 버튼" 요청 반영).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Todo
 * @property {string} id
 * @property {string} text
 * @property {boolean} done
 * @property {string|null} memo
 * @property {string|null} date  "YYYY-MM-DD" — 이 할 일이 연결된 날짜(캘린더에서
 *   날짜를 먼저 고르고 추가하거나, 추가할 때 직접 지정). 2026-08-23(11) 추가 —
 *   그전엔 할 일에 날짜 개념이 아예 없어서 캘린더 쪽과 연결이 안 됐었음.
 * @property {number} created_at
 */

/**
 * 새 할 일 추가.
 * @param {string} text
 * @param {string|null} [date] "YYYY-MM-DD"
 * @returns {Promise<Todo>}
 */
export async function addTodo(text, date = null) {
  const db = await initDB();
  const todo = { id: makeId(), text, done: false, memo: null, date: date || null, created_at: Date.now() };
  await db.put(STORE_TODOS, todo);
  return todo;
}

/**
 * 할 일의 날짜를 바꾼다(캘린더에서 날짜를 눌러 기존 할 일에 연결하는 용도로도 씀).
 * @param {string} id
 * @param {string|null} date "YYYY-MM-DD" or null(날짜 없음으로 되돌리기)
 */
export async function setTodoDate(id, date) {
  const db = await initDB();
  const todo = await db.get(STORE_TODOS, id);
  if (!todo) return;
  todo.date = date || null;
  await db.put(STORE_TODOS, todo);
}

/**
 * 전체 할 일 조회 (미완료 먼저, 그 안에서는 날짜 있는 게 먼저 · 최근 추가 순).
 * @returns {Promise<Todo[]>}
 */
export async function getAllTodos() {
  const db = await initDB();
  const all = await db.getAll(STORE_TODOS);
  return all.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return b.created_at - a.created_at;
  });
}

/**
 * 완료 상태 토글.
 * @param {string} id
 */
export async function toggleTodoDone(id) {
  const db = await initDB();
  const todo = await db.get(STORE_TODOS, id);
  if (!todo) return;
  todo.done = !todo.done;
  await db.put(STORE_TODOS, todo);
}

/**
 * 할 일 항목에 메모 저장(빈 문자열이면 null로 정리).
 * @param {string} id
 * @param {string} memo
 */
export async function setTodoMemo(id, memo) {
  const db = await initDB();
  const todo = await db.get(STORE_TODOS, id);
  if (!todo) return;
  todo.memo = memo && memo.trim() ? memo.trim() : null;
  await db.put(STORE_TODOS, todo);
}

/**
 * 할 일 삭제.
 * @param {string} id
 */
export async function deleteTodo(id) {
  const db = await initDB();
  await db.delete(STORE_TODOS, id);
}

// ---------------------------------------------------------------------------
// notes — 캘린더 탭 하단 "메모" (2026-08-23(4) 추가). 특정 할 일/문서에 매인
// 게 아니라 완전히 자유로운 메모장 용도.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Note
 * @property {string} id
 * @property {string} title  목록엔 이것만 표시하고, 클릭하면 text(내용)가 펼쳐짐
 *   (2026-08-23(11) 추가 — 그전엔 title 없이 본문만 있었음. 예전에 저장된
 *   메모는 title이 없을 수 있으니, 읽는 쪽에서 text 앞부분으로 대체 표시함).
 * @property {string} text
 * @property {number} created_at
 */

/**
 * 새 메모 추가.
 * @param {string} title
 * @param {string} text
 * @returns {Promise<Note>}
 */
export async function addNote(title, text) {
  const db = await initDB();
  const note = { id: makeId(), title, text, created_at: Date.now() };
  await db.put(STORE_NOTES, note);
  return note;
}

/**
 * 전체 메모 조회 (최신순).
 * @returns {Promise<Note[]>}
 */
export async function getAllNotes() {
  const db = await initDB();
  const all = await db.getAll(STORE_NOTES);
  return all.sort((a, b) => b.created_at - a.created_at);
}

/**
 * 메모 삭제.
 * @param {string} id
 */
export async function deleteNote(id) {
  const db = await initDB();
  await db.delete(STORE_NOTES, id);
}

// ---------------------------------------------------------------------------
// approvalItems — 결재현황(지출/출장, 내부기안, 지출출장결재하기) 폴링
// 스냅샷 (2026-08-23(5) 추가, 2026-08-23(6)에 aprvMngList/aprvLevel/
// lastAprvUser/리마인더 지원 확장). 협조문(coopDocs)처럼 본문 전체를
// 저장하지 않고, "새 항목/상태 변경/리마인드" 감지에 필요한 최소 필드만
// 가볍게 저장한다.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ApprovalItem
 * @property {string} id            aprvNo
 * @property {string} source        "expense" | "internal" | "aprvMng"
 * @property {string} subject
 * @property {string} deptNm
 * @property {string} [stGbn]
 * @property {string} [lastStGbn]
 * @property {string} [workStgCd]
 * @property {string} [aprvLevel]     현재 결재 단계(실제 결재자 표시용, 2026-08-23(6) 추가).
 *   coopDocs와 마찬가지로 workStgCd는 업무유형 코드에 가까워서 결재자가
 *   바뀌어도 안 바뀌는 경우가 있어, "누가/어느 단계에" 결재 중인지는 이
 *   필드로 판단한다.
 * @property {string} [lastAprvUser] 마지막으로 처리한 결재자 이름
 * @property {number} [firstSeenAt]  최초 발견 시각 — aprvMng(지출출장결재하기)
 *   리마인더 기준 시점. draftDt가 있으면 그 값을, 없으면 최초 발견 시각을 씀.
 * @property {string[]} [sentReminders]  이미 보낸 리마인드 슬롯 기록
 *   (예: ["2026-08-23_10", "2026-08-23_14"]) — aprvMng 항목에만 사용.
 * @property {number} created_at
 */

/**
 * 저장된 모든 결재현황 항목의 id 집합 (신규 감지용).
 * @returns {Promise<Set<string>>}
 */
export async function getAllApprovalItemIds() {
  const db = await initDB();
  const keys = await db.getAllKeys(STORE_APPROVAL_ITEMS);
  return new Set(keys);
}

/**
 * id로 단일 결재현황 항목 조회.
 * @param {string} id
 * @returns {Promise<ApprovalItem|undefined>}
 */
export async function getApprovalItem(id) {
  const db = await initDB();
  return db.get(STORE_APPROVAL_ITEMS, id);
}

/**
 * source 기준 전체 결재현황 항목 조회 (2026-08-23(6) 추가 — aprvMng 리마인더
 * 순회용). source를 생략하면 전체를 반환한다.
 * @param {string} [source]
 * @returns {Promise<ApprovalItem[]>}
 */
export async function getAllApprovalItems(source) {
  const db = await initDB();
  const all = await db.getAll(STORE_APPROVAL_ITEMS);
  return source ? all.filter((item) => item.source === source) : all;
}

/**
 * 결재현황 항목 저장(신규 추가 또는 덮어쓰기).
 * @param {ApprovalItem} item
 */
export async function upsertApprovalItem(item) {
  const db = await initDB();
  await db.put(STORE_APPROVAL_ITEMS, item);
}

/**
 * stGbn/lastStGbn/workStgCd/aprvLevel/lastAprvUser 중 하나라도 이전
 * 저장값과 달라졌는지 비교. coopDocs의 hasCoopDocStatusChanged와 동일한
 * 패턴 — 값의 의미는 몰라도 "바뀌었다"는 사실만으로 알림 여부를 판단할 수
 * 있다. 2026-08-23(6): aprvLevel/lastAprvUser 비교 추가 — workStgCd만으로는
 * 같은 건 안에서 결재자가 바뀌어도(예: 김양진→정계동) 감지 못 하는 경우가
 * 있어서(coopDocs 쪽에서 이미 확인된 문제), 결재현황 쪽도 같은 필드를 본다.
 * @param {string} id
 * @param {{stGbn?: string, lastStGbn?: string, workStgCd?: string, aprvLevel?: string, lastAprvUser?: string}} latest
 * @returns {Promise<boolean>}
 */
export async function hasApprovalStatusChanged(id, latest) {
  const existing = await getApprovalItem(id);
  if (!existing) return false;
  return (
    (latest.stGbn !== undefined && latest.stGbn !== existing.stGbn) ||
    (latest.lastStGbn !== undefined && latest.lastStGbn !== existing.lastStGbn) ||
    (latest.workStgCd !== undefined && latest.workStgCd !== existing.workStgCd) ||
    (latest.aprvLevel !== undefined && latest.aprvLevel !== existing.aprvLevel) ||
    (latest.lastAprvUser !== undefined && latest.lastAprvUser !== existing.lastAprvUser)
  );
}

// ---------------------------------------------------------------------------
// statusChanges — 학적변동대상자목록 폴링 스냅샷 (4단계, kbu-assistant
// KisDB의 kind:"statusChange" 문서를 별도 스토어로 이식). approvalItems와
// 마찬가지로 본문 전체가 아니라 "새 신청/단계 변경" 감지에 필요한 필드만
// 가볍게 저장한다.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} StatusChangeStage
 * @property {string} accpObjGbnNm  단계 이름(학과조교/지도교수/학과장/최종승인부서 등)
 * @property {string} accpGbnNm     그 단계의 처리 상태
 * @property {string} empNm         처리자 이름
 */

/**
 * @typedef {Object} StatusChange
 * @property {string} id                     `SREG-${stuno}-${schregModAplyDt}-${schregModGbn}`
 * @property {string} stuno                  학번
 * @property {string} stdKorNm               학생 이름
 * @property {string} deptNm                 소속 학과
 * @property {string} schregModDeptNm
 * @property {string} schregModGbnNm         학적변동 구분(휴학/복학 등)
 * @property {string} schregModResnGbnNm
 * @property {string} schregModDetaResnGbnNm
 * @property {string} schregModAplyDt        신청일
 * @property {string} hy
 * @property {string} class
 * @property {string} tutorNm                지도교수
 * @property {string} accpCnt                승인 진행 카운트 (변경 감지용)
 * @property {string} attachNm
 * @property {StatusChangeStage[]} stages
 * @property {number} created_at
 */

/**
 * id로 단일 학적변동 항목 조회.
 * @param {string} id
 * @returns {Promise<StatusChange|undefined>}
 */
export async function getStatusChange(id) {
  const db = await initDB();
  return db.get(STORE_STATUS_CHANGES, id);
}

/**
 * 전체 학적변동 항목 조회 (최신 신청일 우선 정렬).
 * @returns {Promise<StatusChange[]>}
 */
export async function getAllStatusChanges() {
  const db = await initDB();
  const all = await db.getAll(STORE_STATUS_CHANGES);
  return all.sort((a, b) => (b.schregModAplyDt || "").localeCompare(a.schregModAplyDt || ""));
}

/**
 * 학적변동 항목 저장(신규 추가 또는 덮어쓰기).
 * @param {StatusChange} item
 */
export async function upsertStatusChange(item) {
  const db = await initDB();
  await db.put(STORE_STATUS_CHANGES, item);
}

// ---------------------------------------------------------------------------
// meta — 사람(브라우저 프로필)별 설정값 저장소 (5단계, kbu-assistant
// KisDB.getMeta/setMeta 이식). 겸직 부서 코드, 기능(탭) 켜고 끄기 등
// "계정마다 다를 수 있는 로컬 설정"을 여기 담는다.
// ---------------------------------------------------------------------------

/**
 * 범용 meta 값 조회.
 * @param {string} key
 * @returns {Promise<any>} 없으면 null
 */
export async function getMeta(key) {
  const db = await initDB();
  const row = await db.get(STORE_META, key);
  return row ? row.value : null;
}

/**
 * 범용 meta 값 저장.
 * @param {string} key
 * @param {any} value
 */
export async function setMeta(key, value) {
  const db = await initDB();
  await db.put(STORE_META, { key, value });
  return value;
}

// ---------------------------------------------------------------------------
// "최초 동기화(베이스라인)" 여부 — 2026-09-05 추가.
// 문제: pollCoopDocs/pollApprovalStatus/pollStatusChanges 모두 "새 항목인지"를
// IndexedDB에 저장된 적 있는지로만 판단한다. 그런데 최초 설치 직후, 또는
// 브라우저 데이터 삭제 후 다시 동기화될 때는 IndexedDB가 비어있을 뿐이지
// ERP에 실제로 새로 생긴 문서가 아니다 — 그런데도 "저장된 적 없음" =
// "새 문서"로 오판해서, 이미 몇 달 전부터 쌓여있던 문서 전부에 대해 알림이
// 한꺼번에 쏟아지는 문제가 실사용 중 발견됨(정확히는 "이미 받은 알림이
// 계속 새로 뜬다"는 리포트).
// 해결: 데이터 종류별(coop/approval/statusChange)로 "이 브라우저에서 최초
// 동기화를 이미 한 번 완료했는지"를 별도로 기록해서, 완료 전이면 그 회차의
// 항목은 전부 저장만 하고 알림은 건너뛴다(baseline 저장). 완료 후부터는
// 평소대로 새 항목 = 알림.
const SYNC_BASELINE_PREFIX = "syncBaselineDone:";

/**
 * @param {"coop"|"approval"|"statusChange"} key
 * @returns {Promise<boolean>}
 */
export async function getSyncBaselineDone(key) {
  return Boolean(await getMeta(`${SYNC_BASELINE_PREFIX}${key}`));
}

/**
 * @param {"coop"|"approval"|"statusChange"} key
 */
export async function setSyncBaselineDone(key) {
  return setMeta(`${SYNC_BASELINE_PREFIX}${key}`, true);
}

/**
 * 겸직 사용자용 수동 부서 코드 목록.
 * [{ label: "소프트웨어융합과", code: "30901015" }, ...]
 * @returns {Promise<Array<{label: string, code: string}>>}
 */
export async function getDeptCodes() {
  const list = await getMeta("deptCodes");
  return Array.isArray(list) ? list : [];
}

/**
 * @param {Array<{label: string, code: string}>} list
 */
export async function setDeptCodes(list) {
  return setMeta("deptCodes", Array.isArray(list) ? list : []);
}

/**
 * ⚠️ 2026-09-02(2) 제거: getRestrictToManualDepts/setRestrictToManualDepts가
 * 여기 있었는데, "수동 부서 코드만 화이트리스트로 써서 자동발견 결과를
 * 대체"하는 기능이 실사용 중 "내 수신부서인데 안 불러와진다" 사고로
 * 이어져서 완전히 뺐다(kisApi.js fetchMyCoopDocList 주석 참고). 겸직 부서
 * 코드(deptCodes)는 이제 항상 자동조회 결과에 "추가"만 되고, 대체하는
 * 경로는 없다.
 */

// 기능(탭)별 사용 여부. 꺼진 기능은 탭 자체가 안 보이고, status(학적변동)는
// background.js에서 동기화도 건너뛴다. admin의 실제 탭 구성(briefing/coop/
// approval/calendar/chat)에 kbu의 status(학적변동)를 추가한 세트.
export const DEFAULT_FEATURE_TOGGLES = {
  briefing: true,
  coop: true,
  approval: true,
  calendar: true,
  chat: true,
  status: true,
};

/**
 * @returns {Promise<typeof DEFAULT_FEATURE_TOGGLES>}
 */
export async function getFeatureToggles() {
  const stored = await getMeta("featureToggles");
  if (stored && typeof stored === "object") {
    return { ...DEFAULT_FEATURE_TOGGLES, ...stored };
  }
  return { ...DEFAULT_FEATURE_TOGGLES };
}

/**
 * @param {Partial<typeof DEFAULT_FEATURE_TOGGLES>} toggles
 */
export async function setFeatureToggles(toggles) {
  return setMeta("featureToggles", { ...DEFAULT_FEATURE_TOGGLES, ...toggles });
}

/**
 * 탭 하나만 켜고/끄기.
 * @param {string} id
 * @param {boolean} enabled
 */
export async function setFeatureEnabled(id, enabled) {
  const cur = await getFeatureToggles();
  cur[id] = !!enabled;
  await setMeta("featureToggles", cur);
  return cur;
}

// ---------------------------------------------------------------------------
// AI(Claude API) 요약 사용 여부 — 2026-09-05 추가.
// 위 featureToggles(coop/archive/status 등)는 "탭을 보여줄지"를 결정하고,
// 이 설정은 그와 별개로 "Claude API를 아예 호출할지"만 딱 하나 결정한다.
// 예를 들어 coop 탭은 계속 켜둔 채로 이 값만 꺼도, background.js는
// parseCoopDoc(Claude API 호출)을 건너뛰고 규칙기반 폴백(fillParsedFallback)
// 만 써서 원문/마감일 후보/할 일 여부는 그대로 보여준다 — 다만 AI 3줄
// 요약만 빠진다. API 키가 발급된 뒤로 실제 비용이 발생하기 시작하므로,
// 사용량이 걱정될 때 설정 탭에서 바로 끌 수 있는 스위치가 필요해서 추가.
// 기본값 true(켜짐) — 프록시 배포 전까지는 어차피 parseCoopDoc이 에러를
// 던지고 폴백으로 넘어가므로 기본값을 켜둬도 안전함.
export async function getAiSummaryEnabled() {
  const v = await getMeta("aiSummaryEnabled");
  return v === undefined || v === null ? true : Boolean(v);
}

/**
 * @param {boolean} enabled
 */
export async function setAiSummaryEnabled(enabled) {
  return setMeta("aiSummaryEnabled", !!enabled);
}

// ---------------------------------------------------------------------------
// AI 요약 대상 문서의 최대 나이(일) — 2026-09-05 추가.
// 위 aiSummaryEnabled가 "AI 요약을 아예 쓸지"를 정한다면, 이 값은 그와
// 별개로 "오늘 기준 며칠 지난 문서까지만 AI로 요약할지"를 정한다. 예:
// 30이면 오늘부터 30일 이내에 기안된 문서만 Claude API로 파싱하고, 그보다
// 오래된 문서는(베이스라인이 아니라 정말로 처음 감지된 새 문서라도) 규칙
// 기반 폴백만 적용한다 — 지난 문서는 마감이 이미 지났을 가능성이 높아
// 3줄 요약의 실무 가치가 낮은데 API 비용은 똑같이 들기 때문.
// null/0이면 "제한 없음"(모든 새 문서를 요약)을 뜻한다. 기본값 30.
const DEFAULT_AI_SUMMARY_MAX_AGE_DAYS = 30;

/**
 * @returns {Promise<number>} 0이면 제한 없음
 */
export async function getAiSummaryMaxAgeDays() {
  const v = await getMeta("aiSummaryMaxAgeDays");
  return v === undefined || v === null ? DEFAULT_AI_SUMMARY_MAX_AGE_DAYS : Number(v) || 0;
}

/**
 * @param {number} days  0이면 제한 없음
 */
export async function setAiSummaryMaxAgeDays(days) {
  return setMeta("aiSummaryMaxAgeDays", Number(days) || 0);
}

// ---------------------------------------------------------------------------
// 새 협조문 도착 시 상세 자동 조회 여부 (2026-09-02 추가)
// ⚠️ background.js가 새 협조문을 감지하자마자 findIntAprvDtlList.do(상세
// 조회 — ERP 화면에서 문서를 클릭해 열 때 쓰는 것과 동일한 API)를 자동으로
// 호출해서 AI 요약을 만드는데, 실사용 리포트로 "ERP에서 직접 열람하지
// 않았는데 협조문수신함의 '열람' 컬럼이 Y로 바뀐다"는 문제가 확인됨(가장
// 최근 도착해서 아직 폴링이 안 돈 문서만 열람 공백이고 나머지는 전부 Y인
// 패턴으로 정황 확인). 즉 자동 요약 시도 자체가 "실제로 안 읽었는데 읽은
// 것으로 ERP에 기록되는" 부작용을 냄.
// 기본값을 false(자동 조회 안 함)로 바꿔서, 사용자가 우리 앱에서 문서를
// 실제로 열 때만(useStore.js openDetail의 라이브 재조회 로직) 상세/AI요약을
// 가져오도록 함 — 이때는 실제로 "확인한 시점"과 열람 처리가 일치하므로
// 자연스럽다. 즉시성(도착하자마자 요약)이 더 중요하다고 판단되면 설정
// 탭에서 다시 켤 수 있음.
/**
 * @returns {Promise<boolean>}
 */
export async function getAutoDetailFetchOnArrival() {
  const v = await getMeta("autoDetailFetchOnArrival");
  return v === true; // 기본값 false
}

/**
 * @param {boolean} enabled
 */
export async function setAutoDetailFetchOnArrival(enabled) {
  return setMeta("autoDetailFetchOnArrival", !!enabled);
}
