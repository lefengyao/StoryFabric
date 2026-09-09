/** POSIX 单引号转义：所有进入远程命令的用户输入都必须经过它。 */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** root 直接执行；非 root 用 `sudo -S`，密码由传输层写入 stdin（不进命令行）。 */
export function sudoPrefix(isRoot: boolean): string {
  return isRoot ? '' : 'sudo -S '
}
