import * as protobuf from 'protobufjs'

export interface JsonTemplateValues {
  deviceId: string
  clientId: string
  timestamp: string
}

export interface ProtoFieldDescriptor {
  name: string
  id: number
  type: string
  messageTypeName?: string
  repeated: boolean
  required: boolean
  kind: 'scalar' | 'enum' | 'message'
  enumValues?: string[]
  defaultValue: unknown
  schemaDefault?: unknown
}

const tokenPattern = /\{\{\s*([^{}]+?)\s*\}\}/g
const intPattern = /^randomInt\s*:\s*(-?\d+)\s*:\s*(-?\d+)$/
const floatPattern = /^randomFloat\s*:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*:\s*(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)$/i

export function resolveJsonTemplate(template: string, values: JsonTemplateValues): unknown {
  const resolved = template.replace(tokenPattern, (token, body: string, offset: number) => {
    const key = body.trim()
    const inString = isInsideString(template, offset)
    const integer = key.match(intPattern)
    if (integer) {
      if (inString) throw new Error(`${token} 是数值占位符，请移除它周围的引号。`)
      const minimum = Number(integer[1])
      const maximum = Number(integer[2])
      if (!Number.isSafeInteger(minimum) || !Number.isSafeInteger(maximum) || minimum > maximum) {
        throw new Error(`${token} 的范围无效。`)
      }
      return String(Math.floor(Math.random() * (maximum - minimum + 1)) + minimum)
    }

    const float = key.match(floatPattern)
    if (float) {
      if (inString) throw new Error(`${token} 是数值占位符，请移除它周围的引号。`)
      const minimum = Number(float[1])
      const maximum = Number(float[2])
      if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum > maximum) {
        throw new Error(`${token} 的范围无效。`)
      }
      return String(sampleInclusiveFloat(minimum, maximum))
    }

    const value = values[key as keyof JsonTemplateValues]
    if (value === undefined) throw new Error(`未知的模板变量：${key}`)
    return inString ? escapeStringContent(value) : JSON.stringify(value)
  })

  if (/\{\{[^{}]*\}\}/.test(resolved)) {
    throw new Error('存在未识别或格式错误的模板变量。')
  }
  try {
    return JSON.parse(resolved) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'JSON 格式不正确。'
    throw new Error(`JSON 模板解析失败：${detail}`)
  }
}

function isInsideString(source: string, offset: number): boolean {
  let inString = false
  let escaped = false
  for (let index = 0; index < offset; index += 1) {
    const character = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' && inString) {
      escaped = true
      continue
    }
    if (character === '"') inString = !inString
  }
  return inString
}

function escapeStringContent(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
}

export function parseProtoSchema(source: string): protobuf.Root {
  const parsed = protobuf.parse(source, { keepCase: true })
  parsed.root.resolveAll()
  return parsed.root
}

export function listProtoMessageTypes(root: protobuf.Root): string[] {
  const messages: string[] = []
  root.nestedArray.forEach((nested) => collectMessageTypes(nested, '', messages))
  return messages
}

function collectMessageTypes(nested: protobuf.ReflectionObject, parent: string, output: string[]) {
  if (nested instanceof protobuf.Type) {
    const fullName = parent ? `${parent}.${nested.name}` : nested.name
    output.push(fullName)
    nested.nestedArray.forEach((child) => collectMessageTypes(child, fullName, output))
    return
  }
  if (nested instanceof protobuf.Namespace) {
    const fullName = parent ? `${parent}.${nested.name}` : nested.name
    nested.nestedArray.forEach((child) => collectMessageTypes(child, fullName, output))
  }
}

export function getMessageFields(root: protobuf.Root, typeName: string): ProtoFieldDescriptor[] {
  const type = root.lookupType(typeName)
  return type.fieldsArray.map((field) => {
    const resolvedType = field.resolvedType
    const kind: ProtoFieldDescriptor['kind'] = resolvedType instanceof protobuf.Enum
      ? 'enum'
      : resolvedType instanceof protobuf.Type
        ? 'message'
        : 'scalar'
    const enumValues = resolvedType instanceof protobuf.Enum
      ? Object.keys(resolvedType.values).sort((left, right) => resolvedType.values[left]! - resolvedType.values[right]!)
      : undefined
    return {
      name: field.name,
      id: field.id,
      type: field.type,
      messageTypeName: resolvedType instanceof protobuf.Type ? resolvedType.fullName.replace(/^\./, '') : undefined,
      repeated: field.repeated,
      required: field.required,
      kind,
      enumValues,
      defaultValue: field.defaultValue,
      schemaDefault: (field.options as Record<string, unknown> | undefined)?.default,
    }
  })
}

export function fillEmptyProtoValues(
  root: protobuf.Root,
  typeName: string,
  currentValue: Record<string, unknown>,
): Record<string, unknown> {
  return fillMessage(root, typeName, currentValue, new Set<string>(), 0)
}

function fillMessage(
  root: protobuf.Root,
  typeName: string,
  currentValue: Record<string, unknown>,
  ancestors: Set<string>,
  depth: number,
): Record<string, unknown> {
  const type = root.lookupType(typeName)
  const result = { ...currentValue }
  if (depth >= 8 || ancestors.has(type.fullName)) return result

  const nextAncestors = new Set(ancestors)
  nextAncestors.add(type.fullName)

  for (const field of getMessageFields(root, type.fullName.replace(/^\./, ''))) {
    const current = result[field.name]
    const empty = isEmptyProtoValue(current)

    if (field.kind === 'message' && field.messageTypeName) {
      if (field.repeated) {
        if (empty) {
          result[field.name] = [sampleMessage(root, field.messageTypeName, field.schemaDefault, nextAncestors, depth + 1)]
        } else if (Array.isArray(current)) {
          result[field.name] = current.map((item) => isRecord(item)
            ? fillMessage(root, field.messageTypeName!, item, nextAncestors, depth + 1)
            : item)
        }
      } else if (empty) {
        result[field.name] = sampleMessage(root, field.messageTypeName, field.schemaDefault, nextAncestors, depth + 1)
      } else if (isRecord(current)) {
        result[field.name] = fillMessage(root, field.messageTypeName, current, nextAncestors, depth + 1)
      }
      continue
    }

    if (empty) {
      const sample = sampleFieldValue(field)
      result[field.name] = field.repeated ? [sample] : sample
    }
  }

  return result
}

function sampleMessage(
  root: protobuf.Root,
  typeName: string,
  schemaDefault: unknown,
  ancestors: Set<string>,
  depth: number,
): Record<string, unknown> {
  if (isRecord(schemaDefault)) return { ...schemaDefault }
  if (depth >= 8 || ancestors.has(`.${typeName}`)) return {}
  return fillMessage(root, typeName, {}, ancestors, depth)
}

function sampleFieldValue(field: ProtoFieldDescriptor): unknown {
  if (field.schemaDefault !== undefined && field.schemaDefault !== null) return field.schemaDefault
  if (field.kind === 'enum') return field.enumValues?.[0] ?? ''
  if (field.type === 'string') return `example_${field.name}`
  if (field.type === 'bool') return false
  if (field.type === 'bytes') return '01 02 03'
  if (['float', 'double'].includes(field.type)) return 1.25
  return 1
}

function isEmptyProtoValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim().length === 0
  if (Array.isArray(value)) return value.length === 0
  return isRecord(value) && Object.keys(value).length === 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function encodeProtoMessage(root: protobuf.Root, typeName: string, value: unknown): Uint8Array {
  const type = root.lookupType(typeName)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Protobuf 消息值必须是对象。')
  }
  const messageValue = value as Record<string, unknown>
  const normalized = normalizeEnumValues(type, messageValue)
  const message = type.fromObject(normalized)
  const error = type.verify(message)
  if (error) throw new Error(`Protobuf 数据校验失败：${error}`)
  return type.encode(message).finish()
}

function normalizeEnumValues(type: protobuf.Type, value: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...value }
  for (const field of type.fieldsArray) {
    const fieldValue = normalized[field.name]
    if (fieldValue === undefined || fieldValue === null || !field.resolvedType) continue
    if (field.resolvedType instanceof protobuf.Enum) {
      const enumValues = field.resolvedType.values
      const normalize = (item: unknown) => {
        if (typeof item !== 'string') return item
        const enumValue = enumValues[item]
        if (enumValue === undefined) throw new Error(`Protobuf 枚举字段 ${field.name} 不包含值 ${item}。`)
        return enumValue
      }
      normalized[field.name] = field.repeated && Array.isArray(fieldValue)
        ? fieldValue.map(normalize)
        : normalize(fieldValue)
    } else if (field.resolvedType instanceof protobuf.Type) {
      const normalizeMessage = (item: unknown) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
          throw new Error(`Protobuf 嵌套字段 ${field.name} 必须是对象。`)
        }
        return normalizeEnumValues(field.resolvedType as protobuf.Type, item as Record<string, unknown>)
      }
      normalized[field.name] = field.repeated && Array.isArray(fieldValue)
        ? fieldValue.map(normalizeMessage)
        : normalizeMessage(fieldValue)
    }
  }
  return normalized
}

export function sampleInclusiveFloat(minimum: number, maximum: number): number {
  if (minimum === maximum) return minimum
  return Math.min(maximum, minimum + Math.random() * (maximum - minimum) / (1 - Number.EPSILON))
}

export function decodeProtoMessage(root: protobuf.Root, typeName: string, bytes: Uint8Array): unknown {
  const type = root.lookupType(typeName)
  const decoded = type.decode(bytes)
  return type.toObject(decoded, {
    arrays: true,
    defaults: true,
    enums: String,
    longs: String,
    objects: true,
    bytes: String,
  })
}

export function bytesFromHex(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, '')
  if (normalized.length % 2 !== 0 || !/^[\da-f]*$/i.test(normalized)) {
    throw new Error('Hex 数据必须是偶数长度的十六进制字符。')
  }
  return Uint8Array.from(normalized.match(/.{2}/g)?.map((part) => Number.parseInt(part, 16)) ?? [])
}

export function formatHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(' ')
}
