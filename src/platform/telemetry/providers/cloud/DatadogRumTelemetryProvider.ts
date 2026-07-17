import type {
  ExecutionErrorMetadata,
  ExecutionStartMetadata,
  ExecutionSuccessMetadata,
  PageViewMetadata,
  TelemetryProvider
} from '../../types'

interface DatadogRumInternalContext {
  view?: { id?: string }
}

interface DatadogRumClient {
  addAction(name: string, context?: Record<string, unknown>): void
  getInternalContext(startTime?: number): DatadogRumInternalContext | undefined
  setViewName(name: string): void
}

interface WindowWithDatadogRum extends Window {
  DD_RUM?: DatadogRumClient
}

type ViewName =
  | 'account_access'
  | 'oauth_consent'
  | 'support_recovery'
  | 'workspace'

const SUPPORT_RECOVERY_PATHS = new Set([
  '/cloud/auth-timeout',
  '/cloud/forgot-password',
  '/cloud/sorry-contact-support'
])

const WORKFLOW_CONTEXT = {
  product: 'cloud_generation'
} as const

function getDatadogRum(): DatadogRumClient | undefined {
  return (window as WindowWithDatadogRum).DD_RUM
}

function getViewName(path = window.location.href): ViewName {
  const pathname = new URL(path, window.location.origin).pathname.replace(
    /\/$/,
    ''
  )
  if (pathname === '/cloud/oauth/consent') return 'oauth_consent'
  if (SUPPORT_RECOVERY_PATHS.has(pathname)) return 'support_recovery'
  if (pathname === '/cloud' || pathname.startsWith('/cloud/'))
    return 'account_access'
  return 'workspace'
}

export class DatadogRumTelemetryProvider implements TelemetryProvider {
  private readonly originViewIdsByJobId = new Map<string, string>()

  trackPageView(_pageName: string, properties?: PageViewMetadata): void {
    getDatadogRum()?.setViewName(getViewName(properties?.path))
  }

  trackExecutionStarted(metadata: ExecutionStartMetadata): void {
    const rum = getDatadogRum()
    const originViewId = rum?.getInternalContext(metadata.startTime)?.view?.id
    if (originViewId)
      this.originViewIdsByJobId.set(metadata.jobId, originViewId)

    rum?.addAction('workflow_execution_started', {
      ...WORKFLOW_CONTEXT,
      ...(originViewId && { origin_view_id: originViewId })
    })
  }

  trackExecutionSuccess(metadata: ExecutionSuccessMetadata): void {
    this.trackTerminalOutcome(metadata.jobId, 'success')
  }

  trackExecutionError(metadata: ExecutionErrorMetadata): void {
    this.trackTerminalOutcome(metadata.jobId, 'failure')
  }

  private trackTerminalOutcome(
    jobId: string,
    outcome: 'success' | 'failure'
  ): void {
    const originViewId = this.originViewIdsByJobId.get(jobId)
    this.originViewIdsByJobId.delete(jobId)

    getDatadogRum()?.addAction('workflow_execution_completed', {
      ...WORKFLOW_CONTEXT,
      outcome,
      ...(originViewId && { origin_view_id: originViewId })
    })
  }
}
