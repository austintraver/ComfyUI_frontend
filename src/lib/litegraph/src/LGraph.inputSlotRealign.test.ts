import { createTestingPinia } from '@pinia/testing'
import { setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  SUBGRAPH_INPUT_ID,
  SUBGRAPH_OUTPUT_ID
} from '@/lib/litegraph/src/constants'
import { LGraph, LGraphNode, LiteGraph } from '@/lib/litegraph/src/litegraph'
import type {
  ExportedSubgraph,
  ISerialisedNode,
  SerialisableGraph
} from '@/lib/litegraph/src/types/serialisation'
import { useLinkStore } from '@/stores/linkStore'
import { toLinkId } from '@/types/linkId'
import { toNodeId } from '@/types/nodeId'
import type { NodeId } from '@/types/nodeId'

const DEFINITION_ORDER = ['in_a', 'in_b', 'in_c']

/**
 * Mimics ComfyNode.configure (src/services/litegraphService.ts): reorders the
 * serialized inputs array in place on `data` to match the current node
 * definition order before delegating to LGraphNode.configure. This is the
 * issue #3348 scenario: a workflow saved before the node definition's input
 * order changed (e.g. a forceInput migration in a node pack update).
 */
class ReorderTargetNode extends LGraphNode {
  constructor(title?: string) {
    super(title ?? 'ReorderTarget')
    for (const name of DEFINITION_ORDER) this.addInput(name, 'number')
  }

  override configure(data: ISerialisedNode): void {
    data.inputs = [...(data.inputs ?? [])].sort(
      (a, b) =>
        DEFINITION_ORDER.indexOf(a.name) - DEFINITION_ORDER.indexOf(b.name)
    )
    super.configure(data)
  }
}

class SourceNode extends LGraphNode {
  constructor(title?: string) {
    super(title ?? 'Source')
    this.addOutput('out', 'number')
  }
}

const SUBGRAPH_ID = 'ab111111-1111-4111-8111-111111111111'

/**
 * Source and reorder-target nodes connected by three links whose saved
 * `target_slot` matches the saved input order [in_b, in_c, in_a], which is
 * stale relative to the current definition order [in_a, in_b, in_c].
 */
function shiftedNodesAndLinks(sourceId: number, targetId: number) {
  return {
    nodes: [
      {
        id: sourceId,
        type: 'test/RealignSource',
        pos: [0, 0] as [number, number],
        size: [140, 60] as [number, number],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'out', type: 'number', links: [1, 2, 3] }],
        properties: {}
      },
      {
        id: targetId,
        type: 'test/RealignTarget',
        pos: [300, 0] as [number, number],
        size: [140, 80] as [number, number],
        flags: {},
        order: 1,
        mode: 0,
        inputs: [
          { name: 'in_b', type: 'number', link: 1 },
          { name: 'in_c', type: 'number', link: 2 },
          { name: 'in_a', type: 'number', link: 3 }
        ],
        outputs: [],
        properties: {}
      }
    ],
    links: [
      {
        id: 1,
        origin_id: sourceId,
        origin_slot: 0,
        target_id: targetId,
        target_slot: 0,
        type: 'number'
      },
      {
        id: 2,
        origin_id: sourceId,
        origin_slot: 0,
        target_id: targetId,
        target_slot: 1,
        type: 'number'
      },
      {
        id: 3,
        origin_id: sourceId,
        origin_slot: 0,
        target_id: targetId,
        target_slot: 2,
        type: 'number'
      }
    ]
  }
}

function emptySubgraphDefinition(): ExportedSubgraph {
  return {
    id: SUBGRAPH_ID,
    version: 1,
    revision: 0,
    state: { lastNodeId: 0, lastLinkId: 0, lastGroupId: 0, lastRerouteId: 0 },
    name: 'Empty Subgraph',
    config: {},
    inputNode: { id: SUBGRAPH_INPUT_ID, bounding: [0, 0, 120, 60] },
    outputNode: { id: SUBGRAPH_OUTPUT_ID, bounding: [300, 0, 120, 60] },
    inputs: [],
    outputs: [],
    widgets: [],
    nodes: [],
    links: []
  }
}

function savedWorkflow(withSubgraphDefinition: boolean): SerialisableGraph {
  return {
    id: 'ab000000-0000-4000-8000-000000000001',
    version: 1,
    revision: 0,
    state: { lastNodeId: 2, lastLinkId: 3, lastGroupId: 0, lastRerouteId: 0 },
    ...shiftedNodesAndLinks(1, 2),
    ...(withSubgraphDefinition
      ? { definitions: { subgraphs: [emptySubgraphDefinition()] } }
      : {})
  }
}

function savedWorkflowWithShiftInsideSubgraph(): SerialisableGraph {
  return {
    id: 'ab000000-0000-4000-8000-000000000002',
    version: 1,
    revision: 0,
    state: { lastNodeId: 0, lastLinkId: 0, lastGroupId: 0, lastRerouteId: 0 },
    nodes: [],
    links: [],
    definitions: {
      subgraphs: [
        {
          ...emptySubgraphDefinition(),
          name: 'Subgraph With Shifted Inputs',
          state: {
            lastNodeId: 20,
            lastLinkId: 3,
            lastGroupId: 0,
            lastRerouteId: 0
          },
          ...shiftedNodesAndLinks(10, 20)
        }
      ]
    }
  }
}

const LINK_BY_INPUT_NAME: Record<string, number> = {
  in_a: 3,
  in_b: 1,
  in_c: 2
}

function assertLinksRealigned(graph: LGraph, targetNodeId: NodeId) {
  const target = graph.getNodeById(targetNodeId)!
  const linkStore = useLinkStore()

  for (const [slot, input] of target.inputs.entries()) {
    const expectedLinkId = toLinkId(LINK_BY_INPUT_NAME[input.name])
    const link = graph.links.get(expectedLinkId)!

    expect(link.target_slot, `link.target_slot for input ${input.name}`).toBe(
      slot
    )
    expect(
      linkStore.getInputSlotLink(graph.rootGraph.id, target.id, slot)?.id,
      `store registration for input ${input.name} at slot ${slot}`
    ).toBe(expectedLinkId)
  }
}

const SURVIVOR_LINK_BY_INPUT_NAME: Record<string, number> = {
  in_a: 3,
  in_b: 1,
  in_c: 4
}

/**
 * Source and target connected by three inputs, where in_c carries a stale
 * duplicate: links 2 and 4 share the tuple (source:0 → in_c's saved slot) and
 * the saved input references the later id 4. Link 2 loads first, so it wins
 * the store's first-wins registration despite being the orphan (issue #10291
 * corruption shape).
 */
function duplicateLinkWorkflow(
  savedInputOrder: readonly string[]
): SerialisableGraph {
  const slotOf = (name: string) => savedInputOrder.indexOf(name)
  const linkOf = (id: number, name: string) => ({
    id,
    origin_id: 1,
    origin_slot: 0,
    target_id: 2,
    target_slot: slotOf(name),
    type: 'number'
  })
  return {
    id: 'ab000000-0000-4000-8000-000000000003',
    version: 1,
    revision: 0,
    state: { lastNodeId: 2, lastLinkId: 4, lastGroupId: 0, lastRerouteId: 0 },
    nodes: [
      {
        id: 1,
        type: 'test/RealignSource',
        pos: [0, 0],
        size: [140, 60],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'out', type: 'number', links: [1, 2, 3, 4] }],
        properties: {}
      },
      {
        id: 2,
        type: 'test/RealignTarget',
        pos: [300, 0],
        size: [140, 80],
        flags: {},
        order: 1,
        mode: 0,
        inputs: savedInputOrder.map((name) => ({
          name,
          type: 'number',
          link: SURVIVOR_LINK_BY_INPUT_NAME[name]
        })),
        outputs: [],
        properties: {}
      }
    ],
    links: [
      linkOf(1, 'in_b'),
      linkOf(2, 'in_c'),
      linkOf(3, 'in_a'),
      linkOf(4, 'in_c')
    ]
  }
}

function assertDuplicatePurged(graph: LGraph) {
  expect([...graph.links.keys()].sort()).toEqual([1, 3, 4])

  const target = graph.getNodeById(toNodeId(2))!
  const linkStore = useLinkStore()

  for (const [slot, input] of target.inputs.entries()) {
    const expectedLinkId = toLinkId(SURVIVOR_LINK_BY_INPUT_NAME[input.name])
    const link = graph.links.get(expectedLinkId)!

    expect(link.target_slot, `link.target_slot for input ${input.name}`).toBe(
      slot
    )
    expect(
      linkStore.getInputSlotLink(graph.rootGraph.id, target.id, slot)?.id,
      `store registration for input ${input.name} at slot ${slot}`
    ).toBe(expectedLinkId)
  }
}

describe('LGraph.configure input slot realignment (#3348)', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    LiteGraph.registerNodeType('test/RealignSource', SourceNode)
    LiteGraph.registerNodeType('test/RealignTarget', ReorderTargetNode)
  })

  it('re-keys links to reordered input slots', () => {
    const graph = new LGraph()
    graph.configure(savedWorkflow(false))

    assertLinksRealigned(graph, toNodeId(2))
  })

  it('re-keys root links when subgraph definitions force a data clone', () => {
    const graph = new LGraph()
    graph.configure(savedWorkflow(true))

    assertLinksRealigned(graph, toNodeId(2))
  })

  it('re-keys links of nodes inside subgraph definitions', () => {
    const graph = new LGraph()
    graph.configure(savedWorkflowWithShiftInsideSubgraph())

    const subgraph = graph.subgraphs.get(SUBGRAPH_ID)!
    assertLinksRealigned(subgraph, toNodeId(20))
  })
})

describe('LGraph.configure duplicate link dedup (#10291)', () => {
  beforeEach(() => {
    setActivePinia(createTestingPinia({ stubActions: false }))
    LiteGraph.registerNodeType('test/RealignSource', SourceNode)
    LiteGraph.registerNodeType('test/RealignTarget', ReorderTargetNode)
  })

  it('keeps the duplicate referenced by the serialized input, not the first-loaded one', () => {
    const graph = new LGraph()
    graph.configure(duplicateLinkWorkflow(DEFINITION_ORDER))

    assertDuplicatePurged(graph)
  })

  it('keeps the referenced duplicate connected across input slot drift', () => {
    const graph = new LGraph()
    graph.configure(duplicateLinkWorkflow(['in_b', 'in_c', 'in_a']))

    assertDuplicatePurged(graph)
  })
})
