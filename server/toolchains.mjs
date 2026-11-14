import { findKeilExecutable } from './keil.mjs';
import { findIarExecutable } from './iar.mjs';

export async function discoverToolchains() {
  const found = {};
  try { found.keilExecutable = await findKeilExecutable(); } catch { /* Optional toolchain. */ }
  try { found.iarExecutable = await findIarExecutable(); } catch { /* Optional toolchain. */ }
  try { found.cspyExecutable = await findIarExecutable('', 'CSpyBat'); } catch { /* Optional debugger. */ }
  return found;
}
