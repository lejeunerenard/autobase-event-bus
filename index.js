import { EventEmitter } from 'events'
import codecs from 'codecs'
import b4a from 'b4a'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import assert from 'assert'

export class EventBus {
  constructor (opts = {}) {
    this.keyEncoding = opts.keyEncoding ? codecs(opts.keyEncoding) : null
    // TODO Decide if i want to default valueEncoding to json or something else
    this.valueEncoding = opts.valueEncoding ? codecs(opts.valueEncoding) : null

    this.eventStreamRetryTimeout = opts.eventStreamRetryTimeout || 100

    // TODO decide whether eager update needs to be explicitly set to false by default
    this.autobase = new Autobase({
      ...opts,
      autostart: false
    })
    this.autobase.start({
      unwrap: true,
      apply: this.eventIndexesApply.bind(this),
      view: (core) => new Hyperbee(core.unwrap(), {
        ...opts,
        extension: false
      })
    })

    this.bus = new EventEmitter()

    // Setup emitting on event emitter via hyperbee
    this.eventStream = null
    this.eventStreamRetry = null
    this.eventSeen = {}
    this.autobase.once('append', this.setupEventStream.bind(this))
  }

  setupEventStream () {
    this.eventStream = this.autobase.view.createHistoryStream({ live: true })
      .on('data', (node) => {
        const { key, value } = node
        const prefix = key.substring(0, 6)
        if (prefix === 'event!' && !(key in this.eventSeen)) {
          const eventObj = value
          const eventDetails = { data: eventObj.data, timestamp: eventObj.timestamp }
          this.eventSeen[key] = true
          this.bus.emit(eventObj.event, eventDetails)
        }
      })
      .on('error', (err) => {
        // Compensate for a non-await .get on LinearizedCore
        // When the history stream reaches the end, hyperbee just request the
        // next block assuming that the .get() will resolve when its available.
        // The LinearizedCore implementation of Hypercore doesn't support this
        // but instead has a retry X times setup which quickly gets exhausted
        // when explicitly requesting a block out of bounds.
        if (err.message === 'Linearization could not be rebuilt after 32 attempts') {
          this.eventStreamRetry = setTimeout(this.setupEventStream.bind(this), this.eventStreamRetryTimeout)
        }
      })
  }

  ready () {
    return this.autobase.ready()
  }

  async eventIndexesApply (bee, batch) {
    const b = bee.batch({ update: false })
    for (const node of batch) {
      const eventObj = this.valueEncoding.decode(node.value)
      const { event, timestamp } = eventObj
      const timestampMS = (new Date(timestamp)).getTime()

      // By event
      const eventKey = ['event', event, timestampMS, node.id, node.seq]
        .join('!')
      // By Time
      const timeKey = ['time', timestampMS, event, node.id, node.seq]
        .join('!')

      await Promise.all([eventKey, timeKey].map((key) => b.put(key, eventObj)))
    }

    await b.flush()
  }

  on (event, cb) {
    assert(typeof event === 'string', 'event must be a string')
    assert(typeof cb === 'function', 'second argument must be a callback function')

    this.bus.on(event, cb)
    return this
  }

  async emit (event, ...args) {
    assert(typeof event === 'string', 'event must be a string')
    assert(this.autobase.localInput, 'No localInput hypercore provided')

    await this.autobase.localInput.ready()

    const data = enc(this.valueEncoding, {
      event,
      data: args,
      timestamp: new Date()
    })

    return this.autobase.append(data)
  }

  async close () {
    clearTimeout(this.eventStreamRetry)
    if (this.eventStream) {
      this.eventStream.destroy()
    }
    await this.autobase.close()
  }
}

function enc (e, v) {
  if (v === undefined || v === null) return null
  if (e !== null) return e.encode(v)
  if (typeof v === 'string') return b4a.from(v)
  return v
}
