import { useEffect, useState } from 'react';
import { Download, Play, Square } from 'lucide-react';
import { api, download } from './data';
import { IncidentDialog } from './FieldDiagnostics';

type Metric = { total: number; count: number; max: number };
type Run = {
  id: string;
  status: string;
  firmware: string;
  startedAt: number;
  finishedAt?: number;
  passed: number;
  failed: number;
  timeouts: number;
  longestSilence: number;
  startup: Metric;
  response: Metric;
  firstFailure?: { at: number; reason: string; incident?: string };
  storageError?: string;
};
type State = { current: Run | null; history: Run[] };
const labels: Record<string, string> = {
  running: '运行中',
  passed: '通过',
  failed: '失败',
  interrupted: '服务中断',
  cancelled: '已停止',
  incomplete: '没有完整轮次',
};
const average = (m: Metric) => (m.count ? (m.total / m.count).toFixed(1) : '—');
export function SoakPanel({
  scope,
  options,
  review,
}: {
  scope: { deviceId: string; root: string };
  options: { recipe: string; firmware: string; supply: string };
  review: (s: string) => void;
}) {
  const [data, setData] = useState<State>({ current: null, history: [] }),
    [error, setError] = useState(''),
    [incident, setIncident] = useState(''),
    [busy, setBusy] = useState(false),
    [baseline, setBaseline] = useState('');
  const [mode, setMode] = useState('count'),
    [cycles, setCycles] = useState(1000),
    [hours, setHours] = useState(8),
    [interval, setIntervalMs] = useState(500),
    [keep, setKeep] = useState(false);
  useEffect(() => {
    let live = true,
      t: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const state = await api<State>(`/soak/state?${new URLSearchParams(scope)}`);
        if (live) setData(state);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) t = setTimeout(refresh, 1500);
      }
    };
    void refresh();
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [scope.root, scope.deviceId]);
  const r = data.current,
    active = r?.status === 'running',
    history = data.history.filter((b) => b.id !== r?.id),
    other = history.find((b) => b.id === baseline);
  async function act() {
    setBusy(true);
    setError('');
    try {
      if (active) await api('/soak/stop', { ...scope, id: r?.id });
      else {
        const sequence = JSON.parse(options.recipe);
        if (!Array.isArray(sequence) || !sequence.length) throw new Error('请填写自定义台架步骤');
        const run = await api<Run>('/soak/start', {
          ...scope,
          options: { ...options, sequence, mode, cycles, hours, interval, continueOnFailure: keep },
        });
        setData((d) => ({ ...d, current: run }));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="lab-body">
      <summary>长时间稳定性测试</summary>
      <fieldset disabled={active || busy}>
        <div className="bench-fields">
          <label>
            结束条件
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="count">按循环次数</option>
              <option value="time">按运行时长</option>
            </select>
          </label>
          {mode === 'count' ? (
            <label>
              循环次数
              <input
                type="number"
                min={1}
                max={1000000}
                value={cycles}
                onChange={(e) => setCycles(+e.target.value)}
              />
            </label>
          ) : (
            <label>
              运行小时
              <input
                type="number"
                min={0.001}
                max={168}
                step="any"
                value={hours}
                onChange={(e) => setHours(+e.target.value)}
              />
            </label>
          )}
          <label>
            轮间隔 / ms
            <input
              type="number"
              min={10}
              value={interval}
              onChange={(e) => setIntervalMs(+e.target.value)}
            />
          </label>
          <label>
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
            失败后继续
          </label>
        </div>
      </fieldset>
      <button disabled={busy} onClick={() => void act()}>
        {active ? <Square size={14} /> : <Play size={14} />}{' '}
        {active ? '停止长稳测试' : options.supply ? '循环上电并执行台架步骤' : '循环执行台架步骤'}
      </button>
      {error && <p role="alert">{error}</p>}
      {r && (
        <>
          <b>
            {labels[r.status]} · {r.firmware || '未标记版本'} · 成功 {r.passed} / 失败 {r.failed}
          </b>
          {!!history.length && (
            <label>
              比较基线
              <select value={baseline} onChange={(e) => setBaseline(e.target.value)}>
                <option value="">选择历史运行</option>
                {history.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.firmware || '未标记'} · {new Date(b.startedAt).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="lab-scroll">
            <table>
              <thead>
                <tr>
                  <th>运行</th>
                  <th>超时次数</th>
                  <th>最长无接收 / ms</th>
                  <th>平均启动 / ms</th>
                  <th>平均响应 / ms</th>
                </tr>
              </thead>
              <tbody>
                {[r, ...(other ? [other] : [])].map((b, i) => (
                  <tr key={b.id}>
                    <td>{i ? '基线' : '当前'}</td>
                    <td>{b.timeouts}</td>
                    <td>{b.longestSilence}</td>
                    <td>{average(b.startup)}</td>
                    <td>{average(b.response)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.firstFailure && (
            <div>
              首次失败 · {new Date(r.firstFailure.at).toLocaleString()} · {r.firstFailure.reason}{' '}
              {r.firstFailure.incident && (
                <button onClick={() => setIncident(r.firstFailure!.incident!)}>查看现场</button>
              )}
            </div>
          )}
          {r.storageError && <p role="alert">{r.storageError}</p>}
          <button
            onClick={() => download(`soak-${r.id}.json`, JSON.stringify(r, null, 2), 'application/json')}
          >
            <Download size={14} />
            导出长稳报告
          </button>
        </>
      )}
      {incident && <IncidentDialog id={incident} close={() => setIncident('')} review={review} />}
    </details>
  );
}
