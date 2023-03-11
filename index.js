import { EventEmitter } from 'events'
import codecs from 'codecs'
import b4a from 'b4a'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import assert from 'assert'
import lexint from 'lexicographic-integer'

export class EventBus {
  constructor (opts = {}) {
    this._hyperbeeOpts = opts

    this.keyEncoding = opts.keyEncoding ? codecs(opts.keyEncoding) : null
    // TODO Decide if i want to default valueEncoding to json or something else
    this.valueEncoding = opts.valueEncoding ? codecs(opts.valueEncoding) : null

    // TODO decide whether eager update needs to be explicitly set to false by default
    this.autobase = new Autobase({
      ...opts,
      autostart: false
    })
    if (opts.autostart) {
      this.start()
    }

    this._bus = new EventEmitter()

    // Setup emitting on event emitter via hyperbee
    this._lastEventEmittedPerLog = new Map()
  }

  async setupEventStream () {
    const searchOptions = { gte: 'key!', lt: 'key"' }
    const db = this.autobase.view.snapshot()

    // TODO Using snapshot only supported with fix to linearize.js's session on snapshotted cores on linearizedcoresession class
    const stream = db.createDiffStream(this._lastCheckout || this._initialViewVersion || 0, searchOptions)
    for await (const node of stream) {
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
        this._bus.emit(eventObj.event, eventDetails)
      }
    }

    this._lastCheckout = db.version // Update latest

    if (this.autobase.view.version !== db.version) {
      process.nextTick(this.setupEventStream.bind(this))
    } else {
      // Setup hook to start again
      this.autobase.view.feed
        .once('append', this.setupEventStream.bind(this))
        .once('truncate', (ancestor) => {
          this._lastCheckout = ancestor
        })
    }
  }

  ready () {
    return this.autobase.ready()
  }

  start () {
    this.autobase.start({
      unwrap: true,
      apply: this.eventIndexesApply.bind(this),
      view: (core) => new Hyperbee(core.unwrap(), {
        ...this._hyperbeeOpts,
        extension: false
      })
    })
    this.autobase.once('append', () => {
      this.autobase.view.feed.once('append', this.setupEventStream.bind(this))
    })
    this.autobase.ready().then(() => {
      // TODO Try to get initial view size from remote outputs
      if (this.autobase.localOutput) {
        this._initialViewVersion = this.autobase.localOutput.length
      }
    })
  }

  async eventIndexesApply (bee, batch) {
    const b = bee.batch({ update: false })
    const keys = [null, null, null]

    for (const node of batch) {
      const eventObj = this.valueEncoding.decode(node.value)
      const { event, timestamp } = eventObj
      const timestampMS = (new Date(timestamp)).getTime()

      const lexicographicSeq = lexint.pack(node.seq, 'hex')
      // By event
      const eventKey = ['event', event, timestampMS, node.id, lexicographicSeq]
        .join('!')
      // By Time
      const timeKey = ['time', timestampMS, event, node.id, lexicographicSeq]
        .join('!')
      // By input key
      const inputKey = ['key', node.id, lexicographicSeq]
        .join('!')

      keys[0] = eventKey
      keys[1] = timeKey
      keys[2] = inputKey

      await Promise.all(keys.map((key) => b.put(key, eventObj)))
    }

    await b.flush()
  }

  on (event, cb) {
    assert(typeof event === 'string', 'event must be a string')
    assert(typeof cb === 'function', 'second argument must be a callback function')

    this._bus.on(event, cb)
    return this
  }

  async emit (event, ...args) {
    let eventObj
    if (typeof event === 'object' && 'event' in event) {
      eventObj = event
    } else {
      eventObj = {
        event,
        data: args,
        timestamp: new Date()
      }
    }
    assert(typeof eventObj.event === 'string', 'event must be a string')
    assert(eventObj.timestamp instanceof Date, 'timestamp must be a Date')
    assert(this.autobase.localInput, 'No localInput hypercore provided')

    const data = enc(this.valueEncoding, eventObj)

    await this.autobase.localInput.ready()
    return this.autobase.append(data)
  }

  async close () {
    await this.autobase.close()
  }
}

function enc (e, v) {
  if (v === undefined || v === null) return null
  if (e !== null) return e.encode(v)
  if (typeof v === 'string') return b4a.from(v)
  return v
}
