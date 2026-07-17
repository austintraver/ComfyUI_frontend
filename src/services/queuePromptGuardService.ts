import type { LGraph } from '@/lib/litegraph/src/litegraph'

export interface QueuePromptGuardContext {
  readonly rootGraph: LGraph
}

export type QueuePromptGuard = (
  context: QueuePromptGuardContext
) => boolean | Promise<boolean>

const guards = new Map<string, QueuePromptGuard>()

export function registerQueuePromptGuard(
  id: string,
  guard: QueuePromptGuard
): () => void {
  guards.set(id, guard)
  return () => {
    if (guards.get(id) === guard) guards.delete(id)
  }
}

export async function runQueuePromptGuards(
  context: QueuePromptGuardContext
): Promise<boolean> {
  const results = await Promise.all(
    [...guards.values()].map((guard) => guard(context))
  )
  return results.every((result) => result !== false)
}
