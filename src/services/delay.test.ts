import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('tauri-plugin-mihomo-api', () => ({
  delayProxyByName: vi.fn(async () => ({ delay: 120 })),
  healthcheckNodeInProvider: vi.fn(async () => ({ delay: 120 })),
}))

import type { ResolvedProxyMember } from '@/types/proxy-view'

import delayManager from './delay'

const node = (
  name: string,
  options: {
    history?: Array<{ time: string; delay: number }>
    providerName?: string
  } = {},
) =>
  ({
    kind: 'node',
    ref: { kind: 'node', name, recordId: `r:${name}` },
    node: {
      recordId: `r:${name}`,
      name,
      history: options.history ?? [],
      source: options.providerName
        ? {
            kind: 'provider',
            providerName: options.providerName,
            proxyName: name,
          }
        : { kind: 'core', proxyName: name },
    },
  }) as unknown as ResolvedProxyMember

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

let settles = 0
let unsubscribe: () => void

beforeEach(() => {
  settles = 0
  unsubscribe = delayManager.addGroupListener('g', () => {
    settles += 1
  })
})

afterEach(() => unsubscribe())

describe('group delay completion', () => {
  test('notifies once after a batch settles', async () => {
    const proxies = Array.from({ length: 6 }, (_, index) => node(`n${index}`))

    await delayManager.checkListDelay(proxies as never, 'g', 5000, 2)
    await flush()

    expect(settles).toBe(1)
  })

  test('notifies only listeners for the completed group', async () => {
    let other = 0
    const stop = delayManager.addGroupListener('other', () => {
      other += 1
    })

    await delayManager.checkDelay(node('a') as never, 'g', 5000)
    await flush()

    expect(settles).toBe(1)
    expect(other).toBe(0)
    stop()
  })
})

describe('delay source freshness', () => {
  test('newer health-check history supersedes a core node manual result', () => {
    const name = 'core-with-new-history'
    const cachedAt = Date.now()
    delayManager.setDelay(name, 'g', 90)

    const member = node(name, {
      history: [{ time: new Date(cachedAt + 1000).toISOString(), delay: 240 }],
    })

    expect(delayManager.getDelayFix(member, 'g')).toBe(240)
  })

  test('newer manual result remains authoritative for a core node', () => {
    const name = 'core-with-old-history'
    const cachedAt = Date.now()
    delayManager.setDelay(name, 'g', 90)

    const member = node(name, {
      history: [{ time: new Date(cachedAt - 1000).toISOString(), delay: 240 }],
    })

    expect(delayManager.getDelayFix(member, 'g')).toBe(90)
  })

  test('provider nodes continue to use health-check history', () => {
    const name = 'provider-node'
    const cachedAt = Date.now()
    delayManager.setDelay(name, 'g', 90)

    const member = node(name, {
      providerName: 'provider-a',
      history: [{ time: new Date(cachedAt - 1000).toISOString(), delay: 240 }],
    })

    expect(delayManager.getDelayFix(member, 'g')).toBe(240)
  })
})
