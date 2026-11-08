"""해양기상 실시간 관측 대시보드 (기상청 API허브)  v0.1  2026-11-06

실행:  python marine_dashboard.py        → 브라우저에 http://localhost:8765 이 열립니다.
필요:  같은 폴더에 marine_collector.py, kma_key.txt(인증키 한 줄)
       Python 3.8+ (추가 설치 없음). 지도·그래프는 인터넷에서 불러옵니다.

화면
  - 지도: 해양기상부이·파고부이·등표·조위·연안방재 관측 지점 전체, 최신 관측값 (10분마다 자동 갱신)
          화살표 = 바람이 불어가는 방향, 숫자 = 풍속(m/s) 또는 유의파고(m)
  - 지점 클릭: 최신값, 최근 1·3·7일 그래프(풍속·돌풍·파고·수온·기온)
  - 다운로드: 기간을 고르면(추천 기간·예상 시간 안내) 백그라운드로 받아 CSV로 내려줌
끄기:  명령 프롬프트 창에서 Ctrl+C
"""
import csv, datetime as dt, io, json, math, os, sys, threading, time, uuid, webbrowser
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import marine_collector as mc  # noqa: E402

PORT = 8765
WORKERS = 6
DL_DIR = os.path.join(mc.DATA, "download")
TYPES = {"B": "해양기상부이", "C": "파고부이", "L": "등표", "N": "조위관측소", "F": "연안방재관측", "J": "기상1호"}


def load_key():
    k = os.environ.get("KMA_API_KEY", "")
    kf = os.path.join(HERE, "kma_key.txt")
    if not k and os.path.exists(kf):
        with open(kf, encoding="utf-8-sig") as f:
            k = f.read().strip()
    if not k:
        sys.exit("인증키가 없습니다. 이 폴더에 kma_key.txt(키 한 줄)를 만들어 주세요.")
    return k


KEY = None


def fnum(v):
    try:
        x = float(v)
        return None if math.isnan(x) else x
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- 최신 관측
_now_cache = {"at": 0, "data": None}
_now_lock = threading.Lock()


def latest():
    """가장 최근 시각의 전 지점 관측. 5분 동안은 같은 결과를 재사용."""
    with _now_lock:
        if _now_cache["data"] and time.time() - _now_cache["at"] < 300:
            return _now_cache["data"]
        base = dt.datetime.now().replace(minute=0, second=0, microsecond=0)
        rows, used = [], None
        for back in range(0, 4):  # 정시 자료가 아직 덜 들어왔으면 한 시간씩 앞으로
            t = base - dt.timedelta(hours=back)
            _, rs = mc.parse_typ01(mc.seaobs_text(t, KEY), mc.COLS["sea_obs"])
            if len(rs) > len(rows) * 1.1:   # 직전 시각보다 지점이 확실히 많으면 그 시각을 씀
                rows, used = rs, t
            if back >= 1 and len(rs) <= len(rows):
                break
        out = []
        for r in rows:
            lat, lon = fnum(r.get("LAT")), fnum(r.get("LON"))
            if lat is None or lon is None:
                continue
            out.append({"tp": r.get("TP", ""), "stn": r.get("STN_ID", ""), "name": r.get("STN_KO", ""),
                        "tm": r.get("TM", ""), "lat": lat, "lon": lon,
                        "wh": fnum(r.get("WH")), "wd": fnum(r.get("WD")), "ws": fnum(r.get("WS")),
                        "gst": fnum(r.get("WS_GST")), "tw": fnum(r.get("TW")), "ta": fnum(r.get("TA")),
                        "pa": fnum(r.get("PA")), "hm": fnum(r.get("HM"))})
        data = {"base": used.strftime("%Y-%m-%d %H:00") if used else "", "stations": out,
                "fetched": dt.datetime.now().strftime("%H:%M")}
        _now_cache.update(at=time.time(), data=data)
        return data


# ---------------------------------------------------------------- 시계열
def _norm_buoy(r):
    return {"tm": r.get("TM", ""), "ws": fnum(r.get("WS1")), "gst": fnum(r.get("WS1_GST")),
            "wd": fnum(r.get("WD1")), "wh": fnum(r.get("WH_SIG")), "whmax": fnum(r.get("WH_MAX")),
            "wp": fnum(r.get("WP")), "tw": fnum(r.get("TW")), "ta": fnum(r.get("TA")), "pa": fnum(r.get("PA"))}


def _norm_sea(r):
    return {"tm": r.get("TM", ""), "ws": fnum(r.get("WS")), "gst": fnum(r.get("WS_GST")),
            "wd": fnum(r.get("WD")), "wh": fnum(r.get("WH")), "tw": fnum(r.get("TW")),
            "ta": fnum(r.get("TA")), "pa": fnum(r.get("PA"))}


def series(stn, tp, hours):
    d2 = dt.datetime.now().replace(second=0, microsecond=0)
    d1 = d2 - dt.timedelta(hours=hours)
    if tp == "B":  # 해양기상부이는 기간조회 한 번 (30분 간격)
        t = mc.get(mc.EP["buoy2"], {"tm1": mc.tm(d1), "tm2": mc.tm(d2), "stn": stn, "help": 1}, KEY)
        mc.check_error(t)
        _, rows = mc.parse_typ01(t, mc.COLS["buoy"])
        rows = [_norm_buoy(r) for r in rows if mc.stn_of(r) in ("", str(stn))]
    else:          # 그 외는 시각마다 종합관측 (cache 재사용)
        rows = []
        for _, rs in mc.seaobs_rows(mc.hour_list(d1, d2), KEY, WORKERS):
            rows += [_norm_sea(r) for r in rs if mc.stn_of(r) == str(stn)]
    rows.sort(key=lambda r: r["tm"])
    return rows


# ---------------------------------------------------------------- 다운로드 작업
JOBS = {}


def safe(s):
    return "".join(c for c in str(s) if c not in '\\/:*?"<>|').strip() or "x"


def run_job(jid, stn, tp, name, d1, d2):
    job = JOBS[jid]
    try:
        rows = []
        if tp == "B":
            sp = list(mc.spans(d1, d2, days=7))
            job["total"] = len(sp)
            for i, (s, e) in enumerate(sp, 1):
                t = mc.get(mc.EP["buoy2"], {"tm1": mc.tm(s), "tm2": mc.tm(e), "stn": stn, "help": 1}, KEY)
                mc.check_error(t)
                _, rs = mc.parse_typ01(t, mc.COLS["buoy"])
                rows += [r for r in rs if mc.stn_of(r) in ("", str(stn))]
                job["done"] = i
        else:
            hrs = mc.hour_list(d1, d2)
            job["total"] = len(hrs)

            def prog(d, n):
                job["done"] = d
            for _, rs in mc.seaobs_rows(hrs, KEY, WORKERS, prog):
                rows += [r for r in rs if mc.stn_of(r) == str(stn)]
        os.makedirs(DL_DIR, exist_ok=True)
        fn = f"{safe(name)}_{stn}_{d1:%Y%m%d}-{d2:%Y%m%d}.csv"
        path = os.path.join(DL_DIR, fn)
        cols = []
        for r in rows:
            cols += [c for c in r if c not in cols]
        rows.sort(key=lambda r: r.get("TM", ""))
        with open(path, "w", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols or ["TM"], extrasaction="ignore")
            w.writeheader()
            w.writerows(rows)
        job.update(status="done", file=fn, rows=len(rows))
    except Exception as e:  # noqa: BLE001
        job.update(status="error", error=str(e))


def start_job(q):
    stn, tp, name = q["stn"], q["tp"], q.get("name", q["stn"])
    d1 = dt.datetime.strptime(q["from"], "%Y-%m-%d")
    d2 = min(dt.datetime.strptime(q["to"], "%Y-%m-%d").replace(hour=23, minute=59),
             dt.datetime.now().replace(second=0, microsecond=0))
    if d2 < d1:
        raise ValueError("끝 날짜가 시작 날짜보다 앞입니다")
    jid = uuid.uuid4().hex[:8]
    JOBS[jid] = {"status": "running", "done": 0, "total": 0, "stn": stn, "name": name,
                 "from": q["from"], "to": q["to"], "started": time.time()}
    threading.Thread(target=run_job, args=(jid, stn, tp, name, d1, d2), daemon=True).start()
    return jid


# ---------------------------------------------------------------- 웹 서버
class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        b = body if isinstance(body, bytes) else body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def js(self, obj, code=200):
        self.send(code, json.dumps(obj, ensure_ascii=False))

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = {k: v[0] for k, v in urllib.parse.parse_qs(u.query).items()}
        try:
            if u.path == "/":
                return self.send(200, PAGE, "text/html; charset=utf-8")
            if u.path == "/api/now":
                return self.js(latest())
            if u.path == "/api/series":
                return self.js({"rows": series(q["stn"], q.get("tp", ""), min(int(q.get("hours", 24)), 24 * 14))})
            if u.path == "/api/job/start":
                return self.js({"id": start_job(q)})
            if u.path == "/api/job":
                j = JOBS.get(q.get("id", ""))
                return self.js(j or {"status": "missing"})
            if u.path == "/api/file":
                fn = os.path.basename(q.get("name", ""))
                path = os.path.join(DL_DIR, fn)
                if not fn or not os.path.exists(path):
                    return self.js({"error": "파일 없음"}, 404)
                with open(path, "rb") as f:
                    b = f.read()
                cd = "attachment; filename*=UTF-8''" + urllib.parse.quote(fn)
                return self.send(200, b, "text/csv; charset=utf-8", {"Content-Disposition": cd})
            return self.js({"error": "없는 주소"}, 404)
        except Exception as e:  # noqa: BLE001
            return self.js({"error": str(e)}, 500)


PAGE = r"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>해양기상 실시간 관측</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2433;--sub:#667085;--line:#e4e7ec;--acc:#1f6feb}
*{box-sizing:border-box}body{margin:0;font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif;color:var(--ink);background:var(--bg)}
header{height:52px;display:flex;align-items:center;gap:14px;padding:0 16px;background:#0f2742;color:#fff}
header h1{font-size:16px;margin:0;font-weight:700}header .meta{font-size:12px;opacity:.8}
header .sp{flex:1}header button{background:#ffffff1a;color:#fff;border:1px solid #ffffff40;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
main{display:flex;height:calc(100vh - 52px)}#map{flex:1}
aside{width:420px;background:var(--card);border-left:1px solid var(--line);overflow:auto;padding:14px 16px}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.chip{display:flex;align-items:center;gap:5px;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:3px 9px;cursor:pointer;user-select:none}
.chip input{margin:0}.dot{width:10px;height:10px;border-radius:50%}
h2{font-size:17px;margin:4px 0 2px}.sub{color:var(--sub);font-size:12px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}
.kv{background:var(--bg);border-radius:8px;padding:8px}.kv b{display:block;font-size:17px}.kv span{font-size:11px;color:var(--sub)}
.tabs{display:flex;gap:4px;margin:8px 0}.tabs button,.btn{border:1px solid var(--line);background:#fff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:12px}
.tabs button.on{background:var(--acc);color:#fff;border-color:var(--acc)}
.btn.pri{background:var(--acc);color:#fff;border-color:var(--acc)}
canvas{width:100%!important}
.box{border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:14px}
.box h3{margin:0 0 8px;font-size:14px}
.preset{display:block;width:100%;text-align:left;border:1px solid var(--line);background:#fff;border-radius:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer}
.preset.on{border-color:var(--acc);background:#eef4ff}.preset b{font-size:13px}.preset small{display:block;color:var(--sub);font-size:11px;margin-top:2px}
.tag{font-size:10px;background:#e7f6ec;color:#16794a;border-radius:4px;padding:1px 5px;margin-left:4px}
.row{display:flex;gap:6px;align-items:center;margin:6px 0}.row input{flex:1;padding:5px;border:1px solid var(--line);border-radius:6px}
.est{font-size:12px;color:var(--sub);margin:6px 0}.bar{height:8px;background:var(--line);border-radius:4px;overflow:hidden}.bar i{display:block;height:100%;background:var(--acc);width:0}
.empty{color:var(--sub);font-size:13px;line-height:1.6;margin-top:30px}
.wlab{font:600 11px system-ui;color:#111;text-shadow:0 0 3px #fff,0 0 3px #fff;white-space:nowrap}
.legend{background:#fff;padding:8px 10px;border-radius:8px;font-size:12px;line-height:1.7;box-shadow:0 1px 4px #0002}
.err{color:#b42318;font-size:12px}
</style></head><body>
<header><h1>해양기상 실시간 관측</h1><span class="meta" id="meta">불러오는 중…</span><span class="sp"></span>
<button onclick="map.setView([35.16,129.2],10)">기장·청사포 주변</button><button onclick="map.setView([36,127.8],7)">전국</button>
<button onclick="refresh(true)">새로고침</button></header>
<main><div id="map"></div><aside>
<div class="filters" id="filters"></div>
<div id="panel"><div class="empty">지도에서 관측 지점을 누르면 최신값과 최근 변화 그래프가 나오고, 원하는 기간의 자료를 내려받을 수 있습니다.<br><br>
· 화살표: 바람이 불어가는 방향, 숫자: 풍속(m/s)<br>· 동그라미: 바람 관측이 없는 지점(파고부이 등), 숫자: 유의파고(m)<br>· 자료는 10분마다 자동으로 새로 불러옵니다.</div></div>
</aside></main>
<script>
const TYPES={B:["해양기상부이","#1f6feb"],C:["파고부이","#0e9384"],L:["등표","#c4320a"],N:["조위관측소","#6941c6"],F:["연안방재관측","#b54708"],J:["기상1호","#475467"]};
const show={B:true,C:true,L:true,N:false,F:false,J:true};
const map=L.map('map',{zoomControl:true}).setView([35.16,129.2],9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
L.circle([35.16,129.2],{radius:60000,color:'#1f6feb',weight:1,dashArray:'4 4',fill:false}).addTo(map).bindTooltip('청사포 기준 60km');
const layer=L.layerGroup().addTo(map);let DATA=null,SEL=null,chart=null,hours=24;
const f=(v,d=1)=>v==null?'–':v.toFixed(d);
const tmfmt=s=>s?`${s.slice(4,6)}/${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}`:'';
function filters(){document.getElementById('filters').innerHTML=Object.entries(TYPES).map(([k,[n,c]])=>
 `<label class="chip"><input type="checkbox" ${show[k]?'checked':''} onchange="show['${k}']=this.checked;draw()"><span class="dot" style="background:${c}"></span>${n}</label>`).join('');}
function icon(s){const c=TYPES[s.tp]?.[1]||'#333';
 if(s.ws!=null&&s.wd!=null){const r=(s.wd+180)%360;
  return L.divIcon({className:'',iconSize:[60,36],iconAnchor:[13,18],html:`<div style="display:flex;align-items:center;gap:2px">
  <svg width="26" height="26" viewBox="-13 -13 26 26" style="transform:rotate(${r}deg)"><circle r="11" fill="#fff" stroke="${c}" stroke-width="2"/><path d="M0,-8 L5,4 L0,1 L-5,4Z" fill="${c}"/></svg>
  <span class="wlab">${f(s.ws)}</span></div>`});}
 return L.divIcon({className:'',iconSize:[60,24],iconAnchor:[8,8],html:`<div style="display:flex;align-items:center;gap:2px">
  <svg width="16" height="16"><circle cx="8" cy="8" r="6" fill="${c}" stroke="#fff" stroke-width="2"/></svg><span class="wlab">${s.wh!=null?f(s.wh)+'m':''}</span></div>`});}
function draw(){layer.clearLayers();if(!DATA)return;
 for(const s of DATA.stations){if(!show[s.tp])continue;
  L.marker([s.lat,s.lon],{icon:icon(s)}).addTo(layer).on('click',()=>select(s))
   .bindTooltip(`${s.name} (${TYPES[s.tp]?.[0]||s.tp} ${s.stn})`);}}
async function refresh(force){try{const r=await fetch('/api/now');const j=await r.json();if(j.error)throw j.error;DATA=j;
 document.getElementById('meta').textContent=`관측 ${j.base} 기준 · ${j.stations.length}개 지점 · ${j.fetched} 갱신`;draw();
 if(SEL){const n=DATA.stations.find(x=>x.stn==SEL.stn&&x.tp==SEL.tp);if(n){SEL=n;head();}}}
 catch(e){document.getElementById('meta').textContent='불러오기 실패: '+e;}}
function head(){const s=SEL;document.getElementById('head').innerHTML=`<h2>${s.name} <span class="sub">${TYPES[s.tp]?.[0]||s.tp} · ${s.stn}</span></h2>
 <div class="sub">${s.lat.toFixed(4)}, ${s.lon.toFixed(4)} · 관측 ${tmfmt(s.tm)}</div>
 <div class="grid"><div class="kv"><span>풍속 / 돌풍 (m/s)</span><b>${f(s.ws)} / ${f(s.gst)}</b></div><div class="kv"><span>풍향 (°)</span><b>${f(s.wd,0)}</b></div>
 <div class="kv"><span>유의파고 (m)</span><b>${f(s.wh)}</b></div><div class="kv"><span>수온 (℃)</span><b>${f(s.tw)}</b></div>
 <div class="kv"><span>기온 (℃)</span><b>${f(s.ta)}</b></div><div class="kv"><span>기압 (hPa)</span><b>${f(s.pa)}</b></div></div>`;}
function select(s){SEL=s;document.getElementById('panel').innerHTML=`<div id="head"></div>
 <div class="tabs">${[24,72,168].map(h=>`<button data-h="${h}" onclick="hours=${h};loadSeries()">${h/24}일</button>`).join('')}<span class="sub" id="sst" style="margin-left:6px"></span></div>
 <canvas id="ch" height="230"></canvas>${dlBox()}`;head();loadSeries();preset(2);}
async function loadSeries(){document.querySelectorAll('.tabs button').forEach(b=>b.classList.toggle('on',+b.dataset.h==hours));
 const st=document.getElementById('sst');st.textContent=SEL.tp=='B'?'불러오는 중…':'불러오는 중… (처음 보는 기간은 시간이 걸립니다)';
 try{const r=await fetch(`/api/series?stn=${SEL.stn}&tp=${SEL.tp}&hours=${hours}`);const j=await r.json();if(j.error)throw j.error;st.textContent=`${j.rows.length}개 관측`;plot(j.rows);}
 catch(e){st.innerHTML=`<span class="err">실패: ${e}</span>`;}}
function plot(rows){const lab=rows.map(r=>tmfmt(r.tm)),ds=[],has=k=>rows.some(r=>r[k]!=null);
 const add=(k,n,c,ax,dash)=>{if(has(k))ds.push({label:n,data:rows.map(r=>r[k]),borderColor:c,backgroundColor:c,yAxisID:ax,borderWidth:1.6,pointRadius:0,spanGaps:true,borderDash:dash||[]});};
 add('ws','풍속','#1f6feb','y');add('gst','돌풍','#84adf5','y',[4,3]);add('wh','유의파고','#0e9384','y2');add('tw','수온','#c4320a','y3');add('ta','기온','#f79009','y3',[4,3]);
 if(chart)chart.destroy();chart=new Chart(document.getElementById('ch'),{type:'line',data:{labels:lab,datasets:ds},
 options:{animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{labels:{boxWidth:12,font:{size:11}}}},
 scales:{x:{ticks:{maxTicksLimit:7,font:{size:10}}},y:{position:'left',title:{display:true,text:'m/s'},display:has('ws')},
 y2:{position:'right',title:{display:true,text:'파고 m'},grid:{drawOnChartArea:false},display:has('wh')},
 y3:{position:'right',title:{display:true,text:'℃'},grid:{drawOnChartArea:false},display:has('tw')||has('ta')}}}});}
const PRESETS=[
 {d:30,n:'최근 1개월',t:'',m:'자료 상태 확인, 최근 공사·작업 기간 해황 확인'},
 {d:365,n:'최근 1년',t:'풍황 최소',m:'사계절이 한 번씩 들어가는 최소 기간 — 풍황 1차 검토'},
 {d:365*5,n:'최근 5년',t:'추천',m:'해마다 다른 바람 세기(연변동)를 반영 — 발전량 검토용으로 권장'},
 {d:365*10,n:'최근 10년',t:'장기·극치',m:'장기 보정, 설계파고 같은 극치 분석용. 관측 시작이 늦은 지점은 그 이후만 나옴'}];
function dlBox(){return `<div class="box"><h3>자료 내려받기</h3>${PRESETS.map((p,i)=>`<button class="preset" data-i="${i}" onclick="preset(${i})"><b>${p.n}</b>${p.t?`<span class="tag">${p.t}</span>`:''}<small>${p.m}</small></button>`).join('')}
 <div class="row"><input type="date" id="d1" onchange="est()"> ~ <input type="date" id="d2" onchange="est()"></div>
 <div class="est" id="est"></div><button class="btn pri" onclick="dl()">CSV 내려받기</button>
 <div id="job" style="margin-top:8px"></div></div>`;}
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function preset(i){const p=PRESETS[i],t=new Date(),s=new Date(t-p.d*864e5);document.getElementById('d1').value=iso(s);document.getElementById('d2').value=iso(t);
 document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('on',+b.dataset.i==i));est();}
function est(){const a=new Date(document.getElementById('d1').value),b=new Date(document.getElementById('d2').value),days=Math.max(1,(b-a)/864e5+1);let calls,sec,note;
 if(SEL.tp=='B'){calls=Math.ceil(days/7);sec=calls*1.5;note='해양기상부이는 기간조회로 7일씩 받아서 빠릅니다.';}
 else{calls=Math.round(days*24);sec=calls*1.2/6;note='이 지점은 1시간마다 1번 조회합니다. 한 번 받은 시각은 저장해 두어 다른 지점을 받을 때는 바로 나옵니다.';}
 const tt=sec<90?`${Math.max(1,Math.round(sec))}초`:sec<5400?`${Math.round(sec/60)}분`:`${(sec/3600).toFixed(1)}시간`;
 document.getElementById('est').innerHTML=`${Math.round(days)}일 · 호출 약 ${calls.toLocaleString()}번 · 예상 약 ${tt}<br>${note}`;}
async function dl(){const a=document.getElementById('d1').value,b=document.getElementById('d2').value,box=document.getElementById('job');
 const r=await fetch(`/api/job/start?stn=${SEL.stn}&tp=${SEL.tp}&name=${encodeURIComponent(SEL.name)}&from=${a}&to=${b}`);const j=await r.json();
 if(j.error){box.innerHTML=`<span class="err">${j.error}</span>`;return;}poll(j.id,box);}
async function poll(id,box){const j=await (await fetch('/api/job?id='+id)).json();
 if(j.status=='running'){const p=j.total?Math.floor(j.done*100/j.total):0,el=(Date.now()/1000-j.started),rem=j.done?el*(j.total-j.done)/j.done:0;
  box.innerHTML=`<div class="sub">${j.name} ${j.from}~${j.to} 받는 중 ${p}% (${j.done}/${j.total})${rem>5?` · 남은 시간 약 ${rem<120?Math.round(rem)+'초':Math.round(rem/60)+'분'}`:''}</div><div class="bar"><i style="width:${p}%"></i></div><div class="sub">창을 닫아도 계속 받습니다. 결과는 data\\download 폴더에 저장됩니다.</div>`;setTimeout(()=>poll(id,box),1500);}
 else if(j.status=='done'){box.innerHTML=`<div class="sub">완료: ${j.rows.toLocaleString()}행 · <a href="/api/file?name=${encodeURIComponent(j.file)}">${j.file}</a></div>`;location.href='/api/file?name='+encodeURIComponent(j.file);}
 else box.innerHTML=`<span class="err">실패: ${j.error||j.status}</span>`;}
const lg=L.control({position:'bottomleft'});lg.onAdd=()=>{const d=L.DomUtil.create('div','legend');
 d.innerHTML=Object.values(TYPES).map(([n,c])=>`<span class="dot" style="display:inline-block;background:${c}"></span> ${n}`).join('<br>')+'<br><span class="sub">화살표: 바람이 불어가는 방향</span>';return d;};lg.addTo(map);
filters();refresh();setInterval(refresh,600000);
</script></body></html>"""


def main():
    global KEY
    KEY = load_key()
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), H)
    url = f"http://localhost:{PORT}"
    print(f"해양기상 대시보드 실행 중 → {url}\n(끄려면 이 창에서 Ctrl+C)")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("종료")


if __name__ == "__main__":
    main()
