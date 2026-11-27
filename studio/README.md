# 共演智课 · Polyphony V4 运行时

共演智课使用多阶段教学编排 Agent + 五阶段 Harness 工程护栏。[项目说明](../README.md)收录备课流程、课堂使用和比赛交付入口。

使用 Node.js 22 或更新版本。在本目录执行以下命令。

```powershell
node server.mjs
npm test
```

两份单文件 HTML 由同一套课堂运行时构建。

```powershell
node tools/export-offline.mjs
node tools/export-offline.mjs --demo
```
