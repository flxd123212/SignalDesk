import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { FirmwareWorkspace } from '../server/ai/firmware.mjs';
import { arduinoToolDirectories, traceArtifacts, symbolizeCrash } from '../server/crash-trace.mjs';
import { parseCrashTrace, recentCrashLog } from '../shared/crash-trace.mjs';
import { discoverGcc } from '../server/gcc.mjs';
import { toolDirectories, executableNames, isExecutable } from '../server/platform.mjs';

test('extracts instruction addresses from multiple vendors without including stack pointers or data', () => {
  const addresses = text => parseCrashTrace(text).addresses;
  assert.deepEqual(addresses('MEPC: 0x1004  RA: 0x2008 SP: 0x9000'), ['0x1004','0x2008']);
  assert.deepEqual(addresses('Faulting instruction address (r15/pc): 0x08001234\nLR = 08002001'), ['0x08001234','0x08002001']);
  assert.deepEqual(addresses('ELR_EL1=0xffff0020\nBadVAddr: 0x3020\nEPC: 80000100'), ['0xffff0020','0x80000100']);
  assert.deepEqual(addresses('#0  0x1234 in first\n#1  0x1234 in first'), ['0x1234','0x1234']);
  assert.deepEqual(addresses('PC: 0x9999\nBacktrace: 0x1000:0x3000\n 0x1004:0x3004'), ['0x1000','0x1004']);
  assert.deepEqual(addresses('0x1234\n0xabcd'), ['0x1234','0xabcd']);
  assert.deepEqual(addresses('ADC=0x1234 SP=0xffff'), []);
  const text = recentCrashLog([{dir:'RX',text:'Backtrace: 0xF:0xF\nHardFault\nP'}, {dir:'TX',text:'PC=0xBAD'}, {dir:'RX',text:'C: 0x1234\nELF file SHA256: 0123456789abcde0'}]);
  assert.deepEqual(parseCrashTrace(text), { addresses:['0x1234'], fingerprint:'0123456789abcde0' });
});

const run = promisify(execFile);
for (const [architecture, prefix, flags] of [
  ['Arm', 'arm-none-eabi', ['-mcpu=cortex-m3','-mthumb']],
  ['RISC-V', 'riscv32-unknown-elf', []],
  ['AVR', 'avr', ['-mmcu=atmega328p']],
  ['Xtensa', 'xtensa-esp32s3-elf', []],
]) test(`real ${architecture} ELF resolves to project source, validates fingerprint and reports unknown addresses`, async t => {
  const dirs = [...toolDirectories(), ...(await discoverGcc()).map(item => path.dirname(item.path)), ...await arduinoToolDirectories()];
  const [gccName] = executableNames(prefix + '-gcc');
  let compiler;
  for (const dir of dirs) { const candidate = path.join(dir, gccName); if (await isExecutable(candidate)) { compiler = candidate; break; } }
  if (!compiler) { t.skip(`${prefix} compiler unavailable on this runner`); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'sd-elf-'));
  t.after(() => fs.rm(root, { recursive:true, force:true }));
  const file = path.join(root, 'probe.c'), artifact = 'firmware.elf';
  await fs.writeFile(file, 'volatile int result;\nvoid probe(void) {\n  result = 7;\n}\n');
  const env = {...process.env, PATH: path.dirname(compiler) + path.delimiter + process.env.PATH};
  await run(compiler, [...flags, '-O0','-gdwarf-2','-ffreestanding','-nostdlib','-Wl,-e,probe','-Wl,-Ttext,0x1000', file,'-o', path.join(root, artifact)], { env, windowsHide:true });
  const { stdout } = await run(compiler.replace(/gcc(\.exe)?$/i,'nm$1'), ['-n',path.join(root, artifact)], {windowsHide:true});
  const address = BigInt('0x' + /^([\da-f]+) T probe\s*$/im.exec(stdout)[1]);
  const inputAddress = architecture === 'Arm' ? address | 1n : architecture === 'AVR' ? address / 2n : address;
  const workspace = new FirmwareWorkspace(root), config = { gccCompiler: compiler };
  const fingerprint = createHash('sha256').update(await fs.readFile(path.join(root, artifact))).digest('hex').slice(0,16);
  const input = { artifact, fingerprint, addressUnit: architecture === 'AVR' ? 'avr-word' : 'byte', addresses: ['0x' + inputAddress.toString(16),'0xfffff0'] };
  assert.deepEqual(await traceArtifacts(root), [artifact]);
  const report = await symbolizeCrash(workspace, config, input);
  assert.equal(report.architecture, architecture); assert.equal(report.verified, true);
  assert.equal(report.frames[0].file,'probe.c'); assert.equal(report.frames[0].name,'probe'); assert.ok(report.frames[0].line >= 2);
  assert.equal(report.frames[1].file,'');
  await assert.rejects(symbolizeCrash(workspace,config,{...input,fingerprint:'12345678'}),/不一致/);
  await assert.rejects(symbolizeCrash(workspace,config,{...input,artifact:'../firmware.elf'}),/当前工程/);
});
