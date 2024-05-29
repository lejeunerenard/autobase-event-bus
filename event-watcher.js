import { EventEmitter } from 'events'
import { RangeWatcher } from '@lejeunerenard/hyperbee-range-watcher-autobase'

export class EventWatcher extends EventEmitter {
  constructor (bee, range, latestDiff) {
    super()

    this.watcher = new RangeWatcher(bee, range, latestDiff, async (node) => {
      const { type, value } = node
      // Ignore Events somehow removed
      if (type === 'del') return

      const eventObj = value
      const eventDetails = { data: eventObj.data, timestamp: eventObj.timestamp }
      this.emit(eventObj.event, eventDetails)
      this.emit('*', eventObj)
    })
  }
}
