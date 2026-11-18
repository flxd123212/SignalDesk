import { useEffect, useState } from 'react';
import { Activity, Download, Play, Square } from 'lucide-react';
import { api, download } from './data';
import type { AppState } from './types';
import { ReportTable, type LabReport } from './EngineeringLab';
import { SoakPanel } from './SoakPanel';

export const benchNames = {
  probe: '源码探针调试',
  bench: '台架与 ADC 校准',
  power: '功耗时间轴',
  ble: '蓝牙 GATT',
  can: '实时 CAN / CAN FD',
};
type Kind = keyof typeof benchNames;
type Job = LabReport & {
  id: string;
  action: string;
  status: string;
  error?: string;
  markers: [number, string][];
  startedAt: number;
  device: string;
  firmware: string;
};
type Probe = { state: string; log: string[]; location?: { path: string; line: number } };
const defaults = {
  arch: 'arm',
  port: 3333,
  elf: '',
  path: '',
  line: 1,
  backend: '',
  resource: '',
  supply: '',
  command: '',
  ready: '',
  adcChannel: 0,
  tolerance: 0.01,
  firmware: '',
  recipe: '[\n  {"type":"measure","unit":"V","min":3.1,"max":3.5}\n]',
  joulescope: '',
  seconds: 8,
  address: '',
  characteristic: '',
  hex: '',
  interface: 'socketcan',
  channel: 'can0',
  bitrate: 500000,
  dataBitrate: 2000000,
  fd: false,
};
type Options = typeof defaults;
const status: Record<string, string> = {
  running: '采集中',
  failed: '失败',
  complete: '已完成',
  cancelled: '已停止',
  disconnected: '未连接',
  connecting: '连接中',
  stopped: '暂停',
};

function PowerPlot({ job, profile }: { job: Job; profile: string }) {
  const baselineKey = profile + '.energy';
  const [from, setFrom] = useState(0),
    [to, setTo] = useState(100),
    [baseline, setBaseline] = useState<number | undefined>(() => {
      const v = localStorage.getItem(baselineKey);
      return v === null ? undefined : Number(v);
    });
  if (job.rows.length < 2) return null;
  const rows = job.rows,
    a = Math.round((from * (rows.length - 1)) / 100),
    b = Math.round((to * (rows.length - 1)) / 100);
  const min = Math.min(...rows.map((r) => +r[1])),
    max = Math.max(...rows.map((r) => +r[1])),
    start = +rows[0][0],
    span = +rows.at(-1)![0] - start || 1;
  const points = rows
    .map((r) => `${((+r[0] - start) / span) * 600},${95 - (90 * (+r[1] - min)) / (max - min || 1)}`)
    .join(' ');
  const energy = +rows[b][4] - +rows[a][4];
  return (
    <div className="power-trace">
      <svg
        viewBox="0 0 600 100"
        role="img"
        aria-label="电流与固件串口事件时间轴"
        preserveAspectRatio="none"
      >
        <rect x={from * 6} width={(to - from) * 6} height="100" fill="currentColor" opacity="0.08" />
        <polyline points={points} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />
        {job.markers.slice(-150).map(([t, label], i) => (
          <line
            key={i}
            x1={((t - start) / span) * 600}
            x2={((t - start) / span) * 600}
            y1="87"
            y2="100"
            stroke="#e3b464"
          >
            <title>{label}</title>
          </line>
        ))}
      </svg>
      <div className="lab-strip">
        <label>
          起点
          <input
            type="range"
            min="0"
            max="100"
            value={from}
            onChange={(e) => setFrom(Math.min(to, +e.target.value))}
          />
        </label>
        <label>
          终点
          <input
            type="range"
            min="0"
            max="100"
            value={to}
            onChange={(e) => setTo(Math.max(from, +e.target.value))}
          />
        </label>
        <b>{(energy * 1000).toFixed(3)} mJ</b>
        <button
          onClick={() => {
            setBaseline(energy);
            localStorage.setItem(baselineKey, String(energy));
          }}
        >
          设为比较基线
        </button>
        {baseline !== undefined && <span>差值 {((energy - baseline) * 1000).toFixed(3)} mJ</span>}
      </div>
    </div>
  );
}

export function BenchPanel({
  kind,
  state,
  review,
  close,
  seed,
}: {
  kind: Kind;
  state: AppState;
  review: (s: string) => void;
  close: () => void;
  seed?: { path: string; line: number };
}) {
  const deviceId = state.activeDevice || '',
    root = state.devices?.find((d) => d.id === deviceId)?.projectRoot || '';
  const storage = JSON.stringify(['signaldesk.bench', deviceId, root]);
  const [opts, setOpts] = useState<Options>(() => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(storage) || '{}');
    } catch {}
    return {
      ...defaults,
      ...(navigator.userAgent.includes('Windows') ? { interface: 'pcan', channel: 'PCAN_USBBUS1' } : {}),
      ...saved,
      ...seed,
    };
  });
  const [job, setJob] = useState<Job | null>(null),
    [probe, setProbe] = useState<Probe>({ state: 'disconnected', log: [] }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [choices, setChoices] = useState<Record<string, string[]>>({});
  const [wave, setWave] = useState(false),
    [dbc, setDbc] = useState(''),
    [decoded, setDecoded] = useState<LabReport>(),
    [expectedId, setExpectedId] = useState(''),
    [timeoutMs, setTimeoutMs] = useState(100);
  const scope = { deviceId, root };
  useEffect(() => {
    localStorage.setItem(storage, JSON.stringify(opts));
  }, [storage, opts]);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const qs = new URLSearchParams(scope);
        if (kind === 'probe') {
          const p = await api<Probe>(`/probe/state?${qs}`);
          if (live) setProbe(p);
        } else {
          const j = await api<Job | null>(`/bench/state?${qs}`);
          if (live) {
            setJob(j);
            if (
              j?.status === 'complete' &&
              ['visa.list', 'power.list', 'ble.scan', 'ble.services'].includes(j.action)
            ) {
              const ix = j.action === 'ble.services' ? 2 : 0;
              setChoices((old) => ({ ...old, [j.action]: j.rows.map((r) => String(r[ix])) }));
            }
          }
        }
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) timer = setTimeout(poll, 850);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [kind, root, deviceId]);
  useEffect(() => {
    if (kind !== 'probe' || !root) return;
    let active = true;
    api<{ paths: string[] }>(`/debug/artifacts?${new URLSearchParams(scope)}`)
      .then((r) => {
        if (active) setChoices((c) => ({ ...c, elf: r.paths }));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [kind, root, deviceId]);
  const change = <K extends keyof Options>(key: K, value: Options[K]) =>
    setOpts((p) => ({ ...p, [key]: value }));
  const input = (key: keyof Options, label: string, list?: string[], placeholder = '') => (
    <label>
      {label}
      <input
        list={list ? `bench-${key}` : undefined}
        aria-label={label}
        value={String(opts[key])}
        placeholder={placeholder}
        type={typeof defaults[key] === 'number' ? 'number' : 'text'}
        step={key === 'tolerance' ? 'any' : undefined}
        onChange={(e) =>
          change(key, typeof defaults[key] === 'number' ? Number(e.target.value) : e.target.value)
        }
      />
      {list && (
        <datalist id={`bench-${key}`}>
          {list.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </datalist>
      )}
    </label>
  );
  const select = (key: keyof Options, label: string, values: [string, string][]) => (
    <label>
      {label}
      <select value={String(opts[key])} onChange={(e) => change(key, e.target.value)}>
        {values.map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
  async function act(action: string) {
    setBusy(true);
    setError('');
    try {
      if (kind === 'probe') setProbe(await api<Probe>('/probe/action', { ...scope, ...opts, action }));
      else {
        const sequence=action==='bench.sequence'?JSON.parse(opts.recipe):undefined;
        if(action==='bench.sequence' && (!Array.isArray(sequence)||!sequence.length))throw new Error('请至少添加一个步骤');
        setDecoded(undefined);
        setJob(
          await api<Job>(action === 'stop' ? '/bench/stop' : '/bench/start', {
            ...scope,
            id: job?.id,
            action:action==='bench.sequence'?'bench.test':action,
            options: { ...opts, wave, sequence },
          }),
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const active = job?.status === 'running';
  const button = (id: string, name: string, disabled = false) => (
    <button
      type="button"
      disabled={busy || disabled || (kind !== 'probe' && !!active && id !== 'stop')}
      onClick={() => void act(id)}
    >
      {id === 'stop' ? <Square size={13} /> : <Play size={13} />} {name}
    </button>
  );
  const report =
    job && (job.action.startsWith(kind + '.') || (kind === 'bench' && job.action.startsWith('visa.')))
      ? job
      : null;
  return (
    <>
      <div className="bench-fields">
        {kind === 'probe' && (
          <>
            {select('arch', '目标架构', [
              ['arm', 'Arm Cortex-M'],
              ['riscv', 'RISC-V'],
            ])}
            {input('elf', '调试 ELF', choices.elf, 'build/firmware.elf')}
            {input('port', '本机 GDB Server 端口')}
            {input('path', '断点源码', undefined, 'src/main.c')}
            {input('line', '断点行')}
          </>
        )}
        {kind === 'bench' && (
          <>
            {select('backend', 'VISA 后端', [
              ['', '系统默认'],
              ['@py', 'PyVISA-py'],
            ])}
            {input('resource', '测量仪器', choices['visa.list'])}
            {input('supply', '可控电源（可选）', choices['visa.list'])}
            {input('ready', '启动标志（可选）')}
            {input('command', '采样命令（可选）')}
            {input('adcChannel', 'ADC 通道索引（从 0 开始）')}
            {input('tolerance', '允许误差 / V')}
            {input('firmware', '固件版本或指纹')}
          </>
        )}
        {kind === 'power' && (
          <>
            {input('joulescope', 'Joulescope 设备', choices['power.list'])}
            {input('seconds', '采集时长 / s')}
            {input('firmware', '固件版本或指纹')}
          </>
        )}
        {kind === 'ble' && (
          <>
            {input('address', '蓝牙地址或设备 UUID', choices['ble.scan'])}
            {input('characteristic', '特征 UUID 或句柄', choices['ble.services'])}
            {input('hex', '写入 HEX')}
            {input('seconds', '订阅时长 / s')}
          </>
        )}
        {kind === 'can' && (
          <>
            {select('interface', '适配器', [
              ['socketcan', 'SocketCAN'],
              ['pcan', 'PCAN'],
            ])}
            {input('channel', '接口通道')}
            {input('seconds', '采集时长 / s')}
            <label>
              <input
                type="checkbox"
                checked={opts.fd}
                onChange={(e) => change('fd', e.target.checked)}
              />
              CAN FD
            </label>
            {opts.interface === 'pcan' && (
              <>
                {input('bitrate', '仲裁码率 / bit/s')}
                {opts.fd && input('dataBitrate', '数据码率 / bit/s')}
              </>
            )}
          </>
        )}
        {kind === 'ble' && (
          <label>
            <input type="checkbox" checked={wave} onChange={(e) => setWave(e.target.checked)} />
            将无符号小端通知送入当前设备波形、录制与报警
          </label>
        )}
      </div>
      <div className="lab-strip">
        {kind === 'probe' &&
          (probe.state === 'disconnected' ? (
            button('attach', '连接 GDB Server', !root || !opts.elf)
          ) : (
            <>
              {button('break', '设断点', !opts.path)}
              {button('clear', '清除断点')}
              {button('continue', '继续')}
              {button('pause', '暂停')}
              {button('step', '单步')}
              {button('into', '步入')}
              {button('locals', '局部变量')}
              {button('registers', '寄存器')}
              {button('stack', '调用栈')}
              {button('disconnect', '断开')}
            </>
          ))}
        {kind === 'bench' && (
          <>
            {button('visa.list', '发现仪器')}
            {button('visa.identify', '识别仪表', !opts.resource)}
            {button('visa.measure', '测量电压', !opts.resource)}
            {button('bench.test', opts.supply ? '上电并校准' : '运行 ADC 校准', !opts.resource)}
            <details><summary>自定义台架步骤</summary><label>测试序列<textarea aria-label="台架测试序列" rows={6} value={opts.recipe} onChange={e=>change('recipe',e.target.value)}/></label>{button('bench.sequence',opts.supply?'上电并执行序列':'执行序列',!opts.resource)}</details>
          </>
        )}
        {kind === 'power' && (
          <>
            {button('power.list', '发现 Joulescope')}
            {button('power.capture', '开始功耗采集', !opts.joulescope)}
          </>
        )}
        {kind === 'ble' && (
          <>
            {button('ble.scan', '扫描')}
            {button('ble.services', '枚举特征', !opts.address)}
            {button('ble.read', '读取', !opts.address || !opts.characteristic)}
            {button('ble.notify', '订阅通知', !opts.address || !opts.characteristic)}
            {button('ble.write', '写入', !opts.address || !opts.characteristic || !opts.hex)}
          </>
        )}
        {kind === 'can' && button('can.capture', '监听总线', !opts.channel)}
        {kind !== 'probe' && active && button('stop', '停止')}
      </div>
      {kind==='bench'&&<SoakPanel scope={scope} options={opts} review={review}/>}
      {error && <p role="alert">{error}</p>}
      {kind === 'probe' && (
        <>
          <strong>{status[probe.state] || probe.state}</strong>
          {probe.location?.path && (
            <button
              onClick={() => {
                close();
                window.dispatchEvent(
                  new CustomEvent('signaldesk-source-location', { detail: probe.location }),
                );
              }}
            >
              {probe.location.path}:{probe.location.line}
            </button>
          )}
          <pre className="bench-log">{probe.log.slice(-20).join('\n')}</pre>
        </>
      )}
      {report && (
        <>
          <div className="lab-strip">
            <Activity size={16} />
            <b>{status[report.status] || report.status}</b>
            <span>{report.device}</span>
            <span>{report.firmware}</span>
          </div>
          {report.error && <p role="alert">{report.error}</p>}
          {kind === 'power' && report.action === 'power.capture' && (
            <PowerPlot job={report} profile={storage} />
          )}
          {kind === 'can' && (
            <>
              <div className="bench-fields">
                <label>
                  监测 ID（HEX）
                  <input
                    value={expectedId}
                    onChange={(e) => setExpectedId(e.target.value)}
                    placeholder="123"
                  />
                </label>
                <label>
                  超时 / ms
                  <input
                    type="number"
                    min={1}
                    value={timeoutMs}
                    onChange={(e) => setTimeoutMs(+e.target.value)}
                  />
                </label>
                <label>
                  DBC 文件
                  <input
                    type="file"
                    accept=".dbc"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      setDecoded(undefined);
                      setDbc('');
                      if (f && f.size <= 2097152) setDbc(await f.text());
                      else if (f) setError('DBC 超过 2 MiB');
                    }}
                  />
                </label>
              </div>
              {expectedId && timeoutMs > 0 && (
                <p role="status">
                  {(() => {
                    const matching = report.rows.filter(
                      (r) => parseInt(String(r[1]), 16) === parseInt(expectedId, 16),
                    );
                    const last = matching.at(-1);
                    const gap = matching.filter((r) => Number(r[5]) > timeoutMs).length;
                    return last
                      ? `${gap} 次帧间超时 · 最近 ${last[5] || '—'} ms${active && Date.now() - Number(last[0]) * 1000 > timeoutMs ? ' · 等待下一帧超时' : ''}`
                      : '尚未收到此 ID';
                  })()}
                </p>
              )}
              <button
                disabled={!dbc || busy || !report.count}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setDecoded(await api<LabReport>('/bench/dbc', { ...scope, id: report.id, dbc }));
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                解码采集信号
              </button>
              {decoded && <ReportTable report={decoded} />}
            </>
          )}
          <ReportTable report={report} />
          <div className="lab-strip">
            <button
              onClick={() =>
                download(
                  `${report.action}-${report.startedAt}.json`,
                  JSON.stringify(report, null, 2),
                  'application/json',
                )
              }
            >
              <Download size={14} />
              保存完整记录
            </button>
            <button
              disabled={!report.count}
              onClick={() => {
                close();
                review(
                  `审查实际仪器记录 ${report.action}，状态 ${report.status}，设备 ${report.device}，固件 ${report.firmware || '未标记'}。${report.error || ''}\n${JSON.stringify({ columns: report.columns, rows: report.rows.slice(-30) }).slice(0, 8000)}`,
                );
              }}
            >
              交给 Agent 审查
            </button>
          </div>
        </>
      )}
    </>
  );
}
