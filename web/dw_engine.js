// ===== 설계파 산정 계산 엔진 (DOM 없음 — node 로 검증 가능) =====
// 1) 관측 극치분석: 연최대(AM)·POT, 검벨·와이블 적합(최소자승, 확률지), 붓스트랩 신뢰구간
// 2) 심해설계파 → 현장 설계파: 스넬 굴절(평행 등심선), 선형 천수, 고다(Goda) 쇄파식(KDS 64 10 10), 쇄파 한계, 파봉고, 파이론 범위
(function (root) {
  const g = 9.81, PI = Math.PI;
  const DWE = {};

  // ---------- 파랑 기본식 ----------
  DWE.L0 = T => g * T * T / (2 * PI);
  DWE.k = (T, h) => {                         // 분산관계식 ω² = g k tanh(kh), 뉴턴법
    const w = 2 * PI / T; if (!(h > 0)) return w * w / g;
    let k = w * w / g / Math.sqrt(Math.tanh(w * w * h / g));   // 초기값(Eckart 근사)
    for (let i = 0; i < 60; i++) { const th = Math.tanh(k * h), fk = g * k * th - w * w, d = g * th + g * k * h * (1 - th * th); const dk = fk / d; k -= dk; if (Math.abs(dk) < 1e-12) break; }
    return k;
  };
  DWE.wave = (T, h) => {                      // 수심 h 에서 파장·파속·군속도
    const k = DWE.k(T, h), L = 2 * PI / k, C = L / T, kh = k * h, n = 0.5 * (1 + 2 * kh / Math.sinh(2 * kh));
    return { k, L, C, kh, n, Cg: n * C, L0: DWE.L0(T), C0: g * T / (2 * PI), Cg0: g * T / (4 * PI) };
  };

  // ---------- 심해 → 현장 ----------
  // dirFrom: 파향(오는 방향, 도), normalOff: 등심선 법선의 외해 쪽 방향(도, 이 방향에서 오는 파가 정면 입사)
  DWE.transform = function (p) {
    const { H0, T, h, tan, dirFrom, normalOff, Kd = 1.0 } = p;
    const W = DWE.wave(T, h), L0 = W.L0;
    const a0 = (((dirFrom - normalOff) % 360) + 540) % 360 - 180;       // 심해 입사각(등심선 법선 기준, 도)
    const out = { in: p, W, L0, a0, warn: [] };
    if (Math.abs(a0) >= 90) { out.reach = false; out.warn.push(`파향(${dirFrom}°)이 등심선 법선(${normalOff}°)과 ${Math.abs(a0).toFixed(1)}° 차이 나 해안 쪽으로 진행하지 않습니다`); return out; }
    out.reach = true;
    const sa = (W.C / W.C0) * Math.sin(a0 * PI / 180), a = Math.asin(sa) * 180 / PI;
    const Kr = Math.sqrt(Math.cos(a0 * PI / 180) / Math.cos(a * PI / 180));
    const Ks = Math.sqrt(W.Cg0 / W.Cg);
    const H0p = Kr * Kd * H0, st = H0p / L0, hL0 = h / L0;
    // 고다(1975) 쇄파 산정식 — KDS 64 10 10 (항만 및 어항 설계기준) 채택
    const e15 = Math.exp(20 * Math.pow(tan, 1.5));
    const b0 = 0.028 * Math.pow(st, -0.38) * e15, b1 = 0.52 * Math.exp(4.2 * tan), bmax = Math.max(0.92, 0.32 * Math.pow(st, -0.29) * Math.exp(2.4 * tan));
    const b0s = 0.052 * Math.pow(st, -0.38) * e15, b1s = 0.63 * Math.exp(3.8 * tan), bmaxs = Math.max(1.65, 0.53 * Math.pow(st, -0.29) * Math.exp(2.4 * tan));
    let Hs, Hmax, zone, govS, govM;
    const KsH = Ks * H0p;
    if (hL0 >= 0.2) { Hs = KsH; Hmax = 1.8 * KsH; zone = '비쇄파 (h/L0 ≥ 0.2)'; govS = 'Ks·H0′'; govM = '1.8·Ks·H0′'; }
    else {
      const cS = [[b0 * H0p + b1 * h, 'β0·H0′ + β1·h'], [bmax * H0p, 'βmax·H0′'], [KsH, 'Ks·H0′']], cM = [[b0s * H0p + b1s * h, 'β0*·H0′ + β1*·h'], [bmaxs * H0p, 'βmax*·H0′'], [1.8 * KsH, '1.8·Ks·H0′']];
      const mS = cS.reduce((x, y) => y[0] < x[0] ? y : x), mM = cM.reduce((x, y) => y[0] < x[0] ? y : x);
      Hs = mS[0]; govS = mS[1]; Hmax = mM[0]; govM = mM[1];
      zone = govS === 'Ks·H0′' && govM === '1.8·Ks·H0′' ? '비쇄파 (h/L0 < 0.2, 쇄파 영향 없음)' : '쇄파대 (고다 쇄파식 적용)';
      out.cand = { S: cS, M: cM };
    }
    // 쇄파 한계(고다 쇄파지표): Hb = A·L0·{1 − exp[−1.5·π·h/L0·(1 + 15·tan^(4/3)θ)]}, A = 0.17
    const Hb = 0.17 * L0 * (1 - Math.exp(-1.5 * PI * hL0 * (1 + 15 * Math.pow(tan, 4 / 3))));
    const HbMiche = 0.142 * W.L * Math.tanh(W.kh);
    // 파봉고(정수면 위): 선형 H/2, 2차 스토크스 η = H/2 + (πH²/8L)·cosh(kh)(2+cosh2kh)/sinh³(kh)
    const crestLin = Hmax / 2, kh = W.kh;
    const crestSt2 = Hmax / 2 + (PI * Hmax * Hmax / (8 * W.L)) * Math.cosh(kh) * (2 + Math.cosh(2 * kh)) / Math.pow(Math.sinh(kh), 3);
    const Ur = Hmax * W.L * W.L / (h * h * h);
    let crest, crestNote;
    if (Ur <= 26) { crest = Math.max(crestLin, crestSt2); crestNote = '2차 스토크스 (Ur ≤ 26)'; }
    else if (crestSt2 <= 0.8 * Hmax) { crest = crestSt2; crestNote = '2차 스토크스 (Ur > 26 크노이드 영역이라 과대 가능, 0.8·Hmax 상한 이내)'; }
    else { crest = 0.8 * Hmax; crestNote = '크노이드 영역(Ur > 26): 2차 스토크스 과대 → 0.8·Hmax 상한 적용(가정)'; }
    const crestCap = Ur > 26 && crestSt2 > 0.8 * Hmax;
    const theory = hL0 >= 0.5 ? '심해파' : hL0 < 0.05 ? '천해파' : '천이 영역';
    const theoryFit = Ur <= 26 ? '스토크스 파 이론 적용 범위 (Ur ≤ 26)' : '크노이드 파 이론 범위 (Ur > 26) — 선형·스토크스 파 이론 적용 시 주의';
    if (Hmax > Hb + 1e-9) out.warn.push(`최대파고 ${Hmax.toFixed(2)} m가 쇄파 한계 ${Hb.toFixed(2)} m를 넘습니다`);
    if (!(tan > 0)) out.warn.push('해저 경사가 0 이하입니다 — 고다 식은 경사 1/100 ~ 1/10 범위에서 검증된 식입니다');
    else if (tan < 0.01 || tan > 0.1) out.warn.push(`해저 경사 tanθ = ${tan}는 고다 식의 검증 범위(1/100 ~ 1/10) 밖입니다`);
    Object.assign(out, { a, Kr, Ks, Kd, H0p, st, hL0, b: { b0, b1, bmax, b0s, b1s, bmaxs }, Hs, Hmax, zone, govS, govM, Hb, HbMiche, crestLin, crestSt2, crest, crestNote, crestCap, Ur, theory, theoryFit, T13: T, Tmax: T });
    return out;
  };
  // 수심에 따른 파고 변화 (그림용): 심해 h/L0=0.5 → 현장 수심
  DWE.profile = function (p, n = 40) {
    const L0 = DWE.L0(p.T), h1 = Math.max(p.h, 0.5 * L0), out = [];
    for (let i = 0; i <= n; i++) { const h = h1 + (p.h - h1) * i / n, r = DWE.transform({ ...p, h }); if (r.reach) out.push({ h, Hs: r.Hs, Hmax: r.Hmax, Hb: r.Hb, Ks: r.Ks, Kr: r.Kr }); }
    return out;
  };

  // ---------- 관측 극치분석 ----------
  // d: {t[], wh[]} (ms 시각, 유의파고 m), stepMin: 자료 간격(분)
  DWE.yearTable = function (d, stepMin) {
    const Y = new Map(), per = 1440 / stepMin;
    for (let i = 0; i < d.t.length; i++) { const dt = new Date(d.t[i]), y = dt.getFullYear(); if (!Y.has(y)) Y.set(y, { y, n: 0, nTy: 0, mx: -1, mxt: null });
      const r = Y.get(y), v = d.wh[i]; if (v == null) continue; r.n++; const m = dt.getMonth(); if (m >= 6 && m <= 9) r.nTy++; if (v > r.mx) { r.mx = v; r.mxt = d.t[i]; } }
    const t0 = new Date(d.t[0]), t1 = new Date(d.t[d.t.length - 1]);
    return [...Y.values()].sort((a, b) => a.y - b.y).map(r => {
      const ys = new Date(r.y, 0, 1).getTime(), ye = new Date(r.y + 1, 0, 1).getTime(), s = Math.max(ys, t0.getTime()), e = Math.min(ye, t1.getTime() + stepMin * 6e4);
      const tys = Math.max(new Date(r.y, 6, 1).getTime(), t0.getTime()), tye = Math.min(new Date(r.y, 10, 1).getTime(), t1.getTime() + stepMin * 6e4);
      const yearDays = (ye - ys) / 864e5, cover = (e - s) / 864e5;
      return { ...r, partial: cover < yearDays - 0.5, rate: r.n / (yearDays * per), rateCover: r.n / Math.max(1, cover * per), rateTy: tye > tys ? r.nTy / ((new Date(r.y, 10, 1) - new Date(r.y, 6, 1)) / 864e5 * per) : null, tyCovered: tye - tys };
    });
  };
  DWE.effYears = (d, stepMin) => d.wh.reduce((a, v) => a + (v != null), 0) * stepMin / (365.25 * 1440);
  // POT: 임계값 u 를 넘는 구간을 폭풍으로 묶고(간격 sepH 시간 미만이면 같은 폭풍), 폭풍마다 정점 1개
  DWE.pot = function (d, u, sepH) {
    const pk = []; let cur = null, last = -Infinity;
    for (let i = 0; i < d.t.length; i++) { const v = d.wh[i]; if (v == null || v <= u) continue; const t = d.t[i];
      if (cur && t - last < sepH * 36e5) { if (v > cur.v) { cur.v = v; cur.t = t; } } else { if (cur) pk.push(cur); cur = { v, t, start: t }; } last = t; }
    if (cur) pk.push(cur);
    // 정점 사이도 sepH 이상 떨어지게 (가까우면 큰 쪽만)
    const out = []; for (const p of pk) { const q = out[out.length - 1]; if (q && p.t - q.t < sepH * 36e5) { if (p.v > q.v) out[out.length - 1] = p; } else out.push(p); }
    return out;
  };
  const lsq = (xs, ys) => { const n = xs.length; let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i]; }
    const A = (n * sxy - sx * sy) / (n * sxx - sx * sx), B = (sy - A * sx) / n, r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy)); return { A, B, r }; };
  // 분포 적합 (최소자승, 확률지). x: 표본, lam: 연간 발생률(AM 이면 1), dist: 'gumbel' | 'weibull3' (k 고정) | 'weibull2'
  DWE.fit = function (x, lam, dist, k) {
    const xs = x.slice().sort((a, b) => b - a), N = xs.length; if (N < 3) return null;
    const pts = [];
    for (let m = 1; m <= N; m++) {
      let F, y;
      if (dist === 'gumbel') { F = 1 - (m - 0.44) / (N + 0.12); y = -Math.log(-Math.log(F)); }            // Gringorten
      else { const kk = dist === 'weibull2' ? 1.0 : k, al = 0.20 + 0.27 / Math.sqrt(kk), be = 0.20 + 0.23 / Math.sqrt(kk); F = 1 - (m - al) / (N + be); y = dist === 'weibull3' ? Math.pow(-Math.log(1 - F), 1 / k) : Math.log(-Math.log(1 - F)); }  // Goda 도시위치
      pts.push({ x: xs[m - 1], F, y });
    }
    let A, B, r, kk = k;
    if (dist === 'weibull2') {  // ln(-ln(1-F)) = k·ln x − k·ln A  → 직선
      const L = lsq(pts.map(p => Math.log(p.x)), pts.map(p => p.y)); kk = L.A; A = Math.exp(-L.B / L.A); B = 0; r = L.r;
      pts.forEach(p => { p.yv = Math.pow(-Math.log(1 - p.F), 1 / kk); });   // 그림용(직선화 변수)
    } else { const L = lsq(pts.map(p => p.y), pts.map(p => p.x)); A = L.A; B = L.B; r = L.r; }
    const yR = R => dist === 'gumbel' ? -Math.log(-Math.log(1 - 1 / (lam * R))) : Math.pow(Math.log(lam * R), 1 / kk);
    const xR = R => A * yR(R) + B;
    return { dist, k: kk, A, B, r, N, lam, pts, yR, xR };
  };
  DWE.fitMoM = function (x) {   // 검벨 적률법 (기존 방법, 비교용)
    const n = x.length; if (n < 3) return null; const m = x.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
    const beta = sd * Math.sqrt(6) / PI, mu = m - 0.5772 * beta;
    return { dist: 'gumbel-mom', A: beta, B: mu, N: n, lam: 1, xR: R => mu - beta * Math.log(-Math.log(1 - 1 / R)) };
  };
  // POT 와이블 3모수: 고다 후보 k ∈ {0.75, 1.0, 1.4, 2.0} 중 상관계수 최대
  DWE.WK = [0.75, 1.0, 1.4, 2.0];
  DWE.fitBest = (x, lam) => DWE.WK.map(k => DWE.fit(x, lam, 'weibull3', k)).filter(Boolean).sort((a, b) => b.r - a.r)[0] || null;
  // 붓스트랩 신뢰구간 (표본 복원추출 → 같은 방법으로 다시 적합)
  DWE.boot = function (x, lam, refit, Rs, nb = 500, seed = 12345) {
    let s = seed; const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const out = Rs.map(() => []);
    for (let b = 0; b < nb; b++) { const xb = x.map(() => x[Math.floor(rnd() * x.length)]); const F = refit(xb, lam); if (!F) continue; Rs.forEach((R, i) => { const v = F.xR(R); if (isFinite(v)) out[i].push(v); }); }
    const q = (a, p) => { a.sort((u, v) => u - v); const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a.length ? a[lo] + (a[hi] - a[lo]) * (i - lo) : null; };
    return Rs.map((R, i) => ({ R, lo: q(out[i], 0.05), hi: q(out[i], 0.95), n: out[i].length }));
  };
  DWE.RS = [10, 30, 50, 100];

  if (typeof module !== 'undefined' && module.exports) module.exports = DWE; else root.DWE = DWE;
})(this);
