"""임시: ASOS API 응답 형식 확인용 (확인 후 삭제)"""
import os, sys, urllib.request, urllib.parse
key = os.environ["KMA_API_KEY"]
B = "https://apihub.kma.go.kr/api/"
def g(path, **q):
    q["authKey"] = key
    try:
        with urllib.request.urlopen(B + path + "?" + urllib.parse.urlencode(q), timeout=60) as r:
            t = r.read().decode("euc-kr", "replace")
    except Exception as e:
        t = f"ERR {e}"
    print(f"===== {path} {dict((k, v) for k, v in q.items() if k != 'authKey')}")
    lines = t.splitlines()
    print("\n".join(l[:400] for l in lines[:40])); print(f"... total {len(lines)} lines"); print("\n".join(lines[-3:]))
g("typ02/openApi/SfcMtlyInfoService/getSfcStnLstTbl", pageNo="1", numOfRows="200", dataType="JSON", year="2026", month="09")
g("typ01/url/kma_sfctm2.php", tm="202611120900", stn="0", help="1")
g("typ01/url/kma_sfctm3.php", tm1="201701010000", tm2="201701010500", stn="159", help="1")
g("typ01/url/kma_sfctm3.php", tm1="201701010000", tm2="201701312300", stn="159", help="0")
