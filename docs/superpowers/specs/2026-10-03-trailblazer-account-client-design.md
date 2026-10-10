# StoryFabric 的 Trailblazer 账号客户端

日期：2026-10-03。状态：待书面方案审阅；依赖中心 OIDC 和 Sub2API StoryFabric 资源服务。

## 用户行为

`/user` 从占位页改为账户中心。未登录显示「登录你的 Trailblazer 账号」和注册入口；均打开中心授权页，密码和邮箱验证在中心完成。成功返回后显示账号概要、余额、云端用量、渠道/分组、兑换入口和托管连接状态。

用户可以选择后端列出的分组、兑换额度、重置或更换托管连接。API Key 没有显示/复制/输入框；只显示连接状态和更换时间。管理员操作位于中心网站，应用内不实现管理员页面或入口。当前没有充值和云项目同步功能。

数据加载失败时显示对应服务错误和重试，不能伪装成零额度或登录成功。未配置服务或平台能力尚不可用时禁用相关入口，并说明该能力不可用。

## 公开 API 与文件边界

新增 `src/shared/cloudAccount.ts`：公开账户 DTO、登录状态、能力、分页用量/分组和操作输入；新增 `CloudAccountApi` 方法：读取状态、开始/取消登录、退出、账户摘要、用量、渠道、兑换及历史、选择分组、轮换托管连接。

`StoryFabricApi` 加入该独立能力入口，各平台实现自己的 adapter。IPC 和 HTTP RPC 使用具体 allowlist 方法，不接受任意 URL、header 或请求代理。renderer 只接收公开 DTO 和登录进度，不接收 access/refresh token、code、client secret 或 API Key。

| 位置 | 工作 |
| --- | --- |
| `src/shared/api.ts`、`src/shared/ipc.ts` | 新账号能力和明确 IPC channel |
| `src/preload/index.ts`、`src/main/ipc.ts` | 固定方法桥接、输入验证和公开 DTO |
| `src/main/services/cloudAccountService.ts` | 桌面登录状态机、浏览器回调、token 生命周期、业务 API |
| `src/main/services/cloudCredentialStore.ts` | 独立安全凭据文件，不复用普通供应商的明文降级 |
| `src/renderer/src/pages/user/UserPage.tsx` | 用户账户中心；保留记忆页跳转回归 |
| `src/renderer/src/platform/platformApi.ts`、`httpApi.ts`、`androidApi.ts` | 各平台账号 adapter，不与部署门禁混淆 |
| `src/server/cloudAccountSessions.ts` | 按部署 session 保存服务器端云授权与 OAuth 事务 |
| `android/app/src/main/java/com/storyfabric/app/TrailblazerAccountPlugin.java`、`MainActivity.java` | 按现有 Java plugin 模式实现并注册原生账号/模型 transport |
| `src/core/llm/types.ts`、`src/core/llm/index.ts` | 供应商认证类型与调用时凭据解析 |
| `src/core/agent/agentLoop.ts`、`src/main/agent/agentLoop.ts` | 所有模型阶段使用统一认证抽象 |

账号、协议与托管模型模块分别可测试；不把 OAuth 状态机放到页面组件或原 settings 服务。

## Desktop 登录与存储

主进程在固定受信任 issuer 上发现端点并生成 state/nonce/PKCE S256。HTTP listener 只绑定 `127.0.0.1:0`，回调路径固定 `/oauth/callback`，只消费一次，10 分钟到期。启动 listener 后才打开系统浏览器，使用实际已绑定端口。校验授权响应 state、provider error 和事务代际；携同一 redirect URI 和 verifier 换 code。

用成熟 OIDC 客户端校验 issuer、ID Token aud/nonce/签名/expiry；不得只 decode JWT。2026-10-03 npm 元数据查询为 `openid-client 6.8.8`，确切版本锁定并在 Electron 主进程验证 ESM/运行时兼容；renderer 不加载此协议库。

登录状态机为 `signed-out -> authorizing -> provisioning -> signed-in`；取消、拒绝、超时或错误回到可重试状态。并发事务只保留最新一个，listener 在成功/取消/失败后关闭，过期回调不能覆盖新账号。

refresh token 使用 OS safeStorage 单独加密，不写 PublicAppSettings、工作区、项目导出、localStorage 或日志。当操作系统安全存储不可用或使用不安全后端时，只保留内存会话，重启后重新登录，不降级明文。解密失败清理失效凭证并提示重新登录。

中心 opaque access token 最长 5 分钟，在主进程内存保存。每次实际业务调用前解析该账号的有效凭证，刷新采用单飞及代际校验；refresh replay/invalid_grant 退出当前授权。退出或换账号使旧代际响应无效，避免迟到刷新重新登录旧账号。

## 托管模型认证

供应商认证类型明确区分 `custom-key` 与 `trailblazer-session`。托管供应商配置只有非敏感 provider ID、协议、服务标识和模型偏好，不保存伪 API Key 或 token。

平台层提供可取消的调用时凭据解析器：普通供应商仍解析本地自填 key；托管供应商取得当前运行账号的短期 resource token，并仅发送到可信配置的 Sub2API 专用 gateway URL。禁止通过设置覆盖托管 host/path。底层适配器显式接收认证类型，不能把 OAuth token 写成 apiKeyEncrypted。

真实模型链路为：StoryFabric 平台账号服务 -> Sub2API scoped gateway -> 服务端管理 key -> 原网关计费/模型处理。Sub2API key 从不经过应用。

每个 run 记录不含 secret 的 central subject、账号代际与 configuration_version。每个托管请求携带该配置版本，Sub2API 发现变化时返回 `connection_changed` 并中止后续阶段，提示重新开始；不能在多步运行中静默切为新组或新密钥。连续模型请求解析该固定账号的可用 token，不把请求临时改为新登录用户。退出或切换账号取消该账号正在进行的模型运行；不会删除已保存的本地会话。

该认证抽象覆盖：普通 chat、模型列表、手动压缩、goal、orchestration 及子阶段、模型辅助搜索。删除所有把非空 `provider.apiKey` 作为唯一可用条件的判断。保留 stream、工具调用、reasoning 和 AbortSignal。流开始后不自动重放可能重复计费的模型 POST。

## Web 部署门禁与账号隔离

原 StoryFabric 部署访问密钥与工作区门禁继续独立生效。中心登录不能跳过 `/web-login` 或获得服务器已有 workspace 访问权。

每个服务器部署独立在中心登记保密 client ID、secret 和精确回调，发行包不携带共享 secret；未登记时显示服务未配置。服务器完成 callback/token exchange。云 token 保存在服务器端、按当前部署 session ID 分区；浏览器只拿现有 HttpOnly 门禁 cookie 和公开账户结果。单独 OAuth transaction cookie 使用 SameSite=Lax 并绑定原部署 session、state 和 PKCE；不放宽原工作区门禁 cookie 的 SameSite 规则。

session 到期、退出门禁或服务器清理同时关闭该部署会话的云授权记录。服务器重启后若没有安全持久化该会话，提示重新授权，不能从 global settings 恢复一个共享云账号。

现有 server runtime 按 workspace 缓存。接入后运行凭据按 `(deploymentSessionId, centralSubject, workspaceId)` 隔离，资料与文件锁仍按 workspace 共用，避免两个身份并发写同一文件破坏数据。SSE/runtime event 回放按发起会话过滤，不能把另一账号的账户活动广播出去。

## Android

使用系统浏览器、Capacitor Browser/App 生命周期和已登记的应用回跳；优先 Android 验证 app link。开发 scheme 必须独立登记，保持 state/PKCE/nonce 验证与一次性事务。接入 Manifest intent filter 和 cold-start callback，不使用 WebView 收集密码。

Android 新增原生账号 bridge，按仓库现有 Java plugin 模式注册，并使用 AppAuth-Android 处理 native OAuth 流程；原生层完成 token exchange、Keystore 加密保存、续期及受限业务请求。现有 JS SecureStorage API 会把解密值返回 JS，不能单靠它保证 token 不进入 renderer。bridge 只接受已登记的业务操作或模型请求，不接受任意 URL/header，返回公开 DTO 或模型流事件。Core 的 Android 托管 adapter 使用 native transport 和不含 secret 的凭据引用，不在 JS 中组装 bearer header。

token 不进入 Preferences 或项目，renderer 只持有公开状态。回跳取消、后台进程重建和已消费 callback 均有明确可重试行为。

## 账户操作与数据语义

余额和云端用量来自 Sub2API，与现有本地模型用量记录分开标明来源。金额显示真实币种和单位。读取渠道仅显示服务器允许的组和费率；切组后重新取模型能力，避免继续显示旧组不可用模型。

兑换和托管密钥轮换按操作生成稳定幂等键，同一次操作网络重试保留该键。按钮提交中禁用，迟到响应受账号代际检查。轮换传期望版本；后端冲突时更新状态并提示重试。重置只返回状态/版本；没有明文 key 可显示或缓存。

账户注册只在授权流程中完成。中心授权返回后 onboarding 可失败独立重试；界面区分「中心已登录」「业务连接待完成」，不能重复注册账号。

## 验证与交付

- 账号服务测试真实 state/nonce/PKCE/issuer 验证、一次性/并发/超时回调、取消、单飞刷新、退出后迟到响应及账号切换。
- 独立凭据库测试安全存储不可用、解密失败和无明文降级；IPC/settings/export/error/log 测试不含 token/key/preview。
- 用户页用公开 mock DTO 验证登录、额度、用量、组/兑换/轮换、失效/未配置和加载错误；保留 `MemoryPages.test.tsx` 对 UserPage 的回归。
- 模型测试覆盖列表、chat、压缩、goal/orchestration 和取消；测试服务器验证 OAuth token 只出现在固定 gateway 的 auth header。
- Web 同一和不同 workspace 下，两个部署会话登录不同中心账号，所有账户/用量/运行/事件保持各自身份；本地文件锁仍按 workspace 保证一致。
- Android 验证冷启动/热启动 app callback、后台恢复、取消、重复回跳和安全存储。
- 三端本地联合测试以两个独立账号证明账单归属、退出/撤销、幂等开户、无 key 泄露及无工作区同步。

实现验证使用仓库已有 TypeScript/node/web checks、相关 Vitest、server bundle 和 Windows desktop 构建入口。正式版本按照 AGENTS.md 同步源版本与该版本 release 目录的安装包/服务器包，并验证 SHA-256。当前设计交付不变更 0.2.30，也不声称产生新的安装包。
