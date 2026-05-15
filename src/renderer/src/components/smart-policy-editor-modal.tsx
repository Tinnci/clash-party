import {
  Button,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Textarea
} from '@heroui/react'
import React, { useMemo, useState } from 'react'
import { cloneDefaultSmartPolicies } from '../../../shared/smartPolicies'
import { toast } from './base/toast'

interface Props {
  title: string
  policies: ISmartPolicy[]
  overrideMode?: SmartPolicyOverrideMode
  profileMode?: boolean
  onClose: () => void
  onSave: (policies: ISmartPolicy[], overrideMode?: SmartPolicyOverrideMode) => Promise<void>
}

const emptyPolicy = (): ISmartPolicy => ({
  id: `custom-${Date.now()}`,
  name: 'Custom Policy',
  enabled: true,
  category: 'custom',
  groupName: 'Custom Smart',
  groupType: 'smart',
  matchRules: ['DOMAIN-SUFFIX,example.com'],
  useAllProxies: true,
  strategy: 'sticky-sessions',
  collectData: false
})

function clonePolicy(policy: ISmartPolicy): ISmartPolicy {
  return structuredClone(policy)
}

function validatePolicies(policies: ISmartPolicy[]): string | null {
  for (const policy of policies) {
    if (!policy.name.trim()) return 'Policy name is required'
    if (!policy.groupName.trim()) return 'Group name is required'
    if (!policy.matchRules.filter((rule) => rule.trim()).length) return 'Match rules are required'
    if (
      policy.interval !== undefined &&
      (!Number.isInteger(policy.interval) || policy.interval < 1)
    ) {
      return 'Interval must be a positive integer'
    }
  }
  return null
}

const SmartPolicyEditorModal: React.FC<Props> = ({
  title,
  policies,
  overrideMode = 'inherit',
  profileMode = false,
  onClose,
  onSave
}) => {
  const [draftPolicies, setDraftPolicies] = useState<ISmartPolicy[]>(() =>
    policies.length ? structuredClone(policies) : profileMode ? [] : cloneDefaultSmartPolicies()
  )
  const [draftOverrideMode, setDraftOverrideMode] = useState<SmartPolicyOverrideMode>(overrideMode)
  const [selectedId, setSelectedId] = useState(draftPolicies[0]?.id || '')
  const [draggingId, setDraggingId] = useState('')
  const [jsonText, setJsonText] = useState('')
  const [saving, setSaving] = useState(false)

  const selectedPolicy = useMemo(
    () => draftPolicies.find((policy) => policy.id === selectedId) || draftPolicies[0],
    [draftPolicies, selectedId]
  )

  const setSelectedPolicy = (patch: Partial<ISmartPolicy>): void => {
    if (!selectedPolicy) return
    setDraftPolicies((items) =>
      items.map((policy) => (policy.id === selectedPolicy.id ? { ...policy, ...patch } : policy))
    )
  }

  const addPolicy = (): void => {
    const policy = emptyPolicy()
    setDraftPolicies((items) => [...items, policy])
    setSelectedId(policy.id)
  }

  const duplicatePolicy = (): void => {
    if (!selectedPolicy) return
    const policy = {
      ...clonePolicy(selectedPolicy),
      id: `custom-${Date.now()}`,
      name: `${selectedPolicy.name} Copy`,
      groupName: `${selectedPolicy.groupName} Copy`
    }
    setDraftPolicies((items) => [...items, policy])
    setSelectedId(policy.id)
  }

  const deletePolicy = (): void => {
    if (!selectedPolicy) return
    const next = draftPolicies.filter((policy) => policy.id !== selectedPolicy.id)
    setDraftPolicies(next)
    setSelectedId(next[0]?.id || '')
  }

  const movePolicy = (sourceId: string, targetId: string): void => {
    if (!sourceId || sourceId === targetId) return
    setDraftPolicies((items) => {
      const sourceIndex = items.findIndex((policy) => policy.id === sourceId)
      const targetIndex = items.findIndex((policy) => policy.id === targetId)
      if (sourceIndex === -1 || targetIndex === -1) return items
      const next = [...items]
      const [source] = next.splice(sourceIndex, 1)
      next.splice(targetIndex, 0, source)
      return next
    })
  }

  const importJson = (): void => {
    try {
      const parsed = JSON.parse(jsonText)
      if (!Array.isArray(parsed)) throw new Error('JSON must be an array')
      const next = parsed as ISmartPolicy[]
      const error = validatePolicies(next)
      if (error) throw new Error(error)
      setDraftPolicies(next)
      setSelectedId(next[0]?.id || '')
    } catch (error) {
      toast.error(String(error))
    }
  }

  const exportJson = async (): Promise<void> => {
    const text = JSON.stringify(draftPolicies, null, 2)
    setJsonText(text)
    await navigator.clipboard?.writeText(text)
  }

  return (
    <Modal
      backdrop="blur"
      classNames={{ backdrop: 'top-[48px]', base: 'max-w-[1120px]' }}
      hideCloseButton
      isOpen={true}
      onOpenChange={onClose}
      scrollBehavior="inside"
      size="5xl"
    >
      <ModalContent>
        <ModalHeader className="app-drag">{title}</ModalHeader>
        <ModalBody>
          {profileMode && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-default-600">Profile override mode</span>
              <Select
                size="sm"
                className="w-[220px]"
                selectedKeys={new Set([draftOverrideMode])}
                disallowEmptySelection
                onSelectionChange={(keys) =>
                  setDraftOverrideMode(keys.currentKey as SmartPolicyOverrideMode)
                }
              >
                <SelectItem key="inherit">Inherit global</SelectItem>
                <SelectItem key="off">Disable policies</SelectItem>
                <SelectItem key="replace">Replace global</SelectItem>
                <SelectItem key="append">Append to global</SelectItem>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-[280px_1fr] gap-4">
            <div className="flex min-h-[520px] flex-col gap-2 border-r border-default-200 pr-3">
              <div className="flex gap-2">
                <Button size="sm" color="primary" onPress={addPolicy}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => {
                    const presets = cloneDefaultSmartPolicies()
                    const custom = draftPolicies.filter(
                      (policy) => !policy.id.startsWith('preset-')
                    )
                    setDraftPolicies([...presets, ...custom])
                    setSelectedId(presets[0]?.id || custom[0]?.id || '')
                  }}
                >
                  Reset presets
                </Button>
              </div>
              <div className="flex flex-col gap-2 overflow-auto">
                {draftPolicies.map((policy) => (
                  <button
                    key={policy.id}
                    draggable
                    className={`cursor-move rounded-md border px-3 py-2 text-left text-sm ${
                      selectedPolicy?.id === policy.id
                        ? 'border-primary bg-primary-50 text-primary'
                        : 'border-default-200 hover:bg-default-100'
                    }`}
                    onDragStart={() => setDraggingId(policy.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => movePolicy(draggingId, policy.id)}
                    onClick={() => setSelectedId(policy.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{policy.name}</span>
                      <Switch
                        size="sm"
                        isSelected={policy.enabled}
                        onValueChange={(enabled) =>
                          setDraftPolicies((items) =>
                            items.map((item) =>
                              item.id === policy.id ? { ...item, enabled } : item
                            )
                          )
                        }
                      />
                    </div>
                    <div className="mt-1 truncate text-xs text-default-500">{policy.groupName}</div>
                  </button>
                ))}
              </div>
            </div>

            {selectedPolicy && (
              <div className="grid grid-cols-2 gap-3">
                <Input
                  size="sm"
                  label="Policy name"
                  value={selectedPolicy.name}
                  onValueChange={(name) => setSelectedPolicy({ name })}
                />
                <Input
                  size="sm"
                  label="Group name"
                  value={selectedPolicy.groupName}
                  onValueChange={(groupName) => setSelectedPolicy({ groupName })}
                />
                <Select
                  size="sm"
                  label="Category"
                  selectedKeys={new Set([selectedPolicy.category])}
                  disallowEmptySelection
                  onSelectionChange={(keys) =>
                    setSelectedPolicy({ category: keys.currentKey as SmartPolicyCategory })
                  }
                >
                  <SelectItem key="ai">AI</SelectItem>
                  <SelectItem key="finance">Finance</SelectItem>
                  <SelectItem key="streaming">Streaming</SelectItem>
                  <SelectItem key="custom">Custom</SelectItem>
                </Select>
                <Select
                  size="sm"
                  label="Group type"
                  selectedKeys={new Set([selectedPolicy.groupType])}
                  disallowEmptySelection
                  onSelectionChange={(keys) =>
                    setSelectedPolicy({ groupType: keys.currentKey as SmartPolicyGroupType })
                  }
                >
                  <SelectItem key="smart">Smart</SelectItem>
                  <SelectItem key="fallback">Fallback</SelectItem>
                  <SelectItem key="url-test">URL-Test</SelectItem>
                </Select>
                <Textarea
                  className="col-span-2"
                  minRows={5}
                  label="Match rules"
                  value={selectedPolicy.matchRules.join('\n')}
                  onValueChange={(value) =>
                    setSelectedPolicy({
                      matchRules: value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean)
                    })
                  }
                />
                <Input
                  size="sm"
                  label="Include filter"
                  value={selectedPolicy.includeFilter || ''}
                  onValueChange={(includeFilter) => setSelectedPolicy({ includeFilter })}
                />
                <Input
                  size="sm"
                  label="Exclude filter"
                  value={selectedPolicy.excludeFilter || ''}
                  onValueChange={(excludeFilter) => setSelectedPolicy({ excludeFilter })}
                />
                <Select
                  size="sm"
                  label="Strategy"
                  selectedKeys={new Set([selectedPolicy.strategy])}
                  disallowEmptySelection
                  onSelectionChange={(keys) =>
                    setSelectedPolicy({ strategy: keys.currentKey as SmartPolicyStrategy })
                  }
                >
                  <SelectItem key="sticky-sessions">Sticky sessions</SelectItem>
                  <SelectItem key="round-robin">Round robin</SelectItem>
                </Select>
                <Input
                  size="sm"
                  label="Policy priority"
                  value={selectedPolicy.policyPriority || ''}
                  onValueChange={(policyPriority) => setSelectedPolicy({ policyPriority })}
                />
                <div className="flex items-center justify-between rounded-md border border-default-200 px-3">
                  <span className="text-sm">Use all proxies</span>
                  <Switch
                    size="sm"
                    isSelected={selectedPolicy.useAllProxies}
                    onValueChange={(useAllProxies) => setSelectedPolicy({ useAllProxies })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-default-200 px-3">
                  <span className="text-sm">LightGBM</span>
                  <Switch
                    size="sm"
                    isSelected={selectedPolicy.useLightGBM ?? false}
                    onValueChange={(useLightGBM) => setSelectedPolicy({ useLightGBM })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-default-200 px-3">
                  <span className="text-sm">Collect data</span>
                  <Switch
                    size="sm"
                    isSelected={selectedPolicy.collectData ?? false}
                    onValueChange={(collectData) => setSelectedPolicy({ collectData })}
                  />
                </div>
                {selectedPolicy.groupType !== 'smart' && (
                  <>
                    <Input
                      size="sm"
                      label="Test URL"
                      value={selectedPolicy.testUrl || ''}
                      onValueChange={(testUrl) => setSelectedPolicy({ testUrl })}
                    />
                    <Input
                      size="sm"
                      type="number"
                      label="Interval"
                      value={(selectedPolicy.interval || 300).toString()}
                      onValueChange={(value) =>
                        setSelectedPolicy({ interval: parseInt(value, 10) || 300 })
                      }
                    />
                  </>
                )}
                <div className="col-span-2 flex gap-2">
                  <Button size="sm" variant="flat" onPress={duplicatePolicy}>
                    Duplicate
                  </Button>
                  <Button size="sm" color="danger" variant="flat" onPress={deletePolicy}>
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Textarea
              minRows={3}
              label="JSON import/export"
              value={jsonText}
              onValueChange={setJsonText}
            />
            <div className="flex flex-col justify-end gap-2">
              <Button size="sm" variant="flat" onPress={exportJson}>
                Export
              </Button>
              <Button size="sm" variant="flat" onPress={importJson}>
                Import
              </Button>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button size="sm" variant="light" onPress={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            color="primary"
            isLoading={saving}
            onPress={async () => {
              const error = validatePolicies(draftPolicies)
              if (error) {
                toast.error(error)
                return
              }
              setSaving(true)
              try {
                await onSave(draftPolicies, draftOverrideMode)
                onClose()
              } catch (error) {
                toast.error(String(error))
              } finally {
                setSaving(false)
              }
            }}
          >
            Save and restart
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default SmartPolicyEditorModal
