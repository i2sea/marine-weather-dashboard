# 해양기상 실시간 관측 대시보드

기상청 해양기상부이·파고부이·등표 관측을 지도에 보여 주는 대시보드입니다.

**바로 보기:** https://i2sea.github.io/marine-weather-dashboard/

- 지도: 전국 해양 관측 지점과 최신값(풍향·풍속, 유의파고). 매시간 자동 갱신
- 지점 클릭: 최신값, 최근 1·3·7·30일 그래프(풍속·돌풍·파고·수온·기온)
- 내려받기: 최근 30일 이내 원하는 기간을 CSV로 저장 (엑셀에서 바로 열림)
- 1년 이상 긴 기간은 아래 [PC 프로그램](#pc에서-긴-기간-내려받기)으로 기상청에서 직접 받습니다

자료 출처: [기상청 API허브](https://apihub.kma.go.kr) 해양기상종합관측. 관측 원자료이므로 품질검사 전 값이 섞일 수 있습니다.

## 기간 추천

| 기간 | 용도 |
|---|---|
| 최근 1개월 | 자료 상태 확인, 공사·작업 기간 해황 확인 |
| 최근 1년 | 사계절이 한 번씩 들어가는 최소 기간 — 풍황 1차 검토 |
| **최근 5년 (추천)** | 해마다 다른 바람 세기(연변동) 반영 — 발전량 검토용 |
| 최근 10년 | 장기 보정, 설계파고 같은 극치 분석. 관측 시작이 늦은 지점은 그 이후만 나옴 |

## PC에서 긴 기간 내려받기

1. [기상청 API허브](https://apihub.kma.go.kr)에 가입하고, 해양관측 API를 활용신청한 뒤 인증키를 받습니다 (무료, 신청 즉시 사용).
   - 해양기상종합관측, 해양기상부이(기간조회), 해양기상월보(지점일람표·일별자료)
2. 이 저장소를 내려받고(초록색 **Code → Download ZIP**), `collector` 폴더에 `kma_key.txt` 파일을 만들어 인증키 한 줄을 적습니다.
3. 파이썬(3.8 이상, 설치 시 "Add python.exe to PATH" 체크)이 있으면, `collector` 폴더에서 명령 프롬프트를 열고:

```
python marine_dashboard.py
```

브라우저에 지도 화면이 열리고, 지점을 눌러 1년·5년·10년 등 원하는 기간을 내려받을 수 있습니다.
명령으로만 받으려면 `python marine_collector.py -h` 를 참고하세요.

## 이 저장소를 직접 운영하려면

1. **Settings → Secrets and variables → Actions → New repository secret**: 이름 `KMA_API_KEY`, 값 = 기상청 API허브 인증키
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**
3. **Actions → 해양기상 자료 갱신 → Run workflow** 로 첫 실행 (처음은 30일치를 받느라 10분 정도 걸림)

이후 매시간 자동으로 갱신됩니다.

## 구성

```
collector/marine_collector.py   기상청 API 수집기 (명령줄)
collector/marine_dashboard.py   PC용 대시보드 (긴 기간 다운로드)
collector/build_site.py         GitHub Pages용 사이트 생성 (Actions가 매시간 실행)
web/index.html                  지도 화면
.github/workflows/update.yml    매시간 갱신·배포
```
