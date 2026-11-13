// ===== 설계파 산정 보고서 (구조계산서 첨부용) — 계산은 dw_engine.js(DWE) =====
// 입력값은 이 브라우저(localStorage)와 이용자가 저장한 파일에만 남고, 저장소·서버에는 올라가지 않습니다.
const DIR16 = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
const dirDeg = s => DIR16.indexOf(s) * 22.5;
const DW_DEF = () => ({
  title: '설계파 산정 보고서', reportNo: '', author: '', date: iso(new Date()),
  site: { name: '', lat: '', lon: '', h: 30, tan: 0.02, normal: 135, tide: '설계조위(약최고고조위 + 폭풍해일고) 기준' },
  deep: { src: '해양수산부 「전국 심해설계파 산출 보고서」', grid: '', lat: '', lon: '', R: 50, rows: [{ dir: 'SSE', H0: '', T: '' }] },
  obs: { ds: '', u: '', sep: 48, depth: '', method: 'auto' }
});
let DWI = (() => { try { const o = JSON.parse(localStorage.getItem('dwInput') || 'null'); if (o && o.site && o.deep) { const D = DW_DEF(); return { ...D, ...o, site: { ...D.site, ...o.site }, deep: { ...D.deep, ...o.deep }, obs: { ...D.obs, ...o.obs } }; } } catch (e) { } return DW_DEF(); })();
const dwSave = () => { try { localStorage.setItem('dwInput', JSON.stringify(DWI)); } catch (e) { } };
let DWR = null;   // 마지막 계산 결과

(function dwCSS() {
  const s = document.createElement('style');
  s.textContent = `#dwr{position:fixed;inset:0;z-index:3000;background:#eef0f3;overflow:auto;font-size:13px}
  #dwr .bar0{position:sticky;top:0;z-index:2;background:#0f2742;color:#fff;display:flex;gap:8px;align-items:center;padding:8px 14px;flex-wrap:wrap}
  #dwr .bar0 b{font-size:15px;margin-right:auto}#dwr .bar0 button,#dwr .bar0 label{background:#ffffff1a;color:#fff;border:1px solid #ffffff50;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
  #dwr .bar0 .pri{background:#2e90fa;border-color:#2e90fa}
  #dwr .frm{max-width:960px;margin:12px auto;background:#fff;border-radius:10px;padding:12px 16px;border:1px solid #d0d5dd}
  #dwr .frm h3{margin:10px 0 6px;font-size:14px}#dwr .frm .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:6px 10px}
  #dwr .frm label{display:flex;flex-direction:column;font-size:12px;color:#475467;gap:2px}#dwr .frm input,#dwr .frm select{padding:5px 6px;border:1px solid #d0d5dd;border-radius:6px;font-size:13px}
  #dwr .frm .wide{grid-column:1/-1}#dwr .frm table input,#dwr .frm table select{width:80px}
  #dwr .doc{max-width:960px;margin:12px auto 40px;background:#fff;padding:36px 46px;border:1px solid #d0d5dd;color:#101828;line-height:1.65}
  #dwr .doc h1{font-size:22px;text-align:center;margin:0 0 4px}#dwr .doc .cov{text-align:center;color:#475467;margin-bottom:22px}
  #dwr .doc h2{font-size:17px;border-bottom:2px solid #0f2742;padding-bottom:3px;margin:26px 0 8px}#dwr .doc h3{font-size:14.5px;margin:16px 0 6px}
  #dwr .doc table{border-collapse:collapse;width:100%;margin:6px 0 4px;font-size:12px}#dwr .doc th,#dwr .doc td{border:1px solid #98a2b3;padding:3px 6px;text-align:center}
  #dwr .doc th{background:#f2f4f7}#dwr .doc td.l{text-align:left}#dwr .doc .cap{font-size:12px;font-weight:700;margin:12px 0 2px}#dwr .doc .capf{font-size:12px;font-weight:700;text-align:center;margin:2px 0 12px}
  #dwr .doc .eq{background:#f8f9fb;border-left:3px solid #0f2742;padding:6px 10px;margin:6px 0;font-family:'Cambria Math','Times New Roman',serif;font-size:13px}
  #dwr .doc .asm{color:#b54708;font-weight:700}#dwr .doc .wrn{color:#b42318}#dwr .doc .ok{color:#067647}#dwr .doc .note{font-size:12px;color:#475467}
  #dwr .doc svg{display:block;margin:4px auto}#dwr .doc .res{background:#f0f9ff;border:2px solid #0f2742}
  @media print{body>*:not(#dwr){display:none!important}#dwr{position:static;overflow:visible;background:#fff}#dwr .np{display:none!important}
   #dwr .doc{border:0;margin:0;padding:0;max-width:none}#dwr .doc h2,#dwr .doc h3,#dwr .doc .cap{break-after:avoid}#dwr .doc table,#dwr .doc svg,#dwr .doc .eq{break-inside:avoid}#dwr .doc .pb{break-before:page}
   @page{size:A4;margin:16mm 14mm}}`;
  document.head.appendChild(s);
})();

function dwOpen() {
  let el = document.getElementById('dwr'); if (!el) { el = document.createElement('div'); el.id = 'dwr'; document.body.appendChild(el); }
  if (!DWI.obs.ds && AN.lastWave) DWI.obs.ds = AN.lastWave.d.id;
  el.innerHTML = `<div class="bar0 np"><b>📄 설계파 산정 보고서</b>
    <button onclick="dwRun()">↻ 다시 계산</button><button class="pri" onclick="dwPrint()">🖨 인쇄 / PDF</button>
    <button class="pri" onclick="dwExport()">⬇ 결과 파일(.json) — 기초 설계도구용</button>
    <button onclick="dwSaveFile()">💾 입력 저장</button><label>📂 입력 불러오기<input type="file" accept=".json" style="display:none" onchange="dwLoadFile(this.files[0]);this.value=''"></label>
    <button onclick="document.getElementById('dwr').remove()">✕ 닫기</button></div>
   <div class="frm np" id="dwfrm"></div><div class="doc" id="dwdoc"></div>`;
  dwForm(); dwRun(); el.scrollTop = 0;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function dwForm() {
  const I = DWI, inp = (path, lab, type = 'number', step = 'any', extra = '') => { const v = path.split('.').reduce((o, k) => o[k], I);
    return `<label${extra}>${lab}<input type="${type}" ${type == 'number' ? `step="${step}"` : ''} value="${esc(v)}" onchange="dwSet('${path}',this.value,'${type}')"></label>`; };
  const wds = DSL.filter(d => dsHas(d, 'wh'));
  document.getElementById('dwfrm').innerHTML = `<div class="sub" style="line-height:1.6">입력을 바꾸면 아래 보고서가 바로 다시 계산됩니다. 입력은 이 브라우저와 "입력 저장" 파일에만 남고 어디에도 올라가지 않습니다. <span style="color:#b54708">주황 '가정'</span> 표시 항목은 보고서에도 가정으로 적힙니다.</div>
   <h3>보고서</h3><div class="g">${inp('title', '제목', 'text')}${inp('reportNo', '보고서 번호', 'text')}${inp('author', '작성', 'text')}${inp('date', '작성일', 'date')}</div>
   <h3>사업지 (현장)</h3><div class="g">${inp('site.name', '지점 이름', 'text')}${inp('site.lat', '위도 (°)')}${inp('site.lon', '경도 (°)')}
    ${inp('site.h', '수심 h (설계조위 기준, m)')}${inp('site.tan', '해저 경사 tanθ (예 0.02 = 1/50)')}${inp('site.normal', '등심선 법선 방향 (외해 쪽, °)')}
    ${inp('site.tide', '수심 기준 설명', 'text', 'any', ' class="wide"')}</div>
   <div class="note sub">등심선 법선 방향: 등심선에 수직이면서 외해(먼바다)를 향하는 방위각입니다. 이 방향에서 오는 파는 정면 입사(입사각 0°)로 봅니다. 예: 해안선이 동–서로 놓이고 바다가 남쪽이면 180°.</div>
   <h3>심해설계파 (해양수산부 보고서 격자점 값)</h3><div class="g">${inp('deep.src', '출처 보고서', 'text', 'any', ' class="wide"')}${inp('deep.grid', '격자점 번호', 'text')}${inp('deep.lat', '격자점 위도 (°)')}${inp('deep.lon', '격자점 경도 (°)')}${inp('deep.R', '재현기간 (년)', 'number', '1')}</div>
   <table class="tbl" style="margin-top:6px"><tr><th>파향 (16방위)</th><th>심해 유의파고 H0 (m)</th><th>유의파 주기 T1/3 (s)</th><th></th></tr>
    ${I.deep.rows.map((r, i) => `<tr><td><select onchange="DWI.deep.rows[${i}].dir=this.value;dwSave();dwRun()">${DIR16.map(x => `<option ${x == r.dir ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
     <td><input type="number" step="any" value="${esc(r.H0)}" onchange="DWI.deep.rows[${i}].H0=this.value;dwSave();dwRun()"></td><td><input type="number" step="any" value="${esc(r.T)}" onchange="DWI.deep.rows[${i}].T=this.value;dwSave();dwRun()"></td>
     <td>${I.deep.rows.length > 1 ? `<button class="btn" onclick="DWI.deep.rows.splice(${i},1);dwSave();dwForm();dwRun()">삭제</button>` : ''}</td></tr>`).join('')}</table>
   <button class="btn" onclick="DWI.deep.rows.push({dir:'S',H0:'',T:''});dwSave();dwForm()">+ 파향 추가</button> <span class="sub">파향이 여럿이면 현장 최대파고가 가장 큰 파향을 설계파로 채택합니다.</span>
   <h3>관측 극치분석 (검증용)</h3><div class="g">
    <label class="wide">관측 자료 (분석 보관함에서 유의파고가 있는 자료)<select onchange="DWI.obs.ds=this.value;dwSave();dwRun()"><option value="">(관측 자료 쓰지 않음)</option>${wds.map(d => `<option value="${esc(d.id)}" ${d.id == I.obs.ds ? 'selected' : ''}>${esc(d.name)} · ${esc(d.kind)}</option>`).join('')}</select></label>
    ${inp('obs.depth', '관측 부이 수심 (m, 비교 설명용)')}${inp('obs.u', 'POT 임계값 (m, 비우면 자동: 연 약 3회)')}${inp('obs.sep', '독립 폭풍 최소 간격 (시간)')}
    <label>채택 분포<select onchange="DWI.obs.method=this.value;dwSave();dwRun()">${[['auto', '자동 (상관계수 최대)'], ['amG', '연최대 · 검벨'], ['potG', 'POT · 검벨'], ['potW', 'POT · 와이블 3모수'], ['potW2', 'POT · 와이블 2모수']].map(([k, n]) => `<option value="${k}" ${k == I.obs.method ? 'selected' : ''}>${n}</option>`).join('')}</select></label></div>
   ${wds.length ? '' : '<div class="sub" style="color:#b54708">분석 보관함에 유의파고 자료가 없습니다. 지도에서 부이 지점을 골라 1·5·10년 자료를 받으면 관측 극치분석·검증 장이 채워집니다.</div>'}`;
}
function dwSet(path, v, type) { const ks = path.split('.'), last = ks.pop(), o = ks.reduce((a, k) => a[k], DWI); o[last] = type == 'number' ? (v === '' ? '' : +v) : v; dwSave(); dwRun(); }

// ---------- 계산 ----------
function dwObs(d) {
  if (!d) return null; const step = d.daily ? 1440 : stepMin(d), yt = DWE.yearTable(d, step), K = DWE.effYears(d, step);
  let mx = -1, mxt = null, hm = -1, hmt = null; d.wh.forEach((v, i) => { if (v != null && v > mx) { mx = v; mxt = d.t[i]; } }); (d.hmax || []).forEach((v, i) => { if (v != null && v > hm) { hm = v; hmt = d.t[i]; } });
  yt.forEach(r => { r.useAM = !r.partial && r.rate >= 0.7; });
  const AM = yt.filter(r => r.useAM).map(r => r.mx);
  // POT 임계값: 입력 없으면 정점이 연 약 3회가 되도록 자동
  let u = +DWI.obs.u, auto = false; const sep = +DWI.obs.sep || 48;
  if (!(u > 0)) { auto = true; const hv = d.wh.filter(v => v != null).sort((a, b) => a - b); let lo = hv[Math.floor(hv.length * 0.9)], hi = mx;
    for (let i = 0; i < 25; i++) { const m = (lo + hi) / 2, n = DWE.pot(d, m, sep).length / K; if (n > 3) lo = m; else hi = m; } u = Math.round(hi * 10) / 10; }
  const P = DWE.pot(d, u, sep), lam = P.length / K, px = P.map(p => p.v);
  const F = {
    amG: AM.length >= 3 ? DWE.fit(AM, 1, 'gumbel') : null, amM: AM.length >= 3 ? DWE.fitMoM(AM) : null,
    potG: px.length >= 5 ? DWE.fit(px, lam, 'gumbel') : null, potW: px.length >= 5 ? DWE.fitBest(px, lam) : null, potW2: px.length >= 5 ? DWE.fit(px, lam, 'weibull2') : null
  };
  const refit = { amG: (x, l) => DWE.fit(x, l, 'gumbel'), amM: x => DWE.fitMoM(x), potG: (x, l) => DWE.fit(x, l, 'gumbel'), potW: (x, l) => DWE.fit(x, l, 'weibull3', F.potW.k), potW2: (x, l) => DWE.fit(x, l, 'weibull2') };
  const CI = {}; for (const k in F) if (F[k]) CI[k] = DWE.boot(k.startsWith('am') ? AM : px, k.startsWith('am') ? 1 : lam, refit[k], DWE.RS, 400);
  let adopt = DWI.obs.method; if (adopt == 'auto' || !F[adopt]) { const c = ['potW', 'potG', 'potW2', 'amG'].filter(k => F[k] && k != 'amM').sort((a, b) => F[b].r - F[a].r); adopt = c[0] || null; }
  return { d, step, yt, K, mx, mxt, hm: hm > 0 ? hm : null, hmt, AM, u, auto, sep, P, lam, F, CI, adopt };
}
function dwRun() {
  const I = DWI, S = I.site, h = +S.h, tan = +S.tan, nrm = +S.normal, R = +I.deep.R || 50;
  const rows = I.deep.rows.map(r => ({ ...r, H0: +r.H0, T: +r.T })).filter(r => r.H0 > 0 && r.T > 0);
  const tr = h > 0 ? rows.map(r => ({ r, x: DWE.transform({ H0: r.H0, T: r.T, h, tan, dirFrom: dirDeg(r.dir), normalOff: nrm }) })) : [];
  const ok = tr.filter(o => o.x.reach), gov = ok.length ? ok.reduce((a, b) => b.x.Hmax > a.x.Hmax ? b : a) : null;
  const d = DSL.find(x => x.id == I.obs.ds), obs = d ? dwObs(d) : null;
  DWR = { I, h, tan, nrm, R, rows, tr, gov, obs };
  document.getElementById('dwdoc').innerHTML = dwReport(DWR);
}

// ---------- SVG 그림 ----------
function svgPlot(o) {
  const W = o.w || 640, H = o.h || 300, m = { l: 56, r: 16, t: 14, b: 42 }, pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xs = o.series.flatMap(s => s.pts.map(p => p[0])).concat(o.xr || []), ys = o.series.flatMap(s => s.pts.map(p => p[1])).concat(o.yr || []);
  let x0 = o.xmin ?? Math.min(...xs), x1 = o.xmax ?? Math.max(...xs), y0 = o.ymin ?? Math.min(0, ...ys), y1 = o.ymax ?? Math.max(...ys) * 1.08; if (x1 == x0) x1 = x0 + 1; if (y1 == y0) y1 = y0 + 1;
  const nice = (a, b, n) => { const st = Math.pow(10, Math.floor(Math.log10((b - a) / n))), e = (b - a) / n / st, s2 = (e >= 5 ? 5 : e >= 2 ? 2 : 1) * st, t = []; for (let v = Math.ceil(a / s2) * s2; v <= b + 1e-9; v += s2) t.push(+v.toFixed(10)); return t; };
  const X = v => m.l + (o.xrev ? (x1 - v) : (v - x0)) / (x1 - x0) * pw, Y = v => m.t + ph - (v - y0) / (y1 - y0) * ph;
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="sans-serif" font-size="11"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="#fff" stroke="#667085"/>`;
  for (const t of nice(y0, y1, 6)) s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(t)}" y2="${Y(t)}" stroke="#eaecf0"/><text x="${m.l - 5}" y="${Y(t) + 4}" text-anchor="end">${+t.toFixed(3)}</text>`;
  for (const t of (o.xticks || nice(x0, x1, 8))) { const v = Array.isArray(t) ? t[0] : t, lab = Array.isArray(t) ? t[1] : +t.toFixed(3); s += `<line x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${m.t + ph}" stroke="#eaecf0"/><text x="${X(v)}" y="${m.t + ph + 14}" text-anchor="middle">${lab}</text>`; }
  for (const v of (o.vlines || [])) s += `<line x1="${X(v[0])}" x2="${X(v[0])}" y1="${m.t}" y2="${m.t + ph}" stroke="#98a2b3" stroke-dasharray="4 3"/><text x="${X(v[0]) + 3}" y="${m.t + 11}" fill="#475467">${v[1]}</text>`;
  for (const v of (o.hlines || [])) s += `<line x1="${m.l}" x2="${m.l + pw}" y1="${Y(v[0])}" y2="${Y(v[0])}" stroke="${v[2] || '#b42318'}" stroke-dasharray="5 3"/><text x="${m.l + pw - 4}" y="${Y(v[0]) - 4}" text-anchor="end" fill="${v[2] || '#b42318'}">${v[1]}</text>`;
  let ly = m.t + 6;
  for (const se of o.series) {
    const c = se.color || '#0f2742';
    if (se.type == 'bar') { const bw = pw / se.pts.length * 0.38; se.pts.forEach(p => { s += `<rect x="${X(p[0]) + (se.off || 0) * bw - bw / 2}" y="${Y(p[1])}" width="${bw}" height="${Y(y0) - Y(p[1])}" fill="${c}"/>`; }); }
    else if (se.type == 'line') s += `<polyline fill="none" stroke="${c}" stroke-width="${se.w || 1.8}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ''} points="${se.pts.filter(p => isFinite(p[1])).map(p => `${X(p[0]).toFixed(1)},${Y(Math.max(y0, Math.min(y1, p[1]))).toFixed(1)}`).join(' ')}"/>`;
    else se.pts.forEach(p => { s += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="${se.r || 3}" fill="${se.fill || 'none'}" stroke="${c}" stroke-width="1.3"/>`; });
    if (se.label) { s += `<rect x="${m.l + 8}" y="${ly - 8}" width="12" height="${se.type == 'pt' ? 8 : 3}" fill="${c}"/><text x="${m.l + 24}" y="${ly}">${se.label}</text>`; ly += 15; }
  }
  s += `<text x="${m.l + pw / 2}" y="${H - 6}" text-anchor="middle">${o.xlab || ''}</text><text transform="translate(13 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle">${o.ylab || ''}</text></svg>`;
  return s;
}

// ---------- 보고서 ----------
const NAMES = { amG: '연최대 · 검벨(최소자승)', amM: '연최대 · 검벨(적률법, 참고)', potG: 'POT · 검벨', potW: 'POT · 와이블 3모수', potW2: 'POT · 와이블 2모수' };
function dwReport(X) {
  const { I, h, tan, nrm, R, tr, gov, obs } = X, S = I.site, ff = (v, n = 2) => v == null || !isFinite(v) ? '–' : (+v).toFixed(n);
  let tn = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0 }, fn = { ...tn };
  const T = (ch, cap) => `<div class="cap">표 ${ch}-${++tn[ch]} ${cap}</div>`, Fg = (ch, cap) => `<div class="capf">그림 ${ch}-${++fn[ch]} ${cap}</div>`;
  const ASM = '<span class="asm">(가정)</span>', dtS = t => { const x = new Date(t); return `${iso(x)} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
  const miss = [];
  if (!(h > 0)) miss.push('현장 수심'); if (!(tan > 0)) miss.push('해저 경사'); if (!(S.normal !== '' && isFinite(nrm))) miss.push('등심선 법선 방향'); if (!X.rows.length) miss.push('심해설계파(H0·T1/3)');
  let s = `<h1>${esc(I.title)}</h1><div class="cov">${esc(S.name || '(사업지 이름)')}${I.reportNo ? ' · ' + esc(I.reportNo) : ''}<br>${esc(I.date)}${I.author ? ' · ' + esc(I.author) : ''}</div>
   ${miss.length ? `<div class="wrn" style="border:1px solid #fda29b;background:#fef3f2;padding:8px 10px;border-radius:6px">입력이 더 필요합니다: ${miss.join(', ')}</div>` : ''}`;
  // 1. 개요
  s += `<h2>1. 개요</h2><h3>1.1 목적</h3><p>${esc(S.name || '사업지')} 해상풍력 기초 구조물의 파랑하중 산정에 쓸 설계파(유의파고·최대파고·주기)를 정한다. 해양수산부 심해설계파를 현장 수심까지 천해 변형(굴절·천수·쇄파)하여 설계파를 산정하고, 인근 관측소의 관측 극치값과 비교하여 크기를 검증한다.</p>
   <h3>1.2 적용 기준 및 방법</h3><ul>
    <li>항만 및 어항 설계기준(KDS 64 10 10) — 설계파 산정, 고다(Goda) 쇄파 산정식</li>
    <li>${esc(I.deep.src)} — 심해설계파(재현기간 ${R}년)</li>
    <li>굴절: 평행 등심선 가정, 스넬(Snell) 법칙 · 천수: 선형파 이론 · 회절: 차폐 없음 K<sub>d</sub> = 1.0 ${ASM}</li>
    <li>관측 극치분석: 연최대(AM)·POT(Peaks Over Threshold), 검벨·와이블 분포 최소자승 적합(확률지), 붓스트랩 90% 신뢰구간</li></ul>
   ${T(1, '설계 조건')}<table><tr><th>항목</th><th>값</th><th>비고</th></tr>
    <tr><td>사업지</td><td>${esc(S.name || '–')}</td><td class="l">${S.lat !== '' ? `${ff(S.lat, 4)}°N, ${ff(S.lon, 4)}°E` : ''}</td></tr>
    <tr><td>수심 h</td><td>${ff(h)} m</td><td class="l">${esc(S.tide)}</td></tr>
    <tr><td>해저 경사 tanθ</td><td>${ff(tan, 4)} (1/${tan > 0 ? ff(1 / tan, 0) : '–'})</td><td class="l">현장 주변 평균 경사</td></tr>
    <tr><td>등심선 법선 방향</td><td>${ff(nrm, 1)}°</td><td class="l">외해 쪽 방위각, 이 방향 입사 = 정면 입사</td></tr>
    <tr><td>설계 재현기간</td><td>${R}년</td><td class="l"></td></tr></table>`;
  // 2. 관측 극치분석
  s += `<h2 class="pb">2. 관측 자료 극치분석</h2>`;
  if (!obs) s += `<p class="note">관측 자료를 고르지 않아 이 장은 생략한다. (관측 대시보드에서 부이 장기 자료를 받아 "관측 자료"로 고르면 채워진다)</p>`;
  else {
    const o = obs, d = o.d, st = d.stn || {};
    s += `<h3>2.1 관측 자료</h3>${T(2, '관측 자료 개요')}<table><tr><th>항목</th><th>내용</th></tr>
     <tr><td>관측소</td><td class="l">${esc(st.name || d.name)}${st.stn ? ` (${st.stn})` : ''}${st.lat ? ` · ${ff(st.lat, 4)}°N, ${ff(st.lon, 4)}°E` : ''}</td></tr>
     <tr><td>자료 기간·간격</td><td class="l">${dsSpan(d)} · ${o.step}분 간격 (${esc(d.kind)})</td></tr>
     <tr><td>유효 자료 연수</td><td class="l">${ff(o.K, 2)}년 (유효 자료 개수 × 간격으로 환산)</td></tr>
     <tr><td>최대 관측 유의파고</td><td class="l"><b>${ff(o.mx)} m</b> (${o.mxt ? dtS(o.mxt) : '–'})</td></tr>
     <tr><td>최대 관측 최대파고</td><td class="l">${o.hm ? `<b>${ff(o.hm)} m</b> (${dtS(o.hmt)})` : '자료 없음'}</td></tr></table>
     ${T(2, '연도별 자료율과 연최대 유의파고')}<table><tr><th>연도</th><th>자료율</th><th>태풍기(7~10월) 자료율</th><th>연최대 H<sub>1/3</sub> (m)</th><th>발생 시각</th><th>연최대 극치 사용</th></tr>
     ${o.yt.map(r => `<tr><td>${r.y}${r.partial ? '*' : ''}</td><td>${ff(r.rate * 100, 1)}%</td><td class="${r.rateTy != null && r.rateTy < 0.7 ? 'wrn' : ''}">${r.rateTy == null ? '–' : ff(r.rateTy * 100, 1) + '%'}</td><td>${r.mx >= 0 ? ff(r.mx) : '–'}</td><td>${r.mxt ? dtS(r.mxt) : '–'}</td><td>${r.useAM ? '○' : '×'}</td></tr>`).join('')}</table>
     <div class="note">* 자료 기간이 한 해 전체를 덮지 않는 해. 연최대 극치에는 한 해 전체 자료율 70% 이상인 해만 쓴다. <span class="wrn">태풍기 자료율 70% 미만</span>인 해는 연최대가 과소일 수 있다.</div>
     ${svgPlot({ h: 230, xlab: '연도', ylab: '자료율 (%)', ymin: 0, ymax: 100, xticks: o.yt.map(r => r.y), xmin: o.yt[0].y - 0.6, xmax: o.yt[o.yt.length - 1].y + 0.6,
       series: [{ type: 'bar', pts: o.yt.map(r => [r.y, r.rate * 100]), color: '#2e90fa', off: -0.5, label: '연간 자료율' }, { type: 'bar', pts: o.yt.map(r => [r.y, (r.rateTy || 0) * 100]), color: '#f79009', off: 0.5, label: '태풍기 자료율' }], hlines: [[70, '70%', '#b42318']] })}
     ${Fg(2, '연도별 자료율')}`;
    // 시계열 (일최대) + 임계값 + 정점
    const day = new Map(); d.t.forEach((t, i) => { const v = d.wh[i]; if (v == null) return; const k = Math.floor(t / 864e5); if (!day.has(k) || v > day.get(k)) day.set(k, v); });
    const yr = t => new Date(t).getFullYear() + (t - new Date(new Date(t).getFullYear(), 0, 1)) / 31557600000;
    s += `<h3>2.2 극치 표본</h3><p>연최대(AM) 표본은 ${o.AM.length}개이다. POT 표본은 유의파고가 임계값 u = <b>${ff(o.u, 1)} m</b>${o.auto ? ` (연평균 약 3회가 되도록 자동 설정 ${ASM})` : ''}를 넘는 구간을 폭풍으로 묶고, 정점 사이가 ${o.sep}시간 미만이면 같은 폭풍으로 보아(독립 사상 간격) 폭풍마다 최대값 하나를 뽑았다. POT 정점 ${o.P.length}개, 연간 발생률 λ = ${o.P.length} / ${ff(o.K, 2)}년 = <b>${ff(o.lam, 2)}회/년</b>.</p>
     ${svgPlot({ h: 240, xlab: '연도', ylab: '일최대 유의파고 (m)', series: [{ type: 'line', w: 0.8, color: '#98a2b3', pts: [...day].sort((a, b) => a[0] - b[0]).map(([k, v]) => [yr(k * 864e5), v]) }, { type: 'pt', color: '#b42318', fill: '#b42318', r: 2.6, pts: o.P.map(p => [yr(p.t), p.v]), label: 'POT 정점' }], hlines: [[o.u, `u = ${ff(o.u, 1)} m`]] })}
     ${Fg(2, '유의파고 시계열(일최대)과 POT 정점')}
     ${T(2, `POT 정점 상위 ${Math.min(15, o.P.length)}개`)}<table><tr><th>순위</th><th>H<sub>1/3</sub> (m)</th><th>시각</th><th>순위</th><th>H<sub>1/3</sub> (m)</th><th>시각</th></tr>
     ${(() => { const P = o.P.slice().sort((a, b) => b.v - a.v).slice(0, 15), half = Math.ceil(P.length / 2); let r = ''; for (let i = 0; i < half; i++) { const a = P[i], b = P[i + half]; r += `<tr><td>${i + 1}</td><td>${ff(a.v)}</td><td>${dtS(a.t)}</td><td>${b ? i + half + 1 : ''}</td><td>${b ? ff(b.v) : ''}</td><td>${b ? dtS(b.t) : ''}</td></tr>`; } return r; })()}</table>`;
    // 2.3 적합
    s += `<h3>2.3 분포 적합</h3><p>각 표본을 크기 순으로 놓고 비초과확률 F를 도시위치 공식으로 정한 뒤, 확률지의 직선화 변수 y에 대해 H = A·y + B를 최소자승으로 맞춘다. 재현기간 R년 값은 y<sub>R</sub>을 대입해 구한다.</p>
     <div class="eq">검벨: F = exp[−exp(−(H−B)/A)], 도시위치 F<sub>m</sub> = 1 − (m − 0.44)/(N + 0.12) (Gringorten), y = −ln(−ln F), y<sub>R</sub> = −ln[−ln(1 − 1/(λR))]<br>
      와이블 3모수: F = 1 − exp[−((H−B)/A)<sup>k</sup>], 도시위치 F<sub>m</sub> = 1 − (m − α)/(N + β), α = 0.20 + 0.27/√k, β = 0.20 + 0.23/√k (고다), y = [−ln(1−F)]<sup>1/k</sup>, y<sub>R</sub> = [ln(λR)]<sup>1/k</sup>, k ∈ {0.75, 1.0, 1.4, 2.0} 중 상관계수 최대<br>
      와이블 2모수: B = 0, ln[−ln(1−F)] = k·ln H − k·ln A 를 직선 회귀 · 연최대(AM)는 λ = 1</div>
     ${T(2, '분포별 적합 결과와 재현기간별 유의파고 (괄호: 붓스트랩 90% 신뢰구간)')}<table><tr><th>방법</th><th>N</th><th>모수</th><th>상관계수 r</th>${DWE.RS.map(R => `<th>${R}년</th>`).join('')}</tr>
     ${Object.keys(o.F).filter(k => o.F[k]).map(k => { const F = o.F[k], ci = o.CI[k] || [];
       return `<tr class="${k == o.adopt ? 'res' : ''}"><td class="l">${NAMES[k]}${k == o.adopt ? ' <b>(채택)</b>' : ''}</td><td>${F.N}</td><td style="font-size:11px">${k == 'amM' ? `μ=${ff(F.B)}, β=${ff(F.A, 3)}` : `A=${ff(F.A, 3)}, B=${ff(F.B)}${k.startsWith('potW') ? `, k=${ff(F.k)}` : ''}`}</td><td>${F.r != null ? ff(F.r, 4) : '–'}</td>
        ${DWE.RS.map((R, i) => `<td><b>${ff(F.xR(R))}</b><br><span style="font-size:10.5px">(${ff(ci[i] && ci[i].lo)}~${ff(ci[i] && ci[i].hi)})</span></td>`).join('')}</tr>`; }).join('')}</table>
     <div class="note">채택 방법: ${o.adopt ? NAMES[o.adopt] : '–'} — ${DWI.obs.method == 'auto' ? '적합 상관계수가 가장 큰 방법' : '입력에서 지정'}. 신뢰구간은 표본을 복원추출해 같은 방법으로 400회 다시 맞춘 값의 5%·95% 백분위이다.${o.K < R / 2 ? ` <span class="wrn">관측 ${ff(o.K, 1)}년으로 ${R}년 값을 외삽하므로 불확실성이 크다.</span>` : ''}</div>`;
    if (o.F.amG) { const F = o.F.amG; s += svgPlot({ h: 280, xlab: '검벨 직선화 변수 y = −ln(−ln F)', ylab: '연최대 유의파고 (m)', vlines: DWE.RS.map(R => [F.yR(R), `${R}년`]),
      series: [{ type: 'pt', pts: F.pts.map(p => [p.y, p.x]), label: '연최대 (Gringorten 도시)' }, { type: 'line', color: '#b42318', pts: [[Math.min(...F.pts.map(p => p.y)) - 0.3, F.A * (Math.min(...F.pts.map(p => p.y)) - 0.3) + F.B], [F.yR(100) + 0.2, F.A * (F.yR(100) + 0.2) + F.B]], label: `적합선 H = ${ff(F.A, 3)}y + ${ff(F.B)}` }] }) + Fg(2, '연최대 유의파고 검벨 확률지'); }
    const pk = o.F[o.adopt && o.adopt.startsWith('pot') ? o.adopt : 'potW'];
    if (pk) { const isG = pk.dist == 'gumbel', yv = p => pk.dist == 'weibull2' ? p.yv : p.y, y0 = Math.min(...pk.pts.map(yv)), y1 = pk.yR(100);
      s += svgPlot({ h: 280, xlab: isG ? '검벨 직선화 변수 y' : `와이블 직선화 변수 y = [−ln(1−F)]^(1/k), k = ${ff(pk.k)}`, ylab: 'POT 정점 유의파고 (m)', vlines: DWE.RS.map(R => [pk.yR(R), `${R}년`]),
        series: [{ type: 'pt', pts: pk.pts.map(p => [yv(p), p.x]), label: 'POT 정점' }, { type: 'line', color: '#b42318', pts: [[y0, pk.A * y0 + pk.B], [y1 * 1.03, pk.A * y1 * 1.03 + pk.B]], label: `적합선 (${NAMES[o.adopt && o.adopt.startsWith('pot') ? o.adopt : 'potW']})` }] }) + Fg(2, 'POT 정점 확률지 (적합도)'); }
  }
  // 3. 심해설계파
  s += `<h2 class="pb">3. 심해설계파</h2><p>${esc(I.deep.src)}의 격자점 값을 쓴다.</p>
   ${T(3, '심해설계파 (격자점 값)')}<table><tr><th>격자점</th><th>위치</th><th>재현기간</th><th>파향</th><th>H<sub>0</sub> (m)</th><th>T<sub>1/3</sub> (s)</th><th>심해 파장 L<sub>0</sub> (m)</th><th>파형경사 H<sub>0</sub>/L<sub>0</sub></th></tr>
   ${X.rows.map(r => `<tr><td>${esc(I.deep.grid || '–')}</td><td>${I.deep.lat !== '' ? `${ff(I.deep.lat, 3)}°N, ${ff(I.deep.lon, 3)}°E` : '–'}</td><td>${R}년</td><td>${r.dir} (${dirDeg(r.dir)}°)</td><td>${ff(r.H0)}</td><td>${ff(r.T, 1)}</td><td>${ff(DWE.L0(r.T), 1)}</td><td>${ff(r.H0 / DWE.L0(r.T), 4)}</td></tr>`).join('') || '<tr><td colspan="8">입력 없음</td></tr>'}</table>
   <div class="eq">L<sub>0</sub> = g·T²/(2π), g = 9.81 m/s²</div>`;
  // 4. 천해 변형
  s += `<h2>4. 현장 설계파 (천해 변형)</h2>`;
  if (!tr.length) s += '<p class="note">입력이 부족해 계산하지 않았다.</p>';
  else {
    const G = gov && gov.x, ab = v => `${ff(v, 1)}°`;
    s += `<h3>4.1 굴절 (스넬 법칙)</h3><p>등심선이 평행하다고 보고 ${ASM}, 대표 주기 T<sub>1/3</sub>의 규칙파로 스넬 법칙을 적용한다 (방향 분산 무시 ${ASM}). 현장 앞에 섬·방파제 등 차폐물이 없다고 보아 회절계수 K<sub>d</sub> = 1.0으로 둔다 ${ASM}.</p>
     <div class="eq">α<sub>0</sub> = 파향 − 등심선 법선 방향, sin α = (C/C<sub>0</sub>)·sin α<sub>0</sub>, K<sub>r</sub> = √(cos α<sub>0</sub> / cos α)<br>C<sub>0</sub> = g·T/(2π), C = L/T, L은 분산관계식 ω² = g·k·tanh(k·h)의 해</div>
     ${T(4, '굴절·천수 계수')}<table><tr><th>파향</th><th>α<sub>0</sub></th><th>L (m)</th><th>h/L<sub>0</sub></th><th>C/C<sub>0</sub></th><th>α</th><th>K<sub>r</sub></th><th>K<sub>d</sub></th><th>H<sub>0</sub>′ (m)</th><th>K<sub>s</sub></th></tr>
     ${tr.map(({ r, x }) => x.reach ? `<tr><td>${r.dir}</td><td>${ab(x.a0)}</td><td>${ff(x.W.L, 1)}</td><td>${ff(x.hL0, 4)}</td><td>${ff(x.W.C / x.W.C0, 4)}</td><td>${ab(x.a)}</td><td>${ff(x.Kr, 4)}</td><td>${ff(x.Kd, 2)}</td><td>${ff(x.H0p, 3)}</td><td>${ff(x.Ks, 4)}</td></tr>` : `<tr><td>${r.dir}</td><td>${ab(x.a0)}</td><td colspan="8" class="wrn l">${x.warn[0]}</td></tr>`).join('')}</table>
     ${G ? `<div class="eq">[채택 파향 ${gov.r.dir}] α<sub>0</sub> = ${dirDeg(gov.r.dir)}° − ${ff(nrm, 1)}° = ${ff(G.a0, 1)}°, L<sub>0</sub> = 9.81 × ${ff(G.T13, 1)}² / (2π) = ${ff(G.L0, 2)} m, L = ${ff(G.W.L, 2)} m (h = ${ff(h)} m)<br>
      sin α = (${ff(G.W.L, 2)} / ${ff(G.L0, 2)}) × sin ${ff(G.a0, 1)}° = ${ff(Math.sin(G.a * Math.PI / 180), 4)} → α = ${ff(G.a, 2)}°, K<sub>r</sub> = √(cos ${ff(G.a0, 1)}° / cos ${ff(G.a, 2)}°) = <b>${ff(G.Kr, 4)}</b><br>
      H<sub>0</sub>′ = K<sub>r</sub>·K<sub>d</sub>·H<sub>0</sub> = ${ff(G.Kr, 4)} × ${ff(G.Kd, 2)} × ${ff(gov.r.H0)} = <b>${ff(G.H0p, 3)} m</b></div>` : ''}
     <h3>4.2 천수 (선형파)</h3><div class="eq">K<sub>s</sub> = √(C<sub>g0</sub>/C<sub>g</sub>), C<sub>g0</sub> = g·T/(4π), C<sub>g</sub> = n·C, n = ½·[1 + 2kh/sinh(2kh)]
      ${G ? `<br>[채택 파향] kh = ${ff(G.W.kh, 4)}, n = ${ff(G.W.n, 4)}, C<sub>g</sub> = ${ff(G.W.Cg, 3)} m/s, C<sub>g0</sub> = ${ff(G.W.Cg0, 3)} m/s → K<sub>s</sub> = <b>${ff(G.Ks, 4)}</b>` : ''}</div>
     <p class="note">선형 천수계수를 쓴다 ${ASM}. 쇄파대 가까이에서는 비선형 천수 효과로 실제 파고가 더 커질 수 있으나, 쇄파대에서는 아래 고다 식의 상한(β 항)이 지배한다.</p>
     <h3>4.3 쇄파 — 고다(Goda) 식 (KDS 64 10 10)</h3>
     <div class="eq">h/L<sub>0</sub> ≥ 0.2 : H<sub>1/3</sub> = K<sub>s</sub>·H<sub>0</sub>′, H<sub>max</sub> = 1.8·K<sub>s</sub>·H<sub>0</sub>′<br>
      h/L<sub>0</sub> &lt; 0.2 : H<sub>1/3</sub> = min{β<sub>0</sub>·H<sub>0</sub>′ + β<sub>1</sub>·h, β<sub>max</sub>·H<sub>0</sub>′, K<sub>s</sub>·H<sub>0</sub>′}, H<sub>max</sub> = min{β<sub>0</sub>*·H<sub>0</sub>′ + β<sub>1</sub>*·h, β<sub>max</sub>*·H<sub>0</sub>′, 1.8·K<sub>s</sub>·H<sub>0</sub>′}<br>
      β<sub>0</sub> = 0.028(H<sub>0</sub>′/L<sub>0</sub>)<sup>−0.38</sup>·exp(20 tan<sup>1.5</sup>θ), β<sub>1</sub> = 0.52·exp(4.2 tanθ), β<sub>max</sub> = max{0.92, 0.32(H<sub>0</sub>′/L<sub>0</sub>)<sup>−0.29</sup>·exp(2.4 tanθ)}<br>
      β<sub>0</sub>* = 0.052(H<sub>0</sub>′/L<sub>0</sub>)<sup>−0.38</sup>·exp(20 tan<sup>1.5</sup>θ), β<sub>1</sub>* = 0.63·exp(3.8 tanθ), β<sub>max</sub>* = max{1.65, 0.53(H<sub>0</sub>′/L<sub>0</sub>)<sup>−0.29</sup>·exp(2.4 tanθ)}</div>
     ${G ? `<div class="eq">[채택 파향 ${gov.r.dir}] h/L<sub>0</sub> = ${ff(h)} / ${ff(G.L0, 2)} = ${ff(G.hL0, 4)} ${G.hL0 >= 0.2 ? '≥ 0.2 → 비쇄파 식' : '&lt; 0.2 → 쇄파 식'}, H<sub>0</sub>′/L<sub>0</sub> = ${ff(G.st, 5)}, tanθ = ${ff(tan, 4)}<br>
      β<sub>0</sub> = ${ff(G.b.b0, 4)}, β<sub>1</sub> = ${ff(G.b.b1, 4)}, β<sub>max</sub> = ${ff(G.b.bmax, 4)} · β<sub>0</sub>* = ${ff(G.b.b0s, 4)}, β<sub>1</sub>* = ${ff(G.b.b1s, 4)}, β<sub>max</sub>* = ${ff(G.b.bmaxs, 4)}<br>
      ${G.cand ? `H<sub>1/3</sub> = min{${G.cand.S.map(c => ff(c[0], 3)).join(', ')}} = <b>${ff(G.Hs, 3)} m</b> (${G.govS}) · H<sub>max</sub> = min{${G.cand.M.map(c => ff(c[0], 3)).join(', ')}} = <b>${ff(G.Hmax, 3)} m</b> (${G.govM})`
        : `H<sub>1/3</sub> = ${ff(G.Ks, 4)} × ${ff(G.H0p, 3)} = <b>${ff(G.Hs, 3)} m</b> · H<sub>max</sub> = 1.8 × ${ff(G.Hs, 3)} = <b>${ff(G.Hmax, 3)} m</b>`}</div>` : ''}
     ${T(4, '파향별 현장 설계파')}<table><tr><th>파향</th><th>H<sub>0</sub>′ (m)</th><th>K<sub>s</sub></th><th>H<sub>1/3</sub> (m)</th><th>지배식</th><th>H<sub>max</sub> (m)</th><th>지배식</th><th>구분</th></tr>
     ${tr.filter(o => o.x.reach).map(({ r, x }) => `<tr class="${gov && r === gov.r ? 'res' : ''}"><td>${r.dir}${gov && r === gov.r ? ' (채택)' : ''}</td><td>${ff(x.H0p, 3)}</td><td>${ff(x.Ks, 4)}</td><td><b>${ff(x.Hs)}</b></td><td>${x.govS}</td><td><b>${ff(x.Hmax)}</b></td><td>${x.govM}</td><td class="l">${x.zone}</td></tr>`).join('')}</table>
     <div class="note">주기는 천해 변형에서 변하지 않으므로 T<sub>1/3</sub>(현장) = T<sub>1/3</sub>(심해), 최대파 주기 T<sub>max</sub> ≈ T<sub>1/3</sub>로 둔다 ${ASM}(고다).</div>`;
    if (G) {
      s += `<h3>4.4 쇄파 한계 · 파봉고 · 파이론 적용 범위</h3>
       <div class="eq">쇄파 한계(고다 쇄파지표): H<sub>b</sub> = 0.17·L<sub>0</sub>·{1 − exp[−1.5π·(h/L<sub>0</sub>)·(1 + 15·tan<sup>4/3</sup>θ)]}
        = 0.17 × ${ff(G.L0, 2)} × {1 − exp[−1.5π × ${ff(G.hL0, 4)} × (1 + 15 × ${ff(tan, 4)}<sup>4/3</sup>)]} = <b>${ff(G.Hb, 2)} m</b><br>
        (참고) 미시(Miche) 식: H<sub>b</sub> = 0.142·L·tanh(kh) = ${ff(G.HbMiche, 2)} m<br>
        파봉고: 선형 η<sub>c</sub> = H<sub>max</sub>/2 = ${ff(G.crestLin, 2)} m · 2차 스토크스 η<sub>c</sub> = H/2 + (πH²/8L)·cosh(kh)·(2 + cosh 2kh)/sinh³(kh) = ${ff(G.crestSt2, 2)} m<br>
        어셀(Ursell) 수 U<sub>r</sub> = H<sub>max</sub>·L²/h³ = ${ff(G.Hmax, 2)} × ${ff(G.W.L, 1)}² / ${ff(h)}³ = ${ff(G.Ur, 1)}</div>
       ${T(4, '쇄파 한계 · 파봉고 · 파이론')}<table><tr><th>항목</th><th>값</th><th>판정·비고</th></tr>
        <tr><td>쇄파 한계 H<sub>b</sub></td><td><b>${ff(G.Hb)} m</b></td><td class="l ${G.Hmax > G.Hb ? 'wrn' : 'ok'}">H<sub>max</sub> ${ff(G.Hmax)} m ${G.Hmax > G.Hb ? '&gt; H<sub>b</sub> — 쇄파 한계를 넘음: 쇄파 파압 검토 필요' : '≤ H<sub>b</sub> — 쇄파 한계 이내'}</td></tr>
        <tr><td>파봉고 (정수면 위)</td><td><b>${ff(G.crest)} m</b></td><td class="l">${G.crestNote} · 선형 ${ff(G.crestLin)} m 대비 ${ff(G.crest / G.crestLin, 2)}배</td></tr>
        <tr><td>수심 구분</td><td>h/L<sub>0</sub> = ${ff(G.hL0, 4)}</td><td class="l">${G.theory}</td></tr>
        <tr><td>파이론</td><td>U<sub>r</sub> = ${ff(G.Ur, 1)}</td><td class="l">${G.theoryFit}</td></tr></table>`;
      const pf = DWE.profile({ H0: gov.r.H0, T: gov.r.T, h, tan, dirFrom: dirDeg(gov.r.dir), normalOff: nrm });
      if (pf.length > 2) s += svgPlot({ h: 260, xrev: true, xlab: '수심 h (m) — 오른쪽이 현장 쪽', ylab: '파고 (m)', ymin: 0,
        series: [{ type: 'line', color: '#2e90fa', pts: pf.map(p => [p.h, p.Hs]), label: 'H1/3' }, { type: 'line', color: '#b42318', pts: pf.map(p => [p.h, p.Hmax]), label: 'Hmax' }, { type: 'line', color: '#667085', dash: '5 3', pts: pf.map(p => [p.h, p.Hb]), label: '쇄파 한계 Hb' }],
        vlines: [[h, `현장 h=${ff(h, 1)}m`]] }) + Fg(4, `수심에 따른 파고 변화 (채택 파향 ${gov.r.dir}, 같은 계산식으로 수심만 바꿈)`);
    }
    tr.forEach(({ x }) => x.warn.filter(w => !/진행하지 않습니다/.test(w)).forEach(w => { s += `<div class="wrn">⚠ ${w}</div>`; }));
  }
  // 5. 검증
  s += `<h2 class="pb">5. 검증 — 관측 극치값과 비교</h2>`;
  if (!gov || !obs || !obs.adopt) s += `<p class="note">${!gov ? '현장 설계파' : '관측 극치'}가 없어 비교하지 않았다.</p>`;
  else {
    const o = obs, F = o.F[o.adopt], ci = o.CI[o.adopt], G = gov.x, Ri = DWE.RS.indexOf(R), Ho = F.xR(R), cR = Ri >= 0 ? ci[Ri] : DWE.boot(o.adopt.startsWith('am') ? o.AM : o.P.map(p => p.v), o.adopt.startsWith('am') ? 1 : o.lam, (x, l) => DWE.fit(x, l, F.dist, F.k), [R], 300)[0];
    const st = o.d.stn || {}, dist = st.lat && DWI.site.lat !== '' ? hav([+st.lat, +st.lon], [+DWI.site.lat, +DWI.site.lon]) : null, bd = +DWI.obs.depth;
    const bW = bd > 0 ? DWE.wave(G.T13, bd) : null, ratio = G.Hs / Ho;
    s += `${T(5, `재현기간 ${R}년 유의파고 비교`)}<table><tr><th>구분</th><th>위치</th><th>수심</th><th>H<sub>1/3</sub> (m)</th><th>비고</th></tr>
      <tr><td>심해설계파</td><td>${esc(DWI.deep.grid || '격자점')}</td><td>심해</td><td>${ff(gov.r.H0)}</td><td class="l">${esc(DWI.deep.src)} (${gov.r.dir})</td></tr>
      <tr class="res"><td>현장 설계파 (본 보고서)</td><td>${esc(DWI.site.name || '사업지')}</td><td>${ff(h, 1)} m</td><td><b>${ff(G.Hs)}</b></td><td class="l">천해 변형(고다), H<sub>max</sub> ${ff(G.Hmax)} m</td></tr>
      <tr><td>관측 극치 (${NAMES[o.adopt]})</td><td>${esc(st.name || o.d.name)}${dist != null ? ` (현장에서 ${ff(dist, 1)} km)` : ''}</td><td>${bd > 0 ? ff(bd, 1) + ' m' : '–'}</td><td><b>${ff(Ho)}</b><br><span style="font-size:10.5px">90% 구간 ${ff(cR && cR.lo)}~${ff(cR && cR.hi)}</span></td><td class="l">관측 ${ff(o.K, 1)}년, 최대 관측 ${ff(o.mx)} m</td></tr>
      <tr><td>비율</td><td colspan="2">현장 설계파 / 관측 극치</td><td><b>${ff(ratio, 2)}</b></td><td class="l">${cR && cR.hi != null ? (G.Hs >= cR.lo && G.Hs <= cR.hi ? '관측 극치 90% 구간 안' : G.Hs > cR.hi ? '관측 극치 90% 구간보다 큼' : '관측 극치 90% 구간보다 작음') : ''}</td></tr></table>
     <h3>5.1 차이에 대한 설명</h3><ul>
      <li>관측 극치는 관측소 위치${bd > 0 ? `(수심 ${ff(bd, 1)} m${bW ? `, h/L<sub>0</sub> = ${ff(bd / bW.L0, 3)}` : ''})` : ''}의 값이고, 현장 설계파는 수심 ${ff(h, 1)} m (h/L<sub>0</sub> = ${ff(G.hL0, 3)})에서 굴절·천수·쇄파를 거친 값이다.${dist != null ? ` 두 지점은 ${ff(dist, 1)} km 떨어져 있어 외해 노출·차폐 조건이 다를 수 있다.` : ''}</li>
      <li>관측 기간은 ${ff(o.K, 1)}년으로, ${R}년 값은 외삽이다.${o.K < 20 ? ' 관측 기간에 큰 태풍이 없었으면 관측 극치는 작게 나온다.' : ''} 심해설계파는 장기 파랑 추산(태풍 포함) 결과로 정한 값이다.</li>
      ${o.yt.some(r => r.rateTy != null && r.rateTy < 0.7) ? `<li class="wrn">태풍기 자료율이 70% 미만인 해(${o.yt.filter(r => r.rateTy != null && r.rateTy < 0.7).map(r => r.y).join(', ')})가 있어 관측 극치가 과소일 수 있다.</li>` : ''}
      <li>${ratio >= 1 ? `현장 설계파가 관측 극치보다 ${ff((ratio - 1) * 100, 0)}% 크므로, 설계파는 관측으로 확인된 수준을 포괄한다.` : `<span class="wrn">현장 설계파가 관측 극치보다 ${ff((1 - ratio) * 100, 0)}% 작다.</span> 관측소와 현장의 조건 차이를 확인하고, 필요하면 설계파 입력(격자점·파향·수심·경사)을 다시 검토한다.`}</li></ul>`;
  }
  // 6. 결론
  s += `<h2>6. 결론</h2>`;
  if (!gov) s += '<p class="wrn">현장 설계파를 산정하지 못했다 (입력 확인).</p>';
  else { const G = gov.x;
    s += `<p>재현기간 ${R}년 심해설계파를 현장 수심 ${ff(h, 1)} m까지 천해 변형하여 아래 설계파를 정한다. 파향별로 계산한 값 중 최대파고가 가장 큰 ${gov.r.dir} 파향을 채택하였다.</p>
     ${T(6, '설계파 (기초 구조물 파랑하중 산정용)')}<table class="res"><tr><th>항목</th><th>기호</th><th>값</th><th>비고</th></tr>
      <tr><td>파향</td><td>–</td><td><b>${gov.r.dir}</b></td><td class="l">${dirDeg(gov.r.dir)}°에서 입사</td></tr>
      <tr><td>산정 수심</td><td>h</td><td><b>${ff(h)} m</b></td><td class="l">${esc(S.tide)}</td></tr>
      <tr><td>유의파고</td><td>H<sub>1/3</sub></td><td><b>${ff(G.Hs)} m</b></td><td class="l">${G.govS}</td></tr>
      <tr><td>최대파고</td><td>H<sub>max</sub></td><td><b>${ff(G.Hmax)} m</b></td><td class="l">${G.govM}</td></tr>
      <tr><td>유의파 주기</td><td>T<sub>1/3</sub></td><td><b>${ff(G.T13)} s</b></td><td class="l">심해와 같음</td></tr>
      <tr><td>최대파 주기</td><td>T<sub>max</sub></td><td><b>${ff(G.Tmax)} s</b></td><td class="l">T<sub>max</sub> ≈ T<sub>1/3</sub> (가정)</td></tr>
      <tr><td>쇄파 한계</td><td>H<sub>b</sub></td><td><b>${ff(G.Hb)} m</b></td><td class="l">고다 쇄파지표</td></tr>
      <tr><td>파봉고 (정수면 위)</td><td>η<sub>c</sub></td><td><b>${ff(G.crest)} m</b></td><td class="l">${G.crestNote}</td></tr></table>
     <h3>가정 사항</h3><ul class="note"><li>평행 등심선(스넬 법칙), 대표 주기 규칙파 굴절, 방향 분산 무시</li><li>회절계수 K<sub>d</sub> = 1.0 (차폐 없음)</li><li>선형 천수계수</li><li>T<sub>max</sub> ≈ T<sub>1/3</sub></li>${obs && obs.auto ? '<li>POT 임계값 자동 설정 (연 약 3회)</li>' : ''}${G.crestCap ? '<li>크노이드 영역의 파봉고 0.8·H<sub>max</sub> 상한</li>' : ''}</ul>
     <p class="note">결과 파일(.json)을 기초 설계도구의 "설계파 파일 가져오기"로 넣으면 설계파고 H = H<sub>max</sub> ${ff(G.Hmax)} m, 주기 T = T<sub>max</sub> ${ff(G.Tmax)} s가 채워진다. 본 보고서는 ${esc(S.name || '사업지')} 기초 구조계산서에 첨부한다.</p>`; }
  s += `<p class="note" style="margin-top:24px;border-top:1px solid #d0d5dd;padding-top:6px">작성: 기상 데이터(바람·파랑) 관측 대시보드 · ${esc(I.date)}</p>`;
  return s;
}

// ---------- 파일 ----------
function dwPrint() { const t0 = document.title; document.title = `${DWI.title || '설계파 산정 보고서'}_${DWI.site.name || '사업지'}_${DWI.deep.R || 50}년`; window.print(); setTimeout(() => { document.title = t0; }, 1000); }
function dwExport() {
  const X = DWR; if (!X || !X.gov) { alert('현장 설계파가 계산되지 않았습니다. 수심·경사·법선 방향·심해설계파를 넣어 주세요.'); return; }
  const G = X.gov.x, S = X.I.site, r3 = v => Math.round(v * 1000) / 1000, nn = v => v === '' || v == null || !isFinite(+v) ? 0 : +v;
  const o = { app: 'design-wave', ver: 1, saved: iso(new Date()), from: '해양 바람·파랑 관측 대시보드',
    title: X.I.title || '설계파 산정 보고서', reportNo: X.I.reportNo || '', returnPeriod: X.R, method: '심해설계파 + 천해 변형(고다)',
    site: { name: S.name || '', lat: nn(S.lat), lon: nn(S.lon), depth: r3(X.h) },
    design: { dir: X.gov.r.dir, Hs: r3(G.Hs), Hmax: r3(G.Hmax), T13: r3(G.T13), Tmax: r3(G.Tmax), Hb: r3(G.Hb), crest: r3(G.crest) } };
  dwDl(`설계파_${(S.name || '사업지').replace(/[\\/:*?"<>|\s]+/g, '_')}_${X.R}년.json`, JSON.stringify(o, null, 1));
}
function dwSaveFile() { dwDl(`설계파_입력_${(DWI.site.name || '사업지').replace(/[\\/:*?"<>|\s]+/g, '_')}.json`, JSON.stringify({ app: 'design-wave-input', ver: 1, saved: iso(new Date()), input: DWI }, null, 1)); }
async function dwLoadFile(f) {
  if (!f) return; try { const o = JSON.parse(await f.text()); if (o.app !== 'design-wave-input' || !o.input) throw new Error('설계파 입력 파일(design-wave-input)이 아닙니다');
    const D = DW_DEF(), i = o.input; DWI = { ...D, ...i, site: { ...D.site, ...i.site }, deep: { ...D.deep, ...i.deep }, obs: { ...D.obs, ...i.obs } };
    if (!DWI.deep.rows || !DWI.deep.rows.length) DWI.deep.rows = D.deep.rows; dwSave(); dwForm(); dwRun(); } catch (e) { alert('불러오지 못했습니다: ' + e.message); } }
function dwDl(name, text) { const u = URL.createObjectURL(new Blob([text], { type: 'application/json' })), a = document.createElement('a'); a.href = u; a.download = name; a.click(); }
