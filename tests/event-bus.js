import test from 'tape'
import Corestore from 'corestore'
import RAM from 'random-access-memory'

import { EventBus } from '../index.js'
import { applyWriterManagement } from './helper.mjs'

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
    const corestore = new Corestore(RAM.reusable())
    const bus = new EventBus(corestore)

    // Public properties
    t.ok(bus.autobase, 'has autobase property')
    t.equals(typeof bus.on, 'function', 'has `on` function')
    t.equals(typeof bus.emit, 'function', 'has `emit` function')

    t.end()
  })

  t.test('close', async (t) => {
    const corestore = new Corestore(RAM.reusable())
    const bus = new EventBus(corestore)

    // Public properties
    t.ok(bus.autobase, 'has autobase property')

    try {
      await bus.close()
      t.pass('doesnt throw w/ normal use')
    } catch (e) {
      t.fail('doesnt throw w/ normal use')
      console.error(e)
    }

    t.end()
  })

  t.test('emit', async (t) => {
    t.test('basic usage', async (t) => {
      const corestore = new Corestore(RAM.reusable())

      // Normal use
      const bus = new EventBus(corestore, null, { valueEncoding: 'json' })
      try {
        await bus.emit('beep', 'foo', 2, 'baz')
        t.pass('doesnt throw w/ normal use')
      } catch (e) {
        t.fail('doesnt throw w/ normal use')
        console.error(e)
      }

      t.end()
    })

    t.test('object arguments', async (t) => {
      const corestore = new Corestore(RAM.reusable())

      const bus = new EventBus(corestore, null, { valueEncoding: 'json' })

      await asyncThrows(async () =>
        await bus.emit({}),
      /event must be a string/, t,
      'throws when no event property isnt a string')

      await asyncThrows(async () =>
        await bus.emit({ event: 'beep', timestamp: '2001-01-07' }),
      /timestamp must be a Date/, t,
      'throws when timestamp property isnt a Date obj')

      // Normal use
      try {
        await bus.emit({
          event: 'foo',
          data: ['bar'],
          timestamp: new Date('2020-07-08')
        })
        t.pass('doesnt throw w/ correct object argument use')
      } catch (e) {
        t.fail('doesnt throw w/ correct object argument use')
        console.error(e)
      }
    })
  })

  t.test('on', async (t) => {
    t.test('w/ eagerUpdate false', async (t) => {
      t.plan(2)

      const corestoreError = new Corestore(RAM.reusable())

      const errorEmitBus = new EventBus(corestoreError, [])
      t.throws(() => errorEmitBus.on(), /event must be a string/,
        'throws when no event is given')
      await errorEmitBus.close()

      // Normal use
      const corestore = new Corestore(RAM.reusable())
      const bus = new EventBus(corestore, null, {
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      })

      const listenerDone = new Promise((resolve, reject) => {
        bus.on('beep', () => {
          t.pass('beep callback was fired')
          resolve()
        })
      })

      const tasks = [
        bus.emit('beep'),
        bus.emit('boop')
      ]
      await Promise.all(tasks)

      await bus.update()
      await listenerDone

      await bus.close()
    })

    t.test('w/ eagerUpdate true', async (t) => {
      t.plan(2)

      const corestore = new Corestore(RAM.reusable())

      // Normal use
      const bus = new EventBus(corestore, null, {
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      })
      await bus.ready()

      const tasks = [
        new Promise((resolve, reject) => {
          bus.on('beep', () => {
            t.pass('beep callback was fired')
            resolve()
          })
        }),
        bus.emit('beep'),
        bus.emit('boop'),
        new Promise((resolve, reject) => {
          setTimeout(() => {
            bus.on('after', () => {
              t.pass('after callback was fired later')
              resolve()
            })
          }, 10)
        }),
        new Promise((resolve, reject) => {
          setTimeout(() => {
            bus.emit('after', 1337)
            resolve()
          }, 50)
        })
      ]

      await Promise.all(tasks)
    })

    t.test('doesnt refire when linearized core resequences', async (t) => {
      t.plan(3)

      const corestore = new Corestore(RAM.reusable())
      const corestore2 = new Corestore(RAM.reusable())

      const [apply, addWriter] = applyWriterManagement(false)

      // Bus 1
      const bus1 = new EventBus(corestore, null, {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        apply
      })

      await bus1.ready()

      // Bus 2
      const bus2 = new EventBus(corestore2, [bus1.autobase.local.key], {
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        apply
      })

      await bus2.ready()

      const stream1 = corestore.replicate(true)
      const stream2 = corestore2.replicate(false)
      stream1.pipe(stream2).pipe(stream1)

      // Add other bus
      await addWriter(bus1.autobase, bus2.autobase.local.key)

      let timesBus1EventWasCalled = 0
      let timesAEventWasCalled = 0

      bus1.on('message1:bus1', ({ data }) => {
        timesBus1EventWasCalled++
        if (timesBus1EventWasCalled === 1) {
          t.pass('message1:bus1 callback on bus1 was fired')
        } else {
          t.fail('message1:bus1 callback on bus1 was called more than once')
        }
      })
      bus1.on('amessage2:bus1', ({ data }) => {
        timesAEventWasCalled++
        if (timesAEventWasCalled === 1) {
          t.pass('amessage2:bus1 callback on bus1 was fired')
        } else {
          t.fail('amessage2:bus1 callback on bus1 was called more than once')
        }
      })
      bus2.on('message1:bus2', () => {
        t.pass('message1:bus2 callback on bus2 was fired')
      })

      await bus2.update()

      const tasks = [
        bus1.emit('filler:bus1', 'frombus1'),
        bus1.emit('message1:bus1', 'a'), // Must be after filler
        bus1.emit('amessage2:bus1'), // Must be after bus1 so it comes before when hyperbee is queried via event name
        bus2.emit('message1:bus2'),
        bus2.emit('filler:bus2', 'frombus2'),
        bus2.emit('filler:bus2', 'frombus2'),
        bus2.emit('filler:bus2', 'frombus2')
      ]
      await Promise.all(tasks)
    })

    t.test('fires event when emit is fired during indexing', async (t) => {
      t.plan(1)
      const corestore = new Corestore(RAM.reusable())

      // Bus 1
      const bus = new EventBus(corestore, null, {
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      })

      bus.on('bar', () => {
        t.pass('bar fired')
      })

      // // TODO Figure out how to not trigger apply/update from setupEventStream
      // // running. The solution might be a more intelligent way to kick it off
      // // than the autobase append event.
      // bus.autobase.view.feed.on('append', () => {
      //   console.log('bus hyperbee append fired')
      // })

      for (let i = 0; i < 1_000; i++) {
        await bus.emit('beep' + i)
      }

      bus.update()
      await bus.emit('bar')
      try {
        await bus.update()
      } catch (e) {
        console.error('catch e', e)
      }

      await bus.close()
      t.end()
    })

    t.test('`*` support', async (t) => {
      t.plan(4)
      const store = new Corestore(RAM.reusable())

      const bus = new EventBus(store, null, {
        keyEncoding: 'utf-8',
        valueEncoding: 'json'
      })

      let starCalled = 0
      const starEvents = {}
      const listenerDone = Promise.all([
        new Promise((resolve, reject) => {
          bus.on('beep', () => {
            t.pass('beep callback was fired')
            resolve()
          })
        }),
        new Promise((resolve, reject) => {
          bus.on('*', (event) => {
            t.pass('* callback was fired')
            starEvents[event.event] = starEvents[event.event] || 0
            starEvents[event.event]++
            starCalled++
            if (starCalled === 2) {
              resolve()
            }
          })
        })
      ])

      const tasks = [
        bus.emit('beep'),
        bus.emit('boop')
      ]
      await Promise.all(tasks)

      await listenerDone

      t.deepEqual(starEvents, { beep: 1, boop: 1 }, 'recevied both event types')

      await bus.close()
    })
  })

  t.test('update()', async (t) => {
    const corestore = new Corestore(RAM.reusable())

    // Normal use
    const bus = new EventBus(corestore, null, { valueEncoding: 'json' })
    let beepsReceived = 0
    bus.on('beep', () => {
      beepsReceived++
    })

    for (let i = 0; i < 10; i++) {
      bus.emit('beep', 'foo' + i)
    }

    t.equals(beepsReceived, 0, 'events havent triggered')
    await bus.update()
    t.equals(beepsReceived, 10, 'update triggers events')
  })

  t.test('replication', async (t) => {
    t.plan(3)

    const corestore = new Corestore(RAM.reusable())
    const corestore2 = new Corestore(RAM.reusable())

    const [apply, addWriter] = applyWriterManagement(false)

    const peerA = new EventBus(corestore2, null, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      apply
    })
    await peerA.ready()

    const peerB = new EventBus(corestore, [peerA.autobase.local.key], {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      apply
    })
    await peerB.ready()

    const stream1 = corestore.replicate(true, { live: true })
    const stream2 = corestore2.replicate(false, { live: true })
    stream1.pipe(stream2).pipe(stream1)

    // Add other bus
    await addWriter(peerA.autobase, peerB.autobase.local.key)

    const expectedCalls = 83
    let pingCalls = 0
    let pingCallReceived = 0
    let pongCallReceived = 0
    const debounceMS = 50
    let debounceBeep = null
    let debouncePong = null

    const tasks = [
      new Promise((resolve, reject) => {
        peerB.on('ping', async ({ data: [{ calls }] }) => {
          pingCallReceived++
          await peerB.emit('pong', pingCallReceived)
          clearTimeout(debounceBeep)
          debounceBeep = setTimeout(resolve, debounceMS)
        })
      }),
      new Promise((resolve, reject) => {
        peerA.on('pong', ({ data: [calls] }) => {
          pongCallReceived++
          clearTimeout(debouncePong)
          debouncePong = setTimeout(resolve, debounceMS)
        })
      }),

      new Promise((resolve, reject) => {
        const emitInterval = setInterval(async () => {
          pingCalls++
          await peerA.emit('ping', { boop: true, calls: pingCalls })
          if (pingCalls === expectedCalls) {
            clearInterval(emitInterval)
            resolve()
          }
        }, 20)
      })
    ]

    await Promise.all(tasks)

    t.equals(pingCalls, expectedCalls, 'ping was emitted the correct number of times')
    t.equals(pingCallReceived, expectedCalls, 'ping was received the correct number of times')
    t.equals(pongCallReceived, expectedCalls, 'pong response was received the correct number of times')

    t.end()
  })

  t.test('apply function can be extended', async (t) => {
    t.plan(2)
    const corestore = new Corestore(RAM.reusable())

    const bus = new EventBus(corestore, null, {
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      apply: async (batch, bee, base) => {
        await EventBus.eventIndexesApply.apply(bus, [batch, bee, base])

        const b = bee.batch({ update: false })
        const existing = await b.get('total')
        let total = existing ? existing.value : 0

        for (const node of batch) {
          const eventObj = node.value
          const { event, data } = eventObj
          if (event === 'click') {
            total += Number(data)
          }
        }

        await b.put('total', total)
        await b.flush()
      }
    })

    await bus.ready()

    let bizCalled = false
    bus.on('biz', () => {
      t.ok(!bizCalled, 'first call of event handler')
      bizCalled = true
    })

    await bus.emit('click', 1)
    await bus.emit('click', 2)
    await bus.emit('biz', 2)
    await bus.emit('click', 3)

    const total = await bus.autobase.view.get('total')
    t.equals(total.value, 6)
  })

  t.end()
})
