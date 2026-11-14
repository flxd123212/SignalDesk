import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { cpp } from '@codemirror/lang-cpp';
import { HighlightStyle, foldGutter, foldKeymap, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { usePreferences } from './preferences';

const sourceColors = HighlightStyle.define([
  { tag: tags.keyword, color: '#86bdf5' },
  { tag: [tags.controlKeyword, tags.moduleKeyword], color: '#d2a5dc' },
  { tag: [tags.typeName, tags.className], color: '#66d2bd' },
  { tag: [tags.variableName, tags.propertyName], color: '#b7dcee' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#e9d793' },
  { tag: [tags.string, tags.character], color: '#e6b093' },
  { tag: [tags.number, tags.bool, tags.null], color: '#b9d99b' },
  { tag: tags.comment, color: '#86af78', fontStyle: 'italic' },
  { tag: [tags.meta, tags.processingInstruction], color: '#c4acd9' },
  { tag: [tags.operator, tags.punctuation], color: '#cbd5df' },
  { tag: tags.invalid, color: '#f28c8c', textDecoration: 'underline' },
]);

export function Editor({ value, onChange, readOnly = false, plain = false, line = 0, language, onCursor }: { value: string; onChange: (value: string) => void; readOnly?: boolean; plain?: boolean; line?: number; language?: 'cpp'; onCursor?: (line: number, column: number) => void }) {
  const container = useRef<HTMLDivElement>(null), view = useRef<EditorView | null>(null), change = useRef(onChange);
  const preferences = usePreferences(), wrapping = useRef(new Compartment());
  const cursor = useRef(onCursor); cursor.current = onCursor;
  change.current = onChange;
  useEffect(() => {
    if (!container.current) return;
    view.current = new EditorView({ parent: container.current, state: EditorState.create({ doc: value, extensions: [
      lineNumbers(), history(), ...(language === 'cpp' ? [cpp()] : plain ? [] : [javascript()]), syntaxHighlighting(sourceColors), ...(readOnly ? [foldGutter(), keymap.of(foldKeymap)] : []), highlightActiveLine(), keymap.of([...defaultKeymap, ...historyKeymap]), wrapping.current.of(preferences.editorWrap ? EditorView.lineWrapping : []),
      EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly), EditorView.contentAttributes.of({ 'aria-label': readOnly ? '项目源码内容' : '代码编辑器', ...(readOnly ? { tabindex: '0' } : {}) }),
      EditorView.updateListener.of(update => { if (update.docChanged) change.current(update.state.doc.toString()); if (update.selectionSet || update.docChanged) { const position = update.state.selection.main.head, current = update.state.doc.lineAt(position); cursor.current?.(current.number, position - current.from + 1); } }),
      EditorView.theme({ '&': { height: '100%', fontSize: '14px', backgroundColor: '#191c20', color: '#cbd4d5' }, '.cm-content': { fontFamily: 'Consolas, monospace', padding: '20px 0' }, '.cm-line': { paddingLeft: '12px', lineHeight: '1.9' }, '.cm-gutters': { backgroundColor: '#191c20', color: '#5e6872', border: 'none', paddingTop: '20px' }, '.cm-activeLine': { backgroundColor: '#22282b' }, '.cm-cursor': { borderLeftColor: '#64d9b4' }, '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#31534a' } }, { dark: true }),
    ] }) });
    return () => { view.current?.destroy(); view.current = null; };
  }, [readOnly, plain, language]);
  useEffect(() => { view.current?.dispatch({ effects: wrapping.current.reconfigure(preferences.editorWrap ? EditorView.lineWrapping : []) }); }, [preferences.editorWrap]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);
  useEffect(() => { const editor = view.current; if (editor && line > 0) { const position = editor.state.doc.line(Math.min(Math.floor(line), editor.state.doc.lines)).from; editor.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: 'center' }) }); } }, [line, value]);
  return <div className="code-editor" ref={container} />;
}
