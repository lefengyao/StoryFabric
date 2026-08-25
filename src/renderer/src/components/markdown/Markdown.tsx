/** Markdown 渲染（聊天消息、预览用） */
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words prose-p:my-2 prose-headings:mt-3 prose-headings:mb-2 prose-ul:my-2 prose-li:my-0.5 prose-pre:bg-elevated prose-pre:text-fg prose-code:before:hidden prose-code:after:hidden">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
