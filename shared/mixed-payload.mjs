export function mixedBytes(text) {
  const output = [];
  for (let index = 0; index < text.length;) {
    if (text.startsWith('[[', index)) { output.push(91); index += 2; }
    else if (text.slice(index, index + 5).toUpperCase() === '[HEX:') {
      const end = text.indexOf(']', index + 5);
      if (end < 0) throw new Error('HEX 块缺少右方括号');
      const hex = text.slice(index + 5, end).replace(/0x/gi, '').replace(/\s/g, '');
      if (!hex || !/^(?:[\da-f]{2})+$/i.test(hex)) throw new Error('HEX 块必须包含完整字节，例如 [HEX:00 FF]');
      for (let offset = 0; offset < hex.length; offset += 2) output.push(parseInt(hex.slice(offset, offset + 2), 16));
      index = end + 1;
    } else { const code = text.charCodeAt(index++); if (code > 127) throw new Error('混发模式的文本部分仅支持 ASCII；非 ASCII 字节请使用 HEX 块'); output.push(code); }
    if (output.length > 65536) throw new Error('单次发送不能超过 64 KiB');
  }
  return Uint8Array.from(output);
}
