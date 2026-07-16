import { ref, toRaw, toRef } from 'vue'
import type { MaybeRef } from 'vue'

import { useChainCallback } from '@/composables/functional/useChainCallback'
import { CameraInfoViewport } from '@/extensions/core/cameraInfo/CameraInfoViewport'
import type { TransformGizmoMode } from '@/extensions/core/cameraInfo/CameraInfoViewport'
import { DEFAULT_CAMERA_INFO_STATE } from '@/extensions/core/cameraInfo/types'
import type { CameraInfoMode } from '@/extensions/core/cameraInfo/types'
import {
  readStateFromWidgets,
  writeWidgetValue
} from '@/extensions/core/cameraInfo/widgetBridge'
import type { NodeWithWidgets } from '@/extensions/core/cameraInfo/widgetBridge'
import type { LGraphNode } from '@/lib/litegraph/src/LGraphNode'
import { useToastStore } from '@/platform/updates/common/toastStore'

type WidgetCallback = (value: unknown, ...rest: unknown[]) => void
interface MutableWidget {
  name: string
  value: unknown
  callback?: WidgetCallback
}

const WIDGET_NAMES = [
  'mode',
  'camera_type',
  'target_x',
  'target_y',
  'target_z',
  'roll',
  'fov',
  'zoom',
  'mode.yaw',
  'mode.pitch',
  'mode.distance',
  'mode.position_x',
  'mode.position_y',
  'mode.position_z',
  'mode.quat_x',
  'mode.quat_y',
  'mode.quat_z',
  'mode.quat_w'
] as const

export function useCameraInfo(nodeRef: MaybeRef<LGraphNode | null>) {
  const node = toRef(nodeRef)
  let viewport: CameraInfoViewport | null = null

  const mode = ref<CameraInfoMode>(DEFAULT_CAMERA_INFO_STATE.mode)

  const wrappedWidgets: { widget: MutableWidget; original?: WidgetCallback }[] =
    []
  const wrappedSet = new WeakSet<MutableWidget>()

  const initialize = (container: HTMLElement): void => {
    const raw = toRaw(node.value)
    if (!raw || !container) return

    try {
      const initialState = readStateFromWidgets(raw as NodeWithWidgets)
      mode.value = initialState.mode
      viewport = new CameraInfoViewport(container, initialState, {
        onHandleDrag: (fieldName, value) => {
          writeWidgetValue(raw as NodeWithWidgets, fieldName, value)
        }
      })
      wireWidgetsToOverlay(raw as NodeWithWidgets)
      wireNodeMouseStatus(raw as LGraphNode)
    } catch (error) {
      console.error('Failed to initialize CameraInfoViewport:', error)
      useToastStore().addAlert('Failed to initialize Camera Info viewport.')
    }
  }

  const cleanup = (): void => {
    unwireWidgets()
    viewport?.remove()
    viewport = null
  }

  const handleMouseEnter = (): void => {
    viewport?.viewport.updateStatusMouseOnScene(true)
    viewport?.viewport.refreshViewport()
  }

  const handleMouseLeave = (): void => {
    viewport?.viewport.updateStatusMouseOnScene(false)
  }

  const setGizmosVisible = (on: boolean): void => {
    viewport?.setGizmosVisible(on)
  }

  const setTransformGizmoMode = (gizmoMode: TransformGizmoMode): void => {
    viewport?.setTransformGizmoMode(gizmoMode)
  }

  const setLookThrough = (on: boolean): void => {
    viewport?.setLookThrough(on)
  }

  function wireNodeMouseStatus(target: LGraphNode): void {
    target.onMouseEnter = useChainCallback(target.onMouseEnter, () => {
      viewport?.viewport.updateStatusMouseOnNode(true)
      viewport?.viewport.refreshViewport()
    })
    target.onMouseLeave = useChainCallback(target.onMouseLeave, () => {
      viewport?.viewport.updateStatusMouseOnNode(false)
    })
  }

  function wireWidgetsToOverlay(target: NodeWithWidgets): void {
    if (!target.widgets) return
    for (const name of WIDGET_NAMES) {
      const widget = target.widgets.find(
        (w): w is MutableWidget => w.name === name
      )
      if (!widget || wrappedSet.has(widget)) continue
      wrappedSet.add(widget)
      const original = widget.callback
      const isModeWidget = widget.name === 'mode'
      wrappedWidgets.push({ widget, original })
      widget.callback = (value, ...rest) => {
        original?.call(widget, value, ...rest)
        if (isModeWidget) wireWidgetsToOverlay(target)
        if (!viewport) return
        const state = readStateFromWidgets(target)
        mode.value = state.mode
        viewport.applyState(state)
      }
    }
  }

  function unwireWidgets(): void {
    for (const { widget, original } of wrappedWidgets) {
      widget.callback = original
    }
    wrappedWidgets.length = 0
  }

  return {
    initialize,
    cleanup,
    handleMouseEnter,
    handleMouseLeave,
    setGizmosVisible,
    setTransformGizmoMode,
    setLookThrough,
    mode
  }
}
