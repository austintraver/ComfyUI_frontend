import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LGraph, LGraphNode } from '@/lib/litegraph/src/litegraph'
import type { ComfyApp } from '@/scripts/app'
import type { QueuePromptGuard } from '@/services/queuePromptGuardService'
import type { ComfyExtension } from '@/types/comfy'

const {
  addToast,
  isNodeDisabled,
  registerQueuePromptGuard,
  registerExtension,
  usePartnerNodeGovernanceStore
} = vi.hoisted(() => {
  const isNodeDisabled = vi.fn()
  return {
    addToast: vi.fn(),
    isNodeDisabled,
    registerQueuePromptGuard: vi.fn<
      (id: string, guard: QueuePromptGuard) => () => void
    >(() => () => {}),
    registerExtension: vi.fn<(extension: ComfyExtension) => void>(),
    usePartnerNodeGovernanceStore: vi.fn(() => ({ isNodeDisabled }))
  }
})

vi.mock('@/platform/workspace/stores/partnerNodeGovernanceStore', () => ({
  usePartnerNodeGovernanceStore
}))

vi.mock('@/platform/updates/common/toastStore', () => ({
  useToastStore: () => ({ add: addToast })
}))

vi.mock('@/services/queuePromptGuardService', () => ({
  registerQueuePromptGuard
}))

vi.mock('@/services/extensionService', () => ({
  useExtensionService: () => ({ registerExtension })
}))

describe('cloudPartnerNodeGovernance', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function loadExtension(): Promise<ComfyExtension> {
    await import('./cloudPartnerNodeGovernance')
    const extension = registerExtension.mock.calls[0]?.[0]
    if (!extension)
      throw new Error('Expected governance extension registration')
    return extension
  }

  it('initializes governance during Cloud setup', async () => {
    const extension = await loadExtension()
    expect(extension.name).toBe('Comfy.Cloud.PartnerNodeGovernance')

    extension.setup?.(fromPartial<ComfyApp>({}))

    expect(usePartnerNodeGovernanceStore).toHaveBeenCalledOnce()
    expect(registerQueuePromptGuard).toHaveBeenCalledOnce()
  })

  it('blocks queueing when the graph contains a disabled partner node', async () => {
    const graph = new LGraph()
    graph.add(new LGraphNode('DisabledPartnerNode', 'DisabledPartnerNode'))
    isNodeDisabled.mockImplementation(
      (nodeType) => nodeType === 'DisabledPartnerNode'
    )
    const extension = await loadExtension()
    extension.setup?.(fromPartial<ComfyApp>({}))
    const guard = registerQueuePromptGuard.mock.calls[0]?.[1]
    if (!guard) throw new Error('Expected queue guard registration')

    const result = await guard({ rootGraph: graph })

    expect(result).toBe(false)
    expect(isNodeDisabled).toHaveBeenCalledWith('DisabledPartnerNode')
    expect(addToast).toHaveBeenCalledWith({
      severity: 'error',
      summary: 'Workflow blocked by workspace policy',
      detail:
        'Remove disabled partner nodes from this workflow or ask a workspace owner to update the policy.',
      life: 6000
    })
  })
})
