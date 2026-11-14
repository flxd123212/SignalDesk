import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cppLanguage } from '@codemirror/lang-cpp';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { IconButton } from './ui';

function ConsoleCode({ code, language, notify }: { code: string; language: string; notify: (message: string, error?: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const content = useMemo(() => {
    const parser = /^(c|cpp|c\+\+|h|hpp|ino|arduino)$/i.test(language) ? cppLanguage.parser : /^(js|javascript|jsx|ts|typescript)$/i.test(language) ? javascriptLanguage.parser : null;
    if (!parser) return code;
    const spans: ReactNode[] = []; let end = 0;
    highlightTree(parser.parse(code), classHighlighter, (from, to, classes) => {
      if (from > end) spans.push(code.slice(end, from));
      spans.push(<span key={from} className={classes}>{code.slice(from, to)}</span>); end = to;
    });
    if (end < code.length) spans.push(code.slice(end));
    return spans;
  }, [code, language]);
  return <div className="console-code"><div className="console-code-heading"><span>{language || 'text'}</span><IconButton title={copied ? '代码已复制' : '复制代码'} onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { notify('无法复制代码，请检查剪贴板权限', true); } }}>{copied ? <Check size={13} /> : <Copy size={13} />}</IconButton></div><pre><code>{content}</code></pre></div>;
}

export function AgentConsoleOutput({ content, notify }: { content: string; notify: (message: string, error?: boolean) => void }) {
  const parts: ReactNode[] = []; let cursor = 0;
  const prose = (text: string, key: number) => <span key={`text-${key}`} className="console-prose">{text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g).map((part, index) => part.startsWith('`') && part.endsWith('`') ? <code key={index}>{part.slice(1, -1)}</code> : part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : part)}</span>;
  for (const match of content.matchAll(/```([\w+#.-]*)[^\S\r\n]*\r?\n([\s\S]*?)(?:```|$)/g)) {
    if (match.index! > cursor) parts.push(prose(content.slice(cursor, match.index), cursor));
    parts.push(<ConsoleCode key={`code-${match.index}`} language={match[1]} code={match[2].replace(/\r?\n$/, '')} notify={notify} />);
    cursor = match.index! + match[0].length;
  }
  if (cursor < content.length) parts.push(prose(content.slice(cursor), cursor));
  return <>{parts}</>;
}
