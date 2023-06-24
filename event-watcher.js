import { EventEmitter } from 'events'
import { RangeWatcher } from '@lejeunerenard/hyperbee-range-watcher-autobase'

export class EventWatcher extends EventEmitter {
  constructor (bee, range, latestDiff) {
    super()

    this._lastEventEmittedPerLog = new Map()

    this.watcher = new RangeWatcher(bee, range, latestDiff, async (node) => {
      const { key, value } = node
      const [inputCoreKey, inputCoreSeqStr] = key.split('!').slice(-2)
      const inputCoreSeq = parseInt(inputCoreSeqStr, 16)
      const hasCoreKey = this._lastEventEmittedPerLog.has(inputCoreKey)
      let prevSeq
      let isNewer
      if (hasCoreKey) {
        prevSeq = this._lastEventEmittedPerLog.get(inputCoreKey)
        isNewer = prevSeq < inputCoreSeq
      }
      if (!hasCoreKey || isNewer) {
        const eventObj = value
        const eventDetails = { data: eventObj.data, timestamp: eventObj.timestamp }
        this._lastEventEmittedPerLog.set(inputCoreKey, inputCoreSeq)
        this.emit(eventObj.event, eventDetails)
        this.emit('*', eventObj)
      }
    })
  }
}
