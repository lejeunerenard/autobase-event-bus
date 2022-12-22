import test from 'tape'
import Corestore from 'corestore'
import RAM from 'random-access-memory'

import { EventBus } from '../index.js'

async function asyncThrows (fn, err, t, message = 'throws') {
  try {
    await fn()
    t.fail(message)
  } catch (e) {
    if (err && e.message.match(err)) {
      t.pass(message)
    } else if (!err) {
      t.pass(message)
    } else {
      t.fail(message)
      console.error(e)
    }
  }
}

test('EventBus', (t) => {
  t.test('construction', (t) => {
    const bus = new EventBus()

    // Public properties
    t.ok(bus.autobase, 'has autobase property')
    t.equals(typeof bus.on, 'function', 'has `on` function')
    t.equals(typeof bus.emit, 'function', 'has `emit` function')

    t.end()
  })

  t.test('emit', async (t) => {
    const corestore = new Corestore(RAM)
    const errorEmitBus = new EventBus(corestore, { localInput: null })

    await asyncThrows(async () =>
      await errorEmitBus.emit('beep', 'foo', 2, 'baz'),
    /No localInput hypercore provided/, t,
    'throws when no localInput is defined')

    // Normal use
    const bus = new EventBus(corestore, {
      valueEncoding: 'json',
      localInput: corestore.get({ name: 'emitLocalInput' })
    })
    try {
      await bus.emit('beep', 'foo', 2, 'baz')
      t.pass('doesnt throw w/ normal use')
    } catch (e) {
      t.fail('doesnt throw w/ normal use')
      console.error(e)
    }

    t.end()
  })

  t.test('on', async (t) => {
    t.plan(2)

    const corestore = new Corestore(RAM)

    const errorEmitBus = new EventBus(corestore)
    t.throws(() => errorEmitBus.on(), /event must be a string/,
      'throws when no event is given')

    // Normal use
    const mine = corestore.get({ name: 'onLocalInput' })
    const bus = new EventBus(corestore, {
      eagerUpdate: true,
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      inputs: [mine],
      localInput: mine
    })

    const tasks = [
      new Promise((resolve, reject) => {
        bus.on('beep', () => {
          t.pass('beep callback was fired')
          resolve()
        })
      }),
      bus.emit('beep')
    ]

    return Promise.all(tasks).then(bus.close.bind(bus))
  })

  t.end()
})
