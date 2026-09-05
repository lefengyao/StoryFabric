# Windows + Android 发布说明

## 当前架构

- Windows：Electron + electron-builder，继续使用本地文件夹工作区和主进程 Agent。
- Android：Capacitor + React，使用应用私有目录保存本地工作区；共享 `src/core` 中的平台无关文件存储、实体序列化和工作区逻辑。
- 两端目前是各自本地工作区，尚未提供自动云同步。

## Windows

```bash
npm run dist:win
```

输出目录为 `release/`，包含 Windows x64 NSIS 安装包和 portable 包。

## Android

首次初始化：

```bash
npm install
npx cap add android
```

构建并同步 Web 资源：

```bash
npm run mobile:sync
```

打开 Android Studio：

```bash
npm run mobile:open
```

在 Android Studio 中生成 Debug APK 或 Release AAB。建议使用 JDK 17 或 21；JDK 25 会导致当前 Gradle/Android 插件报 `Unsupported class file major version 69`。

命令行 Debug APK：

```bash
cd android
./gradlew assembleDebug
```

Release AAB 需要在 `android/app/build.gradle` 配置签名（建议通过 CI secrets 注入 `KEYSTORE_FILE`、`KEYSTORE_PASSWORD`、`KEY_ALIAS`、`KEY_PASSWORD`），然后执行：

```bash
cd android
./gradlew bundleRelease
```

## Android 首版边界

- 工作区保存在应用私有目录，Android 首版不直接浏览任意系统文件夹。
- `pickFolder()` 在 Android 首版不打开任意系统目录，用户通过应用内创建工作区或导入 `.storyfabric.zip` 使用项目。
- 模型列表拉取和 Android Agent 已复用共享协议适配器，API Key 通过 Android Keystore 兼容安全存储读取，不写入普通 Preferences、会话 JSON 或日志。
- Windows 与 Android 之间需要手动导入/导出或后续同步服务。
- 当前实施阶段优先验证 Windows；Android 已完成共享 API 对齐，但按交接文档暂停构建、安装和发布。

## 工作区导入/导出

在工作区顶部工具栏可使用下载/上传按钮：导出为 `.storyfabric.zip`，导入后会在当前平台的本地工作区中创建副本并自动打开。该格式由 Windows 与 Android 共用，适合通过网盘、USB 或即时通讯工具手动传递。
