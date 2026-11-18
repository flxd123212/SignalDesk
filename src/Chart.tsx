import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import { COLORS, dataStore, number } from './data';
import type { Sample } from './types';
import 'uplot/dist/uPlot.min.css';
import { defaultChannelScale, type ScopeSettings } from './scope';
import { nearestSample, spectrumData, timeLabel } from './scope-math.mjs';

type Props = { names: string[]; visible: boolean[]; span: number; paused: boolean; status?: string; spectrum?: boolean; sampleRate: number; channel: number; capture?: Sample[] | null; zoomReset?: number; scope?: ScopeSettings; onCursorPosition?: (position: number) => void };

export function Chart(props: Props) {
  const element = useRef<HTMLDivElement>(null);
  const config = useRef(props); config.current = props;
  const [cursor, setCursor] = useState('');
  const [measurement, setMeasurement] = useState('');
  const signature = props.names.join('|');
  useEffect(() => {
    if (!element.current) return;
    const container = element.current;
    let frame = 0, frozen: Sample[] | null = null, lastPause = false;
    let zoom: { min: number; max: number } | null = null, lastReset = props.zoomReset;
    const spectrum = !!props.spectrum;
    const names = spectrum ? [props.names[props.channel] || 'CH1'] : props.names.length ? props.names : ['CH1', 'CH2', 'CH3'];
    let times: number[] = [], values: (number | null)[][] = [], physicalValues: (number | null)[][] = [], displaySamples: Sample[] = [], means: number[] = [], timeOffset = 0;
    const physical = (sample: Sample, channel: number) => { const scale = config.current.scope?.channels[channel] || defaultChannelScale; return (sample.values[channel] - (scale.coupling === 'AC' ? means[channel] || 0 : 0)) * (scale.invert ? -1 : 1); };
    const plot = new uPlot({
      width: Math.max(200, container.clientWidth), height: Math.max(180, container.clientHeight),
      padding: [14, 22, 0, 4],
      series: [{}, ...names.map((label, index) => ({ label, stroke: COLORS[(spectrum ? props.channel : index) % COLORS.length], width: 1.65, points: { show: false }, spanGaps: false }))],
      legend: { show: false },
      scales: { x: { time: false }, y: { auto: false } },
      axes: [
        { stroke: '#9aa8a9', grid: { stroke: '#2b3436', width: 1 }, ticks: { stroke: '#343c3e', size: 5 }, font: '10px Consolas, monospace', size: 34,
          splits: (_plot, _axis, min, max) => Array.from({ length: 11 }, (_, index) => min + (max - min) * index / 10),
          values: (plot, ticks) => ticks.map((value, i) => plot.width < 560 && i % 2 ? '' : spectrum ? `${+value.toPrecision(4)}` : timeLabel(value - timeOffset)) },
        { stroke: '#747b84', grid: { stroke: '#292d32', width: 1 }, ticks: { show: false }, font: '10px Consolas, monospace', size: 53, gap: 8, splits: (_plot, _axis, min, max) => Array.from({ length: 9 }, (_, index) => min + (max - min) * index / 8), values: (_plot, ticks) => ticks.map(value => { const scale = config.current.scope?.channels[config.current.channel] || defaultChannelScale; const physical = !spectrum && config.current.scope?.manual ? value * scale.division + scale.offset : value; return +physical.toPrecision(4) + ''; }) },
      ],
      cursor: { drag: { x: !props.scope?.cursors, y: false, setScale: false }, points: { size: 5 } },
      hooks: {
        setCursor: [current => {
          const index = current.cursor.idx;
          if (index == null || index < 0 || index >= times.length) { setCursor(''); return; }
          setCursor(`${number(times[index], spectrum ? 1 : 6)} ${spectrum ? 'Hz' : 's'}   ${names.map((name, channel) => `${name} ${number((spectrum ? values : physicalValues)[channel]?.[index] ?? undefined)}`).join('   ')}`);
        }],
        draw: [current => {
          const settings = config.current.scope;
          if (!settings) return;
          const ctx = current.ctx, ratio = devicePixelRatio || 1, { left, top, width, height } = current.bbox;
          ctx.save(); ctx.beginPath(); ctx.rect(left, top, width, height); ctx.clip(); ctx.font = `${11 * ratio}px Consolas`;
          const mark = (time: number, label: string, color: string) => { const x = current.valToPos(time, 'x', true); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = ratio; ctx.setLineDash([4 * ratio, 3 * ratio]); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke(); ctx.fillText(label, Math.min(left + width - 90 * ratio, Math.max(left + 3 * ratio, x + 4 * ratio)), top + 12 * ratio); };
          if (spectrum && settings.peak) mark(settings.peak.frequency, `${settings.peak.frequency.toFixed(2)} Hz`, '#edbc70');
          if (!spectrum && settings.triggerTime !== null && config.current.capture) mark(settings.triggerTime, 'T', '#eebd70');
          if (!spectrum && settings.cursors && displaySamples.length) {
            const min = current.scales.x.min!, max = current.scales.x.max!;
            for (const [name, position, color] of [['A', settings.cursorA, '#79bce6'], ['B', settings.cursorB, '#edbc70']] as const) { const sample = nearestSample(displaySamples, min + (max - min) * position / 100); if (sample) mark(sample.time, name, color); }
          }
          ctx.restore();
        }],
        setSelect: [current => {
          if (current.select.width > 0) {
            const left = current.posToVal(current.select.left, 'x'), right = current.posToVal(current.select.left + current.select.width, 'x');
            if (right > left && !spectrum) { zoom = { min: left, max: right }; frozen = (config.current.capture || dataStore.samples).slice(); }
            setCursor(`Δ${spectrum ? 'f' : 't'} = ${(right - left).toFixed(4)} ${spectrum ? 'Hz' : 's'}${!spectrum && right > left ? `    1/Δt = ${(1 / (right - left)).toFixed(3)} Hz` : ''}`);
          }
        }],
      },
    }, [[], ...names.map(() => [])], container);

    const render = () => {
      const settings = config.current;
      if (lastReset !== settings.zoomReset) { zoom = null; frozen = null; lastReset = settings.zoomReset; }
      if (settings.paused && !lastPause) frozen = (settings.capture || dataStore.samples).slice();
      if (!settings.paused && !zoom) frozen = null;
      lastPause = settings.paused;
      const all = frozen || settings.capture || dataStore.samples;
      const last = all.at(-1)?.time || 0;
      const current = all.filter(sample => zoom ? sample.time >= zoom.min && sample.time <= zoom.max : sample.time >= last - settings.span);
      displaySamples = current; timeOffset = settings.scope?.triggerTime ?? (settings.scope?.manual ? last : 0);
      if (spectrum) {
        try { const result = spectrumData(all, settings.channel, settings.sampleRate); times = result.times; values = [result.values]; setMeasurement(`HANN · FFT ${result.length} · Δf ${number(result.resolution, 4)} Hz`); }
        catch (error) { plot.setData([[], []]); setMeasurement((error as Error).message); return; }
        plot.setData([times, ...values], false); plot.setScale('x', { min: 0, max: Math.min(settings.sampleRate / 2, settings.scope?.spectrumSpan || (settings.scope?.peak ? Math.max(settings.scope.peak.frequency * 3, settings.scope.peak.resolution * 10) : settings.sampleRate / 2)) });
        plot.setScale('y', { min: 0, max: settings.scope?.spectrumDivision ? settings.scope.spectrumDivision * 8 : Math.max(1e-9, ...values[0].map(value => value || 0)) * 1.15 });
      } else {
        // Preserve peaks when reducing the retained window to a display-sized budget.
        const stride = Math.max(1, Math.ceil(current.length / 2500));
        const selected: Sample[] = [];
        for (let index = 0; index < current.length; index += stride) {
          if (stride === 1) { selected.push(current[index]); continue; }
          const bucket = current.slice(index, index + stride), indices = new Set([0, bucket.length - 1]);
          for (let channel = 0; channel < names.length; channel++) {
            let min = 0, max = 0;
            for (let item = 1; item < bucket.length; item++) {
              if (bucket[item].values[channel] < bucket[min].values[channel]) min = item;
              if (bucket[item].values[channel] > bucket[max].values[channel]) max = item;
            }
            indices.add(min); indices.add(max);
          }
          for (const item of [...indices].sort((a, b) => a - b)) selected.push(bucket[item]);
        }
        times = selected.map(sample => sample.time);
        means = names.map((_, channel) => { const valid = current.map(sample => sample.values[channel]).filter(Number.isFinite); return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : 0; });
        physicalValues = names.map((_, channel) => selected.map(sample => Number.isFinite(sample.values[channel]) ? physical(sample, channel) : null));
        values = physicalValues.map((series, channel) => { const scale = settings.scope?.channels[channel] || defaultChannelScale; return series.map(value => value === null ? null : settings.scope?.manual ? (value - scale.offset) / scale.division : value); });
        names.forEach((_, index) => { const show = settings.visible[index] !== false; if (plot.series[index + 1].show !== show) plot.setSeries(index + 1, { show }); });
        plot.setData([times, ...values], false);
        plot.setScale('x', zoom || { min: Math.max(0, last - settings.span), max: Math.max(settings.span, last) });
        let min = Infinity, max = -Infinity;
        values.forEach((series, channel) => { if (settings.visible[channel] === false) return; for (const value of series) if (value !== null) { min = Math.min(min, value); max = Math.max(max, value); } });
        const padding = Number.isFinite(max - min) ? Math.max((max - min) * 0.1, 0.01) : 1;
        plot.setScale('y', settings.scope?.manual ? { min: -4, max: 4 } : { min: Number.isFinite(min) ? min - padding : -1, max: Number.isFinite(max) ? max + padding : 1 });
        if (settings.scope?.cursors) {
          const min = plot.scales.x.min!, max = plot.scales.x.max!, a = nearestSample(current, min + (max - min) * settings.scope.cursorA / 100), b = nearestSample(current, min + (max - min) * settings.scope.cursorB / 100);
          const dt = a && b ? b.time - a.time : 0, va = a ? physical(a, settings.channel) : NaN, vb = b ? physical(b, settings.channel) : NaN;
          setMeasurement(`A ${number(va)} · B ${number(vb)} · Δ值 ${number(vb - va)} · ΔT ${timeLabel(dt)} · 1/|ΔT| ${dt ? number(1 / Math.abs(dt)) : '--'} Hz`);
        } else setMeasurement('');
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); };
    const unsubscribe = dataStore.subscribe(schedule);
    const cursorClick = (event: MouseEvent) => { if (config.current.scope?.cursors && !spectrum) { const box = plot.over.getBoundingClientRect(); config.current.onCursorPosition?.(Math.max(0, Math.min(100, (event.clientX - box.left) / box.width * 100))); } };
    plot.over.addEventListener('click', cursorClick);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { frame = 0; plot.setSize({ width: Math.max(200, container.clientWidth), height: Math.max(180, container.clientHeight) }); render(); });
    });
    observer.observe(container);
    const update = setInterval(schedule, 250);
    render();
    return () => { clearInterval(update); unsubscribe(); observer.disconnect(); cancelAnimationFrame(frame); plot.over.removeEventListener('click', cursorClick); plot.destroy(); };
  }, [signature, props.spectrum, props.channel, props.scope?.cursors]);
  return <div className={`chart-wrap ${props.scope?.cursors ? 'has-cursors' : ''}`}><div className="plot-host" ref={element} /><div className="chart-readout">{measurement || cursor || (props.spectrum ? 'HANN · 去直流 · 单边幅值谱' : `TIME / s    ${props.status || (props.paused ? 'HOLD' : 'LIVE')}`)}</div></div>;
}
