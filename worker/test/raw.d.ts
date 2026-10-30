// Vite ?raw 가져오기(test/contract.ts — 상위 계약 YAML 원문). 모듈이 아닌 파일이어야 전역 선언이 된다.
declare module "*?raw" {
  const text: string;
  export default text;
}
