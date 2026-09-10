# StoryFabric 全平台品牌资产替换设计

## 背景

项目新增了三份品牌 SVG，需要替换旧的内嵌 logo 和发行资源，并确保 Electron、Web、Android 使用一致的资产分工。

## 资产职责

- `storyfabric-logo.svg`：发行/系统图标源。用于 Electron 任务栏、安装包、便携版、桌面快捷方式，以及 Android launcher 图标的生成。
- `storyfabric-logo-flat.svg`：软件内主品牌图形。用于侧栏、欢迎页、Web 登录页和浏览器 favicon。
- `storyfabric-logo-mono.svg`：白底单色水印源。封装为可复用的 `mono` 品牌组件，通过 CSS `color` 与透明度控制颜色，不强行新增水印场景。

## 组件与资源结构

新增统一的 `BrandMark` 组件，至少支持：

- `variant="flat"`：渲染 flat SVG，适合常规品牌展示。
- `variant="mono"`：通过 SVG mask 或等效方式渲染 mono SVG，使颜色由外部 CSS 控制。
- `size`、`className` 以及可继承的颜色/透明度样式。

旧的 `AppLogo` 内嵌渐变 SVG 不再保留为品牌实现；现有调用点迁移到 `BrandMark`，避免未来继续出现旧 logo 分叉。

根目录新增 SVG 作为设计源保留。渲染端使用稳定的静态资源入口，发行端使用明确的资源生成脚本或现有生成链路，避免运行时依赖开发目录之外的文件。

## 平台替换范围

### Electron 与 Web

- 侧栏、欢迎页、Web 登录页使用 `flat`。
- `src/renderer/index.html` 增加 `flat` favicon。
- Electron 主窗口图标、electron-builder 的 Windows 图标和额外资源改用第一份 SVG生成的发行文件。
- 发行资源至少包含 ICO 和 PNG 预览/构建输入，保持现有打包配置可用。

### Android

- 使用第一份 SVG生成并替换现有 launcher、round launcher、foreground/background 所需资源。
- 不修改应用逻辑和启动流程，仅替换图标资产与必要的资源引用。

## 动态水印规则

`mono` 组件默认透明背景、继承 `currentColor`，允许调用方通过 `className` 或 `style` 设置颜色与透明度。组件不自动插入空状态、加载页或欢迎页，以免改变现有版式；后续需要水印的页面可以复用同一组件。

## 验证

- 测试 `BrandMark` 的 variant、尺寸、可访问性属性和 mono 调色入口。
- 检查项目内不再存在旧内嵌 logo 的渲染路径。
- 检查发行资源文件确实由第一份 SVG生成，并能被 Electron/Android 配置引用。
- 运行 `npx vitest run`、两套 TypeScript 检查和 Electron/Web/Mobile/Server 构建。
- 使用 `git diff --check` 检查资源与代码差异。

## 非目标

- 不重新设计三个 SVG 的图形内容。
- 不额外新增水印展示场景。
- 不改动应用名称、产品色或与品牌替换无关的页面布局。
