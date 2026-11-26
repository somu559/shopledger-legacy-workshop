const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

test('customer names containing a script tag are escaped in the browser views', () => {
  const name = 'Asha & Sons <script>sample</script> "Shop"\'';
  const escapedName = 'Asha &amp; Sons &lt;script&gt;sample&lt;/script&gt; &quot;Shop&quot;&#39;';
  const responses = {
    '/api/customers': {
      customers: [{ id: 1, name }],
      settlements: [{ customerName: name }]
    },
    '/api/orders': [{ id: 1001, customer: name }],
    '/api/reports/gst-reconciliation': { rows: [{ orderId: 1001, customer: name }] }
  };
  const elements = new Map();
  function element(key) {
    if (!elements.has(key)) elements.set(key, { addEventListener() {} });
    return elements.get(key);
  }

  class XMLHttpRequest {
    open(method, url) {
      this.url = url.split('?')[0];
    }

    send() {
      this.status = 200;
      this.responseText = JSON.stringify(responses[this.url] ?? null);
      this.onload();
    }
  }

  const document = {
    getElementById: element,
    querySelector: element,
    querySelectorAll: () => []
  };
  const source = readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  const browser = { document, XMLHttpRequest };
  runInNewContext(source, browser);
  browser.loadOrders();

  for (const selector of [
    'customer-select', 'settle-customer', '#customers-table tbody',
    'settlements-list', '#orders tbody', '#recon-table tbody'
  ]) {
    const { innerHTML } = element(selector);
    assert.ok(innerHTML.includes(escapedName), selector + ' must display the escaped customer name');
    assert.doesNotMatch(innerHTML, /<script>/i);
  }
});
