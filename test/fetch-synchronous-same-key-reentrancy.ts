import t from 'tap'
import { LRUCache } from '../dist/esm/node/index.js'

/**
 * Characterization only: fetchMethod runs synchronously inside the Promise
 * executor, before the new BackgroundFetch promise is installed in the cache.
 * These controls record what happens when that callback mutates the same key.
 */
t.test('synchronous same-key set is replaced by the pending fetch', async t => {
  const deferred = Promise.withResolvers<number>()
  const disposed: Array<[number, number, string]> = []
  let cache: LRUCache<number, number>

  cache = new LRUCache<number, number>({
    max: 10,
    dispose: (value, key, reason) => disposed.push([key, value, reason]),
    fetchMethod: key => {
      cache.set(key, 10)
      return deferred.promise
    },
  })

  const fetching = cache.fetch(1)

  t.equal(cache.size, 1)
  t.equal(cache.peek(1), undefined)
  t.same(disposed, [[1, 10, 'set']])

  deferred.resolve(20)
  t.equal(await fetching, 20)
  t.equal(cache.get(1), 20)
})

t.test('rejected fetch removes a synchronous same-key write', async t => {
  const deferred = Promise.withResolvers<number>()
  let cache: LRUCache<number, number>

  cache = new LRUCache<number, number>({
    max: 10,
    fetchMethod: key => {
      cache.set(key, 10)
      return deferred.promise
    },
  })

  const fetching = cache.fetch(1)
  deferred.reject(new Error('fetch failed'))

  await t.rejects(fetching, { message: 'fetch failed' })
  t.equal(cache.has(1), false)
  t.equal(cache.peek(1), undefined)
})

t.test('same-key delete during dispatch does not cancel insertion', async t => {
  const deferred = Promise.withResolvers<number>()
  let cache: LRUCache<number, number>

  cache = new LRUCache<number, number>({
    max: 10,
    fetchMethod: key => {
      cache.set(key, 10)
      t.equal(cache.delete(key), true)
      return deferred.promise
    },
  })

  const fetching = cache.fetch(1)
  t.equal(cache.size, 1)
  t.equal(cache.peek(1), undefined)

  deferred.resolve(20)
  t.equal(await fetching, 20)
  t.equal(cache.get(1), 20)
})

t.test('different-key synchronous writes remain authoritative', async t => {
  const deferred = Promise.withResolvers<number>()
  let cache: LRUCache<number, number>

  cache = new LRUCache<number, number>({
    max: 10,
    fetchMethod: () => {
      cache.set(2, 10)
      return deferred.promise
    },
  })

  const fetching = cache.fetch(1)
  t.equal(cache.get(2), 10)

  deferred.resolve(20)
  t.equal(await fetching, 20)
  t.equal(cache.get(1), 20)
  t.equal(cache.get(2), 10)
})
