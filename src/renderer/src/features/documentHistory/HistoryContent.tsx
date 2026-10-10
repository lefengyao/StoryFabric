import type { HistoryVersionRecord, HistoricalDocument } from '../../../../shared/documentHistory'
import { diffLines } from 'diff'
import { Markdown } from '../../components/markdown/Markdown'
import { CHAPTER_STATUS_LABEL } from '../../lib/utils'

function compareText(document: HistoricalDocument): string {
  const metadata = 'status' in document ? `状态：${CHAPTER_STATUS_LABEL[document.status]}\n术语：${document.terms?.map((term) => term.note ? `${term.term}（${term.note}）` : term.term).join('、') || '无'}\n` : ''
  return `标题：${document.title}\n${metadata}\n${document.content}`
}
export function HistoryContent({ record, compare }: { record: HistoryVersionRecord; compare?: HistoricalDocument | null }): React.ReactElement {
  if (compare) {
    const changes = diffLines(compareText(compare), compareText(record.document))
    return <div data-history-readonly="true" className="min-w-0">
      <p className="mb-3 text-xs text-muted"><span className="text-danger">红色为比较对象的内容</span> · <span className="text-ok">绿色为此历史版本的内容</span></p>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-app p-3 font-mono text-xs leading-6">{changes.map((change, index) => <span key={index} data-diff-change={change.added ? 'added' : change.removed ? 'removed' : 'unchanged'} className={change.added ? 'block bg-ok/10 text-ok' : change.removed ? 'block bg-danger/10 text-danger' : 'text-muted'}>{change.value}</span>)}</pre>
    </div>
  }
  return <article data-history-readonly="true" className="min-w-0">
    <h2 className="mb-5 break-words text-xl font-semibold">{record.document.title}</h2>
    <dl className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted">
      {'status' in record.document ? <>
        <div><dt className="inline">箱位：</dt><dd className="inline">{record.document.box === 'draft' ? '草稿箱' : record.document.box === 'trash' ? '回收站' : '正文箱'}</dd></div>
        {record.document.volume && <div><dt className="inline">卷：</dt><dd className="inline">{record.document.volume}</dd></div>}
        <div><dt className="inline">状态：</dt><dd className="inline">{{ draft: '草稿', revised: '修订', body: '正文', final: '定稿' }[record.document.status]}</dd></div>
      </> : <div><dt className="inline">类型：</dt><dd className="inline">{record.document.kind === 'chapter' ? record.document.chapterId ? '关联章纲' : '独立章纲' : '总纲'}</dd></div>}
      <div><dt className="inline">序号：</dt><dd className="inline">{record.document.order}</dd></div>
    </dl>
    <Markdown text={record.document.content} />
    {'terms' in record.document && record.document.terms?.length ? <section className="mt-6 border-t border-line pt-4"><h3 className="text-sm font-medium">术语标注</h3><dl className="mt-3 space-y-2 text-xs">{record.document.terms.map((term, index) => <div key={index}><dt className="font-medium">{term.term}</dt><dd className="mt-1 whitespace-pre-wrap text-muted">{term.note}</dd></div>)}</dl></section> : null}
  </article>
}
