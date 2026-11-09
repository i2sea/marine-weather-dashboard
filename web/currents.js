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
   <div class="box"><h3>내려받기</h3><button class="btn pri" onclick="curCSV()">최강·전류 시각 CSV (${c.t0} ~ ${c.t1})</button>
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
