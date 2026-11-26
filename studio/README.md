# 共演智课 · Polyphony

教师可以导入已有课件或从主题生成课件，经预览后直接在共演里上课。学生在同一页作答，教师可公布结果、选讨论方向并开启第二轮，完整记录留在课后复盘。

## 正式课堂

- **单机离线** — 在现代浏览器打开 `共演智课-离线平台.html`。支持 PPT、PPTX、共演课件 JSON 与粘贴讲义。教师、投影和学生预览可在同一浏览器内联动。
- **多设备联机** — 解压后双击 `启动V4共演.cmd`，或进入 `polyphony-studio/` 执行 `node server.mjs`。需要 Node.js 22 或更新版本。按终端提示打开教师端，开课后从「邀请学生」分享课堂码或加入链接。
- **导入 PDF** — 使用联机服务与 Python + PyMuPDF 做原页渲染。联机 PPT/PPTX 原页画面由 PowerPoint 或 LibreOffice + Python UNO 提供。浏览器也可读取 PPT/PPTX 的文字和可提取内容。
- **AI 备课** — 填写课程和主题即可开始。在「设置」填入兼容 Chat Completions 的端点、模型与密钥，可生成多页讲义并为原稿推荐互动。本地模式可生成备课框架。讲授前可逐页核对课件，必要时展开「生成详情」。
- **带走课件** — 从预览的「更多」下载共演课件 JSON。该格式保留正文、公式、图片和互动，可在另一台电脑直接导入。继续上次的草稿使用当前浏览器保存的记录。

## 比赛演示

打开 `比赛演示/共演智课-单文件离线演示版.html` 后可以直接试讲 C 指针、物理光学和大学英语三套课件。演示课堂支持模拟作答，并可打开交互模组与技术架构。同目录提供可独立导入的示例课件、参赛介绍、决赛 PPT 和带标注的旧版截图。

正式平台与比赛演示可分别使用。比赛时可以打开演示 HTML，也可以把示例 JSON 拖入正式平台，组织一场真实课堂。

## 联机配置

服务默认监听 `0.0.0.0:4188`。跨设备建议使用同一网络。配置 `POLYPHONY_PUBLIC_ORIGIN` 可指定二维码中的可访问地址。

- `POLYPHONY_TEACHER_PASSPHRASE` 为开课与服务端课件导入启用教师口令。讲台「更多」中的手机遥控二维码五分钟内可一次性领取。
- `POLYPHONY_STORAGE=sqlite` 启用 SQLite WAL，建议使用 Node.js 22.13 或更新版本。默认使用 JSON，可以用 `POLYPHONY_ROOM_FILE` 指定存储路径。切换存储时采用独立文件，旧 JSON 可用原模式读回。
- `POLYPHONY_AI_BASE_URL`、`POLYPHONY_AI_MODEL`、`POLYPHONY_AI_KEY` 与可选 `POLYPHONY_AI_OUTPUT_MODE` 支持在服务进程中配置模型。教师也能从页面设置会话配置。

## 从源码运行与验证

在仓库的 `studio/` 中执行以下命令。

```powershell
node server.mjs
node --test tests/*.test.mjs
node tools/export-offline.mjs
node tools/export-offline.mjs --demo
```

导出后的正式离线平台只加载通用课堂运行时。演示导出额外装入课件 JSON 和模组展示。由 CI 验证两种导出，以及无演示目录时的备课、开课、学生作答和复盘。
