import json
import pathlib
import sys

from importlib.util import module_from_spec, spec_from_file_location


def load_builder():
    path = pathlib.Path(__file__).with_name('build-election-data.py')
    spec = spec_from_file_location('election_builder', path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: import-mayor-data.py mayor-2022.html election-data.json')

    builder = load_builder()
    source, output = map(pathlib.Path, sys.argv[1:])
    mayor = builder.parse(source, ['tsai', 'hsieh', 'li', 'wei'])
    overview = builder.parse_overview(source)
    for name, values in overview.items():
        mayor[name].update(values)

    data = json.loads(output.read_text(encoding='utf-8'))
    data['2022-mayor'] = mayor
    output.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    totals = {key: sum(v[key] for v in mayor.values()) for key in ['tsai', 'hsieh', 'li', 'wei']}
    print('2022 mayor villages:', len(mayor))
    print('candidate totals:', totals)
