// src/components/Navbar.jsx
// 2026-09-02: 상단 가로 네브바 → 왼쪽 사이드바로 전환(팀에서 공유한 목업
// 레이아웃 요청 반영). 데이터/로직(activeTab, 탭 켜고 끄기)은 기존 그대로고
// 마크업만 세로형으로 바꿨다.
// 2026-09-07(26): "좌측 메뉴바 아이콘 위 사진같은 형식으로" 요청 —
//   1) 이모지 아이콘 → 통일된 선(line) 스타일 SVG 아이콘으로 교체
//   2) 어두운 네이비 사이드바 → 흰 배경 + 옅은 파란색 활성 표시(참고 사진과
//      동일한 톤)로 리스킨
//   3) 브랜드 로고/사용자 정보/알림 벨은 새로 만든 Header.jsx(상단바)로
//      옮겨서, 이 파일은 순수 "탭 이동" 역할만 담당하도록 정리(데이터·동작은
//      그대로 이동만 함 — 새로 지어낸 로직 없음).
// ⚠️ 목업의 "로그아웃" 메뉴는 안 넣었다 — 이 앱은 별도 로그인 시스템이 없고
// ERP 브라우저 세션을 그대로 쓰는 구조라 "로그아웃"이라는 개념 자체가 없다
// (로그아웃하려면 kis.kbu.ac.kr에서 직접 해야 함).

import { useEffect, useState } from "react";
import useStore from "../store/useStore.js";
import { getFeatureToggles } from "../lib/db.js";

// 2026-09-07(26): 이모지 대신 쓰는 선 스타일 아이콘 — 이 파일 전용(다른 곳에
// 재사용 안 해서 별도 파일로 안 뺐다). StatusChangePage.jsx의 PieIcon 등과
// 같은 관례(viewBox 20x20, stroke=currentColor)를 따름.
function CoopIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M3 6.5 10 11l7-4.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="3" y="4.5" width="14" height="11" rx="2" />
    </svg>
  );
}
function ApprovalIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <rect x="3.5" y="3" width="13" height="14" rx="2" />
      <path d="M6.7 10.2 8.7 12.2 13.3 7.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function GradCapIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path d="M10 4 2.5 7.5 10 11l7.5-3.5L10 4Z" strokeLinejoin="round" />
      <path d="M5.5 9.3v3.4c0 1.1 2 2.3 4.5 2.3s4.5-1.2 4.5-2.3V9.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.2 8v4.2" strokeLinecap="round" />
    </svg>
  );
}
function ChatIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path
        d="M3.5 10.2c0-3.4 2.9-6.2 6.5-6.2s6.5 2.8 6.5 6.2-2.9 6.2-6.5 6.2c-.9 0-1.8-.2-2.6-.5L4 17l1-3.1c-.9-1-1.5-2.3-1.5-3.7Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function GearIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <circle cx="10" cy="10" r="2.6" />
      <path
        d="M10 3.3v1.6M10 15.1v1.6M16.7 10h-1.6M4.9 10H3.3M14.7 5.3l-1.1 1.1M6.4 13.6l-1.1 1.1M14.7 14.7l-1.1-1.1M6.4 6.4 5.3 5.3"
        strokeLinecap="round"
      />
    </svg>
  );
}
function WrenchIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
      <path
        d="M13.2 4.3a3.4 3.4 0 0 0-4.5 4l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6a3.4 3.4 0 0 0 4.4-4.5l-2.1 2.1-1.9-.6-.6-1.9 2.1-2.1Z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 2026-09-07: "협조문이랑 캘린더페이지랑 합치자" 요청으로 "캘린더" 탭 제거
// (CoopPage.jsx가 캘린더를 흡수). "설정을 사용자용/개발자용으로 나눠줘"
// 요청으로 "설정" 탭 하나를 "사용자 설정"/"개발자 설정" 두 개로 분리.
// 2026-09-07(29): "브리핑 탭 날려줘" 요청으로 목록에서 제거(BriefingPage.jsx
// 파일 자체는 안 지웠음 — App.jsx의 PAGES 매핑에서도 같이 뺐으니 더 이상
// 어디서도 참조 안 됨).
const TABS = [
  { key: "coop", label: "협조문", Icon: CoopIcon },
  { key: "approval", label: "결재현황", Icon: ApprovalIcon },
  { key: "status", label: "학적변동", Icon: GradCapIcon },
  { key: "chat", label: "챗봇", Icon: ChatIcon },
  { key: "settings", label: "사용자 설정", Icon: GearIcon },
  { key: "settingsDev", label: "개발자 설정", Icon: WrenchIcon },
];

export const SIDEBAR_WIDTH_CLASS = "w-72"; // App.jsx의 콘텐츠 영역 ml-72와 반드시 맞출 것 (목업 사이드바 폭과 동일)

export default function Navbar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const toast = useStore((s) => s.toast);
  // 5단계(kbu-assistant "기능 토글" 이식): SettingsPage에서 끈 탭은 여기서
  // 숨긴다. "settings"는 토글 대상이 아니라 항상 true로 취급.
  const [featureToggles, setFeatureToggles] = useState(null);

  useEffect(() => {
    getFeatureToggles().then(setFeatureToggles);
  }, [activeTab]); // 설정 탭에서 토글을 바꾸고 다른 탭으로 돌아올 때 반영되게 activeTab 변화마다 재조회

  // "settings"/"settingsDev"는 탭 켜고끄기 대상이 아니라 항상 보이게 둔다 —
  // 설정 탭 자체를 끄면 다시 켤 방법이 없어지기 때문(2026-09-07: 설정 탭이
  // 사용자용/개발자용 둘로 나뉘면서 둘 다 예외 처리).
  const visibleTabs = TABS.filter(
    (tab) =>
      tab.key === "settings" || tab.key === "settingsDev" || !featureToggles || featureToggles[tab.key] !== false
  );

  // 지금 보고 있는 탭이 방금 꺼졌으면 협조문 탭으로 되돌린다(kbu
  // applyFeatureVisibility와 동일한 안전장치). 2026-09-07: 캘린더 탭이
  // 없어져서 예전 fallback("calendar")은 더 이상 유효한 탭이 아니므로 "coop"로
  // 변경.
  useEffect(() => {
    if (featureToggles && featureToggles[activeTab] === false && activeTab !== "settings" && activeTab !== "settingsDev") {
      setActiveTab("coop");
    }
  }, [featureToggles, activeTab, setActiveTab]);

  return (
    <>
      {/* 토스트: 사이드바를 피해서 콘텐츠 영역 상단(헤더 바로 아래)에만 뜨도록 오프셋 */}
      {toast && (
        <div className="fixed top-16 left-72 right-0 z-50 bg-brand-blue text-white text-sm py-2 px-4 text-center shadow-brand">
          {toast.message}
        </div>
      )}

      {/* 사이드바: 헤더(h-16) 아래부터 시작하는 네비게이션 전용 패널.
          2026-09-07(26) 이전엔 이 안에 브랜드 로고/사용자 정보/알림 벨이
          같이 있었는데 전부 Header.jsx로 이동 — 지금은 순수 탭 목록만.
          2026-09-07(27): "좌측 메뉴바는 이전 네이비 컬러로" 요청 — 잠깐
          흰 배경으로 바꿨던 걸 원래 네이비(bg-brand-navy)로 되돌리고,
          아이콘(선 스타일 SVG)은 그대로 유지, 글씨는 font-medium →
          font-bold로. */}
      <nav
        className={`h-[calc(100vh-4rem)] ${SIDEBAR_WIDTH_CLASS} flex flex-col fixed left-0 top-16 bg-brand-navy z-30`}
      >
        <div className="flex-1 flex flex-col gap-1 px-3 py-4 overflow-y-auto">
          {visibleTabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13.5px] font-bold transition-colors text-left ${
                  active ? "text-white bg-brand-blue/30" : "text-[#A9B0CC] hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <tab.Icon className="w-[18px] h-[18px] flex-shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
