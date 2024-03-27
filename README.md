# Autobase Event Bus

A peer-to-peer event bus using
[`autobase`](https://github.com/holepunchto/autobase) for hypercore multi-writer
support.

## Install

```bash
npm i lejeunerenard/autobase-event-bus
```

## Usage

```js
import RAM from 'random-access-memory'
import Corestore from 'corestore'
import EventBus from '@lejeunerenard/autobase-event-bus'

const store1 = new Corestore(RAM.reusable())
const bus1 = new EventBus(store1, null, {
  keyEncoding: 'utf-8',
  valueEncoding: 'json',
  apply
})
await bus1.ready()

const store2 = new Corestore(RAM.reusable())
const bus2 = new EventBus(store2, bus1.autobase.key, {
  keyEncoding: 'utf-8',
  valueEncoding: 'json',
  apply
})
await bus2.ready()

bus2.on('ping', async () => {
  console.log('got "ping"')
  await bus2.emit('pong')
})

// Replicate peers
const stream1 = store1.replicate(true)
const stream2 = store2.replicate(false)
stream1.pipe(stream2).pipe(stream1)

// Add bus2 as writer
await bus1.append({
  add: bus2.autobase.local.key
})

bus1.on('pong', async () => {
  console.log('got "pong"')
})
await bus1.emit('ping')

async function apply (batch, bee, base) {
  // Add writer logic
  return EventBus.eventIndexesApply(nonWriterNodes, bee, base)
}
```

## API

### `EventBus`

#### `const bus = new EventBus(store, bootstrap, opts = {})`

Create a event bus instance. Takes the same arguments as `autobase` but with the
`opts` being passed also to the underlying `hyperbee` and `opts.valueEncoding`
being used for the view's core. Defaults for `opts`:

```
{
  // same defaults as autobase
  apply: EventBus.eventIndexesApply
}
```

#### `await bus.emit(event, ...args)`

Emit an `event` with the following `args`. The event will automatically have the
local time added to the event object appended to the `autobase`'s local core.
Alternatively the entire event object can be passed in like so:

```js
await bus.emit({
  event: 'foo',
  data: ['arg1', 'arg2']
  timestamp: new Date('1955-11-05')
})
```

#### `await bus.on(event, callback)`

Listen for an `event`, calling the `callback` when the `event` is triggered. A
special wild card event `*` will call the `callback` with every event. For
non-wild card events, the `callback` is called with an object of the form:

```js
{
  data: [...args],
  timestamp: new Date('1955-11-05')
}
```

Wild card events will receive the entire event object appended to the
`autobase`'s local core. Default events will look like:

```js
{
  event: 'foo',
  data: [...args],
  timestamp: new Date('1955-11-05')
}
```

#### `await bus.ready()`

Wait for the underlying `autobase` to be ready.

#### `await bus.append()`

Append block to `autobase`'s local core directly.

#### `await bus.close()`

Close the event bus and it's underlying `autobase`.

#### `static EventBus.eventIndexesApply(batch, bee)`

The apply function for supporting event blocks and adding them to the `bus`'s
`hyperbee`. The `bus`'s `apply` function will default to this static function.
If a custom `apply` is defined, it is recommended it is composed with
`eventIndexesApply` to support the event listeners via `.on(event, callback)`.
