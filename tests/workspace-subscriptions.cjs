const assert = require('node:assert/strict');
const { test } = require('node:test');

test('restarts and session changes suppress stale snapshots and errors', async () => {
  const { createWorkspaceSubscriptions } = await import('../workspace-subscriptions.js');
  const subscriptions = [];
  const unsubscribeCalls = [];
  const received = [];
  let session = 1;

  const group = createWorkspaceSubscriptions(
    (ref, next, error) => {
      subscriptions.push({ next, error });
      return () => unsubscribeCalls.push(ref);
    },
    () => {
      const startedWith = session;
      return () => startedWith === session;
    },
  );
  const subscribe = ref => group.subscribe(ref, value => received.push(value), error => received.push(error));
  subscribe('original');
  subscriptions[0].next('original snapshot');
  group.clear();
  subscribe('restarted');

  subscriptions[0].next('stale snapshot');
  subscriptions[0].error('stale error');
  subscriptions[1].next('restarted snapshot');

  session++;
  subscriptions[1].error('old session error');
  group.clear();
  group.clear();

  assert.deepEqual(received, ['original snapshot', 'restarted snapshot']);
  assert.deepEqual(unsubscribeCalls, ['original', 'restarted']);
});

test('workspace records allocate new mutable data for each sign-in', async () => {
  const { emptySessionRecords, emptyTeacherWorkRecords, emptyWorkspaceRecords } = await import('../workspace-state.js');
  const oldSession = emptySessionRecords();
  oldSession.officialSeenIds.add('announcement');
  oldSession.availability.set('course/user', { slots: [] });
  const workspace = emptyWorkspaceRecords();
  workspace.students.push({ id: 'student' });

  assert.equal(emptySessionRecords().officialSeenIds.size, 0);
  assert.equal(emptySessionRecords().availability.size, 0);
  assert.deepEqual(emptyWorkspaceRecords().students, []);
  assert.equal(emptyTeacherWorkRecords(false).teacherWeeklyWorkStatus, 'disabled');
  assert.equal(emptyTeacherWorkRecords(true).teacherDateWorkStatus, 'loading');
});
