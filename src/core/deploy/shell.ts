/** POSIX 单引号转义：所有进入远程命令的用户输入都必须经过它。 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** root 直接执行；非 root 用 `sudo -S`，密码由传输层写入 stdin（不进命令行）。 */
export function sudoPrefix(isRoot: boolean): string {
  return isRoot ? '' : 'sudo -S '
}

/** SSH 用户名：只允许常见字符，避免拼接进远程路径时注入 */
export function isSafeUsername(value: string): boolean {
  return /^[A-Za-z0-9._-]{1,64}$/.test(value)
}

/** 安装目录：必须是绝对路径、无换行/NUL、长度受限 */
export function isSafeInstallDir(value: string): boolean {
  return value.startsWith('/') && value.length <= 200 && !/[\r\n\0]/.test(value)
}

/** 基础镜像名：registry/repo:tag 的常见字符 */
export function isSafeImage(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,200}$/.test(value)
}
