/**
 * 由实体 id 生成稳定的初始坐标。
 * 力导向布局用随机初值时，每次重建图谱都会让没有保存过位置的角色跳到新位置；
 * 用 id 播种可以保证「同一角色每次都在同一处」。
 */
export interface SeedPoint {
  x: number
  y: number
}

/** FNV-1a：小输入下分布足够均匀，且与运行环境无关。 */
function fnv1a(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function seedPosition(id: string, radius = 400): SeedPoint {
  const a = fnv1a(id)
  const b = fnv1a(`${id}#y`)
  return {
    x: ((a % 1000) / 1000 - 0.5) * radius,
    y: ((b % 1000) / 1000 - 0.5) * radius
  }
}
