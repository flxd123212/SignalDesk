# Extended Debugging Workflows

## ASCII and HEX

Choose `ASCII + HEX`. Plain characters are ASCII, `[HEX:00 FF]` inserts raw bytes.
For example `AT[HEX:00 FF]END` sends `41 54 00 FF 45 4E 44`. `[[` escapes a literal
left bracket. Non-ASCII text is rejected in mixed mode; use TEXT with the chosen
encoding for Chinese text. The selected line ending is appended after the body,
then the checksum is calculated over the resulting bytes. The preview excludes
those suffixes. The same syntax works in command groups, timed sends and the API.

## Terminal Search and Export

The full serial terminal searches its current 1,000-packet cache, with highlighting
and previous/next match controls. Same-direction packets are searched as a stream,
so a split keyword is found; RX and TX are never concatenated together. Search is
literal, not a regular expression. Clearing the cache or switching devices clears
the searchable history. For long captures use recording, not the terminal cache.

TXT exports timestamps, direction and the selected text/HEX view. JSONL preserves
timestamps, direction, packet lengths and base64 bytes. RX/TX BIN exports preserve
only the exact byte stream for that direction, without timestamps. Export defaults
to the whole current cache; filtered export must be selected explicitly.

## Bluetooth

Bluetooth Classic SPP uses the Windows paired outgoing virtual COM port. Pair the
device in Windows settings, choose `Bluetooth SPP / virtual serial`, then its COM
port. Native SignalDesk provides a button to open Bluetooth settings. USB-UART
features such as DTR/RTS are deliberately not asserted on SPP. Project binding,
recording, protocols, alarms and command groups use the same engine as wired serial.

The configured COM baud rate is not the Bluetooth RF bitrate. Link throughput and
latency depend on the adapter, remote firmware and radio conditions. Some boards
only expose BLE; BLE GATT/NUS needs service and characteristic UUIDs plus a separate
transport adapter and is not implemented here. Not all ESP32 variants support SPP.
Mock transport tests passed; physical Bluetooth hardware has not been validated.

## Scope and Frequency

The waveform supports time/div, independent channel units/div, vertical center,
software AC coupling, inversion, edge and single triggers, pretrigger, holdoff,
two time cursors, autoset and dominant-frequency search. F11/Esc leave fullscreen.
Two rotary controls adjust time/div and channel range in waveform mode, or
frequency span and amplitude/div in spectrum mode. Drag vertically, use arrow keys,
or focus the knob before using the mouse wheel. Numerical selectors remain available.
These are software measurement controls, not a replacement for analog front ends,
hardware triggers or calibrated oscilloscope probes.

FFT uses FFT.js, up to 4096 points, DC removal and a Hann window with single-sided
amplitude correction. The peak frequency uses interpolated bins; displayed bin
spacing is not a promise of measurement accuracy. The configured sampling rate
must match the device's real sample clock. UART arrival time is not sample time.
The app's synthetic sample timestamps cannot independently prove acquisition rate.

## CAN, Attitude and JS

CAN analysis accepts CSV (`time,id,data`, optional `extended,rtr,dlc`) or candump -L.
Time is seconds; IDs and payload are hexadecimal. Classic CAN only, 0..8 bytes.
Load is a lower/upper bit-stuffing estimate including IFS, not a physical measurement.
Error frames, retries and CAN FD are not modeled. No native USB-CAN driver is added.

Attitude uses a Three.js development-board model with Z-up, ZYX Euler angles or
normalized quaternions in WXYZ order, channel mapping, zeroing and orbit controls.
The model library contains generic, ESP32 DevKit, ESP32-S3 DevKit, STM32 Blue Pill,
Arduino Uno R3, Raspberry Pi Pico and GY-521/MPU6050 schematic reference models.
These are original simplified geometry, not official or package-verified CAD assets.

PCB CAD exports can be imported as self-contained, uncompressed GLB or STL (20 MiB
limit). STEP and raw PCB files need conversion in a CAD tool; no screenshot-to-3D
reconstruction is claimed. GLB preserves node names and metadata where available;
STL usually contains only a single unlabeled surface. External model resources are
blocked. Choose the correct model up axis (GLB usually Y, PCB STL usually Z).

All seven illustrative boards now use detailed packages, connectors, solder pads,
silkscreen and environment lighting. The default is the explicitly labeled S3
dimension reference, not an inferred connected-board identity. Perspective/top/
bottom views and grid/axes toggles are available. The RoyalBlue54L sample is an
actual KiCad PCB export with 50 component bodies and PCB pad/net metadata; see
`PCB_EXPORT_SAMPLE.md`. Its CAD faces are batched without triangle decimation.

Click a component or choose it from the component list, inspect its name/type,
annotate pins and map a live data channel. The overlay displays the selected
component's bound value. A name or GLB extra is evidence from the model, not an
independent identification of a chip. A USB bridge cannot identify PCB components.
No datasheets or user PCB files have been supplied to validate physical pin numbers.

Models and annotations survive page/device switches in the current browser session
(up to eight workspaces). Export the model as GLB and annotations as JSON for durable
files; automatic disk persistence across application restarts is not implemented.
Imported geometry remains in the browser, not uploaded to an AI service. Exported
3D geometry is for visualization, not fabrication or electrical validation.

JS widgets run in QuickJS in a worker: no host filesystem, network, DOM or serial
APIs. The VM has 16 MiB memory and a 25 ms interrupt deadline; a 2.5 s worker timeout
provides a secondary bound. Preview updates at at most 5 Hz. Return a declarative
number/bar/indicator/button/chart view, not arbitrary HTML. Sending is a separate
explicit enable plus manual action against the bound device; script code cannot
send automatically. Templates and examples are in `shared/widget-templates.mjs`.

## Baud and Quality Limits

39 presets from 50 to 12,000,000 baud plus custom integer rates are accepted as
driver requests. A selectable rate does not establish that the hardware supports
it. Drivers may reject or approximate rates; SignalDesk cannot independently measure
the physical baud clock. Test the actual adapter and MCU pair at the chosen rate.

The terminal quality report separates valid samples, unparsed candidates, checksum
failures, binary resynchronization bytes, processing failures, recording failures,
display drops and processing time. Successful numeric parsing is not a CRC pass.
Actual frame-loss and bit-error rates remain unknown without sender sequence
numbers or a known reference stream. Display caching is bounded independently of
decoding, and recording errors must be checked before trusting a capture.

Run `node tests/decode-benchmark.mjs` for a repeatable CPU-only benchmark. It verifies
200,000 sequential frames per format and writes `artifacts/decode-benchmark.json`.
This excludes physical I/O, recording and browser load and is not an end-to-end
throughput guarantee. Physical acceptance should include a sequence+CRC loopback,
long recordings, simultaneous devices and sustained full UI load at the target baud.
