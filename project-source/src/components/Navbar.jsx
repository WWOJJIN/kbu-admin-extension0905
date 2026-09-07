// src/components/Navbar.jsx
// 2026-09-02: 상단 가로 네브바 → 왼쪽 사이드바로 전환(팀에서 공유한 목업
// 레이아웃 요청 반영). 데이터/로직(activeTab, 벨 드롭다운, 토스트, 탭 켜고
// 끄기)은 기존 그대로고 마크업만 세로형으로 바꿨다.
// ⚠️ 목업의 "로그아웃" 메뉴는 안 넣었다 — 이 앱은 별도 로그인 시스템이 없고
// ERP 브라우저 세션을 그대로 쓰는 구조라 "로그아웃"이라는 개념 자체가 없다
// (로그아웃하려면 kis.kbu.ac.kr에서 직접 해야 함). 눌러도 아무 일도 안 하는
// 버튼을 넣느니 아예 빼는 쪽을 택함. 사용자 아바타도 실제 사진이 없으니
// 이니셜 원(학적변동 카드와 동일한 스타일)으로 대체.

import { useEffect, useState } from "react";
import useStore from "../store/useStore.js";
import { getNewCoopDocs, getFeatureToggles } from "../lib/db.js";

// 2026-09-07: "협조문이랑 캘린더페이지랑 합치자" 요청으로 "캘린더" 탭 제거
// (CoopPage.jsx가 캘린더를 흡수). "설정을 사용자용/개발자용으로 나눠줘"
// 요청으로 "설정" 탭 하나를 "사용자 설정"/"개발자 설정" 두 개로 분리.
const TABS = [
  { key: "briefing", label: "브리핑", icon: "🗂️" },
  { key: "coop", label: "협조문", icon: "📄" },
  { key: "approval", label: "결재현황", icon: "✅" },
  { key: "status", label: "학적변동", icon: "🎓" },
  { key: "chat", label: "챗봇", icon: "💬" },
  { key: "settings", label: "사용자 설정", icon: "⚙️" },
  { key: "settingsDev", label: "개발자 설정", icon: "🛠️" },
];

export const SIDEBAR_WIDTH_CLASS = "w-72"; // App.jsx의 콘텐츠 영역 ml-72와 반드시 맞출 것 (목업 사이드바 폭과 동일)

export default function Navbar() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const toast = useStore((s) => s.toast);
  const openDetail = useStore((s) => s.openDetail);
  const userName = useStore((s) => s.userName);
  const userGbInfo = useStore((s) => s.userGbInfo);

  const [bellOpen, setBellOpen] = useState(false);
  const [newDocs, setNewDocs] = useState([]);
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

  useEffect(() => {
    getNewCoopDocs().then(setNewDocs);
  }, [toast]); // 토스트가 뜰 때(=신규 문서 발생 시점)마다 벨 목록도 같이 갱신

  const userInitial = (userName || "?").slice(0, 1);

  return (
    <>
      {/* 토스트: 사이드바를 피해서 콘텐츠 영역 상단에만 뜨도록 좌측 오프셋 */}
      {toast && (
        <div className="fixed top-0 left-72 right-0 z-50 bg-brand-blue text-white text-sm py-2 px-4 text-center shadow-brand">
          {toast.message}
        </div>
      )}

      {/* 사이드바: 목업 레이아웃(고정 좌측, 전체 높이) 이식 */}
      <nav className={`h-screen ${SIDEBAR_WIDTH_CLASS} flex flex-col fixed left-0 top-0 bg-brand-navy z-30`}>
        <div className="flex flex-col h-full py-6">
          {/* 브랜드 헤더 */}
          <div className="px-5 mb-6 flex items-center gap-2.5 text-white flex-shrink-0">
            <div className="w-[30px] h-[30px] rounded-lg bg-gradient-to-br from-brand-blue to-brand-blueDark flex items-center justify-center flex-shrink-0">
              <span className="text-sm">🏫</span>
            </div>
            <div className="flex flex-col leading-tight">
              <strong className="text-sm tracking-tight">행정 어시스턴트</strong>
              <span className="text-[11px] text-[#9BA3C2]">KBU ERP 자동화</span>
            </div>
          </div>

          {/* 사용자 정보 (실제 프로필 사진이 없으므로 이니셜 아바타로 대체) */}
          {userName && (
            <div className="px-5 mb-5 flex items-center gap-2.5 flex-shrink-0">
              <div className="w-9 h-9 rounded-full bg-brand-blue/40 border border-white/10 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                {userInitial}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white truncate">{userName}</p>
                {userGbInfo && <p className="text-[11px] text-[#9BA3C2] truncate">{userGbInfo}</p>}
              </div>
            </div>
          )}

          {/* 탭 목록 */}
          <div className="flex-1 flex flex-col gap-1 px-3 overflow-y-auto">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13.5px] font-medium transition-colors text-left ${
                  activeTab === tab.key
                    ? "text-white bg-brand-blue/30"
                    : "text-[#A9B0CC] hover:text-white hover:bg-white/[0.06]"
                }`}
              >
                <span className="text-base leading-none">{tab.icon}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* 알림 벨 — 목업의 로그아웃 자리를 대신 사용 (이 앱엔 별도 로그아웃 개념이 없음) */}
          <div className="px-3 pt-3 border-t border-white/10 flex-shrink-0 relative">
            <button
              onClick={() => setBellOpen((v) => !v)}
              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-[13.5px] font-medium text-[#A9B0CC] hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <span className="relative text-base leading-none">
                🔔
                {newDocs.length > 0 && (
                  <span className="absolute -top-1.5 -right-2 bg-status-red text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-[3px]">
                    {newDocs.length}
                  </span>
                )}
              </span>
              <span>알림</span>
            </button>

            {bellOpen && (
              <div className="absolute left-3 right-3 bottom-full mb-2 bg-white border border-brand-border rounded-lg shadow-brand z-40 max-h-80 overflow-auto">
                {newDocs.length === 0 ? (
                  <p className="p-3 text-sm text-brand-muted">새 알림 없음</p>
                ) : (
                  newDocs.map((doc) => (
                    <button
                      key={doc.id}
                      onClick={() => {
                        setActiveTab("coop");
                        openDetail(doc.id);
                        setBellOpen(false);
                      }}
                      className="block w-full text-left px-3 py-2 text-sm border-b border-brand-border hover:bg-brand-alt last:border-b-0"
                    >
                      <p className="font-medium text-brand-navy truncate">
                        {doc.title || doc.raw_text?.slice(0, 30) || "(제목 없음)"}
                      </p>
                      <p className="text-xs text-brand-muted">{doc.sender_dept}</p>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </nav>
    </>
  );
}
