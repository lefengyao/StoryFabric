export interface ClipboardWriter {
  writeText: (text: string) => Promise<void>
}

/** 复制纯文本；剪贴板不可用时提供明确错误，避免界面假装成功。 */
export async function copyPlainText(text: string, writer?: ClipboardWriter): Promise<void> {
  const target = writer ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined)
  if (target?.writeText) {
    try {
      await target.writeText(text)
      return
    } catch (error) {
      if (writer) throw error
    }
  }
  if (copyWithTextarea(text)) return
  throw new Error('当前环境不支持复制到剪贴板')
}

/** 桌面端和部分 WebView 可能限制 Clipboard API，保留 DOM 复制作为兼容路径。 */
function copyWithTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}
