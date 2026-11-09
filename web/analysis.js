// 해양기상 대시보드 — 분석 기능 (자료 보관함, 풍황 요약, 작업 가능일, 장기 보정 MCP, 사업지 경계)
// index.html 의 전역(map, SEL, SER, HUB, conv, zOf, TYPES, tmfmt, iso, f, MISS, STATIONS 등)을 사용합니다.

// ===================================================================== 자료 보관함
// 자료 한 묶음 = {id, name, kind, z(풍속 측정 높이 m, 모르면 null), daily(일자료 여부), t[], ws[], wd[], wh[]}
const DSL = [];
let DSEL = null;                 // 분석에 쓸 자료 id
const num = v => { if (v === null || v === undefined || v === '') return null; const x = +v; return isFinite(x) && !MISS.has(String(v)) ? x : null; };
const tm12 = s => { s = String(s); return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10) || 0, +s.slice(10, 12) || 0).getTime(); };

function dsAdd(d) {
  const i = DSL.findIndex(x => x.id === d.id);
  if (i >= 0) DSL[i] = d; else DSL.push(d);
  if (!DSEL) DSEL = d.id;
  if (document.getElementById('dslist')) dsRender();
}
function dsGet(id) { return DSL.find(x => x.id === id); }
function dsSpan(d) { if (!d.t.length) return '자료 없음'; const a = new Date(d.t[0]), b = new Date(d.t[d.t.length - 1]); return `${iso(a)} ~ ${iso(b)}`; }
function dsHas(d, k) { return d[k] && d[k].some(v => v != null); }

// 지점 30일 자료 → 보관함
function dsFromSER(st, ser) {
  if (!ser || !ser.tm || !ser.tm.length) return;
  dsAdd({ id: 'ser-' + st.stn, name: `${st.name}(${st.stn}) 최근 30일`, kind: '지점 30일·1시간', z: zOf(st), stn: st,
    t: ser.tm.map(tm12), ws: (ser.ws || []).map(num), wd: (ser.wd || []).map(num), wh: (ser.wh || []).map(num) });
}
// 장기 받기(부이 30분) → 보관함
function dsFromBuoy(st, rows, a, b) {
  dsAdd({ id: `buoy-${st.stn}-${iso(a)}-${iso(b)}`, name: `${st.name}(${st.stn}) ${iso(a)}~${iso(b)}`, kind: '부이 30분', z: zOf(st), stn: st,
    t: rows.map(r => tm12(r.TM)), ws: rows.map(r => num(r.WS1)), wd: rows.map(r => num(r.WD1)), wh: rows.map(r => num(r.WH_SIG)) });
}
// 장기 받기(등표·파고부이 일자료) → 보관함
function dsFromDaily(st, rows, a, b) {
  dsAdd({ id: `day-${st.stn}-${iso(a)}-${iso(b)}`, name: `${st.name}(${st.stn}) 일자료 ${iso(a)}~${iso(b)}`, kind: '일자료(일평균)', daily: true, z: zOf(st), stn: st,
    t: rows.map(r => new Date(r.date + 'T12:00').getTime()), ws: rows.map(r => num(r.ws)), wd: rows.map(() => null), wh: rows.map(r => num(r.wh_sig)) });
}
// 재현바람장 → 보관함 (고도별로 하나씩)
function dsFromRawm(lat, lon, hs, itv, rows) {
  for (const h of hs) dsAdd({ id: `rw-${lat}-${lon}-${h}-${itv}`, name: `재현바람장 ${lat},${lon} ${h}m`, kind: `재현바람장 ${itv}분`, z: h, lat, lon,
    t: rows.map(r => tm12(r.tm)), ws: rows.map(r => num(r['ws' + h])), wd: rows.map(r => num(r['wd' + h])), wh: rows.map(() => null) });
}

// ----- 직접 측정한 CSV 올리기 (열 자동 인식, 바꿀 수 있음)
function csvSplit(line) { const out = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if ((ch === ',' || ch === '\t' || ch === ';') && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; }
function parseTime(s) {
  s = String(s || '').trim(); if (!s) return null;
  if (/^\d{12}$/.test(s) || /^\d{10}$/.test(s)) return tm12(s.padEnd(12, '0'));
  if (/^\d{8}$/.test(s)) return tm12(s + '0000');
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2})(?::(\d{2}))?(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  const x = +s; if (isFinite(x) && x > 20000 && x < 80000) return Math.round((x - 25569) * 864e5 + new Date().getTimezoneOffset() * 6e4); // 엑셀 날짜 숫자
  return null;
}
let UPL = null; // 올린 파일 임시 보관 {name, head, rows}
async function dsUpload(file) {
  const buf = await file.arrayBuffer(); let txt;
  try { txt = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { txt = new TextDecoder('euc-kr').decode(buf); }
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
  if (lines.length < 3) { alert('자료 줄이 너무 적습니다'); return; }
  const head = csvSplit(lines[0]), rows = lines.slice(1).map(csvSplit);
  const guess = re => head.findIndex(h => re.test(h));
  UPL = { name: file.name.replace(/\.[^.]+$/, ''), head, rows,
    it: Math.max(0, guess(/시각|시간|일시|날짜|date|time|tm/i)),
    iws: guess(/풍속(?!.*돌풍)|ws|wind ?speed|spd/i), iwd: guess(/풍향|wd|dir/i), iwh: guess(/유의파고|파고|hs|wh|wave/i) };
  dsRender();
}
function uplColSel(id, cur, allowNone) {
  return `<select id="${id}">${allowNone ? `<option value="-1" ${cur < 0 ? 'selected' : ''}>(없음)</option>` : ''}${UPL.head.map((h, i) => `<option value="${i}" ${i === cur ? 'selected' : ''}>${h || '열' + (i + 1)}</option>`).join('')}</select>`;
}
function dsUploadAdd() {
  const g = id => +document.getElementById(id).value, it = g('u_t'), iws = g('u_ws'), iwd = g('u_wd'), iwh = g('u_wh');
  const z = num(document.getElementById('u_z').value);
  const pts = [];
  for (const r of UPL.rows) { const t = parseTime(r[it]); if (t == null) continue; pts.push([t, iws >= 0 ? num(r[iws]) : null, iwd >= 0 ? num(r[iwd]) : null, iwh >= 0 ? num(r[iwh]) : null]); }
  if (!pts.length) { alert('시각 열을 읽지 못했습니다. 시각 열을 확인해 주세요.'); return; }
  pts.sort((a, b) => a[0] - b[0]);
  dsAdd({ id: 'up-' + UPL.name + '-' + Date.now(), name: UPL.name + ' (올린 파일)', kind: '직접 측정', z, t: pts.map(p => p[0]), ws: pts.map(p => p[1]), wd: pts.map(p => p[2]), wh: pts.map(p => p[3]) });
  DSEL = DSL[DSL.length - 1].id; AN.mcp.tgt = DSEL; UPL = null; dsRender(); anRun();
}

// ===================================================================== 분석 화면
function openAnalysis() {
  SEL = null; toPanel();
  document.getElementById('panel').innerHTML = `<h2>📊 자료 분석</h2>
  <div class="sub" style="line-height:1.6">지점 30일 자료, 장기·재현바람장으로 받은 자료, 직접 측정한 CSV를 골라 풍황 요약·작업 가능일·장기 보정(MCP)을 봅니다. 자료는 이 화면(브라우저)에만 있고 어디에도 올라가지 않습니다.</div>
  <div class="box"><h3>자료 보관함</h3><div id="dslist"></div>
   <label class="btn" style="display:inline-block;margin-top:6px">📂 측정 자료 CSV 올리기<input type="file" accept=".csv,.txt" style="display:none" onchange="dsUpload(this.files[0]);this.value=''"></label>
   <div id="upl"></div></div>
  <div class="tabs" id="antabs">${[['wind', '풍황 요약'], ['work', '작업 가능일'], ['mcp', '장기 보정(MCP)']].map(([k, n]) => `<button data-k="${k}" onclick="AN.tab='${k}';anRun()">${n}</button>`).join('')}</div>
  <div id="anout"></div>`;
  dsRender(); anRun();
}
const AN = { tab: 'wind', hub: false, work: { hs: 1.5, ws: 12, hrs: 12 }, mcp: { tgt: null, ref: null, sector: false } };

function dsRender() {
  const el = document.getElementById('dslist'); if (!el) return;
  el.innerHTML = DSL.length ? DSL.map(d => `<label class="dsrow ${d.id === DSEL ? 'on' : ''}"><input type="radio" name="ds" ${d.id === DSEL ? 'checked' : ''} onchange="DSEL='${d.id}';dsRender();anRun()">
    <span><b>${d.name}</b><br><span class="sub">${d.kind} · ${dsSpan(d)} · ${d.t.length.toLocaleString()}개${d.z ? ` · 측정높이 ${d.z}m` : ''}</span></span>
    <button class="btn" style="margin-left:auto;padding:2px 7px" onclick="event.preventDefault();dsDel('${d.id}')">×</button></label>`).join('')
    : '<div class="sub">아직 자료가 없습니다. 지도에서 지점을 누르면 그 지점의 최근 30일 자료가 들어오고, 장기·재현바람장을 받으면 여기에 쌓입니다. 직접 측정한 CSV도 올릴 수 있습니다.</div>';
  const u = document.getElementById('upl'); if (!u) return;
  u.innerHTML = UPL ? `<div class="box" style="margin-top:8px"><h3>${UPL.name} — 열 맞추기</h3>
    <div class="sub">${UPL.rows.length.toLocaleString()}줄 · 자동으로 고른 열이 맞는지 확인하세요</div>
    <div class="grid2">시각 ${uplColSel('u_t', UPL.it)} 풍속 ${uplColSel('u_ws', UPL.iws, true)} 풍향 ${uplColSel('u_wd', UPL.iwd, true)} 유의파고 ${uplColSel('u_wh', UPL.iwh, true)}
    측정 높이(m) <input id="u_z" type="number" step="0.1" placeholder="예: 100"></div>
    <button class="btn pri" onclick="dsUploadAdd()">보관함에 넣기</button> <button class="btn" onclick="UPL=null;dsRender()">취소</button></div>` : '';
}
function dsDel(id) { const i = DSL.findIndex(x => x.id === id); if (i >= 0) DSL.splice(i, 1); if (DSEL === id) DSEL = DSL[0]?.id || null; dsRender(); anRun(); }

const CH = {};
function chart2(id, cfg) { if (CH[id]) CH[id].destroy(); const el = document.getElementById(id); if (el) CH[id] = new Chart(el, cfg); }
function anRun() {
  document.querySelectorAll('#antabs button').forEach(b => b.classList.toggle('on', b.dataset.k === AN.tab));
  const out = document.getElementById('anout'); if (!out) return;
  if (AN.tab === 'mcp') return mcpView(out);
  const d = dsGet(DSEL);
  if (!d) { out.innerHTML = '<div class="sub">위 보관함에서 분석할 자료를 고르세요.</div>'; return; }
  if (AN.tab === 'wind') windView(out, d); else workView(out, d);
}

// ===================================================================== 풍황 요약
function weibull(xs) {  // 최우추정(MLE): k 는 이분법, c=(평균 x^k)^(1/k)
  const x = xs.filter(v => v > 0); const n = x.length; if (n < 10) return null;
  const lnx = x.map(Math.log), mlx = lnx.reduce((a, b) => a + b, 0) / n;
  const g = k => { let s1 = 0, s2 = 0; for (let i = 0; i < n; i++) { const p = Math.pow(x[i], k); s1 += p * lnx[i]; s2 += p; } return s1 / s2 - 1 / k - mlx; };
  let lo = 0.3, hi = 15; for (let it = 0; it < 80; it++) { const m = (lo + hi) / 2; if (g(m) > 0) hi = m; else lo = m; }
  const k = (lo + hi) / 2; let s = 0; for (const v of x) s += Math.pow(v, k);
  return { k, c: Math.pow(s / n, 1 / k) };
}
const wpdf = (v, k, c) => v <= 0 ? 0 : (k / c) * Math.pow(v / c, k - 1) * Math.exp(-Math.pow(v / c, k));
const SECT = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const RBINS = [[0, 4], [4, 8], [8, 12], [12, 16], [16, 99]], RCOL = ['#c6dbef', '#6baed6', '#2171b5', '#08519c', '#08306b'];

function wsSeries(d) {  // 허브높이 환산 적용 여부 반영
  if (AN.hub && d.z) return d.ws.map(v => v == null ? null : conv(v, d.z));
  return d.ws;
}
function stepMin(d) { const n = Math.min(d.t.length, 500), df = []; for (let i = 1; i < n; i++) df.push(d.t[i] - d.t[i - 1]); df.sort((a, b) => a - b); return df.length ? Math.max(1, Math.round(df[df.length >> 1] / 6e4)) : 60; }

function windStats(d) {
  const ws = wsSeries(d), wd = d.wd, n = d.t.length, valid = ws.filter(v => v != null);
  const mean = valid.reduce((a, b) => a + b, 0) / (valid.length || 1);
  const wb = weibull(valid);
  const step = d.daily ? 1440 : stepMin(d), expect = n ? Math.round((d.t[n - 1] - d.t[0]) / 6e4 / step) + 1 : 0;
  // 빈도표 1 m/s
  const maxb = Math.min(40, Math.ceil(Math.max(...valid, 1))), hist = new Array(maxb).fill(0);
  for (const v of valid) hist[Math.min(maxb - 1, Math.floor(v))]++;
  // 월별
  const mon = Array.from({ length: 12 }, () => ({ s: 0, n: 0 }));
  for (let i = 0; i < n; i++) if (ws[i] != null) { const m = new Date(d.t[i]).getMonth(); mon[m].s += ws[i]; mon[m].n++; }
  // 바람장미
  const rose = SECT.map(() => RBINS.map(() => 0)); let rn = 0;
  for (let i = 0; i < n; i++) if (ws[i] != null && wd[i] != null) { const s = Math.round(((wd[i] % 360) + 360) % 360 / 22.5) % 16; const b = RBINS.findIndex(([lo, hi]) => ws[i] >= lo && ws[i] < hi); rose[s][b < 0 ? RBINS.length - 1 : b]++; rn++; }
  return { mean, wb, valid: valid.length, expect, rec: expect ? Math.min(100, valid.length * 100 / expect) : 0, hist, mon, rose, rn, step };
}

function windView(out, d) {
  if (!dsHas(d, 'ws')) { out.innerHTML = '<div class="sub">이 자료에는 풍속이 없습니다 (파고부이 등). 작업 가능일 탭에서 파고 분석을 볼 수 있습니다.</div>'; return; }
  const S = windStats(d), zt = AN.hub && d.z ? `허브 ${HUB.h}m 환산` : (d.z ? `측정높이 ${d.z}m` : '측정높이 그대로');
  out.innerHTML = `<div class="row" style="font-size:13px;flex-wrap:wrap"><label><input type="checkbox" ${AN.hub ? 'checked' : ''} ${d.z ? '' : 'disabled'} onchange="AN.hub=this.checked;anRun()"> 허브높이 ${HUB.h}m로 환산해서 보기</label>
   ${d.z ? '' : '<span class="sub">(측정 높이를 모르는 자료라 환산할 수 없습니다)</span>'}</div>
  ${d.daily ? '<div class="err" style="margin:4px 0">일평균 자료라 와이블·빈도는 실제(시간 단위)보다 좁게 나옵니다. 참고용으로만 보세요.</div>' : ''}
  <div class="grid">
   <div class="kv"><span>평균풍속 (${zt})</span><b>${f(S.mean, 2)} m/s</b></div>
   <div class="kv"><span>와이블 k (형상)</span><b>${S.wb ? f(S.wb.k, 2) : '–'}</b></div>
   <div class="kv"><span>와이블 c (척도)</span><b>${S.wb ? f(S.wb.c, 2) + ' m/s' : '–'}</b></div>
   <div class="kv"><span>자료 개수</span><b>${S.valid.toLocaleString()}</b></div>
   <div class="kv"><span>자료 회수율</span><b>${f(S.rec, 1)}%</b></div>
   <div class="kv"><span>기간</span><b style="font-size:12px">${dsSpan(d)}</b></div></div>
  <h3 style="font-size:14px;margin:10px 0 4px">바람장미 (불어오는 방향 기준)</h3>${S.rn ? roseSVG(S) : '<div class="sub">풍향 자료가 없습니다</div>'}
  <h3 style="font-size:14px;margin:10px 0 4px">풍속 빈도 (1 m/s 구간) · 와이블 곡선</h3><canvas id="c_hist" height="200"></canvas>
  <h3 style="font-size:14px;margin:10px 0 4px">월별 평균풍속</h3><canvas id="c_mon" height="170"></canvas>
  <button class="btn" style="margin-top:8px" onclick="windCSV()">요약표 CSV 받기 (빈도·월별·바람장미)</button>`;
  const tot = S.valid || 1;
  chart2('c_hist', { data: { labels: S.hist.map((_, i) => `${i}-${i + 1}`), datasets: [
    { type: 'bar', label: '관측 빈도(%)', data: S.hist.map(v => v * 100 / tot), backgroundColor: '#6baed6' },
    ...(S.wb ? [{ type: 'line', label: `와이블 k=${f(S.wb.k, 2)} c=${f(S.wb.c, 2)}`, data: S.hist.map((_, i) => wpdf(i + 0.5, S.wb.k, S.wb.c) * 100), borderColor: '#d62728', pointRadius: 0, borderWidth: 2 }] : [])] },
    options: { animation: false, plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: { ticks: { font: { size: 9 } } }, y: { title: { display: true, text: '%' } } } } });
  chart2('c_mon', { type: 'bar', data: { labels: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
    datasets: [{ label: '평균풍속(m/s)', data: S.mon.map(m => m.n ? m.s / m.n : null), backgroundColor: '#2171b5' }] },
    options: { animation: false, plugins: { legend: { display: false } }, scales: { y: { title: { display: true, text: 'm/s' } } } } });
  AN.last = { d, S, zt };
}
function roseSVG(S) {
  const W = 300, R = 120, cx = W / 2, cy = W / 2 + 4, tot = S.rn;
  const pct = S.rose.map(r => r.map(v => v * 100 / tot)), mx = Math.max(...pct.map(r => r.reduce((a, b) => a + b, 0))) || 1;
  const sc = R / mx, a0 = Math.PI / 16; let p = '';
  const rings = [0.25, 0.5, 0.75, 1].map(q => `<circle cx="${cx}" cy="${cy}" r="${R * q}" fill="none" stroke="#e4e7ec"/><text x="${cx + 3}" y="${cy - R * q + 10}" font-size="9" fill="#98a2b3">${f(mx * q, 1)}%</text>`).join('');
  pct.forEach((bins, s) => {
    let r0 = 0; const ang = s * Math.PI / 8;
    bins.forEach((v, b) => { if (!v) return; const r1 = r0 + v * sc;
      const pt = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)].map(x => x.toFixed(1)).join(',');
      p += `<path d="M${pt(r0, ang - a0)} L${pt(r1, ang - a0)} A${r1},${r1} 0 0 1 ${pt(r1, ang + a0)} L${pt(r0, ang + a0)} A${r0},${r0} 0 0 0 ${pt(r0, ang - a0)}Z" fill="${RCOL[b]}" stroke="#fff" stroke-width=".6"><title>${SECT[s]} ${RBINS[b][0]}~${RBINS[b][1] === 99 ? '' : RBINS[b][1]}m/s: ${f(v, 1)}%</title></path>`;
      r0 = r1; });
  });
  const lab = ['N', 'E', 'S', 'W'].map((t, i) => { const a = i * Math.PI / 2; return `<text x="${cx + (R + 12) * Math.sin(a)}" y="${cy - (R + 12) * Math.cos(a) + 4}" font-size="11" font-weight="700" text-anchor="middle">${t}</text>`; }).join('');
  const leg = RBINS.map(([lo, hi], b) => `<span style="display:inline-flex;align-items:center;gap:3px;margin-right:8px"><i style="width:10px;height:10px;background:${RCOL[b]};display:inline-block"></i>${hi === 99 ? lo + '+' : lo + '–' + hi}</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${W + 8}" style="width:100%;max-width:320px;display:block;margin:auto">${rings}${p}${lab}</svg><div class="sub" style="text-align:center">${leg} m/s</div>`;
}
function dlText(name, text) { const u = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), a = document.createElement('a'); a.href = u; a.download = name; a.click(); }
function windCSV() {
  const { d, S, zt } = AN.last, L = [];
  L.push(`자료,${d.name}`, `기간,${dsSpan(d)}`, `기준,${zt}`, `평균풍속(m/s),${S.mean.toFixed(3)}`, `와이블 k,${S.wb ? S.wb.k.toFixed(3) : ''}`, `와이블 c(m/s),${S.wb ? S.wb.c.toFixed(3) : ''}`, `자료 개수,${S.valid}`, `회수율(%),${S.rec.toFixed(1)}`, '');
  L.push('[풍속 빈도]', '구간(m/s),개수,빈도(%),와이블(%)');
  S.hist.forEach((v, i) => L.push(`${i}-${i + 1},${v},${(v * 100 / S.valid).toFixed(3)},${S.wb ? (wpdf(i + 0.5, S.wb.k, S.wb.c) * 100).toFixed(3) : ''}`));
  L.push('', '[월별 평균풍속]', '월,평균(m/s),개수');
  S.mon.forEach((m, i) => L.push(`${i + 1},${m.n ? (m.s / m.n).toFixed(3) : ''},${m.n}`));
  L.push('', '[바람장미 빈도(%)]', '방위,' + RBINS.map(([lo, hi]) => hi === 99 ? `${lo}+` : `${lo}-${hi}`).join(',') + ',합계');
  S.rose.forEach((r, s) => L.push(`${SECT[s]},` + r.map(v => (v * 100 / (S.rn || 1)).toFixed(3)).join(',') + ',' + (r.reduce((a, b) => a + b, 0) * 100 / (S.rn || 1)).toFixed(3)));
  dlText(`풍황요약_${d.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.csv`, L.join('\r\n'));
}

// ===================================================================== 작업 가능일
function workView(out, d) {
  const hasH = dsHas(d, 'wh'), hasW = dsHas(d, 'ws'), W = AN.work;
  if (!hasH && !hasW) { out.innerHTML = '<div class="sub">파고·풍속 자료가 없습니다.</div>'; return; }
  if (d.daily) { out.innerHTML = '<div class="err">일평균 자료로는 연속 작업 시간을 셀 수 없습니다. 30분·1시간 자료를 고르세요.</div>'; return; }
  out.innerHTML = `<div class="sub" style="line-height:1.6;margin-bottom:6px">기준을 모두 만족하는 시간이 <b>연속으로</b> 정한 시간 이상 이어지는 날을 "작업 가능일"로 셉니다. ${hasH ? '' : '(이 자료는 파고가 없어 풍속만 봅니다)'}${hasW ? '' : '(이 자료는 풍속이 없어 파고만 봅니다)'}</div>
  <div class="row" style="font-size:13px;flex-wrap:wrap">${hasH ? `유의파고 ≤ <input id="w_hs" type="number" step="0.1" value="${W.hs}" style="flex:none;width:60px">m` : ''}
   ${hasW ? `풍속 ≤ <input id="w_ws" type="number" step="0.5" value="${W.ws}" style="flex:none;width:60px">m/s${AN.hub && d.z ? `(허브 ${HUB.h}m)` : ''}` : ''}
   연속 <input id="w_h" type="number" step="1" value="${W.hrs}" style="flex:none;width:52px">시간 <button class="btn pri" onclick="workSet()">계산</button></div>
  <label class="sub">${hasW ? `<input type="checkbox" ${AN.hub ? 'checked' : ''} ${d.z ? '' : 'disabled'} onchange="AN.hub=this.checked;anRun()"> 풍속을 허브높이 ${HUB.h}m로 환산해서 판단` : ''}</label>
  <div id="w_out"></div>`;
  workCalc(d);
}
function workSet() { const g = (id, dflt) => { const e = document.getElementById(id); return e ? (+e.value || dflt) : dflt; };
  AN.work = { hs: g('w_hs', 1.5), ws: g('w_ws', 12), hrs: g('w_h', 12) }; workCalc(dsGet(DSEL)); }
function workCalc(d) {
  const W = AN.work, ws = wsSeries(d), n = d.t.length, step = stepMin(d), need = Math.max(1, Math.round(W.hrs * 60 / step));
  const hasH = dsHas(d, 'wh'), hasW = dsHas(d, 'ws');
  const ok = i => { const h = d.wh[i], w = ws[i]; if (hasH && h == null) return null; if (hasW && w == null) return null; return (!hasH || h <= W.hs) && (!hasW || w <= W.ws); };
  // 날짜별: 그날 안에서 가장 긴 연속 가능 길이
  const days = new Map();
  let run = 0, prevDay = '', prevT = 0;
  for (let i = 0; i < n; i++) {
    const dt = new Date(d.t[i]), key = iso(dt), o = ok(i);
    if (key !== prevDay || d.t[i] - prevT > step * 6e4 * 1.5) run = 0;
    if (!days.has(key)) days.set(key, { best: 0, okc: 0, cnt: 0, m: dt.getMonth(), y: dt.getFullYear() });
    const D = days.get(key);
    if (o === null) { run = 0; } else { D.cnt++; if (o) { run++; D.okc++; D.best = Math.max(D.best, run); } else run = 0; }
    prevDay = key; prevT = d.t[i];
  }
  const M = Array.from({ length: 12 }, () => ({ days: 0, good: 0, okc: 0, cnt: 0, years: new Set() }));
  for (const D of days.values()) { if (!D.cnt) continue; const m = M[D.m]; m.days++; m.okc += D.okc; m.cnt += D.cnt; m.years.add(D.y); if (D.best >= need) m.good++; }
  const rows = M.map((m, i) => ({ mon: i + 1, pct: m.cnt ? m.okc * 100 / m.cnt : null, gdays: m.years.size ? m.good / m.years.size : null, days: m.years.size ? m.days / m.years.size : null, ny: m.years.size }));
  const tot = rows.reduce((a, r) => a + (r.gdays || 0), 0);
  document.getElementById('w_out').innerHTML = `<div class="grid"><div class="kv"><span>연간 작업 가능일</span><b>${f(tot, 0)}일</b></div>
   <div class="kv"><span>작업 가능 시간 비율</span><b>${f(rows.reduce((a, r, i) => a + M[i].okc, 0) * 100 / (M.reduce((a, m) => a + m.cnt, 0) || 1), 1)}%</b></div>
   <div class="kv"><span>자료 간격</span><b>${step}분</b></div></div>
   <canvas id="c_work" height="190"></canvas>
   <table class="tbl"><tr><th>월</th><th>가능일/월</th><th>자료일/월</th><th>가능 시간%</th><th>자료 연수</th></tr>
   ${rows.map(r => `<tr><td>${r.mon}월</td><td>${f(r.gdays, 1)}</td><td>${f(r.days, 1)}</td><td>${f(r.pct, 1)}</td><td>${r.ny}</td></tr>`).join('')}</table>
   <div class="sub">여러 해 자료면 해마다 평균한 값입니다. 자료가 빠진 시간은 "불가"가 아니라 "모름"으로 보고 연속 구간을 끊습니다.</div>
   <button class="btn" onclick="workCSV()">작업 가능일 CSV 받기</button>`;
  chart2('c_work', { type: 'bar', data: { labels: rows.map(r => r.mon + '월'), datasets: [{ label: `작업 가능일(일/월) — ${hasH ? `Hs≤${W.hs}m ` : ''}${hasW ? `WS≤${W.ws}m/s ` : ''}${W.hrs}시간 연속`, data: rows.map(r => r.gdays), backgroundColor: '#0e9384' }] },
    options: { animation: false, plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { y: { beginAtZero: true, max: 31, title: { display: true, text: '일' } } } } });
  AN.lastWork = { d, rows, W, hasH, hasW };
}
function workCSV() {
  const { d, rows, W, hasH, hasW } = AN.lastWork, L = [`자료,${d.name}`, `기간,${dsSpan(d)}`, `기준,${hasH ? `유의파고<=${W.hs}m ` : ''}${hasW ? `풍속<=${W.ws}m/s${AN.hub && d.z ? `(허브${HUB.h}m 환산)` : ''} ` : ''}연속 ${W.hrs}시간`, '', '월,작업가능일(일/월),자료일(일/월),작업가능시간(%),자료연수'];
  rows.forEach(r => L.push(`${r.mon},${r.gdays == null ? '' : r.gdays.toFixed(2)},${r.days == null ? '' : r.days.toFixed(2)},${r.pct == null ? '' : r.pct.toFixed(2)},${r.ny}`));
  dlText(`작업가능일_${d.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.csv`, L.join('\r\n'));
}

// ===================================================================== 장기 보정 (MCP)
function hourly(d) {  // 1시간 평균으로 맞춤 (풍속 산술평균, 풍향 벡터평균)
  const H = new Map();
  for (let i = 0; i < d.t.length; i++) { const w = d.ws[i]; if (w == null) continue; const h = Math.floor(d.t[i] / 36e5);
    const o = H.get(h) || { s: 0, n: 0, u: 0, v: 0, dn: 0 }; o.s += w; o.n++;
    if (d.wd[i] != null) { const a = d.wd[i] * Math.PI / 180; o.u += Math.sin(a); o.v += Math.cos(a); o.dn++; }
    H.set(h, o); }
  const out = new Map(); for (const [h, o] of H) out.set(h, { ws: o.s / o.n, wd: o.dn ? (Math.atan2(o.u, o.v) * 180 / Math.PI + 360) % 360 : null }); return out;
}
function linreg(xs, ys) { const n = xs.length; if (n < 3) return null; let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i]; }
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), b = (sy - a * sx) / n, r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return { a, b, r2: r * r, n }; }
function mcpView(out) {
  const cand = DSL.filter(d => dsHas(d, 'ws') && !d.daily);
  if (cand.length < 2) { out.innerHTML = `<div class="sub" style="line-height:1.7">장기 보정에는 시간 단위 풍속 자료가 <b>두 개</b> 필요합니다.<br>· 대상: 사업지에서 직접 측정한 자료(CSV 올리기, 보통 1년 이상)<br>· 기준: 같은 기간을 포함하는 긴 자료 — 가까운 부이의 5·10년 자료나 재현바람장 5년<br>두 자료가 겹치는 기간으로 관계식을 만들고, 그 식을 기준 자료 전체 기간에 적용해 대상 위치의 장기 풍황을 추정합니다.</div>`; return; }
  const M = AN.mcp; if (!cand.find(d => d.id === M.tgt)) M.tgt = (cand.find(d => d.kind === '직접 측정') || cand[0]).id;
  if (!cand.find(d => d.id === M.ref) || M.ref === M.tgt) M.ref = (cand.find(d => d.id !== M.tgt && d.t.length > 0 && (d.t[d.t.length - 1] - d.t[0]) > 3e10) || cand.find(d => d.id !== M.tgt)).id;
  const sel = (id, cur) => `<select id="${id}" onchange="AN.mcp.${id === 'm_t' ? 'tgt' : 'ref'}=this.value;anRun()" style="max-width:100%">${cand.map(d => `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${d.name}</option>`).join('')}</select>`;
  out.innerHTML = `<div class="sub" style="line-height:1.6">두 자료를 1시간 평균으로 맞춘 뒤, 겹치는 기간의 풍속으로 <b>대상 = a × 기준 + b</b> 관계식을 만들어 기준 자료 전체 기간에 적용합니다 (선형 회귀 MCP).</div>
  <div style="font-size:13px;margin:6px 0">대상(단기) ${sel('m_t', M.tgt)}</div><div style="font-size:13px;margin:6px 0">기준(장기) ${sel('m_r', M.ref)}</div>
  <label class="sub"><input type="checkbox" ${M.sector ? 'checked' : ''} onchange="AN.mcp.sector=this.checked;anRun()"> 방위별(12방위)로 따로 회귀 (기준 자료에 풍향이 있을 때)</label>
  <div id="m_out"></div>`;
  mcpCalc();
}
function mcpCalc() {
  const M = AN.mcp, T = dsGet(M.tgt), R = dsGet(M.ref), el = document.getElementById('m_out');
  if (M.tgt === M.ref) { el.innerHTML = '<div class="err">대상과 기준을 다르게 고르세요</div>'; return; }
  const th = hourly(T), rh = hourly(R), xs = [], ys = [], sx = Array.from({ length: 12 }, () => [[], []]);
  for (const [h, t] of th) { const r = rh.get(h); if (!r) continue; xs.push(r.ws); ys.push(t.ws); if (r.wd != null) { const s = Math.floor(((r.wd + 15) % 360) / 30); sx[s][0].push(r.ws); sx[s][1].push(t.ws); } }
  if (xs.length < 24 * 7) { el.innerHTML = `<div class="err">겹치는 시간이 ${xs.length}시간뿐입니다. 같은 기간을 포함하는 자료를 고르세요 (최소 1주, 권장 1년).</div>`; return; }
  const all = linreg(xs, ys), useSec = M.sector && dsHas(R, 'wd'), sec = useSec ? sx.map(([a, b]) => b.length >= 50 ? linreg(a, b) : null) : null;
  const pred = [];  // 기준 전체 기간에 적용
  for (const [h, r] of [...rh].sort((a, b) => a[0] - b[0])) { let g = all; if (sec && r.wd != null) g = sec[Math.floor(((r.wd + 15) % 360) / 30)] || all; pred.push({ t: h * 36e5, ws: Math.max(0, g.a * r.ws + g.b), wd: r.wd }); }
  const pv = pred.map(p => p.ws), pm = pv.reduce((a, b) => a + b, 0) / pv.length, pw = weibull(pv);
  const tMean = ys.reduce((a, b) => a + b, 0) / ys.length, rOver = xs.reduce((a, b) => a + b, 0) / xs.length;
  const rAll = [...rh.values()].map(o => o.ws), rMean = rAll.reduce((a, b) => a + b, 0) / rAll.length;
  const ov0 = new Date(Math.min(...[...th.keys()].filter(h => rh.has(h))) * 36e5), ov1 = new Date(Math.max(...[...th.keys()].filter(h => rh.has(h))) * 36e5);
  el.innerHTML = `<div class="grid">
   <div class="kv"><span>겹치는 시간</span><b>${xs.length.toLocaleString()}h</b></div><div class="kv"><span>R² (전체)</span><b>${f(all.r2, 3)}</b></div>
   <div class="kv"><span>관계식</span><b style="font-size:13px">${f(all.a, 3)}x ${all.b >= 0 ? '+' : '−'} ${f(Math.abs(all.b), 2)}</b></div>
   <div class="kv"><span>대상 평균 (겹친 기간)</span><b>${f(tMean, 2)}</b></div><div class="kv"><span>기준 평균 (겹친 기간 / 전체)</span><b style="font-size:13px">${f(rOver, 2)} / ${f(rMean, 2)}</b></div>
   <div class="kv"><span>장기 추정 평균</span><b style="color:#7a2be2">${f(pm, 2)} m/s</b></div></div>
   <div class="sub">겹친 기간: ${iso(ov0)} ~ ${iso(ov1)} · 장기 추정 기간: ${iso(new Date(pred[0].t))} ~ ${iso(new Date(pred[pred.length - 1].t))} · 장기 와이블 k=${pw ? f(pw.k, 2) : '–'}, c=${pw ? f(pw.c, 2) : '–'}${all.r2 < 0.6 ? '<br><span class="err">R²가 낮습니다(0.6 미만). 두 지점의 바람 상관이 약해 추정 오차가 클 수 있습니다.</span>' : ''}</div>
   <canvas id="c_mcp" height="220"></canvas>
   ${sec ? `<table class="tbl"><tr><th>방위</th><th>a</th><th>b</th><th>R²</th><th>개수</th></tr>${sec.map((g, i) => `<tr><td>${i * 30}°</td><td>${g ? f(g.a, 3) : '전체식'}</td><td>${g ? f(g.b, 2) : ''}</td><td>${g ? f(g.r2, 2) : ''}</td><td>${sx[i][0].length}</td></tr>`).join('')}</table>` : ''}
   <button class="btn pri" onclick="mcpAdd()">장기 추정 자료를 보관함에 넣기</button> <button class="btn" onclick="mcpCSV()">장기 추정 시계열 CSV</button>
   <div class="sub" style="margin-top:6px">간이 선형 MCP입니다. 정식 풍황 평가에서는 방법(분산비·행렬법 등)과 기간 선택을 함께 검토하세요.</div>`;
  const step = Math.max(1, Math.floor(xs.length / 3000)), pts = []; for (let i = 0; i < xs.length; i += step) pts.push({ x: xs[i], y: ys[i] });
  const mx = Math.max(...xs);
  chart2('c_mcp', { data: { datasets: [{ type: 'scatter', label: '1시간 평균 (겹친 기간)', data: pts, pointRadius: 1.5, backgroundColor: '#1f6feb55' },
    { type: 'line', label: `대상 = ${f(all.a, 3)}×기준 ${all.b >= 0 ? '+' : '−'} ${f(Math.abs(all.b), 2)}`, data: [{ x: 0, y: all.b }, { x: mx, y: all.a * mx + all.b }], borderColor: '#d62728', pointRadius: 0, borderWidth: 2 }] },
    options: { animation: false, plugins: { legend: { labels: { boxWidth: 12, font: { size: 11 } } } }, scales: { x: { type: 'linear', title: { display: true, text: `기준 풍속 (m/s) — ${R.name}` } }, y: { title: { display: true, text: '대상 풍속 (m/s)' } } } } });
  AN.lastMcp = { T, R, all, pred };
}
function mcpAdd() { const { T, R, pred } = AN.lastMcp; dsAdd({ id: `mcp-${T.id}-${R.id}`, name: `장기추정: ${T.name} ← ${R.name}`, kind: 'MCP 장기 추정 1시간', z: T.z,
  t: pred.map(p => p.t), ws: pred.map(p => +p.ws.toFixed(2)), wd: pred.map(p => p.wd == null ? null : Math.round(p.wd)), wh: pred.map(() => null) });
  DSEL = `mcp-${T.id}-${R.id}`; AN.tab = 'wind'; dsRender(); anRun(); }
function mcpCSV() { const { T, R, all, pred } = AN.lastMcp;
  const L = [`대상,${T.name}`, `기준,${R.name}`, `관계식,대상 = ${all.a.toFixed(4)} x 기준 + ${all.b.toFixed(4)} (R2=${all.r2.toFixed(4)} / 겹친 ${all.n}시간)`, '', '시각(KST),장기추정 풍속(m/s),풍향(deg, 기준자료)'];
  for (const p of pred) { const d = new Date(p.t); L.push(`${iso(d)} ${String(d.getHours()).padStart(2, '0')}:00,${p.ws.toFixed(2)},${p.wd == null ? '' : Math.round(p.wd)}`); }
  dlText(`장기추정_${T.name.replace(/[\\/:*?"<>|\s]+/g, '_')}.csv`, L.join('\r\n')); }

// ===================================================================== 사업지 경계
const AREAS = (() => { try { return JSON.parse(localStorage.getItem('areas') || '[]'); } catch (e) { return []; } })(); // [{name, rings:[[[lat,lon],...]]}]
const areaLayer = L.layerGroup().addTo(map);
function areaSave() { try { localStorage.setItem('areas', JSON.stringify(AREAS)); } catch (e) { } }
function areaDraw() {
  areaLayer.clearLayers();
  AREAS.forEach((a, i) => a.rings.forEach(r => (r.length > 2 ? L.polygon(r, { color: '#7a2be2', weight: 2, dashArray: '5 4', fillOpacity: 0.08 }) : L.polyline(r, { color: '#7a2be2', weight: 2 }))
    .addTo(areaLayer).bindTooltip(a.name).on('click', e => { L.DomEvent.stopPropagation(e); openAreas(i); })));
}
function areaCenter(a) { let s = 0, la = 0, lo = 0; a.rings.forEach(r => r.forEach(([x, y]) => { la += x; lo += y; s++; })); return [la / s, lo / s]; }
function hav(a, b) { const R = 6371, p1 = a[0] * Math.PI / 180, p2 = b[0] * Math.PI / 180, dp = p2 - p1, dl = (b[1] - a[1]) * Math.PI / 180;
  return 2 * R * Math.asin(Math.sqrt(Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2)); }
function parseCoordsText(t) {  // "위도,경도" 줄마다 (경도,위도 순서여도 범위로 판단)
  const pts = []; for (const ln of t.split(/\r?\n/)) { const m = ln.match(/(-?\d+(?:\.\d+)?)[\s,;]+(-?\d+(?:\.\d+)?)/); if (!m) continue; let a = +m[1], b = +m[2]; if (a > 90 && b < 90) [a, b] = [b, a]; pts.push([a, b]); } return pts; }
async function areaFile(file) {
  const txt = await file.text(), name = file.name.replace(/\.[^.]+$/, ''), rings = [];
  if (/\.kml$/i.test(file.name) || txt.includes('<kml')) {
    const doc = new DOMParser().parseFromString(txt, 'text/xml');
    doc.querySelectorAll('coordinates').forEach(c => { const r = c.textContent.trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(p => p.length >= 2 && isFinite(p[0])).map(p => [p[1], p[0]]); if (r.length) rings.push(r); });
  } else if (/\.(geo)?json$/i.test(file.name) || txt.trim().startsWith('{')) {
    const g = JSON.parse(txt), walk = o => { if (!o) return; if (o.type === 'FeatureCollection') o.features.forEach(walk); else if (o.type === 'Feature') walk(o.geometry);
      else if (o.type === 'Polygon') o.coordinates.forEach(r => rings.push(r.map(p => [p[1], p[0]]))); else if (o.type === 'MultiPolygon') o.coordinates.forEach(pl => pl.forEach(r => rings.push(r.map(p => [p[1], p[0]]))));
      else if (o.type === 'LineString') rings.push(o.coordinates.map(p => [p[1], p[0]])); else if (o.type === 'Point') rings.push([[o.coordinates[1], o.coordinates[0]]]); };
    walk(g);
  } else { const p = parseCoordsText(txt); if (p.length) rings.push(p); }
  if (!rings.length) { alert('좌표를 찾지 못했습니다 (KML, GeoJSON, 또는 "위도,경도" 줄 목록)'); return; }
  AREAS.push({ name, rings }); areaSave(); areaDraw(); openAreas(AREAS.length - 1);
}
function areaFromText() { const t = document.getElementById('a_txt').value, n = document.getElementById('a_name').value.trim() || `사업지 ${AREAS.length + 1}`, p = parseCoordsText(t);
  if (!p.length) { alert('"위도,경도" 형식의 줄을 넣어 주세요'); return; } AREAS.push({ name: n, rings: [p] }); areaSave(); areaDraw(); openAreas(AREAS.length - 1); }
function openAreas(sel) {
  SEL = null; toPanel();
  const a = sel != null ? AREAS[sel] : null;
  let near = '';
  if (a && typeof DATA !== 'undefined' && DATA) {
    const c = areaCenter(a), list = DATA.stations.map(s => ({ s, d: hav(c, [s.lat, s.lon]) })).sort((x, y) => x.d - y.d).slice(0, 12);
    map.fitBounds(L.latLngBounds(a.rings.flat()).pad(0.4));
    near = `<div class="box"><h3>${a.name}</h3><div class="sub">중심 ${c[0].toFixed(4)}, ${c[1].toFixed(4)}</div>
     <table class="tbl"><tr><th>가까운 관측소</th><th>종류</th><th>거리</th><th>바람</th></tr>
     ${list.map(({ s, d }) => `<tr style="cursor:pointer" onclick="select(DATA.stations.find(x=>x.stn=='${s.stn}'))"><td>${s.name} (${s.stn})</td><td>${TYPES[s.tp]?.[0] || s.tp}</td><td>${d.toFixed(1)}km</td><td>${s.ws != null ? '○' : '–'}</td></tr>`).join('')}</table>
     <button class="btn pri" onclick="windPick(${c[0]},${c[1]})">중심점 재현바람장 받기</button> <button class="btn" onclick="AREAS.splice(${sel},1);areaSave();areaDraw();openAreas()">이 경계 지우기</button></div>`;
  }
  document.getElementById('panel').innerHTML = `<h2>📐 사업지 경계</h2>
   <div class="sub" style="line-height:1.6">사업 구역 경계를 지도에 그리고 가까운 관측소와 거리를 봅니다. 경계는 이 브라우저에만 저장되고 어디에도 올라가지 않습니다.</div>
   <div class="box"><h3>불러오기</h3>
    <label class="btn" style="display:inline-block">📂 KML · GeoJSON · 좌표 파일<input type="file" accept=".kml,.geojson,.json,.csv,.txt" style="display:none" onchange="areaFile(this.files[0]);this.value=''"></label>
    <div class="sub" style="margin:8px 0 4px">또는 좌표 붙여 넣기 (한 줄에 "위도, 경도", 꼭짓점 순서대로)</div>
    <input id="a_name" placeholder="이름 (예: 1구역)" style="width:100%;padding:5px;border:1px solid var(--line);border-radius:6px;margin-bottom:4px">
    <textarea id="a_txt" rows="4" style="width:100%;border:1px solid var(--line);border-radius:6px;padding:5px" placeholder="35.21, 129.30&#10;35.25, 129.38&#10;35.18, 129.42"></textarea>
    <button class="btn pri" onclick="areaFromText()">지도에 그리기</button></div>
   ${AREAS.length ? `<div class="box"><h3>저장된 경계</h3>${AREAS.map((x, i) => `<button class="preset ${i === sel ? 'on' : ''}" onclick="openAreas(${i})"><b>${x.name}</b><small>꼭짓점 ${x.rings.reduce((s, r) => s + r.length, 0)}개</small></button>`).join('')}</div>` : ''}
   ${near}`;
}
areaDraw();
