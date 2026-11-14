export const defaultCommands = [
  { id: 'idn', name: '仪器身份查询', text: '*IDN?', format: 'text', ending: 'lf', checksum: 'none', group: 'instrument' },
  { id: 'at', name: 'AT 握手', text: 'AT', format: 'text', ending: 'crlf', checksum: 'none', group: 'at' },
  { id: 'version', name: '固件版本查询', text: 'AT+GMR', format: 'text', ending: 'crlf', checksum: 'none', group: 'at' },
  { id: 'modbus', name: '读取保持寄存器', text: '01 03 00 00 00 02', format: 'hex', ending: 'none', checksum: 'modbus', group: 'instrument' },
  { id: 'frequency', name: '模拟信号 · 2 Hz', text: 'freq 2', format: 'text', ending: 'lf', checksum: 'none', group: 'demo' },
];
export const defaultGroups = [{ id: 'at', name: 'AT 指令' }, { id: 'instrument', name: '仪器与协议' }, { id: 'demo', name: '模拟测试' }];
export function normalizeCommandLibrary(input) {
  const source = Array.isArray(input) ? { commands: input, groups: [] } : input;
  if (!source || !Array.isArray(source.commands) || !Array.isArray(source.groups) || source.commands.length > 5000 || source.groups.length > 128 || JSON.stringify(source).length > 4 * 1024 * 1024) throw new Error('指令库最多 5000 条指令、128 个分组和 4 MiB');
  const groupIds = new Set(), commandIds = new Set();
  const groups = source.groups.map(group => { if (!group || typeof group.id !== 'string' || !group.id || groupIds.has(group.id) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80) throw new Error('分组标识或名称无效'); groupIds.add(group.id); return { id: group.id, name: group.name }; });
  const commands = source.commands.map((command, index) => {
    if (!command || typeof command.name !== 'string' || command.name.length > 80 || typeof command.text !== 'string' || command.text.length > 16384 || !['text', 'hex', 'mixed'].includes(command.format)) throw new Error(`指令 ${index + 1} 格式无效`);
    const ending = command.ending || 'crlf', checksum = command.checksum || 'none';
    if (!['none', 'lf', 'crlf', 'cr'].includes(ending) || !['none', 'modbus', 'sum8'].includes(checksum)) throw new Error('指令结束符或校验类型无效');
    let id = typeof command.id === 'string' && command.id && !commandIds.has(command.id) ? command.id : `imported-${index}`;
    while (commandIds.has(id)) id += '-copy'; commandIds.add(id);
    return { id, name: command.name, text: command.text, format: command.format, ending, checksum, group: groupIds.has(command.group) ? command.group : '' };
  });
  return { version: 2, groups, commands };
}
