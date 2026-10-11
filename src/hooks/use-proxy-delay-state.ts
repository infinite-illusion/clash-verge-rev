import { useLockFn } from 'ahooks'
import { useCallback, useEffect, useReducer } from 'react'

import { useVerge } from '@/hooks/use-verge'
import delayManager, { type DelayUpdate } from '@/services/delay'
import {
  isInteractableMember,
  memberDetails,
  type ResolvedProxyMember,
} from '@/types/proxy-view'

const PRESET_PROXY_NAMES = [
  'DIRECT',
  'REJECT',
  'REJECT-DROP',
  'PASS',
  'COMPATIBLE',
]

const identity = (_: DelayUpdate, next: DelayUpdate): DelayUpdate => next

const INITIAL_DELAY: DelayUpdate = { delay: -1, updatedAt: 0 }

export interface UseProxyDelayState {
  delayState: DelayUpdate
  delayValue: number
  isPreset: boolean
  timeout: number
  onDelay: () => Promise<void>
}

export function useProxyDelayState(
  member: ResolvedProxyMember,
  groupName: string,
): UseProxyDelayState {
  const name = member.ref.name
  const unresolved = member.kind === 'unresolved'
  const isPreset = unresolved || PRESET_PROXY_NAMES.includes(name)
  const [delayState, setDelayState] = useReducer(identity, INITIAL_DELAY)
  const { verge } = useVerge()
  const timeout = verge?.default_latency_timeout || 10000

  useEffect(() => {
    if (isPreset) return
    delayManager.setListener(member, groupName, setDelayState)
    return () => {
      delayManager.removeListener(member, groupName)
    }
  }, [member, groupName, isPreset])

  const updateDelay = useCallback(() => {
    if (unresolved) {
      setDelayState(INITIAL_DELAY)
      return
    }
    // getDelayUpdate 已按「更新的来源」裁决：后端 health-check / 分组测速
    // 的 history 更新时优先后端，否则返回手动测速缓存（含 TTL）。
    const cachedUpdate = delayManager.getDelayUpdate(member, groupName)
    if (cachedUpdate) {
      setDelayState({ ...cachedUpdate })
      return
    }

    // 无缓存时回退 getDelayFix（含 provider history 等兜底路径）
    const fallbackDelay = delayManager.getDelayFix(member, groupName)
    if (fallbackDelay === -1) {
      setDelayState({ delay: -1, updatedAt: 0 })
      return
    }

    // updatedAt 从 history 推导，与 getDelayFix 的取值来源保持一致
    let updatedAt = 0
    const history =
      delayManager.getHistory(member, groupName) ??
      memberDetails(member)?.history
    if (history && history.length > 0) {
      const parsed = Date.parse(history[history.length - 1].time)
      if (!Number.isNaN(parsed)) updatedAt = parsed
    }

    setDelayState({ delay: fallbackDelay, updatedAt })
  }, [groupName, member, unresolved])

  useEffect(() => {
    updateDelay()
    return delayManager.addGroupListener(groupName, updateDelay)
  }, [groupName, updateDelay])

  const onDelay = useLockFn(async () => {
    if (!isInteractableMember(member)) return
    setDelayState({ delay: -2, updatedAt: Date.now() })
    await delayManager.checkDelay(member, groupName, timeout)
    updateDelay()
  })

  return {
    delayState,
    delayValue: delayState.delay,
    isPreset,
    timeout,
    onDelay,
  }
}
