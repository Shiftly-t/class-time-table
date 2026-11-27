const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

const root = path.resolve(process.env.SHIFTLY_TEST_APP_ROOT || path.join(__dirname, '../..'));
const contentTypes = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
};
const sdkFiles = new Set(
  ['app', 'auth', 'firestore', 'functions', 'app-check'].map(
    (name) => `https://www.gstatic.com/firebasejs/11.10.0/firebase-${name}.js`,
  ),
);
const engines = { chromium, webkit };
const selected = process.env.SHIFTLY_TEST_BROWSER;
const browsers = selected ? [selected] : Object.keys(engines);

async function localAsset(pathname, assetRoot = root) {
  const file = pathname === '/' ? 'index.html' : pathname.slice(1);
  const sdkPath = pathname === '/_tests/firebase-sdk.mjs';
  if (!sdkPath && !/^[\w.-]+\.(html|css|js)$/.test(file)) return { status: 404 };
  try {
    const source = await fs.readFile(
      sdkPath ? path.join(__dirname, 'firebase-sdk.mjs') : path.join(assetRoot, file),
    );
    return {
      status: 200,
      headers: {
        'content-type': contentTypes[path.extname(file)],
        'access-control-allow-origin': '*',
      },
      body: source,
    };
  } catch (error) {
    return { status: error.code === 'ENOENT' ? 404 : 500 };
  }
}

async function startServer() {
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const { status, headers, body } = await localAsset(pathname);
    response.writeHead(status, headers).end(body);
  });
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function launch(browserName) {
  assert.ok(engines[browserName], `Unsupported browser ${browserName}`);
  const executablePath = browserName === 'chromium' ? process.env.SHIFTLY_CHROMIUM_PATH : undefined;
  return engines[browserName].launch({ executablePath });
}

async function openPage(browser, server, options, virtualSite) {
  const siteOrigin = virtualSite?.origin || server.origin;
  const context = await browser.newContext({ serviceWorkers: 'block', ...options });
  const blocked = [];
  const pageErrors = [];
  const localFailures = [];
  context.on('page', (page) =>
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message)),
  );
  context.on('response', (response) => {
    if (response.url().startsWith(`${siteOrigin}/`) && response.status() >= 400) {
      localFailures.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  // Register the allowlist before creating a page. CDN modules are fulfilled locally.
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    const { origin, pathname } = new URL(url);
    if (sdkFiles.has(url)) {
      return route.fulfill({
        contentType: 'text/javascript',
        headers: { 'access-control-allow-origin': '*' },
        body: `export * from ${JSON.stringify(`${siteOrigin}/_tests/firebase-sdk.mjs`)};`,
      });
    }
    if (origin === siteOrigin) {
      // The synthetic Hosting origin is fulfilled from local files, never continued on the network.
      if (virtualSite) return route.fulfill(await localAsset(pathname, virtualSite.assetRoot));
      return route.continue();
    }
    blocked.push(`${origin}${pathname}`);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.clock.setFixedTime(new Date('2026-11-12T04:00:00Z'));
  return {
    context,
    page,
    async close() {
      await context.close();
      assert.deepEqual(pageErrors, [], 'Uncaught browser errors');
      assert.deepEqual(localFailures, [], 'Missing local assets');
      assert.deepEqual(blocked, [], 'Unexpected external browser requests were blocked');
    },
  };
}

const fixtureUrl = '/_tests/firebase-sdk.mjs';
const adjust = (page, data) =>
  page.evaluate(
    async ({ data, fixtureUrl }) => {
      const { fixture } = await import(fixtureUrl);
      fixture.setRecords(data);
    },
    { data, fixtureUrl },
  );

const condition = (page, expression, args) =>
  page.waitForFunction(
    async ({ expression, args, fixtureUrl }) => {
      const { fixture } = await import(fixtureUrl);
      return fixture[expression](...args);
    },
    { expression, args, fixtureUrl },
  );

module.exports = { adjust, browsers, condition, fixtureUrl, launch, openPage, startServer };
