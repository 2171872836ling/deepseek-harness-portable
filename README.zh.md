# DeepSeek Harness 便携版

[English](README.md) | 中文

**非官方构建。** `deepseek-harness-portable` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 fork，增加了 Windows 便携版。本仓库不由 DeepSeek 发布、认可或支持。上游项目采用 MIT 许可，见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness（智能体框架）。本 fork 让它跑在 U 盘上：解压、双击，智能体写下的一切都留在那块盘里。

## 这个 fork 增加了什么

上游 DeepSeek Harness 把状态放在 `%USERPROFILE%\.dsh`，Electron 配置放在 `%APPDATA%`，缓存放在 `%TEMP%`、npm 与 pnpm 的 store、Python 缓存目录。对装在本机的应用这是对的，对一块在机器之间带着走的盘则不对。

便携版把这一切放在承载应用的那块盘上：

| 内容 | 便携版存放位置 |
|---|---|
| Harness 主目录：profiles、sessions、storages、worlds、attachments、插件 | `data\` |
| Electron 配置：Chromium 缓存、Cookie、本地状态 | `data\user-data\` |
| 智能体交还给你的文件 | `data\downloads\` |
| Electron 磁盘缓存、崩溃转储、临时文件 | `cache\electron\`、`cache\temporary\` |
| npm、pnpm、pip、uv 与 Python 字节码缓存 | `cache\npm\`、`cache\pnpm-store\`、`cache\python\` |
| 应用日志与便携版诊断日志 | `logs\application\`、`logs\portable\` |
| 更新下载、暂存与执行事务 | `updates\` |
| 版本备份、快照、被隔离的清单 | `backup\` |

它不写注册表，所以在借来的机器上不留痕迹。卸载就是删掉那个目录。

## 它是怎么做到的

便携版是 [`apps/desktop/src/portable/`](apps/desktop/src/portable/) 下的一组模块，在 Electron 第一次查询路径之前由 [`main.ts`](apps/desktop/src/main.ts) 启动：

1. **找到根目录。** `root.ts` 先在可执行文件旁边找 `portable.json`，再往上一层找，并遵循 `DSH_PORTABLE_ROOT`。盘符取自 `process.execPath`，所以 `E:`、`F:`、`G:` 都无需配置即可工作。
2. **读取并校验清单。** `config.ts` 与 `store.ts` 解析 `portable.json`，只接受仍落在根目录内的相对目录。清单损坏会被隔离到 `backup\` 后重建；由更高版本写出的清单会让启动停下，而不是去猜。
3. **重定向每一条路径。** `bootstrap.ts` 对 `userData`、`sessionData`、`logs`、`crashDumps`、`temp`、`downloads` 调用 `app.setPath`，加上 `disk-cache-dir` 开关，并导出 `DSH_HOME`、`TEMP`、`TMP`、npm 与 pnpm 的缓存与 store 变量，以及 `PYTHONPYCACHEPREFIX`、`PIP_CACHE_DIR`、`UV_CACHE_DIR`。插件安装通过子进程环境继承这些变量，所以从市场装的插件同样落在盘上。
4. **导入既有数据。** `migration.ts` 在首次启动时复制已存在的 `~\.dsh` 与桌面配置，记录源目录的内容，逐文件校验副本，并把未通过校验的副本挪开，而不是把它当成你的一半数据。
5. **跟随盘走。** `relocation.ts` 在清单里记录这个便携版住过的根目录。盘符改变后，它会改写配置文件与会话头里记录的路径，并重命名由这些路径派生的会话目录，改动的每个文件都先备份。
6. **不靠安装器更新。** `update.ts`、`updater.ts` 与 `apply.ts` 把更新下载到 `updates\downloads\`、暂存到 `updates\staging\`、把事务记进 `updates\apply.json`，并在外壳退出后由一个独立的 Node 助手完成替换。下次启动结算这条记录：替换完成就把旧版本移进 `backup\versions\`，被打断则还原。
7. **备份与恢复。** `backup.ts` 把主目录与清单快照到 `backup\snapshots\`，用文件数与字节数的清单校验，`snapshot-cli.ts` 提供命令行列出、创建与恢复。

便携版拒绝安装器通常会做的写入：不注册协议、不为 `dsh` 命令改 `PATH`、不启动会联系 Windows 错误报告的崩溃上报器，也不创建快捷方式或文件关联。

## 构建便携版

```powershell
node scripts/build.ts --scope artifacts
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts win-x64 --unsigned --dir
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-portable.ts --unpacked C:\path\to\apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
```

第三条命令在 `apps/desktop/.desktop-build/targets/win-x64/portable` 下产出 `DeepSeek-Harness-<version>-portable\` 及其归档。打包需要提权终端或开发人员模式，因为 pnpm 要创建 store 符号链接。完整前置条件、校验和与发布步骤见[发布清单](docs/release/portable-release-checklist.zh.md)。

## 使用

把归档解压到盘上，运行 `app\DeepSeek Harness.exe`。首次启动会创建上表中的目录，并在找到既有的 `~\.dsh` 时导入它。[便携版使用指南](docs/user/guide/desktop-portable.zh.md)覆盖清单字段、迁移规则、更新事务、备份，以及这个便携版的边界。

## 上游项目

DeepSeek Harness 构建于**一切皆插件**的架构之上，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计参见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://arxiv.org/abs/2608.25512)。上游文档位于 [https://deepseek-harness.github.io/deepseek-harness/](https://deepseek-harness.github.io/deepseek-harness/)。

上游处于_开发者预览_阶段，正在快速迭代。**未来将出现破坏兼容性的变更。** 运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

### 从 `npm` 运行上游

<a id="run"></a>

安装 `Node.js` 后运行：

```sh
npx @deepseek-ai/dsh web
```

该命令默认在 `http://127.0.0.1:3080` 启动 Web UI，本地启动时会在默认浏览器中打开它。SSH 启动只打印主机 URL，因为本地转发地址由 SSH 客户端或编辑器掌管。传 `--no-open` 可以在不打开浏览器的情况下运行服务。参见 [Web UI 指南](docs/user/guide/index.zh.md)。

### 从源码运行本仓库

<a id="run-from-source"></a>

```sh
git clone https://github.com/2171872836ling/deepseek-harness-portable.git
cd deepseek-harness-portable
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` 准备仓库产物。`pnpm dsh web` 直接使用这些产物，不再重新构建。

## 社区与支持

- 上游的反馈与缺陷报告请提交到 [DeepSeek Harness Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)。
- 便携版的问题属于本仓库的 [issues](https://github.com/2171872836ling/deepseek-harness-portable/issues)。
- 在你的插件仓库加上 [`dsh-plugin`](https://github.com/topics/dsh-plugin) 话题以便被发现。

## 参与贡献

参见 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。就便携版而言，[`apps/desktop/AGENTS.md`](apps/desktop/AGENTS.md) 记录了它的模块遵循的规则：在第一次路径查询之前完成重定向、从可执行文件推导路径、以内容而非目录是否存在判断状态、保持纯模块的纯粹。

## 开发

请从[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)开始。

`pnpm run dev:web` 在一个终端里构建、提供服务并在源码改动时重建客户端包；`make help` 列出 Web 与 Desktop 对应的 Make 目标；完整表格见开发指南的应用命令一节。

面向 agent 的规则见 [AGENTS.md](AGENTS.md)。

## 引用

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可

[MIT](LICENSE)

第三方依赖及其许可披露于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
