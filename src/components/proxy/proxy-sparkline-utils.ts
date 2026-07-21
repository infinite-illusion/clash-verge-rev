import type { Palette } from '@mui/material'

/**
 * 镜像 delayManager.formatDelayColor(src/services/delay.ts)的阈值,
 * 解析成真实的调色板颜色值,供 SVG stroke 使用,和延迟徽标配色保持一致。
 */
export function resolveDelayColor(
  delay: number,
  timeout: number,
  palette: Palette,
): string {
  let key: 'error' | 'warning' | 'primary' | 'success' | ''
  if (delay < 0) key = ''
  else if (delay === 0 || delay >= timeout || delay >= 10000) key = 'error'
  else if (delay >= 400) key = 'warning'
  else if (delay >= 250) key = 'primary'
  else key = 'success'

  const p = palette as unknown as Record<
    string,
    Record<string, string> | undefined
  >
  if (!key) return p.text?.secondary ?? p.primary?.main ?? '#888'
  return p[key]?.main ?? p.primary?.main ?? '#888'
}
