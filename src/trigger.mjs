export class TriggerCapture {
  constructor(config) { this.config = config; this.lastTime = -Infinity; this.previous = null; this.pending = null; this.capture = null; this.status = 'armed'; this.triggerTime = null; this.nextArmAt = -Infinity; }
  push(samples) {
    const { channel, level, edge, span, mode, pretrigger = 0.2, holdoff = 0 } = this.config;
    if (mode === 'single' && this.status === 'captured') return this.capture;
    for (const sample of samples) {
      if (sample.time <= this.lastTime) continue;
      const previous = this.previous;
      if (!this.pending && sample.time >= this.nextArmAt && previous && Number.isFinite(previous.values[channel]) && Number.isFinite(sample.values[channel]) && (edge === 'rising' ? previous.values[channel] < level && sample.values[channel] >= level : previous.values[channel] > level && sample.values[channel] <= level)) {
        const fraction = (level - previous.values[channel]) / (sample.values[channel] - previous.values[channel]);
        const time = previous.time + fraction * (sample.time - previous.time);
        this.pending = { start: time - span * pretrigger, end: time + span * (1 - pretrigger), time }; this.status = 'collecting';
      }
      this.previous = sample; this.lastTime = sample.time;
      if (this.pending && sample.time >= this.pending.end) {
        const pending = this.pending;
        this.capture = samples.filter(point => point.time >= pending.start && point.time <= pending.end);
        this.triggerTime = pending.time; this.nextArmAt = pending.time + holdoff;
        this.pending = null; this.status = mode === 'single' ? 'captured' : 'armed';
        return this.capture;
      }
    }
    return this.capture;
  }
}
