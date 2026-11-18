import collections
import json
import math
import sys


def symbol_sizes(filename, group):
    from elftools.elf.elffile import ELFFile
    sizes = collections.Counter()
    with open(filename, 'rb') as stream:
        elf = ELFFile(stream)
        table = elf.get_section_by_name('.symtab')
        if table is None:
            raise ValueError('ELF 缺少符号表，请使用未剥离符号的构建产物')
        owners = {}
        if group == 'unit':
            if not elf.has_dwarf_info(strict=True):
                raise ValueError('按源文件比较需要带 DWARF 调试信息的 ELF')
            for cu in elf.get_dwarf_info().iter_CUs():
                cu_name = cu.get_top_DIE().attributes.get('DW_AT_name')
                if cu_name is None:
                    continue
                unit_name = cu_name.value.decode('utf8', 'replace')
                for die in cu.iter_DIEs():
                    if die.tag not in ('DW_TAG_subprogram', 'DW_TAG_variable') or 'DW_AT_declaration' in die.attributes:
                        continue
                    name = die.attributes.get('DW_AT_linkage_name') or die.attributes.get('DW_AT_name')
                    if name and isinstance(name.value, bytes):
                        owners.setdefault(name.value.decode('utf8', 'replace'), set()).add(unit_name)
        unit = ''
        for symbol in table.iter_symbols():
            kind = symbol['st_info']['type']
            if kind == 'STT_FILE':
                unit = symbol.name
            if kind not in ('STT_FUNC', 'STT_OBJECT') or not symbol['st_size']:
                continue
            prefix = unit + ' / ' if unit and symbol['st_info']['bind'] == 'STB_LOCAL' else ''
            if group == 'unit':
                candidates = owners.get(symbol.name, set())
                label = next(iter(candidates)) if len(candidates) == 1 else unit if prefix else '未归属'
            else:
                label = prefix + symbol.name
            sizes[label] += symbol['st_size']
        return elf['e_machine'], elf.elfclass, sizes


def compare_sizes(before, after, group):
    old_arch, old_bits, old = symbol_sizes(before, group)
    arch, bits, new = symbol_sizes(after, group)
    if (arch, bits) != (old_arch, old_bits):
        raise ValueError('两个固件的目标架构不同')
    rows = [[key, old[key], new[key], new[key] - old[key]] for key in old.keys() | new.keys() if old[key] != new[key]]
    rows.sort(key=lambda row: (-abs(row[3]), row[0]))
    return dict(columns=['编译单元' if group == 'unit' else '符号', '原始 B', '当前 B', '差值 B'], rows=rows[:500], count=len(rows), source=arch)


def decode_can(data):
    import cantools
    db = cantools.database.load_string(data['dbc'], database_format='dbc')
    messages = {(msg.frame_id, msg.is_extended_frame): msg for msg in db.messages}
    rows, skipped, invalid, count = [], 0, 0, 0
    for frame in data['frames']:
        msg = messages.get((int(frame['id'], 16), frame['extended']))
        if frame['rtr'] or msg is None:
            skipped += 1
            continue
        try:
            values = msg.decode(bytes.fromhex(frame['data']), decode_choices=False)
        except (ValueError, cantools.database.DecodeError):
            invalid += 1
            continue
        for name, value in values.items():
            count += 1
            if len(rows) < 12000:
                rows.append([frame['time'], frame['id'], msg.name, name, value if math.isfinite(value) else str(value), msg.get_signal_by_name(name).unit or ''])
    return dict(columns=['时间 / s','ID','报文','信号','值','单位'], rows=rows, count=count, source=f'DBC · 跳过 {skipped} 帧 · 无法解码 {invalid} 帧')


try:
    data = json.load(sys.stdin)
    result = decode_can(data) if sys.argv[1] == 'dbc' else compare_sizes(data['before'], data['after'], data['group'])
    print(json.dumps(result, allow_nan=False))
except ImportError as exc:
    sys.exit('Python 缺少依赖，请安装 cantools 和 pyelftools: ' + str(exc))
except Exception as exc:
    sys.exit(str(exc))
