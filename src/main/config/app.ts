import { readFile, writeFile } from 'fs/promises'
import { appConfigPath } from '../utils/dirs'
import { parse, stringify } from '../utils/yaml'
import { deepMerge } from '../utils/merge'
import { defaultConfig } from '../utils/template'
import { normalizeMaxLogFileSizeMB, setGlobalMaxLogFileSizeMB } from '../utils/logFile'
import { cloneDefaultSmartPolicies } from '../../shared/smartPolicies'

let appConfig: IAppConfig // config.yaml
let appConfigWriteQueue: Promise<void> = Promise.resolve()

function cloneDefaultConfig(): IAppConfig {
  return JSON.parse(JSON.stringify(defaultConfig)) as IAppConfig
}

function migrateAppConfig(data: unknown): Partial<IAppConfig> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {}
  }

  const config = { ...(data as Partial<IAppConfig>) }
  if (!config.smartOverrideMode) {
    config.smartOverrideMode = config.enableSmartOverride === false ? 'off' : 'compat'
  }
  if (!Array.isArray(config.smartPolicies)) {
    config.smartPolicies = cloneDefaultSmartPolicies()
  }
  return config
}

export async function getAppConfig(force = false): Promise<IAppConfig> {
  if (force || !appConfig) {
    appConfigWriteQueue = appConfigWriteQueue.then(async () => {
      const data = await readFile(appConfigPath(), 'utf-8')
      const parsedConfig = migrateAppConfig(parse(data))
      const mergedConfig = deepMerge(cloneDefaultConfig(), parsedConfig || {})
      mergedConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      if (JSON.stringify(mergedConfig) !== JSON.stringify(parsedConfig)) {
        await writeFile(appConfigPath(), stringify(mergedConfig))
      }
      setGlobalMaxLogFileSizeMB(mergedConfig.maxLogFileSize)
      appConfig = mergedConfig
    })
    await appConfigWriteQueue
  }
  if (typeof appConfig !== 'object') appConfig = defaultConfig
  return appConfig
}

export async function patchAppConfig(patch: Partial<IAppConfig>): Promise<void> {
  appConfigWriteQueue = appConfigWriteQueue.then(async () => {
    const replaceNameserverPolicy = Object.prototype.hasOwnProperty.call(patch, 'nameserverPolicy')
    appConfig = deepMerge(appConfig, patch)
    if (replaceNameserverPolicy) {
      appConfig.nameserverPolicy = patch.nameserverPolicy ?? {}
    }
    appConfig.maxLogFileSize = normalizeMaxLogFileSizeMB(appConfig.maxLogFileSize)
    setGlobalMaxLogFileSizeMB(appConfig.maxLogFileSize)
    await writeFile(appConfigPath(), stringify(appConfig))
  })
  await appConfigWriteQueue
}
