# Clash Verge Rev / Mihomo 内部机制笔记

> 本文档整理对本 fork(`infinite-illusion/clash-verge-rev` + 本地 `mihomo` fork)的源码追踪与讨论结论,作为长期参考。所有结论都附了源码位置,便于复核。
>
- 前端仓库:`clash-verge-rev`(Tauri + React)
- 内核仓库:`mihomo`(本地 `../mihomo`)
- 本 fork 默认分支:`custom`(放自定义改动);`main`/`dev` 是 upstream 镜像,不要直接提交。

---

## 1. 整体架构

```
clash-verge-rev (Tauri 桌面壳 + React 前端)
        │  通过 tauri-plugin-mihomo 调 HTTP/WS
        ▼
mihomo 内核(clash.meta,Go)── 负责代理/路由/DNS/TUN
```

- 前端用 `tauri-plugin-mihomo-api`(JS 封装)打 mihomo 的 RESTful API(`/proxies`、`/configs/geo`、`/group/:name/delay` 等)和 WebSocket(流量/日志)。
- mihomo 的启动参数 `-d <数据目录> -f <运行时配置>` 由 verge 的 service/sidecar 注入。

---

## 2. 配置体系(最容易混乱的部分)

### 2.1 数据目录里都有什么

prod:`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/`
dev :`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev.dev/`(verge-dev feature,可与 prod 共存)

| 文件 | 角色 | 谁写 |
|---|---|---|
| `profiles/<uid>.yaml` | **当前 profile**:订阅的原始配置(proxies/groups/rules) | 订阅更新 |
| `profiles/Merge.yaml` | **全局 Merge**(uid=`Merge`):声明式覆盖/替换 | 你编辑 |
| `profiles/Script.js` | **全局 Script**(uid=`Script`):JS 动态改 config | 你编辑 |
| `config.yaml`(很小,~643B) | verge 管的 **clash 基础字段**:port / dns / tun / external-controller / mode。**没有 proxies** | `Config::clash()` |
| `verge.yaml` | **verge 应用设置**(不是 clash 配置):UI / 布局 / 开关 | GUI |
| `dns_config.yaml` | dns 段覆盖 | verge |
| **`clash-verge.yaml`(~38KB)** | **🎯 合并后的完整运行时配置,就是 mihomo 实际读的** | `enhance()` |
| `clash-verge-check.yaml` | 应用前的校验副本(内容同上,先验证再落盘) | `enhance()` |
| `cordcloud.yaml` 等 | 订阅原始缓存 | 订阅更新 |

**铁证**:`config.yaml` 只有 port/tun/dns 那些、没有 `proxies:`;而代理在跑 → mihomo 读的只能是带 `proxies:` 的 `clash-verge.yaml`。

### 2.2 enhance 合并管线(`src-tauri/src/enhance/mod.rs:685`)

```
profile 原始配置
 → ① process_seq_items        prepend/append-rules 等顺序项(最先)
 → ② merge_default_config     config.yaml 基础字段(端口/dns/tun)
 → ③ apply_builtin_scripts    内置脚本(app 生成)
 → ④ use_tun / apply_dns_settings
 → ⑤ snapshot_control_plane   锁定"控制面"(端口/external-controller 等 app 权威字段)
 → ⑥ 全局 Merge → 全局 Script   手动覆盖开始
 → ⑦ Profile Merge → Profile Script
 → ⑧ enforce_control_plane    强制恢复控制面字段(手动改端口会被盖回去)
 → ⑨ enforce_dns_ipv6 / ensure_lan_bind_address
 → ⑩ cleanup_proxy_groups / use_sort
 → 落盘 clash-verge.yaml → mihomo
```

### 2.3 Merge vs Script

| | Merge(`use_merge`,`enhance/merge.rs`) | Script(`use_script`,`enhance/script.rs`) |
|---|---|---|
| 形式 | 声明式 YAML | JS 函数 |
| 数组语义 | **对象递归合并;数组整组替换**(`deep_merge` line 17) | 任意逻辑(可 `[...old, ...new]` 真合并) |
| 追加方式 | `prepend-rules`/`append-rules`/`prepend-proxies`/`append-proxies`/`prepend-proxy-groups`/`append-proxy-groups`(mihomo 原生键,verge 透传) | 自己 push |
| 入参 | —— | `function main(config, name)`,`config` 是已 merge 的小写键对象,`name` 是 profile 名 |
| 返回 | —— | **必须 `return` 一个对象**,否则报错 `main function should return object` |
| 引擎 | —— | boa(JS 沙箱,无 fetch/IO;`console.log` → enhance 日志) |

**数组替换的坑**:在 Merge 里写直接的 `proxy-groups:` / `rules:`,会把订阅的整组覆盖掉(不是合并)。要保留订阅内容再叠加,用 `prepend-*`/`append-*`,或改用 Script。

### 2.4 手动覆盖优先级(后覆盖前)

```
全局 Merge → 全局 Script → Profile Merge → Profile Script
```

优先级:**Profile Script > Profile Merge > Global Script > Global Merge**。
同层内永远是 **Merge 先、Script 后**——Script 拿到的是 Merge 已经改过的 config,能进一步覆盖 Merge。

> 源码有测试 `manual_overrides_follow_expected_priority`(`mod.rs:790`)锁定该顺序。

### 2.5 控制面字段锁定

端口、`external-controller`、`secret` 等"app 权威字段"在 ⑤ 快照、⑧ 强制恢复,**Merge/Script 改不动**。要改这些只能从 verge GUI。

---

## 3. mihomo 内核机制

### 3.1 URLTest 组:健康检查 + 选节点

**健康检查**(测所有节点,`mihomo/adapter/provider/healthcheck.go`):
- 由 provider 的 `HealthCheck` 持有,每个 `interval` 触发一轮 `check()`。
- `execute()` 遍历组内**全部节点**,errgroup 并发(上限 **10**,写死),每节点 `p.URLTest(ctx,url,expectedStatus)`,单节点超时默认 **5000ms**(`NewHealthCheck` 里 `timeout==0 → 5000`)。
- `process()` 是串行循环:`time.NewTicker(interval)` + 阻塞的 `check()`。**整轮耗时 > interval 时,节奏由耗时决定**(滴答被丢弃)。
- DEBUG 日志:`Start/Finish New Health Checking {uuid}`、每节点 `Health Checked, proxy: …, alive: …, delay: … ms`。

**选节点**(`mihomo/adapter/outboundgroup/urltest.go:107 fast()`):
- **惰性**:只在 dial / `Now()` / `/proxies` 序列化时评估,**不是定时器触发**。`Now()` = `fast(false).Name()`。
- 读 `LastDelayForTestUrl(testUrl)`/`AliveForTestUrl`,挑延迟最小的存活节点。
- **`tolerance`**(默认 0):当前节点延迟 > 最优 + tolerance 才切换。0 = 严格最快。
- **`fast()` 里一条日志都没有**——切换本身不打印。

### 3.2 `lazy` 模式(本 fork 默认 **true**)

- upstream 默认 false,**本 fork 改成 true**:`mihomo/adapter/outboundgroup/parser.go:52  Lazy: true`。
- `lazy:true` 时,一个 interval 内没走过流量的组会**跳过本轮健康检查**(`healthcheck.go:52-56`,日志 `Skip once health check because we are lazy`)。
- 后果:空闲组 history 不刷新 → 前端拿到的延迟也是旧的。这是**后端侧的陈旧来源**,前端修复治不了它。
- 要持续刷新,把组设 `lazy: false`(代价:每 interval 全量测,即便空闲)。

### 3.3 延迟数据:`history` 数组

- 类型 `DelayHistory{Time, Delay}`(`constant/adapters.go:150`)。`Delay=0` 表示失败/超时。
- 存在 `queue.Queue` 里(`common/queue/queue.go`),**上限 10**(`defaultHistoriesNum`,`adapter/adapter.go:26`),FIFO,写第 11 条弹最老的——**不会无限膨胀**。
- 每节点有**两份**:
  - `p.history`(通用,任意测试 URL)→ `/proxies` 顶层 `"history"` 字段(**前端读的这个**)。
  - `p.extra[url].history`(按测试 URL 分桶)→ `fast()` 选节点读这个。
- 唯一写入点 `Proxy.URLTest` 的 defer(`adapter/adapter.go:166-200`):定时检查和手动 `/delay` 共用同一函数,所以 `/proxies` 返回的 history **总是最新的**。
- `queue.New(hint)` 的 hint 只是预分配,**不会自动裁剪**;有界完全靠 `Len()>10 → Pop()`。

### 3.4 interval 与实际刷新节奏

- 整轮耗时 ≈ `ceil(节点数/10) × 单节点耗时`(慢/死节点卡到 5s 超时)。
- 前端每 **3s** 轮询,所以观察到的刷新 = 后端节奏 + 0~3s。
- 想确认:看 DEBUG 日志同一轮 `Start`→`Finish` 的差(=整轮耗时)。

### 3.5 节点类型:`proxy.provider`

- 前端在 `calcuProxies`(`src/services/cmds.ts`)里,用 `/providers/proxies` 建 `providerMap`,给来自 `proxy-providers` 的节点打上 `{provider: 名}`。
- 内联节点(写在 `proxies:` 里)→ `proxy.provider === undefined`。
- 影响 `getDelayFix`:provider 节点始终读 history;内联节点走"缓存 vs history 新旧裁决"。

### 3.6 GeoData

- GeoIP(IP→国)/ GeoSite(域名→分类)/ ASN(IP→运营商),支撑 `GEOIP`/`GEOSITE`/`IP-ASN` 规则。
- 默认源都来自 `MetaCubeX/meta-rules-dat`(`config/config.go:571-575`):`geoip.metadb`、`GeoLite2-ASN.mmdb`、`geoip.dat`、`geosite.dat`。
- 上游原始(可读):GeoSite 域名表 = `v2fly/domain-list-community` 的 `data/`;GeoIP CIDR = `Loyalsoldier/geoip` 的 txt / APNIC 委派表;ASN = iptoasn.com TSV / MaxMind。
- 换源:配置 `geox-url`(mmdb-url/geoip-url/geosite-url/asn-url)。

---

## 4. 前端代理页机制

### 4.1 轮询与延迟数据来源

- **3s 轮询**:`src/components/proxy/proxy-groups.tsx` 的 `useQuery({refetchInterval:3000})` → `calcuProxies` → `getProxies()`(mihomo `/proxies`)。
- `delayManager`(`src/services/delay.ts`):内存缓存 `Map<"${group}::${name}", {delay, elapsed, updatedAt}>`,**TTL 30min**,**只由手动测速写入**(`checkDelay`/`checkListDelay` → `setDelay`)。**轮询不写它**。
- 徽标取值:`useProxyDelayState` hook(`src/hooks/use-proxy-delay-state.ts`)→ `updateDelay()` → `delayManager.getDelayFix()`。

### 4.2 延迟不刷新的根因与本 fork 的修复(commit `398d2c78`)

**根因**:`updateDelay` 原本第一行 `if (cachedUpdate) { 用缓存; return }` 短路——一旦 30min 内手动测过速,缓存命中,轮询带回的新鲜 `proxy.history` 被无视。结果:`now`(选中节点,读 `group.now`)照常更新,徽标却钉在旧值。

**修复**(两处):
- `getDelayFix`(`src/services/delay.ts`):改成**按新鲜度裁决**——非 provider 节点的手动缓存只在比 `history` 最新一条更新时才采用;后端 health-check 写入更新的 history 后,history 胜出。
- `updateDelay`:去掉短路,统一交给 `getDelayFix`,`updatedAt` 取较新来源。
- provider 节点行为不变(始终读 history)。

效果:URLTest 切换/health-check 后,徽标和排序在下一轮询(≤3s)跟进;手动测速值保留约一个 interval 后让位给实测。

> 注意:此前提是**后端真在刷新 history**;`lazy:true` 的空闲组仍会陈旧(见 3.2)。

### 4.3 节点延迟趋势 sparkline + tooltip(commit `18ebe07b`)

- 新组件 `src/components/proxy/proxy-sparkline.tsx`:memoized 内联 SVG,读 `proxy.history`(≤10 点)。成功点按自身 [min,max] 自适应缩放,失败点(delay=0)画成**顶部尖刺**,整条线取最新点的颜色。
- 颜色助手 `src/components/proxy/proxy-sparkline-utils.ts` 的 `resolveDelayColor`(镜像 `delayManager.formatDelayColor` 阈值)。
- hover 弹 Tooltip 显示该节点 history 明细(时间→延迟,最新在上)。
- **故意不用** canvas 版 `TrafficGraph`:它每实例独占 canvas context + 1s 定时器 + ResizeObserver,铺 100+ 节点太重。SVG 每 3s 跟轮询重绘,memo 比对延迟序列,未变跳过。
- 接入:`proxy-item.tsx`(列表行,52×16)、`proxy-item-mini.tsx`(迷你格,32×10)。

---

## 5. 几个设置项

| 设置(内部名) | 作用 |
|---|---|
| **Auto Delay Detection**(`enable_auto_delay_detection`) | 前端(`current-proxy-card.tsx`)后台定时(默认 5min)测**当前在用节点**的延迟,绕过 lazy。只覆盖当前节点,不是全组。 |
| **Show Outbound Modes Inline**(`tray_inline_outbound_modes`) | 托盘菜单排版:开=Rule/Global/Direct 摊到顶层;关=折进 "Outbound Modes" 子菜单。 |
| **Update GeoData**(`updateGeo`) | 触发 mihomo `POST /configs/geo` → `UpdateGeoDatabases`:按 `geox-url` 重新下 GeoIP/GeoSite/ASN,hash 不变跳过,校验后**热重载**(不重启)。有并发锁。另有 `geo-auto-update`+`geo-update-interval` 可自动更新。 |

---

## 6. 我当前的配置现状(自用参考)

- 订阅:cordcloud,**118 个内联 trojan 节点**,**没有 proxy-providers**。
- 全局 `Merge.yaml`:**直接键替换**(非 prepend):
  - 14 个自定义 group:选择代理 / Anthropic / DeekSeek / Zed / Openai / Speedtest / 默认 / HK 香港 / TW 台湾 / SG 新加坡 / JP 日本 / US 美国 / 自动选择 / 手动选择。地区组 + 自动选择是 `url-test`,`interval=120`、`lazy=true`、tolerance 默认 0。
  - 63 条自定义 rules:按服务分流(deepseek/zed/openai/netflix/disney/spotify…,用了 `GEOSITE,*`)+ `GEOIP,LAN,DIRECT` + `GEOIP,CN,DIRECT` + `MATCH,默认`。
- **因为 Merge 直接键替换,订阅自带的 11 个 group 和 ~3500 条 rules 没生效**;真正在跑的是我那 14 group + 63 rules。订阅那套(应用净化/全球拦截/国外媒体…)**不可见**——这是有意为之。
- 所有节点内联 → `proxy.provider` 全 undefined → 全走 `getDelayFix` 新旧裁决路径(4.2 的修复对全部节点生效)。
- `lazy:true` + `interval=120`:实际在用/切换时延迟会刷新;纯空闲浏览页面时不刷新。

> 想叠加保留订阅内容:把直接键改成 `prepend-proxy-groups`/`prepend-rules`;但那会把订阅那堆 group 带回来,与本意冲突,所以现状(全自配)更合适。

---

## 7. 开发与验证

### 命令
- 类型检查:`pnpm typecheck`(`tsc --noEmit`)
- Lint:`pnpm lint`(`eslint --max-warnings=0`);单文件 `pnpm exec eslint -c eslint.config.ts --max-warnings=0 <files>`
- 格式:`pnpm exec biome format --write <files>`
- 构建:`pnpm web:build`(`tsc --noEmit && vite build`)
- pre-commit hook:`cargo make pre-commit` → lint-staged(eslint --fix + biome format),提交时自动跑。

### 提交约定(见 `AGENTS.md`)
- 只在 `custom` 分支做产品/功能/配置改动;`main`/`dev` 保持 upstream 镜像。
- Git 作者用仓库本地身份 `infinite-illusion`;不要换全局身份。
- GitHub 操作用 bare `gh`(本机多账号会按 `gh.account` 选 `infinite-illusion`);不要 `gh auth switch`。
- 提交/推送只在用户要求时做。

### 怎么观察内核行为
- 开 mihomo debug(`log-level: debug`)→ Verge 日志页能看到 `Start/Finish New Health Checking`、每节点 `Health Checked … delay`、`Skip once health check because we are lazy`。
- 切换节点无日志(看 `/proxies` 的 `now` 或前端高亮)。
- 看 mihomo 实际配置:直接打开数据目录的 `clash-verge.yaml`。

### 本次会话产生的提交
- `398d2c78` fix(proxy): 延迟徽标按新鲜度刷新(修切换不刷新)
- `18ebe07b` feat(proxies): 节点延迟趋势 sparkline + history tooltip

---

## 8. 速查:关键文件

**前端(clash-verge-rev)**
- `src/services/delay.ts` — `delayManager`(缓存、`getDelayFix`、`formatDelay/Color`)
- `src/hooks/use-proxy-delay-state.ts` — 节点徽标 hook(`updateDelay`)
- `src/components/proxy/proxy-item.tsx` / `proxy-item-mini.tsx` — 节点项两个视图
- `src/components/proxy/proxy-sparkline.tsx` / `-utils.ts` — 趋势图(本 fork 新增)
- `src/components/proxy/use-render-list.ts` — 代理列表渲染/缓存(含 `now` 变化检测点)
- `src/components/proxy/proxy-groups.tsx` — 3s 轮询入口
- `src/services/cmds.ts` — `calcuProxies`(组装 `provider` 标记)
- `src-tauri/src/enhance/{mod,merge,script}.rs` — 配置合并管线
- `src-tauri/src/config/{verge,clash}.rs` — verge/clash 配置定义
- `src-tauri/src/core/tray/mod.rs` — 托盘菜单
- `src-tauri/src/utils/dirs.rs` — 各文件路径常量

**内核(mihomo)**
- `adapter/outboundgroup/{urltest,parser}.go` — URLTest 选择 / lazy 默认值
- `adapter/provider/healthcheck.go` — 健康检查(全节点、并发 10、DEBUG 日志)
- `adapter/adapter.go` — `Proxy.URLTest`(history 写入)、`defaultHistoriesNum=10`
- `component/updater/update_geo.go` — GeoData 更新
- `component/geodata/init.go` — geo URL getter
- `config/config.go` — 默认 `geox-url`
- `hub/route/{configs,upgrade}.go` — `/configs/geo`、`/upgrade/geo` 路由
