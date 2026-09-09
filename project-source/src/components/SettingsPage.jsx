// src/components/SettingsPage.jsx
// "사용자 설정" 탭. 2026-08-22 추가 — 협조문 카드의 AI요약을 언제 펼쳐/접어
// 보여줄지 3가지 정책 중 고르게 함(useStore.js summarySettings). CoopCard.jsx가
// 이 값을 읽어서 카드별 펼침/접힘을 결정함.
// 2026-09-07: "설정 탭을 사용자용/개발자용으로 나눠줘(메뉴바에서)" 요청으로
// 기존 SettingsPage.jsx를 사용자용 설정 전용으로 좁혔다 — 개발/테스트용으로
// 명시돼 있던 기능(기존 문서 일괄 재요약·재요약 초기화·폴링 진단 로그)은
// 새 SettingsDevPage.jsx로 옮기고, Navbar.jsx에 "개발자 설정" 탭을 따로 추가했다.

import { useEffect, useState } from "react";
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

const WEEK_OPTIONS = [1, 2, 3, 4, 6, 8, 12];

// 5단계(kbu-assistant 이식): 탭 켜고 끄기 목록. Navbar.jsx의 TABS와 key를
// 맞춰야 실제로 숨겨진다. "settings"/"settingsDev"는 여기서 뺐다 — 설정 탭
// 자체를 끄면 다시 켤 방법이 없어지므로 항상 보이게 둔다(kbu 원본도 동일한
// 이유로 FEATURE_TAB_IDS에서 자기 자신은 제외).
// 2026-09-07: "캘린더" 항목 제거 — 협조문 탭이 캘린더를 흡수하면서 네브바의
// 별도 캘린더 탭이 없어졌다(CoopPage.jsx/Navbar.jsx 참고).
// 2026-09-07(29): "브리핑 탭 날려줘" 요청으로 "브리핑" 항목도 같이 제거.
const FEATURE_TAB_ITEMS = [
  { key: "coop", label: "협조문" },
  { key: "approval", label: "결재현황" },
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
// 2026-09-07: "설정 탭을 사용자용/개발자용으로 나눠줘" 요청 — 이 섹션 중
// "기존 문서 일괄 재요약"/"재요약 초기화"(개발/테스트용이라고 원래부터
// 명시돼 있던 기능) + 폴링 진단 로그(PollDiagnosticsSection)는
// SettingsDevPage.jsx로 옮겼다. 여기(사용자 설정)엔 평소에 계속 쓰는
// on/off 스위치와 기간 설정만 남긴다.
function AiSummaryToggleSection() {
  const [enabled, setEnabled] = useState(null);
  const [maxAgeDays, setMaxAgeDays] = useState(null);

  useEffect(() => {
    getAiSummaryEnabled().then(setEnabled);
    getAiSummaryMaxAgeDays().then(setMaxAgeDays);
  }, []);

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

// 2026-09-07: 폴링 진단 로그(PollDiagnosticsSection)는 개발/디버그용이라
// SettingsDevPage.jsx("개발자 설정" 탭)로 옮겼다.

export default function SettingsPage() {
  const summarySettings = useStore((s) => s.summarySettings);
  const setSummarySettings = useStore((s) => s.setSummarySettings);

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h2 className="text-lg font-semibold text-brand-navy mb-1">사용자 설정</h2>
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
    </div>
  );
}
