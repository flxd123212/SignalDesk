import { useEffect, useRef, useState } from 'react';
import { Download, FlaskConical, FolderPlus, Play, Square, X } from 'lucide-react';
import { api, download } from './data';
import { IconButton } from './ui';
import type { AppState } from './types';
import './engineering-lab.css';
import { BenchPanel, benchNames } from './BenchPanel';
import { TuningPanel } from './FieldDiagnostics';

export const labNames = {
  template: '工程模板',
  size: '固件体积差异',
  rules: '硬件规则检查',
  bus: '总线解码',
  matrix: '多板回归',
  tuning: '在线参数与读回',
  ...benchNames,
};
export type LabKind = keyof typeof labNames;
export type LabReport = {
  source: string;
  columns: string[];
  rows: (string | number)[][];
  count: number;
  samples?: number[][];
  pins?: string[];
};
export function ReportTable({ report }: { report: LabReport }) {
  const [query, setQuery] = useState(''),
    [limit, setLimit] = useState(100);
  const rows = report.rows.filter((row) => row.join(' ').toLowerCase().includes(query.toLowerCase()));
  return (
    <section className="lab-report" aria-label="工具结果">
      <div className="lab-strip">
        <strong>{report.source}</strong>
        <span>{report.count} 条</span>
        <IconButton
          title="导出工具报告"
          onClick={() =>
            download('engineering-report.json', JSON.stringify(report, null, 2), 'application/json')
          }
        >
          <Download size={15} />
        </IconButton>
      </div>
      {!!report.samples?.length && <DigitalWave samples={report.samples} pins={report.pins || []} />}
      <input
        type="search"
        aria-label="过滤结果"
        placeholder="过滤结果"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(100);
        }}
      />
      <div className="lab-scroll">
        <table>
          <thead>
            <tr>
              {report.columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <small>
        {rows.length ? `显示 ${Math.min(rows.length, limit)} / ${rows.length}` : '无匹配条目'}
        {report.rows.length < report.count ? ` · 报告保留前 ${report.rows.length} 条` : ''}
      </small>
      {limit < rows.length && <button onClick={() => setLimit((n) => n + 100)}>显示更多</button>}
    </section>
  );
}
function DigitalWave({ samples, pins }: { samples: number[][]; pins: string[] }) {
  const start = samples[0][0],
    span = samples.at(-1)![0] - start || 1;
  return (
    <div className="lab-wave" aria-label="数字电平波形">
      {pins.map((pin, index) => {
        let last = samples[0][index + 1],
          d = `M0 ${last ? 3 : 19}`;
        for (const row of samples.slice(1)) {
          const level = row[index + 1];
          d += ` H${(((row[0] - start) / span) * 600).toFixed(2)}`;
          if (level !== last) d += ` V${level ? 3 : 19}`;
          last = level;
        }
        return (
          <div key={pin}>
            <code>{pin}</code>
            <svg viewBox="0 0 600 23" preserveAspectRatio="none" aria-hidden="true">
              <path
                d={d}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        );
      })}
      <small>
        {start} – {samples.at(-1)![0]} s
      </small>
    </div>
  );
}

type MatrixJob = {
  id: string;
  status: string;
  results: {
    device: string;
    status: string;
    target: string;
    reason?: string;
    error?: string;
    results?: { detail: string }[];
  }[];
};
const statusNames: Record<string, string> = {
  running: '运行中',
  passed: '通过',
  skipped: '跳过',
  failed: '失败',
  cancelled: '已取消',
  incomplete: '未全部执行',
};
function MatrixPanel({ state }: { state: AppState }) {
  const [equipment,setEquipment]=useState<Record<string,string>>({});
  const [targets, setTargets] = useState<string[]>([]),
    [fixtures, setFixtures] = useState<string[]>([]),
    [hashes, setHashes] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState(
    '{\n  "name": "设备就绪",\n  "steps": [{"type":"expect","contains":"READY","timeout":5000}]\n}',
  );
  const [job, setJob] = useState<MatrixJob | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const data = await api<MatrixJob | null>('/lab/matrix');
        if (live) setJob(data);
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        if (live) timer = setTimeout(update, 1000);
      }
    };
    void update();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  const toggle = (values: string[], id: string) =>
    values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
  async function run(stop = false) {
    setPending(true);
    setError('');
    try {
      setJob(
        await api<MatrixJob>(
          `/lab/matrix/${stop ? 'stop' : 'start'}`,
          stop
            ? {}
            : {
                plan: JSON.parse(plan),
                targets: targets.map((id) => ({
                  id,
                  fixtureReady: fixtures.includes(id),
                  fixtures: (equipment[id] || '').split(/[,，]/).map(name=>name.trim()).filter(Boolean),
                  fingerprint: hashes[id],
                })),
              },
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <fieldset disabled={job?.status === 'running' || pending}>
        <legend>目标与夹具</legend>
        {state.devices?.map((d) => (
          <div className="lab-target" key={d.id}>
            <label>
              <input
                type="checkbox"
                checked={targets.includes(d.id)}
                onChange={() => setTargets(toggle(targets, d.id))}
              />
              {d.name} · {d.path}
            </label>
            <label>
              <input
                type="checkbox"
                checked={fixtures.includes(d.id)}
                onChange={() => setFixtures(toggle(fixtures, d.id))}
              />
              夹具就绪
            </label>
            <input aria-label={`${d.name} 夹具名称`} placeholder="夹具名称，如 oled, loopback" value={equipment[d.id] || ''} onChange={e=>setEquipment({...equipment,[d.id]:e.target.value})}/>
            <input
              aria-label={`${d.name} 固件指纹`}
              placeholder="固件 SHA256（可选）"
              value={hashes[d.id] || ''}
              onChange={(e) => setHashes({ ...hashes, [d.id]: e.target.value })}
            />
          </div>
        ))}
        <label>
          共用测试用例
          <textarea value={plan} onChange={(e) => setPlan(e.target.value)} rows={5} />
        </label>
      </fieldset>
      <div className="lab-strip">
        <button
          disabled={pending || (!targets.length && job?.status !== 'running')}
          onClick={() => void run(job?.status === 'running')}
        >
          {job?.status === 'running' ? <Square size={14} /> : <Play size={14} />}{' '}
          {job?.status === 'running' ? '停止' : '运行选中设备'}
        </button>
        {job && (
          <>
            <strong>{statusNames[job.status] || job.status}</strong>
            <IconButton
              title="导出多板报告"
              onClick={() => download('board-matrix.json', JSON.stringify(job, null, 2), 'application/json')}
            >
              <Download size={15} />
            </IconButton>
          </>
        )}
      </div>
      {job?.results.map((r) => (
        <p key={r.device + r.target}>
          {r.device} · {r.target} · {statusNames[r.status]}　
          {r.reason || r.error || r.results?.map((s) => s.detail).join(' / ')}
        </p>
      ))}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

const templates = [
  ['stm32', 'STM32F103C8 · I²C OLED', 'Arm GCC · PB6 / PB7'],
  ['ch32', 'CH32V003F4P6 · GPIO', 'RISC-V GCC · PC4'],
  ['stc', 'STC89C52RC · GPIO', 'SDCC / 8051 · P1.0'],
  ['stm8', 'STM8S003F3 · GPIO', 'SDCC / STM8 · PD3'],
];
export function EngineeringLab({
  initial,
  seed,
  state,
  close,
  openProject,
  problems,
  review,
}: {
  initial: LabKind;
  seed?: {path:string;line:number};
  state: AppState;
  close: () => void;
  openProject: (root: string) => void;
  problems: () => void;
  review: (text: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    [kind, setKind] = useState(initial);
  const [file, setFile] = useState(''),
    [after, setAfter] = useState(''),
    [protocol, setProtocol] = useState('i2c');
  const [group, setGroup] = useState('symbol');
  const [pins, setPins] = useState<Record<string, string>>({
      scl: 'SCL',
      sda: 'SDA',
      clk: 'CLK',
      mosi: 'MOSI',
      cs: 'CS',
      rx: 'RX',
    }),
    [baud, setBaud] = useState(115200),
    [mode, setMode] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [report, setReport] = useState<LabReport>();
  const device = state.devices?.find((d) => d.id === state.activeDevice),
    root = device?.projectRoot || '';
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    if (root && device && ['bus', 'rules', 'size'].includes(kind)) {
      api<string[]>(`/lab/files?${new URLSearchParams({ root, deviceId: device.id })}`)
        .then((all) => {
          if (!live) return;
          const suffix =
            kind === 'bus'
              ? /\.(csv|sr|vcd)$/i
              : kind === 'rules'
                ? /\.kicad_(pcb|sch)$/i
                : /\.(elf|out|axf)$/i;
          const matching = all.filter((f) => suffix.test(f));
          setPaths(matching);
          if (matching.length === 1) setFile((current) => current || matching[0]);
        })
        .catch((e) => {
          if (live) setError((e as Error).message);
        });
    }
    return () => {
      live = false;
    };
  }, [device?.id, root, kind]);
  useEffect(() => {
    const el = dialog.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  const reset = () => {
    setReport(undefined);
    setError('');
  };
  async function run(id?: string) {
    reset();
    setBusy(true);
    try {
      if (kind === 'template') {
        const data = await api<{ root: string }>('/lab/template', { id });
        close();
        openProject(data.root);
      } else
        setReport(
          await api<LabReport>(`/lab/${kind}`, {
            deviceId: device?.id,
            root,
            file,
            before: file,
            after,
            protocol,
            pins,
            baud,
            mode,
            group,
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const names = protocol === 'i2c' ? ['scl', 'sda'] : protocol === 'spi' ? ['clk', 'mosi', 'cs'] : ['rx'];
  return (
    <dialog ref={dialog} className="command-palette engineering-lab" aria-label="工程实验工具" onCancel={close}>
      <header className="panel-toolbar">
        <div className="panel-title">
          <FlaskConical size={17} />
          工程实验工具
        </div>
        <IconButton title="关闭实验工具" onClick={close}>
          <X size={15} />
        </IconButton>
      </header>
      <div className="lab-body">
        <div className="lab-strip">
          <select
            aria-label="实验工具"
            value={kind}
            disabled={busy}
            onChange={(e) => {
              reset();
              setFile('');
              setAfter('');
              setKind(e.target.value as LabKind);
            }}
          >
            {Object.entries(labNames).map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
          </select>
          <span>{device?.name}</span>
        </div>
        {kind === 'tuning' ? <TuningPanel state={state}/> : kind in benchNames ? <BenchPanel key={kind} kind={kind as keyof typeof benchNames} state={state} seed={kind==='probe'?seed:undefined} review={review} close={close}/> : kind === 'template' ? (
          <div className="lab-templates">
            {templates.map(([id, label, detail]) => (
              <button key={id} disabled={busy} onClick={() => void run(id)}>
                <FolderPlus size={16} />
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </div>
        ) : kind === 'matrix' ? (
          <MatrixPanel state={state} />
        ) : (
          <fieldset disabled={busy} onChange={reset}>
            <datalist id="lab-project-files">
              {paths.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
            <label>
              {kind === 'size' ? '基线 ELF' : kind === 'bus' ? '采样文件' : 'KiCad 设计文件'}
              <input
                list="lab-project-files"
                placeholder={
                  kind === 'size'
                    ? 'build/baseline.elf'
                    : kind === 'bus'
                      ? 'oled-address.csv / capture.sr / capture.vcd'
                      : 'hardware/board.kicad_pcb'
                }
                value={file}
                onChange={(e) => setFile(e.target.value)}
              />
            </label>
            {kind === 'size' && (
              <>
                <label>
                  当前 ELF
                  <input
                    value={after}
                    onChange={(e) => setAfter(e.target.value)}
                    placeholder="build/current.elf"
                  />
                </label>
                <label>
                  比较维度
                  <select value={group} onChange={(e) => setGroup(e.target.value)}>
                    <option value="symbol">函数与变量</option>
                    <option value="unit">编译单元</option>
                  </select>
                </label>
              </>
            )}
            {kind === 'bus' && (
              <>
                <label>
                  协议
                  <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
                    <option value="i2c">I²C</option>
                    <option value="spi">SPI</option>
                    <option value="uart">UART · 8N1</option>
                  </select>
                </label>
                <div className="lab-pins">
                  {names.map((key) => (
                    <label key={key}>
                      {key.toUpperCase()}
                      <input value={pins[key]} onChange={(e) => setPins({ ...pins, [key]: e.target.value })} />
                    </label>
                  ))}
                  {protocol === 'uart' && (
                    <label>
                      波特率
                      <input type="number" value={baud} onChange={(e) => setBaud(+e.target.value)} />
                    </label>
                  )}
                  {protocol === 'spi' && (
                    <label>
                      模式
                      <select value={mode} onChange={(e) => setMode(+e.target.value)}>
                        {[0, 1, 2, 3].map((n) => (
                          <option key={n}>{n}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </>
            )}
            <button
              className="primary"
              disabled={!root || !file || (kind === 'size' && !after)}
              onClick={() => void run()}
            >
              <Play size={15} />
              {busy ? '运行中…' : '运行'}
            </button>
            {!root && <small>请先绑定工程</small>}
          </fieldset>
        )}
        {error && <p role="alert">{error}</p>}
        {report && (
          <>
            <ReportTable report={report} />
            <div className="lab-strip">
              {kind === 'rules' && (
                <button
                  onClick={() => {
                    close();
                    problems();
                  }}
                >
                  查看问题面板
                </button>
              )}
              <button
                onClick={() => {
                  close();
                  review(
                    `请结合当前工程审查工具报告。文件 ${file}。来源 ${report.source}。共 ${report.count} 项。\n${JSON.stringify({ columns: report.columns, rows: report.rows.slice(0, 40) }).slice(0, 6000)}`,
                  );
                }}
              >
                交给 Agent 审查
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
