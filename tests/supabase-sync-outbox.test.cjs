const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
let persistedQueue = null;
let eventUpload = async () => ({ error: null });
let uuid = 0;
let userPresent = true;
let profileActive = true;

Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: {
      getItem: async () => persistedQueue,
      setItem: async (_key, value) => { persistedQueue = value; },
      removeItem: async () => { persistedQueue = null; },
    } };
  }
  if (request === 'expo-crypto') {
    return { randomUUID: () => `event-${++uuid}` };
  }
  if (request === '../template/core/client') {
    return { getSharedSupabaseClient: () => ({
      auth: { getUser: async () => ({ data: { user: userPresent ? { id: 'user-1' } : null }, error: null }) },
      from: (table) => {
        if (table === 'pharmacy_profiles') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: profileActive ? { pharmacy_id: 'pharmacy-1', active: true } : null,
            error: null,
          }) }) }) };
        }
        if (table === 'pharmacy_sync_events') {
          return { upsert: async (...args) => eventUpload(...args) };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const outbox = require('../.test-build/services/supabase-sync-outbox.js');

function input(id) {
  return { client_id: 'device-1', entity_type: 'product', entity_id: id, operation: 'upsert', payload: { id } };
}
function queueRows() {
  return persistedQueue ? JSON.parse(persistedQueue) : [];
}

test('concurrent enqueue operations preserve every event', async () => {
  persistedQueue = null;
  const ids = await Promise.all(Array.from({ length: 40 }, (_, i) => outbox.enqueueSyncEvent(input(i + 1))));
  assert.equal(new Set(ids).size, 40);
  assert.equal(queueRows().length, 40);
  assert.deepEqual(new Set(queueRows().map(row => row.event_id)), new Set(ids));
});

test('an event enqueued during network upload survives flush acknowledgement', async () => {
  persistedQueue = null;
  await outbox.enqueueSyncEvent(input('before'));
  let beginUpload;
  let finishUpload;
  const uploadStarted = new Promise(resolve => { beginUpload = resolve; });
  const uploadGate = new Promise(resolve => { finishUpload = resolve; });
  eventUpload = async () => { beginUpload(); await uploadGate; return { error: null }; };

  const flushing = outbox.flushSyncOutbox();
  await uploadStarted;
  const duringId = await outbox.enqueueSyncEvent(input('during'));
  finishUpload();
  const result = await flushing;

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(queueRows().map(row => row.event_id), [duringId]);
  eventUpload = async () => ({ error: null });
});

test('failed upload retains event and records retry metadata', async () => {
  persistedQueue = null;
  await outbox.enqueueSyncEvent(input('retry'));
  eventUpload = async () => ({ error: { message: 'temporary network failure' } });
  const result = await outbox.flushSyncOutbox();

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(queueRows().length, 1);
  assert.equal(queueRows()[0].attempts, 1);
  assert.equal(queueRows()[0].last_error, 'temporary network failure');
  eventUpload = async () => ({ error: null });
});

test('missing authentication leaves queued events untouched', async () => {
  persistedQueue = null;
  await outbox.enqueueSyncEvent(input('auth'));
  const before = persistedQueue;
  userPresent = false;
  const result = await outbox.flushSyncOutbox();
  userPresent = true;

  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'AUTH_REQUIRED');
  assert.equal(persistedQueue, before);
});
