import React from 'react'
import type { CloudSupplierGroup, CloudSupplierModel } from '../../../../shared/cloudAccount'

const price = (value: number): string => value.toLocaleString('en-US', { maximumFractionDigits: 8 })

function ModelPrice({ model }: { model: CloudSupplierModel }): React.ReactElement {
  if (model.billingMode === 'per_request' || model.billingMode === 'request') {
    return <p className="mt-1 text-xs text-muted">{price(model.inputPrice)} CNY / 次</p>
  }
  if (model.billingMode === 'image') {
    return <p className="mt-1 text-xs text-muted">{price(model.inputPrice)} CNY / 张</p>
  }
  return <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
    <span>输入 {price(model.inputPrice)} CNY / 百万 Token</span>
    <span>输出 {price(model.outputPrice)} CNY / 百万 Token</span>
    {model.cacheReadPrice !== undefined && <span>缓存读取 {price(model.cacheReadPrice)} CNY / 百万 Token</span>}
    {model.cacheWritePrice !== undefined && <span>缓存写入 {price(model.cacheWritePrice)} CNY / 百万 Token</span>}
  </div>
}

export function SupplierLobby({ groups }: { groups: CloudSupplierGroup[] }): React.ReactElement {
  return <section className="rounded-xl border border-border bg-panel p-5">
    <h2 className="font-medium">供应商大厅</h2>
    <p className="mt-1 text-sm text-muted">查看可用分组的模型与参考价。价格已包含你的分组倍率，最终费用以实际用量记录为准。</p>
    {groups.length ? <div className="mt-3 space-y-3">{groups.map(group => <div key={group.id} className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">{group.name}</p>{group.rate !== undefined && <span className="text-xs text-muted">倍率 {price(group.rate)}×</span>}</div>
      {group.description && <p className="mt-1 text-xs text-muted">{group.description}</p>}
      {group.platform && <p className="mt-1 text-xs text-muted">平台：{group.platform}</p>}
      {group.models.length ? <ul className="mt-3 space-y-3">{group.models.map(model => <li key={model.name} className="border-t border-border pt-2">
        <p className="break-all text-sm">{model.name}</p><ModelPrice model={model} />
      </li>)}</ul> : <p className="mt-2 text-xs text-muted">此分组暂未公布模型报价。</p>}
    </div>)}</div> : <p className="mt-2 text-sm text-muted">当前没有可用供应商分组。</p>}
  </section>
}
