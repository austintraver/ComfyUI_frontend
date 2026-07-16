import type { PageViewMetadata, TelemetryProvider } from '../../types'

interface DatadogRumClient {
  addAction(name: string, context?: Record<string, unknown>): void
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
  product: 'cloud_generation',
  product_surface: 'workspace'
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
  trackPageView(_pageName: string, properties?: PageViewMetadata): void {
    getDatadogRum()?.setViewName(getViewName(properties?.path))
  }

  trackWorkflowExecution(): void {
    getDatadogRum()?.addAction('workflow_execution_started', WORKFLOW_CONTEXT)
  }

  trackExecutionSuccess(): void {
    this.trackTerminalOutcome('success')
  }

  trackExecutionError(): void {
    this.trackTerminalOutcome('failure')
  }

  private trackTerminalOutcome(outcome: 'success' | 'failure'): void {
    getDatadogRum()?.addAction('workflow_execution_completed', {
      ...WORKFLOW_CONTEXT,
      outcome
    })
  }
}
