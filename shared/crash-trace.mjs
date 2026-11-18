const address = '0x[0-9a-f]{1,16}\\b';
const addressList = new RegExp(`^(?:${address}[\\s,]*)+$`, 'i');
const pair = new RegExp(`(${address})\\s*:\\s*${address}`, 'ig');
const register = /\b(?:PC|MEPC|SEPC|EPC|RA|LR|ELR_EL[123]|Faulting instruction address)(?:\s*\([^)]*\)|\))?\s*[:=]\s*(0x[\da-f]{1,16}|[\da-f]{4,16})\b/ig;
const exceptionStart = /^.*(?:Guru Meditation Error|\bHardFault\b|Core\s+\d+\s+panic'ed|ZEPHYR FATAL ERROR).*$/gim;

export function parseCrashTrace(text) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').trim().split(/\r?\n/);
  const frames = [], registers = [];
  let continued = false, fingerprint = '';
  for (const line of lines) {
    const backtrace = /\bBacktrace\s*:\s*(.*)/i.exec(line);
    const gdb = /^\s*#\d+\s+(0x[\da-f]{1,16})\b/i.exec(line);
    if (backtrace || (continued && /^\s*0x\w+\s*:/i.test(line))) {
      const list = (backtrace?.[1] ?? line).trim();
      if (addressList.test(list)) frames.push(...list.match(new RegExp(address, 'ig')));
      else for (const match of list.matchAll(pair)) frames.push(match[1]);
      continued = true;
    } else {
      continued = false;
      if (gdb) frames.push(gdb[1]);
      for (const match of line.matchAll(register)) registers.push(/^0x/i.test(match[1]) ? match[1] : `0x${match[1]}`);
    }
    const hash = /^\s*ELF file SHA256:\s*([0-9a-f]{8,64})\b/i.exec(line);
    if (hash) fingerprint = hash[1].toLowerCase();
  }
  const manual = !frames.length && !registers.length && addressList.test(text.trim());
  const addresses = frames.length ? frames : manual ? text.match(new RegExp(address, 'ig')) : registers;
  return { addresses: addresses || [], fingerprint };
}

export function recentCrashLog(packets) {
  let text = '';
  for (let i = packets.length - 1; i >= 0 && text.length < 32768; i--) {
    if (packets[i].dir === 'RX') text = packets[i].text.slice(-32768) + text;
  }
  text = text.slice(-32768);
  const starts = [...text.matchAll(exceptionStart)];
  if (starts.length) return text.slice(starts.at(-1).index);
  const traces = [...text.matchAll(/\bBacktrace\s*:/gi)];
  if (traces.length) return text.slice(traces.at(-1).index);
  return parseCrashTrace(text).addresses.length ? text : '';
}
