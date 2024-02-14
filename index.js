import b4a from 'b4a'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import assert from 'assert'
import lexint from 'lexicographic-integer'
import { EventWatcher } from './event-watcher.js'

export const EVENT_PREFIX = 'event'
export const TIME_PREFIX = 'time'
export const KEY_PREFIX = 'key'

export class EventBus {
  constructor (store, bootstraps = null, opts = {}) {
    this._hyperbeeOpts = opts

    // Set default apply if not provided
    this._apply = 'apply' in opts ? opts.apply : this.constructor.eventIndexesApply.bind(this)

    this.autobase = new Autobase(store, bootstraps, {
      ...opts,
      open: (viewStore) => {
        const core = viewStore.get('eventbus-index', opts.valueEncoding)
        return new Hyperbee(core, {
          ...this._hyperbeeOpts,
          extension: false
        })
      },
      apply: this._apply
    })

    this._watchers = new Map()
  }

  get view () {
    return this.autobase.view
  }

  async setupEventStream (event = '*', otherVersion) {
    if (this._watchers.has(event)) return this._watchers.get(event)

    await this.ready()

    const searchOptions = event === '*'
      ? { gte: `${KEY_PREFIX}!`, lt: `${KEY_PREFIX}"` }
      : { gte: `${EVENT_PREFIX}!${event}!`, lt: `${EVENT_PREFIX}!${event}"` }

    // Default starting point
    if (!otherVersion) {
      otherVersion = this.autobase.view.version || 0
    }

    const watcher = new EventWatcher(this.autobase.view, searchOptions,
      otherVersion)
    this._watchers.set(event, watcher)

    return watcher
  }

  ready () {
    return this.autobase.ready()
  }

  static async eventIndexesApply (batch, bee) {
    const b = bee.batch({ update: false })
    const keys = [null, null, null]

    for (const node of batch) {
      const { event, timestamp } = node.value
      const timestampMS = (new Date(timestamp)).getTime()

      const feedKey = b4a.toString(node.from.key, 'hex')

      const lexicographicSeq = lexint.pack(node.length, 'hex')
      // By event
      const eventKey = [EVENT_PREFIX, event, timestampMS, feedKey, lexicographicSeq]
        .join('!')
      // By Time
      const timeKey = [TIME_PREFIX, timestampMS, event, feedKey, lexicographicSeq]
        .join('!')
      // By input key
      const inputKey = [KEY_PREFIX, feedKey, lexicographicSeq]
        .join('!')

      keys[0] = eventKey
      keys[1] = timeKey
      keys[2] = inputKey

      for (const key of keys) {
        await b.put(key, node.value)
      }
    }

    await b.flush()
  }

  on (event, cb) {
    assert(typeof event === 'string', 'event must be a string')
    assert(typeof cb === 'function',
      'second argument must be a callback function')

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

    return this.autobase.append(eventObj)
  }

  async append (...args) {
    return this.autobase.append(...args)
  }

  async close () {
    await this.autobase.close()
  }
}
