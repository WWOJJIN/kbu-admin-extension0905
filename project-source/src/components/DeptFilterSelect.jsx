// src/components/DeptFilterSelect.jsx
// 부서 필터 드롭다운.
// 2026-08-22(14): 우진 개인 조직도를 손으로 묶어둔 kisApi.js DEPT_GROUPS 대신,
// CoopPage.jsx가 실제 받은 문서들의 recv_dept_name을 모아 options prop으로
// 넘겨줌 — 계정이 누구든 자동으로 본인이 실제 받은 부서 목록만 뜬다.
//
// 2026-09-07(7): "검색창(긴 박스) > 작은 박스 > 부서 드롭다운" 요청으로 "부서"
// 텍스트를 작은 테두리 박스(칩)로 감쌌었는데, 바로 이어진 요청("검색창이
// 부서 드롭다운까지 늘려주고 그 옆에 부서 드롭다운")은 그 중간 박스 없이
// 검색창 자체가 드롭다운 바로 앞까지 쭉 늘어나길 원한 것이었다. "부서" 칩을
// 다시 없애고 드롭다운(select)만 남김 — 라벨 텍스트는 화면엔 안 보이되
// sr-only로만 남겨서 접근성은 유지.

import useStore from "../store/useStore.js";

export default function DeptFilterSelect({ options = [] }) {
  const selectedDeptGroupKey = useStore((s) => s.selectedDeptGroupKey);
  const setSelectedDeptGroup = useStore((s) => s.setSelectedDeptGroup);

  return (
    <select
      value={selectedDeptGroupKey ?? ""}
      onChange={(e) => setSelectedDeptGroup(e.target.value || null)}
      aria-label="부서 필터"
      className="border border-brand-border rounded-md px-2 py-1 text-sm bg-white flex-shrink-0"
    >
      <option value="">전체 부서</option>
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}
