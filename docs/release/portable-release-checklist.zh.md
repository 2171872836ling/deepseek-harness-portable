# 便携版发布清单

[English](portable-release-checklist.md) | 中文

本清单覆盖从本 fork 发布 Windows 便携版的步骤。本仓库是 DeepSeek Harness 的非官方 fork，采用 MIT 许可：发布之前请先读 [NOTICE.md](../../NOTICE.md)。

## 构建之前

打包步骤用 pnpm 安装桌面运行时，而 pnpm 会在 `apps/desktop/.desktop-build/pnpm-store` 下创建 store 符号链接。创建符号链接需要提权终端，或者开启 Windows 开发人员模式。两者都没有时，打包会停在这里：

```text
pnpm: EPERM: operation not permitted, symlink ... -> .../pnpm-store/v11/projects/<hash>
```

前置条件：

- Node 不低于本仓库声明的版本（`engines.node`），因为 `scripts/build.ts` 只有在 `import.meta.main` 有定义时才运行 `main()`。
- `apps/desktop/.env.windows`，该文件被仓库忽略。以 `.env.windows.example` 为模板，把 `DSH_DESKTOP_APP_ID` 设成你自己拥有的标识。
- 一次构建需要的磁盘空间：`apps/desktop/.desktop-build` 约 5 GB，其中包含下载的 Electron、Node、pnpm 与 Python 载荷。
- 一个提权的 PowerShell 窗口，原因见上面的符号链接。

## 构建

```powershell
node scripts/build.ts --scope artifacts
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-target.ts win-x64 --unsigned --dir
node node_modules\pnpm\bin\pnpm.cjs --filter @deepseek-ai/dsh-desktop exec tsx scripts/package-portable.ts --unpacked C:\path\to\apps\desktop\.desktop-build\targets\win-x64\unsigned-artifacts\win-unpacked
```

第一条命令构建共享产物，第二条产出未签名的解包目录，第三条组装便携版。

`package-portable.ts` 在 `apps/desktop` 下运行，所以 `--unpacked` 必须是绝对路径。未签名构建写入 `unsigned-artifacts` 而不是 `artifacts`，并且不带 `app-update.yml`，因此这些构建里的自动更新路径处于关闭状态。

第三步在 `apps/desktop/.desktop-build/targets/win-x64/portable` 下产出两个产物：放进盘里的 `DeepSeek-Harness-<version>-portable\`，以及挂到 release 上的 `deepseek-harness-<version>-win-x64-portable.zip`。

组装会把使用指南、两个桌面 README、`AGENTS.md`、`LICENSE`、`NOTICE.md` 与 `THIRD_PARTY_NOTICES.md` 复制到便携根目录的 `portable.json` 旁边。任一文件缺失都会在写入清单之前中止组装，因此发布出去的归档一定带着它的许可证。

## 校验和

```powershell
$zip = 'apps\desktop\.desktop-build\targets\win-x64\portable\deepseek-harness-<version>-win-x64-portable.zip'
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"$hash  $(Split-Path $zip -Leaf)" | Set-Content 'apps\desktop\.desktop-build\targets\win-x64\portable\SHA256SUMS.txt' -Encoding utf8NoBOM
```

把 `SHA256SUMS.txt` 和归档一起发布，下载者才能校验。

## 发布说明

归档本身就是发布物，说明文字交代它装了什么。撰写说明时覆盖下面这些事实：

- 范围：DeepSeek Harness 的非官方 Windows 便携版，解压到可移动盘，从 `app\DeepSeek Harness.exe` 启动。它写入的一切都留在这块盘上。
- 迁移：把盘换到另一个盘符后，记录的路径会在下次启动时改写。
- 许可：MIT，归档内带 `LICENSE` 与 `NOTICE.md`。
- 签名：归档未签名，因此 SmartScreen 会提示未知发布者，自动更新也保持关闭。
- 限制：写入用户主目录的第三方插件不受本便携版控制。
- 完整性：用 `SHA256SUMS.txt` 校验归档。

## 发布

```powershell
gh release create v<version>-portable --title "DeepSeek Harness Portable <version>" --notes-file <notes>.md `
  apps\desktop\.desktop-build\targets\win-x64\portable\deepseek-harness-<version>-win-x64-portable.zip `
  apps\desktop\.desktop-build\targets\win-x64\portable\SHA256SUMS.txt
```

只发布归档与校验文件；不要挂中间构建目录（`unsigned-artifacts`、`dsh`、`electron`、`runtime`、`packed`、`package-set`）、`pnpm-store`、`packaging-runs`，也不要挂 `apps/desktop/.env.windows` 里的任何内容。它们带着本地路径或签名设置，不是分发产物。
