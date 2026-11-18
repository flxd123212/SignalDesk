import { useEffect, useRef, useState } from 'react';
import { Bug, Code2, PencilLine, Save, X } from 'lucide-react';
import { diffLines } from 'diff';
import { api } from './data';
import { Editor } from './Editor';
import { languageForFile } from './languages';
import { IconButton } from './ui';

type Location = { path: string; line: number; column: number; text: string };
type Props = {
  root: string;
  deviceId: string;
  file: string;
  content: string;
  hash: string;
  line: number;
  column: number;
  reload: () => void;
};
type Draft = { content: string; hash: string; original: string };
const drafts = new Map<string, Draft>();
export function SourceActions({ root, deviceId, file, content, hash, line, column, reload }: Props) {
  const [mode, setMode] = useState<'' | 'edit' | 'symbols' | 'changes'>(''),
    [draft, setDraft] = useState<Draft>(),
    [diff, setDiff] = useState(false);
  const previous = useRef<Draft | undefined>(undefined),
    [lastChange, setLastChange] = useState<Draft>();
  useEffect(() => {
    if (!hash || previous.current?.hash === hash) return;
    const original = previous.current?.content;
    previous.current = { hash, original: content, content };
    if (original !== undefined) setLastChange({ hash, original, content });
  }, [hash, content]);
  const [results, setResults] = useState<Location[]>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const key = JSON.stringify([deviceId, root, file]),
    dbKey = JSON.stringify(['signaldesk.compile-db', root]);
  const [database, setDatabase] = useState(() => localStorage.getItem(dbKey) || '');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!mode) return;
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, [mode]);
  const edit = () => {
    setDraft(drafts.get(key) || { content, hash, original: content });
    setError('');
    setDiff(false);
    setMode('edit');
  };
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/source/save', {
        deviceId,
        root,
        path: file,
        content: draft.content,
        expectedHash: draft.hash,
      });
      drafts.delete(key);
      setMode('');
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function query(action: string) {
    setError('');
    setResults(undefined);
    setBusy(true);
    try {
      const items = await api<Location[]>('/source/query', {
        deviceId,
        root,
        path: file,
        line,
        column,
        database,
        mode: action,
      });
      setResults(items);
      if (action === 'diagnostics')
        window.dispatchEvent(
          new CustomEvent('signaldesk-source-diagnostics', { detail: { file, hash, items } }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <IconButton title="编辑源码" disabled={!hash || !root} onClick={edit}>
        <PencilLine size={15} />
      </IconButton>
      <IconButton
        title="clangd 诊断、定义与引用"
        disabled={!hash || !root}
        onClick={() => {
          setMode('symbols');
          setError('');
          setResults(undefined);
        }}
      >
        <Code2 size={15} />
      </IconButton>
      <IconButton
        title="调试当前源码行"
        disabled={!hash || !root}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent('signaldesk-lab', { detail: { kind: 'probe', path: file, line } }),
          )
        }
      >
        <Bug size={15} />
      </IconButton>
      {lastChange && (
        <button className="quiet-button" onClick={() => setMode('changes')}>
          最近增删
        </button>
      )}
      {mode && (
        <dialog
          className="command-palette source-action-dialog"
          ref={dialog}
          onCancel={(e) => {
            e.preventDefault();
            if (!busy) setMode('');
          }}
          aria-label={
            mode === 'edit' ? '编辑项目文件' : mode === 'changes' ? '最近源码变化' : '工程符号'
          }
        >
          <header className="panel-toolbar">
            <b>{file}</b>
            <span>{mode === 'edit' ? '编辑源码' : `clangd · ${line}:${column}`}</span>
            <IconButton title="关闭源码工具" disabled={busy} onClick={() => setMode('')}>
              <X size={14} />
            </IconButton>
          </header>
          {mode === 'changes' && lastChange ? (
            <pre className="source-diff">
              {diffLines(lastChange.original, lastChange.content, { timeout: 500 })?.map((part, i) => (
                <span key={i} className={part.added ? 'added' : part.removed ? 'removed' : ''}>
                  {part.value}
                </span>
              ))}
            </pre>
          ) : mode === 'edit' && draft ? (
            <div
              className="source-edit-body"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                  e.preventDefault();
                  if (draft.content !== draft.original) void save();
                }
              }}
            >
              {diff ? (
                <pre className="source-diff">
                  {diffLines(draft.original, draft.content, { timeout: 500 })?.map((part, i) => (
                    <span key={i} className={part.added ? 'added' : part.removed ? 'removed' : ''}>
                      {part.value}
                    </span>
                  ))}
                </pre>
              ) : (
                <Editor
                  language={languageForFile(file)}
                  value={draft.content}
                  readOnly={busy}
                  onChange={(text) => {
                    const next = { ...draft, content: text };
                    setDraft(next);
                    drafts.set(key, next);
                  }}
                />
              )}
              <div className="lab-strip">
                <button onClick={() => setDiff(!diff)}>{diff ? '返回编辑' : '查看增删'}</button>
                <button
                  disabled={busy}
                  onClick={() => {
                    setDraft({ original: content, content, hash });
                    drafts.delete(key);
                    setError('');
                  }}
                >
                  恢复磁盘版本
                </button>
                <button
                  className="primary"
                  disabled={busy || draft.content === draft.original}
                  onClick={() => void save()}
                >
                  <Save size={14} />
                  保存
                </button>
              </div>
            </div>
          ) : (
            <div className="lab-body">
              <label>
                编译数据库
                <input
                  value={database}
                  placeholder="自动查找，或 build/compile_commands.json"
                  onChange={(e) => {
                    setDatabase(e.target.value);
                    localStorage.setItem(dbKey, e.target.value);
                  }}
                />
              </label>
              <div className="lab-strip">
                {[
                  ['diagnostics', '文件诊断'],
                  ['definition', '转到定义'],
                  ['references', '查找引用'],
                ].map(([id, name]) => (
                  <button key={id} disabled={busy} onClick={() => void query(id)}>
                    {name}
                  </button>
                ))}
              </div>
              {busy && <p>正在查询 clangd…</p>}
              {results &&
                (results.length ? (
                  results.map((r, i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setMode('');
                        window.dispatchEvent(
                          new CustomEvent('signaldesk-source-location', { detail: r }),
                        );
                      }}
                    >
                      {r.path}:{r.line} · {r.text}
                    </button>
                  ))
                ) : (
                  <p>没有匹配结果</p>
                ))}
            </div>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
        </dialog>
      )}
    </>
  );
}
