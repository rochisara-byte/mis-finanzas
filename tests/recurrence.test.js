const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');
const mainScript = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener() {}
  setAttribute(name, value) { this[name] = value; }
  querySelector() { return new FakeElement(); }
  querySelectorAll() { return []; }
  closest() { return null; }
  focus() {}
  setSelectionRange() {}
  before() {}
  prepend() {}
  append() {}
  remove() {}
}

class MemoryStorage {
  constructor(seed = {}) {
    this.store = { ...seed };
  }
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.store, key) ? this.store[key] : null;
  }
  setItem(key, value) {
    this.store[key] = String(value);
  }
  removeItem(key) {
    delete this.store[key];
  }
}

function makeDocument() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  return {
    body: new FakeElement('body'),
    addEventListener() {},
    createElement: tag => new FakeElement(tag),
    getElementById: get,
    querySelector: selector => get(selector),
    querySelectorAll: () => [],
  };
}

function runApp(seedStorage = {}) {
  let uuid = 0;
  const context = {
    console,
    localStorage: new MemoryStorage(seedStorage),
    document: makeDocument(),
    navigator: { onLine: true },
    location: { protocol: 'http:' },
    window: { dispatchEvent() {}, addEventListener() {} },
    Event: function Event(type) { this.type = type; },
    alert(message) { throw new Error(`Unexpected alert: ${message}`); },
    confirm() { return true; },
    prompt() { return ''; },
    setTimeout() {},
    clearTimeout() {},
    Blob,
    URL,
    Intl,
    crypto: {
      randomUUID: () => `uuid-${++uuid}`,
    },
  };
  context.window.window = context.window;
  vm.createContext(context);
  vm.runInContext(`${mainScript}
globalThis.__finanzasTest = {
  get db() { return db; },
  set db(value) { db = value; },
  mark,
  nextDate,
  habitualAmount,
  prepareRecurrenceSave,
  setHabitualAmount,
  createNextOccurrence,
  groupTransactions,
  setAgendaPeriod(value) { agendaPeriod = value; },
  setHistoryMode(value) { historyMode = value; },
  accountBalance,
  total,
  due,
  future,
  projected,
  persist,
  setUntil(value) { until = value; },
  setProjection(value) { projection = value; },
};`, context);
  return context;
}

function baseDb(overrides = {}) {
  return {
    version: 1,
    device: 'test-device',
    revision: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    accounts: [
      { id: 'cash', name: 'Cash', type: 'cash', opening: 1000 },
      { id: 'bank', name: 'Bank', type: 'bank', opening: 500 },
      { id: 'card', name: 'Card', type: 'credit', opening: 10000 },
    ],
    lists: [{ id: 'home', name: 'Home' }],
    categories: ['Food', 'Income', 'Transfer'],
    transactions: [],
    budgets: [],
    goals: [],
    debts: [],
    settings: { cloudUrl: '', cloudKey: '', syncId: '', syncSecret: '', lastSync: '' },
    ...overrides,
  };
}

function tx(overrides = {}) {
  return {
    id: 'tx',
    type: 'expense',
    title: 'Rent',
    amount: 100,
    category: 'Food',
    date: '2026-01-31',
    account: 'cash',
    toAccount: '',
    list: 'home',
    status: 'pending',
    repeat: 'monthly',
    recurrenceAmount: 100,
    notes: '',
    linkKind: '',
    linkId: '',
    attachment: '',
    star: false,
    created: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function setDb(app, db) {
  app.__finanzasTest.db = JSON.parse(JSON.stringify(db));
}

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

test('creates exactly one next recurring occurrence on first completion', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'r1' })] }));
  app.__finanzasTest.mark('r1');
  const transactions = app.__finanzasTest.db.transactions;
  const source = transactions.find(t => t.id === 'r1');
  const child = transactions.find(t => t.id !== 'r1');
  assert.strictEqual(transactions.length, 2);
  assert.strictEqual(source.status, 'done');
  assert.strictEqual(child.status, 'pending');
  assert.strictEqual(child.date, '2026-02-28');
  assert.strictEqual(child.recurrenceParentId, 'r1');
  assert.strictEqual(child.recurrenceRootId, 'r1');
  assert.strictEqual(source.generatedNextId, child.id);
});

test('does not duplicate next occurrence after pending done pending done sequence', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'r1' })] }));
  app.__finanzasTest.mark('r1');
  const firstChildId = app.__finanzasTest.db.transactions.find(t => t.id !== 'r1').id;
  app.__finanzasTest.mark('r1');
  app.__finanzasTest.mark('r1');
  const transactions = app.__finanzasTest.db.transactions;
  assert.strictEqual(transactions.length, 2);
  assert.strictEqual(transactions.find(t => t.id === 'r1').generatedNextId, firstChildId);
});

test('keeps independent identical recurrences separated by explicit relationships', () => {
  const first = tx({ id: 'rent-a' });
  const second = tx({
    id: 'rent-b',
    created: '2026-01-01T00:00:00.000Z',
  });
  const app = runApp();
  setDb(app, baseDb({ transactions: [first, second] }));

  app.__finanzasTest.mark('rent-a');
  let transactions = app.__finanzasTest.db.transactions;
  const firstChild = transactions.find(t => t.recurrenceParentId === 'rent-a');
  assert.strictEqual(transactions.length, 3);
  assert.ok(firstChild);
  assert.strictEqual(transactions.find(t => t.id === 'rent-a').generatedNextId, firstChild.id);
  assert.strictEqual(transactions.find(t => t.id === 'rent-b').generatedNextId, undefined);

  app.__finanzasTest.mark('rent-a');
  app.__finanzasTest.mark('rent-a');
  transactions = app.__finanzasTest.db.transactions;
  assert.strictEqual(transactions.length, 3);
  assert.strictEqual(transactions.find(t => t.id === 'rent-a').generatedNextId, firstChild.id);

  app.__finanzasTest.mark('rent-b');
  transactions = app.__finanzasTest.db.transactions;
  const secondChild = transactions.find(t => t.recurrenceParentId === 'rent-b');
  assert.strictEqual(transactions.length, 4);
  assert.ok(secondChild);
  assert.notStrictEqual(secondChild.id, firstChild.id);
  assert.strictEqual(transactions.find(t => t.id === 'rent-b').generatedNextId, secondChild.id);
});

// Legacy records without explicit recurrence ids are left untouched because
// matching amount/date/title/category can also describe independent payments.
test('does not infer a legacy recurrence from matching financial fields', () => {
  const source = tx({ id: 'legacy-source', status: 'done' });
  const legacyChild = tx({
    id: 'legacy-child',
    date: '2026-02-28',
    status: 'pending',
    created: '2026-02-01T00:00:00.000Z',
  });
  const app = runApp();
  setDb(app, baseDb({ transactions: [source, legacyChild] }));
  app.__finanzasTest.mark('legacy-source');
  app.__finanzasTest.mark('legacy-source');
  const transactions = app.__finanzasTest.db.transactions;
  const sourceAfter = transactions.find(t => t.id === 'legacy-source');
  const untouchedLegacy = transactions.find(t => t.id === 'legacy-child');
  const generated = transactions.find(t => !['legacy-source', 'legacy-child'].includes(t.id));
  assert.strictEqual(transactions.length, 3);
  assert.ok(generated);
  assert.strictEqual(sourceAfter.generatedNextId, generated.id);
  assert.strictEqual(generated.recurrenceParentId, 'legacy-source');
  assert.strictEqual(untouchedLegacy.recurrenceParentId, undefined);
  assert.strictEqual(untouchedLegacy.generatedNextId, undefined);
});

test('leaves ambiguous legacy matches unresolved and creates a new explicit child', () => {
  const source = tx({ id: 'legacy-source', status: 'done' });
  const legacyChildA = tx({
    id: 'legacy-child-a',
    date: '2026-02-28',
    status: 'pending',
    created: '2026-02-01T00:00:00.000Z',
  });
  const legacyChildB = tx({
    id: 'legacy-child-b',
    date: '2026-02-28',
    status: 'pending',
    created: '2026-02-02T00:00:00.000Z',
  });
  const app = runApp();
  setDb(app, baseDb({ transactions: [source, legacyChildA, legacyChildB] }));
  app.__finanzasTest.mark('legacy-source');
  app.__finanzasTest.mark('legacy-source');
  const transactions = app.__finanzasTest.db.transactions;
  const sourceAfter = transactions.find(t => t.id === 'legacy-source');
  const generated = transactions.find(t => !['legacy-source', 'legacy-child-a', 'legacy-child-b'].includes(t.id));
  assert.strictEqual(transactions.length, 4);
  assert.ok(generated);
  assert.strictEqual(sourceAfter.generatedNextId, generated.id);
  assert.notStrictEqual(sourceAfter.generatedNextId, 'legacy-child-a');
  assert.notStrictEqual(sourceAfter.generatedNextId, 'legacy-child-b');
  assert.strictEqual(generated.recurrenceParentId, 'legacy-source');
  assert.strictEqual(transactions.find(t => t.id === 'legacy-child-a').recurrenceParentId, undefined);
  assert.strictEqual(transactions.find(t => t.id === 'legacy-child-b').recurrenceParentId, undefined);
});

test('editing or postponing a completed recurring source does not create another child', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'r1' })] }));
  app.__finanzasTest.mark('r1');
  app.__finanzasTest.mark('r1');
  app.__finanzasTest.db.transactions.find(t => t.id === 'r1').date = '2026-02-02';
  app.__finanzasTest.mark('r1');
  assert.strictEqual(app.__finanzasTest.db.transactions.length, 2);
});

test('non recurring movements keep previous behavior', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'n1', repeat: '', type: 'income', amount: 200 })] }));
  app.__finanzasTest.mark('n1');
  assert.strictEqual(app.__finanzasTest.db.transactions.length, 1);
  assert.strictEqual(app.__finanzasTest.db.transactions[0].status, 'done');
  assert.strictEqual(app.__finanzasTest.accountBalance('cash'), 1200);
});

test('balances and projections ignore deleted movements and preserve financial rules', () => {
  const app = runApp();
  setDb(app, baseDb({
    transactions: [
      tx({ id: 'income', type: 'income', amount: 100, status: 'done', repeat: '', category: 'Income' }),
      tx({ id: 'expense', type: 'expense', amount: 30, status: 'done', repeat: '' }),
      tx({ id: 'transfer', type: 'transfer', amount: 200, status: 'done', repeat: '', toAccount: 'bank' }),
      tx({ id: 'pending-expense', type: 'expense', amount: 50, status: 'pending', repeat: '' }),
      tx({ id: 'pending-income', type: 'income', amount: 70, status: 'pending', repeat: '' }),
      tx({ id: 'deleted', type: 'expense', amount: 999, status: 'done', repeat: '', deleted: true }),
    ],
  }));
  app.__finanzasTest.setUntil('2026-12-31');
  assert.strictEqual(app.__finanzasTest.accountBalance('cash'), 870);
  assert.strictEqual(app.__finanzasTest.accountBalance('bank'), 700);
  assert.strictEqual(app.__finanzasTest.total(), 1570);
  assert.strictEqual(app.__finanzasTest.due(), 50);
  assert.strictEqual(app.__finanzasTest.projected(), 1520);
  app.__finanzasTest.setProjection('expected');
  assert.strictEqual(app.__finanzasTest.future(), 70);
  assert.strictEqual(app.__finanzasTest.projected(), 1590);
});

test('deleted recurring records do not generate occurrences or duplicate deleted children', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'deleted-source', deleted: true })] }));
  app.__finanzasTest.mark('deleted-source');
  assert.strictEqual(app.__finanzasTest.db.transactions.length, 1);
  assert.strictEqual(app.__finanzasTest.db.transactions[0].status, 'pending');

  setDb(app, baseDb({ transactions: [tx({ id: 'r1' })] }));
  app.__finanzasTest.mark('r1');
  const child = app.__finanzasTest.db.transactions.find(t => t.id !== 'r1');
  child.deleted = true;
  app.__finanzasTest.mark('r1');
  app.__finanzasTest.mark('r1');
  assert.strictEqual(app.__finanzasTest.db.transactions.length, 2);
});

test('recurrence relationship persists after saving and reloading', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'r1' })] }));
  app.__finanzasTest.mark('r1');
  const stored = { ...app.localStorage.store };
  const reloaded = runApp(stored);
  const transactions = reloaded.__finanzasTest.db.transactions;
  const source = transactions.find(t => t.id === 'r1');
  const child = transactions.find(t => t.id !== 'r1');
  assert.strictEqual(transactions.length, 2);
  assert.strictEqual(source.generatedNextId, child.id);
  assert.strictEqual(child.recurrenceParentId, 'r1');
});

test('an exceptional paid amount never becomes the next monthly habitual amount', () => {
  const app = runApp();
  setDb(app, baseDb({ transactions: [tx({ id: 'utility', amount: 80, recurrenceAmount: 100 })] }));
  app.__finanzasTest.mark('utility');
  const [paid, next] = app.__finanzasTest.db.transactions;
  assert.strictEqual(paid.amount, 80);
  assert.strictEqual(next.amount, 100);
  assert.strictEqual(next.recurrenceAmount, 100);
  app.__finanzasTest.mark('utility');
  app.__finanzasTest.mark('utility');
  assert.strictEqual(app.__finanzasTest.db.transactions.length, 2);
  assert.strictEqual(next.amount, 100);
});

test('custom recurrence and habitual change preserve individual future exceptions', () => {
  const root = tx({ id: 'custom', repeat: 'weeks:2', date: '2027-01-01', status: 'done', amount: 80, recurrenceAmount: 100 });
  const normal = tx({ id: 'normal', date: '2027-01-15', repeat: 'weeks:2', amount: 100, recurrenceAmount: 100, recurrenceParentId: 'custom', recurrenceRootId: 'custom' });
  const exception = tx({ id: 'exception', date: '2027-01-29', repeat: 'weeks:2', amount: 65, amountAdjusted: true, recurrenceAmount: 100, recurrenceParentId: 'normal', recurrenceRootId: 'custom' });
  const app = runApp();
  setDb(app, baseDb({ transactions: [root, normal, exception] }));
  app.__finanzasTest.setHabitualAmount(app.__finanzasTest.db.transactions[0], 120);
  const [savedRoot, savedNormal, savedException] = app.__finanzasTest.db.transactions;
  assert.strictEqual(savedRoot.amount, 80);
  assert.strictEqual(savedNormal.amount, 120);
  assert.strictEqual(savedException.amount, 65);
  assert.strictEqual(savedException.recurrenceAmount, 120);
  app.__finanzasTest.mark('exception');
  const child = app.__finanzasTest.db.transactions.find(t => t.recurrenceParentId === 'exception');
  assert.strictEqual(child.amount, 120);
  assert.strictEqual(child.date, '2027-02-12');
});

test('ambiguous legacy recurring amount requires review, without changing history', () => {
  const old = tx({ id: 'old', amount: 80, recurrenceAmount: undefined, status: 'done' });
  const pending = tx({ id: 'old-next', amount: 100, recurrenceAmount: undefined, recurrenceParentId: 'old', date: '2027-01-01' });
  const app = runApp();
  setDb(app, baseDb({ transactions: [old, pending] }));
  const [source, next] = app.__finanzasTest.db.transactions;
  assert.strictEqual(app.__finanzasTest.habitualAmount(next), null);
  assert.strictEqual(app.__finanzasTest.createNextOccurrence(next), null);
  assert.strictEqual(app.__finanzasTest.db.transactions.length, 2);
  assert.throws(() => app.__finanzasTest.prepareRecurrenceSave({ ...next }, next, ''), /valor habitual/);
  assert.strictEqual(source.amount, 80);
  app.__finanzasTest.setHabitualAmount(next, 100);
  assert.strictEqual(source.amount, 80);
  assert.strictEqual(app.__finanzasTest.habitualAmount(next), 100);
});

test('agenda hides completed from pending and history keeps them accessible', () => {
  const day = new Date().toLocaleDateString('en-CA');
  const app = runApp();
  setDb(app, baseDb({ transactions: [
    tx({ id: 'pending', date: day, repeat: '', status: 'pending' }),
    tx({ id: 'done', date: day, repeat: '', status: 'done', completedAt: new Date().toISOString() }),
  ] }));
  let html = app.__finanzasTest.groupTransactions();
  assert.match(html, /Completados/);
  assert.match(html, /data-id="pending"/);
  assert.doesNotMatch(html, /data-id="done"/);
  app.__finanzasTest.setHistoryMode(true);
  html = app.__finanzasTest.groupTransactions();
  assert.match(html, /data-id="pending"/);
  assert.match(html, /data-id="done"/);
});

test('all-period agenda and history render a bounded batch from a large archive', () => {
  const app = runApp();
  const rows = Array.from({ length: 2000 }, (_, i) => tx({
    id: `large-${i}`, repeat: '', status: 'pending', date: '2027-12-31',
  }));
  setDb(app, baseDb({ transactions: rows }));
  app.__finanzasTest.setAgendaPeriod('all');
  assert.strictEqual((app.__finanzasTest.groupTransactions().match(/class="item transaction"/g) || []).length, 100);
  app.__finanzasTest.setHistoryMode(true);
  assert.strictEqual((app.__finanzasTest.groupTransactions().match(/class="item transaction"/g) || []).length, 100);
});
