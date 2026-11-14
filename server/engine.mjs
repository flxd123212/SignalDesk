import { EventEmitter } from 'node:events';
import { SerialPort } from 'serialport';
import { StreamParser, PROTOCOLS, encodeSample, encodePayload } from './protocol.mjs';
import { compileGraph, compileScript } from './processing.mjs';
import { SessionStore } from './sessions.mjs';
import { TcpPort, tcpTarget } from './transports.mjs';
import { BinaryParser, validateSchema } from './frames.mjs';

export const DEFAULT_CONFIG = { path: 'demo', transport: 'serial', baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', rtscts: false, dtr: false, rts: false, protocol: 'firewater', sampleRate: 200 };

export function validateConfig(input) {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (typeof config.path !== 'string' || !config.path || config.path.length > 256) throw new Error('请选择串口');
  if (!['serial', 'bluetooth'].includes(config.transport)) throw new Error('无效的串口传输类型');
  if (config.transport === 'bluetooth' && (config.path === 'demo' || config.path.startsWith('tcp:'))) throw new Error('蓝牙 SPP 需要已配对的虚拟串口');
  if (config.path.startsWith('tcp:')) tcpTarget(config.path);
  if (config.protocol === 'custom') config.schema = validateSchema(config.schema);
  if (config.path === 'demo' && config.protocol === 'custom') throw new Error('模拟信号源不生成自定义二进制帧');
  if (!Number.isInteger(config.baudRate) || config.baudRate < 50 || config.baudRate > 12000000) throw new Error('波特率应为 50 到 12000000');
  if (![5, 6, 7, 8].includes(config.dataBits) || ![1, 1.5, 2].includes(config.stopBits) || !['none', 'even', 'odd', 'mark', 'space'].includes(config.parity)) throw new Error('串口参数无效');
  if (!PROTOCOLS.includes(config.protocol) || !Number.isFinite(config.sampleRate) || config.sampleRate < 1 || config.sampleRate > 1000000) throw new Error('协议或采样率无效');
  if (config.path === 'demo' && config.sampleRate > 2000) throw new Error('模拟设备采样率最高为 2000 Hz');
  for (const key of ['dtr', 'rts', 'rtscts']) if (typeof config[key] !== 'boolean') throw new Error('流控参数无效');
  if (config.transport === 'bluetooth' && (config.rtscts || config.dtr || config.rts)) throw new Error('蓝牙 SPP 不支持物理流控线，请关闭 RTS/CTS、DTR 和 RTS');
  return config;
}

export class SerialEngine extends EventEmitter {
  constructor({ directory, Port = SerialPort }) {
    super(); this.Port = Port; this.config = { ...DEFAULT_CONFIG }; this.port = null;
    this.connected = false; this.busy = false; this.source = 'none'; this.processing = null; this.processingMode = 'raw';
    this.store = new SessionStore(directory);
    this.store.on('failure', error => { this.recordingErrors++; this.emit('notice', { level: 'error', message: error.message }); this.emitState(); });
    this.packetId = 0; this.frequency = 1.4; this.amplitude = 1; this.replay = null; this.generation = 0; this.sendGeneration = 0; this.reset();
  }

  state() {
    return { connected: this.connected, busy: this.busy, source: this.source, config: this.config, rxBytes: this.rxBytes, txBytes: this.txBytes, frames: this.sampleIndex, parseErrors: this.parser.errors, processingErrors: this.processingErrors, dropped: this.dropped, quality: { crcErrors: this.parser.crcErrors || 0, resyncBytes: this.parser.resyncBytes || 0, pendingBytes: this.parser.buffer.length, recordingErrors: this.recordingErrors, decodeMs: this.decodeMs, maxChunkBytes: this.maxChunkBytes, maxDecodeMs: this.maxDecodeMs }, latest: this.latest, names: this.names, processingMode: this.processingMode, graphValues: this.processing?.latestValues || {}, graphInputs: this.processing?.latestInputs || {}, recording: this.store.recording ? { id: this.store.recording.id, bytes: this.store.recording.bytes } : null, timedSend: this.sendInterval ? this.sendIntervalMs : null, replay: this.replay ? { id: this.replay.id, duration: this.replay.duration, position: this.replay.position, speed: this.replay.speed, playing: !!this.replayTimer } : null };
  }

  emitState() { this.emit('state', this.state()); }

  reset() {
    if (this.processingDefinition) this.processing = this.processingDefinition.mode === 'graph' ? compileGraph(this.processingDefinition.graph, { sampleRate: this.config.sampleRate }) : compileScript(this.processingDefinition.script);
    this.parser = this.config.protocol === 'custom' ? new BinaryParser(this.config.schema) : new StreamParser(this.config.protocol); this.sampleIndex = 0; this.demoIndex = 0;
    this.rxBytes = 0; this.txBytes = 0; this.processingErrors = 0; this.dropped = 0; this.latest = []; this.names = []; this.history = []; this.recentPackets = [];
    this.recordingErrors = 0; this.decodeMs = 0; this.maxChunkBytes = 0; this.maxDecodeMs = 0;
    this.emit('reset');
  }

  async connect(input) {
    if (input.path === 'unassigned') throw new Error('项目尚未匹配串口，请选择设备后连接');
    if (this.flashLock) throw new Error('目标设备正在烧录');
    if (this.automationLock) throw new Error('请先停止自动测试');
    if (this.busy) throw new Error('连接操作正在进行');
    const config = validateConfig(input);
    if (this.processingDefinition?.mode === 'graph') compileGraph(this.processingDefinition.graph, { sampleRate: config.sampleRate });
    this.busy = true; this.emitState();
    try {
      await this.disconnect(); this.replay = null; this.config = config; this.reset();
      if (config.path === 'demo') {
        this.source = 'demo'; this.connected = true;
        let carry = 0;
        this.demoTimer = setInterval(() => {
          carry += Math.min(this.config.sampleRate, 2000) / 50;
          const count = Math.floor(carry); carry -= count;
          const chunks = [];
          for (let i = 0; i < count; i++) {
            const time = this.demoIndex++ / Math.min(this.config.sampleRate, 2000);
            const phase = time * Math.PI * 2 * this.frequency;
            const values = [1.65 + 1.12 * this.amplitude * Math.sin(phase), 1.3 + 0.56 * Math.sin(phase + 1.35) + 0.08 * Math.sin(phase * 5), 2.55 + 0.28 * Math.sin(phase * 0.5)];
            chunks.push(encodeSample(values, config.protocol));
          }
          if (chunks.length) this.receive(Buffer.concat(chunks));
        }, 20);
      } else {
        const Port = config.path.startsWith('tcp:') ? TcpPort : this.Port;
        const port = new Port({ path: config.path, baudRate: config.baudRate, dataBits: config.dataBits, stopBits: config.stopBits, parity: config.parity, rtscts: config.rtscts, autoOpen: false, highWaterMark: 16384 });
        this.port = port;
        port.on('data', bytes => { if (this.port === port) this.receive(bytes); });
        port.on('error', error => { this.emit('notice', { level: 'error', message: error.message }); });
        port.on('close', () => {
          if (this.port !== port) return;
          this.port = null; this.connected = false; this.source = 'none'; this.stopTimedSend();
          void this.store.stop().catch(() => {});
          this.emit('notice', { level: 'error', message: '串口已关闭或设备已拔出' }); this.emitState();
        });
        await new Promise((resolve, reject) => port.open(error => error ? reject(error) : resolve()));
        if (config.transport !== 'bluetooth') await new Promise((resolve, reject) => port.set(config.rtscts ? { dtr: config.dtr } : { dtr: config.dtr, rts: config.rts }, error => error ? reject(error) : resolve()));
        this.source = config.path.startsWith('tcp:') ? 'tcp' : 'serial'; this.connected = true;
      }
    } catch (error) {
      await this.disconnect(); throw error;
    } finally { this.busy = false; this.emitState(); }
  }

  async disconnect() {
    this.generation++;
    clearInterval(this.demoTimer); this.demoTimer = null;
    clearInterval(this.replayTimer); this.replayTimer = null;
    this.stopTimedSend(); this.connected = false; this.source = 'none';
    const port = this.port; this.port = null;
    if (port?.isOpen) await new Promise(resolve => port.close(() => resolve()));
    await this.store.stop(); this.emitState();
  }

  receive(bytes, direction = 'RX', recording = true) {
    if (direction === 'RX') this.rxBytes += bytes.length; else this.txBytes += bytes.length;
    if (recording) this.store.write(direction, bytes);
    const packet = { id: ++this.packetId, time: Date.now(), dir: direction, data: bytes.toString('base64'), length: bytes.length };
    this.recentPackets.push(packet); this.recentPackets = this.recentPackets.slice(-30);
    this.emit('packet', packet);
    if (direction !== 'RX') return;
    const started = performance.now(); this.maxChunkBytes = Math.max(this.maxChunkBytes, bytes.length);
    const samples = [];
    for (const values of this.parser.push(bytes)) {
      const time = this.sampleIndex++ / this.config.sampleRate;
      try {
        const transformed = this.processing ? this.processing.run(values) : values;
        this.latest = transformed;
        this.names = this.processing ? this.processing.names : this.config.protocol === 'custom' ? this.config.schema.fields.map(field => field.name) : transformed.map((_, index) => `CH${index + 1}`);
        samples.push({ time, values: transformed });
      } catch (error) {
        this.processingErrors++;
        if (this.processingErrors === 1) this.emit('notice', { level: 'error', message: error.message });
      }
    }
    if (samples.length) { this.history = this.history.concat(samples).slice(-2048); this.emit('samples', samples); }
    const duration = performance.now() - started; this.decodeMs += duration; this.maxDecodeMs = Math.max(this.maxDecodeMs, duration);
  }

  async send(payload, owner = null) {
    if (this.automationLock && this.automationLock !== owner) throw new Error('该设备正在自动测试，请先停止测试');
    const bytes = encodePayload(payload);
    if (!this.connected || this.source === 'replay') throw new Error('请先连接串口或模拟设备');
    if (this.source === 'serial' || this.source === 'tcp') {
      const port = this.port;
      await new Promise((resolve, reject) => port.write(bytes, error => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => port.drain(error => error ? reject(error) : resolve()));
      if (this.port !== port) throw new Error('发送期间串口已断开');
    }
    this.receive(bytes, 'TX');
    if (this.source === 'demo') {
      const text = bytes.toString('utf8').trim();
      let response = 'OK';
      if (text === '*IDN?') response = 'SignalDesk,SIMULATOR,DEMO-001,0.1.0';
      else if (text.startsWith('freq ')) { const value = Number(text.slice(5)); if (Number.isFinite(value) && value >= 0.1 && value <= 50) this.frequency = value; else response = 'ERROR: frequency 0.1..50'; }
      else if (text.startsWith('amp ')) { const value = Number(text.slice(4)); if (Number.isFinite(value) && value >= 0 && value <= 5) this.amplitude = value; else response = 'ERROR: amplitude 0..5'; }
      // Replies are transport data. Text replies are deliberately not numeric samples.
      this.receive(Buffer.from(response + '\r\n'));
    }
    this.emitState(); return bytes.length;
  }

  async setSignals({ dtr, rts }) {
    if (this.config.transport === 'bluetooth') throw new Error('蓝牙 SPP 不提供可验证的 DTR / RTS 物理控制线');
    if (typeof dtr !== 'boolean' || typeof rts !== 'boolean') throw new Error('控制线参数无效');
    if (!this.port?.isOpen) throw new Error('控制线仅适用于已连接的真实串口');
    await new Promise((resolve, reject) => this.port.set(this.config.rtscts ? { dtr } : { dtr, rts }, error => error ? reject(error) : resolve()));
    this.config = { ...this.config, dtr, rts }; this.emitState();
  }

  async startTimedSend(payload, interval) {
    if (!Number.isInteger(interval) || interval < 20 || interval > 3600000) throw new Error('发送间隔应为 20 到 3600000 ms');
    this.stopTimedSend(); const generation = this.sendGeneration; await this.send(payload);
    if (!this.connected || generation !== this.sendGeneration) return;
    this.sendIntervalMs = interval; let sending = false;
    this.sendInterval = setInterval(async () => {
      if (sending) return;
      sending = true;
      try { await this.send(payload); }
      catch (error) { this.stopTimedSend(); this.emit('notice', { level: 'error', message: error.message }); this.emitState(); }
      finally { sending = false; }
    }, interval);
    this.emitState();
  }

  stopTimedSend() { this.sendGeneration++; clearInterval(this.sendInterval); this.sendInterval = null; }

  setProcessing({ mode, script, graph }) {
    if (this.automationLock) throw new Error('请先停止自动测试');
    if (!['raw', 'script', 'graph'].includes(mode)) throw new Error('无效的处理模式');
    const next = mode === 'script' ? compileScript(script) : mode === 'graph' ? compileGraph(graph, { sampleRate: this.config.sampleRate }) : null;
    this.processingDefinition = next ? structuredClone({ mode, script, graph }) : null;
    this.processing = next; this.processingMode = mode; this.processingErrors = 0;
    this.latest = []; this.history = []; this.names = next?.names || []; this.emit('reset'); this.emitState();
  }

  async startRecording() {
    if (!this.connected || this.source === 'replay') throw new Error('请先连接设备');
    const generation = this.generation;
    const id = await this.store.start(this.config);
    if (generation !== this.generation || !this.connected) { await this.store.stop(); throw new Error('开始录制时设备已断开'); }
    this.emitState(); return id;
  }

  async loadReplay(id) {
    if (this.automationLock) throw new Error('请先停止自动测试');
    const recording = await this.store.load(id);
    const config = validateConfig(recording.header.config);
    await this.disconnect(); this.config = config; this.reset(); this.source = 'replay';
    this.replay = { ...recording, id, index: 0, position: 0, speed: 1 }; this.emitState();
  }

  controlReplay({ action, speed = 1 }) {
    if (!this.replay) throw new Error('请先载入录制');
    if (![0.25, 0.5, 1, 2, 4].includes(speed)) throw new Error('无效的回放速度');
    clearInterval(this.replayTimer); this.replayTimer = null;
    if (action === 'stop') { this.replay.index = 0; this.replay.position = 0; this.reset(); }
    else if (action === 'play') {
      if (this.replay.index >= this.replay.packets.length) { this.replay.index = 0; this.replay.position = 0; this.reset(); }
      this.replay.speed = speed;
      const start = performance.now(), from = this.replay.position;
      this.replayTimer = setInterval(() => {
        const replay = this.replay;
        replay.position = Math.min(replay.duration, from + (performance.now() - start) * speed);
        let budget = 1000;
        while (replay.index < replay.packets.length && replay.packets[replay.index].time <= replay.position && budget-- > 0) {
          const packet = replay.packets[replay.index++];
          this.receive(Buffer.from(packet.data, 'base64'), packet.dir, false);
        }
        if (replay.index === replay.packets.length) { clearInterval(this.replayTimer); this.replayTimer = null; this.emitState(); }
      }, 20);
    } else if (action !== 'pause') throw new Error('无效的回放操作');
    this.emitState();
  }

  async dispose() { await this.disconnect(); this.removeAllListeners(); }
}
