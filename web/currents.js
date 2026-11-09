// ===== 조류: 국립해양조사원 조류예보(최강 창·낙조 및 전류) =====
// 사이트가 매달 받아 둔 data/currents.json 을 지도에 표시. 이용자 키 필요 없음.
let CUR = null, CURSEL = null, curChart = null;
const CURCOL = '#0b7285';
const curLayer = L.layerGroup().addTo(map);
if (!('K' in show)) show.K = true;
const _filters0 = filters;  // 다른 칩이 다시 그려질 때 조류 칩도 다시 붙임
filters = function () { _filters0(); const box = document.getElementById('filters'); if (box && !box.querySelector('[data-cur]')) { const l = document.createElement('label'); l.className = 'chip'; l.dataset.cur = 1;
  l.innerHTML = `<input type="checkbox" ${show.K ? 'checked' : ''}><span class="dot" style="background:${CURCOL};border-radius:2px;transform:rotate(45deg)"></span>조류예보`; l.querySelector('input').onchange = e => { show.K = e.target.checked; curDraw(); }; box.appendChild(l); } };

function curIcon(c) {
  return L.divIcon({ className: '', iconSize: [64, 20], iconAnchor: [7, 7], html: `<div style="display:flex;align-items:center;gap:3px">
   <svg width="14" height="14" viewBox="-7 -7 14 14"><rect x="-4.5" y="-4.5" width="9" height="9" transform="rotate(45)" fill="${CURCOL}" stroke="#fff" stroke-width="1.5"/></svg>
   <span class="wlab" style="color:${CURCOL}">${c.max.toFixed(1)}</span></div>` });
}
function curDraw() {
  curLayer.clearLayers(); if (!CUR || !show.K) return;
  for (const c of CUR.stations) L.marker([c.lat, c.lon], { icon: curIcon(c), zIndexOffset: -100 }).addTo(curLayer).on('click', () => curSelect(c.code))
    .bindTooltip(`${c.name} · 조류예보 최강 ${c.max.toFixed(2)} m/s`);
}
async function curLoad() {
  try { const r = await fetch('data/currents.json?' + Math.floor(Date.now() / 36e5)); if (!r.ok) return; CUR = await r.json(); curDraw(); } catch (e) { /* 아직 자료 없음 */ }
}
const dirName = d => ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서'][Math.round(((d % 360) + 360) % 360 / 22.5) % 16];
const kmTo = (c, lat, lon) => typeof hav === 'function' ? hav([lat, lon], [c.lat, c.lon]) : null;

async function curSelect(code) {
  const c = CUR && CUR.stations.find(x => x.code == code); if (!c) return;
  CURSEL = c; SEL = null; toPanel();
  if (typeof PIN !== 'undefined' && PIN) { map.removeLayer(PIN); PIN = null; }
  const g = c.groups || [];
  document.getElementById('panel').innerHTML = `${navBtns(true)}
   <h2>${c.name} <span class="sub">조류예보 · ${c.code}</span></h2>
   <div class="sub">${c.lat.toFixed(4)}, ${c.lon.toFixed(4)} · 예측 ${c.t0} ~ ${c.t1} · ${c.fetched} 받음</div>
   <div class="grid"><div class="kv"><span>최강 유속 (m/s, 예측 기간 전체)</span><b style="color:${CURCOL}">${c.max.toFixed(2)}</b></div>
    <div class="kv"><span>그때 유향</span><b>${Math.round(c.maxdir)}° <small style="font-size:11px">${dirName(c.maxdir)}</small></b></div>
    <div class="kv"><span>그때 시각</span><b style="font-size:13px">${c.maxt}</b></div>
    <div class="kv"><span>최강 유속 평균</span><b>${c.mean.toFixed(2)}</b></div><div class="kv"><span>상위 5% 값</span><b>${c.p95.toFixed(2)}</b></div>
    <div class="kv"><span>최강류 횟수</span><b>${c.n.toLocaleString()}</b></div></div>
   ${g.length ? `<table class="tbl"><tr><th>흐름 방향 (최강 유향 ±90°로 나눔)</th><th>최강</th><th>평균</th><th>횟수</th></tr>
    ${g.map(x => `<tr><td>${x.dir}° (${dirName(x.dir)}쪽으로)</td><td>${x.max.toFixed(2)}</td><td>${x.mean.toFixed(2)}</td><td>${x.n}</td></tr>`).join('')}</table>` : ''}
   <canvas id="cch" height="200"></canvas><div class="sub" id="cst"></div>
   <div class="box"><h3>기초 구조물 계산에 넣을 때</h3>
    <div style="font-size:13px;line-height:1.7">조류 표층 유속 후보: <b style="color:${CURCOL}">${c.max.toFixed(2)} m/s</b> (이 지점 예측 기간 ${c.t0.slice(0,4)}~${c.t1.slice(0,4)}년 중 최강)</div>
    <div class="sub" style="line-height:1.7">· 국립해양조사원이 조화분석으로 예측한 <b>조류(밀물·썰물) 성분만</b>입니다. 태풍 때의 취송류·해일류, 해류는 들어 있지 않아 설계에는 여유를 더하거나 사업지 해양조사 값과 비교하세요.<br>
     · 예보지점은 대개 항로·수도(좁은 물길)에 있어 트인 바다의 사업지보다 유속이 크게 나올 수 있습니다. 거리와 지형을 함께 보세요.<br>
     · 유속은 해당 예보지점의 표층 기준입니다.</div></div>
   <button class="btn pri" style="margin-top:8px" onclick="curToAnalysis()">📊 조류 요약 분석 (빈도·조류 장미·월별)</button>
   <div class="box"><h3>내려받기</h3><button class="btn" onclick="curCSV()">최강·전류 시각 CSV (${c.t0} ~ ${c.t1})</button>
    <div class="sub" style="margin-top:6px">출처: 국립해양조사원 조류예보(최강 창·낙조 및 전류), 공공데이터포털 · 공공누리 제1유형(출처표시)</div></div>`;
  map.setView([c.lat, c.lon], Math.max(map.getZoom(), 10));
  try {
    const s = await (await fetch(`data/currents/${c.code}.json?` + Math.floor(Date.now() / 864e5))).json(); CURSEL.ser = s;
    const pts = s.t.map((t, i) => ({ t, v: s.s[i], d: s.d[i] })).filter(p => p.v > 0);
    if (curChart) curChart.destroy();
    curChart = new Chart(document.getElementById('cch'), { type: 'line', data: { labels: pts.map(p => p.t.slice(5, 10)), datasets: [{ label: '최강 유속 (m/s)', data: pts.map(p => p.v), borderColor: CURCOL, backgroundColor: CURCOL, borderWidth: 1, pointRadius: 0 }] },
      options: { animation: false, plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: { ticks: { maxTicksLimit: 8, font: { size: 10 } } }, y: { beginAtZero: true, title: { display: true, text: 'm/s' } } } } });
    document.getElementById('cst').textContent = `대조기(사리)에 커지고 소조기(조금)에 작아지는 반복이 보입니다 · 최강류 ${pts.length}회`;
  } catch (e) { document.getElementById('cst').innerHTML = '<span class="err">시계열을 불러오지 못했습니다</span>'; }
}
function curCSV() {
  const c = CURSEL, s = c && c.ser; if (!s) return;
  const lines = ['지점코드,지점명,위도,경도,예측일시(KST),구분,유향(deg),유속(m/s)'];
  s.t.forEach((t, i) => lines.push(`${c.code},${c.name},${c.lat},${c.lon},${t},${s.s[i] > 0 ? '최강' : '전류(정조)'},${s.d[i] ?? ''},${s.s[i]}`));
  const u = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' })), a = document.createElement('a');
  a.href = u; a.download = `조류예보_${c.name}_${c.code}_${c.t0.slice(0, 4)}-${c.t1.slice(0, 4)}.csv`; a.click();
}
// 사업지 패널에 가까운 조류예보 지점 붙이기
function curNearHTML(lat, lon) {
  if (!CUR) return '';
  const list = CUR.stations.map(c => ({ c, d: kmTo(c, lat, lon) })).sort((a, b) => a.d - b.d).slice(0, 5);
  return `<div class="box"><h3>가까운 조류예보 지점 (국립해양조사원)</h3><table class="tbl"><tr><th>지점</th><th>거리</th><th>최강</th></tr>
   ${list.map(({ c, d }) => `<tr style="cursor:pointer" onclick="curSelect('${c.code}')"><td>${c.name}</td><td>${d.toFixed(1)}km</td><td>${c.max.toFixed(2)} m/s</td></tr>`).join('')}</table>
   <div class="sub">조류(밀물·썰물) 성분만의 예측값입니다. 눌러서 자세히 보기.</div></div>`;
}
filters();
curLoad();

// ===================================================================== 분석 › 조류 요약
// 자료: 조류예보 지점(최강류 시각만) 또는 직접 측정(ADCP 등) CSV의 유속·유향 열
const CBINS = [[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1.0], [1.0, 99]];
function dsFromCur(c, s) {
  const idx = s.t.map((_, i) => i).filter(i => s.s[i] > 0);  // 전류(정조, 0) 시각은 빼고 최강류만
  const nul = idx.map(() => null);
  dsAdd({ id: 'cur-' + c.code, name: `${c.name}(${c.code}) 조류예보`, kind: '조류예보 최강류(창·낙조 최강 시각만)', curFcst: true, z: null,
    t: idx.map(i => new Date(s.t[i].replace(' ', 'T')).getTime()), cs: idx.map(i => s.s[i]), cd: idx.map(i => s.d[i]), ws: nul, wd: nul, wh: nul });
}
async function curToAnalysis() {
  const c = CURSEL; if (!c) return;
  if (!c.ser) c.ser = await (await fetch(`data/currents/${c.code}.json`)).json();
  dsFromCur(c, c.ser); DSEL = 'cur-' + c.code; AN.tab = 'cur'; openAnalysis();
}
function curStats(d) {
  const v = [], mon = Array.from({ length: 12 }, () => ({ n: 0, s: 0, mx: 0 })), rose = Array.from({ length: 16 }, () => new Array(CBINS.length).fill(0));
  let mx = -1, mxi = -1, rn = 0;
  d.t.forEach((t, i) => {
    const s = d.cs[i]; if (s == null) return; v.push(s);
    if (s > mx) { mx = s; mxi = i; }
    const m = mon[new Date(t).getMonth()]; m.n++; m.s += s; if (s > m.mx) m.mx = s;
    const dr = d.cd && d.cd[i]; if (dr != null && s > 0) { const sec = Math.round(((dr % 360) + 360) % 360 / 22.5) % 16, b = CBINS.findIndex(([lo, hi]) => s >= lo && s < hi); rose[sec][b < 0 ? CBINS.length - 1 : b]++; rn++; }
  });
  const so = v.slice().sort((a, b) => a - b), mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
  const step = 0.1, nb = Math.max(1, Math.ceil((mx > 0 ? mx : 0.1) / step)), hist = new Array(nb).fill(0);
  v.forEach(x => hist[Math.min(nb - 1, Math.floor(x / step))]++);
  const exc = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0].map(th => [th, v.filter(x => x >= th).length * 100 / (v.length || 1)]);
  // 두 주 흐름 방향 (최강 유향 ±90°)
  const md = mxi >= 0 && d.cd ? d.cd[mxi] : null, grp = [];
  if (md != null) {
    const g = [[], []];
    d.t.forEach((_, i) => { const s = d.cs[i], dr = d.cd[i]; if (s == null || dr == null || s <= 0) return; g[Math.abs((dr - md + 540) % 360 - 180) <= 90 ? 0 : 1].push([s, dr]); });
    g.forEach(a => { if (!a.length) return; const sx = a.reduce((p, [, dr]) => p + Math.sin(dr * Math.PI / 180), 0), cx = a.reduce((p, [, dr]) => p + Math.cos(dr * Math.PI / 180), 0);
      grp.push({ dir: Math.round((Math.atan2(sx, cx) * 180 / Math.PI + 360) % 360), max: amax(a.map(x => x[0])), mean: a.reduce((p, x) => p + x[0], 0) / a.length, n: a.length }); });
  }
  return { n: v.length, mx, mxt: mxi >= 0 ? d.t[mxi] : null, mxd: md, mean, p50: pctl(so, .5), p90: pctl(so, .9), p95: pctl(so, .95), p99: pctl(so, .99), hist, step, exc, mon, rose, rn, grp };
}
function curView(out, d) {
  if (!dsHas(d, 'cs')) {
    out.innerHTML = `<div class="sub" style="line-height:1.7">이 자료에는 유속이 없습니다.<br>· 지도에서 <b style="color:${CURCOL}">청록 마름모(조류예보 지점)</b>를 누르고 "조류 요약 분석"을 누르거나,<br>· 직접 측정한 유속(ADCP 등) CSV를 올릴 때 <b>유속·유향 열</b>을 지정하세요.</div>`; return;
  }
  const S = curStats(d), dt = S.mxt ? new Date(S.mxt) : null, hh = dt ? `${iso(dt)} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}` : '–';
  out.innerHTML = `${d.curFcst ? `<div class="sub" style="background:#e6f4f5;border-radius:8px;padding:7px 9px;margin:6px 0;line-height:1.6">국립해양조사원 <b>예측 최강류</b>(창·낙조가 가장 셀 때) 값만으로 낸 통계입니다. 연속 관측이 아니라 평균·빈도는 '최강일 때' 기준이며, 조석 성분만 들어 있습니다.</div>` : ''}
  <div class="grid">
   <div class="kv"><span>최대 유속</span><b style="color:${CURCOL}">${f(S.mx, 2)} m/s</b></div>
   <div class="kv"><span>그때 유향 (흘러가는 쪽)</span><b>${S.mxd != null ? Math.round(S.mxd) + '° ' + dirName(S.mxd) : '–'}</b></div>
   <div class="kv"><span>최대 발생 시각</span><b style="font-size:12px">${hh}</b></div>
   <div class="kv"><span>평균 유속</span><b>${f(S.mean, 2)}</b></div>
   <div class="kv"><span>50% / 90%</span><b>${f(S.p50, 2)} / ${f(S.p90, 2)}</b></div>
   <div class="kv"><span>95% / 99%</span><b>${f(S.p95, 2)} / ${f(S.p99, 2)}</b></div></div>
  ${S.grp.length ? `<table class="tbl"><tr><th>주 흐름 방향 (흘러가는 쪽)</th><th>최대</th><th>평균</th><th>횟수</th></tr>${S.grp.map(g => `<tr><td>${g.dir}° ${dirName(g.dir)}</td><td>${f(g.max, 2)}</td><td>${f(g.mean, 2)}</td><td>${g.n.toLocaleString()}</td></tr>`).join('')}</table>` : ''}
  <h3 style="font-size:14px;margin:10px 0 4px">유속 빈도 (0.1 m/s 구간)</h3><canvas id="c_hist" height="170"></canvas>
  <table class="tbl"><tr><th>초과 유속</th>${S.exc.map(([t]) => `<th>≥${t}</th>`).join('')}</tr><tr><td>비율(%)</td>${S.exc.map(([, p]) => `<td>${f(p, 1)}</td>`).join('')}</tr></table>
  <h3 style="font-size:14px;margin:10px 0 4px">조류 장미 (흘러가는 방향 기준)</h3>${S.rn ? roseSVG({ rose: S.rose, rn: S.rn }, CBINS, 'm/s') : '<div class="sub">유향 자료가 없습니다</div>'}
  <h3 style="font-size:14px;margin:10px 0 4px">월별 평균·최대 유속</h3><canvas id="c_mon" height="170"></canvas>
  <div class="box"><h3>기초 구조물 계산에 넣을 때</h3>
   <div style="font-size:13px;line-height:1.7">조류 표층 유속 후보: <b style="color:${CURCOL}">${f(S.mx, 2)} m/s</b> (자료 기간 최대) · 참고: 99% 값 ${f(S.p99, 2)} m/s</div>
   <div class="sub" style="line-height:1.6">· ${d.curFcst ? '조석 예측값이라 태풍 때의 취송류·해일류는 빠져 있습니다. 설계에는 여유를 더하거나 사업지 해양조사(ADCP) 결과와 비교하세요.' : '측정 기간이 짧으면 대조기(사리)·폭풍 시 최대가 빠질 수 있습니다. 최소 한 달(대조기 2번)은 넘는 자료를 쓰세요.'}<br>
   · 수심별 분포가 필요하면 기초 계산 도구의 1/7승 분포처럼 표층 값을 기준으로 줄여 씁니다.</div></div>
  <button class="btn" onclick="curSumCSV()">요약 CSV 받기</button>`;
  chart2('c_hist', { type: 'bar', data: { labels: S.hist.map((_, i) => (i * S.step).toFixed(1)), datasets: [{ label: '비율(%)', data: S.hist.map(n => n * 100 / S.n), backgroundColor: CURCOL }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { x: { title: { display: true, text: 'm/s (구간 시작값)' } }, y: { title: { display: true, text: '%' } } } } });
  chart2('c_mon', { type: 'bar', data: { labels: S.mon.map((_, i) => (i + 1) + '월'), datasets: [
    { label: '평균', data: S.mon.map(m => m.n ? m.s / m.n : null), backgroundColor: '#66b2b9' }, { label: '최대', data: S.mon.map(m => m.n ? m.mx : null), backgroundColor: CURCOL }] },
    options: { animation: false, plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { y: { beginAtZero: true, title: { display: true, text: 'm/s' } } } } });
  AN.lastCur = { d, S };
}
function curSumCSV() {
  const { d, S } = AN.lastCur, L = [`자료,${d.name}`, `기간,${dsSpan(d)}`, `종류,${d.kind}`, '',
    '항목,값', `자료 수,${S.n}`, `최대 유속(m/s),${S.mx.toFixed(3)}`, `최대 유향(deg 흘러가는 쪽),${S.mxd != null ? Math.round(S.mxd) : ''}`,
    `최대 발생 시각,${S.mxt ? new Date(S.mxt).toLocaleString('ko-KR') : ''}`, `평균(m/s),${S.mean.toFixed(3)}`,
    `50%,${S.p50.toFixed(3)}`, `90%,${S.p90.toFixed(3)}`, `95%,${S.p95.toFixed(3)}`, `99%,${S.p99.toFixed(3)}`, '',
    '주 흐름 방향(deg),최대(m/s),평균(m/s),횟수', ...S.grp.map(g => `${g.dir},${g.max.toFixed(3)},${g.mean.toFixed(3)},${g.n}`), '',
    '초과 유속(m/s),비율(%)', ...S.exc.map(([t, p]) => `${t},${p.toFixed(2)}`), '',
    '월,평균(m/s),최대(m/s),자료 수', ...S.mon.map((m, i) => `${i + 1},${m.n ? (m.s / m.n).toFixed(3) : ''},${m.n ? m.mx.toFixed(3) : ''},${m.n}`)];
  dlText(`조류요약_${d.name.replace(/[\\/:*?"<>|\s]/g, '_')}.csv`, L.join('\r\n'));
}
