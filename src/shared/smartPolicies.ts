export const defaultSmartPolicies: ISmartPolicy[] = [
  {
    id: 'preset-openai',
    name: 'OpenAI',
    enabled: true,
    category: 'ai',
    groupName: 'AI - OpenAI',
    groupType: 'smart',
    matchRules: [
      'DOMAIN-SUFFIX,openai.com',
      'DOMAIN-SUFFIX,chatgpt.com',
      'DOMAIN-SUFFIX,oaistatic.com',
      'DOMAIN-SUFFIX,oaiusercontent.com'
    ],
    includeFilter: '日本|新加坡|美国|台湾|JP|SG|US|TW',
    excludeFilter: '香港|HK',
    useAllProxies: true,
    strategy: 'sticky-sessions',
    collectData: false
  },
  {
    id: 'preset-claude',
    name: 'Claude',
    enabled: true,
    category: 'ai',
    groupName: 'AI - Claude',
    groupType: 'smart',
    matchRules: ['DOMAIN-SUFFIX,claude.ai', 'DOMAIN-SUFFIX,anthropic.com'],
    includeFilter: '日本|新加坡|美国|JP|SG|US',
    useAllProxies: true,
    strategy: 'sticky-sessions',
    collectData: false
  },
  {
    id: 'preset-finance',
    name: 'Finance',
    enabled: true,
    category: 'finance',
    groupName: 'Finance - Stable',
    groupType: 'smart',
    matchRules: ['GEOSITE,category-finance'],
    includeFilter: '台湾|新加坡|日本|TW|SG|JP',
    excludeFilter: '香港|HK',
    useAllProxies: true,
    strategy: 'sticky-sessions',
    collectData: false
  }
]

export function normalizeSmartPolicyPresets(policies: ISmartPolicy[]): ISmartPolicy[] {
  return policies.map((policy) => {
    const isFinancePreset =
      policy.id === 'preset-finance' ||
      (policy.category === 'finance' && policy.groupName === 'Finance - Stable')
    if (!isFinancePreset || !Array.isArray(policy.matchRules)) return policy

    return {
      ...policy,
      matchRules: policy.matchRules.map((rule) =>
        rule.trim().toUpperCase() === 'GEOSITE,BANKING' ? 'GEOSITE,category-finance' : rule
      )
    }
  })
}

export function cloneDefaultSmartPolicies(): ISmartPolicy[] {
  return normalizeSmartPolicyPresets(structuredClone(defaultSmartPolicies))
}
