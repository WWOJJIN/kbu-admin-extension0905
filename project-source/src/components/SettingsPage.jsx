// src/components/SettingsPage.jsx
// 설정 탭. 2026-08-22 추가 — 협조문 카드의 AI요약을 언제 펼쳐/접어 보여줄지
// 3가지 정책 중 고르게 함(useStore.js summarySettings). CoopCard.jsx가 이
// 값을 읽어서 카드별 펼침/접힘을 결정함.

import { useEffect, useMemo, useState } from "react";
import useStore from "../store/useStore.js";
import {
  getFeatureToggles,
  setFeatureEnabled,
  getDeptCodes,
  setDeptCodes,
  getMeta,
  getAutoDetailFetchOnArrival,
  setAutoDetailFetchOnArrival,
  getAiSummaryEnabled,
  setAiSummaryEnabled,
  getAiSummaryMaxAgeDays,
  setAiSummaryMaxAgeDays,
} from "../lib/db.js";

const AI_SUMMARY_AGE_OPTIONS = [7, 14, 30, 60, 90, 0]; // 0 = 제한 없음
const BULK_RESUMMARIZE_AGE_OPTIONS = [1, 3, 7, 14, 30, 0]; // 0 = 제한 없음, 일괄 재요약 전용(더 촘촘한 선택지)

const WEEK_OPTIONS = [1, 2, 3, 4, 6, 8, 12];

// 5단계(kbu-assistant 이식): 탭 켜고 끄기 목록. Navbar.jsx의 TABS와 key를
// 맞춰야 실제로 숨겨진다. "settings"는 여기서 뺐다 — 설정 탭 자체를 끄면
// 다시 켤 방법이 없어지므로 항상 보이게 둔다(kbu 원본도 동일한 이유로
// FEATURE_TAB_IDS에서 자기 자신은 제외).
const FEATURE_TAB_ITEMS = [
  { key: "briefing", label: "브리핑" },
  { key: "coop", label: "협조문" },
  { key: "approval", label: "결재현황" },
  { key: "calendar", label: "캘린더" },
  { key: "chat", label: "챗봇" },
  { key: "status", label: "학적변동" },
];

function FeatureTogglesSection() {
  const [toggles, setToggles] = useState(null);

  useEffect(() => {
    getFeatureToggles().then(setToggles);
  }, []);

  if (!toggles) return null;

  const toggle = async (key) => {
    const next = await setFeatureEnabled(key, !toggles[key]);
    setToggles(next);
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-brand-navy mb-1">탭 켜고 끄기</h3>
      <p className="text-xs text-brand-muted mb-3">안 쓰는 기능은 꺼서 네브바를 간단하게 유지할 수 있어요.</p>
      <div className="flex flex-col gap-1.5">
        {FEATURE_TAB_ITEMS.map((item) => (
          <label
            key={item.key}
            className="flex items-center justify-between border border-brand-border rounded-lg px-3.5 py-2.5 cursor-pointer hover:bg-brand-alt"
          >
            <span className="text-sm text-brand-navy">{item.label}</span>
            <input
              type="checkbox"
              checked={toggles[item.key] !== false}
              onChange={() => toggle(item.key)}
              className="w-4 h-4"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

// 2026-09-05 추가: Claude API 사용 여부를 딱 하나로 끄고 켜는 스위치.
// FeatureTogglesSection(탭 표시 여부)과는 별개 — 이건 API 키가 발급되고
// 실제 비용이 발생하기 시작한 뒤로, 사용량이 걱정될 때 곧바로 Claude API
// 호출 자체를 막을 수 있게 하려고 추가함. 꺼도 원문/마감일 후보(규칙기반)/
// 캘린더/알림은 그대로 동작하고 AI 3줄 요약만 안 생긴다.
function AiSummaryToggleSection() {
  const [enabled, setEnabled] = useState(null);
  const [maxAgeDays, setMaxAgeDays] = useState(null);
  const [missingCount, setMissingCount] = useState(null);
  // 일괄 재요약 전용 기간 — 평소 새 문서용 AI_SUMMARY 기간(maxAgeDays)과는
  // 별개로, 이 한 번의 정리 작업만 더 좁게 조절할 수 있게 분리함. 기본값은
  // 7일로 시작 — 이미 쌓인 백로그는 대부분 최근 문서라(신규 도입 초기),
  // 전역 30일 설정으로는 거의 안 걸러지는 걸 확인해서 더 보수적인 기본값을 씀.
  const [bulkAgeDays, setBulkAgeDays] = useState(7);

  const getMissingAiSummaryCandidates = useStore((s) => s.getMissingAiSummaryCandidates);
  const bulkResummarizeMissingAi = useStore((s) => s.bulkResummarizeMissingAi);
  const resummarizeProgress = useStore((s) => s.resummarizeProgress);
  // 2026-09-05(8) 추가: "재요약 초기화(테스트용)" 버튼 — coopDocs를 구독해서
  // bulkAgeDays 기준으로 "이미 AI 요약이 있는" 문서 수를 미리보기로 계산.
  // (useStore.js의 resetAiSummaryForAge 안 필터와 동일한 로직을 화면 표시용으로
  // 한 번 더 계산 — 액션 자체는 count만 리턴하지 않고 실행까지 하므로 분리.)
  const coopDocs = useStore((s) => s.coopDocs);
  const resetAiSummaryForAge = useStore((s) => s.resetAiSummaryForAge);
  const resettableCount = useMemo(() => {
    const now = Date.now();
    return coopDocs.filter((d) => {
      if (!d.ai_summary) return false;
      if (!bulkAgeDays || bulkAgeDays <= 0) return true;
      if (!d.date) return true;
      const docTime = new Date(`${d.date}T00:00:00`).getTime();
      if (Number.isNaN(docTime)) return true;
      return now - docTime <= bulkAgeDays * 24 * 60 * 60 * 1000;
    }).length;
  }, [coopDocs, bulkAgeDays]);

  useEffect(() => {
    getAiSummaryEnabled().then(setEnabled);
    getAiSummaryMaxAgeDays().then(setMaxAgeDays);
  }, []);

  // bulkAgeDays가 바뀔 때마다 그 기준으로 대상 건수를 다시 센다.
  useEffect(() => {
    getMissingAiSummaryCandidates({ ageDaysOverride: bulkAgeDays }).then((docs) => setMissingCount(docs.length));
  }, [bulkAgeDays, getMissingAiSummaryCandidates]);

  if (enabled === null || maxAgeDays === null) return null;

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await setAiSummaryEnabled(next);
  };

  const changeMaxAge = async (e) => {
    const next = Number(e.target.value);
    setMaxAgeDays(next);
    await setAiSummaryMaxAgeDays(next);
  };

  const handleBulkResummarize = async () => {
    if (!missingCount) return;
    const ok = window.confirm(
      `최근 ${bulkAgeDays === 0 ? "전체 기간" : `${bulkAgeDays}일`} 문서 중 AI 요약이 없는 ${missingCount}건을 지금 요약할까요?\n` +
        `문서 수만큼 Claude API 호출이 발생해서 비용이 듭니다. 시간이 좀 걸릴 수 있어요.`
    );
    if (!ok) return;
    await bulkResummarizeMissingAi({ ageDaysOverride: bulkAgeDays });
    getMissingAiSummaryCandidates({ ageDaysOverride: bulkAgeDays }).then((docs) => setMissingCount(docs.length));
  };

  // 2026-09-05(8) 추가: 개발/테스트 전용 — 방금 재요약된 내용을 지워서
  // "일괄 재요약" 버튼을 반복 테스트할 수 있게 함. Claude API를 안 부르는
  // 로컬 작업이라 비용 경고는 없지만, 되돌릴 수 없어서 confirm은 그대로 둠.
  const handleResetAiSummary = async () => {
    if (!resettableCount) return;
    const ok = window.confirm(
      `최근 ${bulkAgeDays === 0 ? "전체 기간" : `${bulkAgeDays}일`} 문서 중 AI 요약이 있는 ${resettableCount}건을 초기화(삭제)할까요?\n` +
        `개발/테스트용 기능이에요. Claude API를 호출하지 않아 비용은 안 들지만, 초기화하면 되돌릴 수 없어요.`
    );
    if (!ok) return;
    await resetAiSummaryForAge({ ageDaysOverride: bulkAgeDays });
    getMissingAiSummaryCandidates({ ageDaysOverride: bulkAgeDays }).then((docs) => setMissingCount(docs.length));
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-brand-navy mb-1">AI 요약(Claude API) 사용</h3>
      <label className="flex items-start gap-2.5 border border-brand-border rounded-lg p-3.5 cursor-pointer hover:bg-brand-alt">
        <input type="checkbox" checked={enabled} onChange={toggle} className="mt-1 w-4 h-4" />
        <div>
          <p className="text-sm font-medium text-brand-navy">협조문 3줄 요약에 Claude API 사용</p>
          <p className="text-xs text-brand-muted mt-0.5">
            끄면 새 협조문이 와도 Claude API를 아예 호출하지 않아요(비용 발생 없음). 대신 3줄 요약만 빠지고,
            마감일 후보·처리필요 여부는 규칙기반으로 계속 채워지며 캘린더·알림도 그대로 동작해요. 나중에 다시
            켜면 그 시점부터 새로 감지되는 협조문부터 AI 요약이 생겨요(과거 문서는 소급 적용 안 됨).
          </p>
        </div>
      </label>

      {/* 2026-09-05 추가: "오늘 기준 N일 지난 문서는 굳이 AI로 안 요약해도
          되지 않냐"는 요청 반영. AI 요약 자체가 켜져 있을 때만 의미가 있어서
          enabled가 false면 흐리게 표시하고 비활성화한다. */}
      <div
        className={`mt-2 flex items-center justify-between border border-brand-border rounded-lg px-3.5 py-2.5 ${
          enabled ? "" : "opacity-50"
        }`}
      >
        <div className="pr-3">
          <p className="text-sm text-brand-navy">AI 요약 대상 기간</p>
          <p className="text-xs text-brand-muted mt-0.5">
            문서의 기안일이 오늘 기준 이 기간보다 오래됐으면(예: 뒤늦게 처음 감지된 옛날 문서), AI 요약 없이
            규칙기반 값만 채워요. API 비용 절감 목적이에요.
          </p>
        </div>
        <select
          value={maxAgeDays}
          onChange={changeMaxAge}
          disabled={!enabled}
          className="border border-brand-border rounded px-1.5 py-1 text-xs bg-white shrink-0"
        >
          {AI_SUMMARY_AGE_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "제한 없음" : `${d}일`}
            </option>
          ))}
        </select>
      </div>

      {/* 2026-09-05 추가: 기존 문서 일괄 재요약. AI 파싱은 "처음 감지된 순간"
          단 한 번만 시도되고 재시도가 없어서, 그 시점에 설정이 꺼져있었거나
          프록시가 아직 준비 안 됐던 문서는 영구히 "본문 발췌"로만 남는 문제가
          실사용 중 발견됨(345건 중 다수 — 콘솔 로그 "신규 0, 상태변경 0"으로
          더 이상 자동으로는 처리 안 된다는 게 확인됨). 자동 실행하면 안 되고
          (실제 비용 발생), 사용자가 건수를 보고 명시적으로 눌러야 실행됨. */}
      <div className={`mt-2 border border-brand-border rounded-lg px-3.5 py-2.5 ${enabled ? "" : "opacity-50"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="pr-3">
            <p className="text-sm text-brand-navy">기존 문서 일괄 재요약</p>
            <p className="text-xs text-brand-muted mt-0.5">
              AI 요약 없이 저장된(카드에 "본문 발췌"로 뜨는) 문서를 지금 한꺼번에 요약해요. 문서 수만큼 Claude
              API 호출이 발생하니, 아래에서 최근 며칠치만 대상으로 할지 먼저 좁혀서 비용을 조절하세요. 날짜를
              모르는 문서는 비용 안전을 위해 대상에서 자동 제외돼요.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 mt-2.5">
          <select
            value={bulkAgeDays}
            onChange={(e) => setBulkAgeDays(Number(e.target.value))}
            disabled={!enabled || !!resummarizeProgress}
            className="border border-brand-border rounded px-1.5 py-1 text-xs bg-white"
          >
            {BULK_RESUMMARIZE_AGE_OPTIONS.map((d) => (
              <option key={d} value={d}>
                최근 {d === 0 ? "전체 기간" : `${d}일`}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleBulkResummarize}
            disabled={!enabled || !missingCount || !!resummarizeProgress}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-brand-blue text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resummarizeProgress ? "처리 중…" : `${missingCount ?? "-"}건 요약하기`}
          </button>
        </div>
        {resummarizeProgress && (
          <p className="text-xs text-brand-muted mt-2">
            진행 중: {resummarizeProgress.done}/{resummarizeProgress.total}건
            {resummarizeProgress.failed > 0 ? ` (실패 ${resummarizeProgress.failed}건)` : ""}
          </p>
        )}
      </div>

      {/* 2026-09-05(8) 추가: "일괄 재요약 해서 재요약된 내용을 삭제할 수
          있는 기능도 넣어주라, 개발 단계에서 테스트하고 싶은게 있어서" 요청.
          위 "기존 문서 일괄 재요약"과 같은 기간 선택(bulkAgeDays)을 그대로
          재사용해서, 그 범위 안에서 이미 AI 요약이 채워진 문서만 골라 다시
          "재요약 전" 상태로 되돌린다 — 재요약 로직을 실제로 며칠씩 기다리지
          않고 반복 테스트하기 위한 개발자용 도구. Claude API를 호출하지
          않는 순수 로컬 작업이라 비용은 안 들지만, 초기화하면 되돌릴 수
          없어서 다른 박스와 구분되게 amber(경고) 톤으로 표시. */}
      <div className={`mt-2 border border-amber-200 bg-amber-50 rounded-lg px-3.5 py-2.5 ${enabled ? "" : "opacity-50"}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="pr-3">
            <p className="text-sm text-amber-900">
              재요약 초기화 <span className="font-normal text-amber-700">(개발/테스트용)</span>
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              위에서 고른 기간 기준으로, 이미 AI 요약이 있는 문서의 요약만 지워서 재요약 전 상태로 되돌려요.
              Claude API 호출 없이 로컬에서만 지워져서 비용은 안 들지만, 초기화하면 되돌릴 수 없어요.
            </p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 mt-2.5">
          <button
            type="button"
            onClick={handleResetAiSummary}
            disabled={!enabled || !resettableCount || !!resummarizeProgress}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            최근 {bulkAgeDays === 0 ? "전체 기간" : `${bulkAgeDays}일`} · {resettableCount ?? "-"}건 초기화
          </button>
        </div>
      </div>
    </div>
  );
}


// 여부. 기본은 꺼짐(false) — db.js getAutoDetailFetchOnArrival 주석 참고.
function AutoDetailFetchSection() {
  const [enabled, setEnabled] = useState(null);

  useEffect(() => {
    getAutoDetailFetchOnArrival().then(setEnabled);
  }, []);

  if (enabled === null) return null;

  const toggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await setAutoDetailFetchOnArrival(next);
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-brand-navy mb-1">새 협조문 도착 시 자동 요약</h3>
      <label className="flex items-start gap-2.5 border border-brand-border rounded-lg p-3.5 cursor-pointer hover:bg-brand-alt">
        <input type="checkbox" checked={enabled} onChange={toggle} className="mt-1 w-4 h-4" />
        <div>
          <p className="text-sm font-medium text-brand-navy">도착 즉시 상세 본문을 가져와 AI 요약 생성</p>
          <p className="text-xs text-brand-muted mt-0.5">
            켜면 새 협조문이 감지되자마자 상세 본문을 미리 가져와서 요약·마감기한을 채워둬요. 다만 상세 조회는
            ERP에서 문서를 직접 열 때 쓰는 API와 같아서, <strong>ERP 협조문수신함의 "열람" 컬럼이 실제로 열어보지
            않았는데도 Y로 바뀔 수 있어요</strong>. 꺼두면 협조문 탭에서 직접 문서를 열 때만 상세/요약을 가져와서
            ERP 열람 상태와 실제로 확인한 시점이 일치해요.
          </p>
        </div>
      </label>
    </div>
  );
}

function DeptCodesSection() {
  const [deptCodes, setDeptCodesState] = useState([]);
  const [discovered, setDiscovered] = useState([]);
  const [newLabel, setNewLabel] = useState("");
  const [newCode, setNewCode] = useState("");

  useEffect(() => {
    getDeptCodes().then(setDeptCodesState);
    getMeta("discoveredDeptCodes").then((list) => setDiscovered(Array.isArray(list) ? list : []));
  }, []);

  const persist = async (list) => {
    setDeptCodesState(list);
    await setDeptCodes(list);
  };

  const addCode = async (label, code) => {
    if (!code) return;
    if (deptCodes.some((d) => d.code === code)) return;
    await persist([...deptCodes, { label: label || code, code }]);
  };

  const removeCode = async (code) => {
    await persist(deptCodes.filter((d) => d.code !== code));
  };

  return (
    <div className="mt-8">
      <h3 className="text-sm font-semibold text-brand-navy mb-1">겸직 부서 코드</h3>
      <p className="text-xs text-brand-muted mb-3">
        소속 부서 자동조회에 안 잡히는 겸직 부서가 있으면 여기에 코드를 등록해두세요. 협조문 목록을 내 부서
        범위로 걸러낼 때 이 목록도 함께 사용됩니다.
      </p>

      {discovered.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-brand-muted mb-1.5">
            최근 동기화에서 실제로 문서가 온 부서(자동 발견, 참고용 — 눌러서 바로 추가):
          </p>
          <div className="flex flex-wrap gap-1.5">
            {discovered
              .filter((d) => !deptCodes.some((m) => m.code === d.code))
              .map((d) => (
                <button
                  key={d.code}
                  onClick={() => addCode(d.name, d.code)}
                  className="text-xs px-2 py-1 rounded-full bg-brand-alt text-brand-blue border border-brand-border hover:bg-white"
                >
                  + {d.name} ({d.code})
                </button>
              ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 mb-3">
        {deptCodes.length === 0 ? (
          <p className="text-sm text-brand-muted">등록된 겸직 부서 코드가 없어요.</p>
        ) : (
          deptCodes.map((d) => (
            <div
              key={d.code}
              className="flex items-center justify-between border border-brand-border rounded-lg px-3.5 py-2 text-sm"
            >
              <span className="text-brand-navy">
                {d.label} <span className="text-brand-muted">({d.code})</span>
              </span>
              <button onClick={() => removeCode(d.code)} className="text-xs text-status-red underline">
                삭제
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 mb-4">
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="부서명 (선택)"
          className="border border-brand-border rounded-md px-2.5 py-1.5 text-sm flex-1 min-w-0"
        />
        <input
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
          placeholder="부서 코드"
          className="border border-brand-border rounded-md px-2.5 py-1.5 text-sm w-32"
        />
        <button
          onClick={() => {
            addCode(newLabel, newCode.trim());
            setNewLabel("");
            setNewCode("");
          }}
          className="text-sm px-3 py-1.5 rounded-md bg-brand-blue text-white hover:bg-brand-blueDark flex-shrink-0"
        >
          추가
        </button>
      </div>

      {/* 2026-09-02(2) 제거: "등록된 부서 코드만 화이트리스트로 사용" 토글이
          있었는데, 실사용 중 "내 수신부서인데 안 불러와진다" 사고로 이어져서
          뺐다. ERP 부서 드롭다운은 실제로 필터링을 안 하고(코드 상단 kisApi.js
          주석 참고), 겸직/발령이 계속 바뀌는 계정 특성상 수동 목록만으로
          완전한 화이트리스트를 유지하는 게 사실상 불가능해서 — 문서를 놓치는
          쪽보다 범위 밖 문서가 조금 섞이는 쪽이 훨씬 안전하다는 이 앱의
          원칙과 맞지 않는 기능이었다. 위 목록은 이제 항상 자동조회 결과에
          "추가"되기만 하고, 절대로 자동조회 결과를 대체하지 않는다. */}
    </div>
  );
}

// 2026-09-02 추가: "세션 만료 알림이 자꾸 뜬다"는 리포트가 반복될 때마다
// chrome://extensions에서 서비스워커 콘솔을 직접 열어 chrome.storage.local의
// pollLog를 확인해야 했음(코드 주석에도 "재발 시 pollLog의 responseSnippet
// 으로 추가 진단 필요"라고 남겨져 있었음) — 매번 그러기 번거로우니 설정
// 탭에서 바로 최근 폴링 기록(성공/실패, 세션만료 추정 여부, ERP가 실제로
// 준 응답 일부)을 볼 수 있게 노출한다. 이 페이지 자체가 확장 오리진
// (chrome-extension://.../dist/index.html)이라 chrome.storage 접근 가능.
function PollDiagnosticsSection() {
  const [log, setLog] = useState(null);
  const [streak, setStreak] = useState(0);

  const refresh = () => {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    chrome.storage.local.get(["pollLog", "coopPollFailStreak"], (res) => {
      setLog([...(res.pollLog || [])].slice(-15).reverse());
      setStreak(res.coopPollFailStreak || 0);
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  if (typeof chrome === "undefined" || !chrome.storage?.local) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-brand-navy">협조문 폴링 진단 로그</h3>
        <button onClick={refresh} className="text-xs text-brand-blue hover:underline">
          새로고침
        </button>
      </div>
      <p className="text-xs text-brand-muted mb-3">
        "ERP 로그인 세션 만료" 알림이 실제 로그아웃 때문인지, 아니면 오탐인지 확인할 때 참고하세요.
        실패 항목의 응답 스니펫에 그 순간 ERP가 실제로 준 응답이 그대로 남아있어요.
        {streak > 0 && <span className="text-red-500"> 현재 연속 실패 {streak}회 (2회부터 알림 발송).</span>}
      </p>
      {log === null ? (
        <p className="text-xs text-brand-muted">불러오는 중...</p>
      ) : log.length === 0 ? (
        <p className="text-xs text-brand-muted">아직 기록된 폴링 로그가 없어요. (확장 설치/업데이트 직후일 수 있어요.)</p>
      ) : (
        <div className="border border-brand-border rounded-lg divide-y divide-brand-border max-h-80 overflow-y-auto">
          {log.map((entry, i) => (
            <div key={i} className="px-3 py-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={entry.ok ? "text-emerald-600 font-medium" : "text-red-600 font-medium"}>
                  {entry.ok ? "성공" : "실패"}
                </span>
                <span className="text-brand-muted">{new Date(entry.ts).toLocaleString("ko-KR")}</span>
                {entry.sessionExpired && (
                  <span className="text-red-500 bg-red-50 rounded px-1.5 py-0.5">세션만료 추정</span>
                )}
                {entry.ok && <span className="text-brand-muted">{entry.count}건</span>}
              </div>
              {entry.error && <p className="text-brand-muted mt-1 break-words">{entry.error}</p>}
              {entry.responseSnippet && (
                <pre className="mt-1 bg-brand-alt rounded px-2 py-1.5 whitespace-pre-wrap break-all text-[11px] text-brand-muted">
                  {entry.responseSnippet}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const summarySettings = useStore((s) => s.summarySettings);
  const setSummarySettings = useStore((s) => s.setSummarySettings);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-brand-navy mb-1">설정</h2>
      <p className="text-sm text-brand-muted mb-6">협조문 카드에서 AI요약을 어떻게 보여줄지 정해요.</p>

      <div className="flex flex-col gap-3">
        <label className="flex items-start gap-2.5 border border-brand-border rounded-lg p-3.5 cursor-pointer hover:bg-brand-alt">
          <input
            type="radio"
            name="summary-mode"
            checked={summarySettings.mode === "always"}
            onChange={() => setSummarySettings({ mode: "always" })}
            className="mt-1"
          />
          <div>
            <p className="text-sm font-medium text-brand-navy">전부 펼쳐보기</p>
            <p className="text-xs text-brand-muted mt-0.5">지금처럼 모든 협조문의 AI요약을 항상 펼쳐서 보여줘요.</p>
          </div>
        </label>

        <label className="flex items-start gap-2.5 border border-brand-border rounded-lg p-3.5 cursor-pointer hover:bg-brand-alt">
          <input
            type="radio"
            name="summary-mode"
            checked={summarySettings.mode === "recent"}
            onChange={() => setSummarySettings({ mode: "recent" })}
            className="mt-1"
          />
          <div className="flex-1">
            <p className="text-sm font-medium text-brand-navy">최근 협조문만 펼쳐보기</p>
            <p className="text-xs text-brand-muted mt-0.5">
              최근{" "}
              <select
                value={summarySettings.recentWeeks}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setSummarySettings({ mode: "recent", recentWeeks: Number(e.target.value) })}
                className="border border-brand-border rounded px-1.5 py-0.5 text-xs bg-white"
              >
                {WEEK_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w}주
                  </option>
                ))}
              </select>{" "}
              이내 협조문만 펼치고, 나머지는 접어서 보여줘요.
            </p>
          </div>
        </label>

        <label className="flex items-start gap-2.5 border border-brand-border rounded-lg p-3.5 cursor-pointer hover:bg-brand-alt">
          <input
            type="radio"
            name="summary-mode"
            checked={summarySettings.mode === "unread"}
            onChange={() => setSummarySettings({ mode: "unread" })}
            className="mt-1"
          />
          <div>
            <p className="text-sm font-medium text-brand-navy">읽은 협조문은 접기</p>
            <p className="text-xs text-brand-muted mt-0.5">
              한 번이라도 열어본 협조문은 AI요약을 접어서 보여줘요. (카드에서 직접 "펼치기"로 다시 볼 수 있어요.)
            </p>
          </div>
        </label>
      </div>

      <AiSummaryToggleSection />
      <AutoDetailFetchSection />
      <FeatureTogglesSection />
      <DeptCodesSection />
      <PollDiagnosticsSection />
    </div>
  );
}
