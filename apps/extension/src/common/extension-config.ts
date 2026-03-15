import { DEFAULT_API_BASE_URL } from "@threadatlas/shared"

declare const __THREADATLAS_API_BASE_URL__: string
declare const __THREADATLAS_GOOGLE_OAUTH_CLIENT_ID__: string

const API_BASE_URL_KEY = "THREADATLAS_API_BASE_URL"
const GOOGLE_OAUTH_CLIENT_ID_KEY = "THREADATLAS_GOOGLE_OAUTH_CLIENT_ID"
const AUTH_GRANT_TYPE_KEY = "THREADATLAS_AUTH_GRANT_TYPE"
const BOOTSTRAP_SUBJECT_KEY = "THREADATLAS_BOOTSTRAP_SUBJECT"
const BOOTSTRAP_KEY_KEY = "THREADATLAS_AUTH_BOOTSTRAP_KEY"
const DISPLAY_NAME_KEY = "THREADATLAS_AUTH_DISPLAY_NAME"
const PRIMARY_EMAIL_KEY = "THREADATLAS_AUTH_PRIMARY_EMAIL"
const AVATAR_URL_KEY = "THREADATLAS_AUTH_AVATAR_URL"

export interface KeyValueStorage {
  get(keys: string[]): Promise<Record<string, unknown>>
  set(values: Record<string, unknown>): Promise<void>
  remove(keys: string[]): Promise<void>
}

export interface ExtensionConfig {
  apiBaseUrl: string
  googleOAuthClientId: string | null
  devBootstrap:
    | {
        bootstrapSubject: string
        bootstrapKey: string
        profile?: {
          displayName?: string
          primaryEmail?: string
          avatarUrl?: string
        }
      }
    | null
}

export const EXTENSION_CONFIG_KEYS = [
  API_BASE_URL_KEY,
  GOOGLE_OAUTH_CLIENT_ID_KEY,
  AUTH_GRANT_TYPE_KEY,
  BOOTSTRAP_SUBJECT_KEY,
  BOOTSTRAP_KEY_KEY,
  DISPLAY_NAME_KEY,
  PRIMARY_EMAIL_KEY,
  AVATAR_URL_KEY
]

function normalizeText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function readCompiledApiBaseUrl(): string {
  if (typeof __THREADATLAS_API_BASE_URL__ === "string") {
    const normalized = normalizeText(__THREADATLAS_API_BASE_URL__)
    if (normalized) {
      return normalized
    }
  }
  return DEFAULT_API_BASE_URL
}

function readCompiledGoogleClientId(): string | null {
  if (typeof __THREADATLAS_GOOGLE_OAUTH_CLIENT_ID__ === "string") {
    return normalizeText(__THREADATLAS_GOOGLE_OAUTH_CLIENT_ID__)
  }
  return null
}

export function createChromeLocalStorage(area = chrome.storage.local): KeyValueStorage {
  return {
    get(keys) {
      return new Promise((resolve, reject) => {
        area.get(keys, (items) => {
          const runtimeError = chrome.runtime.lastError
          if (runtimeError) {
            reject(new Error(runtimeError.message))
            return
          }
          resolve(items)
        })
      })
    },
    set(values) {
      return new Promise((resolve, reject) => {
        area.set(values, () => {
          const runtimeError = chrome.runtime.lastError
          if (runtimeError) {
            reject(new Error(runtimeError.message))
            return
          }
          resolve()
        })
      })
    },
    remove(keys) {
      return new Promise((resolve, reject) => {
        area.remove(keys, () => {
          const runtimeError = chrome.runtime.lastError
          if (runtimeError) {
            reject(new Error(runtimeError.message))
            return
          }
          resolve()
        })
      })
    }
  }
}

export async function loadExtensionConfig(
  storage: KeyValueStorage = createChromeLocalStorage()
): Promise<ExtensionConfig> {
  const stored = await storage.get(EXTENSION_CONFIG_KEYS)

  const apiBaseUrl = normalizeText(stored[API_BASE_URL_KEY]) ?? readCompiledApiBaseUrl()
  const googleOAuthClientId =
    normalizeText(stored[GOOGLE_OAUTH_CLIENT_ID_KEY]) ?? readCompiledGoogleClientId()
  const configuredGrant = normalizeText(stored[AUTH_GRANT_TYPE_KEY])
  const bootstrapSubject = normalizeText(stored[BOOTSTRAP_SUBJECT_KEY])
  const bootstrapKey = normalizeText(stored[BOOTSTRAP_KEY_KEY])

  let devBootstrap: ExtensionConfig["devBootstrap"] = null
  if (configuredGrant === "dev-bootstrap" && bootstrapSubject && bootstrapKey) {
    const profile: NonNullable<NonNullable<ExtensionConfig["devBootstrap"]>["profile"]> = {}
    const displayName = normalizeText(stored[DISPLAY_NAME_KEY])
    const primaryEmail = normalizeText(stored[PRIMARY_EMAIL_KEY])
    const avatarUrl = normalizeText(stored[AVATAR_URL_KEY])
    if (displayName) {
      profile.displayName = displayName
    }
    if (primaryEmail) {
      profile.primaryEmail = primaryEmail
    }
    if (avatarUrl) {
      profile.avatarUrl = avatarUrl
    }

    devBootstrap = {
      bootstrapSubject,
      bootstrapKey,
      ...(Object.keys(profile).length > 0 ? { profile } : {})
    }
  }

  return {
    apiBaseUrl,
    googleOAuthClientId,
    devBootstrap
  }
}
