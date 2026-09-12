import { Annotation, type Transaction } from '@codemirror/state'

/** 标记 React 将外部文档内容同步进 CodeMirror，避免被当成用户编辑。 */
export const externalEditorChange = Annotation.define<boolean>()

export function shouldNotifyEditorChange(transactions: readonly Transaction[]): boolean {
  return transactions.some((transaction) => transaction.docChanged && !transaction.annotation(externalEditorChange))
}
