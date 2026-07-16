import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatadogRumTelemetryProvider } from './DatadogRumTelemetryProvider'

const addAction = vi.fn()
const setViewName = vi.fn()

function installDatadogRum(): void {
  Object.defineProperty(window, 'DD_RUM', {
    configurable: true,
    value: { addAction, setViewName }
  })
}

afterEach(() => {
  addAction.mockReset()
  setViewName.mockReset()
  Reflect.deleteProperty(window, 'DD_RUM')
})

describe('DatadogRumTelemetryProvider', () => {
  it.for([
    { expected: 'workspace', path: 'https://cloud.comfy.org/' },
    { expected: 'account_access', path: 'https://cloud.comfy.org/cloud/' },
    { expected: 'account_access', path: 'https://cloud.comfy.org/cloud/login' },
    {
      expected: 'account_access',
      path: 'https://cloud.comfy.org/cloud/subscribe?plan=creator'
    },
    {
      expected: 'oauth_consent',
      path: 'https://cloud.comfy.org/cloud/oauth/consent?oauth_request_id=redacted'
    },
    {
      expected: 'support_recovery',
      path: 'https://cloud.comfy.org/cloud/forgot-password'
    },
    {
      expected: 'support_recovery',
      path: 'https://cloud.comfy.org/cloud/sorry-contact-support'
    },
    {
      expected: 'support_recovery',
      path: 'https://cloud.comfy.org/cloud/auth-timeout'
    }
  ] as const)('names the current view $expected', ({ expected, path }) => {
    installDatadogRum()

    new DatadogRumTelemetryProvider().trackPageView('ignored', { path })

    expect(setViewName).toHaveBeenCalledWith(expected)
  })

  it('tracks workflow execution starts', () => {
    installDatadogRum()

    new DatadogRumTelemetryProvider().trackWorkflowExecution()

    expect(addAction).toHaveBeenCalledWith('workflow_execution_started', {
      product: 'cloud_generation',
      product_surface: 'workspace'
    })
  })

  it.for([
    {
      outcome: 'success',
      trackOutcome: (provider: DatadogRumTelemetryProvider) =>
        provider.trackExecutionSuccess()
    },
    {
      outcome: 'failure',
      trackOutcome: (provider: DatadogRumTelemetryProvider) =>
        provider.trackExecutionError()
    }
  ] as const)(
    'tracks workflow $outcome outcomes',
    ({ outcome, trackOutcome }) => {
      installDatadogRum()
      const provider = new DatadogRumTelemetryProvider()

      trackOutcome(provider)

      expect(addAction).toHaveBeenCalledWith('workflow_execution_completed', {
        outcome,
        product: 'cloud_generation',
        product_surface: 'workspace'
      })
    }
  )

  it('does nothing when Datadog RUM is unavailable', () => {
    const provider = new DatadogRumTelemetryProvider()

    expect(() => provider.trackPageView('ignored')).not.toThrow()
    expect(() => provider.trackWorkflowExecution()).not.toThrow()
    expect(() => provider.trackExecutionSuccess()).not.toThrow()
    expect(() => provider.trackExecutionError()).not.toThrow()
    expect(addAction).not.toHaveBeenCalled()
    expect(setViewName).not.toHaveBeenCalled()
  })
})
