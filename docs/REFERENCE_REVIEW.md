# Lissio reference assessment

Reviewed on 2026-11-14. Canonical repository:
https://codeberg.org/lissio-industries/Lissio

The supplied Horldsence/Lissio URL redirects to the organization above.
The GitHub Horldsence/vofa-NEXT endpoint returned 404 during this review.

## Reviewed revisions

- Umbrella: `bda4d1dc2f1b5da7aafc751bb34ca0c0950150b5` (`develop`).
- Client gitlink: `abe4329d2ac8261f870e2e61257453c288074638`.
- Server gitlink: `324d2fc391554c7aa723f6fab213a68159940bcb`.

The umbrella source was downloaded to `../../.references/Lissio`. Client files
were inspected through Codeberg's contents API. Recursive submodule cloning
stalled and was stopped; no complete server build or hardware test was run.

## Reuse decisions

| Area | Evidence | Decision |
| --- | --- | --- |
| Waveforms | Client `WaveformChart.tsx`, `waveformUplotInit.ts` | Use uPlot directly. The Lissio wrapper depends on its stores, generated types, source managers and RPC subscriptions. |
| Code editor | Client `src/components/CodeEditor.tsx` | Use CodeMirror 6 directly; the wrapper is small, but our expression execution contract differs. |
| Node editor | Client package manifest; README | Use React Flow directly. Its canvas does not provide a computation engine; implement and test a small bounded DAG for the first version. |
| Buffers | Client `src/lib/buffers/waveformBuffer.ts` | Adopt bounded data retention and batched notifications as architectural ideas. Do not import Lissio's snapshot wire format. |
| Protocols | README JustFloat / FireWater sections | Implement interoperable framing with fragmented-input tests. No claim that the Lissio Rust parser was audited. |
| FFT, recording, CAN, logic | README and roadmap | These are documented upstream capabilities, not independently verified in this review. Start with a dedicated FFT library and JSONL sessions locally. |

No Lissio product source, branding, fonts or images is copied into SignalDesk.
SignalDesk uses several of the same third-party libraries and its own integration.

## License observations

The inspected current `LICENSE` is Apache-2.0. `NOTICE` explicitly distinguishes
earlier GPL-only binary releases: the current license does not relicense those
releases. Redistributing copied current source would require the Apache license,
applicable notices, attribution and prominent modification notices.

Upstream's third-party inventory separately lists font licenses, GSAP custom
terms and MPL-2.0 dependencies. The umbrella license does not replace those terms.
SignalDesk does not use those fonts, GSAP, or Lissio's Rust dependencies.

## Architecture consequence

The full Lissio application comprises a React client, a Tauri shell, an independent
Rust service and nested Cargo workspaces. Extracting an entire view would pull in
a substantial application-specific contract. A smaller React + serialport tool
with an Electron desktop shell gives this Windows first version the requested
waveform, terminal and node workspace without requiring the full Rust build.
