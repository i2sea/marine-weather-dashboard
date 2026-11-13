"""해양수산부 「전국 심해설계파」 보고서 PDF → web/deepwave/deepwave.json (설계파 보고서의 내장 자료표)

사용: python collector/extract_deepwave.py 보고서.pdf --date 2025.03 --title "전국 심해설계파 보완 용역 보고서"
  - '표 6.1.1 연안 및 내부격자점의 격자번호 및 위경도' 에서 격자점 번호·위경도
  - '표 6.2.1 50년 빈도 심해설계파 및 해상풍 제원' 에서 16방위별 파고·주기·풍속·결정원인
  표 번호·제목이 다른 판이면 --grid-table / --wave-table 로 바꿔 주세요. (pip install pdfplumber)
"""
import argparse, json, re, datetime as dt
import pdfplumber

DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('pdf'); ap.add_argument('--date', required=True); ap.add_argument('--title', required=True)
    ap.add_argument('--publisher', default='해양수산부'); ap.add_argument('--grid-table', default='표 6.1.1'); ap.add_argument('--wave-table', default='표 6.2.1')
    ap.add_argument('--out', default='web/deepwave/deepwave.json'); ap.add_argument('--where', default=''); ap.add_argument('--url', default='')
    a = ap.parse_args()
    grid, recs = {}, []
    with pdfplumber.open(a.pdf) as pdf:
        for i, page in enumerate(pdf.pages):
            txt = page.extract_text() or ''
            if a.grid_table.replace(' ', '') in txt.replace(' ', '').replace('<', '').replace('>', '') and '위도' in txt and '경도' in txt and '파고' not in txt:
                for m in re.finditer(r'(?<![\d.])(\d{1,3}(?:-\d{1,2})?)\s+(3\d\.\d{3})\s+(1[23]\d\.\d{3})', txt):
                    grid[m.group(1)] = (float(m.group(2)), float(m.group(3)))
            if a.wave_table.replace(' ', '') not in txt.replace(' ', '') or '파고' not in txt:
                continue
            lab = re.search(r'(\d+)\s*-\s*(\d+)', txt.split('\n')[0] + ' ' + txt.split('\n')[-1]); plabel = f'{lab.group(1)}-{lab.group(2)}' if lab else ''
            words = page.extract_words()
            hdr = {}
            for w in words:
                if w['text'] in DIRS and w['top'] < 200: hdr.setdefault(w['text'], (w['x0'] + w['x1']) / 2)
            if len(hdr) < 16: continue
            xs = [hdr[d] for d in DIRS]
            def row(r):
                y = (r['top'] + r['bottom']) / 2; vals = [None] * 16
                for w in words:
                    if abs((w['top'] + w['bottom']) / 2 - y) < 3 and w['x0'] > r['x1']:
                        cx = (w['x0'] + w['x1']) / 2; j = min(range(16), key=lambda k: abs(xs[k] - cx))
                        if abs(xs[j] - cx) < 12: vals[j] = w['text']
                return y, vals
            B = {}
            for w in words:
                m = re.match(r'^(파고|주기|풍속|결정원인)', w['text'])
                if m: B.setdefault(m.group(1), []).append(row(w))
            coords = [w for w in words if re.fullmatch(r'3\d\.\d{3}|1[23]\d\.\d{3}', w['text']) and w['x1'] < xs[0]]
            for k, (yh, vh) in enumerate(B.get('파고', [])):
                yt = B['주기'][k][0]; span = (yh - 4, yh + 3 * (yt - yh) + 4)
                cc = [float(w['text']) for w in coords if span[0] <= (w['top'] + w['bottom']) / 2 <= span[1]]
                la = next(v for v in cc if v < 90); lo = next(v for v in cc if v > 90)
                recs.append({'lat': la, 'lon': lo, 'pdf': i + 1, 'p': plabel, 'H': [float(v) for v in vh], 'T': [float(v) for v in B['주기'][k][1]],
                             'U': [float(v) for v in B['풍속'][k][1]], 'C': ''.join('T' if c == 'TP' else 'E' for c in B['결정원인'][k][1])})
    byc = {(round(v[0], 3), round(v[1], 3)): k for k, v in grid.items()}
    for r in recs:
        r['id'] = byc.get((round(r['lat'], 3), round(r['lon'], 3)))
    miss = [r for r in recs if not r['id']]
    print(f'격자점 위치 {len(grid)}개, 설계파 행 {len(recs)}개, 번호 못 맞춘 행 {len(miss)}개')
    if miss: raise SystemExit('번호를 못 맞춘 행이 있어 저장하지 않습니다')
    bad = [r['id'] for r in recs if any(not (0 < h < 25) for h in r['H']) or any(not (3 < t < 25) for t in r['T'])]
    if bad: raise SystemExit(f'값 범위 이상: {bad[:5]}')
    o = {'app': 'deepwave-table', 'ver': 1, 'src': {'title': a.title, 'publisher': a.publisher, 'date': a.date,
         'table': f'{a.wave_table} 50년 빈도 심해설계파 및 해상풍 제원', 'gridTable': f'{a.grid_table} 연안 및 내부격자점의 격자번호 및 위경도', 'rp': 50,
         'note': '파고: 각 파향별 태풍(TP)·비태풍(EC) 설계파고 중 큰 값. 주기: 설계주기. 풍속: 50년 빈도 해상풍.', 'extracted': dt.date.today().isoformat(),
         'file': a.pdf.split('/')[-1], 'obtained': {'where': a.where, 'url': a.url}}, 'dirs': DIRS,
         'points': [{k: r[k] for k in ('id', 'lat', 'lon', 'pdf', 'p', 'H', 'T', 'U', 'C')} for r in recs]}
    json.dump(o, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':')); print('저장:', a.out)

if __name__ == '__main__':
    main()
