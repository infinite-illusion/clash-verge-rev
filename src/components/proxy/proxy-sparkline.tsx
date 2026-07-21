import { Box, Tooltip, useTheme } from '@mui/material'
import { memo, type ReactNode } from 'react'

import delayManager from '@/services/delay'

import { resolveDelayColor } from './proxy-sparkline-utils'

// 一个 history 样本:{ 测试时刻, 延迟(ms) };delay === 0 表示失败/超时
interface HistoryPoint {
  time: string
  delay: number
}

export interface ProxySparklineProps {
  history?: HistoryPoint[]
  width?: number // 列表默认 52 / 迷你默认 32
  height?: number // 列表默认 16 / 迷你默认 10
  strokeWidth?: number
  // 已解析的描边颜色,由父级用 resolveDelayColor 算好传入
  color: string
  timeout: number
}

const DEFAULT_WIDTH = 52
const DEFAULT_HEIGHT = 16
const DEFAULT_STROKE = 1.5

// 只比对延迟序列:大多数节点在多数 3s 轮询里 history 没变,签名相同 → 跳过重绘
function signature(history?: HistoryPoint[]): string {
  if (!history || history.length === 0) return ''
  let s = ''
  for (const p of history) s += `${p.delay}|`
  return s
}

function formatTime(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleTimeString([], { hour12: false })
}

function buildPath(
  history: HistoryPoint[],
  width: number,
  height: number,
): string | null {
  const n = history.length
  if (n === 0) return null

  const valid = history.filter((p) => p.delay > 0)
  if (valid.length === 0) {
    // 全是失败:顶部一条平线
    return `M0 0.5 L${width} 0.5`
  }

  let min = Infinity
  let max = -Infinity
  for (const p of valid) {
    if (p.delay < min) min = p.delay
    if (p.delay > max) max = p.delay
  }

  const top = 1 // 高延迟/失败 → 顶部(向上=差)
  const bottom = height - 1 // 低延迟 → 底部
  const range = max - min

  const point = (p: HistoryPoint, i: number): string => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width
    let y: number
    if (p.delay <= 0) {
      y = 0 // 失败 → 顶部尖刺
    } else if (range === 0) {
      y = (top + bottom) / 2 // 全相等 → 中线,避免除零
    } else {
      y = bottom - ((p.delay - min) / range) * (bottom - top)
    }
    return `${x.toFixed(2)} ${y.toFixed(2)}`
  }

  let d = `M${point(history[0], 0)}`
  for (let i = 1; i < n; i++) d += ` L${point(history[i], i)}`
  return d
}

function ProxySparklineImpl({
  history,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  strokeWidth = DEFAULT_STROKE,
  color,
  timeout,
}: ProxySparklineProps) {
  const { palette } = useTheme()
  const d =
    history && history.length > 0 ? buildPath(history, width, height) : null
  if (!d || !history || history.length === 0) return null

  // hover 展示该节点的 history 明细(最新在上)
  const title: ReactNode = (
    <Box sx={{ fontSize: 12, lineHeight: 1.5, minWidth: 124 }}>
      <Box sx={{ opacity: 0.6, mb: 0.5 }}>延迟历史 · {history.length}</Box>
      {[...history].reverse().map((p) => (
        <Box
          key={p.time}
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 1,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Box component="span" sx={{ opacity: 0.85 }}>
            {formatTime(p.time)}
          </Box>
          <Box
            component="span"
            sx={{ color: resolveDelayColor(p.delay, timeout, palette) }}
          >
            {delayManager.formatDelay(p.delay, timeout)}
          </Box>
        </Box>
      ))}
    </Box>
  )

  return (
    <Tooltip
      title={title}
      placement="top"
      arrow
      disableInteractive
      enterDelay={400}
      enterNextDelay={200}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', flex: 'none' }}
        aria-hidden
      >
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Tooltip>
  )
}

function areEqual(
  prev: ProxySparklineProps,
  next: ProxySparklineProps,
): boolean {
  return (
    prev.width === next.width &&
    prev.height === next.height &&
    prev.strokeWidth === next.strokeWidth &&
    prev.color === next.color &&
    prev.timeout === next.timeout &&
    signature(prev.history) === signature(next.history)
  )
}

export const ProxySparkline = memo(ProxySparklineImpl, areEqual)
