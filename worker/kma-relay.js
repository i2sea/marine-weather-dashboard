// 기상청 API허브 중계 (Cloudflare Worker)
// - 해양기상 대시보드에서 이용자가 넣은 "자기 인증키"로 기상청 API를 대신 불러 줍니다.
// - 키는 저장하지 않습니다. 요청 머리글 X-KMA-Key 로 받아 기상청에 그대로 전달만 합니다.
// - 다운로드에 필요한 API 경로만 허용합니다(아래 ALLOW_PATHS).
// 배포: Cloudflare 대시보드 → Workers → 새 Worker → 이 파일 내용을 붙여 넣고 배포.

const ALLOW_PATHS = [
  /^typ01\/url\/kma_buoy2\.php$/,                                        // 해양기상부이 기간조회
  /^typ02\/openApi\/SeaMtlyInfoService\/getDaily(Buoy|Lhaws|WaveBuoy)$/, // 월보 일별자료
  /^typ01\/cgi-bin\/url\/nph-rawm_latlon_api$/,                          // 재현바람장 위·경도 추출
  /^typ01\/url\/kma_sfctm3\.php$/,                                       // 종관기상관측(ASOS) 시간자료 기간조회
];
const ALLOW_ORIGINS = [
  "https://i2sea.github.io",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "X-KMA-Key",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "GET") return new Response("GET만 됩니다", { status: 405, headers: cors });

    const u = new URL(req.url);
    const path = u.searchParams.get("path") || "";
    if (!path) return new Response("기상청 API 중계 서버입니다 (해양기상 대시보드용)", { headers: cors });
    if (!ALLOW_PATHS.some((r) => r.test(path))) {
      return new Response("허용되지 않은 경로입니다", { status: 400, headers: cors });
    }
    const key = req.headers.get("X-KMA-Key") || "";
    if (!/^[A-Za-z0-9_\-]{10,64}$/.test(key)) {
      return new Response("인증키 형식이 맞지 않습니다", { status: 400, headers: cors });
    }

    const up = new URL("https://apihub.kma.go.kr/api/" + path);
    for (const [k, v] of u.searchParams) {
      if (k !== "path" && k !== "authKey" && v.length < 40) up.searchParams.set(k, v);
    }
    up.searchParams.set("authKey", key);

    let r;
    try {
      r = await fetch(up.toString(), { headers: { "User-Agent": "marine-weather-dashboard-relay" } });
    } catch (e) {
      return new Response("기상청 서버에 연결하지 못했습니다", { status: 502, headers: cors });
    }
    return new Response(await r.arrayBuffer(), {
      status: r.status,
      headers: {
        ...cors,
        "Content-Type": r.headers.get("Content-Type") || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  },
};
