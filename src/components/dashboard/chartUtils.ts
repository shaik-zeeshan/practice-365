import { useLayoutEffect, useRef, useState } from 'react'

// ===========================================================================
// Shared SSR-safe helpers for the hand-drawn SVG dashboard charts.
//
// Both the AnnualReportWidget and the firm-overview MonthlyBarChart draw their
// charts as plain SVG (no chart dependency) at a 1:1 pixel scale, so they need
// to measure their rendered width and round their axis to a clean bound. These
// two helpers are extracted here so the two charts can share one copy.
// ===========================================================================

/** Track the rendered pixel width of an element via ResizeObserver. */
export function useElementWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.clientWidth || fallback)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fallback])
  return [ref, width] as const
}

/** Round a max value up to a clean axis bound (1/2/5 × 10ⁿ). */
export function niceMax(v: number): number {
  if (v <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  return nice * pow
}
