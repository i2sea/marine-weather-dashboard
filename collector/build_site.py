"""GitHub Pages용 정적 사이트 생성기 — GitHub Actions가 매시간 실행합니다.

python collector/build_site.py --days 30 --out site
  1) 최근 N일의 해양기상종합관측(sea_obs)을 시간마다 받음 (이미 받은 시각은 collector/cache 재사용)
  2) site/data/latest.json      : 지점별 최신 관측값 (지도 표시용)
     site/data/series/<지점>.json : 지점별 최근 N일 시간자료 (그래프·CSV 다운로드용)
  3) web/index.html 을 site/ 로 복사
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


def prune_cache(days):
    lim = (dt.datetime.now() - dt.timedelta(days=days + 2)).strftime("%Y%m%d%H%M")
    for f in glob.glob(os.path.join(mc.CACHE, "seaobs_*.txt")):
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
    shutil.copy(os.path.join(ROOT, "web", "index.html"), os.path.join(a.out, "index.html"))
    prune_cache(a.days)
    print(f"지점 {len(latest)}개, 기준 {base} → {a.out}")


if __name__ == "__main__":
    main()
