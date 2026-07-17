import { t } from '@/i18n'
import { usePartnerNodeGovernanceStore } from '@/platform/workspace/stores/partnerNodeGovernanceStore'
import { useToastStore } from '@/platform/updates/common/toastStore'
import { useExtensionService } from '@/services/extensionService'
import { registerQueuePromptGuard } from '@/services/queuePromptGuardService'
import { forEachNode } from '@/utils/graphTraversalUtil'

const QUEUE_GUARD_ID = 'workspace.partner-node-governance'

useExtensionService().registerExtension({
  name: 'Comfy.Cloud.PartnerNodeGovernance',

  setup: () => {
    usePartnerNodeGovernanceStore()
    registerQueuePromptGuard(QUEUE_GUARD_ID, (context) => {
      const governanceStore = usePartnerNodeGovernanceStore()
      let hasDisabledPartnerNode = false
      forEachNode(context.rootGraph, (node) => {
        if (node.type && governanceStore.isNodeDisabled(node.type)) {
          hasDisabledPartnerNode = true
        }
      })

      if (!hasDisabledPartnerNode) return true

      useToastStore().add({
        severity: 'error',
        summary: t('workspacePanel.allowlist.runBlocked.summary'),
        detail: t('workspacePanel.allowlist.runBlocked.detail'),
        life: 6000
      })
      return false
    })
  }
})
