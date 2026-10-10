import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { promisify } from "node:util";

const source = readFileSync(new URL("./hide-windows-child-processes.cjs", import.meta.url), "utf8");

test("Windows 子进程默认隐藏，保留显式选项与 callback overload", () => {
  const calls = [];
  const childProcess = Object.fromEntries(
    ["spawn", "spawnSync", "execFile", "execFileSync"].map((name) => [name, (...args) => calls.push({ name, args })]),
  );
  const context = {
    process: { platform: "win32" },
    require: (name) => name === "node:util" ? { promisify } : childProcess,
  };
  runInNewContext(source, context);
  runInNewContext(source, context); // NODE_OPTIONS 和显式载入不得重复包裹。
  childProcess.spawn("7za.exe", ["a"], { stdio: "pipe" });
  childProcess.spawnSync("powershell.exe", [], { windowsHide: false });
  const callback = () => {};
  childProcess.execFile("tool.exe", [], callback);
  childProcess.execFile("tool.exe", [], { cwd: "E:/build" }, callback);
  childProcess.execFileSync("tool.exe");
  assert.equal(calls[0].args[2].windowsHide, true);
  assert.equal(calls[0].args[2].stdio, "pipe");
  assert.equal(calls[1].args[2].windowsHide, false);
  assert.equal(calls[2].args[2].windowsHide, true);
  assert.equal(calls[2].args[3], callback);
  assert.equal(calls[3].args[2].windowsHide, true);
  assert.equal(calls[3].args[3], callback);
  assert.equal(calls[4].args[2].windowsHide, true);
  childProcess.spawn("tool.exe", [], undefined);
  assert.equal(calls[5].args[2].windowsHide, true);
  childProcess.execFile("tool.exe", [], undefined, callback);
  assert.equal(calls[6].args.length, 4);
  assert.equal(calls[6].args[2].windowsHide, true);
  assert.equal(calls[6].args[3], callback);
});

test("保留 execFile 的自定义 promisify 返回值和隐藏选项", async () => {
  const execFile = () => {};
  execFile[promisify.custom] = async (_file, _args, options) => {
    assert.equal(options.windowsHide, true);
    return { stdout: "ok", stderr: "" };
  };
  const childProcess = { execFile };
  runInNewContext(source, {
    process: { platform: "win32" },
    require: (name) => name === "node:util" ? { promisify } : childProcess,
  });
  assert.deepEqual(await promisify(childProcess.execFile)("tool.exe", []), { stdout: "ok", stderr: "" });
});

test("非 Windows 平台保持原 API", () => {
  const spawn = () => {};
  const childProcess = { spawn };
  runInNewContext(source, { process: { platform: "linux" }, require: () => childProcess });
  assert.equal(childProcess.spawn, spawn);
});
