# `infinite-illusion` 定制分支维护手册

这个 fork 用于个人定制构建。仓库地址是
`https://github.com/infinite-illusion/clash-verge-rev`，上游是
`https://github.com/clash-verge-rev/clash-verge-rev`。

## 分支拓扑

- `main` 严格镜像 `upstream/main`，不在上面开发。
- `dev` 严格镜像 `upstream/dev`，不在上面开发。
- `custom` 是默认分支。它以稳定版 `main` 为基线，保留个人功能和发布基础设施。

个人需求“网站测试结果显示实际代理链”已经作为独立提交
`0828b70b feat: show proxy chain in website tests` 移植到 `custom`。原需求分支基于
`dev`，不能直接 merge，否则会把整段开发版历史带进稳定构建。

## 上游同步与同版本发布

`.github/workflows/custom-sync.yml` 每六小时运行一次，也可以手动触发：

```bash
./scripts/gh-custom workflow run custom-sync.yml --ref custom
```

同步任务会：

1. 强制镜像 `upstream/main` 到 `origin/main`。
2. 强制镜像 `upstream/dev` 到 `origin/dev`。
3. 把 `upstream/main` 合入 `custom`。
4. 在稳定基线验证 lint、TypeScript 和 Rust。
5. 把定制代码临时应用到最新 `upstream/dev`，提前检查兼容性。
6. 失败时创建或更新仓库 Issue，恢复后自动关闭。
7. 上游发布稳定 tag 后，在 `custom` 上创建同名 tag 并启动个人 Release。

应用版本和 tag 始终与上游相同，不增加 `custom` 后缀或独立版本号。

## 构建范围

个人 Release 只构建：

- macOS ARM64：`aarch64-apple-darwin`
- Windows x64：`x86_64-pc-windows-msvc`
- Windows x64 固定 WebView2 安装包

不构建 Windows ARM64/x86、macOS Intel 或任何 Linux 包。早期 `v2.5.1`
Release 中已经上传的其他平台附件属于历史产物；Updater 不会向这些平台下发更新，后续
Release 也不会再生成它们。

## Tauri Updater 私钥

这是最重要的本地恢复信息：

- 私钥：`~/.tauri/infinite-illusion-clash-verge-rev.key`
- 公钥备份：`~/.tauri/infinite-illusion-clash-verge-rev.key.pub`
- GitHub Actions Secret：`TAURI_PRIVATE_KEY`
- 仓库只提交公钥，私钥绝对不能提交、粘贴到 Issue、日志或聊天中。

私钥文件当前应为仅本人可读写权限。检查命令：

```bash
ls -l ~/.tauri/infinite-illusion-clash-verge-rev.key{,.pub}
```

如果需要重新设置 Actions Secret，从仓库根目录执行：

```bash
./scripts/gh-custom secret set TAURI_PRIVATE_KEY \
  < ~/.tauri/infinite-illusion-clash-verge-rev.key
```

务必再保存一份加密的离线备份。私钥丢失后，新构建无法继续为已经安装的定制版本提供可验证更新；
生成新密钥不能让旧客户端自动信任它。

macOS 使用 ad-hoc 签名（`signingIdentity: "-"`），不使用或暴露个人 Apple
Developer 身份。这不等同于 Apple 公证，首次打开时仍可能遇到 Gatekeeper 提示。

## Updater 工作方式

应用调用 `@tauri-apps/plugin-updater` 的 `check()`。端点和公钥编译在
`src-tauri/tauri.conf.json` 中，当前端点依次是：

1. 小号仓库 `update-proxy.json` 的加速地址。
2. 同一个小号仓库清单的备用代理地址。
3. 小号仓库的直接 `update.json` 地址。

因此，这个定制包只读取 `infinite-illusion/clash-verge-rev` 发布的更新清单。上游仓库发布
新版本本身不会直接触发客户端更新；必须先由 `custom-sync.yml` 同步、打包并在小号仓库发布。

生成链路如下：

1. `release.yml` 构建签名后的安装包，并在版本 Release 中生成 `latest.json`。
2. `scripts/updater.mjs` 读取最新稳定 Release 的 `latest.json`。
3. 脚本只保留 `darwin-aarch64` 和 `windows-x86_64`，并检查 URL 必须属于小号仓库、
   签名不能为空。
4. 脚本把结果作为 `update.json` 和 `update-proxy.json` 上传到固定的 `updater`
   Release，每次发布都会替换旧文件。
5. 固定 WebView2 版本由 `scripts/updater-fixed-webview2.mjs` 生成对应的两个清单。

GitHub Release 附件的固定 URL 形式是：

```text
https://github.com/<owner>/<repo>/releases/download/<tag>/<asset>
```

所以：

```text
https://github.com/infinite-illusion/clash-verge-rev/releases/download/updater/update.json
```

表示仓库 `infinite-illusion/clash-verge-rev`、tag `updater` 对应 Release 中名为
`update.json` 的附件。这个 URL 由 GitHub 的 Release 附件规则形成；文件内容由本仓库的
Updater 脚本生成并上传。

需要在不重打安装包的情况下修复清单时，运行：

```bash
./scripts/gh-custom workflow run refresh-updater.yml --ref custom
```

## GitHub 多账号隔离

`gh auth switch` 对整个 `github.com` 主机全局生效，不是仓库级设置。全局 active 账号应保留为
日常使用的主账号，不要为了这个仓库长期切换到小号。

本仓库的隔离分为两部分：

- `git fetch`：`origin` 使用小号仓库的标准 HTTPS URL，便于工具正确识别仓库。
- `git push`：`origin` 的 push URL 单独使用 SSH alias
  `git@github.com.ii:infinite-illusion/clash-verge-rev.git`，强制使用小号 SSH key，
  与全局 `gh` active 账号无关。
- `gh` 命令：从仓库根目录使用 `./scripts/gh-custom ...`。脚本显式读取
  `infinite-illusion` 的凭据，并把默认仓库固定为
  `infinite-illusion/clash-verge-rev`，不会改变全局 active 账号。

例如：

```bash
./scripts/gh-custom auth status
./scripts/gh-custom repo view
./scripts/gh-custom run list --limit 5
```

普通的裸 `gh ...` 命令仍使用全局大号；涉及这个 fork 的写操作必须使用包装脚本。

仓库级 Git 作者必须是 `infinite-illusion`。可以使用 GitHub noreply 邮箱，也可以使用
`infinite-illusion` 自己的邮箱；真正需要避免的是大号用户名、邮箱、签名身份或 token
出现在这个 fork 的提交和发布操作里。
