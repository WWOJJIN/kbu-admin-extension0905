// src/store/useStore.js
// Zustand 전역 상태. 화면 간 공유되는 협조문 목록/선택된 문서/탭/토스트를 관리.

import { create } from "zustand";
import {
  getAllCoopDocs,
  getCoopDoc,
  markCoopDocRead,
  markCoopDocCompleted,
  markCoopDocCalendarRegistered,
  upsertCoopDoc,
  deleteCoopDoc,
} from "../lib/db.js";
import { createGoogleCalendarEvent } from "../lib/googleCalendar.js";
import { fillParsedFallback } from "../lib/textUtils.js";
import {
  fetchCoopDocDetail,
  extractDetailText,
  extractDetailHtml,
  fetchCoopDocListAllDepts,
  fetchAttachments,
  fetchAttachmentFile,
  fetchLoginUserName,
  fetchLoginUserGbInfo,
  RAW_TEXT_EXTRACT_VERSION,
  RECV_DEPT_SCHEMA_VERSION,
} from "../lib/kisApi.js";

/**
 * raw_text가 비었거나 title과 완전히 같으면(=예전 로직/최초 폴백으로 저장돼서
 * 본문 추출이 안 된 문서) "본문 없음"으로 간주한다. background.js는 신규 항목
 * 처음 감지할 때만 상세를 조회해서 저장하고, 그 뒤로는 stGbn 변경 때도 raw_text를
 * 다시 안 긁어오기 때문에, 로직을 고치기 전에 이미 저장된 문서는 계속 옛날 값
 * (=폴백으로 들어간 제목)을 들고 있게 된다. 그래서 상세 팝업을 열 때 이 경우만
 * 라이브로 다시 조회해서 보정한다.
 *
 * ⚠️ 2026-08-19 실측: 협조문 중 일부는 findIntAprvDtlList.do 응답에 ctnt1~8
 * 필드가 아예 없다 (예: "2026년 하계 집중휴가..." 문서 — 사무처장 결재라인이
 * 찍힌 공문 서식으로 Nexacro 리포트 뷰어가 직접 렌더링하는 타입이라 본문이
 * 텍스트 필드로 안 내려옴). 이런 문서는 body_unavailable=true로 표시해두고
 * 매번 재조회하지 않도록 스킵한다 — 안 그러면 열 때마다 헛수고로 API를 부름.
 * @param {import("../lib/db.js").CoopDoc} doc
 */
function looksLikeMissingBody(doc) {
  if (doc.body_unavailable) return false; // 이미 "본문 API로 못 가져옴" 확인된 문서
  const text = (doc.raw_text || "").trim();
  if (!text) return true;
  return text === (doc.title || "").trim();
}

/**
 * 이미 raw_text가 정상적으로 채워진 문서라도, 그걸 뽑아낼 때 쓴 추출 로직
 * 버전(raw_text_version)이 지금 코드의 RAW_TEXT_EXTRACT_VERSION보다 낮으면
 * 재추출 대상으로 본다. 예: 표 구분자를 나중에 추가했는데 그 전에 이미 열어서
 * 저장해둔 문서는 raw_text가 "정상"으로 보여서 looksLikeMissingBody만으로는
 * 안 걸러진다 — 그래서 별도로 버전을 비교한다 (2026-08-19 실사용 중 발견).
 *
 * ⚠️ 2026-08-22: body_unavailable=true인 문서는 여기서도 원래 스킵했었는데
 * (매번 헛수고로 재조회하지 않으려고), extractDetailText에 새 후보 필드
 * (basiCtnt/intAprvCtnt/coopCtnt)가 추가되면서 body_unavailable=true로 확정된
 * 문서도 "새 로직으로 다시 보면 찾을 수도 있는" 상황이 생김. 그래서
 * body_unavailable이어도 버전이 낮으면 한 번은 다시 시도하도록 바꿈 — 재시도
 * 후에도 여전히 없으면 raw_text_version이 최신으로 찍혀서 그 다음부턴 다시
 * 스킵됨(무한 재조회 아님, 추출 로직이 또 바뀔 때만 한 번 더 재시도).
 * @param {import("../lib/db.js").CoopDoc} doc
 */
function needsReExtract(doc) {
  return (doc.raw_text_version || 0) < RAW_TEXT_EXTRACT_VERSION;
}

// 2026-08-22: 설정 탭 — 카드 AI요약 펼침/접힘 기본 동작.
//   "always"  : 항상 전부 펼침(기존 동작)
//   "recent"  : doc.date 기준 최근 N주 이내만 펼치고 나머지는 접음(N은 recentWeeks)
//   "unread"  : 한 번이라도 열어본(doc.is_new === false) 문서는 접음
// localStorage에 저장해서 새로고침/탭 재시작해도 유지됨(브라우저 탭 컨텍스트라
// localStorage 사용 가능 — content script 아님).
const SUMMARY_SETTINGS_KEY = "kbu_summary_settings_v1";

function loadSummarySettings() {
  try {
    const raw = localStorage.getItem(SUMMARY_SETTINGS_KEY);
    if (!raw) return { mode: "always", recentWeeks: 2 };
    const parsed = JSON.parse(raw);
    return {
      mode: ["always", "recent", "unread"].includes(parsed.mode) ? parsed.mode : "always",
      recentWeeks: Number.isFinite(parsed.recentWeeks) && parsed.recentWeeks > 0 ? parsed.recentWeeks : 2,
    };
  } catch {
    return { mode: "always", recentWeeks: 2 };
  }
}

const useStore = create((set, get) => ({
  activeTab: "coop", // "briefing" | "coop" | "approval" | "calendar" | "chat" | "settings" (2026-08-22: 문서함(doc) 탭 제거, 협조문 탭이 메인 / 2026-08-23: 오늘의 브리핑, 결재현황 탭 추가)
  summarySettings: loadSummarySettings(),
  coopDocs: [],
  selectedDocId: null,
  toast: null, // { message: string } | null
  loading: false,
  // 첨부파일 목록 캐시. docId별로 { loading, error, files } — 상세 팝업을 열 때만
  // kisApi.js fetchAttachments(attachNo)로 라이브 조회한다 (2026-08-21 추가,
  // 팀원이 실측 확인한 findFileDetailList.do + attachNo 조합 적용).
  attachmentsByDocId: {},
  // 부서 드롭다운 선택값 — 지금 실제로 받은 문서들의 recv_dept_name(ERP
  // 응답의 수신부서 값) 문자열 그대로 저장(2026-08-22(14), CoopPage.jsx 참고).
  // 예전엔 우진 개인 조직도를 손으로 묶어둔 kisApi.js DEPT_GROUPS의 "그룹
  // key"를 썼는데, 다른 계정에 배포하면 그 묶음이 안 맞아서 계정마다 자동으로
  // 동작하는 이 방식으로 바꿈. null = "전체". 협조문 탭이 씀.
  selectedDeptGroupKey: null,
  // 2026-08-22: Navbar 상단에 ERP처럼 로그인 사용자 이름/소속/직급 표시하려고
  // 추가. isLogin.do(userNm)/findUserGbList.do(userGbnNm) 실측 완료 —
  // loadUserProfile()이 앱 로드 시 한 번 호출해서 채움. 다른 부서 사람에게
  // 배포해도 계정별로 자동으로 맞게 나옴(고정값 아님).
  userName: null,
  userGbInfo: null,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedDeptGroup: (key) => set({ selectedDeptGroupKey: key }),

  /** 로그인 사용자 이름/소속·직급 조회 (App.jsx가 앱 로드 시 1회 호출). */
  loadUserProfile: async () => {
    try {
      const [name, gbInfo] = await Promise.all([fetchLoginUserName(), fetchLoginUserGbInfo()]);
      set({ userName: name, userGbInfo: gbInfo });
    } catch (err) {
      console.warn("[store] 로그인 사용자 정보 조회 실패:", err);
    }
  },

  /** 설정 탭에서 AI요약 펼침 정책을 바꿀 때 호출. localStorage에도 같이 저장. */
  setSummarySettings: (patch) => {
    const next = { ...get().summarySettings, ...patch };
    set({ summarySettings: next });
    try {
      localStorage.setItem(SUMMARY_SETTINGS_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("[store] summarySettings 저장 실패:", err);
    }
  },

  /** IndexedDB에서 협조문 목록을 다시 읽어와 상태를 갱신한다. */
  loadCoopDocs: async () => {
    set({ loading: true });
    const docs = await getAllCoopDocs();
    set({ coopDocs: docs, loading: false });
  },

  /**
   * 상세 팝업 열기 + 읽음 처리(is_new -> false). 저장된 raw_text가 "본문 없음"으로
   * 보이면(위 looksLikeMissingBody 참고) ERP에서 상세를 라이브로 다시 조회해서
   * IndexedDB 값을 보정한다 — 예전 로직으로 저장된 오래된 문서도 이 경로로
   * 자동 복구됨.
   */
  openDetail: async (id) => {
    set({ selectedDocId: id });
    await markCoopDocRead(id);
    await get().loadCoopDocs();

    let doc = get().coopDocs.find((d) => d.id === id);
    if (!doc) return;

    // ⚠️ 2026-08-22 버그 수정: background.js가 body_unavailable=true로 확정한
    // 문서인데도(공문 서식형, report_server.jsp 이미지 렌더링 타입) raw_text에
    // 제목 폴백값이 그대로 남아있던 버그가 있었음 — looksLikeMissingBody가
    // body_unavailable=true인 문서는 재조회를 건너뛰도록 돼있어서(ERP 재조회
    // 해봤자 어차피 똑같이 없다고 나올 걸 알기 때문), 이 문서들은 라이브
    // 재조회 경로를 안 타고 title 폴백값이 영영 안 고쳐졌었음(모달에
    // `raw_text || 안내문구` 순서상 제목이 안내 문구보다 먼저 걸림). ERP를 다시
    // 조회할 필요는 없고 — 이미 "본문 없음"을 아니까 — 로컬 데이터만 정정한다.
    if (doc.body_unavailable && doc.raw_text && doc.raw_text.trim() === (doc.title || "").trim()) {
      await upsertCoopDoc({ ...doc, raw_text: "", raw_html: "" });
      await get().loadCoopDocs();
      doc = get().coopDocs.find((d) => d.id === id);
      if (!doc) return;
    }

    // 첨부파일 목록은 본문 재추출 여부와 무관하게, attachNo가 있으면 항상 시도
    // (아래 raw_text 재추출 로직과 독립적인 흐름이라 return보다 먼저 실행)
    if (doc.attachNo) {
      get().loadAttachments(id);
    }

    if (!looksLikeMissingBody(doc) && !needsReExtract(doc)) return;

    try {
      const detailRows = await fetchCoopDocDetail({ aprvNo: id });
      const detail = detailRows[0];
      const extracted = extractDetailText(detail);
      if (extracted) {
        const extractedHtml = extractDetailHtml(detail);
        if (
          extracted !== doc.raw_text ||
          extractedHtml !== doc.raw_html ||
          doc.raw_text_version !== RAW_TEXT_EXTRACT_VERSION
        ) {
          // 3단계: 본문이 목록 요약값에서 실제 상세 본문으로 갱신되는 시점이라,
          // deadline/requires_action이 아직 규칙 기반 폴백값이었다면(AI 파싱값이
          // 아니었다면) 더 온전해진 본문 기준으로 다시 추정해 갱신한다. 이미
          // AI가 채운 값이면 손대지 않는다.
          const refreshed =
            doc.deadline_is_fallback !== false || doc.requires_action_is_fallback !== false
              ? fillParsedFallback(
                  {
                    deadline: doc.deadline_is_fallback === false ? doc.deadline : null,
                    requires_action:
                      doc.requires_action_is_fallback === false ? doc.requires_action : null,
                  },
                  extracted
                )
              : { deadline: doc.deadline, requires_action: doc.requires_action };

          await upsertCoopDoc({
            ...doc,
            raw_text: extracted,
            raw_html: extractedHtml,
            body_unavailable: false,
            raw_text_version: RAW_TEXT_EXTRACT_VERSION,
            deadline: refreshed.deadline,
            requires_action: refreshed.requires_action,
          });
          await get().loadCoopDocs();
        }
      } else {
        // ctnt1~8이 응답에 아예 없는 문서(공문 서식형) — 제목을 본문인 척 계속
        // 보여주는 대신 명확하게 "본문 없음" 처리하고, 이후엔 재조회 안 함.
        await upsertCoopDoc({
          ...doc,
          raw_text: "",
          raw_html: "",
          body_unavailable: true,
          raw_text_version: RAW_TEXT_EXTRACT_VERSION,
        });
        await get().loadCoopDocs();
      }
    } catch (err) {
      console.warn(`[store] 상세 라이브 재조회 실패 (id=${id}):`, err);
    }
  },

  /**
   * 2026-08-19 이전에 저장된 문서는 drafter(기안자) 필드가 없다 — 목록/문서함
   * 카드에 아예 안 뜨는 원인. openDetail처럼 문서 하나씩 열 때마다 보정하면
   * 목록 화면 자체에는 반영이 안 되므로(클릭 전엔 안 뜸), 대신 목록 API를
   * 한 번만 호출해서 누락된 문서를 전부 한꺼번에 채운다. App.jsx가 앱 로드
   * 시 1회만 호출함 — 한 번 채워지면 이후엔 background.js가 계속 유지해줌.
   *
   * ⚠️ 2026-08-21 확장: attachNo도 같은 문제를 겪음 — 첨부파일 기능 추가 전에
   * 이미 저장된 문서는 attachNo 필드 자체가 없어서, 실제로 첨부파일이 있는
   * 문서인데도 상세 팝업에 첨부파일 섹션이 아예 안 뜨는 원인이었다(실사용 중
   * 발견: "사업예산 감액" 문서 — attachNo가 있는 걸로 실측 확인됐는데도 안 뜸).
   * drafter 보정과 같은 패스에서 attachNo도 같이 채운다. body_unavailable과
   * 같은 패턴으로 undefined(=한 번도 확인 안 됨)와 null(=확인했는데 첨부파일
   * 없음)을 구분해서, undefined인 것만 보정 대상으로 삼는다.
   *
   * ⚠️ 2026-08-21 재확장: recv_dept_code/recv_dept_name(부서별 그룹핑용)도
   * 같은 이유로 옛날 문서엔 없다 — 같은 패스에서 같이 채운다. 목록 조회는
   * fetchCoopDocListAllDepts()로 바뀌어서 6개 부서를 전부 순회해 합친 결과를
   * 쓴다(단일 부서만 보던 fetchCoopDocList로는 다른 부서 소속 문서를 못 찾음).
   *
   * ⚠️ 2026-08-22 재보정: recv_dept_code/name을 "어느 docDeptCd로 조회했는지"
   * (item._recvDeptCode/_recvDeptName)로 채우던 게 버그였음이 실측으로 밝혀짐
   * (ERP "부서" 드롭다운은 실제로 목록을 필터링하지 않음). 올바른 값은 응답
   * Row 자체의 rcvDeptCd/rcvDeptNm("수신부서" 컬럼). 문제는 예전 버그 로직으로
   * 이미 recv_dept_code가 (틀린 값으로) 채워진 문서는 undefined가 아니라서
   * 기존 필터로는 재보정 대상에서 빠짐 — raw_text_version과 같은 패턴으로
   * recv_dept_version을 같이 저장해 강제로 다시 채운다.
   */
  backfillMissingDrafters: async () => {
    const docs = get().coopDocs.length ? get().coopDocs : await getAllCoopDocs();
    const missing = docs.filter(
      (d) =>
        !d.drafter ||
        d.attachNo === undefined ||
        (d.recv_dept_version || 0) < RECV_DEPT_SCHEMA_VERSION
    );
    if (missing.length === 0) return;

    try {
      const listItems = await fetchCoopDocListAllDepts();
      const byId = new Map(listItems.filter((item) => item.aprvNo).map((item) => [item.aprvNo, item]));
      let patchedAny = false;
      for (const doc of missing) {
        const item = byId.get(doc.id);
        if (!item) continue;
        const patch = {};
        if (!doc.drafter && item.draftEmpNm) patch.drafter = item.draftEmpNm;
        if (doc.attachNo === undefined) patch.attachNo = item.attachNo || null;
        if ((doc.recv_dept_version || 0) < RECV_DEPT_SCHEMA_VERSION) {
          patch.recv_dept_code = item.rcvDeptCd || null;
          patch.recv_dept_name = item.rcvDeptNm || null;
          patch.recv_dept_version = RECV_DEPT_SCHEMA_VERSION;
        }
        if (Object.keys(patch).length > 0) {
          await upsertCoopDoc({ ...doc, ...patch });
          patchedAny = true;
        }
      }
      if (patchedAny) await get().loadCoopDocs();
    } catch (err) {
      console.warn("[store] 기안자/첨부파일/부서 일괄 보정 실패:", err);
    }
  },

  /**
   * 첨부파일 목록 라이브 조회 (한 번 로드되면 이후엔 캐시 재사용 — 상세 팝업을
   * 다시 열어도 매번 다시 부르지 않음. 새로고침하면 캐시가 비워지니 다시 조회됨).
   * @param {string} id
   */
  loadAttachments: async (id) => {
    const doc = get().coopDocs.find((d) => d.id === id);
    if (!doc || !doc.attachNo) return;
    if (get().attachmentsByDocId[id]) return; // 이미 로드 시도한 적 있음(성공/실패 무관)

    set((state) => ({
      attachmentsByDocId: {
        ...state.attachmentsByDocId,
        [id]: { loading: true, error: null, files: [] },
      },
    }));

    try {
      const files = await fetchAttachments(doc.attachNo);
      set((state) => ({
        attachmentsByDocId: {
          ...state.attachmentsByDocId,
          [id]: { loading: false, error: null, files },
        },
      }));
    } catch (err) {
      console.warn(`[store] 첨부파일 목록 조회 실패 (id=${id}):`, err);
      set((state) => ({
        attachmentsByDocId: {
          ...state.attachmentsByDocId,
          [id]: { loading: false, error: err.message || "첨부파일 조회 실패", files: [] },
        },
      }));
    }
  },

  /**
   * 첨부파일 하나 다운로드 — blob으로 받아서 브라우저 다운로드로 저장.
   * (React 웹앱 컨텍스트에서 실행되므로 URL.createObjectURL/document 사용 가능,
   * background.js 서비스워커에는 없는 API라 여기서 처리)
   * @param {string} attachNo
   * @param {number} seq
   * @param {string} [fallbackName]
   */
  downloadAttachment: async (attachNo, seq, fallbackName) => {
    try {
      const { blob, filename } = await fetchAttachmentFile(attachNo, seq);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || fallbackName || "첨부파일";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn("[store] 첨부파일 다운로드 실패:", err);
      get().showToast("첨부파일 다운로드에 실패했어요.");
    }
  },

  /**
   * IndexedDB에 있는 문서 중, 지금 fetchCoopDocListAllDepts()(협조문수신함 > 부서
   * 화면에서 볼 수 있는 6개 소속 부서 전부)로 다시 조회했을 때 안 나오는 문서를
   * 정리한다. 2026-08-21 이전엔 docDeptCd를 빈 값으로 보내서 전사문서열람(전체
   * 부서) 범위로 캐시돼있었음 — "협조문수신함 > 부서 그것만 볼래" 요청으로 추가.
   * 처음엔 부서 하나(혁신지원사업단)만 기준으로 정리했었는데, 우진 계정이 실제로는
   * 6개 부서 소속이라 그 기준대로면 나머지 5개 부서 문서까지 다 지워질 뻔했음 —
   * 전체 부서 목록으로 기준을 넓힘.
   * App.jsx가 앱 로드 시 1회 호출. 목록 조회 자체가 실패하면(세션 만료 등) 아무것도
   * 지우지 않고 조용히 중단한다 — 잘못된 판단으로 정상 문서를 지우면 안 되니까.
   *
   * ⚠️ 2026-08-22 안전장치 추가: 처음 감지에서 바로 삭제하면, ERP가 어쩌다 한 번
   * 일시적으로 일부만 응답하는 경우(네트워크 순간 끊김 등, 에러는 안 났지만 결과가
   * 불완전한 경우) 멀쩡한 문서가 지워졌다가, 다음 폴링(background.js)에서 그 문서가
   * 다시 보이면 "신규 문서"로 오판해 is_new:true로 재생성됨 — 이게 "새로 온 것도
   * 아닌데 NEW 배지가 뜬다"는 증상의 유력한 원인으로 판단됨. 그래서 바로 삭제하지
   * 않고, 범위 밖으로 처음 감지된 문서는 out_of_scope_flagged_at만 찍어두고
   * 남겨뒀다가, 그 다음 번(=다른 앱 로드 시점) 점검에서도 여전히 범위 밖이면 그때
   * 실제로 삭제한다. 범위 안으로 다시 확인되면 플래그를 지운다.
   */
  pruneOutOfScopeCoopDocs: async () => {
    const docs = get().coopDocs.length ? get().coopDocs : await getAllCoopDocs();
    if (docs.length === 0) return;

    try {
      const listItems = await fetchCoopDocListAllDepts();
      const scopedIds = new Set(listItems.filter((item) => item.aprvNo).map((item) => item.aprvNo));

      const toDelete = [];
      let changedAny = false;

      for (const doc of docs) {
        const inScope = scopedIds.has(doc.id);
        if (inScope) {
          if (doc.out_of_scope_flagged_at) {
            await upsertCoopDoc({ ...doc, out_of_scope_flagged_at: null });
            changedAny = true;
          }
          continue;
        }
        if (doc.out_of_scope_flagged_at) {
          toDelete.push(doc.id);
        } else {
          await upsertCoopDoc({ ...doc, out_of_scope_flagged_at: Date.now() });
          changedAny = true;
        }
      }

      for (const id of toDelete) {
        await deleteCoopDoc(id);
        changedAny = true;
      }

      if (changedAny) await get().loadCoopDocs();
      if (toDelete.length > 0) {
        console.log(`[store] 부서 범위 밖 문서 ${toDelete.length}건 정리 완료 (2회 연속 확인됨)`);
      }
    } catch (err) {
      console.warn("[store] 부서 범위 정리 실패:", err);
    }
  },

  closeDetail: () => set({ selectedDocId: null }),

  /** 처리 완료 표시. */
  completeDoc: async (id) => {
    await markCoopDocCompleted(id);
    await get().loadCoopDocs();
  },

  /**
   * 구글 캘린더에 실제로 종일 일정을 등록한다 (kbu-assistant의
   * createGoogleCalendarEvent 이식 — 2단계). 이전에는 로컬 플래그만
   * true로 바꾸고 끝이었는데, 이제 실제 chrome.identity OAuth로 토큰을
   * 받아 캘린더에 이벤트를 만든 뒤 성공한 경우에만 플래그를 저장한다.
   * 마감기한이 없는 문서는 등록할 날짜가 없으므로 토스트로 안내하고 종료.
   */
  registerCalendar: async (id) => {
    const doc = await getCoopDoc(id);
    if (!doc) return;
    if (!doc.deadline) {
      get().showToast("마감기한이 없는 문서라 캘린더에 등록할 날짜를 알 수 없어요.");
      return;
    }
    try {
      await createGoogleCalendarEvent({
        title: `[${doc.doc_type || "협조문"}] ${doc.title || ""}`,
        date: doc.deadline,
        description: `발신: ${doc.sender_dept || ""}\n${doc.ai_summary || doc.summary || ""}`,
      });
      await markCoopDocCalendarRegistered(id);
      await get().loadCoopDocs();
      get().showToast("구글 캘린더에 등록했습니다.");
    } catch (err) {
      console.warn("[store] 구글 캘린더 등록 실패:", err);
      get().showToast(
        `구글 캘린더 등록에 실패했어요: ${err && err.message ? err.message : err}`
      );
    }
  },

  /** 상단 파란 배너 토스트 표시, 5초 후 자동 소멸 (UI 규칙). */
  showToast: (message) => {
    set({ toast: { message } });
    setTimeout(() => {
      if (get().toast?.message === message) set({ toast: null });
    }, 5000);
  },
}));

export default useStore;
