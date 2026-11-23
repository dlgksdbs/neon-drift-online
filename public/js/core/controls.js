/* =============================================================================
   controls.js — 운전 입력 해석 (서버 없이 순수 계산)
   자동 가속 ON  : 브레이크만 누르면 감속, 나머지는 항상 스로틀 1
   자동 가속 OFF : GAS 페달(터치) 또는 W/↑(키보드)을 눌러야 스로틀 1
   ============================================================================= */

/**
 * @param {object} o
 * @param {boolean} o.autoAccel 자동 가속 설정
 * @param {boolean} o.gasHeld   GAS 페달을 누르고 있는가
 * @param {boolean} o.keyUp     W / ↑ 를 누르고 있는가
 * @param {boolean} o.braking   브레이크(BRAKE / S / ↓)를 누르고 있는가
 * @returns {{throttle:number, brake:number}}
 */
export function driveInputs({ autoAccel, gasHeld, keyUp, braking }) {
  const brake = braking ? 1 : 0;
  const throttle = brake ? 0 : (autoAccel ? 1 : (gasHeld || keyUp ? 1 : 0));
  return { throttle, brake };
}

/* 자동 가속이 꺼져 있을 때 가속 페달을 화면에 보여야 하는가 */
export function needsGasPedal(autoAccel) {
  return !autoAccel;
}
