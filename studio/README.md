# 共演 Polyphony

共演把教师已有的讲义编成可直接授课的课堂。原稿每页都有固定出处。教师可以照常翻页，也可以在某一页接入讲解、例题或学生互动。放映、作答、公布和回顾都在共演中完成。

## 一台电脑演示

解压发行包，用 Chrome 或 Edge 打开顶层的 **共演演示室.html**。首页为「讲义备课」。随包的 **示例课件/光电信号读出.pptx** 是一份普通的四页中文课件。顶层 **Polyphony-System-Architecture.pdf** 第一页是整张系统架构图，第二页列出接口和技术栈。平台内也可打开「系统架构」。

1. 导入示例。四张原页依次是 RC 电路题、解答、双端干涉题和解答。直接点「在共演开始授课」，就能用方向键或翻页笔讲完。
2. 若要演示备课，先点「获取排课建议」。第 1 页可打开 RC 理科模板，改变参数、核对解答，再将讲解采用到这页。第 3 页可将「干涉仪的两个输出端」添加到这一页。
3. 点「在共演开始授课」进入新课堂。打开投影和学生端，在同一浏览器保留三个窗口。教师翻到原稿第 3 页，点「开启本页互动」，学生提交预测和理由。教师点「返回讲义」即可从这张原页继续。
4. 结束授课后点「查看课堂回顾」。再次打开同版课件，可在「批注与课堂反馈」定位原页、查看备课记录和选用真实课堂理由。

### 在原页开一局实验

打开示例课件后直接开始授课。第 1 页的「只准测一次」和第 3 页的「画条曲线，考考机器」都可以直接启动。没有课件时，可在「学科实验」里单人试玩，再点「带入课堂」。

- **只准测一次**　学生投票选一项测量，教师点击选项才消耗全班的测量机会。每台电路随机选定一种故障，且支持继承本页理科模板自定义的 `R / C / V₀ / V∞` 参数。获得读数后，学生再投票判断故障，最后对照两台候选电路的预测。
- **画条曲线，考考机器**　学生可以口述或上台画目标光强。按「只给三个点，让机器拟合」锁定预测，再让全班选盲测角度。用默认双峰曲线试 180°，机器起初预测全暗，目标为全亮。把第四点交给机器后，可以看到它换了光路参数。
- **数字黑箱**　黑箱内置 `x²` 或 `2x`，已知 `0 → 0` 与 `2 → 4`。全班只投一个输入数字尝试当场证伪另一条规则，体会重合点（0、2）与区分点的差异。

课堂的教师端、投影和学生端共享同一局。学生可在教师确认前改票，教师确认后公布同一条实验结果；支持在备课页通过「挂载课堂实验」显式指定本页实验，结束或返回讲义时自动写入实验归档。独立试玩页 **Polyphony-Playlab.html** 可以直接用浏览器打开体验全部三项实验。

电路读数、光学拟合与黑箱规则均由本地数值模型计算。光学寻优比较两种扫描倍率与 360 个相位偏置，每组都用最小二乘计算衰减器透过率。联机版沿用下文的 Chat Completions 配置。教师点「让 AI 同桌也选一次」，模型会根据题面、已经公开的读数或三个拟合点提出一个选项和理由，建议单独显示，学生票数由真人投票决定。模型未返回有效结果时，课堂仍可继续。

### 课件和教材导入

| 输入 | 单文件演示 | 联机版 |
| --- | --- | --- |
| PowerPoint 97–2003 的 `.ppt` | 直接读二进制文档，保留可读的原页顺序、标题、正文和隐藏状态。 | 同样可读取文字。装有 LibreOffice、UNO 和 PyMuPDF 时，可附上与原页核对过的静态整页画面。 |
| `.pptx` | 按原页读取文字、表格、原生 MathML 公式、图表数据、演讲者备注（自动存入教师私有批注，不进入公开正文）与嵌图。隐藏页留在备课区。 | 可使用 LibreOffice 生成静态整页画面；曾在离线版导入的同版课件切回联机版重新拖入时会自动原地补齐高清原页预览并保留全部批注。 |
| 教材、实验讲义 `.pdf` | 可用「粘贴讲义内容」按 `---` 或 `# 标题` 自动拆分为多页讲义。 | 由 Python 与 PyMuPDF 提取分页文字并采用 1600px 自适应 PNG/JPEG 渲染原页图。 |
| 备课包 `.polyphony-notebook.json` | 在「管理备课本」支持整本导出/导入与删除，也支持直接拖拽进备课区跨设备迁移。 | 同样支持完整的跨设备备课本迁移。 |

补充讲解、互动、挂载实验和课堂回顾均保留原稿页码。放映支持静态内容与原生 MathML 公式。原有动画、嵌入视频和宏不在支持范围；复杂版式可在备课预览中核对。服务端单次转换上限为 32 MiB、100 页，浏览器 PPTX 读取上限为 128 MiB、1,000 页，一份发布的原生讲义上限为 64 MiB。

## 多台手机加入与讲台模式

教师电脑安装 Node.js 22 或更高版本后：

- Windows：双击本目录的 **启动共演.cmd**
- macOS / Linux：运行 `./start.sh`
- 终端启动：`node server.mjs`（加 `--open` 自动打开浏览器）

教师电脑打开 `http://localhost:4188`。从「讲义备课」导入课件，点「在共演开始授课」创建现场课堂：

- **专业讲台 Presenter View**：点击顶部页码胶囊或按 `G` 打开目录抽屉快速跳页；仅教师可见的讲台侧栏实时显示在线学生数、本页困惑数、授课计时器、本页私有批注（可现场编辑回写）与下一页预载预览。学生端与投影端继续严格锁定当前页（`409` 防剧透）。
- **教师手机扫码遥控**：在联机模式点击「手机遥控」生成一次性 5 分钟配对二维码，用手机或平板扫码即可接管翻页、开关互动与实验，窄屏自动切换大按钮遥控布局。
- **课堂深度互动**：学生端可在幻灯片页点击「这页有疑问」轻量反馈（仅教师端与复盘热页可见，不打扰大屏）；互动环节支持全班作答理由抽屉（按选项筛选/搜索）、审核 1–2 条匿名原话投屏对比、AI 观点聚类一键对比、第二轮「第 1 轮 → 第 2 轮」认知迁移对比、大屏讨论倒计时与可控抽签公布。
- **课后多格式复盘**：「课堂回顾」汇总跨页互动改答统计、实验归档与困惑热页，支持导出 JSON、带 UTF-8 BOM 的 CSV（可选实名或匿名）以及 Markdown 教学复盘报告。

若电脑有多个网卡，可在启动前用 `POLYPHONY_PUBLIC_ORIGIN` 指定可达的完整地址。

## 赛场上可以怎么讲

上面的四页示例适合展示旧课件如何在共演内上课。下面是两轮互动的独立排练，可通过顶部课堂码创建光学样本排练，再打开「课堂控制台」。

| 操作 | 投影或评委看到什么 |
| --- | --- |
| 打开带九份样本的光学排练室，另开投影。 | 大屏上每个模拟点都标明来源。若改用现场课堂，让两位参与者独立提交选择、理由和各自相位点的光强预测。 |
| 点「公开首轮作答」，再点「整理作答证据」。 | 大屏公布选项和 A 端理论曲线。教师可以核对同选“A 端变暗”的两条原话，并勾选 2 条匿名原话直接投屏对比。 |
| 教师选择「追踪两个出口的能量」并开启倒计时。 | 大屏叠加 B 端的互补曲线并显示讨论倒计时。学生收到分支任务说明与第二轮题目，保留初答并可再次提交。 |
| 公布第二轮，进入「课堂回顾」。 | 大屏与控制台直观呈现「第 1 轮 → 第 2 轮」变化幅度与改答人数；回顾页可一键导出 CSV 或 Markdown 复盘报告。 |
| 切到「学科实验」的数字黑箱。 | 两个规则都能解释输入 0、2 的观测。让评委选一个新输入、先预测再开箱，看哪个模型与实测相符。 |

排练样本始终带模拟标记。有真实提交时，评议与参与抽签优先使用真实答卷；若想专看预设分歧，直接在初始排练室揭晓即可。抽签按提交者去重，跨轮答题仍为一人一次机会；控制台也支持清理仅加入未提交的占位名单。

## 编新课和接入模型

在「AI 备课」选择参考课例，填写主题、目标与材料。生成的草稿支持自由增删选项（2–6 个）和教学分支（1–5 条）、学生预览、导出为 JSON，也可在新课堂发布。

### 一分钟展示

1. 打开「AI 备课」，点「运行备课演示」。单文件 HTML 和 Node 版都能运行。
2. 给评委看编排回执。程序给干涉仪的三条观测编号。预设响应第一次引用了不存在的材料编号，校验拦截，第二次将上一轮草稿和精确错误送回模型修复后通过。回执同时记录课谱回读、多分支两轮试跑和材料引用覆盖。
3. 展开分支对应的材料，打开「学生预览」。教师可以修改题目、选项与分支，确认后点「开设新课堂」。学生作答后，由教师选择一条分支并开启第二轮。

演示响应来自内置样例。评委看到的引用校验、有限修复和课堂试跑由实际程序执行。

### 备课技术栈

| 环节 | 实现 | 展示时可查看的结果 |
| --- | --- | --- |
| 整理输入 | 浏览器原生 JavaScript 接收课题、学习目标、参考课和文本。材料按非空行编号，超过 12 段的部分保存在 M12。 | 材料编号与原文。 |
| 模型编排 | `POST /api/rooms/:code/compose` 绑定教师会话。备课、全课排课与课堂评议经 `lesson-provider.mjs` 调用 Chat Completions，兼容推理模型 `<think>` 剥离。 | 结果来源、模型、输出模式、尝试次数和耗时。 |
| 检查与修复 | 结构化请求与 JavaScript 校验支持 3–4 选项与 2–3 分支，校验重复项与材料编号。修复轮次传回上一轮 `assistant` 草稿与精准反馈。 | 失败原因、修复状态和分支引用。 |
| 课堂试跑 | `polyphony.score` v1 导出后回读（可选保留结构化 `materials` 与 `evidenceIds`）。状态机在临时房间逐条试跑全部两轮分支。 | 可读回的课谱、分支和试跑结果。 |
| 教师审阅 | 工坊编辑器（支持自由增删选项与分支）和学生预览。确认后在新房间发布，草稿保存在当前浏览器。 | 备课回执与可编辑课谱。 |

模型请求超时、接口报错或修复仍未通过时，编排器返回经过独立校验和试跑的本地模板草稿。配置以下环境变量并重启即可调用真实模型（完整配置模板见根目录 `.env.example`）：

| 变量 | 内容 |
| --- | --- |
| `POLYPHONY_AI_BASE_URL` | 模型服务的 API 基础地址，通常以 `/v1` 结尾 |
| `POLYPHONY_AI_MODEL` | 该服务提供的模型名称 |
| `POLYPHONY_AI_KEY` | 运行服务器的进程使用的凭据 |
| `POLYPHONY_AI_OUTPUT_MODE` | `json_object`（默认）、`json_schema`（严格 Schema）、`text`（自动剥离思考标签与围栏） |
| `POLYPHONY_AI_TEMPERATURE` | 可选采样温度（未设置时不发送，避免与推理模型冲突） |
| `POLYPHONY_AI_TIMEOUT_MS` / `POLYPHONY_AI_PLAN_TIMEOUT_MS` / `POLYPHONY_AI_ANALYSIS_TIMEOUT_MS` / `POLYPHONY_AI_PEER_TIMEOUT_MS` | 编排、排课、课堂评议与 AI 同桌的超时时间（毫秒） |
| `POLYPHONY_AI_DEBUG` | 设为 `1` 时在服务端输出脱敏诊断日志 |
| `POLYPHONY_STORAGE` / `POLYPHONY_ROOM_FILE` | 默认单文件 JSON 快照；设为 `sqlite` 或路径以 `.db`/`.sqlite` 结尾时启用 Node 22+ 原生 `node:sqlite` WAL 存储 |
| `POLYPHONY_ROOM_TTL_HOURS` | 自动清理超过指定小时未活跃的旧课堂（默认 72，设 0 关闭） |
| `POLYPHONY_TEACHER_PASSPHRASE` | 可选教师口令，公网部署时保护创建课堂与上传课件接口 |
| `POLYPHONY_RATE_LIMIT` / `POLYPHONY_TRUST_PROXY` | 滑动窗口限流开关（默认开启，设 `0` 关闭）及反代 IP 信任开关 |

课堂评议采用跨选项分层采样，最多送入 48 条真实作答理由，支持校验后的观点聚类 `clusters` 并在控制台一键投屏对比；且学生中途加入不会触发 `analyze` 的 `409` 并发冲突。

### 模块与接入点

页级排课支持全学科通用概念互动类型 `inquiry`（点击即可一键跳转 AI 工坊生成本页 `choice@1` 互动），也保留 `rc`、`mzi`、`history`、`blackbox` 识别；支持 `POLYPHONY_JEV_KEY`（TypeSafe System One）或 Chat Completions 或纯本地规则。

| 接入点 | 源码与契约 |
| --- | --- |
| 资料解析 | `pptx-reader.mjs`（含演讲者备注与 OMML→MathML）、`mathml.mjs`、`legacy-ppt.mjs`、`material-import.mjs` 与 `material-import-pdf.py`（1600px 自适应 PNG/JPEG）。 |
| 页级建议 | `lecture-planner.mjs`（含 `inquiry` 与空白归一化引文容错）、`lecture-quick-provider.mjs`、`lesson-provider.mjs`。 |
| 原生讲义 | `lecture-score.mjs`（支持每页挂载 `experiment` 与 `formulas`）与 `lecture-room.mjs`（含 `experimentArchive` 与 `lecturePulses`）。 |
| 理科例题 | `teaching-science.mjs` 负责 RC 暂态和双端干涉数值计算、四项校验与原生 MathML 输出。 |
| 批注与迁移 | `material-notebook.mjs` 基于 IndexedDB 按 SHA-256 存批注、草稿、实验挂载，支持原地补齐预览、删除及 `.polyphony-notebook.json` 导出导入。 |
| 课堂互动 | `dist/core/engine.mjs` 支持 `spotlight`、`spotlightWinner`、`timer`、`removeParticipant` 及 48 条分层采样聚类校验。 |
| 联机服务 | `server.mjs` 新增外置内容寻址图像资产 `GET /api/rooms/:code/assets/:file`（`immutable` + `ETag`）、`/frame` gzip 与教师预取、`GET outline`、`POST remote-pair`、`POST claim-teacher`、`Last-Event-ID` 断点续连与优雅停机。 |
| 持久化与压缩 | `room-store.mjs` 同时支持原子 JSON 快照（带 `fsyncSync` 与 TTL 清理）和零依赖 `node:sqlite` WAL 后端；`static-assets.mjs` 支持 gzip 与 Brotli (`br`) 静态资源压缩。 |

### 开源复用与架构取舍

- 内容契约借鉴 H5P 的语义定义。同一份计划约束用于模型编排和本地校验，再接上项目已有的课谱导入导出与课堂状态机。[H5P semantics](https://h5p.org/semantics)
- 模型层借鉴 Vercel AI SDK 的兼容端点与能力声明，将接口差异限制在适配器。运行时继续使用 Node 原生 `fetch`，单文件演示可离线跑完整流程。[AI SDK OpenAI Compatible Providers](https://ai-sdk.dev/providers/openai-compatible-providers)
- 备课采用阶段校验与有限修复。校验失败能在本地模板和试跑回执中复现，教师可在赛场展示具体失败原因。[Anthropic workflows](https://www.anthropic.com/research/building-effective-agents)
- 多端互动沿用 HTTP 命令和 SSE 角色快照。重连时借助 `Last-Event-ID` 避免冗余全量推送。现场邀请与手机遥控二维码继续复用 MIT 许可的 QR Code Generator。[MDN SSE](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events) · [QR Code Generator](https://github.com/kazuhikoarase/qrcode-generator)

## 运行与数据

- `dist/core` 保存课谱、状态机、公式转写、光学模型和角色视图。`dist/views` 保存讲义备课、讲台模式、课堂控制台、学生端、大屏、工坊、实验室和回放。
- 讲义嵌入图片在发布到联机服务时自动外置为内容寻址二进制资产（`<lectures>/assets/<sha256>.<ext>`），通过 `Cache-Control: private, max-age=86400, immutable` 和 `ETag` 缓存，大幅降低百人同屏翻页带宽与内存占用；`/frame` 支持异步 LRU 缓存与 gzip 压缩。
- 默认写入 `.polyphony-rooms.json`；高并发或大班场景推荐开启 `POLYPHONY_STORAGE=sqlite`（或将 `POLYPHONY_ROOM_FILE` 设为 `.db` 路径），利用 Node 22+ 原生 `node:sqlite` WAL 模式实现按房间原子写盘。
- 若要启用静态整页渲染，安装 LibreOffice Impress、可导入 `uno` 的 Python，以及可导入 `pymupdf` 或 `fitz` 的 Python。随附的 `Dockerfile` 和根目录 `docker-compose.yml` 已开箱配置全部依赖与健康检查。
- 在本目录执行 `npm test`（或 `node --test`）可运行全量回归测试。执行 `node tools/export-offline.mjs` 与 `node tools/export-offline.mjs --challenges` 可重新生成顶层单文件 HTML。
