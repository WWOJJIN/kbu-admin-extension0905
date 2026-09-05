/** @type {import('tailwindcss').Config} */
// 디자인 토큰: kbu-assistant(css/style.css)의 팔레트를 그대로 이식.
// admin의 기본 Tailwind slate/blue 대신, 아래 커스텀 컬러를 컴포넌트에서 사용한다.
//   brand-navy   : 네브바 배경 (#1A1B2E)
//   brand-blue   : 포인트 컬러 / 활성 탭 / 버튼 (#4F6EF7)
//   brand-blueDark : 호버/그라데이션 (#3D57E8)
//   상태 컬러(amber/red/green)는 각각 "처리 필요/마감임박", "긴급", "완료" 배지에 사용.
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          navy: "#1A1B2E",
          blue: "#4F6EF7",
          blueDark: "#3D57E8",
          muted: "#6B7280",
          border: "#E4E7F2",
          alt: "#F5F7FF",
        },
        status: {
          amber: "#D9822B",
          amberBg: "#FDF3E7",
          red: "#E5484D",
          redBg: "#FDEEEE",
          green: "#1E9E6E",
          greenBg: "#EAF7F1",
          // 2026-09-02 추가: 학적변동 탭 "현황 요약" 패널 전용 포인트 컬러.
          // 브랜드 블루(주 액션)와 구분되는 보조 액센트로, 이 패널에서만 씀.
          violet: "#7C5CFC",
          violetBg: "#F5F3FF",
        },
      },
      fontFamily: {
        sans: [
          '"Pretendard"',
          '"Malgun Gothic"',
          '"Apple SD Gothic Neo"',
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      boxShadow: {
        brand: "0 8px 24px rgba(26, 27, 46, 0.08)",
      },
    },
  },
  plugins: [],
};
