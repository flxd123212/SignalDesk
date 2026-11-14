# Circuit + Firmware Live Map: Feasibility

## Conclusion and Current Boundary

Feasible as an evidence-linked debug map, not as automatic electrical simulation.
SignalDesk already has device/project binding, React Flow diagrams, telemetry,
command permissions, alarms and source-change history. These are reusable building
blocks. The circuit importer and circuit-specific diagnostic workflow are a proposed
extension, **not an implemented feature**. No user schematic, board or firmware
pin mapping has been supplied for hardware validation.

## Proposed Data Model

- Component: reference, part number, package, function, source document location.
- Pin: component reference, physical pin, signal name, alternate function.
- Net: explicit pin endpoints; power and ground distinguished from data nets.
- Firmware binding: project/build target, source file, line, symbol, configured pin.
- Telemetry binding: device ID, channel or decoded field, unit, timestamp, freshness.
- Test: explicit command payload, application ACK matcher, expected telemetry delta,
  tolerance, settling time, deadline, cleanup command and enabled permission.
- Evidence: structured netlist / source configuration / runtime observation /
  AI inference / user confirmation, with confidence and unresolved conflicts.

Keep electrical connectivity and signal-processing edges separate. An ADC reading
is not a direct measurement of every voltage on an electrical net.

## Import and Mapping

1. Prefer KiCad exported XML/netlist and component properties. Extract actual
   pin-to-net connectivity using a structured parser, preserving references.
2. Treat PDF/image schematic recognition as provisional. OCR and model-generated
   wire junctions, labels and component values require human confirmation.
3. Inspect the selected firmware build target, board definition and pin macros.
   Resolve Arduino, ESP-IDF and STM32 HAL configurations separately. Source text
   alone cannot resolve all conditional builds or runtime pin multiplexing.
4. Match names and configuration into suggested bindings; show evidence and
   conflicts before applying. Preserve manually confirmed mappings on reimport.
5. Render a React Flow device/pin/sensor map with fresh data, stale state and
   clickable source locations. Do not use live values as proof of physical wiring.

Package-specific physical pin numbers require the exact part/package datasheet.
Do not infer them from an MCU family or a USB-UART bridge identifier.

## Closed-Loop Tests

Capture a baseline, send a user-authorized command to the bound device connection,
then check transport completion, firmware ACK, execution status and independent
sensor feedback in that order. Correlate by command sequence number when firmware
supports it. Stop after timeout or disconnect; never retry an actuator command
without an explicit retry policy and known idempotence.

Diagnostic outcomes should be specific:

- No transport completion: port, radio link, driver or connection failure.
- Transport completed, no application ACK: framing, firmware handler or wrong port.
- ACK rejection: invalid parameter, interlock, device mode or permission.
- ACK success, no telemetry change: stale telemetry, wrong binding, filtering,
  unexecuted command, actuator/power/sensor/wiring fault are all candidates.
- Independent electrical measurement contradicts expected state: stronger hardware
  evidence, still not enough to name a particular failed wire automatically.

Use wording such as "feedback timeout; inspect these candidates", not "wire is
broken". Tests involving motors, heaters or power outputs need explicit safe limits,
emergency stop and a board-side interlock. Software permissions are not an interlock.

## Electrical Simulation Is a Separate Layer

SPICE/ngspice can simulate analog subcircuits when accurate device models, supply
conditions and stimuli are available. It does not automatically emulate arbitrary
ESP32/STM32 firmware or wireless stacks. A visual live map can ship without SPICE;
calling it a physical circuit simulator would be misleading.

## Suggested Delivery Order

1. Manually confirmed component/pin map + source navigation + live telemetry.
2. Structured KiCad netlist import + build-target-aware source suggestions.
3. Permission-gated ACK/feedback tests with evidence-based fault reports.
4. Optional analog simulation adapter, clearly separated from measured telemetry.

Verification requires a known reference board, its schematic and firmware, a
calibrated measurement source, and induced faults with documented ground truth.
