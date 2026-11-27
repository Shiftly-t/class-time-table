const assert = require('node:assert/strict');
const { test } = require('node:test');

const qaTarget = {
  origin: 'https://shiftly-t-test.web.app',
  environment: 'qa',
  projectId: 'shiftly-t-test',
  databaseId: 'shiftly-qa-v1',
};

const productionTarget = {
  origin: 'https://shiftly-t.web.app',
  environment: 'production',
  projectId: 'shiftly-d02f6',
};

test('ranking selects the deployment-specific Firebase Callable names', async () => {
  const { resolveRankingCallableNames } = await import('../firebase-target.js');

  assert.deepEqual(resolveRankingCallableNames(qaTarget), {
    read: 'qaRankingReadApi',
    achievement: 'qaRankingAchievementApi',
  });
  assert.deepEqual(resolveRankingCallableNames(productionTarget), {
    read: 'rankingReadApi',
    achievement: 'rankingAchievementApi',
  });
});

test('ranking stays disabled when the origin, environment, project or database does not match', async () => {
  const { resolveRankingCallableNames } = await import('../firebase-target.js');

  for (const overrides of [
    { origin: productionTarget.origin },
    { origin: 'http://localhost:3000' },
    { origin: 'https://shiftly-t-test.web.app.example.invalid' },
    { environment: productionTarget.environment },
    { projectId: productionTarget.projectId },
    { databaseId: undefined },
    { databaseId: '(default)' },
  ]) {
    assert.equal(resolveRankingCallableNames({ ...qaTarget, ...overrides }), null, JSON.stringify(overrides));
  }

  for (const overrides of [
    { origin: qaTarget.origin },
    { environment: qaTarget.environment },
    { projectId: qaTarget.projectId },
    { databaseId: qaTarget.databaseId },
  ]) {
    assert.equal(
      resolveRankingCallableNames({ ...productionTarget, ...overrides }),
      null,
      JSON.stringify(overrides),
    );
  }
});
