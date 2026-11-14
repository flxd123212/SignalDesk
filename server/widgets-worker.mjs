import { parentPort } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

const quickjs = getQuickJS();
parentPort.on('message', async ({ id, input }) => {
  let runtime, context, result;
  try {
    const module = await quickjs; runtime = module.newRuntime(); runtime.setMemoryLimit(16 * 1024 * 1024); runtime.setMaxStackSize(256 * 1024);
    const deadline = Date.now() + 25; runtime.setInterruptHandler(() => Date.now() >= deadline);
    context = runtime.newContext();
    result = context.evalCode(`(() => { const ctx = ${JSON.stringify({ inputs: input.inputs, settings: input.settings, state: input.state })}; const widget = (${input.code}); const view = widget.render(ctx); const encoded = JSON.stringify({ view, state: ctx.state }); if (encoded.length > 65536) throw new Error('Widget result exceeds 64 KiB'); return encoded; })()`);
    if (result.error) throw new Error(String(context.dump(result.error)?.message || 'Widget evaluation failed'));
    const encoded = context.getString(result.value); parentPort.postMessage({ id, result: JSON.parse(encoded) });
  } catch (error) { parentPort.postMessage({ id, error: error.message }); }
  finally { if (result?.error) result.error.dispose(); else result?.value.dispose(); context?.dispose(); runtime?.dispose(); }
});
