import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { CharacterDoc, OutlineDoc } from '../../../../shared/types'

export type ReadingImageProps = { workspaceName: string; chapterTitle?: string } & (
  | { kind: 'character'; document: CharacterDoc }
  | { kind: 'outline'; document: OutlineDoc }
)

export const readingStyle = `
.sf-reading-image { width:760px; box-sizing:border-box; padding:48px 52px; background:#fffdf8; color:#292524; font:16px/1.9 "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif; overflow-wrap:anywhere; }
.sf-reading-image * { box-sizing:border-box; }
.sf-reading-image h1 { font-size:32px; line-height:1.45; margin:12px 0 20px; font-weight:700; }
.sf-reading-image h2 { font-size:23px; margin:28px 0 12px; font-weight:600; }
.sf-reading-image h3 { font-size:19px; margin:20px 0 8px; font-weight:600; }
.sf-reading-image p { margin:12px 0; }
.sf-reading-image ul, .sf-reading-image ol { padding-left:28px; margin:12px 0; list-style-position:outside; }
.sf-reading-image ul { list-style-type:disc; } .sf-reading-image ol { list-style-type:decimal; }
.sf-reading-image blockquote { border-left:3px solid #c7bba7; padding-left:18px; color:#57534e; margin:18px 0; }
.sf-reading-image table { border-collapse:collapse; width:100%; table-layout:fixed; margin:18px 0; }
.sf-reading-image th, .sf-reading-image td { border:1px solid #d6d3d1; padding:8px 12px; text-align:left; vertical-align:top; }
.sf-reading-image th { background:#f5f0e7; }
.sf-reading-image pre { background:#f5f0e7; padding:16px; white-space:pre-wrap; overflow-wrap:anywhere; margin:16px 0; }
.sf-reading-image code { font-size:14px; } .sf-reading-image img { max-width:100%; height:auto; }
.sf-reading-image a { color:#9a6b12; text-decoration:underline; }
.sf-reading-image hr { border:0; border-top:1px solid #d6d3d1; margin:24px 0; }
`

export function ReadingFrame({ workspaceName, title, subtitle, children }: { workspaceName: string; title: string; subtitle?: string; children: ReactNode }): React.ReactElement {
  return <article className="sf-reading-image">
    <style>{readingStyle}</style>
    <div style={{ fontSize: 13, letterSpacing: 2, color: '#78716c' }}>{workspaceName || '未命名作品'} · StoryFabric</div>
    <h1>{title || '未命名'}</h1>
    {subtitle && <div style={{ color: '#78716c', fontSize: 14, marginBottom: 18 }}>{subtitle}</div>}
    {children}
    <div style={{ borderTop: '1px solid #d6d3d1', marginTop: 34, paddingTop: 16, fontSize: 12, color: '#78716c' }}>StoryFabric · {workspaceName || '未命名作品'}</div>
  </article>
}

export function ReadingImage(props: ReadingImageProps): React.ReactElement {
  const character = props.kind === 'character' ? props.document : null
  const outline = props.kind === 'outline' ? props.document : null
  const metadata = character ? [
    ['级别', character.tier === 'primary' ? '主要角色' : '次要角色'], ['定位', character.role], ['阵营', character.faction],
    ['别名', character.aliases.join('、')], ['性别', character.gender], ['年龄', character.age], ['标签', character.tags.join(' · ')]
  ] : [['类型', outline?.kind === 'chapter' ? '章纲' : '总纲'], ['关联章节', props.chapterTitle ?? '']]
  return <ReadingFrame workspaceName={props.workspaceName} title={character?.name ?? outline?.title ?? ''} subtitle={character ? '人物资料卡' : '大纲'}>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', paddingBottom: 20, borderBottom: '1px solid #d6d3d1', fontSize: 14 }}>
      {metadata.filter(([, value]) => value).map(([label, value]) => <span key={label}><span style={{ color: '#78716c' }}>{label}：</span>{value}</span>)}
    </div>
    {character?.summary && <p style={{ fontSize: 18, color: '#57534e', margin: '24px 0' }}>{character.summary}</p>}
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{props.document.content}</ReactMarkdown>
  </ReadingFrame>
}
