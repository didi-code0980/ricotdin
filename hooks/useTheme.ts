'use client'

import { useCallback, useState } from 'react'
import { type Theme, DEFAULT_THEME, STORAGE_KEY } from '@/lib/theme'

const VALID: Theme[] = ['luxury', 'default', 'playful']

export function useTheme() {
  // The anti-flash script in layout.tsx already set data-theme from localStorage
  // before hydration, so reading the attribute here gives the correct initial value.
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME
    const attr = document.documentElement.getAttribute('data-theme') as Theme | null
    return attr && VALID.includes(attr) ? attr : DEFAULT_THEME
  })

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* localStorage blocked */ }
  }, [])

  return { theme, setTheme }
}
