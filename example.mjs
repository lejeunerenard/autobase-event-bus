import RAM from 'random-access-memory'
import Corestore from 'corestore'
import b4a from 'b4a'
import { EventBus } from './index.js'

const store1 = new Corestore(RAM.reusable())
const store2 = new Corestore(RAM.reusable())

const bus1 = new EventBus(store1, null, {
  keyEncoding: 'utf-8',
  valueEncoding: 'json',
  apply
})
await bus1.ready()

const bus2 = new EventBus(store2, bus1.autobase.key, {
  keyEncoding: 'utf-8',
  valueEncoding: 'json',
  apply
})
await bus2.ready()

bus2.on('ping', async () => {
  console.log('got "ping"')
  await bus2.emit('pong')
})

// Replicate peers
const stream1 = store1.replicate(true)
const stream2 = store2.replicate(false)
stream1.pipe(stream2).pipe(stream1)

// Add bus2 as writer
await bus1.append({
  add: bus2.autobase.local.key
})

bus1.on('pong', async () => {
  console.log('got "pong"')
})
await bus1.emit('ping')

async function apply (batch, bee, base) {
  const isAddWriter = (node) => 'add' in node.value
  const nonWriterNodes = batch.filter((node) => !isAddWriter(node))
  const writerNodes = batch.filter(isAddWriter)
  if (writerNodes.length) {
    for (const node of writerNodes) {
      // Add other writers
      await base.addWriter(b4a.from(node.value.add, 'hex'))
    }
  }

  if (!nonWriterNodes.length) return
  return EventBus.eventIndexesApply(nonWriterNodes, bee, base)
}
