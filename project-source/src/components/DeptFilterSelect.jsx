// src/components/DeptFilterSelect.jsx
// 부서 필터 드롭다운.
// 2026-08-22(14): 우진 개인 조직도를 손으로 묶어둔 kisApi.js DEPT_GROUPS 대신,
// CoopPage.jsx가 실제 받은 문서들의 recv_dept_name을 모아 options prop으로
// 넘겨줌 — 계정이 누구든 자동으로 본인이 실제 받은 부서 목록만 뜬다.

import useStore from "../store/useStore.js";

export default function DeptFilterSelect({ options = [] }) {
  const selectedDeptGroupKey = useStore((s) => s.selectedDeptGroupKey);
  const setSelectedDeptGroup = useStore((s) => s.setSelectedDeptGroup);

  return (
    <label className="text-sm text-brand-muted flex items-center gap-2">
      부서
      <select
        value={selectedDeptGroupKey ?? ""}
        onChange={(e) => setSelectedDeptGroup(e.target.value || null)}
        className="border border-brand-border rounded-md px-2 py-1 text-sm bg-white"
      >
        <option value="">전체</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
