/* =============================================================================
   progress.js — 순서 기반 체크포인트 · 랩 · 순위 (순수 JS)
   역주행/지름길 방지: 체크포인트를 순서대로 통과해야 랩이 인정된다.
   ============================================================================= */

export class RaceProgress {
  constructor(track, opts = {}) {
    this.track = track;
    this.laps = opts.laps || 3;
    this.checkpoints = track.checkpoints;
    this.reset(opts.s || 0, opts.t || 0);
  }

  reset(s = 0, t = 0) {
    this.s = s;
    this.sPrev = s;
    this.nextCp = 0;      // 0 = 스타트/피니시 라인 통과 대기, 1..7 = 중간 체크포인트
    this.lap = 0;          // 완료한 랩 수
    this.lapStart = t;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = null;
    this.bestLap = null;
    this.wrongWayTime = 0;
    this.lastDelta = 0;
    this.t = t;
    this.started = false;
  }

  /* s: 트랙 위 호장 위치(0..total), t: 경과 시간(초) */
  update(s, t) {
    const total = this.track.total;
    let delta = s - this.sPrev;
    if (delta < -total / 2) delta += total;
    if (delta > total / 2) delta -= total;
    this.sPrev = s;
    this.s = s;
    this.t = t;
    this.lastDelta = delta;

    if (this.finished) return { crossed: null, lapDone: false };

    // 역주행 판정
    if (delta < -0.4) this.wrongWayTime += 0.016; else this.wrongWayTime = Math.max(0, this.wrongWayTime - 0.05);
    this.wrongWay = this.wrongWayTime > 0.45;

    let lapDone = false;
    let crossed = null;

    if (delta > 0) {
      // 다음 목표 체크포인트까지 전방 거리
      const targetS = this.nextCp === 0 ? 0 : this.checkpoints[this.nextCp].s;
      let dToTarget = targetS - s + total;
      if (dToTarget >= total) dToTarget -= total;
      dToTarget = (targetS - (s - delta) + total) % total;
      if (delta >= dToTarget - 1e-6 && dToTarget >= 0) {
        if (this.nextCp === 0) {
          // 스타트 라인 통과
          if (this.lap === 0 && !this.started) {
            this.started = true;
          } else {
            const lapTime = t - this.lapStart;
            this.lapTimes.push(lapTime);
            if (this.bestLap === null || lapTime < this.bestLap) this.bestLap = lapTime;
            this.lap++;
            lapDone = true;
            this.lapStart = t;
            if (this.lap >= this.laps) {
              this.finished = true;
              this.finishTime = t;
            }
          }
          this.nextCp = 1;
          crossed = 'start';
        } else {
          crossed = this.nextCp;
          this.nextCp = (this.nextCp + 1) % this.checkpoints.length;
          if (this.nextCp === 0) crossed = 'last';
        }
      }
    }
    return { crossed, lapDone };
  }

  get cpCount() { return this.checkpoints.length; }

  /* 순위 계산용 진행도: 완료 랩 + 현재 위치 */
  get progressValue() {
    return this.lap * this.track.total + this.s;
  }

  get lapDisplay() {
    return Math.min(this.laps, this.lap + 1);
  }

  lapTime(t) {
    if (this.finished) return this.lapTimes[this.lapTimes.length - 1] || 0;
    return Math.max(0, t - this.lapStart);
  }
}

/* 배열화: 참가자 순위 계산 */
export function rankRacers(racers) {
  return racers
    .slice()
    .sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progressValue - a.progressValue;
    });
}

export function formatTime(sec) {
  if (sec === null || sec === undefined || !isFinite(sec)) return '--:--.--';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}
