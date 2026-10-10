import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SupplierLobby } from '../SupplierLobby'

describe('SupplierLobby', () => {
  it('shows group rates, public model names and effective token prices', () => {
    const markup = renderToStaticMarkup(<SupplierLobby groups={[{ id: '7', name: '创作组', rate: 0.5, models: [{ name: 'novel-model', billingMode: 'token', inputPrice: 1, outputPrice: 3, cacheReadPrice: 0.1 }] }]} />)
    expect(markup).toContain('供应商大厅')
    expect(markup).toContain('创作组')
    expect(markup).toContain('novel-model')
    expect(markup).toContain('0.5')
    expect(markup).toContain('百万 Token')
    expect(markup).toContain('1 CNY')
    expect(markup).toContain('3 CNY')
    expect(markup).toContain('缓存读取')
  })

  it('labels request billing separately and gives a useful empty state', () => {
    const markup = renderToStaticMarkup(<SupplierLobby groups={[{ id: '8', name: '图像组', models: [{ name: 'image-model', billingMode: 'per_request', inputPrice: 0.2, outputPrice: 0 }] }]} />)
    expect(markup).toContain('CNY / 次')
    expect(markup).not.toContain('百万 Token')
    expect(renderToStaticMarkup(<SupplierLobby groups={[]} />)).toContain('当前没有可用供应商分组')
  })
})
