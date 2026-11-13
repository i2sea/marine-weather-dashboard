"""GitHub Pages용 정적 사이트 생성기 — GitHub Actions가 매시간 실행합니다.

python collector/build_site.py --days 30 --out site
  1) 최근 N일의 해양기상종합관측(sea_obs)을 시간마다 받음 (이미 받은 시각은 collector/cache 재사용)
  2) site/data/latest.json      : 지점별 최신 관측값 (지도 표시용)
     site/data/series/<지점>.json : 지점별 최근 N일 시간자료 (그래프·CSV 다운로드용)
  3) 국립해양조사원 조류예보 → site/data/currents.json, site/data/currents/<코드>.json (collector/currents.py)
  4) web/index.html 을 site/ 로 복사
인증키: 환경변수 KMA_API_KEY (GitHub Secrets) 또는 collector/kma_key.txt
"""
import argparse, datetime as dt, glob, json, os, shutil, sys
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import marine_collector as mc  # noqa: E402

FIELDS = {"WH": "wh", "WD": "wd", "WS": "ws", "WS_GST": "gst", "TW": "tw", "TA": "ta", "PA": "pa", "HM": "hm"}


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_key():
    k = os.environ.get("KMA_API_KEY", "").strip()
    kf = os.path.join(HERE, "kma_key.txt")
    if not k and os.path.exists(kf):
        with open(kf, encoding="utf-8-sig") as f:
            k = f.read().strip()
    if not k:
        sys.exit("인증키가 없습니다. GitHub 저장소 Settings → Secrets and variables → Actions 에 KMA_API_KEY 를 등록하세요.")
    return k


def fetch_all(hours, key, workers):
    """시각별 응답. 실패한 시각은 건너뛰고 개수만 셈 (자료가 아직 안 올라온 최신 시각 등)."""
    def one(t):
        try:
            return t, mc.seaobs_text(t, key), None
        except Exception as e:  # noqa: BLE001
            return t, None, str(e)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        res = list(ex.map(one, hours))
    fails = [(t, e) for t, x, e in res if x is None]
    return [(t, x) for t, x, e in res if x is not None], fails


def _first_height(v):
    """'4.4/3.9' → 4.4, '17.5' → 17.5, '0'·'null'·'' → None"""
    import re
    m = re.search(r"\d+(?:\.\d+)?", str(v or ""))
    x = float(m.group()) if m else 0.0
    return x if x > 0 else None


def station_heights(key):
    """지점일람표(부이·등표)의 풍속계 높이. 일주일에 한 번만 새로 받고 나머지는 cache 재사용. 실패해도 사이트는 만듦."""
    cf = os.path.join(mc.CACHE, "stn_heights.json")
    old = {}
    if os.path.exists(cf):
        with open(cf, encoding="utf-8") as f:
            old = json.load(f)
        if dt.datetime.now().timestamp() - os.path.getmtime(cf) < 7 * 86400:
            return old
    out = dict(old)
    ref = dt.date.today().replace(day=1)
    for op in ("getBuoyLstTbl", "getLhawsLstTbl"):
        for back in range(1, 13):
            d = (ref - dt.timedelta(days=31 * back)).replace(day=1)
            try:
                rows = mc.items_typ02(mc.get(mc.EP["mtly"] + op, {"pageNo": 1, "numOfRows": 999, "dataType": "JSON",
                                                                   "year": d.year, "month": f"{d.month:02d}"}, key))
            except Exception as e:  # noqa: BLE001
                print(f"  지점일람표 {op} {d:%Y-%m}: {e}")
                rows = []
            if rows:
                for r in rows:
                    sid = str(r.get("stn_id", "")).strip()
                    if sid:
                        out[sid] = {"zh": _first_height(r.get("ht_wd")), "zh_raw": str(r.get("ht_wd") or "")}
                break
    os.makedirs(mc.CACHE, exist_ok=True)
    with open(cf, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    return out


def prune_cache(days):
    lim = (dt.datetime.now() - dt.timedelta(days=days + 2)).strftime("%Y%m%d%H%M")
    for f in glob.glob(os.path.join(mc.CACHE, "seaobs_2*.txt")):
        if os.path.basename(f)[7:19] < lim:
            os.remove(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=30)
    ap.add_argument("--out", default=os.path.join(ROOT, "site"))
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args()
    key = load_key()

    now = dt.datetime.now()
    hours = mc.hour_list(now - dt.timedelta(days=a.days), now)
    got, fails = fetch_all(hours, key, a.workers)
    print(f"시각 {len(hours)}개 중 {len(got)}개 받음, 실패 {len(fails)}개")
    if not got:
        sys.exit("자료를 하나도 받지 못했습니다: " + (fails[0][1] if fails else ""))
    if len(fails) > len(hours) * 0.2:
        print("실패가 많습니다(일부만 표시):", fails[:3])

    st = {}  # stn -> {"meta":..., "rows":{tm: {...}}}
    for t, txt in got:
        _, rows = mc.parse_typ01(txt, mc.COLS["sea_obs"])
        for r in rows:
            s = mc.stn_of(r)
            if not s or not r.get("TM"):
                continue
            d = st.setdefault(s, {"meta": {}, "rows": {}})
            lat, lon = num(r.get("LAT")), num(r.get("LON"))
            if lat is not None and lon is not None:
                d["meta"] = {"stn": s, "tp": r.get("TP", ""), "name": r.get("STN_KO", ""), "lat": lat, "lon": lon}
            d["rows"][r["TM"]] = {k: num(r.get(c)) for c, k in FIELDS.items()}

    heights = station_heights(key)
    for s_, d in st.items():
        h = heights.get(s_)
        if d["meta"] and h:
            d["meta"].update(h)
    # 일람표에 높이가 0·미등록인 부이·등표는 같은 종류 지점들의 중앙값으로 추정 (zh_est 표시)
    import statistics
    for tp in ("B", "L"):
        known = [d["meta"]["zh"] for d in st.values() if d["meta"].get("tp") == tp and d["meta"].get("zh")]
        if not known:
            continue
        med = round(statistics.median(known), 1)
        for d in st.values():
            m = d["meta"]
            if m.get("tp") == tp and not m.get("zh"):
                m.update(zh=med, zh_est=True)

    out_data = os.path.join(a.out, "data")
    ser_dir = os.path.join(out_data, "series")
    if os.path.exists(a.out):
        shutil.rmtree(a.out)
    os.makedirs(ser_dir)
    latest = []
    for s, d in st.items():
        if not d["meta"]:
            continue
        tms = sorted(d["rows"])
        # 최신값: 값이 하나라도 있는 가장 최근 관측
        last_tm = next((tm for tm in reversed(tms) if any(v is not None for v in d["rows"][tm].values())), tms[-1])
        latest.append({**d["meta"], "tm": last_tm, **d["rows"][last_tm]})
        keys = [k for k in FIELDS.values() if any(d["rows"][tm][k] is not None for tm in tms)]
        ser = {"stn": s, **d["meta"], "tm": tms, **{k: [d["rows"][tm][k] for tm in tms] for k in keys}}
        with open(os.path.join(ser_dir, f"{s}.json"), "w", encoding="utf-8") as f:
            json.dump(ser, f, ensure_ascii=False, separators=(",", ":"))
    base = max(x["tm"] for x in latest)
    with open(os.path.join(out_data, "latest.json"), "w", encoding="utf-8") as f:
        json.dump({"base": base, "built": now.strftime("%Y-%m-%d %H:%M"), "days": a.days,
                   "stations": latest}, f, ensure_ascii=False, separators=(",", ":"))
    try:  # 기상청 종관기상관측(ASOS) 지점·최신 관측
        import asos
        asos.build(out_data, key)
    except Exception as e:  # noqa: BLE001
        print("ASOS 단계 건너뜀:", e)
    try:  # 국립해양조사원 조류예보 (공공데이터포털 키가 있을 때만 새로 받음, 실패해도 사이트는 만듦)
        import currents
        currents.build(out_data)
    except Exception as e:  # noqa: BLE001
        print("조류예보 단계 건너뜀:", e)
    try:  # 국립해양조사원 조위(최극조위·해일 편차) — 설계조위 산정용
        import tides
        tides.build(out_data)
    except Exception as e:  # noqa: BLE001
        print("조위 단계 건너뜀:", e)
    import hashlib, re
    web = os.path.join(ROOT, "web")
    for fn in os.listdir(web):  # index.html, analysis.js 등 화면 파일
        if fn.endswith((".js", ".css")):
            shutil.copy(os.path.join(web, fn), os.path.join(a.out, fn))
    if os.path.isdir(os.path.join(web, "deepwave")):  # 심해설계파 자료표(해양수산부 보고서에서 추출)
        shutil.copytree(os.path.join(web, "deepwave"), os.path.join(a.out, "deepwave"), dirs_exist_ok=True)
    # 브라우저가 옛 js를 캐시에서 쓰지 않도록, 파일 내용이 바뀌면 주소 뒤 ?v= 값이 바뀌게 함
    ver = lambda fn: hashlib.md5(open(os.path.join(web, fn), "rb").read()).hexdigest()[:8]
    for fn in os.listdir(web):
        if fn.endswith(".html"):
            h = open(os.path.join(web, fn), encoding="utf-8").read()
            h = re.sub(r'(src|href)="([\w.-]+\.(?:js|css))"',
                       lambda m: f'{m.group(1)}="{m.group(2)}?v={ver(m.group(2))}"' if os.path.exists(os.path.join(web, m.group(2))) else m.group(0), h)
            open(os.path.join(a.out, fn), "w", encoding="utf-8").write(h)
    prune_cache(a.days)
    print(f"지점 {len(latest)}개, 기준 {base} → {a.out}")


if __name__ == "__main__":
    main()
