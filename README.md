# 共演 Polyphony

共演让教师把已有课件（`.pptx` / `.ppt` / `.pdf` / 多页 Markdown）直接编成可授课的互动课堂：保留原稿页码与演讲者备注、原生渲染数学公式，支持讲台 Presenter View、手机扫码遥控、大屏匿名原话对比、两轮认知迁移追踪、全学科 AI 排课与课后多格式复盘。零外部运行时依赖，既可单文件离线演示，也可局域网或 Docker 百人实时开课。

- 单机演示：[共演演示室.html](共演演示室.html) · [示例课件](示例课件/光电信号读出.pptx)
- 独立实验：[Polyphony-Playlab.html](Polyphony-Playlab.html)（曲线挑战 · 只准测一次 · 数字黑箱）
- 联机课堂、AI 配置、SQLite WAL 存储与安全部署：[使用说明](studio/README.md) · [配置模板](.env.example) · [系统架构图](Polyphony-System-Architecture.pdf)

使用 Node.js 22 或更新版本启动联机课堂，访问 http://localhost:4188：

- Windows：双击 `studio/启动共演.cmd`
- macOS / Linux：运行 `./studio/start.sh`
- 终端手动启动：`cd studio && npm start`
- 容器部署：`docker compose up -d`

在 `studio/` 运行 `npm test` 可执行全量回归测试。
