"""국립해양조사원 조위관측소 극치 조위·해일 편차 수집 — build_site.py 가 불러 씁니다.

자료(공공데이터포털, 해양수산부 국립해양조사원):
  · 최극조위(조석성과)  https://apis.data.go.kr/1192136/extrmTideLvl/GetExtrmTideLvlApiService
      요청 obsCode, type=json, pageNo, numOfRows → 관측소의 월별 최고 고조·최저 저조(cm, 기본수준면 기준), 1960년대부터
  · 편차계산표(조석성과) https://apis.data.go.kr/1192136/deviationCal/GetDeviationCalApiService
      요청 obsCode, reqDate(YYYYMM) → 그 달 고·저조의 실측(obsTdlvVl)·예측(predcTdlvVl) 조위와 편차(tdlvOfs = 실측 − 예측, cm)
      extrKnd 1·3 = 고조, 2·4 = 저조
만드는 것: site/data/tides.json — 관측소별 연최고 고조위, 연최대 해일 편차(고조 기준), 연 예측 최고 고조·최저 저조
  · 지난 달 자료는 바뀌지 않으므로 한 번 받은 달은 캐시(collector/cache/tides)에서 재사용
  · 개발계정 하루 10,000회 한도를 넘지 않도록 한 번 실행에 BUDGET 회까지만 새로 받음 (매시간 실행되며 며칠에 걸쳐 채워짐)
인증키: 환경변수 DATA_GO_KR_KEY (GitHub Secrets) 또는 collector/datagokr_key.txt
"""
import datetime as dt, json, os, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "tides")
B = "https://apis.data.go.kr/1192136/"
EXT = B + "extrmTideLvl/GetExtrmTideLvlApiService"
DEV = B + "deviationCal/GetDeviationCalApiService"
BUDGET = 280          # 한 번 실행에 새로 부르는 편차계산표 요청 수
Y0 = 2001             # 해일 편차는 이 해부터 (25년 내외)


def load_key():
    k = os.environ.get("DATA_GO_KR_KEY", "").strip()
    f = os.path.join(HERE, "datagokr_key.txt")
    if not k and os.path.exists(f):
        k = open(f, encoding="utf-8").read().strip()
    return urllib.parse.unquote(k) if "%" in k else k


def call(url, key, **p):
    q = urllib.parse.urlencode({"serviceKey": key, "type": "json", **p})
    last = None
    for k in range(3):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=30) as r:
                t = r.read().decode("utf-8", "replace")
            s = t.lstrip()
            if s.startswith("<"):
                import re
                m = re.search(r"<(returnAuthMsg|errMsg|resultMsg)>([^<]+)<", s)
                raise RuntimeError(m.group(2) if m else s[:120])
            j = json.loads(t)
            h = j.get("header") or (j.get("response") or {}).get("header") or {}
            if str(h.get("resultCode", "00")) not in ("00", "03"):
                raise RuntimeError(f"{h.get('resultCode')} {h.get('resultMsg')}")
            b = j.get("body") or (j.get("response") or {}).get("body") or {}
            it = (b.get("items") or {}) if isinstance(b.get("items"), dict) else {}
            it = it.get("item") or []
            if isinstance(it, dict):
                it = [it]
            return it, int(b.get("totalCount") or 0)
        except RuntimeError:
            raise
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1))
    raise RuntimeError(f"연결 실패: {last}")


def f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def jload(p, d=None):
    try:
        return json.load(open(p, encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return d


def jsave(p, o):
    json.dump(o, open(p, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def age_days(p):
    return (time.time() - os.path.getmtime(p)) / 86400 if os.path.exists(p) else 1e9


def discover(key):
    """조위관측소 코드 찾기: DT_0001 ~ DT_0099 를 최극조위로 한 번씩 물어 응답이 있는 곳만 (90일마다)"""
    p = os.path.join(CACHE, "stations.json")
    st = jload(p)
    if st and age_days(p) < 90:
        return st
    def one(c):
        try:
            it, n = call(EXT, key, obsCode=c, pageNo=1, numOfRows=1)
            if it and n:
                x = it[0]
                return {"code": c, "name": x.get("obsvtrNm"), "lat": f(x.get("lat")), "lon": f(x.get("lot"))}
        except Exception:  # noqa: BLE001
            return None
    with ThreadPoolExecutor(6) as ex:
        res = [r for r in ex.map(one, [f"DT_{i:04d}" for i in range(1, 100)]) if r and r["lat"]]
    if res:
        jsave(p, res)
        return res
    return st or []


def extremes(key, code):
    """최극조위 월별 자료 전체 → 연최고 고조위 (30일마다 다시 받음)"""
    p = os.path.join(CACHE, f"ext_{code}.json")
    o = jload(p)
    if o is not None and age_days(p) < 30:
        return o
    items, n = call(EXT, key, obsCode=code, pageNo=1, numOfRows=1000)
    pg = 1
    while len(items) < n and pg < 5:
        pg += 1
        more, _ = call(EXT, key, obsCode=code, pageNo=pg, numOfRows=1000)
        if not more:
            break
        items += more
    yr = {}
    for x in items:
        ym = str(x.get("obsrvnYm") or "")
        if len(ym) < 6:
            continue
        y = int(ym[:4])
        r = yr.setdefault(y, {"hw": None, "hwt": None, "m": 0, "lw": None})
        hw, lw = f(x.get("hiwlv")), f(x.get("lowlv"))
        if hw is not None:
            r["m"] += 1
            if r["hw"] is None or hw > r["hw"]:
                r["hw"], r["hwt"] = hw, x.get("hwDt")
        if lw is not None and (r["lw"] is None or lw < r["lw"]):
            r["lw"] = lw
    o = [[y, v["hw"], v["m"], v["hwt"], v["lw"]] for y, v in sorted(yr.items())]
    jsave(p, o)
    return o


def month_summary(items):
    hi = [x for x in items if str(x.get("extrKnd")) in ("1", "3")]
    lo = [x for x in items if str(x.get("extrKnd")) in ("2", "4")]
    sg = [(f(x.get("tdlvOfs")), x.get("obsrvnDt")) for x in hi if f(x.get("tdlvOfs")) is not None and f(x.get("obsTdlvVl")) is not None]
    ph = [f(x.get("predcTdlvVl")) for x in hi if f(x.get("predcTdlvVl")) is not None]
    pl = [f(x.get("predcTdlvVl")) for x in lo if f(x.get("predcTdlvVl")) is not None]
    m = max(sg, key=lambda t: t[0]) if sg else (None, None)
    return {"n": len(items), "nh": len(sg), "sg": m[0], "sgt": m[1], "ph": max(ph) if ph else None, "pl": min(pl) if pl else None,
            "mh": round(sum(ph) / len(ph), 1) if ph else None, "ml": round(sum(pl) / len(pl), 1) if pl else None}


def build(out_data, budget=BUDGET):
    os.makedirs(CACHE, exist_ok=True)
    key = load_key()
    st = jload(os.path.join(CACHE, "stations.json"), [])
    if key:
        try:
            st = discover(key)
        except Exception as e:  # noqa: BLE001
            print("조위관측소 목록 실패:", e)
    if not st:
        print("조위: 관측소 목록 없음 → 건너뜀")
        return
    if key:  # 연최고 고조위 (관측소당 1~2회)
        with ThreadPoolExecutor(4) as ex:
            list(ex.map(lambda s: _safe(extremes, key, s["code"]), st))
    # 해일 편차: 최근 달부터 거꾸로, 관측소를 돌아가며 채움
    today = dt.date.today()
    last = (today.replace(day=1) - dt.timedelta(days=1))
    months = []
    y, m = last.year, last.month
    while y >= Y0:
        months.append(f"{y}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    todo = []
    for ym in months:
        for s in st:
            p = os.path.join(CACHE, f"dev_{s['code']}_{ym}.json")
            if not os.path.exists(p):
                todo.append((s["code"], ym, p))
    done = 0
    if key and todo:
        def one(t):
            c, ym, p = t
            try:
                items, n = call(DEV, key, obsCode=c, reqDate=ym, pageNo=1, numOfRows=300)
                jsave(p, month_summary(items))
                return 1
            except Exception as e:  # noqa: BLE001
                return str(e)
        with ThreadPoolExecutor(4) as ex:
            res = list(ex.map(one, todo[:budget]))
        done = sum(1 for r in res if r == 1)
        errs = [r for r in res if r != 1]
        if errs:
            print(f"편차계산표 실패 {len(errs)}건 (예: {errs[0]})")
    print(f"조위: 관측소 {len(st)}곳, 편차계산표 새로 {done}건, 남은 달 {max(0, len(todo) - done)}건")
    out = []
    for s in st:
        ext = jload(os.path.join(CACHE, f"ext_{s['code']}.json"), [])
        yr = {}
        for ym in months:
            d = jload(os.path.join(CACHE, f"dev_{s['code']}_{ym}.json"))
            if d is None:
                continue
            y = int(ym[:4])
            r = yr.setdefault(y, {"sg": None, "sgt": None, "m": 0, "mr": 0, "ph": None, "pl": None, "mh": [], "ml": []})
            r["mr"] += 1
            if d.get("nh"):
                r["m"] += 1
                if d["sg"] is not None and (r["sg"] is None or d["sg"] > r["sg"]):
                    r["sg"], r["sgt"] = d["sg"], d["sgt"]
            if d.get("ph") is not None and (r["ph"] is None or d["ph"] > r["ph"]):
                r["ph"] = d["ph"]
            if d.get("pl") is not None and (r["pl"] is None or d["pl"] < r["pl"]):
                r["pl"] = d["pl"]
            if d.get("mh") is not None:
                r["mh"].append(d["mh"])
            if d.get("ml") is not None:
                r["ml"].append(d["ml"])
        sg = [[y, v["sg"], v["m"], v["sgt"], v["ph"], v["pl"],
               round(sum(v["mh"]) / len(v["mh"]), 1) if v["mh"] else None, round(sum(v["ml"]) / len(v["ml"]), 1) if v["ml"] else None, v["mr"]]
              for y, v in sorted(yr.items())]
        out.append({**s, "hw": ext, "sg": sg})
    jsave(os.path.join(out_data, "tides.json"), {
        "built": dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "unit": "cm (기본수준면 기준)",
        "fields": {"hw": "[연도, 연최고 고조위, 자료 있는 달 수, 시각, 연최저 저조위]",
                   "sg": "[연도, 연최대 고조 편차(실측−예측), 자료 있는 달 수, 시각, 연 예측 최고 고조, 연 예측 최저 저조, 예측 고조 평균, 예측 저조 평균, 받은 달 수]"},
        "src": {"ext": "해양수산부 국립해양조사원_최극조위(조석성과), 공공데이터포털 15156013",
                "dev": "해양수산부 국립해양조사원_편차계산표(조석성과), 공공데이터포털 15156011"},
        "stations": out})


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception as e:  # noqa: BLE001
        print("조위 실패:", a[-1], e)
