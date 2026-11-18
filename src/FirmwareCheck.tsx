import { useEffect, useState } from 'react';
import { Hammer, Plus, Trash2 } from 'lucide-react';
import { api } from './data';
import { IconButton } from './ui';
type Build = {
  fingerprint: string;
  finishedAt: string;
  outputs?: { path: string; sha256: string; updated: boolean }[];
};
export type FlashEvidence = {
  deviceId?: string;
  root?: string;
  build?: Build;
  images: { name: string; sha256: string; version: string }[];
  verification: string;
  runtime: string;
  expected?: string;
  reported?: string;
  reason?: string;
};
export type FlashPlanView = {
  id: string;
  executable: string;
  args: string[];
  target: string;
  confirmation: string;
  chip: string;
  build?: Build;
};
const names: Record<string, string> = {
  pending: '等待中',
  failed: '失败',
  verified: '下载器已校验',
  unconfirmed: '未确认',
  matched: '版本一致',
  different: '版本不符',
  disabled: '未启用',
  skipped: '已跳过',
};
export function FirmwareCheck({
  deviceId,
  root,
  config,
  planReady,
  evidence,
}: {
  deviceId: string;
  root: string;
  config: { family: string; [k: string]: unknown };
  planReady: (p: FlashPlanView) => void;
  evidence?: FlashEvidence;
}) {
  const key = JSON.stringify(['signaldesk.boot-profile', deviceId, root, config.family]);
  const [profile, setProfile] = useState(() => {
      const defaults = {
        expected: '',
        field: 'version',
        format: 'json',
        command: '',
        sources: [{ path: '', address: config.family === 'stm32' ? '0x08000000' : '0x0' }],
      };
      try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(key) || '{}') } as typeof defaults;
      } catch {
        return defaults;
      }
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(profile));
  }, [key, profile]);
  async function build() {
    setError('');
    setBusy(true);
    try {
      const p = await api<FlashPlanView>('/chips/build-plan', {
        ...config,
        deviceId,
        root,
        sources: profile.sources,
        handshake: {
          expected: profile.expected,
          field: profile.field,
          format: profile.format,
          command: profile.command,
        },
      });
      planReady(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="lab-body">
      <summary>构建、烧录与启动版本核对</summary>
      <div className="bench-fields">
        <label>
          预期运行版本
          <input
            value={profile.expected}
            onChange={(e) => setProfile({ ...profile, expected: e.target.value })}
          />
        </label>
        <label>
          回报格式
          <select
            value={profile.format}
            onChange={(e) => setProfile({ ...profile, format: e.target.value })}
          >
            <option value="json">JSON 行字段</option>
            <option value="prefix">文本行前缀</option>
          </select>
        </label>
        <label>
          字段或前缀
          <input
            value={profile.field}
            onChange={(e) => setProfile({ ...profile, field: e.target.value })}
          />
        </label>
        <label>
          版本查询命令（可选）
          <input
            value={profile.command}
            onChange={(e) => setProfile({ ...profile, command: e.target.value })}
          />
        </label>
      </div>
      {profile.sources.map((s, i) => (
        <div key={i} className="lab-strip">
          <label>
            工程构建产物
            <input
              value={s.path}
              placeholder="build/firmware.bin"
              onChange={(e) =>
                setProfile({
                  ...profile,
                  sources: profile.sources.map((v, n) => (i === n ? { ...v, path: e.target.value } : v)),
                })
              }
            />
          </label>
          <label>
            下载地址
            <input
              value={s.address}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  sources: profile.sources.map((v, n) =>
                    i === n ? { ...v, address: e.target.value } : v,
                  ),
                })
              }
            />
          </label>
          <IconButton
            title="删除镜像分区"
            disabled={profile.sources.length === 1}
            onClick={() =>
              setProfile({ ...profile, sources: profile.sources.filter((_, n) => i !== n) })
            }
          >
            <Trash2 size={14} />
          </IconButton>
        </div>
      ))}
      <div className="lab-strip">
        {['esp32', 'esp8266'].includes(config.family) && (
          <IconButton
            title="添加构建产物"
            disabled={profile.sources.length >= 8}
            onClick={() =>
              setProfile({ ...profile, sources: [...profile.sources, { path: '', address: '0x10000' }] })
            }
          >
            <Plus size={14} />
          </IconButton>
        )}
        <button
          disabled={
            busy || !root || !profile.expected.trim() || profile.sources.some((s) => !s.path.trim())
          }
          onClick={() => void build()}
        >
          <Hammer size={15} />
          {busy ? '正在构建…' : '构建并预览烧录'}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {evidence && (
        <div className="field-facts">
          <span>
            构建源码指纹 <b>{evidence.build?.fingerprint || '无关联构建'}</b>
          </span>
          {evidence.images.map((im, i) => (
            <span key={i}>
              {im.name}
              <b>{im.sha256}</b>
            </span>
          ))}
          <span>
            镜像校验 <b>{names[evidence.verification]}</b>
          </span>
          <span>
            启动核对 <b>{names[evidence.runtime]}</b>
          </span>
          <span>
            预期 / 上报{' '}
            <b>
              {evidence.expected || '—'} / {evidence.reported || '—'}
            </b>
          </span>
          {evidence.reason && <p>{evidence.reason}</p>}
        </div>
      )}
    </details>
  );
}
