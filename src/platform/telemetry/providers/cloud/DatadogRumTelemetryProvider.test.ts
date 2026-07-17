import { afterEach, describe, expect, it, vi } from 'vitest'

import { DatadogRumTelemetryProvider } from './DatadogRumTelemetryProvider'

const addAction = vi.fn()
const getInternalContext = vi.fn()
const setViewName = vi.fn()

function installDatadogRum(): void {
  Object.defineProperty(window, 'DD_RUM', {
    configurable: true,
    value: { addAction, getInternalContext, setViewName }
  })
}

afterEach(() => {
  addAction.mockReset()
  getInternalContext.mockReset()
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

  it('tracks workflow execution starts with the originating view', () => {
    installDatadogRum()
    getInternalContext.mockReturnValue({ view: { id: 'view-a' } })

    new DatadogRumTelemetryProvider().trackExecutionStarted({
      jobId: 'job-a',
      startTime: 42
    })

    expect(getInternalContext).toHaveBeenCalledWith(42)
    expect(addAction).toHaveBeenCalledWith('workflow_execution_started', {
      product: 'cloud_generation',
      origin_view_id: 'view-a'
    })
  })

  it('preserves each origin view across workflow switches', () => {
    installDatadogRum()
    getInternalContext
      .mockReturnValueOnce({ view: { id: 'view-a' } })
      .mockReturnValueOnce({ view: { id: 'view-b' } })
    const provider = new DatadogRumTelemetryProvider()

    provider.trackExecutionStarted({ jobId: 'job-a', startTime: 1 })
    provider.trackExecutionStarted({ jobId: 'job-b', startTime: 2 })
    provider.trackExecutionSuccess({ jobId: 'job-a' })
    provider.trackExecutionError({ jobId: 'job-b' })

    expect(addAction).toHaveBeenNthCalledWith(
      3,
      'workflow_execution_completed',
      {
        outcome: 'success',
        origin_view_id: 'view-a',
        product: 'cloud_generation'
      }
    )
    expect(addAction).toHaveBeenNthCalledWith(
      4,
      'workflow_execution_completed',
      {
        outcome: 'failure',
        origin_view_id: 'view-b',
        product: 'cloud_generation'
      }
    )
  })

  it('does nothing when Datadog RUM is unavailable', () => {
    const provider = new DatadogRumTelemetryProvider()

    expect(() => provider.trackPageView('ignored')).not.toThrow()
    expect(() =>
      provider.trackExecutionStarted({ jobId: 'job-a', startTime: 1 })
    ).not.toThrow()
    expect(() =>
      provider.trackExecutionSuccess({ jobId: 'job-a' })
    ).not.toThrow()
    expect(() => provider.trackExecutionError({ jobId: 'job-a' })).not.toThrow()
    expect(addAction).not.toHaveBeenCalled()
    expect(setViewName).not.toHaveBeenCalled()
  })
})
