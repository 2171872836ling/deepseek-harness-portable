# 便携版使用手册

[English](desktop-portable-manual.md) | 中文

本手册写给拿到便携压缩包、准备直接使用的读者。内容包括：把便携版放到 U 盘、启动、查看它写在哪里、换机与换盘符、更新、备份，以及它做不到什么。这个功能的工程说明见 [便携版指南](desktop-portable.zh.md)。

## 1. 你拿到的内容

压缩包 `deepseek-harness-<version>-win-x64-portable.zip` 里只有一个文件夹。解压后大致是这样：

```
DeepSeek-Harness-<version>-portable\
  app\
    DeepSeek Harness.exe
    resources\
    ...
  data\
  cache\
  logs\
  updates\
  backup\
  portable.json
  README.md
  README.zh.md
  desktop-portable.md
  desktop-portable.zh.md
  desktop-portable-manual.md
  desktop-portable-manual.zh.md
  LICENSE
  NOTICE.md
  THIRD_PARTY_NOTICES.md
  AGENTS.md
```

程序本体是 `app\DeepSeek Harness.exe`。程序写出的所有内容都会落在 `data\`、`cache\`、`logs\`、`updates\`、`backup\` 这五个目录里，就在它旁边。`portable.json` 是告诉程序"我是便携版"的文件，它留在原位才让数据留在 U 盘上。

请把 `LICENSE`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md` 三个文件和程序放在一起。MIT 许可要求前两个文件随软件的任何副本一起分发。

## 2. 开始之前

你需要 x64 的 Windows、大约 4 GB 可用空间，以及对 U 盘的写权限。这个版本没有代码签名，所以第一次运行时 Windows SmartScreen 会提示"未知发布者"。

要启动程序：把压缩包解压到 U 盘，双击 `app\DeepSeek Harness.exe`。放在固定硬盘上的文件夹和放在 U 盘上的文件夹行为完全一样——便携行为来自 `portable.json`，而不是来自磁盘类型。

第一次启动会比之后慢，因为它要创建数据目录。在准备运行环境时可能会看到一个进度窗口。

### 如果 SmartScreen 拦住了启动

对于它没见过、又没有签名的可执行文件，Windows 会弹出"Windows 已保护你的电脑"。选择**更多信息**，再选择**仍要运行**。未签名构建出现这个提示是正常的：这个检查针对的是缺少签名，不是检测到了问题。

### 如果 U 盘处于写保护状态

当程序无法在自身旁边写入时，它会拒绝启动，因为退回用户目录就等于把数据放到了宿主机上。请在启动前解除写保护。

## 3. 第一次启动

第一次启动时，便携版会做三件事：

1. 创建 `data\`、`cache\`、`logs\`、`updates\`、`backup\` 及其子目录；
2. 如果 `%USERPROFILE%\.dsh\` 下有已有的 DeepSeek Harness 安装、且 `data\` 还是空的，就把它复制进 `data\`；如果 `%APPDATA%\DeepSeek Harness\` 下有已有的桌面配置，就复制进 `data\user-data\`；
3. 把当前 U 盘的根路径记入 `portable.json` 的 `rootHistory`。

第 2 步的复制不会删除原件，所以你原来装的那份还能继续用。复制了什么，记录在 `logs\portable\migration-<时间戳>.log`，同时有一份同名 `.json` 记录文件数与字节数。如果复制结果和记录的数量对不上，这份不完整的拷贝会被移到 `backup\migration\<时间戳>\`，而不是当作你的数据端出来，下次启动会重新尝试。

迁移只发生一次。一旦 `data\` 里有了数据，之后的启动不会再动它。

## 4. 开始第一次对话

启动程序后桌面外壳会打开。它问你要选一个工作目录时，便携版会建议 U 盘上的文件夹，你也可以选任何能访问到的文件夹，包括宿主机硬盘上的。

**工作目录在宿主机上就不算可移植。** 那个目录的会话仍然和别的会话一样存在 `data\` 里，但智能体读写的文件在宿主机上，那些文件不会跟着 U 盘走。想让整段对话都可移植，就用 U 盘上的文件夹。

API 凭据输入一次后会存在 `data\.credentials.yaml`，留在 U 盘上。请把 U 盘当作密码来对待：拿到它的人就拿到了你的凭据。除了操作系统本身提供的保护之外，没有额外加密。

## 5. 东西都在哪

| 想找什么 | 去哪看 |
| --- | --- |
| 会话及其历史 | `data\sessions\` 与 `data\profiles\<profile>\sessions\` |
| 设置、世界状态、定时任务 | `data\storages\` |
| 已安装的插件 | `data\profiles\desktop\node_modules\` |
| 插件操作历史 | `data\profiles\desktop\.plugin-manager\logs\` |
| 智能体交付给你的文件 | `data\downloads\` |
| 凭据 | `data\.credentials.yaml` |
| 应用日志 | `logs\application\` |
| 便携版诊断信息：清单修复、迁移、路径重写 | `logs\portable\` |
| 已下载的更新与暂存区 | `updates\downloads\`、`updates\staging\` |
| 可恢复的快照 | `backup\snapshots\` |
| 旧版本程序 | `backup\versions\` |

值得知道的大小：`cache\` 会因插件缓存和 Chromium 数据涨到几百兆，`data\` 随你的对话增长，`app\` 约 1 GB 且只在更新时变化。

U 盘剩余空间少于 512 MiB 时，程序会在 `logs\portable\portable.log` 里给出警告。盘装满之后会话和插件安装就会失败，所以用小容量盘时要留意那个日志。

## 6. 把 U 盘换到另一台电脑

停掉程序，拔出 U 盘，插到另一台机器上。启动方式不变：`app\DeepSeek Harness.exe`。

新电脑上不需要任何配置，因为电脑上什么都没存。唯一的例外是工作目录在旧电脑硬盘上的对话：那个文件夹在新机器上不存在，会话会报告找不到它。

## 7. 盘符变了怎么办

Windows 按机器、按插入顺序分配盘符，所以这次插上时是 `E:\` 的盘，下次可能是 `F:\`。便携版自己会处理。

启动时、在任何代码读取已存路径之前，便携版会拿当前盘根和 `portable.json` 里记录过的根比对。不一致时它会：

1. 把 `data\` 快照到 `backup\snapshots\`；
2. 改写 `data\` 下配置文件里记录的路径，改写前先把每个被改的文件复制到 `backup\relocation\<时间戳>\`；
3. 重命名会话文件夹，并改写每个会话头部记录的工作目录，让会话出现在当前盘符下。

处理过程记录在 `logs\portable\relocation-<时间戳>.log`。工作目录在宿主机硬盘上的会话不会被重命名：它们的路径里从来没有出现这个盘符。

如果重写过程被打断，已经改过的文件在 `backup\relocation\` 下，而 `backup\snapshots\` 里的快照保存着开始之前的状态。

## 8. 备份

便携版在 `backup\snapshots\` 保留最新三份快照。一份快照是 Harness 主目录的完整拷贝加上 `portable.json`，并记录了文件数与字节数，所以恢复前就能发现损坏的快照。

要创建、列出、恢复快照，你需要的是源码仓库而不是压缩包，因为快照工具随源码分发：

```sh
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts list E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts create E:\DSH
pnpm --filter @deepseek-ai/dsh-desktop exec tsx src/portable/snapshot-cli.ts restore E:\DSH latest
```

没有源码仓库时，在程序停止的状态下复制 `data\` 即可。快照本身就是这个，只是多了校验。

## 9. 更新

**未签名构建里自动更新是关闭的**，而这个压缩包是未签名的，所以程序不会自己提示更新。要换到新版本，下载新的压缩包，用新构建的 `app\` 文件夹替换 `app\`，同时保持 `portable.json`、`data\`、`cache\`、`logs\`、`updates\`、`backup\` 原样不动。清单、你的数据和插件都会保留，因为没有任何一样放在 `app\` 里。

替换 `app\` 之前先备份 `data\`，这样万一新构建用不了，也不会赔上你的会话。

本项目的签名构建走[便携版指南](desktop-portable.zh.md)第 4 节描述的更新流程：下载到 `updates\downloads\`，暂存到 `updates\staging\`，在程序退出后替换 `app\`，如果替换没完成，下次启动时回滚。

## 10. 插件限制

从市场安装的插件留在 U 盘上：它们的包、依赖、缓存和锁文件都落在 `data\` 或 `cache\` 下。

一个按操作系统路径自己拼路径的插件，可以把文件写到 U 盘之外。常见情形是插件调用 `os.homedir()` 再拼接 `.dsh`：它会写进宿主机的 `%USERPROFILE%\.dsh\`，因为便携版重定向的是 `DSH_HOME`，不是 `USERPROFILE`。便携版在文档里说明这件事而不是阻止它，因为重定向用户目录会连带挪走不相关的程序。

如果某个插件在你用户目录里留下了文件，去该插件自己的设置里找数据目录选项，或者把这些文件当作可移植承诺的一个小例外接受下来。

## 11. 卸载

停掉程序，删掉整个文件夹。没有卸载程序，也不会留下任何东西：便携版不写注册表、不建快捷方式、不注册文件关联、不改 `PATH`。

文件夹之外唯一的文件，是第三方插件按自己的路径写出的那些，见第 10 节。

## 12. 出问题时

**程序不启动，并提示 `portable.json` 有问题。** 清单读不出来，或者是由更新版本写的。损坏的清单会被移到 `backup\portable.json.corrupt-<时间戳>` 并换成默认值；当提示说清单来自更新的版本，说明压缩包比你正在运行的程序新，用匹配的构建即可。

**程序不启动，并提到卷外的目录。** `portable.json` 里某个目录是绝对路径、带盘符的相对路径、UNC 路径，或用 `..` 往上爬。把清单改成相对路径，或者删掉它让程序写一份默认的；无论哪种，`data\` 下的数据都不受影响。

**程序完全不启动，也没有提示。** 从终端用 `app\DeepSeek Harness.exe` 启动，好让控制台输出可见，然后看 `logs\portable\portable.log` 和 `logs\application\`。

**上一个盘符下的对话不见了。** 打开 `logs\portable\relocation-<时间戳>.log`。如果一个会话文件夹的名字和它记录的工作目录对不上，便携版会刻意跳过它；从 `backup\snapshots\` 恢复快照可以把之前的状态找回来。工作目录在宿主机硬盘上的会话不受盘符变化影响，也不需要重写。

**插件安装报权限或空间错误。** 先看剩余空间，再在 `logs\portable\portable.log` 里找低空间警告。盘装满之后，插件安装会在下载早就失败之后才失败。
