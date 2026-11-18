import { Activity, Bell, Bot, Box, Cable, Code2, Cpu, CircuitBoard, Hammer, FlaskConical, FolderOpen, GitBranch, LayoutGrid, List, Network, PanelsTopLeft, ScanLine, ScrollText, SlidersHorizontal, TerminalSquare } from 'lucide-react';

export const navigationGroups = ['软件', '硬件', '联调', '测试'];
export const pages = [
  { id: 'display', label: '屏幕设计器', icon: PanelsTopLeft, group: '硬件', keywords: 'HMI OLED SSD1306 SH1106 TFT 触摸 屏幕 界面 GIF ST7789 ILI9341' },
  { id: 'tooling', label: '工具链中心', icon: Hammer, group: '软件', keywords: '安装 检测 下载 编译器 工具链 环境 Arduino GCC ESP-IDF' },
  { id: 'hardware', label: '硬件工程', icon: CircuitBoard, group: '硬件', keywords: 'kicad netlist 原理图 PCB 网表 引脚 GPIO 软件硬件' },
  { id: 'circuit', label: '实时电路图', icon: CircuitBoard, group: '联调', keywords: 'sensor pins 传感器 接线 硬件 实时' },
  { id: 'validation', label: '构建与测试', icon: Hammer, group: '测试', keywords: 'build test 编译 验证 gcc cmake' },
  { id: 'workspace', label: '实时监测', icon: Activity, group: '监测', keywords: 'scope oscilloscope spectrum fft 示波器 频谱 波形 主频' },
  { id: 'overview', label: '多设备总览', icon: LayoutGrid, group: '监测', keywords: 'devices 多串口' },
  { id: 'terminal', label: '串口终端', icon: TerminalSquare, group: '监测', keywords: 'serial uart hex ascii 搜索 收发' },
  { id: 'attitude', label: '姿态调试', icon: Box, group: '监测', keywords: '3d pcb imu 模型 四元数' },
  { id: 'can', label: 'CAN 分析', icon: Network, group: '监测', keywords: 'bus 总线 负载' },
  { id: 'graph', label: '节点编排', icon: GitBranch, group: '调试与测试', keywords: 'flow math 图 运算 传感器 测试代码' },
  { id: 'commands', label: '指令库', icon: List, group: '调试与测试', keywords: 'commands 分组 批量 定时' },
  { id: 'instruments', label: '协议与仪器', icon: SlidersHorizontal, group: '调试与测试', keywords: 'scpi modbus crc 协议仪器' },
  { id: 'frames', label: '自定义帧', icon: ScanLine, group: '调试与测试', keywords: 'binary 字段 二进制' },
  { id: 'automation', label: '自动测试', icon: FlaskConical, group: '调试与测试', keywords: 'test 自动化' },
  { id: 'alarms', label: '报警监测', icon: Bell, group: '调试与测试', keywords: 'alarm 阈值 通知 异常' },
  { id: 'sessions', label: '录制与回放', icon: FolderOpen, group: '调试与测试', keywords: 'record replay 日志 记录' },
  { id: 'chips', label: '芯片与固件', icon: Cpu, group: '工程与智能', keywords: 'flash esp32 stm32 keil iar 烧录 下载' },
  { id: 'editor', label: '项目源码', icon: Code2, group: '工程与智能', keywords: 'source files code 文件树 源码 IDE' },
  { id: 'script', label: '解析脚本', icon: Code2, group: '工程与智能', keywords: 'script formula js 公式' },
  { id: 'widgets', label: '自定义控件', icon: PanelsTopLeft, group: '工程与智能', keywords: 'javascript js 控件' },
  { id: 'agent', label: 'AI 与 Agent', icon: Bot, group: '工程与智能', keywords: 'deepseek api claude gemini ai 模型 代码修改' },
  { id: 'external', label: '外部 Agent', icon: Cable, group: '工程与智能', keywords: 'mcp cli codex harness 插件 权限' },
  { id: 'logs', label: '运行日志', icon: ScrollText, group: '工程与智能', keywords: 'logs error 错误 修改 审计' },
] as const;
