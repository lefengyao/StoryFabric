import type { ToolDefJson } from '../../shared/types'

type JsonRecord = Record<string, unknown>

export class ToolArgumentError extends Error {
  readonly code = 'INVALID_ARGUMENT'

  constructor(message: string, readonly details?: JsonRecord) {
    super(message)
    this.name = 'ToolArgumentError'
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function matchesType(value: unknown, expected: string): boolean {
  if (expected === 'object') return isRecord(value)
  if (expected === 'array') return Array.isArray(value)
  if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (expected === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (expected === 'string') return typeof value === 'string'
  if (expected === 'boolean') return typeof value === 'boolean'
  if (expected === 'null') return value === null
  return true
}

function formatPath(path: string): string {
  return path || '参数'
}

function validateSchema(schemaValue: unknown, value: unknown, path: string): void {
  const schema = schemaRecord(schemaValue)
  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : null
  if (anyOf) {
    const valid = anyOf.some((candidate) => {
      try {
        validateSchema(candidate, value, path)
        return true
      } catch {
        return false
      }
    })
    if (!valid) throw new ToolArgumentError(`${formatPath(path)}不满足任一允许的格式`)
    return
  }

  if (typeof schema.type === 'string' && !matchesType(value, schema.type)) {
    throw new ToolArgumentError(`${formatPath(path)}必须是 ${schema.type}，实际为 ${valueType(value)}`)
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    throw new ToolArgumentError(`${formatPath(path)}不在允许值范围内`)
  }

  if (typeof value === 'string') {
    const minLength = typeof schema.minLength === 'number' ? schema.minLength : 0
    if (value.length < minLength) throw new ToolArgumentError(`${formatPath(path)}不能为空`)
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      throw new ToolArgumentError(`${formatPath(path)}不能小于 ${schema.minimum}`)
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      throw new ToolArgumentError(`${formatPath(path)}不能大于 ${schema.maximum}`)
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      throw new ToolArgumentError(`${formatPath(path)}最多允许 ${schema.maxItems} 项`)
    }
    const items = schema.items
    if (items !== undefined) value.forEach((item, index) => validateSchema(items, item, `${path}[${index}]`))
  }

  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = Array.isArray(schema.required)
      ? schema.required.filter((item): item is string => typeof item === 'string')
      : []
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
        throw new ToolArgumentError(`缺少必填参数：${path ? `${path}.` : ''}${key}`)
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateSchema(properties[key], item, path ? `${path}.${key}` : key)
      } else if (schema.additionalProperties === false) {
        throw new ToolArgumentError(`${formatPath(path)}不接受字段：${key}`)
      }
    }
  }
}

/** Parse tool arguments without silently converting malformed JSON into an empty object. */
export function parseToolArguments(argsJson: string): JsonRecord {
  if (typeof argsJson !== 'string') throw new ToolArgumentError('工具参数必须是 JSON 字符串')
  const source = argsJson.trim()
  if (!source) throw new ToolArgumentError('工具参数不能为空，必须提供 JSON 对象')

  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    throw new ToolArgumentError('工具参数不是有效 JSON')
  }
  if (!isRecord(parsed)) throw new ToolArgumentError(`工具参数必须是 JSON 对象，实际为 ${valueType(parsed)}`)
  return parsed
}

export function validateToolArguments(definition: ToolDefJson, value: JsonRecord): void {
  validateSchema(definition.parameters, value, '')
}
