# 便携版（Windows）

[English](desktop-portable.md) | 中文

便携版从可移动磁盘运行 DeepSeek Harness，并把写入的一切都留在该磁盘上。会话、凭据、插件、缓存、日志与更新都放在应用旁边，因此把磁盘换到另一台电脑、或换个盘符，改变的只有盘符本身。

本页说明这个功能是什么、怎么实现的。日常使用的流程——解压、首次启动、文件去了哪里、换机、更新与排错——见[便携版使用手册](desktop-portable-manual.zh.md)。

## 1. 便携版是什么

解压后的便携版长这样。第 2 节的 `portable.json` 清单才是"便携版"的开关；没有它，应用按普通安装方式运行并写入用户配置目录。

```
DeepSeek-Harness-<version>-portable\
  DSH.exe
  portable.json
  data\
  cache\
  logs\
  updates\
  backup\
```

`DSH.exe` 是应用本体，它所在的文件夹承担清单布局里的 `app\`。`data\` 是 Harness 主目录（`DSH_HOME`）；`cache\` 存放不属于主目录的缓存；`logs\` 接收应用日志与便携诊断；`updates\` 存放下载的更新、暂存区与待处理更新记录；`backup\` 保存配置备份、历史应用版本、整卷快照与被隔离文件。

规格书单列的目录——插件下载、插件数据、会话、日记、归档——由 Harness 主目录托管，而不是在便携根下另建：它们按常规 `DSH_HOME` 规则落在 `data\` 之下。下表把规格草图映射到实际路径。

| 规格草图中的目录 | 实际位置 |
| --- | --- |
| `data\config`、`data\conversations`、`data\worlds`、`data\diary`、`data\archive` | `data\<类别>\`，遵循 Harness 主目录布局 |
| `data\profiles` | `data\profiles\`（插件 profile；桌面 profile 为 `data\profiles\desktop`） |
| `data\user-data` | `data\user-data\`（Electron `userData`） |
| `plugins\downloads`、`plugins\installed`、`plugins\dependencies`、`plugins\registry` | 通过 pnpm 落在 `data\profiles\desktop\` |
| `plugins\cache`、`plugins\temporary` | `cache\`（`cache\npm`、`cache\pnpm-store`、`cache\temporary`） |
| `logs\application`、`logs\plugins`、`logs\updater`、`logs\errors` | `logs\application\` 与 `logs\portable\` |
| `updates\downloads`、`updates\staging`、`updates\packages` | `updates\downloads\`、`updates\staging\` |
| `backup\config`、`backup\database`、`backup\plugins`、`backup\versions` | `backup\snapshots\`、`backup\versions\` 与 `backup\relocation\` |
| `cache\application`、`cache\node`、`cache\electron`、`cache\http` | `cache\`、`cache\electron\`、`cache\electron\http\` |
| `cache\temporary` | `cache\temporary\` |

## 2. `portable.json` 清单

`portable.json` 位于便携根。文件中只存相对目录，因此盘符永远不会出现在文件里。`pathVersion` 记录布局版本；由更新版本写出的清单会让启动停下并给出明确提示，而不是猜测。

```json
{
  "portableMode": true,
  "pathVersion": 1,
  "dataDirectory": "data",
  "cacheDirectory": "cache",
  "tempDirectory": "cache/temporary",
  "logDirectory": "logs",
  "updateDirectory": "updates",
  "backupDirectory": "backup"
}
```

启动时从正在运行的可执行文件推断便携根：先在 `DSH.exe` 同级、再在其上一级查找 `portable.json`，因此 `Root\DSH.exe` 与 `Root\app\DSH.exe` 都可用。`DSH_PORTABLE_ROOT` 可覆盖这次查找，供测试使用。

绝对路径、盘符相对路径、UNC 路径以及用 `..` 上跳的目录一律拒绝。启动失败，绝不回退到用户配置目录。

无法解析的清单会被移到 `backup\portable.json.corrupt-<时间戳>`，随后写入默认清单，并把该事件记入 `logs\portable\portable.log`。把 `"portableMode"` 设为 `false` 可关闭便携模式；此后应用使用普通的按用户布局，也不从磁盘读取任何东西。

应用还会把运行过的根记入 `rootHistory`，保留最近五个。第 5 节依靠这份记录在盘符变化后找回过期路径。

## 3. 哪些内容会搬到磁盘上

存在清单时，启动会在 Electron 或 Harness 进程创建这些目录之前完成重定向。这里没有任何项目依赖盘符，换盘符无需修改。

| 数据 | 磁盘上的位置 |
| --- | --- |
| Harness 主目录（`DSH_HOME`） | `data\` |
| Electron `userData`、`sessionData` | `data\user-data\` |
| Electron 日志 | `logs\application\` |
| 崩溃转储 | `cache\electron\crash-dumps\` |
| Electron 与 Chromium 的 HTTP 缓存 | `cache\electron\http\` |
| 从桌面壳保存的文件 | `data\downloads\` |
| `TEMP`、`TMP` | `cache\temporary\` |
| npm 与 pnpm 的缓存与存储 | `cache\npm\`、`cache\pnpm-store\`（插件安装会继承） |
| Python、pip 与 uv 缓存 | `cache\python\` |

启动会读取磁盘剩余空间，剩余不足 512 MiB 时在 `logs\portable\portable.log` 中告警。磁盘写满往往在操作者还有机会腾空间之后才暴露，所以提前报告；该告警从不阻断启动。

便携模式同时停止那些 Windows 只允许写在用户配置里的写入：不注册文件关联、不注册默认协议、不设登录项、不为 `dsh` 命令写 `PATH`、不写卸载注册表项、不启用崩溃上报。卸载便携版就是删除文件夹。若要在宿主机使用该命令，请自行把磁盘上的 `runtime\cli\bin` 加入 `PATH`。

### 无法重定向的插件文件

通过插件市场安装的插件是受控的：插件管理器把它们的包解析在 `data\profiles\desktop\` 内，pnpm 读取 `npm_config_cache` 与 `pnpm_config_store_dir`，因此它们的下载、依赖、锁文件与 `node_modules` 目录树都留在磁盘上。

但自行拼路径的插件会写到那个路径所指向的地方。用 `os.homedir()` 拼上 `.dsh` 段的插件，拿到的是宿主机的用户配置目录，因为便携版改写的是 `DSH_HOME` 环境变量，而不是 `USERPROFILE`。于是 `%USERPROFILE%\.dsh\<插件状态>` 这类文件会在便携版从磁盘运行的同时出现在宿主机磁盘上。

重定向无法阻止这一点。`USERPROFILE`、`HOMEDRIVE` 与 `HOMEPATH` 由操作系统和便携版启动的每个进程读取，把它们指向磁盘会连带挪走无关的工具与程序；而通过 Windows API 而非环境变量解析配置目录的插件，本来也不会理会它们。因此便携版报告这一行为而不去掩盖它：查看插件自身的设置里是否有数据目录选项，或接受该文件留在用户配置目录。

## 4. 更新

便携更新器下载到 `updates\downloads\`，安装到 `updates\staging\`。安装更新时，应用会在退出前写出 `updates\apply.json`；随后一个帮手进程用暂存构建替换 `app\` 并重新启动。下一次启动会结清这笔事务：

- 运行中的版本与记录里的 `toVersion` 一致：上一版应用归档到 `backup\versions\version-<fromVersion>\`，只保留最新三份；
- 运行中的版本与 `fromVersion` 一致且 `app\` 缺失：从归档恢复上一版应用；
- 其它情况：记录留到下次启动，`logs\portable\` 说明原因。

更新永不重写 `portable.json`，也永不触碰 `data\`、`cache\`、`logs\` 或 `backup\`。

## 5. 迁移既有安装

当 `data\` 还没有 Harness 数据时，首次便携启动会复制一份既有的按用户安装：

1. `%USERPROFILE%\.dsh\` 变成 `data\`；
2. `%APPDATA%\DeepSeek Harness\` 变成 `data\user-data\`。

复制是追加式的：源保持原位，旧安装继续可用。每次复制前后都会测量文件数与字节数；不一致时把不完整的目标移到 `backup\migration\<时间戳>\`，以免下一次启动把半份拷贝当作用户数据。每次运行都把复制内容记入 `logs\portable\migration-<时间戳>.log` 与 `logs\portable\migration-<时间戳>.json`。`data\` 已有数据时跳过迁移；在首次启动前删除 `data\` 即可重新迁移。

### 迁移已记录的路径

换盘符会让已记录的路径过期：桌面 profile 的工作目录、以及每个记录该目录的会话头，仍带着旧盘符。启动会在任何组件读取它们之前先给 `data\` 做一次快照，然后改写这些记录：

1. `data\` 下的文本配置文件（`.json`、`.jsonc`、`.yaml`、`.yml`、`.toml`、`.ini`、`.cfg`、`.conf`、`.txt`，上限 2 MiB）中的每个旧根都替换为当前根；被改动的文件会先复制到 `backup\relocation\<时间戳>\`；
2. `data\profiles\<profile>\sessions\` 下的会话组会改名，使目录名与新工作目录一致，并改写每个会话文件里的头部行。会话事件不受影响：只有持有头部的第一个压缩帧会被重新压缩。目录名与其记录的工作目录不一致、或新名字已被占用的会话组会被跳过。

迁移记录写入 `logs\portable\relocation-<时间戳>.log`。这里没有任何工作依赖盘符本身，因此把文件夹搬到任何磁盘都会执行同样的处理。

## 6. 备份与恢复

`backup\snapshots\` 存放 Harness 主目录的整份副本。启动会在迁移已记录路径之前取一份快照，也可以随时创建或恢复：

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts list E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts create E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts restore E:\DSH latest
```

每份快照记录它包含的文件数与字节数。`restore` 在触碰磁盘之前先校验快照，把当前主目录移到 `backup\restore\<时间戳>\`，复制快照到位并再次校验；一旦不一致就把原来的主目录放回去。永远保留最新三份快照。`scripts/portable-backup.ts` 供工作区之外的 shell 使用同样的命令；第一个参数是便携根，第二个是子命令：

```sh
node --import tsx/esm apps/desktop/scripts/portable-backup.ts E:\DSH list
```

## 7. 安装到可移动磁盘

`scripts/portable-install.ts` 把组装好的载荷复制到磁盘上，并在写入任何东西之前检查目标：

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/portable-install.ts --payload dist/win-unpacked
```

不给 `--target` 时，包装脚本会列出 Windows 报告的卷，标注可移动、固定或网络，并建议 `<可移动卷>\DSH`。`--yes` 跳过询问直接接受建议；`--feed <url>` 会把更新源写进生成的清单。预检拒绝固定磁盘、已有文件的目标、位于载荷内部的目标，以及剩余空间不足"载荷大小加 512 MiB"的磁盘。清单最后才写，因此中断的复制会留下一个被下次启动报告为不完整的文件夹，而不是半装好的版本。

这里没有 MSI 或 NSIS 向导：两者都会写卸载项、安装位置与协议处理程序，而便携版绝不能写这些。

## 8. 构建便携版

先构建 Windows 载荷，再组装：

```sh
pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:dir
pnpm --filter @deepseek-ai/dsh-desktop run package:win:x64:portable
```

`package:win:x64:portable` 从目标的构建产物目录读取 `win-unpacked`，复制到 `app\`，写出默认 `portable.json`，创建空的 data 目录，并把结果打包为 `.desktop-build\targets\win-x64\portable\` 下的 `deepseek-harness-<version>-win-x64-portable.zip`。传 `--feed <url>` 可把更新源写进清单。

便携版还会把本指南、两份桌面 README 与 `apps/desktop/AGENTS.md` 放在根目录、`portable.json` 旁边。传 `--documents <path,...>` 可换成别的文件集合（相对仓库根解析），传空值则不随包。缺文件时组装直接失败，不会产出半份文档的包。

未签名的构建把载荷写到 `unsigned-artifacts\win-unpacked` 而非 `artifacts\win-unpacked`，因此要显式从该目录组装。`pnpm --filter ... exec` 在 `apps\desktop` 下运行，所以路径必须是绝对路径：

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-portable.ts --unpacked C:\path\to\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
```
