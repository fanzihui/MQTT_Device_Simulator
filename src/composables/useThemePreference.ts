import { computed, ref, watch } from 'vue'
import { prefersReducedMotion, tweenNumbers } from '../lib/motion'
import type { ThemePreference } from '../types'

const themeColorProperties = [
  '--canvas', '--surface', '--surface-raised', '--surface-muted', '--surface-input', '--code-surface',
  '--ink', '--ink-soft', '--muted', '--subtle', '--placeholder', '--line', '--line-strong', '--accent',
  '--accent-strong', '--accent-soft', '--green', '--green-soft', '--amber', '--amber-soft', '--danger',
  '--danger-soft', '--empty-state-icon', '--focus-ring', '--code-key', '--code-string', '--code-number',
  '--code-literal', '--code-keyword',
]

type Rgb = [number, number, number]

let cancelThemeTween: (() => void) | undefined

const themePreference = ref<ThemePreference>(readPreference())
const systemDark = ref(typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)
const resolvedTheme = computed(() => themePreference.value === 'system'
  ? (systemDark.value ? 'dark' : 'light')
  : themePreference.value)

if (typeof window !== 'undefined') {
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', (event) => { systemDark.value = event.matches })
  watch([themePreference, resolvedTheme], ([preference, theme], previous) => {
    window.localStorage.setItem('telemetry-studio.theme', preference)
    if (!previous) {
      document.documentElement.dataset.theme = theme
    } else if (previous[1] !== theme) {
      animateThemeChange(theme)
    }
  }, { immediate: true })
}

function animateThemeChange(theme: string) {
  const root = document.documentElement
  const start = readPalette(root)
  cancelThemeTween?.()
  cancelThemeTween = undefined

  root.dataset.theme = theme
  clearPaletteOverrides(root)
  const end = readPalette(root)
  if (prefersReducedMotion()) return

  const entries = themeColorProperties.flatMap((property, index) => {
    const from = start.get(property)
    const to = end.get(property)
    return from && to ? [{ property, from, to, index }] : []
  })
  if (!entries.length) return

  const values: Record<string, number> = {}
  const target: Record<string, number> = {}
  for (const { from, to, index } of entries) {
    for (let channel = 0; channel < 3; channel += 1) {
      const key = `c${index}_${channel}`
      values[key] = from[channel]
      target[key] = to[channel]
    }
  }

  const applyPalette = (state: Record<string, number>) => {
    for (const { property, index } of entries) {
      const red = Math.round(state[`c${index}_0`])
      const green = Math.round(state[`c${index}_1`])
      const blue = Math.round(state[`c${index}_2`])
      root.style.setProperty(property, `rgb(${red}, ${green}, ${blue})`)
    }
  }

  applyPalette(values)
  cancelThemeTween = tweenNumbers(values, target, 220, applyPalette, () => {
    clearPaletteOverrides(root)
    cancelThemeTween = undefined
  })
}

function readPalette(root: HTMLElement) {
  const styles = window.getComputedStyle(root)
  return new Map(themeColorProperties.map((property) => [property, parseRgb(styles.getPropertyValue(property).trim())]))
}

function parseRgb(value: string): Rgb | null {
  const hex = value.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1]
  if (hex) {
    const digits = hex.length === 3 ? [...hex].map((digit) => `${digit}${digit}`).join('') : hex
    return [0, 2, 4].map((index) => Number.parseInt(digits.slice(index, index + 2), 16)) as Rgb
  }

  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i)
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null
}

function clearPaletteOverrides(root: HTMLElement) {
  for (const property of themeColorProperties) root.style.removeProperty(property)
}

function readPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark'
  const value = window.localStorage.getItem('telemetry-studio.theme')
  return value === 'light' || value === 'system' ? value : 'dark'
}

export function useThemePreference() {
  return { themePreference, resolvedTheme }
}
