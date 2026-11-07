import { onUnmounted, ref, watch, type Ref } from 'vue'
import { tweenNumbers } from '../lib/motion'

export function useAnimatedCount(source: Readonly<Ref<number>>) {
  const displayedCount = ref(source.value)
  let cancelTween: (() => void) | undefined

  watch(source, (target) => {
    cancelTween?.()
    const value = { current: displayedCount.value }
    cancelTween = tweenNumbers(value, { current: target }, 180, ({ current }) => {
      displayedCount.value = Math.round(current)
    })
  })

  onUnmounted(() => cancelTween?.())

  return displayedCount
}
