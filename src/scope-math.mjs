import FFT from 'fft.js';

export const timeDivisions = [0.00001, 0.00002, 0.00005, 0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
export const verticalDivisions = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
export const niceDivision = (value, choices = verticalDivisions) => Number.isFinite(value) ? choices.find(choice => choice >= value) || choices.at(-1) || 1 : 1;
export const timeLabel = value => Math.abs(value) < 0.001 ? `${+(value * 1e6).toPrecision(4)} us` : Math.abs(value) < 1 ? `${+(value * 1000).toPrecision(4)} ms` : `${+value.toPrecision(4)} s`;

export function spectrumData(samples, channel, sampleRate) {
  const length = Math.min(4096, 2 ** Math.floor(Math.log2(Math.max(1, samples.length))));
  if (length < 64) throw new Error('频谱分析至少需要 64 个有效采样点');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error('采样率无效');
  const selected = samples.slice(-length), raw = selected.map(sample => sample.values[channel]);
  if (raw.some(value => !Number.isFinite(value))) throw new Error('选定通道包含缺失或无效采样');
  const expected = 1 / sampleRate;
  if (selected.some((sample, index) => index > 0 && Math.abs(sample.time - selected[index - 1].time - expected) > expected * 0.1)) throw new Error('采样时间不均匀或与配置采样率不符，不能可靠计算 FFT');
  const mean = raw.reduce((sum, value) => sum + value, 0) / length;
  let windowSum = 0;
  const windowed = raw.map((value, index) => { const weight = 0.5 * (1 - Math.cos(2 * Math.PI * index / (length - 1))); windowSum += weight; return (value - mean) * weight; });
  const fft = new FFT(length), complex = fft.createComplexArray(); fft.realTransform(complex, windowed);
  const times = Array.from({ length: length / 2 + 1 }, (_, index) => index * sampleRate / length);
  const values = times.map((_, index) => (index === 0 || index === length / 2 ? 1 : 2) * Math.hypot(complex[index * 2], complex[index * 2 + 1]) / windowSum);
  return { times, values, resolution: sampleRate / length, length };
}

export function dominantFrequency(samples, channel, sampleRate) {
  const spectrum = spectrumData(samples, channel, sampleRate);
  let peak = 1;
  for (let index = 2; index < spectrum.values.length - 1; index++) if (spectrum.values[index] > spectrum.values[peak]) peak = index;
  if (spectrum.values[peak] < 1e-8) throw new Error('没有可辨识的交流分量');
  const left = Math.log(Math.max(1e-30, spectrum.values[peak - 1])), center = Math.log(spectrum.values[peak]), right = Math.log(Math.max(1e-30, spectrum.values[peak + 1]));
  const denominator = left - 2 * center + right;
  const delta = peak > 1 && Math.abs(denominator) > 1e-12 ? Math.max(-0.5, Math.min(0.5, 0.5 * (left - right) / denominator)) : 0;
  return { frequency: (peak + delta) * spectrum.resolution, amplitude: Math.exp(center - 0.25 * (left - right) * delta), resolution: spectrum.resolution, samples: spectrum.length };
}

export function nearestSample(samples, time) {
  if (!samples.length) return null;
  let left = 0, right = samples.length - 1;
  while (left < right) { const middle = Math.floor((left + right) / 2); if (samples[middle].time < time) left = middle + 1; else right = middle; }
  return left && Math.abs(samples[left - 1].time - time) < Math.abs(samples[left].time - time) ? samples[left - 1] : samples[left];
}
