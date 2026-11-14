const schema = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text = description => ({ type: 'string', description });

export const READ_ONLY_TOOLS = new Set(['get_device_snapshot', 'list_firmware_files', 'read_firmware_file', 'search_firmware', 'get_build_status']);

export const AGENT_TOOLS = [
  { name: 'get_device_snapshot', description: 'Read bounded serial statistics and recent numeric samples. Time basis is the configured sample rate.', parameters: schema({}) },
  { name: 'list_firmware_files', description: 'List source files in the user-selected firmware project.', parameters: schema({}) },
  { name: 'read_firmware_file', description: 'Read one UTF-8 source file and its SHA256 before proposing edits.', parameters: schema({ path: text('Relative path inside the selected firmware project') }) },
  { name: 'search_firmware', description: 'Search literal text in allowed project source files. Returns relative paths, line numbers and excerpts; reports bounded or skipped files.', parameters: schema({ query: text('Literal search text, case-insensitive, 1 to 200 characters') }) },
  { name: 'get_build_status', description: 'Read the actual last build status, exit code and bounded output. Does not start compilation or run commands.', parameters: schema({}) },
  { name: 'propose_file_change', description: 'Create a reviewable diff. This does not write the source file. The user applies it explicitly.', parameters: schema({ path: text('Previously read relative file path'), expectedHash: text('Exact SHA256 from read_firmware_file'), content: text('Complete replacement file, not a diff; preserve unrelated code'), reason: text('Concrete rationale, limitations and expected effect in Chinese') }) },
  { name: 'propose_serial_command', description: 'Propose a serial command for explicit user execution. Do not invent board-specific commands.', parameters: schema({ text: text('Command text or hex bytes'), format: { type: 'string', enum: ['text', 'hex', 'mixed'] }, ending: { type: 'string', enum: ['none', 'lf', 'crlf', 'cr'] }, checksum: { type: 'string', enum: ['none', 'modbus', 'sum8'] }, reason: text('Purpose and expected device effect') }) },
  { name: 'propose_build', description: 'Propose running the configured project build. This only compiles; it does not flash firmware.', parameters: schema({ reason: text('Why this build is needed') }) },
  { name: 'propose_toolchain_command', description: 'Propose a user-approved PlatformIO run, arduino-cli compile, cmake --build or read-only git command. No shell, upload, flash or install. Toolchain must be installed in PATH.', parameters: schema({ commandLine: text('One supported command with arguments'), reason: text('Purpose and expected result') }) },
];
