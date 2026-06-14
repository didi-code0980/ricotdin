// Pure helpers for app-config validation and parsing.
// No I/O — fully unit-testable in isolation.

export type ConfigValue = boolean | number | string | null

export function isValidConfigValue(value: unknown): value is ConfigValue {
  if (value === null) return true
  const t = typeof value
  return t === 'boolean' || t === 'number' || t === 'string'
}

export function configValueType(v: ConfigValue): 'boolean' | 'number' | 'string' | 'null' {
  if (v === null)            return 'null'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number')  return 'number'
  return 'string'
}

export function parseConfigInput(
  input: string,
  type: 'boolean' | 'number' | 'string' | 'null',
): ConfigValue {
  switch (type) {
    case 'boolean': return input === 'true'
    case 'number':  return parseFloat(input)
    case 'string':  return input
    case 'null':    return null
  }
}
