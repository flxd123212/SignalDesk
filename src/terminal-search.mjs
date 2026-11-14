export function findPacketMatches(packets, query, hex = false) {
  const needle = hex ? query.replace(/\s/g, '').toLowerCase() : query.toLowerCase();
  if (!needle) return { hits: [], ids: new Set(), ranges: new Map() };
  if (hex && !/^(?:[\da-f]{2})+$/.test(needle)) return { hits: [], ids: new Set(), ranges: new Map() };
  const hits = [], ids = new Set(), ranges = new Map();
  for (const direction of ['RX', 'TX']) {
    let joined = ''; const segments = [];
    for (const packet of packets) if (packet.dir === direction) { const value = hex ? packet.hex.replace(/\s/g, '') : packet.text; segments.push({ packet, start: joined.length, end: joined.length + value.length }); joined += value.toLowerCase(); }
    let index = 0, cursor = 0;
    while ((index = joined.indexOf(needle, index)) >= 0) {
      if (hex && index % 2) { index++; continue; }
      while (cursor < segments.length && segments[cursor].end <= index) cursor++;
      const end = index + needle.length, hit = [];
      for (let i = cursor; i < segments.length && segments[i].start < end; i++) {
        const segment = segments[i]; if (segment.end <= index) continue;
        ids.add(segment.packet.id); hit.push(segment.packet.id);
        const startInPacket = Math.max(0, index - segment.start), endInPacket = Math.min(segment.end, end) - segment.start;
        const previous = ranges.get(segment.packet.id) || [];
        previous.push(hex ? [Math.floor(startInPacket / 2) * 3, Math.ceil(endInPacket / 2) * 3 - 1] : [startInPacket, endInPacket]); ranges.set(segment.packet.id, previous);
      }
      if (hit.length) hits.push(hit); index = end;
    }
  }
  return { hits, ids, ranges };
}
