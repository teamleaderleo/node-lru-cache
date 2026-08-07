import t from 'tap'
import { LRUCache, type BackgroundFetch } from '../dist/esm/node/index.js'

const clock = t.clock
clock.advance(1)
clock.enter()

t.test('background fetch size tests', async t => {
  const res: Record<number, (n: number) => void> = {}
  const c = new LRUCache<number, number>({
    maxSize: 10,
    sizeCalculation: () => 5,
    allowStale: true,
    ttl: 10,
    // never returns on purpose
    fetchMethod: k =>
      new Promise<number>(r => {
        res[k] = r
      }),
  })
  t.equal(c.calculatedSize, 0)
  const p1 = c.fetch(1).catch(er => er)
  t.equal(c.calculatedSize, 1)
  c.set(1, 1)
  t.match(await p1, new Error('replaced'))
  t.equal(c.calculatedSize, 5)
  clock.advance(100)
  t.equal(c.getRemainingTTL(1), -90)
  // verify correct behavior of a fetch that shadows a stale value
  const p = c.fetch(1)
  t.equal(c.calculatedSize, 5)
  const p2 = c.fetch(2)
  t.equal(c.calculatedSize, 6)
  const p3 = c.fetch(3)
  t.equal(c.calculatedSize, 7)
  res[1]?.(1)
  await p
  // no change, that one had a stale value
  t.equal(c.calculatedSize, 7)
  res[2]?.(2)
  await p2
  t.equal(c.calculatedSize, 10)
  await t.rejects(p3, new Error('evicted'))
})

const hostileBackgroundFetchSize = {
  [Symbol.toPrimitive]() {
    throw new Error('must not coerce backgroundFetchSize')
  },
  valueOf() {
    throw new Error('must not coerce backgroundFetchSize')
  },
  toString() {
    throw new Error('must not coerce backgroundFetchSize')
  },
}

const invalidBackgroundFetchSizes: {
  label: string
  value: unknown
}[] = [
  { label: 'negative', value: -1 },
  { label: 'fractional', value: 1.5 },
  { label: 'NaN', value: Number.NaN },
  { label: 'positive infinity', value: Number.POSITIVE_INFINITY },
  { label: 'negative infinity', value: Number.NEGATIVE_INFINITY },
  { label: 'string', value: '2' },
  { label: 'boolean', value: true },
  { label: 'bigint', value: 1n },
  { label: 'symbol', value: Symbol('2') },
  { label: 'null', value: null },
  { label: 'object', value: {} },
  { label: 'array', value: [] },
  { label: 'hostile object', value: hostileBackgroundFetchSize },
]

const invalidMutatedBackgroundFetchSizes = [
  ...invalidBackgroundFetchSizes,
  { label: 'undefined', value: undefined },
]

const invalidBackgroundFetchSizeError = {
  name: 'TypeError',
  message: 'backgroundFetchSize must be a nonnegative integer',
}

t.test('backgroundFetchSize must be a nonnegative integer', t => {
  for (const { label, value } of invalidBackgroundFetchSizes) {
    t.throws(
      () =>
        new LRUCache({
          max: 1,
          backgroundFetchSize: value as number,
        }),
      invalidBackgroundFetchSizeError,
      label,
    )
  }

  t.doesNotThrow(
    () => new LRUCache({ max: 1, backgroundFetchSize: undefined }),
  )
  t.doesNotThrow(() => new LRUCache({ max: 1, backgroundFetchSize: 0 }))
  t.doesNotThrow(() => new LRUCache({ max: 1, backgroundFetchSize: 1 }))
  t.end()
})

t.test('mutated size is validated before fetch dispatch', async t => {
  let fetchCalls = 0
  const c = new LRUCache<number, number>({
    maxSize: 10,
    sizeCalculation: () => 5,
    fetchMethod: async key => {
      fetchCalls++
      return key
    },
  })

  for (const {
    label,
    value: backgroundFetchSize,
  } of invalidMutatedBackgroundFetchSizes) {
    c.backgroundFetchSize = backgroundFetchSize as number
    await t.rejects(
      c.fetch(fetchCalls),
      invalidBackgroundFetchSizeError,
      label,
    )
  }

  t.equal(fetchCalls, 0)
  t.equal(c.size, 0)
  t.equal(c.calculatedSize, 0)
})

t.test('fetch snapshots size across callback mutation', async t => {
  for (const [index, mutatedSize] of ['2', Number.NaN, -1].entries()) {
    const deferred = Promise.withResolvers<number>()
    let fetchCalls = 0
    let c: LRUCache<number, number>
    c = new LRUCache<number, number>({
      maxSize: 10,
      sizeCalculation: () => 5,
      backgroundFetchSize: 2,
      fetchMethod: async () => {
        fetchCalls++
        c.backgroundFetchSize = mutatedSize as unknown as number
        return deferred.promise
      },
    })

    const first = c.fetch(index)
    const second = c.fetch(index)

    t.equal(fetchCalls, 1, String(mutatedSize))
    t.equal(c.size, 1, String(mutatedSize))
    t.equal(c.calculatedSize, 2, String(mutatedSize))

    deferred.resolve(index)
    t.same(await Promise.all([first, second]), [index, index])
    t.equal(c.size, 1, String(mutatedSize))
    t.equal(c.calculatedSize, 5, String(mutatedSize))
  }
})

t.test('valid mutation applies only to the next fetch', async t => {
  const deferred = new Map<number, PromiseWithResolvers<number>>()
  let c: LRUCache<number, number>
  c = new LRUCache<number, number>({
    maxSize: 20,
    sizeCalculation: () => 5,
    backgroundFetchSize: 2,
    fetchMethod: async key => {
      if (key === 1) {
        c.backgroundFetchSize = 4
      }
      const result = Promise.withResolvers<number>()
      deferred.set(key, result)
      return result.promise
    },
  })

  const first = c.fetch(1)
  t.equal(c.calculatedSize, 2)

  const second = c.fetch(2)
  t.equal(c.calculatedSize, 6)

  deferred.get(1)?.resolve(1)
  deferred.get(2)?.resolve(2)
  t.same(await Promise.all([first, second]), [1, 2])
  t.equal(c.calculatedSize, 10)
})

t.test('mutated size is ignored without size tracking', async t => {
  let fetchCalls = 0
  const c = new LRUCache<number, number>({
    max: 1,
    fetchMethod: async key => {
      fetchCalls++
      return key
    },
  })

  c.backgroundFetchSize = '2' as unknown as number
  t.equal(await c.fetch(1), 1)
  t.equal(fetchCalls, 1)
  t.equal(c.size, 1)
})

t.test('mutated size is ignored for stale refresh', async t => {
  const deferred = Promise.withResolvers<number>()
  let fetchCalls = 0
  const c = new LRUCache<number, number>({
    maxSize: 10,
    sizeCalculation: () => 5,
    ttl: 10,
    backgroundFetchSize: 2,
    fetchMethod: async () => {
      fetchCalls++
      return deferred.promise
    },
  })

  c.set(1, 1)
  clock.advance(100)
  c.backgroundFetchSize = '2' as unknown as number
  const refresh = c.fetch(1)

  t.equal(fetchCalls, 1)
  t.equal(c.size, 1)
  t.equal(c.calculatedSize, 5)

  deferred.resolve(2)
  t.equal(await refresh, 2)
  t.equal(c.size, 1)
  t.equal(c.calculatedSize, 5)
})

t.test('backgroundFetchSize 0 retains in-flight coalescing', async t => {
  const deferred = Promise.withResolvers<number>()
  let fetchCalls = 0
  const c = new LRUCache<number, number>({
    maxSize: 10,
    sizeCalculation: () => 5,
    backgroundFetchSize: 0,
    fetchMethod: async () => {
      fetchCalls++
      return deferred.promise
    },
  })

  const first = c.fetch(1)
  const second = c.fetch(1)
  t.equal(fetchCalls, 1)
  t.equal(c.size, 1)
  t.equal(c.calculatedSize, 0)

  deferred.resolve(1)
  t.same(await Promise.all([first, second]), [1, 1])
  t.equal(c.size, 1)
  t.equal(c.calculatedSize, 5)
})

t.test('custom size is used while a fetch is pending', async t => {
  const deferred = Promise.withResolvers<number>()
  const c = new LRUCache<number, number>({
    maxSize: 10,
    sizeCalculation: () => 5,
    backgroundFetchSize: 2,
    fetchMethod: async () => deferred.promise,
  })

  const fetch = c.fetch(1)
  t.equal(c.calculatedSize, 2)
  deferred.resolve(1)
  t.equal(await fetch, 1)
  t.equal(c.calculatedSize, 5)
})

t.test(
  'corrupt internal provisional size is rejected on reinsertion',
  async t => {
    const deferred = Promise.withResolvers<number>()
    const c = new LRUCache<number, number>({
      maxSize: 10,
      sizeCalculation: () => 5,
      backgroundFetchSize: 2,
      fetchMethod: async () => deferred.promise,
    })

    const publicFetch = c.fetch(1)
    const internals = LRUCache.unsafeExposeInternals(c)
    const index = internals.keyMap.get(1)
    t.type(index, 'number')
    const backgroundFetch = internals.valList[
      index as number
    ] as BackgroundFetch<number>
    backgroundFetch.__size = Number.NaN

    t.throws(
      () => c.set(2, backgroundFetch as unknown as number),
      invalidBackgroundFetchSizeError,
    )
    t.equal(c.size, 1)
    t.equal(c.calculatedSize, 2)

    deferred.resolve(1)
    t.equal(await publicFetch, 1)
    t.equal(c.calculatedSize, 5)
  },
)
