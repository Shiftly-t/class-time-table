const assert = require('node:assert/strict');
const { test } = require('node:test');

test('workspace scroll is restored after layout and does not carry across sessions', async () => {
  const { installWorkspaceScroll } = await import('../workspace-scroll.js');
  const panel = { hidden: false };
  const listeners = new Map();
  const timers = new Set();
  let resize, maxScroll = 300;

  const env = {
    scrollY: 0,
    scrollTo(_left, top) {
      this.scrollY = Math.min(top, maxScroll);
    },
    addEventListener(type, callback) {
      listeners.set(type, callback);
    },
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe(target) {
        assert.equal(target, panel);
      }
    },
    setTimeout(callback) {
      timers.add(callback);
      return callback;
    },
    clearTimeout(callback) {
      timers.delete(callback);
    },
  };

  const scroll = installWorkspaceScroll(panel, env);
  scroll.restore('dashboard');
  env.scrollY = 240;
  scroll.remember();
  scroll.restore('calendar');
  assert.equal(env.scrollY, 0);

  maxScroll = 30;
  scroll.restore('dashboard');
  assert.equal(env.scrollY, 30);
  assert.equal(timers.size, 1);
  scroll.restore('dashboard');
  assert.equal(timers.size, 1);

  maxScroll = 400;
  resize();
  assert.equal(env.scrollY, 240);
  assert.equal(timers.size, 0);

  maxScroll = 30;
  scroll.restore('dashboard');
  listeners.get('wheel')();
  maxScroll = 400;
  resize();
  assert.equal(env.scrollY, 30);
  assert.equal(timers.size, 0);

  scroll.reset();
  assert.equal(scroll.page, '');
  scroll.restore('dashboard');
  assert.equal(env.scrollY, 0);
});
