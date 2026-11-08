"""해양기상 종합관측 자료 수집기 (기상청 API허브)  v0.5  2026-11-06 (실제 응답 형식 반영)

필요: Python 3.8+ (표준 라이브러리만 사용, 추가 설치 없음)
인증키: 기상청 API허브(apihub.kma.go.kr) 가입 → 각 API '활용신청' → 마이페이지의 authKey
        이 파일과 같은 폴더에 kma_key.txt 를 만들어 키 한 줄만 적어 두면 --key 없이 실행됩니다.
        (또는 환경변수 KMA_API_KEY, 또는 명령마다 --key 키)

명령
  probe     각 API 응답 원본을 raw/ 에 저장 (처음 한 번: 형식 확인용)
  stations  지점 목록(부이·등표·파고부이, 위경도) → data/stations.csv
            --near 위도 경도 --km 반경  으로 사업지 주변만 추리기
  buoy      해양기상부이 시간자료, 기간조회(kma_buoy2) → data/buoy_<지점>.csv
  hourly    해양기상종합관측(sea_obs) 시간별 반복조회 — 부이·등표·파고부이 전부
            → data/seaobs_<지점>.csv   (1시간=1호출, 이어받기 지원)
  daily     월보 일별자료(부이/등표/파고부이) → data/daily_<종류>_<지점>.csv

예
  python marine_collector.py probe
  python marine_collector.py stations --near 35.16 129.20 --km 60
  python marine_collector.py buoy   --stn 22190 --from 2024-01-01 --to 2024-12-31
  python marine_collector.py hourly --stn 22190 22104 --from 2025-01-01 --to 2025-01-31
  python marine_collector.py daily  --kind lhaws --stn 955 --from 2023-01 --to 2024-12
"""
import argparse, csv, datetime as dt, json, math, os, re, sys, time
import urllib.error, urllib.parse, urllib.request

BASE = "https://apihub.kma.go.kr/api/"
EP = {
    "sea_obs":  "typ01/url/sea_obs.php",     # 종합: tm, stn
    "buoy":     "typ01/url/kma_buoy.php",    # 부이 1시각: tm, stn
    "buoy2":    "typ01/url/kma_buoy2.php",   # 부이 기간: tm1, tm2, stn
    "mtly":     "typ02/openApi/SeaMtlyInfoService/",
}
# 문서상 컬럼(응답 머리줄에서 컬럼명을 찾지 못할 때 쓰는 기본값)
COLS = {
    # 2026-11-06 실제 응답 확인: TP(B부이 C파고부이 L등표 N조위 F연안방재 J기상1호), 끝칸 QC 플래그
    "sea_obs": "TP TM STN_ID STN_KO LON LAT WH WD WS WS_GST TW TA PA HM QC".split(),
    # kma_buoy2 실제 응답: 19칸, 30분 간격
    "buoy": ("TM STN WD1 WS1 WS1_GST WD2 WS2 WS2_GST PA HM TA TW "
             "WH_MAX WH_SIG WH_AVE WP WO AQC MQC").split(),
}
STATION_OPS = {"buoy": "getBuoyLstTbl", "lhaws": "getLhawsLstTbl", "wave": "getWaveBuoyLstTbl"}
DAILY_OPS = {"buoy": "getDailyBuoy", "lhaws": "getDailyLhaws", "wave": "getDailyWaveBuoy"}
MISSING = {"-99", "-99.0", "-99.00", "-999", "-999.0", "-9999", "-9999.0", "-99.9"}

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
RAW = os.path.join(HERE, "raw")
CACHE = os.path.join(HERE, "cache")


# ---------------------------------------------------------------- 통신
def get(path, params, key, retries=3, pause=0.3):
    p = dict(params)
    p["authKey"] = key
    url = BASE + path + "?" + urllib.parse.urlencode(p)
    last = None
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                b = r.read()
            time.sleep(pause)
            for enc in ("utf-8", "euc-kr", "cp949"):
                try:
                    return b.decode(enc)
                except UnicodeDecodeError:
                    pass
            return b.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):  # 키가 틀렸거나 활용신청 안 됨 → 재시도해도 소용없음
                raise RuntimeError(f"인증 실패(HTTP {e.code}): 인증키가 맞는지, 이 API를 활용신청했는지 확인하세요. [{path}]")
            last = e
            time.sleep(2 * (i + 1))
        except Exception as e:  # 네트워크 오류 → 잠시 쉬고 재시도
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"요청 실패: {path} {params} → {last}")


def check_error(text):
    t = text.strip()
    if not t:
        raise RuntimeError("빈 응답 (인증키·활용신청 여부 확인)")
    head = t[:300]
    low = head.lower()
    if t.startswith("{"):  # API허브 공통 오류: {"result": {"status": 403, "message": "활용신청이 필요한..."}}
        try:
            res = json.loads(t).get("result", {})
            if isinstance(res, dict) and str(res.get("status", "200")) != "200":
                raise RuntimeError(f"API허브 오류 {res.get('status')}: {res.get('message')}")
        except json.JSONDecodeError:
            pass
    if "<html" in low or "인증" in head or low.startswith(("error", "{\"result")) or "auth" in low[:120]:
        raise RuntimeError("API 오류 응답 (인증키·활용신청 확인):\n" + head)


# ---------------------------------------------------------------- typ01 텍스트 파서
def _split(line):
    line = line.strip()
    if line.endswith("="):
        line = line[:-1].rstrip()
    if "," in line:
        parts = [x.strip() for x in line.split(",")]
        if parts and parts[-1] == "":
            parts = parts[:-1]
        return parts
    return line.split()


def parse_typ01(text, default_cols):
    """'#'으로 시작하는 머리줄 + 자료줄(쉼표 또는 공백 구분, 끝 '=') 형식."""
    heads, rows = [], []
    for ln in text.splitlines():
        s = ln.strip()
        if not s:
            continue
        if s.startswith("#"):
            heads.append(s.lstrip("#").strip())
            continue
        rows.append(_split(s))
    if not rows:
        return [], []
    n = max(len(r) for r in rows)
    cols = None
    # 머리줄 중 자료 칸 수와 같은 개수의 대문자 토큰이 있는 줄 = 컬럼명 줄
    for h in reversed(heads):
        toks = [t for t in re.split(r"[,\s]+", h) if t]
        if len(toks) == n and len(set(toks)) == n and \
                all(re.fullmatch(r"[A-Z][A-Z0-9_]*", t) for t in toks):
            cols = toks
            break
    if cols is None:
        cols = list(default_cols[:n]) if len(default_cols) >= n else \
            list(default_cols) + [f"C{i}" for i in range(len(default_cols) + 1, n + 1)]
    out = []
    for r in rows:
        r = r + [""] * (n - len(r))
        out.append({c: ("" if v in MISSING else v) for c, v in zip(cols, r)})
    return cols, out


def _leaf_records(o, out):
    """중첩 구조 어디에 있든 '값만 가진 dict'(=자료 한 행)를 모두 모음.
    예) getBuoyLstTbl: response.body.items.item.stn_buoy.info[...]"""
    if isinstance(o, list):
        for x in o:
            _leaf_records(x, out)
    elif isinstance(o, dict):
        if o and all(not isinstance(v, (dict, list)) for v in o.values()):
            out.append(o)
        else:
            for v in o.values():
                _leaf_records(v, out)


def items_typ02(text):
    """typ02 JSON 응답에서 자료 행 목록 꺼내기."""
    try:
        j = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError("JSON 아님:\n" + text[:300])
    res = j.get("result")
    if isinstance(res, dict) and str(res.get("status", "200")) != "200":
        raise RuntimeError(f"API허브 오류 {res.get('status')}: {res.get('message')}")
    resp = j.get("response", j)
    hdr = resp.get("header", {})
    if hdr and str(hdr.get("resultCode", "00")) not in ("00", "0"):
        if str(hdr.get("resultCode")) == "03":  # NODATA
            return []
        raise RuntimeError(f"API 오류 {hdr.get('resultCode')}: {hdr.get('resultMsg')}")
    out = []
    _leaf_records((resp.get("body") or {}).get("items"), out)
    return out


# ---------------------------------------------------------------- 저장
def write_csv(path, rows, key_cols=("TM",)):
    """기존 파일과 합치고 시각 기준 중복 제거 후 정렬 저장 (엑셀용 UTF-8 BOM)."""
    if not rows and not os.path.exists(path):
        return 0
    os.makedirs(os.path.dirname(path), exist_ok=True)
    old = []
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig", newline="") as f:
            old = list(csv.DictReader(f))
    merged = {}
    for r in old + rows:
        k = tuple(r.get(c, "") for c in key_cols)
        merged[k] = r
    cols = []
    for r in merged.values():
        for c in r:
            if c not in cols:
                cols.append(c)
    data = sorted(merged.values(), key=lambda r: tuple(r.get(c, "") for c in key_cols))
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(data)
    return len(data)


def stn_of(r):
    return (r.get("STN_ID") or r.get("STN") or r.get("stn_id") or "").strip()


# ---------------------------------------------------------------- 날짜
def pdate(s, end=False):
    s = s.strip()
    if re.fullmatch(r"\d{4}-\d{2}", s):
        d = dt.datetime.strptime(s, "%Y-%m")
        if end:
            d = (d.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(hours=1)
            return d.replace(hour=23)
        return d
    fmt = "%Y-%m-%d %H" if " " in s else "%Y-%m-%d"
    d = dt.datetime.strptime(s, fmt)
    if end and fmt == "%Y-%m-%d":
        d = d.replace(hour=23)
    return d


def months(d1, d2):
    y, m = d1.year, d1.month
    while (y, m) <= (d2.year, d2.month):
        a = dt.datetime(y, m, 1)
        b = (a.replace(day=28) + dt.timedelta(days=4)).replace(day=1) - dt.timedelta(minutes=1)
        yield max(a, d1), min(b, d2)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def spans(d1, d2, days=7):
    a = d1
    while a <= d2:
        b = min(a + dt.timedelta(days=days) - dt.timedelta(minutes=1), d2)
        yield a, b
        a = b + dt.timedelta(minutes=1)


def tm(d):
    return d.strftime("%Y%m%d%H%M")


# ---------------------------------------------------------------- 명령
def cmd_probe(a):
    os.makedirs(RAW, exist_ok=True)
    now = dt.datetime.now().replace(minute=0, second=0, microsecond=0) - dt.timedelta(hours=1)
    year, mon = (now - dt.timedelta(days=60)).year, (now - dt.timedelta(days=60)).month
    tests = [
        ("sea_obs", EP["sea_obs"], {"tm": tm(now), "stn": 0, "help": 1}),
        ("buoy", EP["buoy"], {"tm": tm(now), "stn": 0, "help": 1}),
        ("buoy2", EP["buoy2"], {"tm1": tm(now - dt.timedelta(hours=6)), "tm2": tm(now), "stn": 0, "help": 1}),
        ("stn_buoy", EP["mtly"] + "getBuoyLstTbl",
         {"pageNo": 1, "numOfRows": 10, "dataType": "JSON", "year": year, "month": f"{mon:02d}"}),
    ]
    for name, path, p in tests:
        try:
            t = get(path, p, a.key)
            fn = os.path.join(RAW, f"probe_{name}.txt")
            with open(fn, "w", encoding="utf-8") as f:
                f.write(t)
            print(f"[OK] {name}: {len(t)}자 → {fn}")
            print("     " + "\n     ".join(t.strip().splitlines()[:6]))
        except Exception as e:
            print(f"[실패] {name}: {e}")


def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    return 2 * R * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))


def _deg(v):
    """'35.1234' 또는 '35-12-34' / '35°12′34″' 형태를 십진도로."""
    v = str(v or "").strip()
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", v)]
        if not nums:
            return None
        d = nums[0] + (nums[1] / 60 if len(nums) > 1 else 0) + (nums[2] / 3600 if len(nums) > 2 else 0)
        return d


def cmd_stations(a):
    ref = dt.date.today().replace(day=1) - dt.timedelta(days=45)  # 최근 발표된 월보
    rows = []
    for kind, op in STATION_OPS.items():
        got = []
        for back in range(0, 13):  # 해당 월 자료가 없으면 한 달씩 거슬러 감
            d = (ref.replace(day=1) - dt.timedelta(days=31 * back))
            try:
                got = items_typ02(get(EP["mtly"] + op, {"pageNo": 1, "numOfRows": 999, "dataType": "JSON",
                                                        "year": d.year, "month": f"{d.month:02d}"}, a.key))
            except RuntimeError as e:
                print(f"  {kind} {d:%Y-%m}: {e}")
                got = []
            if got:
                print(f"{kind}: {len(got)}개 지점 ({d:%Y-%m} 월보 기준)")
                break
        for r in got:
            lat, lon = _deg(r.get("lat")), _deg(r.get("lon"))
            row = {"kind": kind, "stn_id": r.get("stn_id"), "stn_ko": r.get("stn_ko"),
                   "stn_en": r.get("stn_en"), "lat": lat, "lon": lon}
            for k in ("form", "ht_wd", "ht_ta", "ht_pa", "ht_wh", "ht_tw"):
                if k in r:
                    row[k] = r[k]
            if a.near:
                row["dist_km"] = round(haversine(a.near[0], a.near[1], lat, lon), 1) if lat and lon else ""
            rows.append(row)
    if a.near:
        rows = [r for r in rows if r["dist_km"] != "" and r["dist_km"] <= a.km]
        rows.sort(key=lambda r: r["dist_km"])
    path = os.path.join(DATA, "stations_near.csv" if a.near else "stations.csv")
    os.makedirs(DATA, exist_ok=True)
    cols = []
    for r in rows:
        cols += [c for c in r if c not in cols]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols or ["kind"])
        w.writeheader()
        w.writerows(rows)
    for r in rows[:30]:
        print(f"  {r['kind']:6} {r['stn_id']:>6} {r['stn_ko'] or '':10} {r['lat']},{r['lon']}"
              + (f"  {r['dist_km']}km" if a.near else "") + f"  풍속계높이 {r.get('ht_wd', '')}")
    print(f"→ {path} ({len(rows)}개)")


def cmd_buoy(a):
    d1, d2 = pdate(a.date_from), pdate(a.date_to, end=True)
    for stn in a.stn:
        allrows = []
        for s, e in spans(d1, d2, days=7):
            t = get(EP["buoy2"], {"tm1": tm(s), "tm2": tm(e), "stn": stn, "help": 1}, a.key)
            check_error(t)
            _, rows = parse_typ01(t, COLS["buoy"])
            rows = [r for r in rows if not stn_of(r) or stn_of(r) == str(stn)]
            print(f"  부이 {stn} {s:%Y-%m-%d}~{e:%m-%d}: {len(rows)}행")
            n = write_csv(os.path.join(DATA, f"buoy_{stn}.csv"), rows)  # 7일마다 바로 저장
        print(f"→ data/buoy_{stn}.csv 누적 {n}행")


def seaobs_text(t, key):
    """sea_obs 한 시각 응답(전 지점). cache/에 보관해 재사용 — 최근 3시간은 자료가 덜 들어와 있을 수 있어 보관 안 함."""
    os.makedirs(CACHE, exist_ok=True)
    cf = os.path.join(CACHE, f"seaobs_{tm(t)}.txt")
    if os.path.exists(cf):
        with open(cf, encoding="utf-8") as f:
            return f.read()
    txt = get(EP["sea_obs"], {"tm": tm(t), "stn": 0, "help": 1}, key)
    check_error(txt)
    if t < dt.datetime.now() - dt.timedelta(hours=3):
        with open(cf, "w", encoding="utf-8") as f:
            f.write(txt)
    return txt


def seaobs_rows(hours, key, workers=6, progress=None, chunk=240):
    """여러 시각을 동시에 받아 (시각, 행목록)을 순서대로 돌려줌. 이미 받은 시각은 cache/에서 바로 읽음."""
    from concurrent.futures import ThreadPoolExecutor
    total, done = len(hours), 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for i in range(0, total, chunk):
            part = hours[i:i + chunk]
            for t, txt in zip(part, ex.map(lambda h: seaobs_text(h, key), part)):
                done += 1
                if progress:
                    progress(done, total)
                yield t, parse_typ01(txt, COLS["sea_obs"])[1]


def hour_list(d1, d2):
    t, out = d1.replace(minute=0, second=0, microsecond=0), []
    while t <= d2:
        out.append(t)
        t += dt.timedelta(hours=1)
    return out


def cmd_hourly(a):
    """sea_obs는 한 시각 조회. stn=0이면 한 번에 전 지점 → 시각마다 1호출 (동시 요청 --workers)."""
    d1, d2 = pdate(a.date_from), pdate(a.date_to, end=True)
    want = set(str(s) for s in a.stn) if a.stn else None
    hours = hour_list(d1, d2)
    bucket, day = {}, None

    def flush():
        for stn, rows in bucket.items():
            write_csv(os.path.join(DATA, f"seaobs_{stn}.csv"), rows)
        bucket.clear()

    def prog(d, n):
        if d % 24 == 0 or d == n:
            print(f"\r  {d}/{n}시각 ({d * 100 // n}%)", end="", flush=True)

    for t, rows in seaobs_rows(hours, a.key, a.workers, prog):
        for r in rows:
            s = stn_of(r)
            if want is None or s in want:
                bucket.setdefault(s, []).append(r)
        if t.date() != day:
            day = t.date()
            if day.day == 1:
                flush()
    flush()
    print("\n→ data/seaobs_<지점>.csv 저장 완료 (원본은 cache/ 에 보관, 다시 돌리면 이어받기)")


_NUM = re.compile(r"^\s*(-?\d+(?:\.\d+)?)\s*[)>(<*#]*\s*$")


def clean_val(v):
    """월보 값 정리: '0.2>' '1010.4)' → 숫자만, 'x'·'null'·결측(-99) → 빈칸, 풍향 'SE' 같은 글자는 그대로."""
    v = "" if v is None else str(v).strip()
    if v.lower() in ("", "x", "null", "none", "-") or v in MISSING:
        return ""
    m = _NUM.match(v)
    if m:
        return "" if m.group(1) in MISSING else m.group(1)
    return v


def cmd_daily(a):
    """월보 일별자료: 응답의 tm은 '01'~'31'(일) + '상순/중순/하순/월'(요약).
    일 자료 → daily_<종류>_<지점>.csv (date 칸 추가), 요약 → daily_<종류>_<지점>_요약.csv"""
    d1, d2 = pdate(a.date_from), pdate(a.date_to, end=True)
    op = DAILY_OPS[a.kind]
    for stn in a.stn:
        days, summ = [], []
        for s, _ in months(d1, d2):
            try:
                rows = items_typ02(get(EP["mtly"] + op, {"pageNo": 1, "numOfRows": 99, "dataType": "JSON",
                                                         "year": s.year, "month": f"{s.month:02d}",
                                                         "station": stn}, a.key))
            except RuntimeError as e:
                print(f"  {a.kind} {stn} {s:%Y-%m}: {e}")
                continue
            nd = 0
            for r in rows:
                if "tm" not in r:          # 지점 정보 줄 등은 건너뜀
                    continue
                lab = str(r.get("tm", "")).strip()
                row = {k: clean_val(v) for k, v in r.items() if k != "tm"}
                if lab.isdigit():
                    try:
                        date = dt.date(s.year, s.month, int(lab)).isoformat()
                    except ValueError:
                        continue
                    days.append({"date": date, "stn": stn, **row})
                    nd += 1
                else:
                    summ.append({"ym": f"{s:%Y-%m}", "구분": lab, "stn": stn, **row})
            print(f"  {a.kind} {stn} {s:%Y-%m}: {nd}일")
        n = write_csv(os.path.join(DATA, f"daily_{a.kind}_{stn}.csv"), days, key_cols=("date",))
        write_csv(os.path.join(DATA, f"daily_{a.kind}_{stn}_요약.csv"), summ, key_cols=("ym", "구분"))
        print(f"→ data/daily_{a.kind}_{stn}.csv 누적 {n}일 (+ _요약.csv)")


def main(argv=None):
    ap = argparse.ArgumentParser(description="기상청 해양기상 관측자료 수집기",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("--key", default=os.environ.get("KMA_API_KEY", ""), help="API허브 authKey")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("probe")
    p = sub.add_parser("stations")
    p.add_argument("--near", nargs=2, type=float, metavar=("LAT", "LON"))
    p.add_argument("--km", type=float, default=50)
    for name in ("buoy", "hourly", "daily"):
        p = sub.add_parser(name)
        p.add_argument("--stn", nargs="+", required=(name != "hourly"),
                       help="지점번호 (hourly는 생략하면 전 지점)")
        p.add_argument("--from", dest="date_from", required=True, help="YYYY-MM-DD 또는 YYYY-MM")
        p.add_argument("--to", dest="date_to", required=True)
        if name == "daily":
            p.add_argument("--kind", choices=list(DAILY_OPS), required=True)
        if name == "hourly":
            p.add_argument("--workers", type=int, default=6, help="동시 요청 수 (기본 6)")

    a = ap.parse_args(argv)
    kf = os.path.join(HERE, "kma_key.txt")
    if not a.key and os.path.exists(kf):
        with open(kf, encoding="utf-8-sig") as f:
            a.key = f.read().strip()
    if not a.key:
        sys.exit("인증키가 없습니다. 이 폴더에 kma_key.txt(키 한 줄)를 만들거나 --key 키 로 지정하세요.")
    try:
        {"probe": cmd_probe, "stations": cmd_stations, "buoy": cmd_buoy,
         "hourly": cmd_hourly, "daily": cmd_daily}[a.cmd](a)
    except RuntimeError as e:
        sys.exit(f"\n[중단] {e}\n(이미 받은 자료는 저장되어 있고, 다시 실행하면 이어서 받습니다)")


if __name__ == "__main__":
    main()
