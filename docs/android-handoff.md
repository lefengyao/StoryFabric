# Android 端暂停交接记录

本文记录 StoryFabric Android 端在 Android 10 真机上的适配结论、踩坑和后续要求。当前 Android 产出暂时搁置：不继续生成、签名、发布或安装 APK；恢复 Android 工作时应先按本文的验收清单复核。

## 当前状态

- Android 壳：Capacitor 7 + React，共享 `src/core` 业务核心。
- 工作区：Android 使用应用私有目录 `Directory.Data`，不是用户可直接浏览的系统文件夹。
- 数据交换：工作区通过 `.storyfabric.zip` 导入/导出，会话通过 `.storyfabric.session.json` 导入/导出。
- 目标下限：Android 10（API 29）及以上；本次实测设备为 Vivo V1914A，Android 10。
- 实测 WebView：`com.google.android.webview 83.0.4103.106`（Chromium 83）。兼容性要求必须以这个版本为下限，而不能只按 Android 15 的 WebView 验证。
- 最近一次工程验证：TypeScript、Vitest、Electron 构建、Capacitor 同步和 Debug APK 编译均通过；完整的真机功能回归尚未完成。

## 已确认的坑与根因

### 1. Tailwind 4 的 `@layer` 会让 Android 10 页面退回浏览器默认样式

Tailwind 4 产物把主题、基础样式和工具类放在 CSS Cascade Layers 中：

```css
@layer theme { ... }
@layer base { ... }
@layer utilities { ... }
```

Android 10 的 WebView 83 不支持 Cascade Layers，会忽略这些规则。表现不是单个组件坏掉，而是整页出现以下现象：

- `flex`、`inline-flex`、`flex-1` 等布局类失效；
- 按钮退回浏览器默认的 `inline-block` 外观；
- 间距、字体、圆角、颜色等工具类同时失效；
- 弹窗和表单看起来像“所有文字顶格、按钮挤在一起”。

已经采取的修复是只在移动端 Vite 构建中把 `@layer` 外壳展开为普通 CSS，桌面端构建不改变。对应实现位于 `vite.mobile.config.ts` 的 `legacyMobileCss` 插件。

**要求：**以后不能只在 Android 15 或桌面浏览器截图通过后就判断 UI 完成；移动端产物必须检查不含 `@layer`，并在 Android 10 WebView 上检查关键元素的实际计算样式。

### 2. JavaScript 依赖产物可能包含 Android 10 不认识的语法

Android 10 的 WebView 83 曾在启动时报告 `Unexpected token '='`，根因是依赖包产物中出现了较新的逻辑赋值语法（例如 `||=`）。

移动端构建已经固定为：

```ts
build: {
  target: 'es2019'
}
```

**要求：**任何移动端依赖升级后，都要重新检查最终 `out/mobile/assets/*.js`，并在 Android 10 真机清空 Logcat 后冷启动验证。不能只检查 TypeScript 源码，因为问题可能来自打包后的依赖代码。

### 3. Renderer API Proxy 丢失实例 `this`

渲染层通过 Proxy 暴露统一的 `api`。如果直接返回 Android 类实例方法，调用时方法没有绑定实例，`this.currentStore`、`this.agent`、事件监听器等状态会丢失。

修复后的规则是：

```ts
return typeof value === 'function' ? value.bind(impl) : value
```

**表现：**工作区可能能显示，但创建会话、发送智能体指令、保存实体或监听流式事件会失败，容易被误判为业务逻辑问题。

**要求：**平台 API 的每个实例方法都必须经过绑定回归测试；新增平台实现时不要绕过统一 API 直接从页面调用类实例。

### 4. Android 不能假设有桌面文件夹选择器

Android 首版没有把 `pickFolder()` 伪装成 Windows 文件夹选择器。工作区创建在应用私有目录下完成，任意系统目录访问不属于首版边界。

因此 Android 欢迎页的行为应保持为：

1. 创建工作区：输入小说名，自动创建并打开；
2. 打开工作区：列出应用内部已创建且通过 `storyfabric.json` 校验的工作区；
3. 跨设备传递：使用工作区 ZIP 导入/导出。

### 5. API Key 不能写入普通设置或会话文件

Android 非敏感设置使用 Capacitor Preferences；API Key 使用 Android Keystore 兼容的 Secure Storage。普通设置只保存供应商元数据、`hasKey` 和脱敏预览。

**要求：**不得把密钥写入 `localStorage`、Preferences、会话 JSON、工作区 ZIP 或日志；模型列表请求和 Agent 请求都必须从安全存储读取密钥。

### 6. 系统安全区和底部导航会改变可用视口

实测设备物理屏幕为 `1080x2340`，WebView CSS 视口约为 `360x710`，设备像素比为 3；顶部状态栏约 84 个物理像素。底部还存在系统导航区域。

移动端布局必须同时满足：

- 顶部内容不被状态栏或刘海覆盖；
- 消息列表和输入区不被底部导航栏覆盖；
- 应用底部导航与系统主页/返回区域有明确分隔和足够触控间距；
- 弹窗在短屏和输入法弹出时仍能滚动，按钮不能跑出可视区域；
- 长中文、供应商名称和模型名称必须换行或截断，不能撑破父容器。

## 构建链约束

当前 Android 工程使用 Capacitor 7、Android Gradle Plugin 8.7.2、Gradle 8.11.1，`android/app/capacitor.build.gradle` 设置 Java 21 编译兼容性。当前本机实际使用 JDK 21。

不要只把 `JAVA_HOME` 切换到 JDK 17 就继续构建：若要回到 JDK 17，必须先整体验证 Capacitor 插件、Gradle、Android Gradle Plugin 和 Java 编译目标是否匹配。此前 JDK 25 会触发 `Unsupported class file major version 69`。

恢复 Android 产出时使用以下顺序：

```powershell
npm run mobile:sync
Set-Location android
./gradlew assembleDebug
```

真机安装前确认设备已开启 USB 安装权限；安装失败 `INSTALL_FAILED_ABORTED: User rejected permissions` 属于设备安全确认，不是 APK 编译错误。

## 功能验收清单

恢复 Android 产出前，必须在 Android 10 真机上逐项完成并记录结果：

- [ ] 首次启动页面布局正常，按钮不是浏览器默认样式，文字不顶格或溢出。
- [ ] 创建新工作区后自动进入工作区，重启应用后仍能打开最近工作区。
- [ ] 工作区列表可以切换已有工作区；损坏目录会被跳过并显示可读错误。
- [ ] 新建会话后立即出现在列表中，关闭并重启应用后仍存在。
- [ ] 切换、重命名、归档、删除会话均能刷新列表和当前内容。
- [ ] 导出当前会话，系统分享面板能读取实际文件 URI。
- [ ] 导入 `.storyfabric.session.json` 后生成新会话，不覆盖原会话 ID。
- [ ] 导出工作区 ZIP，再导入 ZIP 后自动打开副本，人物、关系、大纲、事件、章节和会话数据完整。
- [ ] 设置页可以添加供应商；按钮文字保持为“添加”，不跑出按钮边界。
- [ ] API Key 保存后只显示脱敏预览；模型列表拉取和默认模型保存可用。
- [ ] 未配置供应商、API Key 或默认模型时发送指令，显示明确提示，不崩溃。
- [ ] 配置可用模型后发送指令，能收到流式文本、工具调用状态和完成事件。
- [ ] Agent 请求写入时能弹出确认 Diff；拒绝不会写盘，确认后刷新页面可看到数据。
- [ ] 输入法弹出、旋转/恢复竖屏和系统返回键操作不会遮挡消息或底部导航。
- [ ] 全流程 Logcat 无 `FATAL EXCEPTION`、`AndroidRuntime`、`Capacitor/Console` 或 JavaScript 语法错误。

## 恢复开发前的检查命令

```powershell
npx tsc -b --pretty false
npm test -- --run
npm run build
npm run mobile:build
```

检查移动端 CSS 是否已经展开：

```powershell
$css = Get-Content -Raw (Get-ChildItem out/mobile/assets/*.css | Select-Object -First 1).FullName
$css.Contains('@layer')
```

结果必须为 `False`。随后才允许执行 `npm run mobile:sync`、Gradle 构建和真机安装。

## 暂停边界

当前暂不承诺 Android 发布包、签名包或应用商店上架。Windows Electron 端继续按现有流程维护；Android 端的代码和文档保留在仓库中，待产品确认继续投入后，从本文的构建链约束和功能验收清单重新开始。

