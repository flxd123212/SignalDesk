# 真实 PCB 到 3D 的实测

日期：2026-11-14。样例使用本机 KiCad 10.0.6 自带的
RoyalBlue54L Feather 工程（LordsBoards，CERN-OHL-P-2.0）。

## 结果

- 原始 PCB 包含 71 个封装对象。
- 50 个对象具有独立器件 3D 几何，位号、型号、焊盘编号和网络已附加到 GLB。
- 其余 21 个是安装孔、测试点、标志、焊接跳线及若干没有独立外壳模型的连接器。
  PCB 上的孔/焊盘仍可显示，但不伪造额外器件外形。
- 最终资源无找不到的启用模型。45 条库路径解析到同名 STEP；缺失/重复 VRML 仅在工程提供其他有效模型时关闭。
- 原始导出 8,687 个网格，按现有节点内的材质合并为 131 个；149,696 个三角形、模型边界与 50 个位号保持一致。
- 最终文件 5,468,620 字节。Y 向上，glTF 世界单位为米。
- 桌面和 390px 窄屏通过非空像素、旋转、轨道交互、元件数据绑定、再导出/导入检查。

页面入口：姿态调试 → 载入真实 PCB 示例。
直接预览参数：`?view=attitude&board=royalblue54l&pose=manual`。

## 可复现步骤

原始副本：`artifacts/royalblue54l-source/RoyalBlue54L-Feather.kicad_pcb`。
原始安装目录未修改。以下操作在项目根目录运行：

```powershell
& 'D:\Kicad\bin\python.exe' tools/prepare-pcb-sample.py artifacts/royalblue54l-source/RoyalBlue54L-Feather.kicad_pcb artifacts/royalblue54l-source/RoyalBlue54L-Feather-resolved.kicad_pcb D:/Kicad/share/kicad/3dmodels artifacts/royalblue54l-metadata.json
& 'D:\Kicad\bin\kicad-cli.exe' pcb export glb --force --include-pads --include-silkscreen --include-soldermask --cut-vias-in-body -o artifacts/royalblue54l-pcb.glb artifacts/royalblue54l-source/RoyalBlue54L-Feather-resolved.kicad_pcb
node tools/annotate-pcb-glb.mjs artifacts/royalblue54l-pcb.glb artifacts/royalblue54l-metadata.json artifacts/royalblue54l-annotated.glb artifacts/royalblue54l-export-report.json
node tools/optimize-pcb-glb.mjs artifacts/royalblue54l-annotated.glb artifacts/royalblue54l-viewer.glb artifacts/royalblue54l-optimization.json
```

Python 使用 KiCad 自带的 pcbnew 解析器，保存后重新读取并逐项校验模型引用。
GLB 合并采用 Three.js BufferGeometryUtils；不简化三角形、不重建几何。
脚本的 wx 日志指向标准错误，字体缺失不再触发模态对话框。

## 仍存在的限制

KiCad 使用 DejaVu Sans Book 替代未安装的 Ubuntu Sans，丝印字形可能不同。
导出日志仍有 7 条退化轮廓提示；退出码为 0，模型可正常加载，不能据此声称几何零缺陷。
没有执行电气、生产或外壳装配验证，也没有把图片或点云自动转换为完整电路。
这是原始 PCB 加封装模型资源的真实导出，当前界面仍不直接解析任意 `.kicad_pcb` 或 STEP。
实时数据绑定必须由用户选择通道；模型元数据不能证明连接的是该实物或固件已使用该引脚。

报告、原始导出和截图均在 `artifacts/royalblue54l-*` 与 `artifacts/pcb-real-*`。
随应用载入的最终资源位于 `public/models/royalblue54l/`，保留来源与许可说明。
