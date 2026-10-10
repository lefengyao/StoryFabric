// electron-builder and its transitive helpers spawn package-manager, PowerShell,
// 7za and NSIS processes.  Some releases omit windowsHide, so Windows opens a
// console for each child.  Load this through NODE_OPTIONS for the release build
// and apply the default only when the caller did not choose a visibility mode.
if (process.platform === "win32") {
  const childProcess = require("node:child_process");
  const { promisify } = require("node:util");
  const withHiddenWindow = (args) => {
    const hasArgs = Array.isArray(args[1]);
    const callback = args.find((arg) => typeof arg === "function");
    const options = (hasArgs || args[1] == null ? args[2] : args[1]) ?? {};
    // 保留 Node 对非法参数的校验；只规范化受支持的 overload。
    if (typeof options !== "object" && typeof options !== "function") return args;
    const hiddenOptions = typeof options === "function" ? {} : options;
    return [
      args[0],
      hasArgs ? args[1] : [],
      { ...hiddenOptions, windowsHide: hiddenOptions.windowsHide ?? true },
      ...(callback ? [callback] : []),
    ];
  };
  const patch = (name) => {
    const original = childProcess[name];
    if (typeof original !== "function" || original.__storyFabricWindowsHidePatched) {
      return;
    }
    const wrapped = function (...args) {
      return original.apply(this, withHiddenWindow(args));
    };
    if (original[promisify.custom]) {
      // Node 的 execFile promise 返回 {stdout, stderr}，不能因包装而丢掉。
      wrapped[promisify.custom] = function (...args) {
        return original[promisify.custom].apply(this, withHiddenWindow(args));
      };
    }
    wrapped.__storyFabricWindowsHidePatched = true;
    childProcess[name] = wrapped;
  };

  for (const name of ["spawn", "spawnSync", "execFile", "execFileSync"]) {
    patch(name);
  }
}
