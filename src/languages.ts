import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { java, csharp } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { gasArm } from '@codemirror/legacy-modes/mode/gas';
import { verilog } from '@codemirror/legacy-modes/mode/verilog';
import { properties } from '@codemirror/legacy-modes/mode/properties';

export const languages = {
  text: { label: '纯文本', extension: () => [] }, cpp: { label: 'C / C++ / Arduino', extension: cpp },
  javascript: { label: 'JavaScript', extension: () => javascript({ jsx: true }) }, typescript: { label: 'TypeScript', extension: () => javascript({ typescript: true, jsx: true }) },
  python: { label: 'Python / MicroPython', extension: python }, rust: { label: 'Rust', extension: rust },
  json: { label: 'JSON', extension: json }, yaml: { label: 'YAML', extension: yaml }, xml: { label: 'XML', extension: xml },
  html: { label: 'HTML', extension: html }, css: { label: 'CSS', extension: css }, markdown: { label: 'Markdown', extension: markdown },
  go: { label: 'Go', extension: () => StreamLanguage.define(go) }, lua: { label: 'Lua', extension: () => StreamLanguage.define(lua) },
  java: { label: 'Java', extension: () => StreamLanguage.define(java) }, csharp: { label: 'C#', extension: () => StreamLanguage.define(csharp) },
  shell: { label: 'Shell', extension: () => StreamLanguage.define(shell) }, powershell: { label: 'PowerShell', extension: () => StreamLanguage.define(powerShell) },
  toml: { label: 'TOML', extension: () => StreamLanguage.define(toml) }, cmake: { label: 'CMake', extension: () => StreamLanguage.define(cmake) },
  asm: { label: 'ARM Assembly', extension: () => StreamLanguage.define(gasArm) }, verilog: { label: 'Verilog / SystemVerilog', extension: () => StreamLanguage.define(verilog) },
  ini: { label: 'INI', extension: () => StreamLanguage.define(properties) },
};
export type LanguageId = keyof typeof languages;
export function languageForFile(file: string): LanguageId {
  const name = file.split(/[\\/]/).at(-1)?.toLowerCase() || '', ext = name.split('.').at(-1) || '';
  if (name === 'cmakelists.txt') return 'cmake';
  const map: Record<string, LanguageId> = { c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp', ino: 'cpp', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', pyi: 'python', rs: 'rust', go: 'go', lua: 'lua', java: 'java', cs: 'csharp', json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml', uvprojx: 'xml', uvproj: 'xml', ewp: 'xml', eww: 'xml', html: 'html', css: 'css', md: 'markdown', sh: 'shell', bash: 'shell', ps1: 'powershell', toml: 'toml', cmake: 'cmake', s: 'asm', asm: 'asm', v: 'verilog', sv: 'verilog', vh: 'verilog', svh: 'verilog', ini: 'ini', ioc: 'ini' };
  return map[ext] || 'text';
}
