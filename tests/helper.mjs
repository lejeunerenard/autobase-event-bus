import { EventBus } from '../index.js'
import b4a from 'b4a'

export const applyWriterManagement = (debugLogs) => [async function apply (batch, bee, base) {
  debugLogs && console.log(`-- apply [${this.name}] --`)
  const isAddWriter = (node) => 'add' in node.value
  const nonWriterNodes = batch.filter((node) => !isAddWriter(node))
  const writerNodes = batch.filter(isAddWriter)

  debugLogs && console.log('writerNodes', writerNodes.map((node) => JSON.stringify(node.value)))
  if (writerNodes.length) {
    for (const node of writerNodes) {
      await base.addWriter(b4a.from(node.value.add, 'hex'))
    }
  }

  debugLogs && console.log('nonWriterNodes', nonWriterNodes.map((node) => JSON.stringify(node.value)))
  if (!nonWriterNodes.length) return

  return EventBus.eventIndexesApply(nonWriterNodes, bee, base)
}, (base, key) => base.append({
  add: b4a.toString(key, 'hex')
})]
