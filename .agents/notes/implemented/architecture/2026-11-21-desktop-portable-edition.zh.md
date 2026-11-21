# Agent Note: 桌面端便携版

Status: implemented

[English](2026-11-21-desktop-portable-edition.md) | 中文

## Problem

桌面外壳假定 Electron 与 DSH 自行解析的固定位置：`userData` 与 `sessionData` 位于 `%APPDATA%`，日志与崩溃转储位于平台默认目录，Harness home 在 `~/.dsh`，包管理器缓存则落在各包管理器自己的地盘。绑定盘符的安装、注册表项，或把配置目录写入伪装起来的符号链接目录，都只能在创建它们的机器上满足规格里"便携"的说法。把 DSH 放在可移动介质上带着走的用户，需要每一个写入——会话、凭据、插件、缓存、日志、更新——都落在可执行文件旁边，且完全不碰宿主机。

## Decision

便携版就是普通 Electron 包加上便携根目录里的 `portable.json` 清单。选择模式的是这个标记文件，而不是构建开关，因此同一个产物在可移动介质上表现为便携版，清单不存在时表现为普通安装。

`apps/desktop/src/portable/` 负责该模式，并从 `main.ts` 的模块顶层开始运行，早于第一次 `app.getPath('userData')` 调用：

- `root.ts` 由 `process.execPath` 推导根目录（先看可执行文件所在目录，再看其上一级，覆盖 `app\` 目录暂存的布局），或由 `DSH_PORTABLE_ROOT` 指定。
- `config.ts` 解析清单：`pathVersion` 为 1、目录必须是相对路径、`portableMode`、可选的 `updateFeed`。
- `layout.ts` 解析每个目录，并拒绝任何逃逸出根目录的路径，因此被篡改或损坏的清单无法把写入重定向到宿主机。
- `bootstrap.ts` 创建目录结构、应用环境变量，并重定向 `userData`、`sessionData`、`logs`、`crashDumps`、`temp` 以及 Chromium 磁盘缓存开关。
- `environment.ts` 把缓存（`npm_config_cache`、`pnpm_config_store_dir`、`PYTHONPYCACHEPREFIX`、`PIP_CACHE_DIR`、`UV_CACHE_DIR`）与 `DSH_HOME` 映射到卷上。缓存变量使用传统名称而非 `DSH_` 前缀名称，因为插件安装用 `scrubbedParentEnv()` 运行 pnpm，而它会剥掉所有 `DSH_` 前缀变量。

便携模式同时收回 Electron 隐式执行的写入：应用不调用 `app.setAppLogsPath()`，也不调用 `app.setAsDefaultProtocolClient()`，因为两者分别落到宿主配置目录与注册表；命令管理改为给出磁盘上的目录，而不是在 `HKCU\Environment` 下写入 `dsh` 项。

更新同样留在卷上。`updater.ts` 用自定义 `AppAdapter` 构造 `NsisUpdater`，其 `baseCachePath` 指向 `updates\downloads`。应用更新无法重命名正在运行的应用目录，因此 `apply.ts` 调度一个脱离的 Node 帮手（`ELECTRON_RUN_AS_NODE=1`）：它等待外壳退出，安装到 `updates\staging`，交换目录并重新启动；`update.ts` 把这次尝试记录在 `updates\apply.json`，由 `settlePortableUpdate()` 在下一次启动时判定交换已完成还是必须回滚。

卷自己记录它曾运行在哪里。`relocation.ts` 把最近五个根保存在清单的 `rootHistory` 中，并在启动时、任何组件读取主目录之前，替换文本配置文件里的每个已记录根，同时改写会话头连同其目录——因为会话目录名由头部记录的工作目录派生。`session-log.ts` 只解压并重新压缩头部帧，因此会话事件保持逐字节一致。

两项操作在外壳之外执行。`backup.ts` 把整个主目录复制到 `backup\snapshots\`，在两侧校验文件数与字节数，并用基于重命名的回滚完成恢复；`snapshot-cli.ts` 提供 list、create、restore。`install.ts` 用预检替代系统安装器——卷类型、剩余空间、非空目标、载荷包含关系——随后执行带校验的复制并最后写清单，因此中断的安装会留下一个被下次启动报告为不完整的文件夹，而不是半装好的版本。启动还会报告快写满的卷，并把下载重定向到 `data\downloads`：否则这两者会以无法解释的写入失败或宿主配置残留的形式出现。

## Alternatives considered

**用外层启动器设置环境变量后启动已安装的应用。** 否决：启动器无法重定向 Electron 的 `userData`、`sessionData`、日志、崩溃转储与临时目录，而这些正是 Electron 最先写入的地方。它还会把更新器缓存与默认协议注册留在宿主配置里，使保证变成"只要不用这些功能就成立"。

**基于 NSIS 构建专用便携安装器。** 否决：NSIS 安装器会写 `HKLM`/`HKCU` 卸载项。"解压归档即可用"同时满足零注册表与随处复制两条规则，也不必维护安装器。

**在运行中的进程内完成更新。** 否决：Windows 无法重命名包含正在运行的可执行文件的目录，而 `app` 目录恰好装着要执行重命名的代码。

**把会话与设置里的绝对路径改写为相对路径。** 否决：这会改动已发布的会话文件以及每一个读取方。卷内的 `DSH_HOME` 已让存储的路径有意义，而清单的相对目录让盘符不必进入配置。

## Consequences

同一套代码路径服务两种模式，清单不存在时非便携路径完全不变，因此既有的二百余个桌面 spec 仍然有效。删除标记文件的用户会得到嵌套的配置布局，看不到在卷上创建的会话；这是"模式开关而非迁移"的自愿代价。

回滚仅限于上一个应用目录：会话与插件数据在 `app\` 之外，因此更新失败绝不会碰到它们，但 `backup\versions\` 只保留最近三个应用目录。

`pathVersion` 是硬性停止点。由更新版本写出的清单会拒绝启动而不是猜测目录语义，所以降级需要手工编辑清单。

本次变更中便携版仅限 Windows：布局代码是带 Windows 语义的纯路径运算，但打包、更新交换与脱离式帮手都是 Windows 行为。
