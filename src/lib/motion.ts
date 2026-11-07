import { Easing, Group, Tween } from '@tweenjs/tween.js'

type TweenValues = Record<string, number>
type MotionState = { opacity: number; y: number; scale: number }
type ActiveTween = { finish: () => void }

const group = new Group()
const activeTweens = new Set<ActiveTween>()
const elementTweens = new WeakMap<HTMLElement, () => void>()
const pressedControls = new Set<HTMLElement>()
const reducedMotionQuery = typeof window === 'undefined'
  ? null
  : window.matchMedia('(prefers-reduced-motion: reduce)')
let animationFrame: number | undefined

export function prefersReducedMotion() {
  return reducedMotionQuery?.matches ?? false
}

function requestNextFrame() {
  if (animationFrame === undefined) animationFrame = requestAnimationFrame(updateTweens)
}

function updateTweens(time: number) {
  animationFrame = undefined
  group.update(time)
  if (activeTweens.size) requestNextFrame()
}

export function tweenNumbers<T extends TweenValues>(
  values: T,
  target: Partial<T>,
  duration: number,
  onUpdate: (values: T) => void,
  onComplete?: () => void,
) {
  const end = { ...values, ...target } as T

  if (prefersReducedMotion() || duration <= 0) {
    Object.assign(values, end)
    onUpdate(values)
    onComplete?.()
    return () => undefined
  }

  let settled = false
  let tween: Tween<T>
  const finish = (applyTarget: boolean) => {
    if (settled) return
    settled = true
    group.remove(tween)
    tween.stop()
    activeTweens.delete(entry)
    if (applyTarget) {
      Object.assign(values, end)
      onUpdate(values)
      onComplete?.()
    }
  }
  const entry: ActiveTween = { finish: () => finish(true) }

  tween = new Tween(values)
    .to(end, duration)
    .easing(Easing.Cubic.Out)
    .onUpdate(() => onUpdate(values))
    .onComplete(() => finish(true))

  group.add(tween)
  activeTweens.add(entry)
  tween.start(performance.now())
  requestNextFrame()

  return () => finish(false)
}

function applyElementMotion(element: HTMLElement, state: MotionState) {
  element.style.opacity = String(state.opacity)
  element.style.transform = `translate3d(0, ${state.y}px, 0) scale(${state.scale})`
}

export function tweenElement(
  element: HTMLElement,
  from: Partial<MotionState>,
  to: Partial<MotionState>,
  duration: number,
  onComplete?: () => void,
) {
  elementTweens.get(element)?.()
  const state: MotionState = {
    opacity: from.opacity ?? 1,
    y: from.y ?? 0,
    scale: from.scale ?? 1,
  }
  const target: MotionState = { ...state, ...to }
  applyElementMotion(element, state)

  const finishElement = () => {
    applyElementMotion(element, target)
    element.style.removeProperty('opacity')
    element.style.removeProperty('transform')
    elementTweens.delete(element)
    onComplete?.()
  }

  if (prefersReducedMotion() || duration <= 0) {
    finishElement()
    return () => undefined
  }

  const cancelTween = tweenNumbers(state, target, duration, () => applyElementMotion(element, state), finishElement)
  const cancel = () => {
    cancelTween()
    elementTweens.delete(element)
  }
  elementTweens.set(element, cancel)
  return cancel
}

export function pulseStatusIndicator(element: HTMLElement) {
  return tweenElement(element, { opacity: 0.45, scale: 0.6 }, { opacity: 1, scale: 1 }, 180)
}

const pressAnimations = new WeakMap<HTMLElement, () => void>()

function tweenPressScale(element: HTMLElement, targetScale: number) {
  pressAnimations.get(element)?.()
  if (prefersReducedMotion()) {
    element.style.removeProperty('scale')
    pressAnimations.delete(element)
    return
  }
  const currentScale = Number.parseFloat(element.style.getPropertyValue('scale')) || 1
  const values = { scale: currentScale }
  let cancel: () => void = () => undefined
  cancel = tweenNumbers(values, { scale: targetScale }, targetScale === 1 ? 110 : 90, ({ scale }) => {
    element.style.setProperty('scale', String(scale))
  }, () => {
    if (targetScale === 1) element.style.removeProperty('scale')
    pressAnimations.delete(element)
  })
  pressAnimations.set(element, cancel)
}

export function installPressFeedback(root: HTMLElement) {
  const pressedPointers = new Map<number, HTMLElement>()

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    const control = event.target.closest<HTMLElement>('button:not(:disabled), [role="switch"], .switch-control, .theme-option, .permission-row')
    if (!control || !root.contains(control)) return
    pressedPointers.set(event.pointerId, control)
    pressedControls.add(control)
    tweenPressScale(control, 0.985)
  }

  const onPointerEnd = (event: PointerEvent) => {
    const control = pressedPointers.get(event.pointerId)
    if (!control) return
    pressedPointers.delete(event.pointerId)
    if (![...pressedPointers.values()].includes(control)) pressedControls.delete(control)
    tweenPressScale(control, 1)
  }

  const onWindowBlur = () => {
    for (const control of pressedPointers.values()) tweenPressScale(control, 1)
    pressedPointers.clear()
    for (const control of pressedControls) pressedControls.delete(control)
  }

  root.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerEnd)
  window.addEventListener('pointercancel', onPointerEnd)
  window.addEventListener('blur', onWindowBlur)

  return () => {
    root.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerEnd)
    window.removeEventListener('pointercancel', onPointerEnd)
    window.removeEventListener('blur', onWindowBlur)
    for (const control of pressedPointers.values()) tweenPressScale(control, 1)
    pressedPointers.clear()
    for (const control of pressedControls) pressedControls.delete(control)
  }
}

export function finishActiveMotion() {
  for (const tween of [...activeTweens]) tween.finish()
}

reducedMotionQuery?.addEventListener('change', (event) => {
  if (!event.matches) return
  for (const control of pressedControls) {
    pressAnimations.get(control)?.()
    control.style.removeProperty('scale')
    pressAnimations.delete(control)
  }
  pressedControls.clear()
  finishActiveMotion()
})
