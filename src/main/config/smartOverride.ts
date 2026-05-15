import { overrideLogger } from '../utils/logger'
import { getAppConfig } from './app'
import { addOverrideItem, removeOverrideItem, getOverrideItem } from './override'

const SMART_OVERRIDE_ID = 'smart-core-override'

interface SmartOverrideBuildConfig {
  mode: SmartOverrideMode
  useLightGBM: boolean
  collectData: boolean
  strategy: SmartPolicyStrategy
  collectorSize: number
  policies: ISmartPolicy[]
}

function js(value: unknown): string {
  return JSON.stringify(value)
}

function getMode(config: IAppConfig): SmartOverrideMode {
  if (config.smartOverrideMode) return config.smartOverrideMode
  return config.enableSmartOverride === false ? 'off' : 'compat'
}

function normalizePolicy(policy: ISmartPolicy, defaults: SmartOverrideBuildConfig): ISmartPolicy {
  return {
    ...policy,
    enabled: policy.enabled !== false,
    category: policy.category || 'custom',
    groupType: policy.groupType || 'smart',
    matchRules: Array.isArray(policy.matchRules) ? policy.matchRules.filter(Boolean) : [],
    useAllProxies: policy.useAllProxies !== false,
    strategy: policy.strategy || defaults.strategy,
    useLightGBM: policy.useLightGBM ?? defaults.useLightGBM,
    collectData: policy.collectData ?? defaults.collectData,
    interval: policy.interval || 300
  }
}

export function normalizeSmartPolicies(
  globalPolicies: ISmartPolicy[] = [],
  override?: ISmartPolicyOverride,
  defaults?: SmartOverrideBuildConfig
): ISmartPolicy[] {
  const baseDefaults =
    defaults ||
    ({
      mode: 'policy-aware',
      useLightGBM: false,
      collectData: false,
      strategy: 'sticky-sessions',
      collectorSize: 100,
      policies: []
    } as SmartOverrideBuildConfig)
  const normalizedGlobal = globalPolicies.map((policy) => normalizePolicy(policy, baseDefaults))
  const overridePolicies = (override?.policies || []).map((policy) =>
    normalizePolicy(policy, baseDefaults)
  )

  switch (override?.mode) {
    case 'off':
      return []
    case 'replace':
      return overridePolicies
    case 'append':
      return [...normalizedGlobal, ...overridePolicies]
    case 'inherit':
    default:
      return normalizedGlobal
  }
}

function buildCompatOverride(config: SmartOverrideBuildConfig): string {
  return `
function main(config) {
  try {
    if (!config || typeof config !== 'object') return config
    if (!config.profile) config.profile = {}
    config.profile['smart-collector-size'] = ${config.collectorSize}
    if (!Array.isArray(config['proxy-groups'])) config['proxy-groups'] = []

    let hasUrlTestOrLoadBalance = false
    for (const group of config['proxy-groups']) {
      const type = String(group && group.type || '').toLowerCase()
      if (type === 'url-test' || type === 'load-balance') {
        hasUrlTestOrLoadBalance = true
        break
      }
    }

    if (hasUrlTestOrLoadBalance) {
      const nameMapping = new Map()
      for (const group of config['proxy-groups']) {
        const type = String(group && group.type || '').toLowerCase()
        if (type !== 'url-test' && type !== 'load-balance') continue
        const originalName = group.name
        group.type = 'smart'
        if (group.name && !group.name.includes('(Smart Group)')) {
          group.name = group.name + '(Smart Group)'
          nameMapping.set(originalName, group.name)
        }
        group['policy-priority'] = group['policy-priority'] || ''
        group.uselightgbm = ${config.useLightGBM}
        group.collectdata = ${config.collectData}
        group.strategy = '${config.strategy}'
        delete group.url
        delete group.interval
        delete group.tolerance
        delete group.lazy
        delete group['expected-status']
      }

      if (nameMapping.size > 0) {
        for (const group of config['proxy-groups']) {
          if (Array.isArray(group && group.proxies)) {
            group.proxies = group.proxies.map((name) => nameMapping.get(name) || name)
          }
        }
        if (Array.isArray(config.rules)) {
          const ruleParams = new Set(['no-resolve', 'force-remote-dns', 'prefer-ipv6'])
          config.rules = config.rules.map((rule) => {
            if (typeof rule !== 'string') return rule
            const parts = rule.split(',').map((part) => part.trim())
            let targetIndex = -1
            if (parts[0] === 'MATCH' && parts.length === 2) {
              targetIndex = 1
            } else if (parts.length >= 3) {
              for (let i = 2; i < parts.length; i++) {
                if (!ruleParams.has(parts[i])) {
                  targetIndex = i
                  break
                }
              }
            }
            if (targetIndex !== -1 && targetIndex < parts.length && nameMapping.has(parts[targetIndex])) {
              parts[targetIndex] = nameMapping.get(parts[targetIndex])
              return parts.join(',')
            }
            return rule
          })
        }
      }
      return config
    }

    let smartGroupExists = false
    for (const group of config['proxy-groups']) {
      if (group && group.type === 'smart') {
        smartGroupExists = true
        group['policy-priority'] = group['policy-priority'] || ''
        group.uselightgbm = ${config.useLightGBM}
        group.collectdata = ${config.collectData}
        group.strategy = '${config.strategy}'
        break
      }
    }

    if (!smartGroupExists && Array.isArray(config.proxies)) {
      const proxyNames = config.proxies.filter((proxy) => proxy && proxy.name).map((proxy) => proxy.name)
      if (proxyNames.length > 0) {
        config['proxy-groups'].unshift({
          name: 'Smart Group',
          type: 'smart',
          'policy-priority': '',
          uselightgbm: ${config.useLightGBM},
          collectdata: ${config.collectData},
          strategy: '${config.strategy}',
          proxies: proxyNames
        })
      }
    }

    if (Array.isArray(config.rules)) {
      const proxyGroupNames = new Set(config['proxy-groups'].filter((group) => group && group.name).map((group) => group.name))
      const builtinTargets = new Set(['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'])
      const ruleParams = new Set(['no-resolve', 'force-remote-dns', 'prefer-ipv6'])
      config.rules = config.rules.map((rule) => {
        if (typeof rule !== 'string' || rule.includes('((') || rule.includes('))')) return rule
        const parts = rule.split(',').map((part) => part.trim())
        let targetIndex = -1
        if (parts[0] === 'MATCH' && parts.length === 2) targetIndex = 1
        else if (parts.length >= 3) {
          for (let i = 2; i < parts.length; i++) {
            if (!ruleParams.has(parts[i])) {
              targetIndex = i
              break
            }
          }
        }
        if (targetIndex === -1) return rule
        const target = parts[targetIndex]
        if (!builtinTargets.has(target) && (proxyGroupNames.has(target) || !ruleParams.has(target))) {
          parts[targetIndex] = 'Smart Group'
          return parts.join(',')
        }
        return rule
      })
    }

    return config
  } catch (error) {
    console.error('[Smart Override] compat mode failed:', error)
    return config
  }
}
`
}

function buildRespectRulesOverride(config: SmartOverrideBuildConfig): string {
  return `
function main(config) {
  try {
    if (!config || typeof config !== 'object') return config
    if (!config.profile) config.profile = {}
    config.profile['smart-collector-size'] = ${config.collectorSize}
    if (!Array.isArray(config['proxy-groups'])) return config
    for (const group of config['proxy-groups']) {
      if (!group || group.type !== 'smart') continue
      group['policy-priority'] = group['policy-priority'] || ''
      group.uselightgbm = ${config.useLightGBM}
      group.collectdata = ${config.collectData}
      group.strategy = group.strategy || '${config.strategy}'
    }
    return config
  } catch (error) {
    console.error('[Smart Override] respect-rules mode failed:', error)
    return config
  }
}
`
}

function buildPolicyAwareOverride(config: SmartOverrideBuildConfig): string {
  const enabledPolicies = config.policies
    .map((policy) => normalizePolicy(policy, config))
    .filter((policy) => policy.enabled && policy.groupName && policy.matchRules.length > 0)

  return `
const smartPolicies = ${js(enabledPolicies)}

function uniqueGroupName(baseName, usedNames) {
  if (!usedNames.has(baseName)) {
    usedNames.add(baseName)
    return baseName
  }
  let candidate = baseName + ' (Smart Policy)'
  let index = 2
  while (usedNames.has(candidate)) {
    candidate = baseName + ' (Smart Policy ' + index + ')'
    index++
  }
  usedNames.add(candidate)
  console.log('[Smart Override] Renamed duplicated policy group:', baseName, '->', candidate)
  return candidate
}

function policyToGroup(policy, groupName, config) {
  const group = {
    name: groupName,
    type: policy.groupType || 'smart'
  }
  if (policy.includeFilter) group.filter = policy.includeFilter
  if (policy.excludeFilter) group['exclude-filter'] = policy.excludeFilter
  if (Array.isArray(policy.useProviders) && policy.useProviders.length > 0) group.use = policy.useProviders

  if (policy.useAllProxies !== false) {
    group['include-all-proxies'] = true
  } else if (!group.use && Array.isArray(config.proxies)) {
    group.proxies = config.proxies.filter((proxy) => proxy && proxy.name).map((proxy) => proxy.name)
  }

  if (group.type === 'smart') {
    group.strategy = policy.strategy || '${config.strategy}'
    group.uselightgbm = policy.useLightGBM ?? ${config.useLightGBM}
    group.collectdata = policy.collectData ?? ${config.collectData}
    group['policy-priority'] = policy.policyPriority || ''
  } else {
    group.url = policy.testUrl || 'http://www.gstatic.com/generate_204'
    group.interval = policy.interval || 300
  }

  return group
}

function policyRuleToTargetedRule(rule, groupName) {
  const parts = String(rule).split(',').map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts[0] === 'MATCH') return 'MATCH,' + groupName
  if (parts.length >= 3) {
    parts[2] = groupName
    return parts.join(',')
  }
  return parts.concat(groupName).join(',')
}

function main(config) {
  try {
    if (!config || typeof config !== 'object') return config
    if (!config.profile) config.profile = {}
    config.profile['smart-collector-size'] = ${config.collectorSize}
    if (!Array.isArray(config['proxy-groups'])) config['proxy-groups'] = []
    if (!Array.isArray(config.rules)) config.rules = []

    const usedNames = new Set(config['proxy-groups'].filter((group) => group && group.name).map((group) => group.name))
    const generatedGroups = []
    const generatedRules = []

    for (const policy of smartPolicies) {
      const groupName = uniqueGroupName(policy.groupName, usedNames)
      generatedGroups.push(policyToGroup(policy, groupName, config))
      for (const rule of policy.matchRules || []) {
        const targetedRule = policyRuleToTargetedRule(rule, groupName)
        if (targetedRule) generatedRules.push(targetedRule)
      }
    }

    config['proxy-groups'] = generatedGroups.concat(config['proxy-groups'])
    config.rules = generatedRules.concat(config.rules)
    console.log('[Smart Override] policy-aware mode generated', generatedGroups.length, 'groups and', generatedRules.length, 'rules')
    return config
  } catch (error) {
    console.error('[Smart Override] policy-aware mode failed:', error)
    return config
  }
}
`
}

export function buildSmartOverride(config: SmartOverrideBuildConfig): string {
  switch (config.mode) {
    case 'compat':
      return buildCompatOverride(config)
    case 'respect-rules':
      return buildRespectRulesOverride(config)
    case 'policy-aware':
      return buildPolicyAwareOverride(config)
    case 'off':
    default:
      return ''
  }
}

async function getCurrentProfileSmartPolicyOverride(): Promise<ISmartPolicyOverride | undefined> {
  const { getProfileConfig, getProfileItem } = await import('./profile')
  const { current } = await getProfileConfig()
  const item = await getProfileItem(current)
  return item?.smartPolicyOverride
}

export async function createSmartOverride(): Promise<void> {
  try {
    const appConfig = await getAppConfig()
    const {
      smartCoreUseLightGBM = false,
      smartCoreCollectData = false,
      smartCoreStrategy = 'sticky-sessions',
      smartCollectorSize = 100,
      smartPolicies = []
    } = appConfig
    const mode = getMode(appConfig)
    const profileOverride = await getCurrentProfileSmartPolicyOverride()
    const buildConfig: SmartOverrideBuildConfig = {
      mode,
      useLightGBM: smartCoreUseLightGBM,
      collectData: smartCoreCollectData,
      strategy: smartCoreStrategy,
      collectorSize: smartCollectorSize,
      policies: []
    }
    buildConfig.policies =
      mode === 'policy-aware'
        ? normalizeSmartPolicies(smartPolicies, profileOverride, buildConfig)
        : normalizeSmartPolicies(smartPolicies, undefined, buildConfig)
    const template = buildSmartOverride(buildConfig)
    if (!template) {
      await removeSmartOverride()
      return
    }

    await addOverrideItem({
      id: SMART_OVERRIDE_ID,
      name: 'Smart Core Override',
      type: 'local',
      ext: 'js',
      global: true,
      file: template
    })
  } catch (error) {
    await overrideLogger.error('Failed to create Smart override', error)
    throw error
  }
}

export async function removeSmartOverride(): Promise<void> {
  try {
    const existingOverride = await getOverrideItem(SMART_OVERRIDE_ID)
    if (existingOverride) {
      await removeOverrideItem(SMART_OVERRIDE_ID)
    }
  } catch (error) {
    await overrideLogger.error('Failed to remove Smart override', error)
    throw error
  }
}

export async function manageSmartOverride(): Promise<void> {
  const appConfig = await getAppConfig()
  const { enableSmartCore = true, core } = appConfig
  const mode = getMode(appConfig)

  if (enableSmartCore && mode !== 'off' && core === 'mihomo-smart') {
    await createSmartOverride()
  } else {
    await removeSmartOverride()
  }
}

export async function isSmartOverrideExists(): Promise<boolean> {
  try {
    const override = await getOverrideItem(SMART_OVERRIDE_ID)
    return !!override
  } catch {
    return false
  }
}
