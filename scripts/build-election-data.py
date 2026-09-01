import json
import html
import re
import sys


def number(text):
    return int(text.replace(',', '').strip())


def parse(path, candidate_keys):
    source = open(path, encoding='utf-8').read()
    result = {}
    sections = re.finditer(r'<h3[^>]*>(.*?)</h3>\s*<table[^>]*>(.*?)</table>', source, re.S | re.I)
    for section in sections:
        heading, table = section.groups()
        names = re.findall(r'class="mw-headline"[^>]*>(.*?)</span>', heading, re.S | re.I)
        name = clean(names[-1]) if names else ''
        if not name.endswith('里'): continue
        votes = []
        for row in re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S | re.I):
            cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S | re.I)
            if len(cells) < 4:
                continue
            try:
                votes.append(number(clean(cells[-3])))
            except ValueError:
                continue
        if len(votes) >= len(candidate_keys):
            result[name] = dict(zip(candidate_keys, votes[:len(candidate_keys)]))
    return result


def parse_overview(path):
    source = open(path, encoding='utf-8').read()
    tables = re.findall(r'<table[^>]*>(.*?)</table>', source, re.S | re.I)
    table = next(t for t in tables if '行政區' in t and '選舉人數' in t and '投票率' in t)
    result = {}
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', table, re.S | re.I):
        cells = [clean(x) for x in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S | re.I)]
        if len(cells) >= 10 and cells[0].endswith('里'):
            result[cells[0]] = {
                'electors': number(cells[2]),
                'ballots': number(cells[4]),
                'turnout': float(cells[5].replace('%', '')),
            }
    return result


def clean(value):
    value = re.sub(r'<[^>]+>', '', value)
    return html.unescape(value).strip()


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('usage: build-election-data.py 2022.html 2024.html output.json')
    data = {
        '2022': parse(sys.argv[1], ['kmt', 'other', 'dpp']),
        '2024': parse(sys.argv[2], ['tpp', 'dpp', 'kmt']),
    }
    for year, path in [('2022', sys.argv[1]), ('2024', sys.argv[2])]:
        overview = parse_overview(path)
        for name, values in overview.items():
            data[year][name].update(values)
    with open(sys.argv[3], 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print('2022 villages:', len(data['2022']))
    print('2024 villages:', len(data['2024']))
