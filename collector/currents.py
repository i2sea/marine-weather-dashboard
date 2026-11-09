"""국립해양조사원 조류예보(최강 창·낙조 및 전류) 수집 — build_site.py 가 불러 씁니다.

자료: 공공데이터포털 '해양수산부 국립해양조사원_조류예보 최강창낙조 및 전류'
  https://apis.data.go.kr/1192136/crntFcstFldEbb/GetCrntFcstFldEbbApiService
  요청: serviceKey, obsCode(예보지점), type=json, pageNo, numOfRows(최대 300)
  응답: obsvtrNm, lat, lot, predcDt('YYYY-MM-DD HH:MM'), crdir(유향 deg), crsp(유속 cm/s)
  1년치(조류표 수록분)를 한 번에 주고 매년 갱신되므로, 지점별로 30일에 한 번만 다시 받습니다.
인증키: 환경변수 DATA_GO_KR_KEY (GitHub Secrets) 또는 collector/datagokr_key.txt
"""
import datetime as dt, json, math, os, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "currents")
URL = "https://apis.data.go.kr/1192136/crntFcstFldEbb/GetCrntFcstFldEbbApiService"
REFRESH_DAYS = 30


def load_key():
    k = os.environ.get("DATA_GO_KR_KEY", "").strip()
    f = os.path.join(HERE, "datagokr_key.txt")
    if not k and os.path.exists(f):
        k = open(f, encoding="utf-8").read().strip()
    # 포털의 '인코딩 키'(%가 들어 있음)를 넣어도 되도록 한 번 풀어 둠 → urlencode 가 다시 인코딩
    return urllib.parse.unquote(k) if "%" in k else k


def stations():
    out = []
    for ln in open(os.path.join(HERE, "khoa_current_stations.txt"), encoding="utf-8"):
        ln = ln.strip()
        if ln and not ln.startswith("#"):
            c, _, n = ln.partition("\t")
            out.append((c.strip(), n.strip()))
    return out


def _find(o, key):
    """중첩 JSON에서 key 를 가진 값 찾기 (response/body 감싸기 유무와 무관하게)"""
    if isinstance(o, dict):
        if key in o:
            return o[key]
        for v in o.values():
            r = _find(v, key)
            if r is not None:
                return r
    elif isinstance(o, list):
        for v in o:
            r = _find(v, key)
            if r is not None:
                return r
    return None


def _items(o, out):
    if isinstance(o, dict):
        if "predcDt" in o:
            out.append(o)
        else:
            for v in o.values():
                _items(v, out)
    elif isinstance(o, list):
        for v in o:
            _items(v, out)
    return out


def fetch_page(key, code, page, rows=300):
    q = urllib.parse.urlencode({"serviceKey": key, "obsCode": code, "type": "json", "pageNo": page, "numOfRows": rows})
    last = None
    for k in range(2):
        try:
            with urllib.request.urlopen(f"{URL}?{q}", timeout=25) as r:
                t = r.read().decode("utf-8", "replace")
            break
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (k + 1))
    else:
        raise RuntimeError(f"연결 실패: {last}")
    s = t.lstrip()
    if s.startswith("<"):  # 포털 게이트웨이 오류는 json 을 요청해도 XML 로 옴
        import re
        m = re.search(r"<(returnAuthMsg|errMsg|resultMsg)>([^<]+)<", s)
        raise RuntimeError(m.group(2) if m else s[:120])
    j = json.loads(t)
    code_ = str(_find(j, "resultCode") or "00")
    if code_ not in ("00", "0", "03"):
        raise RuntimeError(f"{code_} {_find(j, 'resultMsg')}")
    return _items(j, []), int(_find(j, "totalCount") or 0)


def fetch_station(key, code):
    items, total = fetch_page(key, code, 1)
    page = 1
    while len(items) < total and page < 40:
        page += 1
        more, _ = fetch_page(key, code, page)
        if not more:
            break
        items += more
    return items


def _f(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def summarize(code, name, items):
    rows = []
    lat = lon = None
    for it in items:
        t = str(it.get("predcDt", "")).strip()[:16]
        s, d = _f(it.get("crsp")), _f(it.get("crdir"))
        lat, lon = _f(it.get("lat")) or lat, _f(it.get("lot")) or lon
        name = it.get("obsvtrNm") or name
        if t and s is not None:
            rows.append((t, d, round(s / 100, 3)))  # cm/s → m/s
    rows.sort()
    strong = [r for r in rows if r[2] > 0 and r[1] is not None]  # 0 = 전류(정조) 시각
    st = {"code": code, "name": name, "lat": lat, "lon": lon, "n": len(strong)}
    if strong:
        sp = sorted(r[2] for r in strong)
        mx = max(strong, key=lambda r: r[2])
        st.update(max=mx[2], maxdir=mx[1], maxt=mx[0], mean=round(sum(sp) / len(sp), 3),
                  p95=sp[min(len(sp) - 1, int(0.95 * len(sp)))], t0=rows[0][0][:10], t1=rows[-1][0][:10])
        # 창·낙조 구분은 API에 없으므로 최강 유향 기준 ±90° 로 두 방향으로 나눔
        g = {0: [], 1: []}
        for r in strong:
            dd = abs((r[1] - mx[1] + 180) % 360 - 180)
            g[0 if dd <= 90 else 1].append(r)
        grp = []
        for k in (0, 1):
            if not g[k]:
                continue
            sx = sum(math.sin(math.radians(r[1])) for r in g[k]); cx = sum(math.cos(math.radians(r[1])) for r in g[k])
            grp.append({"dir": round(math.degrees(math.atan2(sx, cx)) % 360), "max": max(r[2] for r in g[k]),
                        "mean": round(sum(r[2] for r in g[k]) / len(g[k]), 3), "n": len(g[k])})
        st["groups"] = grp
    ser = {"code": code, "name": name, "lat": lat, "lon": lon,
           "t": [r[0] for r in rows], "d": [r[1] for r in rows], "s": [r[2] for r in rows]}
    return st, ser


def build(out_data, workers=4, limit=230):
    """캐시를 갱신하고 site/data/currents.json, site/data/currents/<코드>.json 을 씀. 키가 없으면 캐시만 사용."""
    os.makedirs(CACHE, exist_ok=True)
    key = load_key()
    lst = stations()
    now = dt.datetime.now()

    def stale(code):
        f = os.path.join(CACHE, f"{code}.json")
        if not os.path.exists(f):
            return True
        try:
            return (now - dt.datetime.fromisoformat(json.load(open(f, encoding="utf-8"))["fetched"])).days >= REFRESH_DAYS
        except Exception:  # noqa: BLE001
            return True

    todo = [(c, n) for c, n in lst if stale(c)][:limit] if key else []
    errs = []

    def job(cn):
        c, n = cn
        try:
            items = fetch_station(key, c)
            if not items:
                return c, "자료 없음"
            json.dump({"fetched": now.isoformat(timespec="seconds"), "name": n, "items": items},
                      open(os.path.join(CACHE, f"{c}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            return c, None
        except Exception as e:  # noqa: BLE001
            return c, str(e)[:160]

    if todo:  # 먼저 한 지점으로 연결·키를 확인하고, 안 되면 바로 건너뜀 (매시간 지도 갱신이 늦어지지 않도록)
        t0 = time.time()
        c0, e0 = job(todo[0])
        print(f"조류예보 연결 확인 {c0}: {'정상' if not e0 else e0} ({time.time() - t0:.1f}초)", flush=True)
        if e0 and ("연결 실패" in e0 or "KEY" in e0.upper() or "SERVICE_ACCESS" in e0 or "인증" in e0):
            errs.append((c0, e0)); todo = []
        else:
            todo = todo[1:]
        deadline = t0 + 600  # 한 번 실행에 최대 10분, 남은 지점은 다음 시간에 이어서
        def job2(cn):
            return (cn[0], "시간 초과로 다음에") if time.time() > deadline else job(cn)
        with ThreadPoolExecutor(workers) as ex:
            for i, (c, e) in enumerate(ex.map(job2, todo), 1):
                if e:
                    errs.append((c, e))
                if i % 20 == 0:
                    print(f"  조류예보 {i}/{len(todo)} …", flush=True)
        auth = [e for _, e in errs if "KEY" in e.upper() or "인증" in e or "SERVICE_ACCESS" in e]
        print(f"조류예보: {len(todo)}개 지점 받기, 실패 {len(errs)}개" + (f" (예: {errs[0]})" if errs else ""))
        if auth:
            print("  ↳ 공공데이터포털 인증키 오류 — 키 등록 직후에는 1시간쯤 뒤부터 동작합니다:", auth[0])
    elif not key:
        print("조류예보: DATA_GO_KR_KEY 가 없어 건너뜀 (캐시만 사용)")

    cdir = os.path.join(out_data, "currents")
    os.makedirs(cdir, exist_ok=True)
    summ = []
    for c, n in lst:
        f = os.path.join(CACHE, f"{c}.json")
        if not os.path.exists(f):
            continue
        try:
            cj = json.load(open(f, encoding="utf-8"))
            st, ser = summarize(c, n, cj["items"])
        except Exception as e:  # noqa: BLE001
            print("  조류 요약 실패", c, e)
            continue
        if st.get("lat") is None or not st.get("n"):
            continue
        st["fetched"] = cj["fetched"][:10]
        summ.append(st)
        json.dump(ser, open(os.path.join(cdir, f"{c}.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    json.dump({"src": "국립해양조사원 조류예보(최강 창·낙조 및 전류), 공공데이터포털", "built": now.strftime("%Y-%m-%d %H:%M"),
               "stations": summ}, open(os.path.join(out_data, "currents.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"조류예보 지점 {len(summ)}개 → currents.json")
    return len(summ)
