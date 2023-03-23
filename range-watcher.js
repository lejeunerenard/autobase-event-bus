import { EventEmitter } from 'events'

export class RangeWatcher extends EventEmitter {
  constructor (bee, range, latestDiff) {
    super()

    this.bee = bee

    this.opened = false

    this.range = range
    this.latestDiff = latestDiff
    this.stream = null

    this._lastEventEmittedPerLog = new Map()
    this._run()
    this._opening = this._ready()
  }

  async _ready () {
    await this.bee.ready()
    this.opened = true
  }

  async _run () {
    if (this.opened === false) await this._opening

    // TODO Using snapshot only supported with fix to linearize.js's session on snapshotted cores on linearizedcoresession class
    const db = this.bee.snapshot()

    this.stream = db.createDiffStream(this.latestDiff, this.range)
    for await (const node of this.stream) {
      let key
      let value
      // Diff stream
      if ('left' in node || 'right' in node) {
        if (node.left) {
          key = node.left.key
          value = node.left.value
        } else {
          key = node.right.key
          value = node.right.value
        }
      } else {
        // TODO decide if this is needed ever
        // createReadStream support
        key = node.key
        value = node.value
      }
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
    }

    this.latestDiff = db.version // Update latest

    if (this.bee.version !== db.version) {
      process.nextTick(this._run.bind(this))
    } else {
      // Setup hook to start again
      this.bee.feed
        .once('append', this._run.bind(this))
        .once('truncate', (ancestor) => {
          this.latestDiff = ancestor
        })
    }

    return this.stream
  }
}
