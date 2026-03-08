type LogLevel = "debug" | "info" | "warn" | "error"

type JsonPrimitive = string | number | boolean | null

type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

type LogFields = Record<string, unknown>

type LogEntry = {
  timestamp: string
  level: LogLevel
  scope: string
  event: string
} & Record<string, JsonValue>

type LogSink = (entry: LogEntry) => void

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function resolveLogLevel(rawLevel?: string): LogLevel {
  const normalized = normalizeText(rawLevel)?.toLowerCase()
  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized
  }
  return "info"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function sanitizeLogValue(value: unknown, depth = 0): JsonValue {
  if (depth >= 4) {
    return "[max-depth]"
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }

  if (value instanceof Error) {
    const serialized: Record<string, JsonValue> = {
      name: value.name,
      message: value.message
    }
    if (normalizeText((value as Error & { code?: unknown }).code)) {
      serialized.code = String((value as Error & { code?: unknown }).code)
    }
    if (normalizeText(value.stack)) {
      serialized.stack = value.stack ?? ""
    }
    return serialized
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogValue(item, depth + 1))
  }

  if (isRecord(value)) {
    const serialized: Record<string, JsonValue> = {}
    for (const [key, childValue] of Object.entries(value)) {
      if (childValue === undefined) {
        continue
      }
      serialized[key] = sanitizeLogValue(childValue, depth + 1)
    }
    return serialized
  }

  return String(value)
}

function defaultSink(entry: LogEntry): void {
  const line = JSON.stringify(entry)
  if (entry.level === "error") {
    console.error(line)
    return
  }
  if (entry.level === "warn") {
    console.warn(line)
    return
  }
  console.log(line)
}

export interface Logger {
  child(bindings: LogFields): Logger
  debug(event: string, fields?: LogFields): void
  info(event: string, fields?: LogFields): void
  warn(event: string, fields?: LogFields): void
  error(event: string, fields?: LogFields): void
}

interface CreateLoggerOptions {
  level?: LogLevel
  sink?: LogSink
  bindings?: LogFields
}

class StructuredLogger implements Logger {
  constructor(
    private readonly scope: string,
    private readonly level: LogLevel,
    private readonly sink: LogSink,
    private readonly bindings: LogFields = {}
  ) {}

  child(bindings: LogFields): Logger {
    return new StructuredLogger(this.scope, this.level, this.sink, {
      ...this.bindings,
      ...bindings
    })
  }

  debug(event: string, fields?: LogFields): void {
    this.write("debug", event, fields)
  }

  info(event: string, fields?: LogFields): void {
    this.write("info", event, fields)
  }

  warn(event: string, fields?: LogFields): void {
    this.write("warn", event, fields)
  }

  error(event: string, fields?: LogFields): void {
    this.write("error", event, fields)
  }

  private write(level: LogLevel, event: string, fields?: LogFields): void {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      event
    }

    const mergedFields = {
      ...this.bindings,
      ...fields
    }

    for (const [key, value] of Object.entries(mergedFields)) {
      if (value === undefined) {
        continue
      }
      entry[key] = sanitizeLogValue(value)
    }

    this.sink(entry)
  }
}

export function createLogger(scope: string, options: CreateLoggerOptions = {}): Logger {
  return new StructuredLogger(
    scope,
    options.level ?? resolveLogLevel(process.env.LOG_LEVEL),
    options.sink ?? defaultSink,
    options.bindings
  )
}

