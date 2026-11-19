// Gordon Bills — automated end-to-end tests.
// Run:  node tests/run-tests.js          (needs Playwright + Chromium; serves the app locally, bill API is mocked)
// Writes tests/results.json and prints a pass/fail summary.
const { chromium, devices } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CODE = 'GB-TEST-0001';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

function server() {
  return new Promise(res => {
    const s = http.createServer((req, rsp) => {
      let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f)) { rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      if (p.endsWith('/sw.js') && global.SW_BUMP) return rsp.end(fs.readFileSync(f, 'utf8') + '\n// bump ' + global.SW_BUMP);
      fs.createReadStream(f).pipe(rsp);
    }).listen(0, () => res(s));
  });
}

function sampleData() {
  return {
    today: '2026-11-19', thisMonth: '2026-11', people: ['Donn', 'Ashley'],
    statuses: ['Paid', 'Unpaid', 'Partial', 'Past due', 'Carried over'],
    methods: ['Online / app', 'AutoPay', 'Zelle', 'Cash'],
    billTypes: [{ name: 'Electric – Pepco', short: 'Electric', icon: '⚡' }, { name: 'Gas', short: 'Gas', icon: '🔥' }, { name: 'Mortgage', short: 'Mortgage', icon: '🏠' }],
    bills: [
      { key: '2026-11|Electric – Pepco', bill: 'Electric – Pepco', mk: '2026-11', amount: 388.30, status: 'Unpaid', dueIso: '2026-11-20', notes: '' },
      { key: '2026-11|Gas', bill: 'Gas', mk: '2026-11', amount: 286.79, status: 'Past due', dueIso: '2026-11-10', notes: '' },
      { key: '2026-12|Mortgage', bill: 'Mortgage', mk: '2026-12', amount: 4942.54, status: 'Unpaid', dueIso: '2026-12-01', notes: '' },
      { key: '2026-11|Kumon', bill: 'Kumon', mk: '2026-11', amount: 440, status: 'Paid', paidAmt: 440, paidBy: 'Ashley', method: 'Zelle', paidDate: '2026-11-19', dueIso: '2026-11-15', notes: '' },
    ],
  };
}

// Mock of the Apps Script API: validates the family code, applies saves, can simulate Google's email limit.
function mockApi(page, state) {
  return page.route('**/macros/**', async route => {
    const req = route.request();
    const reply = o => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (req.method() === 'POST') {
      const b = JSON.parse(req.postData()); state.posts.push(b);
      if (b.t !== CODE) return reply({ ok: false, error: 'That family code did not work.' });
      const key = b.newBill ? b.month + '|' + b.newBill : b.key;
      let bill = state.D.bills.find(x => x.key === key);
      if (!bill) { bill = { key, bill: key.slice(8), mk: b.month }; state.D.bills.push(bill); }
      Object.assign(bill, { status: b.status, paidBy: b.paidBy, method: b.method, amount: Number(b.amount) || bill.amount, dueIso: b.due || bill.dueIso,
        paidAmt: Number(b.paidAmt) || 0, paidDate: b.paidDate, conf: b.conf, notes: b.notes });
      if (state.quota) return reply({ ok: false, error: 'Service invoked too many times for one day: email.' });
      return reply({ ok: true, data: state.D, result: { key } });
    }
    const t = new URL(req.url()).searchParams.get('t');
    if (t !== CODE) return reply({ ok: false, error: 'That family code did not work.' });
    return reply({ ok: true, data: state.D });
  });
}

const results = []; let current = '';
function check(cond, msg) { if (!cond) throw new Error(msg); }

async function run() {
  const srv = await server(); const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const browser = await chromium.launch();
  const profiles = [['iPhone 14', devices['iPhone 14']], ['Pixel 7', devices['Pixel 7']], ['Desktop', { viewport: { width: 1280, height: 800 } }]];

  async function fresh(profile, opts = {}) {
    const ctx = await browser.newContext({ ...profile, serviceWorkers: opts.sw ? 'allow' : 'block' });
    const page = await ctx.newPage();
    const state = { D: sampleData(), posts: [], quota: false, errors: [], csp: [] };
    page.on('pageerror', e => state.errors.push(e.message));
    page.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) state.csp.push(m.text()); });
    page.on('dialog', d => d.accept());
    await mockApi(page, state);
    if (opts.signedIn !== false) await page.goto(base + '?k=' + CODE); else await page.goto(base);
    await page.waitForTimeout(600);
    return { ctx, page, state };
  }

  async function test(name, profile, fn, opts) {
    const t0 = Date.now(); let r;
    try { r = await fresh(profile[1], opts); await fn(r.page, r.state); check(!r.state.errors.length, 'Page errors: ' + r.state.errors.join(' | ')); check(!r.state.csp.length, 'CSP violations: ' + r.state.csp.join(' | '));
      results.push({ test: name, device: profile[0], pass: true, ms: Date.now() - t0 }); }
    catch (e) { results.push({ test: name, device: profile[0], pass: false, error: e.message.split('\n')[0], ms: Date.now() - t0 }); }
    finally { if (r) await r.ctx.close(); }
  }

  for (const prof of profiles) {
    await test('Home shows what is owed, next bill and open bills', prof, async p => {
      check((await p.textContent('#owed')).includes('$5,617.63'), 'wrong total owed: ' + await p.textContent('#owed'));
      check((await p.textContent('#next')).includes('Gas'), 'next-up should be the late Gas bill');
      check(await p.locator('#openList .card').count() === 3, 'expected 3 open bills');
      check(await p.locator('#paidList .card').count() === 1, 'expected 1 paid bill');
      check((await p.textContent('.ver')).includes('VERSION 9'), 'version label missing');
    });
    await test('Code stays in the address for Add to Home Screen', prof, async p => {
      check((await p.evaluate(() => location.search)).includes('k=' + CODE), 'code not kept in URL');
    });
    await test('Bill card opens payment screen; Back button returns home', prof, async p => {
      await p.click('#openList .card >> nth=0'); check(await p.isVisible('#pay'), 'pay screen not shown');
      check(await p.isVisible('#backBtn'), 'Back button not visible'); await p.click('#backBtn'); await p.waitForTimeout(200);
      check(await p.isVisible('#home'), 'Back did not return home');
    });
    await test('Phone back gesture returns home', prof, async p => {
      await p.click('#openList .card >> nth=0'); await p.goBack(); await p.waitForTimeout(200); check(await p.isVisible('#home'), 'history back did not return home');
    });
    await test('Validation: asks for status and who paid', prof, async p => {
      await p.click('#recordBtn'); await p.click('#saveBtn');
      check((await p.textContent('#payErr')).includes('Choose a status'), 'status validation missing');
      await p.click('.st[data-v="Paid"]'); await p.click('#saveBtn');
      check((await p.textContent('#payErr')).includes('Tap who paid'), 'payer validation missing');
    });
    await test('Full payment saves and confirms', prof, async (p, s) => {
      await p.click('#openList .card[data-key="2026-11|Electric – Pepco"]'); await p.click('.person[data-v="Ashley"]'); await p.click('#quick .chip'); await p.click('.chip.small[data-v="Zelle"]');
      await p.click('#saveBtn'); await p.waitForTimeout(400);
      const b = s.posts.at(-1); check(b && b.status === 'Paid' && b.paidBy === 'Ashley' && b.method === 'Zelle' && b.paidAmt === '388.30', 'bad save payload ' + JSON.stringify(b));
      check((await p.textContent('#doneT')).includes('Payment confirmed'), 'no confirmation');
    });
    await test('Partial payments add up correctly', prof, async (p, s) => {
      await p.click('#openList .card[data-key="2026-11|Electric – Pepco"]'); await p.click('.person[data-v="Donn"]'); await p.fill('#paidAmt', '100'); await p.dispatchEvent('#paidAmt', 'input');
      check(await p.locator('.st.on[data-v="Partial"]').count() === 1, 'partial not auto-selected');
      await p.click('#saveBtn'); await p.waitForTimeout(2600);
      await p.click('#openList .card[data-key="2026-11|Electric – Pepco"]'); await p.click('.person[data-v="Ashley"]'); await p.fill('#paidAmt', '288.30'); await p.dispatchEvent('#paidAmt', 'input');
      check(await p.locator('.st.on[data-v="Paid"]').count() === 1, 'second payment should complete the bill');
      await p.click('#saveBtn'); await p.waitForTimeout(400);
      check(s.posts.at(-1).paidAmt === '388.30', 'cumulative paid amount wrong: ' + s.posts.at(-1).paidAmt);
    });
    await test('Add a new "other" bill', prof, async (p, s) => {
      await p.click('#recordBtn'); await p.click('#billChips .chip >> text=+ Other bill'); await p.fill('#newBill', 'Internet'); await p.click('.st[data-v="Unpaid"]');
      await p.click('#saveBtn'); await p.waitForTimeout(400); check(s.posts.at(-1).newBill === 'Internet', 'new bill not sent');
    });
    await test('Email limit reached: payment still saved, friendly message', prof, async (p, s) => {
      s.quota = true; await p.click('#openList .card >> nth=0'); await p.click('.person[data-v="Donn"]'); await p.click('#quick .chip'); await p.click('#saveBtn'); await p.waitForTimeout(800);
      check((await p.textContent('#doneT')).includes('Saved'), 'no Saved message'); check(!(await p.textContent('#payErr')).includes('Service invoked'), 'raw Google error shown');
    });
    await test('Questions: ask, reply, resolve; home shows question tag', prof, async (p, s) => {
      await p.click('#openList .card >> nth=0'); await p.click('#conv [data-k=question]'); await p.click('#askWho [data-v=Donn]');
      await p.fill('#askText', 'Did we cancel this?'); await p.click('#askSend'); await p.waitForTimeout(2200);
      check(/💬 Donn · .+ — Did we cancel this\?/.test(s.posts.at(-1).notes), 'question not saved: ' + s.posts.at(-1).notes);
      check(await p.locator('#conv .bub').count() === 1, 'bubble missing');
      await p.click('#conv [data-k=reply]'); await p.click('#askWho [data-v=Ashley]'); await p.fill('#askText', 'Final bill, OK to pay'); await p.click('#askSend'); await p.waitForTimeout(2200);
      await p.click('#conv [data-k=resolved]'); await p.click('#askSend'); await p.waitForTimeout(2200);
      check((await p.textContent('#conv')).includes('Resolved by Ashley'), 'not resolved');
    });
    await test('Security: bill names cannot inject code (XSS)', prof, async (p, s) => {
      s.D.bills.push({ key: '2026-11|<img src=x onerror=window.__x=1>', bill: '<img src=x onerror=window.__x=1>', mk: '2026-11', amount: 5, status: 'Unpaid', notes: '💬 <b>x</b> · now — <script>window.__y=1</script>' });
      await p.click('#refresh'); await p.waitForTimeout(500);
      check(!(await p.evaluate(() => window.__x || window.__y)), 'injected code ran');
      check((await p.textContent('#openList')).includes('<img src=x'), 'name not shown as plain text');
    });
    await test('Unexpected status value does not crash', prof, async (p, s) => {
      s.D.bills[0].status = 'Weird'; await p.click('#refresh'); await p.waitForTimeout(400); check(await p.isVisible('#home'), 'home crashed');
    });
    await test('Sign out of this phone, then wrong and right codes', prof, async p => {
      await p.click('#signOut'); await p.waitForTimeout(200); check(await p.isVisible('#gate'), 'gate not shown after sign out');
      check(!(await p.evaluate(() => localStorage.getItem('gb_code'))), 'code not cleared');
      await p.fill('#codeIn', 'gbtest9999'); check((await p.inputValue('#codeIn')) === 'GB-TEST-9999', 'code not auto-formatted');
      await p.click('#codeGo'); await p.waitForTimeout(300); check((await p.textContent('#codeErr')).length > 0, 'wrong code accepted');
      await p.fill('#codeIn', 'gb-test-0001'); await p.click('#codeGo'); await p.waitForTimeout(400); check(await p.isVisible('#home'), 'right code rejected');
    });
    await test('Install page signs in and links to the app', prof, async p => {
      await p.goto(p.url().split('?')[0] + 'install.html?k=' + CODE); await p.waitForTimeout(300);
      check((await p.getAttribute('#openBtn1', 'href')).includes('k=' + CODE), 'open link lacks code');
      check((await p.textContent('#codeV')) === CODE, 'code not shown');
    });
  }
  // Offline: the app shell should load with no network once installed (service worker).
  await test('Works offline after first visit (service worker)', profiles[0], async p => {
    await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
    await p.reload(); await p.waitForTimeout(500);
    await p.context().setOffline(true); await p.reload(); await p.waitForTimeout(600);
    check(await p.isVisible('#home'), 'app did not open offline'); check((await p.textContent('#owed')).includes('$'), 'cached bills not shown offline');
  }, { sw: true });

  await test('New version pushed: "New update ready" banner appears and updates', profiles[0], async p => {
    await p.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 8000 }).catch(() => {});
    await p.reload(); await p.waitForTimeout(500);
    check(!(await p.isVisible('#upd')), 'banner shown with no update');
    global.SW_BUMP = Date.now(); await p.click('#checkUpd');
    await p.waitForSelector('#upd:not(.hide)', { timeout: 8000 }).catch(() => {});

    check(await p.isVisible('#upd'), 'update banner did not appear');
    check((await p.textContent('#upd')).includes('New update ready'), 'banner text wrong');
    await Promise.all([p.waitForNavigation({ timeout: 8000 }), p.click('#upd')]); await p.waitForTimeout(400);
    const st = { home: await p.isVisible('#home'), upd: await p.isVisible('#upd'), gate: await p.isVisible('#gate'), url: p.url() };
    check(st.home && !st.upd, 'did not reload into the new version ' + JSON.stringify(st));
  }, { sw: true });

  global.SW_BUMP = 0; await browser.close(); srv.close();
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2));
  const fail = results.filter(r => !r.pass);
  results.forEach(r => console.log((r.pass ? 'PASS' : 'FAIL') + '  [' + r.device + '] ' + r.test + (r.pass ? '' : '  → ' + r.error)));
  console.log('\n' + (results.length - fail.length) + '/' + results.length + ' passed');
  process.exit(fail.length ? 1 : 0);
}
run().catch(e => { console.error(e); process.exit(2); });
