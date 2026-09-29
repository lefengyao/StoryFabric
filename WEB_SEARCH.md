# 联网搜索

智能体对话框输入区提供“联网”选择：关闭、自动、厂商原生、免费托管、本机自建。选择按本次发送生效；关闭时，智能体不会收到 `web_search` 或 `web_extract` 工具。检索结果包括来源 URL、标题、摘要和检索时间，智能体应在回答中引用 URL。

`web_extract` 可读取一个公开网页的正文，供智能体在搜索后核实来源。StoryFabric 打包了 TypeScript 工具客户端，无需安装 `uv`、Python 或额外的 MCP 服务进程。实际抓取仍由联网服务完成：免费托管模式使用 Anysearch 的网页提取接口；本机自建模式使用 Docker 服务的 `/v1/extract`；自动模式依次尝试两者。厂商原生模式只提供厂商搜索，不提供网页提取，避免未经用户选择把 URL 发给第三方。

Windows 桌面版在 Electron 主进程执行请求；Web 版在 StoryFabric 服务端执行；Android 版通过 Capacitor 原生 HTTP 请求，避免 WebView 对第三方 MCP 端点的跨域限制。三端共用同一套工具定义与结果格式。Android 的免费托管模式不需要额外配置。Android 的本机自建选项目前没有独立的服务地址设置，默认的 `127.0.0.1` 指向手机自身，因此不能直接连接 Windows 上的 Docker 服务。

| 模式 | 路由 |
| --- | --- |
| 自动 | 已知支持的模型先用厂商原生服务；失败后尝试免费托管，最后尝试本机自建 |
| 厂商原生 | 使用当前模型供应商的 API Key 发起单独的搜索请求；目前支持 Anthropic Messages 的 Claude 和 OpenAI Responses 的 GPT/o 系列 |
| 免费托管 | 使用 `web-search-kit` 的 Anysearch 匿名 MCP 服务；受服务方配额和可用性约束 |
| 本机自建 | 请求 `http://127.0.0.1:8090/v1/search`，需先启动 Docker 服务 |

Windows 桌面版和 Web 服务端的本机自建地址可用环境变量 `STORYFABRIC_WEB_SEARCH_SELF_HOSTED_URL` 覆盖。Docker 端口目前只绑定到 Windows 主机的回环地址。Web 版向 StoryFabric 服务端发起请求，由服务端连接 Docker；要从其他机器连接自建服务，需要另外配置可访问的地址与鉴权。

本次本机部署使用 `C:\Users\15610\Desktop\web-search-kit\selfhosted`。该目录中的 `docker-compose.local.yaml` 设置 `WITH_RENDER: "0"`、`EXTRACTOR_SEARCH_BACKEND_URL=http://searxng:8080`，并给 Valkey 使用 Docker 命名卷。静态检索不依赖 Chromium；需要抓取客户端渲染页面时再启用 Chromium 构建。启动命令：

```powershell
docker compose -f docker-compose.yaml -f docker-compose.local.yaml up -d --build
```

健康检查：`http://127.0.0.1:8090/health`。检索接口为 `POST http://127.0.0.1:8090/v1/search`，请求体示例：`{"queries":["OpenAI research"],"max_results":3}`。Docker 服务依赖外部搜索引擎；引擎超时或验证码会导致自建检索失败，自动模式可继续回退到其他可用服务。

搜索与提取适配代码来自用户提供的 `web-search-kit/web-search-standalone`（MIT），已放在 `src/core/search/webSearchKit`；StoryFabric 的对话路由和结果封装分别位于 `src/core/search/webSearchService.ts` 和 `src/core/search/webExtractService.ts`。
