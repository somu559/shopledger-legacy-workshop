const assert = require('node:assert/strict');
const { copyFile, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const request = require('supertest');
const pricing = require('../lib/pricing');

const project = path.resolve(__dirname, '..');
const sourceDatabase = path.join(project, 'data', 'db.json');

async function isolatedApp(t, prepareDatabase) {
  // The store resolves its database relative to its own file.
  const sandbox = await mkdtemp(path.join(tmpdir(), 'shopledger-test-'));
  t.after(() => rm(sandbox, { recursive: true, force: true }));
  const dataDir = path.join(sandbox, 'data');
  await mkdir(dataDir);
  const database = path.join(dataDir, 'db.json');
  await Promise.all([
    copyFile(sourceDatabase, database),
    copyFile(path.join(project, 'server.js'), path.join(sandbox, 'server.js')),
    copyFile(path.join(project, 'config.js'), path.join(sandbox, 'config.js')),
    cp(path.join(project, 'lib'), path.join(sandbox, 'lib'), { recursive: true }),
    cp(path.join(project, 'routes'), path.join(sandbox, 'routes'), { recursive: true }),
    symlink(path.join(project, 'node_modules'), path.join(sandbox, 'node_modules'), 'junction')
  ]);
  const db = JSON.parse(await readFile(database, 'utf8'));
  if (prepareDatabase) {
    prepareDatabase(db);
    await writeFile(database, JSON.stringify(db));
  }
  return { api: request(require(path.join(sandbox, 'server.js'))), db };
}

async function listProducts(api) {
  const { body } = await api.get('/api/products').expect(200);
  return body;
}

test('buying exactly the sellable stock succeeds and leaves zero sellable units', async (t) => {
  const { api } = await isolatedApp(t);
  const product = (await listProducts(api)).find(({ sellable, reserved }) => sellable > 0 && reserved > 0);
  assert.ok(product, 'fixture must include a product with sellable and reserved stock');

  const { body: order } = await api.post('/api/orders')
    .send({ items: [{ id: product.id, qty: product.sellable }] })
    .expect(201);
  assert.equal(order.items[0].qty, product.sellable);

  const remaining = (await listProducts(api)).find(({ id }) => id === product.id);
  assert.equal(remaining.sellable, 0);
  assert.equal(remaining.stock, product.reserved);
  assert.equal(remaining.reserved, product.reserved);
});

test('cancelling an order restores the stock deducted when it was placed', async (t) => {
  const { api } = await isolatedApp(t);
  const qty = 2;
  const product = (await listProducts(api)).find(({ sellable }) => sellable > qty);
  assert.ok(product, 'fixture must include enough stock for a partial purchase');

  const { body: order } = await api.post('/api/orders')
    .send({ items: [{ id: product.id, qty }] })
    .expect(201);
  const afterPurchase = (await listProducts(api)).find(({ id }) => id === product.id);
  assert.equal(afterPurchase.stock, product.stock - qty);

  const { body: cancelled } = await api.post('/api/orders/' + order.id + '/cancel').expect(200);
  assert.equal(cancelled.status, 'cancelled');
  const restored = (await listProducts(api)).find(({ id }) => id === product.id);
  assert.deepEqual(
    { stock: restored.stock, sellable: restored.sellable, reserved: restored.reserved },
    { stock: product.stock, sellable: product.sellable, reserved: product.reserved }
  );
});

test('a string khata settlement increases total settled and decreases balance numerically', async (t) => {
  const { api } = await isolatedApp(t);
  const amount = 100.25;
  const { body: before } = await api.get('/api/customers').expect(200);
  const customer = before.customers.find(({ totalSettled, balance }) => totalSettled > 0 && balance > amount);
  assert.ok(customer, 'fixture must include a customer with prior settlements and an outstanding balance');

  const { body: result } = await api.post('/api/customers/' + customer.id + '/settle')
    .send({ amount: String(amount) })
    .expect(201);
  assert.equal(result.settlement.amount, amount);

  const { body: after } = await api.get('/api/customers').expect(200);
  const updated = after.customers.find(({ id }) => id === customer.id);
  assert.deepEqual(
    { totalSettled: updated.totalSettled, balance: updated.balance },
    { totalSettled: pricing.round2(customer.totalSettled + amount), balance: pricing.round2(customer.balance - amount) }
  );
});

test('order date filtering includes both endpoints across months and returns newest first', async (t) => {
  const { api } = await isolatedApp(t);
  const { body } = await api.get('/api/orders')
    .query({ from: '2022-01-14', to: '2022-02-18' })
    .expect(200);

  assert.deepEqual(body.map(({ id }) => id), [1006, 1005, 1004, 1003]);
});

test('printed invoice totals match pricing.computeTotals for every stored order', async (t) => {
  const { api, db } = await isolatedApp(t);
  assert.ok(db.orders.length > 0, 'fixture must include orders to invoice');

  for (const order of db.orders) {
    await t.test('order #' + order.id, async () => {
      const expected = pricing.computeTotals(order.items, order.coupon);
      const { text } = await api.get('/orders/' + order.id + '/invoice')
        .expect(200)
        .expect('Content-Type', /html/);
      const subtotal = text.match(/>Gross Subtotal<\/td><td[^>]*>₹([\d.]+)</);
      const tax = text.match(/>CGST \+ SGST \(Total GST\)<\/td><td[^>]*>₹([\d.]+)</);
      const discount = text.match(/>Coupon Discount \([^<]*\)<\/td><td[^>]*>-₹([\d.]+)</);
      const total = text.match(/>Invoice Total<\/td><td[^>]*>₹([\d.]+)</);

      assert.deepEqual(
        { subtotal: Number(subtotal?.[1]), discount: Number(discount?.[1] ?? 0), tax: Number(tax?.[1]), total: Number(total?.[1]) },
        { subtotal: expected.subtotal, discount: expected.discount, tax: expected.tax, total: expected.total }
      );
    });
  }
});

test('placing an order rejects quantities that are not positive integers', async (t) => {
  const { api } = await isolatedApp(t);
  const { id } = (await listProducts(api)).find(({ sellable }) => sellable >= 2);

  for (const qty of [undefined, null, 0, -1, 1.5, '2', '2 units', true]) {
    await t.test('quantity ' + JSON.stringify(qty), async () => {
      await api.post('/api/orders').send({ items: [{ id, qty }] }).expect(400);
    });
  }

  await api.post('/api/orders').send({ items: [{ id, qty: 2 }] }).expect(201);
});

test('a new order is completed even when the client supplies a status', async (t) => {
  const { api } = await isolatedApp(t);
  const { id } = (await listProducts(api)).find(({ sellable }) => sellable >= 2);

  for (const status of ['pending', 'cancelled']) {
    await t.test('client status ' + status, async () => {
      const { body: order } = await api.post('/api/orders')
        .send({ items: [{ id, qty: 1 }], status })
        .expect(201);
      assert.equal(order.status, 'completed');

      const { body: saved } = await api.get('/api/orders/' + order.id).expect(200);
      assert.equal(saved.status, 'completed');
    });
  }
});

test('khata billing enforces the displayed default credit limit of 5000', async (t) => {
  const customerId = 1;
  const productId = 1;
  const { api } = await isolatedApp(t, (db) => {
    const product = db.products.find(({ id }) => id === productId);
    const customer = db.customers.find(({ id }) => id === customerId);
    const oneUnit = pricing.computeTotals([{ ...product, qty: 1 }]).total;
    delete customer.creditLimit;
    customer.openingBalance = pricing.round2(5000 - oneUnit);
    customer.totalBilled = 0;
    customer.totalSettled = 0;
  });

  const { body: before } = await api.get('/api/customers').expect(200);
  const customer = before.customers.find(({ id }) => id === customerId);
  assert.equal(customer.creditLimit, 5000);

  const order = { customerId, paymentMode: 'khata' };
  const { body: rejected } = await api.post('/api/orders')
    .send({ ...order, items: [{ id: productId, qty: 2 }] })
    .expect(409);
  assert.match(rejected.error, /credit limit exceeded/);

  await api.post('/api/orders')
    .send({ ...order, items: [{ id: productId, qty: 1 }] })
    .expect(201);
  const { body: after } = await api.get('/api/customers').expect(200);
  assert.equal(after.customers.find(({ id }) => id === customerId).balance, 5000);
});

test('khata settlement rejects non-numeric amounts and payments above the balance', async (t) => {
  const { api } = await isolatedApp(t);
  const { body: before } = await api.get('/api/customers').expect(200);
  const customer = before.customers.find(({ balance }) => balance > 10);
  const url = '/api/customers/' + customer.id + '/settle';

  for (const amount of ['invalid', 'Infinity', '1 rupee', true, [1], null, 0, -1, pricing.round2(customer.balance + 0.01)]) {
    await t.test('amount ' + JSON.stringify(amount), async () => {
      await api.post(url).send({ amount }).expect(400);
    });
  }

  const { body: unchanged } = await api.get('/api/customers').expect(200);
  assert.deepEqual(unchanged, before);

  const { body: paid } = await api.post(url).send({ amount: String(customer.balance) }).expect(201);
  assert.equal(paid.settlement.amount, customer.balance);
  assert.equal(paid.customer.balance, 0);
});

test('admin export requires a configured ADMIN_KEY and an exact matching query key', async (t) => {
  const previousKey = process.env.ADMIN_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.ADMIN_KEY;
    else process.env.ADMIN_KEY = previousKey;
  });

  delete process.env.ADMIN_KEY;
  const { api, db } = await isolatedApp(t);
  await api.get('/api/admin/export').expect(403);

  process.env.ADMIN_KEY = '';
  await api.get('/api/admin/export').query({ key: '' }).expect(403);

  process.env.ADMIN_KEY = 'test-export-key';
  await api.get('/api/admin/export').query({ key: 'wrong' }).expect(403);
  const { body } = await api.get('/api/admin/export').query({ key: process.env.ADMIN_KEY }).expect(200);
  assert.deepEqual(body, db);
});
