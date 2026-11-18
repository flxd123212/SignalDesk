import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Download, Send, X } from 'lucide-react';
import { api, dataStore, download, useDataRevision } from './data';
import { IconButton } from './ui';
import type { AppState } from './types';

type Row = { at: number; type: string; data?: string; values?: number[]; truncated?: boolean };
type Incident = {
  kind: string;
  id: string;
  at: number;
  end: number;
  name: string;
  port: string;
  source: string;
  alarm: string;
  before: Row[];
  after: Row[];
  lastTx: Row | null;
  lastSample: Row | null;
  channels: string[];
  reconnectedAt: number | null;
  beforeDropped: number;
  afterDropped: number;
  firmware?: { version: string } | null;
  status: string;
};
const stamp = (time: number) =>
  new Date(time).toLocaleTimeString('zh-CN', { hour12: false, fractionalSecondDigits: 3 });
function content(row: Row) {
  if (!row.data) return row.values?.join(', ') || row.type;
  const bytes = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes).slice(0, 400) + (row.truncated ? '…' : '');
}
function Trace({ points, label }: { points: { x: number; y: number }[]; label: string }) {
  if (!points.length) return <p className="muted">暂无{label}</p>;
  const first = points[0].x,
    last = points.at(-1)!.x,
    ys = points.map((p) => p.y),
    lo = Math.min(...ys),
    hi = Math.max(...ys);
  return (
    <figure className="field-trace">
      <svg viewBox="0 0 600 85" role="img" aria-label={label} preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          points={points
            .map(
              (p) =>
                `${((p.x - first) / (last - first || 1)) * 598 + 1},${80 - (hi === lo ? 0.5 : (p.y - lo) / (hi - lo)) * 75}`,
            )
            .join(' ')}
        />
      </svg>
      <figcaption>
        {label} · {lo.toFixed(3)} ～ {hi.toFixed(3)}
      </figcaption>
    </figure>
  );
}
export function IncidentDialog({
  id,
  close,
  review,
}: {
  id: string;
  close: () => void;
  review?: (text: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    [report, setReport] = useState<Incident>(),
    [error, setError] = useState(''),
    [ch, setCh] = useState(0);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const r = await api<Incident>('/alarms/incident/' + encodeURIComponent(id));
        if (live) {
          setReport(r);
          if (r.status === 'collecting' || (!r.reconnectedAt && r.kind === 'connection'))
            timer = setTimeout(refresh, 1500);
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    }
    void refresh();
    return () => {
      live = false;
      clearTimeout(timer);
      el?.close();
    };
  }, [id]);
  const rows = report ? [...report.before, ...report.after] : [],
    packets = rows.filter((r) => r.type !== 'sample');
  return (
    <dialog className="command-palette engineering-lab" aria-label="故障现场" ref={ref} onCancel={close}>
      <header className="panel-toolbar">
        <b>故障现场</b>
        <IconButton title="关闭现场" onClick={close}>
          <X size={15} />
        </IconButton>
      </header>
      <div className="lab-body">
        {error && <p role="alert">{error}</p>}
        {report && (
          <>
            <strong>
              {report.name} · {report.alarm}
            </strong>
            <span>
              {stamp(report.at)} · {report.port} · {report.source} · 固件{' '}
              {report.firmware?.version || '未上报'}
            </span>
            <div className="field-facts">
              <span>
                最后发送{' '}
                <b>
                  {report.lastTx ? `${stamp(report.lastTx.at)} ${content(report.lastTx)}` : '无记录'}
                </b>
              </span>
              <span>
                最后采样{' '}
                <b>
                  {report.lastSample
                    ? `${stamp(report.lastSample.at)} ${content(report.lastSample)}`
                    : '无记录'}
                </b>
              </span>
              <span>
                重新连接 <b>{report.reconnectedAt ? stamp(report.reconnectedAt) : '未记录'}</b>
              </span>
            </div>
            <label>
              波形通道
              <select value={ch} onChange={(e) => setCh(+e.target.value)}>
                {(report.channels.length ? report.channels : ['CH1']).map((n, i) => (
                  <option key={i} value={i}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <Trace
              label="现场波形"
              points={rows
                .filter((r) => Number.isFinite(r.values?.[ch]))
                .map((r) => ({ x: r.at, y: r.values![ch] }))}
            />
            <div className="lab-scroll">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>方向 / 事件</th>
                    <th>报文</th>
                  </tr>
                </thead>
                <tbody>
                  {packets.slice(-150).map((r, i) => (
                    <tr key={i}>
                      <td>{stamp(r.at)}</td>
                      <td>{r.type}</td>
                      <td>
                        <code>{content(r)}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small>
              {report.status === 'collecting'
                ? '正在记录触发后 20 秒'
                : report.status === 'complete'
                  ? '记录完成'
                  : '记录提前结束'}{' '}
              · {rows.length} 条 · 缓存丢弃 {report.beforeDropped + report.afterDropped}
            </small>
            <div className="lab-strip">
              <button
                onClick={() =>
                  download(`incident-${id}.json`, JSON.stringify(report, null, 2), 'application/json')
                }
              >
                <Download size={14} />
                导出现场
              </button>
              {review && (
                <button
                  onClick={() => {
                    close();
                    review(
                      `分析故障现场 ${id}。仅依据下列时刻与报文，区分推测和实测。\n${JSON.stringify({
                        alarm: report.alarm,
                        trigger: report.at,
                        source: report.source,
                        port: report.port,
                        lastTx: report.lastTx,
                        lastSample: report.lastSample,
                        reconnectedAt: report.reconnectedAt,
                        around: packets
                          .filter((r) => Math.abs(r.at - report.at) <= 1000)
                          .slice(-12)
                          .map((r) => [r.at, r.type, content(r)]),
                      }).slice(0, 7500)}`,
                    );
                  }}
                >
                  交给 Agent 分析
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

const defaultParam = {
  name: '目标值',
  unit: '',
  min: 0,
  max: 100,
  value: 0,
  writeCommand: '',
  readCommand: '',
  format: 'json',
  field: '',
  channel: 0,
  ending: 'lf',
};
type Param = typeof defaultParam;
type Reply = { requested: number; reported: number; receivedAt: number; status: string };
export function TuningPanel({ state }: { state: AppState }) {
  const deviceId = state.activeDevice || '',
    root = state.devices?.find((d) => d.id === deviceId)?.projectRoot || '',
    key = JSON.stringify(['signaldesk.tuning', deviceId, root]);
  const [params, setParams] = useState<Param[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(key) || 'null') || [{ ...defaultParam }];
      } catch {
        return [{ ...defaultParam }];
      }
    }),
    [index, setIndex] = useState(0),
    [reply, setReply] = useState<Reply>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [requested, setRequested] = useState<number>();
  useDataRevision();
  const p = params[index];
  const points = dataStore.samples
    .slice(-300)
    .filter((s) => Number.isFinite(s.values[p.channel]))
    .map((s) => ({ x: s.time, y: s.values[p.channel] }));
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(params));
  }, [key, params]);
  function clear() {
    setReply(undefined);
    setRequested(undefined);
    setError('');
  }
  const edit = (patch: Partial<Param>) => {
    clear();
    setParams((old) => old.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  };
  const field = (k: keyof Param, label: string, numeric = false, placeholder = '') => (
    <label>
      {label}
      <input
        type={numeric ? 'number' : 'text'}
        step={numeric ? 'any' : undefined}
        value={p[k]}
        placeholder={placeholder}
        onChange={(e) => edit({ [k]: numeric ? +e.target.value : e.target.value })}
      />
    </label>
  );
  async function apply() {
    setBusy(true);
    setReply(undefined);
    setRequested(p.value);
    setError('');
    try {
      setReply(await api<Reply>('/tuning/apply', { deviceId, root, ...p }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset disabled={busy}>
      <div className="lab-strip">
        <select
          aria-label="参数绑定"
          value={index}
          onChange={(e) => {
            clear();
            setIndex(+e.target.value);
          }}
        >
          {params.map((v, i) => (
            <option key={i} value={i}>
              {v.name}
            </option>
          ))}
        </select>
        <IconButton
          title="添加参数"
          disabled={params.length >= 32}
          onClick={() => {
            clear();
            setIndex(params.length);
            setParams([...params, { ...defaultParam }]);
          }}
        >
          <Plus size={15} />
        </IconButton>
        <IconButton
          title="删除参数"
          disabled={params.length === 1}
          onClick={() => {
            clear();
            setIndex(0);
            setParams(params.filter((_, i) => i !== index));
          }}
        >
          <Trash2 size={15} />
        </IconButton>
      </div>
      <details open>
        <summary>参数与命令绑定</summary>
        <div className="bench-fields">
          {field('name', '名称')}
          {field('unit', '单位')}
          {field('min', '下限', true)}
          {field('max', '上限', true)}
          {field('writeCommand', '写命令', false, 'SET TEMP {value}')}
          {field('readCommand', '读回命令（可选）', false, 'GET TEMP')}
          <label>
            回报格式
            <select value={p.format} onChange={(e) => edit({ format: e.target.value })}>
              <option value="json">JSON 行</option>
              <option value="prefix">文本前缀</option>
            </select>
          </label>
          {field(
            'field',
            p.format === 'json' ? '回报字段路径' : '回报前缀',
            false,
            p.format === 'json' ? 'config.target' : 'TEMP=',
          )}
          <label>
            行结束符
            <select value={p.ending} onChange={(e) => edit({ ending: e.target.value })}>
              {['lf', 'crlf', 'cr', 'none'].map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label>
            传感器通道
            <select value={p.channel} onChange={(e) => edit({ channel: +e.target.value })}>
              {Array.from({ length: 16 }, (_, i) => (
                <option key={i} value={i}>
                  {state.names[i] || `CH${i + 1}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      <div className="lab-strip">
        {field('value', `设定值 ${p.unit}`, true)}
        <button
          className="primary"
          disabled={
            !state.connected ||
            !p.writeCommand.includes('{value}') ||
            !p.field ||
            p.value < p.min ||
            p.value > p.max
          }
          onClick={() => void apply()}
        >
          <Send size={14} />
          写入并读回
        </button>
      </div>
      <div className="field-facts">
        <span>
          请求值 <b>{requested ?? '—'}</b>
        </span>
        <span>
          设备读回 <b>{reply?.reported ?? '—'}</b>
        </span>
        <span>
          传感器实测 <b>{points.at(-1)?.y ?? '—'}</b>
        </span>
      </div>
      <Trace label={`CH${p.channel + 1} 实测`} points={points} />
      {busy && <p>等待设备回报…</p>}
      {reply && (
        <p>
          {reply.status === 'matched' ? '读回一致' : '读回不一致'} · {stamp(reply.receivedAt)}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
