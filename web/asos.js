// ===== 기상청 종관기상관측(ASOS) — 육상 지점: 지도·최신 관측·장기 1시간 자료 받기 =====
// data/asos.json(사이트가 매시간 갱신) + 장기 자료는 이용자 키로 kma_sfctm3.php(한 번에 최대 31일)를 한 달씩
let ASOS = null, ASEL = null, AJOB_DONE = { key: '', parts: {} };
const ASCOL = '#7a5af8';
const asosLayer = L.layerGroup().addTo(map);
if (!('A' in show)) show.A = true;
const _filters1 = filters;
filters = function () { _filters1(); const box = document.getElementById('filters'); if (box && !box.querySelector('[data-asos]')) { const l = document.createElement('label'); l.className = 'chip'; l.dataset.asos = 1;
  l.innerHTML = `<input type="checkbox" ${show.A ? 'checked' : ''}><svg width="11" height="11" viewBox="0 0 12 12" style="vertical-align:-1px"><path d="M6 1L11 11H1Z" fill="${ASCOL}"/></svg>ASOS(육상)`;
  l.querySelector('input').onchange = e => { show.A = e.target.checked; asosDraw(); }; box.appendChild(l); } };

const azh = s => (s && s.zh > 0 ? +s.zh : 10);          // 풍속계 높이(일람표), 없으면 표준 10 m
const azhEst = s => !(s && s.zh > 0);
function asosIcon(s) {
  const a = s.wd != null && s.ws > 0 ? `<line x1="0" y1="-12" x2="0" y2="-5" stroke="${ASCOL}" stroke-width="2" transform="rotate(${(s.wd + 180) % 360})"/>` : '';
  return L.divIcon({ className: '', iconSize: [70, 26], iconAnchor: [13, 13], html: `<div style="display:flex;align-items:center;gap:2px">
   <svg width="26" height="26" viewBox="-13 -13 26 26">${a}<path d="M0 -5L5 4H-5Z" fill="${ASCOL}" stroke="#fff" stroke-width="1.2"/></svg>
   <span class="wlab" style="color:${ASCOL}">${s.ws != null ? s.ws.toFixed(1) : ''}</span></div>` });
}
function asosDraw() {
  asosLayer.clearLayers(); if (!ASOS || !show.A) return;
  for (const s of ASOS.stations) L.marker([s.lat, s.lon], { icon: asosIcon(s), zIndexOffset: -200 }).addTo(asosLayer).on('click', () => asosSelect(s.stn))
    .bindTooltip(`${s.name}(${s.stn}) ASOS · ${s.ws != null ? s.ws + ' m/s' : '관측 없음'}${s.wd != null && s.ws > 0 ? ' · ' + Math.round(s.wd) + '°' : ''}`);
}
async function asosLoad() { try { const r = await fetch('data/asos.json?' + Math.floor(Date.now() / 6e5)); if (r.ok) { ASOS = await r.json(); asosDraw(); } } catch (e) { } }

const ALONG = [['1년', '최소', '측정 기간과 겹치는지 확인용'], ['5년', '권장', '풍황 통계'], ['10년', '장기 보정', 'MCP 기준'], ['20년', '장기', '평년 비교'], ['30년', '기후값', '시간이 오래 걸림']];
function asosSelect(stn) {
  const s = ASOS && ASOS.stations.find(x => x.stn == stn); if (!s) return;
  ASEL = s; SEL = null; toPanel(); if (typeof PIN !== 'undefined' && PIN) { map.removeLayer(PIN); PIN = null; }
  const z = azh(s), kv = (n, v) => `<div class="kv"><span>${n}</span><b>${v ?? '–'}</b></div>`;
  const tm = s.tm ? `${s.tm.slice(4, 6)}/${s.tm.slice(6, 8)} ${s.tm.slice(8, 10)}시` : '';
  document.getElementById('panel').innerHTML = `${navBtns(true)}
   <h2>${s.name} <span class="sub">ASOS 종관기상관측 · ${s.stn}</span></h2>
   <div class="sub">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} · 해발 ${s.ht ?? '–'} m · 풍속계 지상 ${z} m${azhEst(s) ? ' (일람표에 없어 표준 10 m로 가정)' : ''}${tm ? ' · ' + tm + ' 관측' : ''}</div>
   <div class="grid">${kv('풍속 (m/s)', s.ws)}${kv('풍향', s.wd != null && s.ws > 0 ? Math.round(s.wd) + '°' : (s.ws === 0 ? '고요' : null))}${kv('돌풍 (m/s)', s.gst)}
    ${kv('기온 (°C)', s.ta)}${kv('습도 (%)', s.hm)}${kv('현지기압 (hPa)', s.pa)}${HUB.on ? kv(`허브 ${HUB.h}m 환산`, conv(s.ws, z)) : ''}</div>
   <div class="sub" style="background:#f4f3ff;border-radius:8px;padding:7px 9px;margin:6px 0;line-height:1.6">육상 관측소라 지형·건물 영향을 받습니다. 바다 위 풍속과는 차이가 있어, 풍황 분석보다는 <b>장기 보정(MCP) 기준</b>이나 장기 경향 확인에 쓰기 좋습니다. 1904년부터 관측한 지점도 있습니다(지점마다 다름).</div>
   <div class="box"><h3>장기 1시간 자료 받기</h3>
    ${ALONG.map(([n, t, m], i) => `<button class="preset" data-a="${i}" onclick="apreset(${i})"><b>${n}</b><span class="tag">${t}</span><small>${m}</small></button>`).join('')}
    <div class="row"><input type="date" id="a1" oninput="acustom()"> ~ <input type="date" id="a2" oninput="acustom()"> <span class="sub" id="aspan"></span></div>
    <div class="sub">받는 자료: <b>1시간 관측</b>(풍향·풍속·돌풍·기온·습도·기압) · 한 달씩 나눠 받음</div>
    ${keyBox('지상관측 › 종관기상관측(ASOS) › 1.1 시간자료')}
    <button class="btn pri" onclick="adl()">CSV 받기</button> <button class="btn" onclick="if(JOB)JOB.stop=true">취소</button>
    <div id="ajob" style="margin-top:8px"></div></div>`;
  apreset(2); map.setView([s.lat, s.lon], Math.max(map.getZoom(), 9));
}
function apreset(i) { const y = [1, 5, 10, 20, 30][i], t = new Date(), s = new Date(t); s.setFullYear(t.getFullYear() - y); s.setDate(s.getDate() + 1);
  document.getElementById('a1').value = iso(s); document.getElementById('a2').value = iso(t);
  document.querySelectorAll('.preset[data-a]').forEach(b => b.classList.toggle('on', +b.dataset.a == i)); aspan(false); }
function aspan(custom) { const a = document.getElementById('a1'), b = document.getElementById('a2'), o = document.getElementById('aspan'); if (!o) return;
  const x = new Date(a.value + 'T00:00'), y = new Date(b.value + 'T00:00'); if (isNaN(x) || isNaN(y)) { o.textContent = ''; return; }
  if (y < x) { o.innerHTML = '<span class="err">시작일이 종료일보다 늦습니다</span>'; return; }
  const d = Math.round((y - x) / 864e5) + 1, m = Math.round(d / 30.4375), yr = Math.floor(m / 12), mo = m % 12;
  o.textContent = (custom ? '직접 지정 · ' : '') + `${d.toLocaleString()}일` + (m >= 1 ? ` (약 ${[yr ? yr + '년' : '', mo ? mo + '개월' : ''].filter(Boolean).join(' ')})` : ''); }
function acustom() { document.querySelectorAll('.preset[data-a]').forEach(b => b.classList.remove('on')); aspan(true); }

const AFATAL = /취소했습니다|기상청 응답|허용되지 않은 경로/;
const ACOLS = ['TM', 'WD', 'WS', 'GST_WS', 'TA', 'HM', 'PA', 'PS'], AHEAD = { TM: '관측시각(KST)', WD: '풍향(deg)', WS: '풍속(m/s)', GST_WS: '돌풍(m/s)', TA: '기온(C)', HM: '습도(%)', PA: '현지기압(hPa)', PS: '해면기압(hPa)' };
function parseAsos(t, stn) {
  if (/^\s*\{/.test(t)) { let j; try { j = JSON.parse(t); } catch (e) { } const m = j && (j.result && j.result.message || j.message); throw new Error('기상청 응답: ' + (m || t.slice(0, 80))); }
  const out = [], n = v => { const x = +v; return isFinite(x) && x > -9 ? x : ''; };
  for (const ln of t.split(/\r?\n/)) { const p = ln.trim().split(/\s+/); if (p.length < 14 || !/^\d{12}$/.test(p[0]) || p[1] != stn) continue;
    const wd = n(p[2]); out.push({ TM: p[0], WD: wd === '' ? '' : wd * 10, WS: n(p[3]), GST_WS: n(p[5]), PA: n(p[7]), PS: n(p[8]), TA: n(p[11]), HM: n(p[13]) }); }
  return out;
}
async function adl() {
  const box = document.getElementById('ajob'), key = getKey(box); if (!key) return;
  const st = ASEL, a = new Date(document.getElementById('a1').value + 'T00:00'), b = new Date(document.getElementById('a2').value + 'T23:59'), now = new Date();
  if (!(a <= b)) { box.innerHTML = '<span class="err">기간을 확인해 주세요</span>'; return; } if (b > now) b.setTime(now.getTime());
  if (JOB) { box.innerHTML = '<span class="err">다른 받기가 진행 중입니다. 끝난 뒤 다시 누르세요.</span>'; return; }
  JOB = { stop: false }; const t0 = Date.now(), p2 = x => String(x).padStart(2, '0');
  let tasks = [];
  for (let y = a.getFullYear(), m = a.getMonth(); y < b.getFullYear() || (y == b.getFullYear() && m <= b.getMonth()); m == 11 ? (y++, m = 0) : m++) {
    const last = new Date(y, m + 1, 0).getDate(), s1 = `${y}${p2(m + 1)}010000`, e1 = `${y}${p2(m + 1)}${p2(last)}2300`;
    tasks.push({ lab: `${y}-${p2(m + 1)}`, fn: async () => parseAsos(await relay('typ01/url/kma_sfctm3.php', { tm1: s1, tm2: e1, stn: st.stn, help: '0' }, key), st.stn) });
  }
  const jk = `${st.stn}|${iso(a)}|${iso(b)}`; if (AJOB_DONE.key != jk) AJOB_DONE = { key: jk, parts: {} };
  const D = AJOB_DONE.parts, reused = Object.keys(D).length, fails = []; let skipped = null;
  const probe = async () => { if (tasks.length < 9 || reused) return;   // 자료 시작 시점 찾기 (앞쪽 빈 달 건너뛰기)
    box.innerHTML = '<div class="sub">이 지점 자료가 시작되는 날짜를 찾는 중…</div>';
    const has = async i => { const T = tasks[i]; try { const r = await retry(T.fn); D[T.lab] = r; return r.length > 0; } catch (e) { if (AUTHERR.test(e.message) || AFATAL.test(e.message)) throw e; return null; } };
    if (await has(0) !== false) return;
    const n = tasks.length; let lo = 0, hi = -1;
    for (let k = 1; k <= 8; k++) { const i = k == 8 ? n - 1 : Math.floor(n * k / 8); if (i <= lo) continue; if (await has(i) !== false) { hi = i; break; } lo = i; }
    if (hi < 0) return; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (await has(mid) !== false) hi = mid; else lo = mid; }
    if (hi > 0) { skipped = hi; tasks = tasks.slice(hi); } };
  const show_ = d => { const p = Math.floor(d * 100 / tasks.length), el = (Date.now() - t0) / 1000, rem = d ? el * (tasks.length - d) / d : 0;
    box.innerHTML = `<div class="sub">${st.name} 받는 중 ${p}% (${d}/${tasks.length}달)${fails.length ? ` · <span class="err">실패 ${fails.length}달(건너뜀)</span>` : ''}${reused ? ` · 이어받기 ${reused}달` : ''}${rem > 3 ? ` · 남은 시간 약 ${rem < 90 ? Math.round(rem) + '초' : Math.round(rem / 60) + '분'}` : ''}</div><div class="bar"><i style="width:${p}%"></i></div>`; };
  try {
    await probe(); show_(0);
    const run = tasks.map(T => async () => { if (D[T.lab]) return D[T.lab]; try { const r = await retry(T.fn); D[T.lab] = r; return r; } catch (e) { if (AUTHERR.test(e.message) || AFATAL.test(e.message)) throw e; fails.push(T.lab); return []; } });
    let rows = [].concat(...await pool(run, 4, show_));
    const lo = `${iso(a).replace(/-/g, '')}0000`, hi = `${iso(b).replace(/-/g, '')}2359`, seen = new Set();
    rows = rows.filter(r => r.TM >= lo && r.TM <= hi && !seen.has(r.TM) && seen.add(r.TM)).sort((x, y) => x.TM < y.TM ? -1 : 1);
    if (!rows.length) throw new Error('받은 자료가 없습니다 (이 기간에 관측이 없습니다)');
    const z = azh(st), hc = HUB.on, r0 = rows[0].TM.slice(0, 8), r1 = rows[rows.length - 1].TM.slice(0, 8), fd = x => `${x.slice(0, 4)}-${x.slice(4, 6)}-${x.slice(6, 8)}`;
    const head = ['지점명', '지점번호', ...ACOLS.map(c => AHEAD[c])].concat(hc ? [hubLabel(z, { stn: st.stn, zh_est: azhEst(st) }).replace(/,/g, ' ')] : []).join(',');
    const csv = '﻿' + [head].concat(rows.map(r => [st.name, st.stn, ...ACOLS.map(c => r[c])].concat(hc ? [conv(r.WS, z) ?? ''] : []).join(','))).join('\r\n');
    const fn = `ASOS_${st.name}_${st.stn}_1시간_${r0}-${r1}.csv`;
    const u = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), el = document.createElement('a'); el.href = u; el.download = fn; el.click();
    const id = `asos-${st.stn}-${r0}-${r1}`, num_ = v => v === '' ? null : +v;
    dsAdd({ id, name: `${st.name}(ASOS ${st.stn}) ${fd(r0)}~${fd(r1)}`, kind: 'ASOS 육상 1시간', z, stn: { stn: st.stn, name: st.name, zh: z, zh_est: azhEst(st) },
      t: rows.map(r => tm12(r.TM)), ws: rows.map(r => num_(r.WS)), wd: rows.map(r => num_(r.WD)), wh: rows.map(() => null) });
    fails.sort(); if (!fails.length) AJOB_DONE = { key: '', parts: {} };
    box.innerHTML = `<div class="sub">완료: ${rows.length.toLocaleString()}행 · ${fn}</div>
     <div class="sub">받은 자료 기간: <b>${fd(r0)} ~ ${fd(r1)}</b>${r0 > iso(a).replace(/-/g, '') ? ` · 요청 시작일(${iso(a)}) 이전에는 이 지점 자료가 없습니다${skipped ? ` (앞쪽 ${skipped}달은 확인 후 건너뜀)` : ''}` : ''}</div>
     ${fails.length ? `<div class="err" style="margin-top:4px">받지 못한 달 ${fails.length}개: ${fails.slice(0, 8).join(', ')}${fails.length > 8 ? ' …' : ''}<br>'CSV 받기'를 다시 누르면 받은 달은 그대로 두고 이 달만 다시 받습니다.</div>` : ''}
     <button class="btn" style="margin-top:6px" onclick="DSEL='${id}';AN.tab='wind';openAnalysis()">📊 받은 자료 분석하기</button>`;
  } catch (e) {
    const k = Object.keys(AJOB_DONE.parts).length;
    box.innerHTML = `<span class="err">${/허용되지 않은 경로/.test(e.message) ? '중계 서버가 아직 ASOS를 허용하지 않습니다 — 관리자가 Cloudflare 중계 서버 코드를 새로 교체해야 합니다.' : /403|활용신청/.test(e.message) ? '인증 실패: 이 키로 ‘종관기상관측(ASOS) › 1.1 시간자료’를 활용신청했는지 확인하세요. (' + e.message + ')' : e.message}</span>${k && !AUTHERR.test(e.message) ? `<div class="sub">받은 ${k}달은 기억해 두었습니다 — 다시 누르면 이어서 받습니다.</div>` : ''}`;
  } finally { JOB = null; }
}
// 사업지 패널: 가까운 ASOS 지점
function asosNearHTML(lat, lon) {
  if (!ASOS || typeof hav !== 'function') return '';
  const list = ASOS.stations.map(s => ({ s, d: hav([lat, lon], [s.lat, s.lon]) })).sort((a, b) => a.d - b.d).slice(0, 5);
  return `<div class="box"><h3>가까운 ASOS 육상 관측소</h3><table class="tbl"><tr><th>지점</th><th>거리</th><th>풍속계</th></tr>
   ${list.map(({ s, d }) => `<tr style="cursor:pointer" onclick="asosSelect('${s.stn}')"><td>${s.name}(${s.stn})</td><td>${d.toFixed(1)}km</td><td>${azh(s)}m</td></tr>`).join('')}</table>
   <div class="sub">장기 보정(MCP) 기준 후보 · 눌러서 장기 자료 받기</div></div>`;
}
filters();
asosLoad();
