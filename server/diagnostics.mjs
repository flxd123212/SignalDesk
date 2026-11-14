import path from 'node:path';

export function parseDiagnostics(output, root) {
  const diagnostics = [], seen = new Set();
  for (const text of String(output).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').split(/\r?\n/)) {
    let match, filename, line, column = 0, severity, message;
    if ((match = text.match(/^\s*(.+?):(\d+)(?::(\d+))?:\s*(fatal error|error|warning|note)\b\s*:?\s*(.*)$/i))) [, filename, line, column, severity, message] = match;
    else if ((match = text.match(/^\s*"?(.+?)"?\((\d+)(?:,(\d+))?\)\s*:\s*(fatal error|error|warning|note)\b\s*(.*)$/i))) [, filename, line, column, severity, message] = match;
    else if ((match = text.match(/^\s*"(.+?)",\s*(\d+)\s+(Fatal error|Error|Warning|Remark)(.*)$/i))) [, filename, line, severity, message] = match;
    else if ((match = text.match(/\*\*\*\s+(ERROR|WARNING)\s+(\w+)\s+IN LINE\s+(\d+)\s+OF\s+(.+?):\s*(.*)$/i))) { severity = match[1]; message = `${match[2]} ${match[5]}`; line = match[3]; filename = match[4]; }
    else continue;
    const resolved = path.resolve(root, filename.trim().replace(/^"|"$/g, '')), relative = path.relative(root, resolved);
    const source = relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : '';
    const item = { path: source, location: filename.trim(), line: Math.min(10000000, Number(line) || 1), column: Number(column) || 0, severity: /error/i.test(severity) ? 'error' : /warning/i.test(severity) ? 'warning' : 'info', message: message.trim().slice(0, 2000) };
    const key = JSON.stringify(item); if (!seen.has(key)) { seen.add(key); diagnostics.push(item); }
    if (diagnostics.length >= 200) break;
  }
  return diagnostics;
}

export function validationResult(job) {
  if (!job) return null;
  const kind = job.validation?.kind || 'build';
  let summary = job.status === 'running' ? '正在执行' : job.status === 'cancelled' ? '已取消，验证未完成' : job.status === 'failed' ? '未通过' : kind === 'configure' ? 'CMake 配置完成；可以开始编译' : kind === 'test-build' ? '测试固件编译通过；未执行测试用例' : kind === 'build' ? '工程编译通过；尚未验证设备运行' : '测试命令完成；用例数量未识别';
  const matches = [...job.output.matchAll(/(\d+)% tests passed,\s*(\d+) tests failed out of\s*(\d+)/gi)], last = matches.at(-1);
  const tests = last ? { total: Number(last[3]), failed: Number(last[2]), passed: Number(last[3]) - Number(last[2]) } : null;
  if (kind === 'test' && tests && ['succeeded', 'failed'].includes(job.status)) summary = `${tests.passed}/${tests.total} 个用例通过${tests.failed ? `，${tests.failed} 个失败` : ''}${job.status === 'failed' && !tests.failed ? '；测试命令异常退出' : ''}`;
  if (kind === 'test' && (tests?.total === 0 || /No tests were found/i.test(job.output))) summary = '未发现测试用例，不能判定通过';
  const sourceState = job.validation?.sourceState;
  if (job.status === 'succeeded' && kind === 'configure' && job.validation?.label === 'GCC 配置') summary = 'GCC 交叉工具链配置完成；可以开始编译';
  if (sourceState === 'changed') summary += '；源码已变化，需要重新验证';
  if (sourceState === 'unavailable') summary += '；未能复核源码版本';
  return { ...job, summary, tests, elapsedMs: Math.max(0, (job.finishedAt ? Date.parse(job.finishedAt) : Date.now()) - Date.parse(job.startedAt)), diagnostics: job.diagnostics || [] };
}
