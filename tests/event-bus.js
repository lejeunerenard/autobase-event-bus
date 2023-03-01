import test from 'tape'
import Corestore from 'corestore'
import RAM from 'random-access-memory'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'

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

  t.test('close', async (t) => {
    const bus = new EventBus()

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
      const corestore = new Corestore(RAM)
      const errorEmitBus = new EventBus({ localInput: null })

      await asyncThrows(async () =>
        await errorEmitBus.emit('beep', 'foo', 2, 'baz'),
      /No localInput hypercore provided/, t,
      'throws when no localInput is defined')

      // Normal use
      const bus = new EventBus({
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
    t.test('object arguments', async (t) => {
      const corestore = new Corestore(RAM)

      const bus = new EventBus({
        valueEncoding: 'json',
        localInput: corestore.get({ name: 'emitLocalInput' })
      })

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

      const corestore = new Corestore(RAM)

      const errorEmitBus = new EventBus()
      t.throws(() => errorEmitBus.on(), /event must be a string/,
        'throws when no event is given')

      // Normal use
      const mine = corestore.get({ name: 'onLocalInput' })
      const bus = new EventBus({
        autostart: true,
        eagerUpdate: false,
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        inputs: [mine],
        localInput: mine
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

      await bus.autobase.view.update()
      await listenerDone

      await bus.close()
    })

    t.test('w/ eagerUpdate true', async (t) => {
      t.plan(2)

      const corestore = new Corestore(RAM)

      // Normal use
      const mine = corestore.get({ name: 'onLocalInput' })
      const mineOut = corestore.get({ name: 'onLocalOut' })
      const bus = new EventBus({
        autostart: true,
        eagerUpdate: true,
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        inputs: [mine],
        localInput: mine,
        localOutput: mineOut
      })

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

      await bus.close()
    })

    t.test('doesnt refire when linearized core resequences', async (t) => {
      t.plan(2)

      const corestore = new Corestore(RAM)

      // Bus 1
      const input1 = corestore.get({ name: 'input1' })
      const out1 = corestore.get({ name: 'out1' })
      const bus1 = new EventBus({
        autostart: true,
        eagerUpdate: false,
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        inputs: [input1],
        localInput: input1,
        localOutput: out1
      })

      // Bus 2
      const core2 = corestore.get({ name: 'input2' })
      const out2 = corestore.get({ name: 'out2' })
      const bus2 = new EventBus({
        autostart: true,
        eagerUpdate: false,
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        inputs: [core2],
        localInput: core2,
        localOutput: out2
      })

      let timesBus1EventWasCalled = 0

      bus1.on('bus1Event', ({ data }) => {
        timesBus1EventWasCalled++
        if (timesBus1EventWasCalled === 1) {
          t.pass('bus1Event callback on bus1 was fired')
        } else {
          t.fail('bus1Event callback on bus1 was called more than once')
        }
      })
      bus2.on('bus2Event', () => {
        t.pass('bus2Event callback on bus2 was fired')
      })

      const tasks = [
        bus1.emit('bus1Event', 'a'),
        bus1.emit('filler'),
        bus2.emit('bus2Event'),
        bus2.emit('filler'),
        bus2.emit('filler'),
        bus2.emit('filler')
      ]
      await Promise.all(tasks)

      // Ensure updated
      await bus1.autobase.view.update()
      await bus2.autobase.view.update()

      // Add bus2 input to bus1 to emulate delayed sync
      await bus1.autobase.addInput(core2)
      await bus1.autobase.view.update()

      const closePromise = new Promise((resolve, reject) => {
        setTimeout(async () => {
          await bus1.close()
          await bus2.close()
          resolve()
        }, 200)
      })

      await closePromise
    })

    t.test('fires event when emit is fired during indexing', async (t) => {
      t.plan(1)
      const corestore = new Corestore(RAM)

      // Bus 1
      const input1 = corestore.get({ name: 'input1' })
      const out1 = corestore.get({ name: 'out1' })
      const bus = new EventBus({
        autostart: true,
        eagerUpdate: false,
        keyEncoding: 'utf-8',
        valueEncoding: 'json',
        inputs: [input1],
        localInput: input1,
        localOutput: out1
      })

      bus.on('bar', () => {
        t.pass('bar fired')
      })

      // TODO Figure out how to not trigger apply/update from setupEventStream
      // running. The solution might be a more intelligent way to kick it off
      // than the autobase append event.
      bus.autobase.view.feed.on('append', () => {
        console.log('bus hyperbee append fired')
      })

      for (let i = 0; i < 1_000; i++) {
        await bus.emit('beep' + i)
      }
      console.log('done emitting beep')

      bus.autobase.view.update()
      await bus.emit('bar')
      console.log('after emit bar')
      try {
        console.log('before view update')
        await bus.autobase.view.update()
        console.log('after view update')
      } catch (e) {
        console.error('catch e', e)
      }

      const closePromise = new Promise((resolve, reject) => {
        setTimeout(async () => {
          await bus.close()
          resolve()
        }, 200)
      })

      await closePromise
      t.end()
    })
  })

  t.test('supports other indexes', async (t) => {
    t.plan(6)

    const corestore = new Corestore(RAM)

    // Normal use
    const mine = corestore.get({ name: 'onLocalInput' })
    const bus = new EventBus({
      autostart: true,
      eagerUpdate: false,
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      inputs: [mine],
      localInput: mine
    })

    const secondaryOptions = {
      eagerUpdate: false,
      inputs: [mine],
      localInput: mine,
      keyEncoding: 'utf-8',
      valueEncoding: 'json'
    }
    const secondaryIndex = new Autobase({
      ...secondaryOptions,
      autostart: false
    })

    secondaryIndex.start({
      unwrap: true,
      apply: async (bee, batch) => {
        const b = bee.batch({ update: false })
        for (const node of batch) {
          const eventObj = JSON.parse(node.value)
          const { timestamp, data } = eventObj
          const timestampMS = (new Date(timestamp)).getTime()

          const firstArg = data[0]

          await Promise.all([
            // By event
            b.put(['props', Object.keys(firstArg).join(','), timestampMS, node.id, node.seq].join('!'), eventObj)
          ])
        }

        await b.flush()
      },
      view: (core) => new Hyperbee(core.unwrap(), {
        ...secondaryOptions,
        extension: false
      })
    })

    bus.on('beep', () => {
      t.pass('beep callback was fired')
    })

    const tasks = [
      bus.emit('beep', { boop: true }),
      bus.emit('foo', { fizz: 'buzz' })
    ]

    await Promise.all(tasks)

    await bus.autobase.view.update()
    await secondaryIndex.view.update()

    const secondaryKeys = []
    for await (const node of secondaryIndex.view.createReadStream({ gt: 'props!', lt: 'props"' })) {
      secondaryKeys.push(node.key.toString())
    }

    t.match(secondaryKeys[0], /props!boop/, 'found boop key')

    const foundEvents = []
    for await (const node of bus.autobase.view.createReadStream({ gt: 'event!', lt: 'event"' })) {
      foundEvents.push(node.key.toString())
    }
    t.match(foundEvents[0], /event!beep/, 'found original beep')
    t.match(foundEvents[1], /event!foo/, 'found original foo')

    const foundTimes = []
    for await (const node of bus.autobase.view.createReadStream({ gt: 'time!', lt: 'time"' })) {
      foundTimes.push(node.key.toString())
    }
    t.match(foundTimes[0], /time!\d+!beep/, 'found original beep time')
    t.match(foundTimes[1], /time!\d+!foo/, 'found original foo time')

    await bus.close()
  })

  t.test('replication', async (t) => {
    t.plan(3)

    const corestore = new Corestore(RAM)
    const mine = corestore.get({ name: 'onLocalInput' })
    const output1 = corestore.get({ name: 'onLocalOutput' })

    const corestore2 = new Corestore(RAM)
    const mine2 = corestore2.get({ name: 'onLocalInput' })
    const output2 = corestore2.get({ name: 'onLocalOutput' })

    await Promise.all([
      mine.ready(),
      mine2.ready()
    ])

    const mineFrom2 = corestore2.get(mine.key)
    const mine2From1 = corestore.get(mine2.key)

    const peerB = new EventBus({
      eagerUpdate: true,
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      inputs: [mine, mine2From1],
      localInput: mine,
      localOutput: output1
    })
    const peerA = new EventBus({
      eagerUpdate: true,
      keyEncoding: 'utf-8',
      valueEncoding: 'json',
      inputs: [mine2, mineFrom2],
      localInput: mine2,
      localOutput: output2
    })

    peerB.start()
    peerA.start()

    const stream1 = corestore.replicate(true, { live: true })
    const stream2 = corestore2.replicate(false, { live: true })
    stream1.pipe(stream2).pipe(stream1)

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

    await peerB.close()
    await peerA.close()
    t.end()
  })

  t.end()
})
