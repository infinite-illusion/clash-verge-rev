import { readFileSync, writeFileSync } from 'node:fs'

const path = 'src/services/cmds.ts'
const source = readFileSync(path, 'utf8')
const upstreamFunction = `export async function cmdTestDelay(url: string) {
  return invoke<number>('test_delay', { url })
}`
const customFunction = `export interface TestDelayResult {
  delay: number
  chains: string[]
}

export async function cmdTestDelay(url: string): Promise<TestDelayResult> {
  return invoke<TestDelayResult>('test_delay', { url })
}`

const occurrences = source.split(upstreamFunction).length - 1
if (occurrences !== 1) {
  throw new Error(
    `Expected one upstream cmdTestDelay implementation, found ${occurrences}`,
  )
}

writeFileSync(path, source.replace(upstreamFunction, customFunction))
