// ===== 관측소 찾기: 지점번호·이름으로 해양 관측소·ASOS·조류예보 지점을 찾아 지도에서 바로 보여 줌 =====
(function () {
  const css = document.createElement('style');
  css.textContent = `.srch{position:relative}.srch input{width:210px;padding:6px 10px;border-radius:6px;border:1px solid #ffffff40;background:#ffffff1a;color:#fff;font-size:13px}
  .srch input::placeholder{color:#ffffffa0}.srch ul{position:absolute;top:34px;left:0;z-index:2000;background:#fff;color:#111;list-style:none;margin:0;padding:4px 0;border-radius:8px;
  box-shadow:0 6px 20px #0003;width:300px;max-height:340px;overflow:auto;display:none}.srch li{padding:6px 10px;cursor:pointer;font-size:13px;display:flex;gap:6px;align-items:center}
  .srch li:hover,.srch li.on{background:#eef4ff}.srch li small{color:#667085;margin-left:auto;white-space:nowrap}.srch .mk{width:10px;height:10px;flex:none}
  @keyframes fpulse{0%{transform:scale(.4);opacity:1}100%{transform:scale(1.6);opacity:0}}.fring{width:56px;height:56px;border:4px solid #f04438;border-radius:50%;animation:fpulse 1.2s ease-out 4}
  @media(max-width:820px){.srch{order:8;width:100%}.srch input{width:100%}.srch ul{width:100%}}`;
  document.head.appendChild(css);
  const h = document.querySelector('header'), sp = h && h.querySelector('.sp'); if (!h) return;
  const box = document.createElement('div'); box.className = 'srch';
  box.innerHTML = `<input id="sq" type="search" placeholder="🔍 관측소 찾기 (번호·이름)" autocomplete="off"><ul id="sres"></ul>`;
  h.insertBefore(box, sp ? sp.nextSibling : null);
  const inp = box.querySelector('input'), ul = box.querySelector('ul'); let hits = [], cur = -1;

  function all() {
    const out = [];
    if (typeof DATA !== 'undefined' && DATA) for (const s of DATA.stations) out.push({ k: 'M', id: s.stn, name: s.name, lat: s.lat, lon: s.lon, kind: (TYPES[s.tp] || [s.tp])[0], col: (TYPES[s.tp] || [, '#475467'])[1] });
    if (typeof ASOS !== 'undefined' && ASOS) for (const s of ASOS.stations) out.push({ k: 'A', id: s.stn, name: s.name, lat: s.lat, lon: s.lon, kind: 'ASOS 육상', col: ASCOL });
    if (typeof CUR !== 'undefined' && CUR) for (const s of CUR.stations) out.push({ k: 'K', id: s.code, name: s.name, lat: s.lat, lon: s.lon, kind: '조류예보', col: CURCOL });
    return out;
  }
  function find(q) {
    q = q.trim().toLowerCase(); if (!q) return [];
    const sc = x => { const id = String(x.id).toLowerCase(), nm = (x.name || '').toLowerCase();
      return id === q ? 0 : nm === q ? 1 : id.startsWith(q) ? 2 : nm.startsWith(q) ? 3 : id.includes(q) ? 4 : nm.includes(q) ? 5 : 9; };
    return all().map(x => [sc(x), x]).filter(([v]) => v < 9).sort((a, b) => a[0] - b[0] || String(a[1].name).localeCompare(b[1].name, 'ko')).slice(0, 30).map(([, x]) => x);
  }
  function render() {
    if (!hits.length) { ul.innerHTML = inp.value.trim() ? '<li style="cursor:default;color:#667085">찾는 관측소가 없습니다</li>' : ''; ul.style.display = inp.value.trim() ? 'block' : 'none'; return; }
    ul.innerHTML = hits.map((x, i) => `<li data-i="${i}" class="${i == cur ? 'on' : ''}"><span class="mk" style="background:${x.col};${x.k == 'K' ? 'transform:rotate(45deg)' : x.k == 'A' ? 'clip-path:polygon(50% 0,100% 100%,0 100%)' : 'border-radius:50%'}"></span>${x.name} <b>${x.id}</b><small>${x.kind}</small></li>`).join('');
    ul.style.display = 'block';
  }
  function go(x) {
    if (!x) return; ul.style.display = 'none'; inp.value = `${x.name} (${x.id})`; inp.blur();
    if (x.k == 'M') { const s = DATA.stations.find(s => s.stn == x.id); if (typeof show !== 'undefined' && s && show[s.tp] === false) { show[s.tp] = true; filters(); draw(); } select(s); }
    else if (x.k == 'A') { if (!show.A) { show.A = true; filters(); asosDraw(); } asosSelect(x.id); }
    else { if (!show.K) { show.K = true; filters(); curDraw(); } curSelect(x.id); }
    setTimeout(() => focusAt(x.lat, x.lon, true), 30);
  }
  inp.addEventListener('input', () => { hits = find(inp.value); cur = hits.length ? 0 : -1; render(); });
  inp.addEventListener('focus', () => { if (inp.value.trim()) { hits = find(inp.value.replace(/\s*\(.*\)$/, '')); render(); } });
  inp.addEventListener('keydown', e => {
    if (e.key == 'ArrowDown') { cur = Math.min(hits.length - 1, cur + 1); render(); e.preventDefault(); }
    else if (e.key == 'ArrowUp') { cur = Math.max(0, cur - 1); render(); e.preventDefault(); }
    else if (e.key == 'Enter') { go(hits[cur >= 0 ? cur : 0]); e.preventDefault(); }
    else if (e.key == 'Escape') { ul.style.display = 'none'; inp.blur(); }
  });
  ul.addEventListener('mousedown', e => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); go(hits[+li.dataset.i]); } });
  document.addEventListener('click', e => { if (!box.contains(e.target)) ul.style.display = 'none'; });
})();

// 고른 관측소 위치를 지도에서 깜박여 표시하고 그쪽으로 이동
let FRING = null;
function focusAt(lat, lon, zoom) {
  if (lat == null || lon == null) return;
  if (zoom) map.flyTo([lat, lon], Math.max(map.getZoom(), 10), { duration: 0.6 });
  else if (!map.getBounds().pad(-0.1).contains([lat, lon])) map.panTo([lat, lon]);
  if (FRING) map.removeLayer(FRING);
  FRING = L.marker([lat, lon], { interactive: false, zIndexOffset: 1000, icon: L.divIcon({ className: '', iconSize: [56, 56], iconAnchor: [28, 28], html: '<div class="fring"></div>' }) }).addTo(map);
  setTimeout(() => { if (FRING) { map.removeLayer(FRING); FRING = null; } }, 5200);
}
// 사업지 패널·목록에서 관측소를 눌렀을 때도 지도에서 위치를 보여 줌
(function () {
  const wrap = (name, getLL) => { const f = window[name]; if (typeof f !== 'function') return;
    window[name] = function (...a) { const r = f.apply(this, a); try { const ll = getLL(...a); if (ll) focusAt(ll[0], ll[1]); } catch (e) { } return r; }; };
  wrap('select', s => s && [s.lat, s.lon]);
  wrap('asosSelect', id => { const s = ASOS && ASOS.stations.find(x => x.stn == id); return s && [s.lat, s.lon]; });
  wrap('curSelect', id => { const s = CUR && CUR.stations.find(x => x.code == id); return s && [s.lat, s.lon]; });
})();
