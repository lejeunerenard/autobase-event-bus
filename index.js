import { EventEmitter } from 'events'
import codecs from 'codecs'
import b4a from 'b4a'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import assert from 'assert'
import lexint from 'lexicographic-integer'
import { RangeWatcher } from './range-watcher.js'

export class EventBus {
  constructor (opts = {}) {
    this._hyperbeeOpts = opts

    this.keyEncoding = opts.keyEncoding ? codecs(opts.keyEncoding) : null
    // TODO Decide if i want to default valueEncoding to json or something else
    this.valueEncoding = opts.valueEncoding ? codecs(opts.valueEncoding) : null

    this._bus = new EventEmitter()
    this._started = new Promise((resolve, reject) => {
      this._bus.once('started', resolve)
    })

    // TODO decide whether eager update needs to be explicitly set to false by default
    this.autobase = new Autobase({
      ...opts,
      autostart: false
    })
    if (opts.autostart) {
      this.start()
    }

    this._watchers = new Map()
  }

  async setupEventStream (event = '*', otherVersion) {
    if (this._watchers.has(event)) return this._watchers.get(event)

    await this._started

    const searchOptions = event === '*'
      ? { gte: 'key!', lt: 'key"' }
      : { gte: `event!${event}!`, lt: `event!${event}"` }

    // Default starting point
    if (!otherVersion) {
      otherVersion = this._initialViewVersion || 0
    }

    const watcher = new RangeWatcher(this.autobase.view, searchOptions, otherVersion)
    this._watchers.set(event, watcher)

    return watcher
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
    this.autobase.ready().then(() => {
      // TODO Try to get initial view size from remote outputs
      if (this.autobase.localOutput) {
        this._initialViewVersion = this.autobase.localOutput.length
      }

      this._bus.emit('started')
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

    this.setupEventStream(event).then((watcher) => watcher.on(event, cb))

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
