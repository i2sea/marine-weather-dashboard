"""기상청 종관기상관측(ASOS) — 지점 목록과 최신 1시간 관측을 site/data/asos.json 으로 (build_site.py 에서 호출)

API허브(지상관측 › 종관기상관측(ASOS)):
  - 4.2 지상관측지점일람표 typ02/openApi/SfcMtlyInfoService/getSfcStnLstTbl (year, month) → stn_id, stn_ko, lat, lon, ht, ht_wd(풍속계 지상높이)
  - 1.1 시간자료 typ01/url/kma_sfctm2.php?tm=YYYYMMDDHH00&stn=0 → 공백 구분, TM STN WD(36방위) WS GST_WD GST_WS GST_TM PA PS PT PR TA TD HM …
  - 1.2 시간자료(기간) typ01/url/kma_sfctm3.php?tm1&tm2&stn (최대 31일) → 브라우저에서 이용자 키로 (중계 서버 경유)
"""
import datetime as dt, json, os
import marine_collector as mc

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache", "asos_stations.json")


def _num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x <= -9 else x


def stations(key, now):
    if os.path.exists(CACHE):
        try:
            c = json.load(open(CACHE, encoding="utf-8"))
            if (now - dt.datetime.fromisoformat(c["fetched"])).days < 7 and c["stations"]:
                return c["stations"]
        except Exception:  # noqa: BLE001
            pass
    out = {}
    for back in range(1, 6):  # 최근 월보부터 거슬러 찾기
        d = (now.replace(day=1) - dt.timedelta(days=31 * back)).replace(day=1)
        try:
            t = mc.get("typ02/openApi/SfcMtlyInfoService/getSfcStnLstTbl",
                       {"pageNo": 1, "numOfRows": 999, "dataType": "JSON", "year": d.year, "month": f"{d.month:02d}"}, key)
            j = json.loads(t)
        except Exception as e:  # noqa: BLE001
            print("ASOS 지점일람표", d.strftime("%Y-%m"), e)
            continue
        rows = []

        def walk(o):
            if isinstance(o, dict):
                if "stn_id" in o and "lat" in o:
                    rows.append(o)
                else:
                    for v in o.values():
                        walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(j)
        for r in rows:
            s = str(r.get("stn_id"))
            out[s] = {"stn": s, "name": (r.get("stn_ko") or "").strip(), "lat": _num(r.get("lat")), "lon": _num(r.get("lon")),
                      "ht": _num(r.get("ht")), "zh": _num(r.get("ht_wd"))}
        if out:
            break
    st = [v for v in out.values() if v["lat"] and v["lon"]]
    if st:
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        json.dump({"fetched": now.isoformat(timespec="seconds"), "stations": st}, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    elif os.path.exists(CACHE):
        st = json.load(open(CACHE, encoding="utf-8"))["stations"]
    return st


def latest(key, now):
    """가장 최근 정시 관측 (정시 자료가 늦게 들어오면 한두 시간 앞으로)"""
    for back in range(0, 4):
        t = (now - dt.timedelta(hours=back)).strftime("%Y%m%d%H00")
        try:
            txt = mc.get("typ01/url/kma_sfctm2.php", {"tm": t, "stn": 0, "help": 0}, key)
        except Exception as e:  # noqa: BLE001
            print("ASOS 시간자료", t, e)
            continue
        obs = {}
        for ln in txt.splitlines():
            p = ln.split()
            if len(p) < 14 or not p[0].isdigit() or len(p[0]) != 12:
                continue
            wd = _num(p[2])
            obs[p[1]] = {"tm": p[0], "wd": None if wd is None else (0 if wd == 0 else wd * 10), "ws": _num(p[3]),
                         "gst": _num(p[5]), "pa": _num(p[7]), "ta": _num(p[11]), "hm": _num(p[13])}
        if len(obs) > 30:
            return t, obs
    return None, {}


def build(out_data, key):
    now = dt.datetime.now()
    st = stations(key, now)
    tm, obs = latest(key, now) if st else (None, {})
    for s in st:
        s.update(obs.get(s["stn"], {}))
    json.dump({"tm": tm, "built": now.strftime("%Y-%m-%d %H:%M"), "stations": st},
              open(os.path.join(out_data, "asos.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print(f"ASOS 지점 {len(st)}개, 최신 관측 {tm} {len(obs)}개 → asos.json")
