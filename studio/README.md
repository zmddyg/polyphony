# 共演智课 · Polyphony V4.0

双源 AI 备课、五阶段 Agent Harness 与页内原生流式互动课件播放器。已有 PPT / PPTX / PDF 可按原页活化，也可从课程对象、核心重难点和课时规模生成原生课件。讲义、实时作答和反馈在同一张课件画布内展开。

## 立即使用

- 打开 `共演智课-单文件离线演示版.html`：完整工作区与 C 指针 12 页、物理光学 10 页、大学英语 Unit 4 10 页课程。
- 打开 `共演智课-交互模组库独立版.html`：直接进入四类模块沙箱，查看实时 JSON；“Harness 架构与契约同屏”可对照新版架构。
- 本机或局域网课堂。先完整解压交付 ZIP，再双击根目录的 `启动V4共演.cmd`。也可在解压后的 `polyphony-studio/` 执行 `node server.mjs`。打开终端显示的 Polyphony 地址（默认 `http://localhost:4188`），按 `Ctrl+C` 停止服务。
- 本地制作工作区的主源码位于 `.polyphony-work/source/studio/`。源码发布副本使用 `studio/` 目录。各布局均可用根目录的 `启动V4共演.cmd`。
- 需要 Node.js 22 或更新版本。服务使用 Node 原生模块，无需 `npm install`。默认监听 `0.0.0.0:4188`，手机需能通过局域网访问教师电脑。

两份 HTML 内嵌模块、样式、图标和架构 SVG，现代 Edge / Chrome 可通过 `file:///` 断网使用，无 CDN 依赖。同浏览器多标签页可同步本机课堂；跨设备授课需启动服务。

## Dual-Source AI Deck Harness

两个备课入口均可访问三套完整实战课程。

| 来源 | 输入与结果 |
| --- | --- |
| 📂 导入旧教学材料活化 | `.ppt / .pptx / .pdf` → 原页顺序、可读取文字、`M1..Mk` 引文锚点与原页视觉预览。隐藏页保留位置与元数据，默认不放映。 |
| ✨ AI 从零生成原生课件 | 课程对象、重难点、8 / 10 / 12 页规模 → 代码栏、双栏代码、原生表格、公式块、讲授备注与互动契约。无模型时明确标注本地结构化生成；任意主题框架也有说明。 |

| 五阶段 | 校验与输出 |
| --- | --- |
| 01 结构化 / 大纲规划 | 页序、结构化内容、视觉预览、引文编号和版本摘要。 |
| 02 节奏预算 | 60s 专业课微卡点 / 3min 大班思辨；非互动页保留完整。 |
| 03 并发合成 | 页级合成结构化讲义与声明式互动契约。 |
| 04 护栏 / 单次修复 | `M1..Mk` 逐字引用、安全表达式、答案与步骤一致性；最多一次修复，失败明确回退。 |
| 05 双轮试跑 | 独立作答 → 公布 → 教师分支 → 二轮改答 → 收束；输出逐页回执与 `polyphony.lecture@1`。 |

`safe-expr` 只解析白名单数学 AST，零 `eval`。引文和数值检查保证可追溯与执行边界，不能代替教师核对语义、量纲和定义域。

## Native Inline Streaming Slide Player

教师、16:9 投影与手机共享当前页和轮次。底部连续导航、方向键、PageUp / PageDown 或空格可自由翻页。离开互动页自动保存，返回恢复；过期页面与轮次提交会被拒绝。

- **大屏**：完整 16:9 画布内融合讲义、SVG 曲线、立场条和反馈；页码条带互动徽标。逐行找茬的热力直接附在教学代码一侧，右侧显示红蓝理由与二轮跃迁，零弹窗。
- **教师**：同页播控坞执行开启互动、注入模拟、公布、整理理由、选择分支、二轮改答与完成本页。逐行模块首轮 5/4/3 票，二轮 11/12 指向正确项，模拟样本始终标注。
- **手机**：同页看讲义、点选代码行或选项、选择三秒理由胶囊。完成页的要点累积到“📚 本堂已解锁考前速查卡”底部抽屉。内容自然滚动，无需切页或弹窗。

公开端不包含学生身份、原始私有理由或私有课堂档案。红蓝对照只公开选定并匿名处理的引文；投影导航仅包含页码和模块类型。

## 四种 Modular Activity Interfaces

| activityId | 输入 | 页内输出 |
| --- | --- | --- |
| `concept-diagnosis@1` | 选项、正确项、理由、分支 | 分布、红蓝理由、配对跃迁 |
| `step-fault@1` | 步骤、`faultStepId`、诊断 | 点选、行级热力、首错机制 |
| `param-explorer@1` | sliders、curves、坐标轴 | 实时 SVG 曲线与预测检验 |
| `evidence-weighing@1` | 立场、维度、AI 辩友论点 | 立场条、可质询盲盒 AI 辩友 |

纯声明式 JSON 驱动，无学科专用硬编码仿真器。AI 辩友是一份供质询的有漏洞论证，不是权威答案；开放题不设唯一正确立场。

## 四份实战样例

交付根目录与源码根目录的 `示例课件/` 各有一份。三个 PPTX 均为 16:9，使用可编辑的原生文字、表格和代码栏。

| 文件 | 内容 |
| --- | --- |
| `01-软件技术基础-第6章指针与函数传址实战(12页).pptx` | 12 页；内存表、步长、四种自增、swap 双栏代码、空指针审计、数组退化 / 逆序 / 二维寻址与闭卷速查。 |
| `02-物理光学与光电调制-衍射干涉与调制实战(10页).pptx` | 10 页；复振幅、不等损耗 ER 五步审计、单缝 / 光栅、MZM、偏置谐波、RC 与 TFLN 匹配。 |
| `03-大学英语Unit4-实证阅读与学术思辨实战(10页).pptx` | 10 页；读表、竞争解释、Hedging、搭配、生态谬误、盲审辩论与比较写作。 |
| `04-旧课件导入示例-软件技术基础第6章指针原稿(8页).pdf` | 8 页；内存、swap 与 inv 原稿；用于旧材料入口，保留每页视觉与文字，在原页旁挂载互动；无个人姓名或学号。 |

`示例课件/V4原生实战课件/` 保留三套 JSON 和五阶段回执。C 互动在 P4 / P7 / P11，光学在 P3 / P5 / P8，英语在 P4 / P7 / P8，各有三个。JSON 可直接导入开课。

讲义按指定提纲原创，不冒充校方正式课件。英语 2,000 人调查、10,287 篇书评及统计值均明确标注为课堂模拟。C 的 8B 指针是指定 ABI 假设；光学采用 `U=A cos(ωt−φ)`、`Ũ=A exp(iφ)`、时间因子 `exp(−iωt)` 与 `I=Ũ*Ũ`。谷底二倍频注明理想小信号前提。

## 原页转换与模型网关

PDF 预览依赖 Python + PyMuPDF。Windows PPT / PPTX 原页转换支持已安装的 PowerPoint（只读、关闭宏、无窗口、互斥串行，不接管用户现有实例），也支持 LibreOffice + UNO。无渲染器时不虚构视觉预览，浏览器仍可读取 PPTX 文字和表格等结构。静态 HTML 无法执行本机 PDF / Office 转换；内置课件和 JSON 全离线可用。

顶栏“模型 API 接入网关”可配置兼容端点、模型和 `json_schema / json_object / text` 输出模式。密钥仅存当前服务进程或离线标签页的会话内存，不写入课件、存档或 HTML。模型失败有明确回退回执。离线标签页调用外部模型仍需网络及端点 CORS 支持。

## 联机课堂配置

- 设置 `POLYPHONY_TEACHER_PASSPHRASE` 后，教师创建房间或上传旧课件时，按页面提示输入「教师口令」。口令仅保存在当前页面内存中。学生照常通过课堂链接加入。
- 在教师端点击「手机遥控」，在「手机遥控配对」中生成二维码。教师用手机扫码后可控制同一课堂，二维码五分钟内有效且只能使用一次。
- 默认使用 JSON 保存课堂。设置 `POLYPHONY_STORAGE=sqlite` 可启用 SQLite WAL，需 Node.js 22.13 或更新版本。`POLYPHONY_ROOM_FILE` 可指定存档路径，以 `.db`、`.sqlite` 或 `.sqlite3` 结尾时会选择 SQLite。原有 JSON 文件可独立保留，切换 SQLite 不会导入既有记录。

## 构建与验收

在源码目录执行以下命令。本地制作工作区使用 `.polyphony-work/source/studio/`，从 ZIP 解压后使用 `polyphony-studio/`。

```powershell
node --test tests/*.test.mjs
python scripts/build-sample-decks.py
python scripts/build-v4-architecture.py
node tools/build-v4-examples.mjs ../示例课件/V4原生实战课件
node tools/export-offline.mjs
node tools/export-offline.mjs --challenges
python scripts/capture-v4-exhibition.py
```

样例生成使用 python-pptx、PyMuPDF、Pillow 和本机 PowerPoint，渲染全部 32 页并生成联系表。PPTX 另用 `C:/Users/jsk46/.agents/skills/pptx/scripts/office/validate.py` 校验。架构 PDF 与浏览器验收使用 Python Playwright 和 Edge。

浏览器脚本独占临时服务并在结束后停止；在两份 `file:///` 包中逐页验证三套课程、全部九个互动、手机跟随、模块库与内嵌架构。展览图全为 `full_page=False`、DPR 2：01 / 07 是 1440×900 视口，02–05 是 1920×1080，06 是两个 390×844 手机视口并排加标签。输出像素数是对应视口的两倍。

架构图位于源码目录的 `dist/assets/architecture.svg`。交付根目录提供两页 A4 `共演智课-系统架构与Harness协议.pdf`。本地测试日志、逐页渲染、几何回执与浏览器报告写入源码目录的 `artifacts/v4-phase2/`。

在制作工作区根目录运行以下命令，用现有参赛文档、截图、样例、两份离线 HTML 和当前源码重建并核对 `共演智课-AI教学大赛交付包.zip`。

```powershell
python .polyphony-work/source/studio/tools/package-v4.py
python .polyphony-work/source/studio/tools/package-v4.py --verify
```

源码与交付同步至 `.polyphony-work/github-publish-20261124/polyphony/`，排除 node_modules、临时 artifacts、运行时课堂文件与缓存，保留 `.git`。`.polyphony-work/source-v1-backup` 不参与构建和同步。
