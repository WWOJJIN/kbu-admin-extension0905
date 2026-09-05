import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// src/ 폴더의 React 앱 빌드 설정.
// ⚠️ 확장(웹 UI를 확장 안에 번들) 방식으로 가기로 함 — 아이콘 클릭 시 새 탭으로
// 이 빌드 결과물을 연다 (extension/background.js의 chrome.action.onClicked 참고).
// 그래서 build 결과물을 extension/dist로 바로 뽑는다. base:"./"는 chrome-extension://
// origin에서 index.html 기준 상대경로로 에셋을 찾게 하기 위함 (절대경로 "/"면
// extension 루트가 아니라 엉뚱한 곳을 찾게 됨).
//
// `npm run dev`(로컬 브라우저 스모크테스트용)는 이 설정과 무관하게 그대로 동작함.
export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "extension/dist",
  },
});
