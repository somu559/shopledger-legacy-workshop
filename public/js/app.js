var allProducts = [];
var cartQuantities = {}; // productId -> qty
var activeCategory = 'all';
var customersList = [];
var cartPreviewVersion = 0;
var moneyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

function get(url, cb) {
  var x = new XMLHttpRequest();
  x.open('GET', url);
  x.timeout = 15000;
  x.onload = function () {
    var data = null;
    try {
      data = JSON.parse(x.responseText);
    } catch (e) {
      // The server may return a plain-text error.
    }
    cb(data, x.status);
  };
  x.onerror = x.ontimeout = function () { cb(null, 0); };
  x.send();
}

function post(url, data, cb) {
  var x = new XMLHttpRequest();
  x.open('POST', url);
  x.setRequestHeader('Content-Type', 'application/json');
  x.timeout = 15000;
  x.onload = function () {
    var parsed = {};
    try {
      parsed = JSON.parse(x.responseText);
    } catch (e) {
      parsed = { error: x.responseText || 'Request failed' };
    }
    cb(x.status, parsed);
  };
  x.onerror = x.ontimeout = function () {
    cb(0, { error: 'Could not reach the server. Check the connection and try again.' });
  };
  x.send(JSON.stringify(data));
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMoney(n) {
  var val = Number(n || 0);
  return Number.isFinite(val) ? moneyFormatter.format(val) : '–';
}

function setButtonLoading(button, label) {
  var original = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = label;
  return function () {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = original;
  };
}

function showToast(id, kind, title, detail, trigger, invoiceId) {
  var toast = document.getElementById(id);
  var content = document.createElement('div');
  var heading = document.createElement('strong');
  heading.textContent = title;
  content.append(heading);

  if (detail) {
    var description = document.createElement('p');
    description.textContent = detail;
    content.append(description);
  }
  if (invoiceId != null) {
    var invoice = document.createElement('a');
    invoice.className = 'btn-link';
    invoice.href = '/orders/' + encodeURIComponent(invoiceId) + '/invoice';
    invoice.target = '_blank';
    invoice.rel = 'noopener';
    invoice.textContent = 'Open GST invoice';
    content.append(invoice);
  }

  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Dismiss notification');
  close.textContent = '×';
  close.onclick = function () {
    toast.replaceChildren();
    var focusTarget = trigger && trigger.isConnected ? trigger : document.querySelector('.tab-link.active');
    if (focusTarget) focusTarget.focus();
  };

  toast.className = kind;
  toast.replaceChildren(content, close);
  document.getElementById('toast-announcement').textContent = detail ? title + '. ' + detail : title;
}

function loadDashboardSummary() {
  get('/api/reports/dashboard', function (data) {
    if (!data || !data.summary) return;
    var s = data.summary;

    document.getElementById('kpi-revenue').textContent = fmtMoney(s.grossRevenue);
    document.getElementById('kpi-tax').textContent = fmtMoney(s.totalTaxCollected);
    document.getElementById('kpi-discount').textContent = fmtMoney(s.totalDiscountGiven) + ' in discounts';

    document.getElementById('kpi-orders').textContent = s.totalOrders + (s.totalOrders === 1 ? ' order' : ' orders');
    document.getElementById('kpi-orders-sub').textContent =
      s.activeOrdersCount + ' active · ' + s.pendingCount + ' pending · ' + s.cancelledCount + ' cancelled';

    document.getElementById('kpi-khata').textContent = fmtMoney(s.totalKhataReceivable);

    var inv = s.inventory || {};
    var lowStock = inv.lowStockCount || 0;
    document.getElementById('kpi-stock').textContent = lowStock + (lowStock === 1 ? ' item' : ' items');
    document.getElementById('kpi-stock-sub').textContent =
      (inv.outOfStockCount || 0) + ' out of stock · ' + (inv.totalSkus || 0) + ' SKUs';
    document.getElementById('kpi-recon').textContent = s.reconciliationMismatchCount;

    document.getElementById('badge-orders').textContent = s.totalOrders;

    var alertBtn = document.getElementById('recon-alert-btn');
    var alertText = document.getElementById('recon-alert-text');
    var badgeAudit = document.getElementById('badge-audit');

    if (s.reconciliationMismatchCount > 0) {
      alertBtn.classList.remove('ok');
      alertBtn.classList.add('err');
      alertText.textContent = fmtMoney(s.reconciliationTotalDelta) + ' total variance';
      badgeAudit.className = 'tab-badge warn';
      badgeAudit.textContent = s.reconciliationMismatchCount;
    } else {
      alertBtn.classList.remove('err');
      alertBtn.classList.add('ok');
      alertText.textContent = 'Invoices match the ledger';
      badgeAudit.className = 'tab-badge ok';
      badgeAudit.textContent = '0';
    }
  });
}

function renderCatalogTable() {
  var search = (document.getElementById('pos-search').value || '').toLowerCase().trim();
  var html = '';

  for (var i = 0; i < allProducts.length; i++) {
    var p = allProducts[i];
    if (activeCategory !== 'all' && p.category !== activeCategory) continue;
    if (search) {
      var match = p.name.toLowerCase().indexOf(search) !== -1 ||
        p.sku.toLowerCase().indexOf(search) !== -1 ||
        String(p.hsn).indexOf(search) !== -1;
      if (!match) continue;
    }

    var sellable = p.sellable != null ? p.sellable : p.stock;
    var stockBadge = '';
    if (sellable <= 0) {
      stockBadge = '<span class="stock-pill out">Out</span>';
    } else if (sellable <= p.reorderLevel) {
      stockBadge = '<span class="stock-pill low">Low <span class="stock-count">' + escapeHtml(sellable) + '</span></span>';
    } else {
      stockBadge = '<span class="stock-pill in">In stock <span class="stock-count">' + escapeHtml(sellable) + '</span></span>';
    }

    var reservedNote = p.reserved ? '<div class="prod-cat stock-detail">' + escapeHtml(p.stock) + ' on hand · ' + escapeHtml(p.reserved) + ' held</div>' : '';
    var productId = escapeHtml(p.id);
    var productName = escapeHtml(p.name);
    var curQty = escapeHtml(cartQuantities[p.id] || 0);

    html += '<tr>' +
      '<td><span class="prod-name">' + escapeHtml(p.name) + '</span>' +
      '<div class="prod-cat"><span class="sku-code">' + escapeHtml(p.sku) + '</span><span class="product-meta"> · ' + escapeHtml(p.category) + ' · per ' + escapeHtml(p.unit || 'unit') + '</span></div>' +
      '<div class="prod-cat mobile-tax">HSN ' + escapeHtml(p.hsn) + ' · ' + escapeHtml(p.gstPercent) + '% GST</div></td>' +
      '<td class="product-tax"><span class="gst-badge">' + escapeHtml(p.gstPercent) + '% GST</span><span class="hsn-badge">HSN ' + escapeHtml(p.hsn) + '</span></td>' +
      '<td class="r"><strong>' + fmtMoney(p.price) + '</strong></td>' +
      '<td class="r">' + stockBadge + reservedNote + '</td>' +
      '<td class="c">' +
      '<div class="qty-stepper">' +
      '<button type="button" class="qty-btn" data-product-id="' + productId + '" data-qty-step="-1" aria-label="Decrease quantity for ' + productName + '">−</button>' +
      '<input type="number" min="0" value="' + curQty + '" id="qty-' + productId + '" data-product-id="' + productId + '" aria-label="Quantity for ' + productName + '">' +
      '<button type="button" class="qty-btn" data-product-id="' + productId + '" data-qty-step="1" aria-label="Increase quantity for ' + productName + '">+</button>' +
      '</div>' +
      '</td>' +
      '</tr>';
  }

  if (!html) {
    html = '<tr><td colspan="5" class="c empty-row">No matching products. Try a different search or category.</td></tr>';
  }

  document.querySelector('#products tbody').innerHTML = html;
}

function stepQty(productId, delta) {
  var current = parseInt(cartQuantities[productId] || 0, 10);
  var next = Math.max(0, current + delta);
  cartQuantities[productId] = next;
  var input = document.getElementById('qty-' + productId);
  if (input) input.value = next;
  updateCartPreview();
}

function onQtyInput(productId, rawVal) {
  var val = parseInt(rawVal, 10);
  if (isNaN(val) || val < 0) val = 0;
  cartQuantities[productId] = val;
  updateCartPreview();
}

function getSelectedCartItems() {
  var items = [];
  for (var i = 0; i < allProducts.length; i++) {
    var p = allProducts[i];
    var q = parseInt(cartQuantities[p.id] || 0, 10);
    if (q > 0) {
      items.push({
        id: p.id,
        name: p.name,
        price: p.price,
        qty: q
      });
    }
  }
  return items;
}

function updateCartPreview() {
  var previewVersion = ++cartPreviewVersion;
  var items = getSelectedCartItems();
  var countEl = document.getElementById('cart-count');
  var listEl = document.getElementById('cart-items-list');
  var feedbackEl = document.getElementById('coupon-feedback');
  var couponCode = document.getElementById('coupon').value;

  var totalUnits = 0;
  for (var i = 0; i < items.length; i++) {
    totalUnits += items[i].qty;
  }
  countEl.textContent = totalUnits + (totalUnits === 1 ? ' unit' : ' units');

  if (!items.length) {
    listEl.className = 'cart-items-empty';
    listEl.textContent = 'Add products from the catalog to start the bill';
    document.getElementById('preview-subtotal').textContent = '₹0.00';
    document.getElementById('preview-discount').textContent = '-₹0.00';
    document.getElementById('preview-tax').textContent = '₹0.00';
    document.getElementById('preview-total').textContent = '₹0.00';
    feedbackEl.textContent = '';
    return;
  }

  var miniHtml = '';
  for (var j = 0; j < items.length; j++) {
    var it = items[j];
    miniHtml += '<div class="cart-mini-item">' +
      '<span>' + escapeHtml(it.name) + ' &times; ' + escapeHtml(it.qty) + '</span>' +
      '<strong>' + fmtMoney(it.price * it.qty) + '</strong>' +
      '</div>';
  }
  listEl.className = '';
  listEl.innerHTML = miniHtml;

  post('/api/pricing/preview', { items: items, coupon: couponCode }, function (status, res) {
    if (previewVersion !== cartPreviewVersion) return;
    if (!res || !res.totals) {
      feedbackEl.className = 'field-hint err';
      feedbackEl.textContent = 'Could not refresh totals. Try changing a quantity.';
      return;
    }
    var t = res.totals;
    document.getElementById('preview-subtotal').textContent = fmtMoney(t.subtotal);
    document.getElementById('preview-discount').textContent = '-' + fmtMoney(t.discount);
    document.getElementById('preview-tax').textContent = fmtMoney(t.tax);
    document.getElementById('preview-total').textContent = fmtMoney(t.total);

    if (couponCode && res.couponStatus) {
      if (res.couponStatus.valid) {
        feedbackEl.className = 'field-hint ok';
        feedbackEl.textContent = 'Promo applied: saved ' + fmtMoney(t.discount);
      } else {
        feedbackEl.className = 'field-hint err';
        feedbackEl.textContent = res.couponStatus.error;
      }
    } else {
      feedbackEl.textContent = '';
    }
  });
}

function loadProducts() {
  get('/api/products', function (data) {
    if (!data) return;
    allProducts = data;
    renderCatalogTable();
    renderInventoryAuditTable();
  });
}

function loadCustomersDropdown() {
  get('/api/customers', function (data) {
    if (!data || !data.customers) return;
    customersList = data.customers;

    var posSelect = document.getElementById('customer-select');
    var settleSelect = document.getElementById('settle-customer');

    var posOpts = '<option value="">Walk-in customer</option>';
    var settleOpts = '';

    for (var i = 0; i < customersList.length; i++) {
      var c = customersList[i];
      posOpts += '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + ' (' + escapeHtml(c.type) + ' · Due: ' + fmtMoney(c.balance) + ')</option>';
      settleOpts += '<option value="' + escapeHtml(c.id) + '">' + escapeHtml(c.name) + ' (Due: ' + fmtMoney(c.balance) + ')</option>';
    }

    posSelect.innerHTML = posOpts;
    settleSelect.innerHTML = settleOpts;

    renderKhataTable(data.customers, data.settlements || []);
  });
}

function loadOrders(button) {
  var finish = button ? setButtonLoading(button, 'Loading…') : null;
  var search = document.getElementById('orders-search').value || '';
  var status = document.getElementById('orders-status').value || 'all';
  var from = document.getElementById('orders-from').value || '';
  var to = document.getElementById('orders-to').value || '';

  var qs = '?status=' + encodeURIComponent(status) +
    '&search=' + encodeURIComponent(search) +
    '&from=' + encodeURIComponent(from) +
    '&to=' + encodeURIComponent(to);

  get('/api/orders' + qs, function (data) {
    if (finish) finish();
    if (!Array.isArray(data)) {
      showToast('orders-action-msg', 'err', 'Could not load orders', 'Try applying the filters again.', button);
      return;
    }
    var html = '';
    for (var i = 0; i < data.length; i++) {
      var o = data[i];
      var itemSummary = (o.items || []).map(function (it) {
        return it.name + ' (' + it.qty + ')';
      }).join(', ');

      var st = o.status || 'completed';
      var cancelBtn = st !== 'cancelled'
        ? ' <button type="button" class="btn btn-danger-outline" data-cancel-order="' + escapeHtml(o.id) + '">Cancel</button>'
        : '';

      html += '<tr>' +
        '<td><strong>#' + escapeHtml(o.id) + '</strong></td>' +
        '<td>' + escapeHtml(o.date) + '</td>' +
        '<td><strong>' + escapeHtml(o.customer || 'Walk-in') + '</strong></td>' +
        '<td class="item-summary">' + escapeHtml(itemSummary) + '</td>' +
        '<td><span class="sku-code">' + escapeHtml(String(o.paymentMode || 'cash').toUpperCase()) + '</span></td>' +
        '<td>' + (o.coupon ? '<span class="gst-badge">' + escapeHtml(o.coupon) + '</span>' : '<span class="prod-cat">-</span>') + '</td>' +
        '<td class="r">' + fmtMoney(o.subtotal) + '</td>' +
        '<td class="r discount-amount">' + (o.discount ? '-' + fmtMoney(o.discount) : '₹0.00') + '</td>' +
        '<td class="r">' + fmtMoney(o.tax) + '</td>' +
        '<td class="r"><strong>' + fmtMoney(o.total) + '</strong></td>' +
        '<td><span class="status-pill ' + escapeHtml(st) + '">' + escapeHtml(st) + '</span></td>' +
        '<td class="r order-actions">' +
        '<a class="btn-link" href="/orders/' + escapeHtml(encodeURIComponent(o.id)) + '/invoice" target="_blank">Invoice &nearr;</a>' +
        cancelBtn +
        '</td>' +
        '</tr>';
    }

    if (!html) {
      html = '<tr><td colspan="12" class="c empty-row">No matching orders. Try changing the dates or clearing the filters.</td></tr>';
    }

    document.querySelector('#orders tbody').innerHTML = html;
  });
}

function cancelOrder(orderId, button) {
  var finish = setButtonLoading(button, 'Cancelling…');
  post('/api/orders/' + encodeURIComponent(orderId) + '/cancel', { reason: 'Cancelled from Order Register' }, function (status, res) {
    finish();
    if (status === 200) {
      showToast('orders-action-msg', 'ok', 'Order #' + orderId + ' cancelled', 'Stock was returned to inventory.', button);
      loadOrders();
      loadProducts();
      loadCustomersDropdown();
      loadDashboardSummary();
    } else {
      showToast('orders-action-msg', 'err', 'Could not cancel order', (res && res.error) || 'Try again.', button);
    }
  });
}

function renderKhataTable(customers, settlements) {
  var html = '';
  for (var i = 0; i < customers.length; i++) {
    var c = customers[i];
    var balanceClass = c.balance > 0 ? 'due-amount' : 'credit-amount';
    html += '<tr>' +
      '<td><strong>' + escapeHtml(c.name) + '</strong><div class="prod-cat">' + escapeHtml(c.phone) + '</div></td>' +
      '<td><span class="sku-code">' + escapeHtml(c.type) + '</span>' +
      (c.gstin ? '<div class="prod-cat">' + escapeHtml(c.gstin) + '</div>' : '') + '</td>' +
      '<td class="r">' + fmtMoney(c.creditLimit) + '</td>' +
      '<td class="r">' + fmtMoney(c.openingBalance) + '</td>' +
      '<td class="r">' + fmtMoney(c.totalBilled) + '</td>' +
      '<td class="r">' + escapeHtml(fmtMoney(c.totalSettled)) + '</td>' +
      '<td class="r"><strong class="' + balanceClass + '">' + fmtMoney(c.balance) + '</strong></td>' +
      '<td class="r"><button type="button" class="btn btn-ghost btn-sm" data-settle-customer="' + escapeHtml(c.id) + '">Settle</button></td>' +
      '</tr>';
  }
  document.querySelector('#customers-table tbody').innerHTML = html ||
    '<tr><td colspan="8" class="c empty-row">No customer accounts to show</td></tr>';

  var feedHtml = '';
  for (var j = 0; j < settlements.length; j++) {
    var s = settlements[j];
    feedHtml += '<div class="settlement-card">' +
      '<div class="settlement-card-top"><span>' + escapeHtml(s.customerName) + '</span><span class="credit-amount">+' + fmtMoney(s.amount) + '</span></div>' +
      '<div class="settlement-card-sub">' + escapeHtml(s.date) + ' · ' + escapeHtml(String(s.mode).toUpperCase()) + ' · ' + escapeHtml(s.note) + '</div>' +
      '</div>';
  }
  document.getElementById('settlements-list').innerHTML = feedHtml || '<div class="prod-cat">No payments recorded yet</div>';
}

function prefillSettlement(customerId) {
  document.getElementById('settle-customer').value = String(customerId);
  document.getElementById('settle-amount').focus();
}

function renderInventoryAuditTable() {
  var html = '';
  for (var i = 0; i < allProducts.length; i++) {
    var p = allProducts[i];
    var sellable = p.sellable != null ? p.sellable : p.stock;
    var health = '<span class="stock-pill in">Healthy</span>';
    if (sellable === 0) {
      health = '<span class="stock-pill out">Depleted</span>';
    } else if (sellable <= 2) {
      health = '<span class="stock-pill low">Critical (1-2 Left)</span>';
    } else if (sellable <= p.reorderLevel) {
      health = '<span class="stock-pill low">Below Reorder (' + escapeHtml(p.reorderLevel) + ')</span>';
    }

    html += '<tr>' +
      '<td><span class="sku-code">' + escapeHtml(p.sku) + '</span></td>' +
      '<td><strong>' + escapeHtml(p.name) + '</strong></td>' +
      '<td>' + escapeHtml(p.category) + '</td>' +
      '<td><span class="hsn-badge">' + escapeHtml(p.hsn) + '</span></td>' +
      '<td class="r">' + escapeHtml(p.gstPercent) + '%</td>' +
      '<td class="r">' + fmtMoney(p.price) + '</td>' +
      '<td class="r">' + escapeHtml(p.stock) + '</td>' +
      '<td class="r">' + escapeHtml(p.reserved || 0) + '</td>' +
      '<td class="r"><strong>' + escapeHtml(sellable) + '</strong></td>' +
      '<td>' + health + '</td>' +
      '</tr>';
  }
  document.querySelector('#inventory-audit-table tbody').innerHTML = html ||
    '<tr><td colspan="10" class="c empty-row">No inventory to show</td></tr>';
}

function loadGstReconciliation() {
  get('/api/reports/gst-reconciliation', function (data) {
    if (!data || !data.rows) return;
    var pill = document.getElementById('recon-summary-pill');
    if (data.mismatchCount > 0) {
      pill.className = 'status-pill cancelled';
      pill.textContent = data.mismatchCount + ' of ' + data.totalChecked + ' Orders Mismatched (Δ ' + fmtMoney(data.totalDelta) + ')';
    } else {
      pill.className = 'status-pill completed';
      pill.textContent = 'All ' + data.totalChecked + ' Active Invoices Balanced';
    }

    var html = '';
    for (var i = 0; i < data.rows.length; i++) {
      var r = data.rows[i];
      var badge = r.matched
        ? '<span class="status-pill completed">Matched</span>'
        : '<span class="status-pill cancelled">Mismatch</span>';

      var deltaStr = (r.delta > 0 ? '+' : '') + fmtMoney(r.delta);
      var deltaClass = r.matched ? 'credit-amount' : 'mismatch-amount';

      html += '<tr>' +
        '<td><a class="btn-link" href="/orders/' + escapeHtml(encodeURIComponent(r.orderId)) + '/invoice" target="_blank">#' + escapeHtml(r.orderId) + ' &nearr;</a></td>' +
        '<td>' + escapeHtml(r.date) + '</td>' +
        '<td>' + escapeHtml(r.customer) + '</td>' +
        '<td>' + (r.coupon ? '<span class="gst-badge">' + escapeHtml(r.coupon) + '</span>' : '-') + '</td>' +
        '<td class="r">' + fmtMoney(r.ledgerSubtotal) + '</td>' +
        '<td class="r">-' + fmtMoney(r.ledgerDiscount) + '</td>' +
        '<td class="r">' + fmtMoney(r.ledgerTax) + '</td>' +
        '<td class="r"><strong>' + fmtMoney(r.ledgerTotal) + '</strong></td>' +
        '<td class="r">-' + fmtMoney(r.invoiceDiscount) + '</td>' +
        '<td class="r">' + fmtMoney(r.invoiceTax) + '</td>' +
        '<td class="r"><strong>' + fmtMoney(r.invoiceTotal) + '</strong></td>' +
        '<td class="r ' + deltaClass + '">' + deltaStr + '</td>' +
        '<td>' + badge + '</td>' +
        '</tr>';
    }
    document.querySelector('#recon-table tbody').innerHTML = html ||
      '<tr><td colspan="13" class="c empty-row">No invoices to reconcile yet</td></tr>';
  });
}

function showTab(which) {
  var tabs = ['new', 'orders', 'khata', 'audit'];
  for (var i = 0; i < tabs.length; i++) {
    var t = tabs[i];
    document.getElementById('view-' + t).style.display = (t === which) ? '' : 'none';
    var tab = document.getElementById('tab-' + t);
    tab.className = (t === which) ? 'tab-link active' : 'tab-link';
    if (t === which) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (which === 'orders') loadOrders();
  if (which === 'khata') loadCustomersDropdown();
  if (which === 'audit') {
    loadGstReconciliation();
    renderInventoryAuditTable();
  }
}

// Event bindings
var productRows = document.querySelector('#products tbody');
productRows.addEventListener('click', function (event) {
  var button = event.target.closest('button[data-qty-step]');
  if (button) stepQty(button.dataset.productId, Number(button.dataset.qtyStep));
});
productRows.addEventListener('change', function (event) {
  var input = event.target;
  if (input.matches('input[data-product-id]')) onQtyInput(input.dataset.productId, input.value);
});

document.querySelector('#orders tbody').addEventListener('click', function (event) {
  var button = event.target.closest('button[data-cancel-order]');
  if (button) cancelOrder(button.dataset.cancelOrder, button);
});

document.querySelector('#customers-table tbody').addEventListener('click', function (event) {
  var button = event.target.closest('button[data-settle-customer]');
  if (button) prefillSettlement(button.dataset.settleCustomer);
});

document.getElementById('tab-new').onclick = function () { showTab('new'); return false; };
document.getElementById('tab-orders').onclick = function () { showTab('orders'); return false; };
document.getElementById('tab-khata').onclick = function () { showTab('khata'); return false; };
document.getElementById('tab-audit').onclick = function () { showTab('audit'); return false; };
document.getElementById('recon-alert-btn').onclick = function () { showTab('audit'); };

document.getElementById('pos-search').oninput = function () {
  renderCatalogTable();
};

var catButtons = document.querySelectorAll('#pos-categories .cat-pill');
for (var cIdx = 0; cIdx < catButtons.length; cIdx++) {
  catButtons[cIdx].onclick = function () {
    activeCategory = this.getAttribute('data-cat');
    for (var j = 0; j < catButtons.length; j++) {
      catButtons[j].className = 'cat-pill';
      catButtons[j].setAttribute('aria-pressed', 'false');
    }
    this.className = 'cat-pill active';
    this.setAttribute('aria-pressed', 'true');
    renderCatalogTable();
  };
}

var promoChips = document.querySelectorAll('#promo-chips .promo-chip');
for (var pIdx = 0; pIdx < promoChips.length; pIdx++) {
  promoChips[pIdx].onclick = function () {
    document.getElementById('coupon').value = this.getAttribute('data-code');
    updateCartPreview();
  };
}

document.getElementById('coupon').oninput = function () {
  updateCartPreview();
};

document.getElementById('customer-select').onchange = function () {
  var val = this.value;
  document.getElementById('walkin-name-group').hidden = Boolean(val);
};

document.getElementById('clear-cart').onclick = function () {
  cartQuantities = {};
  document.getElementById('coupon').value = '';
  document.getElementById('customer').value = '';
  document.getElementById('customer-select').value = '';
  document.getElementById('walkin-name-group').hidden = false;
  document.getElementById('msg').className = '';
  document.getElementById('msg').textContent = '';
  renderCatalogTable();
  updateCartPreview();
};

document.getElementById('place').onclick = function () {
  var items = getSelectedCartItems();
  var button = this;
  if (!items.length) {
    showToast('msg', 'err', 'The bill is empty', 'Add a product from the catalog to place an order.', button);
    return;
  }

  var selectedCustId = document.getElementById('customer-select').value;
  var payload = {
    items: items,
    customerId: selectedCustId ? Number(selectedCustId) : null,
    customer: document.getElementById('customer').value,
    paymentMode: document.getElementById('payment-mode').value,
    coupon: document.getElementById('coupon').value
  };

  var finish = setButtonLoading(button, 'Placing order…');
  post('/api/orders', payload, function (status, res) {
    finish();
    if (status === 201) {
      cartQuantities = {};
      showToast('msg', 'ok', 'Order #' + res.id + ' placed', 'Ledger total ' + fmtMoney(res.total), button, res.id);
      loadProducts();
      updateCartPreview();
      loadDashboardSummary();
      loadCustomersDropdown();
    } else {
      showToast('msg', 'err', 'Could not place order', (res && res.error) || 'Try again.', button);
    }
  });
};

document.getElementById('btn-filter-orders').onclick = function () {
  loadOrders(this);
};

document.getElementById('btn-reset-orders').onclick = function () {
  document.getElementById('orders-search').value = '';
  document.getElementById('orders-status').value = 'all';
  document.getElementById('orders-from').value = '';
  document.getElementById('orders-to').value = '';
  loadOrders(this);
};

document.getElementById('btn-record-settlement').onclick = function () {
  var custId = document.getElementById('settle-customer').value;
  var amount = document.getElementById('settle-amount').value; // string from input
  var mode = document.getElementById('settle-mode').value;
  var note = document.getElementById('settle-note').value;
  var button = this;
  if (!custId) {
    showToast('khata-msg', 'err', 'Choose a customer', 'Select an account to record a payment.', button);
    return;
  }

  var finish = setButtonLoading(button, 'Recording payment…');
  post('/api/customers/' + custId + '/settle', {
    amount: amount,
    mode: mode,
    note: note
  }, function (status, res) {
    finish();
    if (status === 201) {
      showToast('khata-msg', 'ok', 'Payment recorded', res.customer.name + ' · Balance ' + fmtMoney(res.customer.balance), button);
      document.getElementById('settle-amount').value = '';
      document.getElementById('settle-note').value = '';
      loadCustomersDropdown();
      loadDashboardSummary();
    } else {
      showToast('khata-msg', 'err', 'Could not record payment', (res && res.error) || 'Try again.', button);
    }
  });
};

// Initial boot
loadProducts();
loadCustomersDropdown();
loadDashboardSummary();
loadGstReconciliation();
