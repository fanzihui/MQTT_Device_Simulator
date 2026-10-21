import { computed, ref, watch } from 'vue'
import type { ThemePreference } from '../types'

const themePreference = ref<ThemePreference>(readPreference())
const systemDark = ref(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
const resolvedTheme = computed(() => themePreference.value === 'system'
  ? (systemDark.value ? 'dark' : 'light')
  : themePreference.value)

if (typeof window !== 'undefined') {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', (event) => { systemDark.value = event.matches })
  watch([themePreference, resolvedTheme], ([preference, theme]) => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('telemetry-studio.theme', preference)
  }, { immediate: true })
}

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark'
  const value = window.localStorage.getItem('telemetry-studio.theme')
  return value === 'light' || value === 'system' ? value : 'dark'
}

export function useThemePreference() {
  return { themePreference, resolvedTheme }
}
