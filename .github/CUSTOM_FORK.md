# 定制仓库维护手册

本文记录分支同步、构建发布、Updater、签名密钥和本地 GitHub 操作约定。

## 仓库与分支

- 上游仓库：`https://github.com/clash-verge-rev/clash-verge-rev`
- 当前仓库：`https://github.com/infinite-illusion/clash-verge-rev`
- `main`：严格镜像 `upstream/main`，不直接开发。
- `dev`：严格镜像 `upstream/dev`，不直接开发。
- `custom`：默认分支，以稳定版 `main` 为基线，承载定制修改和发布配置。

## 上游同步与发布

`.github/workflows/custom-sync.yml` 每六小时运行一次，也可以手动触发：

```bash
./scripts/gh-custom workflow run custom-sync.yml --ref custom
```

同步任务会：

1. 强制镜像 `upstream/main` 到 `origin/main`。
2. 强制镜像 `upstream/dev` 到 `origin/dev`。
3. 把 `upstream/main` 合入 `custom`。
4. 在稳定基线执行 lint、TypeScript 和 Rust 检查。
5. 将定制差异临时应用到最新 `upstream/dev`，执行兼容性检查。
6. 失败时创建或更新仓库 Issue，恢复后自动关闭。
7. 检测到上游稳定 tag 后，在 `custom` 上创建同名 tag 并启动 Release。

应用版本和 tag 始终与上游一致，不增加额外版本后缀。

## 构建范围

Release 只构建：

- macOS ARM64：`aarch64-apple-darwin`
- Windows x64：`x86_64-pc-windows-msvc`
- Windows x64 固定 WebView2 安装包

不构建 Windows ARM64/x86、macOS Intel 或 Linux。早期 `v2.5.1` Release
中已经上传的其他平台附件仅作为历史文件保留，不会通过 Updater 下发；后续 Release
也不会再生成这些附件。

## Tauri Updater 签名密钥

- 私钥：`~/.tauri/infinite-illusion-clash-verge-rev.key`
- 公钥备份：`~/.tauri/infinite-illusion-clash-verge-rev.key.pub`
- GitHub Actions Secret：`TAURI_PRIVATE_KEY`
- 仓库只提交公钥。私钥不能提交、粘贴到 Issue 或写入日志。

检查本地文件和权限：

```bash
ls -l ~/.tauri/infinite-illusion-clash-verge-rev.key{,.pub}
```

重新设置 Actions Secret：

```bash
./scripts/gh-custom secret set TAURI_PRIVATE_KEY \
  < ~/.tauri/infinite-illusion-clash-verge-rev.key
```

私钥需要额外保存一份加密的离线备份。私钥丢失后，新构建无法继续为已安装版本提供可验证更新；
生成新密钥不能让旧客户端自动信任它。

macOS 使用 ad-hoc 签名（`signingIdentity: "-"`），没有 Apple 公证。首次打开时可能出现
Gatekeeper 提示。

## Updater

应用通过 `@tauri-apps/plugin-updater` 的 `check()` 检查更新。端点和公钥编译在
`src-tauri/tauri.conf.json` 中。所有端点都读取当前仓库的 Updater 清单，其中前两个是代理
回退地址，最后一个是 GitHub 直连地址。

上游仓库发布新版本后，必须先完成同步、构建并在当前仓库发布，客户端才能检测到更新。

清单生成流程：

1. `release.yml` 构建签名后的安装包，并在版本 Release 中生成 `latest.json`。
2. `scripts/updater.mjs` 读取最新稳定 Release 的 `latest.json`。
3. 只保留 `darwin-aarch64` 和 `windows-x86_64`，同时验证下载 URL 和签名。
4. 将结果作为 `update.json` 和 `update-proxy.json` 上传到固定的 `updater` Release，
   每次发布替换旧文件。
5. `scripts/updater-fixed-webview2.mjs` 生成固定 WebView2 版本的对应清单。

GitHub Release 附件 URL 的形式为：

```text
https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
```

当前 Updater 清单地址：

```text
https://github.com/infinite-illusion/clash-verge-rev/releases/download/updater/update.json
```

其中 `updater` 是固定 tag，`update.json` 是该 Release 中由脚本生成并上传的附件。

需要在不重新构建安装包的情况下刷新清单时，运行：

```bash
./scripts/gh-custom workflow run refresh-updater.yml --ref custom
```

## 本地 GitHub 操作

`gh auth switch` 会修改整个 `github.com` 主机的 active account，不适合作为仓库级配置。
本仓库的 `gh` 操作统一从仓库根目录通过包装脚本执行：

```bash
./scripts/gh-custom auth status
./scripts/gh-custom repo view
./scripts/gh-custom run list --limit 5
```

包装脚本显式使用当前仓库的维护凭据和仓库地址，不修改全局 `gh` active account。

Git 远程配置：

- `origin` fetch URL 使用当前仓库的标准 HTTPS 地址。
- `origin` push URL 使用 `git@github.com.ii:infinite-illusion/clash-verge-rev.git`，
  由对应的 SSH 配置选择写入身份。

Git 作者信息使用仓库级配置，不依赖全局 Git 身份：

```bash
git config --local user.name
git config --local user.email
```

用户名应为 `infinite-illusion`；邮箱可以使用 GitHub noreply 地址或该身份维护的邮箱。
