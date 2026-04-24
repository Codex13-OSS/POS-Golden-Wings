require('dotenv').config({ path: __dirname + '/.env' });
console.log("SHADOW_WRITE_ENABLED =", process.env.SHADOW_WRITE_ENABLED);
const express = require("express");
const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const { shadowWriteOrder } = require("./db_shadow");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, "data");
const MENU_PATH = path.join(DATA_DIR, "menu.json");
const ORDERS_PATH = path.join(DATA_DIR, "orders.json");
const PROMO_PATH = path.join(DATA_DIR, "promo.json");
const PROMO_TZ = "America/Mexico_City";
const readyTimers = new Map();
const PUBLIC_DIR = path.join(__dirname, "../public");
const SESSION_COOKIE = "mesero_session";
const SESSION_VALUE = "ok";

app.use(express.json({ limit: "1mb" }));

function parseCookies(cookieHeader) {
  if (!cookieHeader) {
    return {};
  }
  return cookieHeader.split(";").reduce((acc, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      return acc;
    }
    acc[key] = decodeURIComponent(rest.join("="));
    return acc;
  }, {});
}

function isAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return cookies[SESSION_COOKIE] === SESSION_VALUE;
}

app.use("/api", (req, res, next) => {
  if (req.path === "/login") {
    return next();
  }
  if (req.path === "/menu" && req.method === "GET") {
    return next();
  }
  if (req.path === "/orders" && req.method === "GET") {
    return next();
  }
  if (req.path === "/export" && req.method === "GET") {
    return next();
  }
  if (/^\/orders\/[^/]+$/.test(req.path) && req.method === "PATCH") {
    return next();
  }
  if (/^\/orders\/[^/]+\/items\/\d+$/.test(req.path) && req.method === "PATCH") {
    return next();
  }
  if (isAuthenticated(req)) {
    return next();
  }
  return res.status(401).json({ error: "No autorizado." });
});

function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error);
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`Error writing ${filePath}:`, error);
  }
}

function loadMenu() {
  return safeReadJson(MENU_PATH, { products: [] });
}

function loadOrders() {
  return safeReadJson(ORDERS_PATH, []);
}

function loadPromoState() {
  const fallback = { manualOverrideEnabled: false, updatedAt: null };
  const data = safeReadJson(PROMO_PATH, null);
  if (!data || typeof data.manualOverrideEnabled !== "boolean") {
    safeWriteJson(PROMO_PATH, fallback);
    return fallback;
  }
  return {
    manualOverrideEnabled: data.manualOverrideEnabled,
    updatedAt: data.updatedAt || null
  };
}

function savePromoState(state) {
  safeWriteJson(PROMO_PATH, state);
}

function saveOrders(orders) {
  safeWriteJson(ORDERS_PATH, orders);
}

function normalizeTable(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (value === "Para llevar" || value === "PL") {
    return "PL";
  }
  const number = Number(value);
  if (Number.isInteger(number) && number >= 1 && number <= 10) {
    return String(number);
  }
  return null;
}

function clearReadyTimer(orderId) {
  const existing = readyTimers.get(orderId);
  if (existing) {
    clearTimeout(existing);
    readyTimers.delete(orderId);
  }
}

function scheduleDelivered(orderId) {
  clearReadyTimer(orderId);
  const timer = setTimeout(() => {
    const orders = loadOrders();
    const order = orders.find((item) => item.id === orderId);
    if (!order || order.status !== "ready") {
      return;
    }
    order.status = "delivered";
    saveOrders(orders);
    broadcast("order:updated", order);
  }, 180000);
  readyTimers.set(orderId, timer);
}

function syncReadyTimer(order) {
  if (order.status === "ready") {
    scheduleDelivered(order.id);
    return;
  }
  clearReadyTimer(order.id);
}

function canTransition(from, to) {
  if (to === "cancelled") {
    return from !== "paid";
  }
  if (from === "pending") {
    return to === "preparing";
  }
  if (from === "preparing") {
    return to === "ready";
  }
  if (from === "ready") {
    return to === "delivered";
  }
  if (from === "delivered") {
    return to === "paid";
  }
  if (from === "paid") {
    return false;
  }
  return false;
}

function normalizePayments(order) {
  if (!order) return null;

  if (Array.isArray(order.payments) && order.payments.length > 0) {
    return order.payments;
  }

  if (order.paymentMethod) {
    var total = order && order.totals && typeof order.totals.total === "number"
      ? order.totals.total
      : 0;

    return [{
      method: order.paymentMethod,
      amount: total
    }];
  }

  return null;
}

function getPaymentsTotal(payments) {
  if (!Array.isArray(payments)) return 0;
  var sum = 0;
  for (var i = 0; i < payments.length; i++) {
    sum += Number(payments[i].amount) || 0;
  }
  return sum;
}

async function updateOrderStatus(id, status, meta = {}) {
  const orders = loadOrders();
  const order = orders.find((item) => item.id === id);
  if (!order) {
    return { error: "Orden no encontrada." };
  }
  if (order.status === status) {
    return { order };
  }
  if (!canTransition(order.status, status)) {
    return { error: "Transición inválida." };
  }
  order.status = status;
  if (status === "paid") {
    if (Array.isArray(meta.payments)) {
      if (meta.payments.length === 0) {
        return { error: "Payments vacío." };
      }
      var validMethods = ["cash", "card", "transfer"];

      var cleanPayments = [];

      for (var i = 0; i < meta.payments.length; i++) {
        var p = meta.payments[i];

        if (!p || !validMethods.includes(p.method)) {
          return { error: "Método de pago inválido en payments." };
        }

        cleanPayments.push({
          method: String(p.method),
          amount: Number(p.amount) || 0
        });
      }

      order.payments = cleanPayments;

      var total = order && order.totals && typeof order.totals.total === "number"
        ? order.totals.total
        : 0;

      var paidTotal = getPaymentsTotal(order.payments);

      if (paidTotal < total) {
        return { error: "Pago insuficiente." };
      }

      // Compatibilidad legacy (rellenar campos antiguos)
      var cashTotal = 0;

      for (var j = 0; j < order.payments.length; j++) {
        if (order.payments[j].method === "cash") {
          cashTotal += order.payments[j].amount;
        }
      }

      if (cashTotal > 0) {
        order.paymentMethod = "cash";
        order.cashReceived = cashTotal;
        order.changeGiven = cashTotal - total;
      } else {
        order.paymentMethod = order.payments[0].method;
        order.changeGiven = 0;
        delete order.cashReceived;
      }

      order.paidAt = new Date().toISOString();

    } else {
      const total = order && order.totals && typeof order.totals.total === "number"
        ? order.totals.total
        : 0;
      const validPaymentMethods = ["cash", "card", "transfer"];

      if (!meta.paymentMethod || !validPaymentMethods.includes(meta.paymentMethod)) {
        return { error: "Método de pago inválido." };
      }

      if (meta.paymentMethod === "cash") {
        const received = Number(meta.cashReceived);

        if (!Number.isFinite(received) || received < total) {
          return { error: "Monto recibido insuficiente." };
        }

        order.paymentMethod = "cash";
        order.cashReceived = received;
        order.changeGiven = received - total;
      } else {
        order.paymentMethod = meta.paymentMethod;
        order.changeGiven = 0;
        delete order.cashReceived;
      }
      order.paidAt = new Date().toISOString();
    }
  }
  if (status === "cancelled") {
    order.cancelledAt = new Date().toISOString();
    if (meta.cancelReason) {
      order.cancelReason = meta.cancelReason;
    }
  }
  if (status === "delivered" && !order.deliveredAt) {
    order.deliveredAt = new Date().toISOString();
  }
  saveOrders(orders);
  if (status === "paid") {
    try {
      var itemsRows = buildItemsRowsFromOrder(order);
      await shadowWriteOrder(order, itemsRows);
    } catch (err) {
      console.error("Shadow write failed:", err.message);
    }
  }
  broadcast("order:updated", order);
  syncReadyTimer(order);
  return { order };
}

function broadcast(event, data) {
  const message = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// =========================
// CSV Export (JSON -> CSV)
// =========================
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  var s = String(val);
  // Escape quotes by doubling
  if (s.indexOf('"') !== -1) s = s.replace(/"/g, '""');
  // Wrap if it contains comma, quote, or newline
  if (/[",\n\r]/.test(s)) s = '"' + s + '"';
  return s;
}

function parseDateValue(value) {
  if (!value) return null;
  var date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
}

function getOperationalDate(order) {
  try {
    var dateValue = order.paidAt || order.createdAt;
    if (!dateValue) return null;

    var d = new Date(dateValue);

    // Convertir UTC → México (UTC-6)
    var mexicoOffsetMs = -6 * 60 * 60 * 1000;
    var local = new Date(d.getTime() + mexicoOffsetMs);

    var hours = local.getUTCHours(); // usamos UTC porque ya ajustamos offset

    if (hours < 18) {
      local.setUTCDate(local.getUTCDate() - 1);
    }

    var year = local.getUTCFullYear();
    var month = String(local.getUTCMonth() + 1).padStart(2, '0');
    var day = String(local.getUTCDate()).padStart(2, '0');

    return year + '-' + month + '-' + day;
  } catch (err) {
    console.error('getOperationalDate error:', err);
    return null;
  }
}

function pickOrderDateForRange(order) {
  // Prefer paidAt for sales-based ranges; fallback to createdAt
  return parseDateValue((order && order.paidAt) ? order.paidAt : (order && order.createdAt));
}

function getCreatedAtDateKey(order) {
  var createdAt = parseDateValue(order && order.createdAt);
  return createdAt ? createdAt.toISOString().slice(0, 10) : null;
}

function diffSeconds(startValue, endValue) {
  var start = parseDateValue(startValue);
  var end = parseDateValue(endValue);
  if (!start || !end) return null;
  var diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return null;
  return Math.round(diffMs / 1000);
}

function getPreparedAtMetrics(order) {
  var items = Array.isArray(order && order.items) ? order.items : [];
  var preparedDates = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var preparedAt = parseDateValue(item.preparedAt);
    if (preparedAt) {
      preparedDates.push(preparedAt);
    }
  }

  if (!preparedDates.length) {
    return { firstPreparedAt: null, lastPreparedAt: null };
  }

  preparedDates.sort(function(a, b) {
    return a.getTime() - b.getTime();
  });

  return {
    firstPreparedAt: preparedDates[0].toISOString(),
    lastPreparedAt: preparedDates[preparedDates.length - 1].toISOString()
  };
}

function buildOrderItemsSummary(order) {
  var items = Array.isArray(order && order.items) ? order.items : [];
  var count = 0;
  var parts = [];

  for (var i = 0; i < items.length; i++) {
    var item = items[i] || {};
    var qty = toNumber(item.qty || 0);
    count += qty;

    var label = '';
    if (qty > 0) {
      label += qty + 'x ';
    }
    label += item.name || item.productId || 'item';

    var meta = item.meta || {};
    if (meta.size) {
      label += ' (' + meta.size;
      if (meta.spicy !== undefined && meta.spicy !== null) {
        label += ', Picante ' + meta.spicy;
      }
      label += ')';
    } else if (meta.spicy !== undefined && meta.spicy !== null) {
      label += ' (Picante ' + meta.spicy + ')';
    }

    var extras = Array.isArray(meta.extras) ? meta.extras : [];
    if (extras.length) {
      var extrasSummary = [];
      for (var j = 0; j < extras.length; j++) {
        var extra = extras[j] || {};
        var extraQty = toNumber(extra.qty || 0);
        var extraLabel = extra.name || extra.productId || 'extra';
        if (extraQty > 0) {
          extraLabel += ' x' + extraQty;
        }
        extrasSummary.push(extraLabel);
      }
      if (extrasSummary.length) {
        label += ' + ' + extrasSummary.join(' + ');
      }
    }

    parts.push(label);
  }

  return {
    itemsCount: count,
    itemsSummary: parts.join(' | ')
  };
}

function buildOrdersCsvRow(order) {
  var o = order || {};
  var totals = o.totals || {};
  var preparedMetrics = getPreparedAtMetrics(o);
  var itemsData = buildOrderItemsSummary(o);
  var sentToKitchenAt = o.sentToKitchenAt || null;
  var deliveredAt = o.deliveredAt || null;
  var paidAt = o.paidAt || null;
  var payments = normalizePayments(o);

  var paymentBreakdown = '';
  var cashTotal = 0;
  var cardTotal = 0;
  var transferTotal = 0;

  if (payments) {
    var parts = [];

    for (var i = 0; i < payments.length; i++) {
      var p = payments[i];
      parts.push(p.method + ':' + p.amount);

      if (p.method === 'cash') cashTotal += p.amount;
      if (p.method === 'card') cardTotal += p.amount;
      if (p.method === 'transfer') transferTotal += p.amount;
    }

    paymentBreakdown = parts.join('|');
  }

  return [
    csvEscape(o.id || ''),
    csvEscape(o.createdAt || ''),
    csvEscape(sentToKitchenAt),
    csvEscape(deliveredAt),
    csvEscape(paidAt),
    csvEscape(o.status || ''),
    csvEscape(o.table || ''),
    csvEscape(typeof totals.total === 'number' ? totals.total : (totals.total || '')),
    csvEscape(typeof o.promoDiscount === 'number' ? o.promoDiscount : (o.promoDiscount || 0)),
    csvEscape(diffSeconds(sentToKitchenAt, preparedMetrics.firstPreparedAt)),
    csvEscape(diffSeconds(sentToKitchenAt, preparedMetrics.lastPreparedAt)),
    csvEscape(diffSeconds(deliveredAt, paidAt)),
    csvEscape(diffSeconds(o.createdAt, paidAt)),
    csvEscape(itemsData.itemsCount),
    csvEscape(itemsData.itemsSummary),
    csvEscape(paymentBreakdown),
    csvEscape(cashTotal),
    csvEscape(cardTotal),
    csvEscape(transferTotal)
  ];
}

function startOfTodayLocal() {
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
}

function getRangeBounds(range) {
  var now = new Date();
  if (range === 'today') {
    return { from: startOfTodayLocal(), to: now };
  }
  // default: week (últimos 7 días)
  var from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  return { from: from, to: now };
}

function ordersToCsvRows(orders) {
  var lines = [];
  // Header
  lines.push([
    'id',
    'created_at',
    'sent_to_kitchen_at',
    'delivered_at',
    'paid_at',
    'status',
    'table',
    'total',
    'promoDiscount',
    'prep_time_seconds',
    'kitchen_total_time_seconds',
    'service_time_seconds',
    'total_time_seconds',
    'items_count',
    'items_summary',
    'payment_breakdown',
    'cash_total',
    'card_total',
    'transfer_total'
  ].join(','));

  for (var i = 0; i < orders.length; i++) {
    lines.push(buildOrdersCsvRow(orders[i]).join(','));
  }
  return lines.join('\n') + '\n';
}

function toNumber(val) {
  if (typeof val === 'number') return val;
  var n = Number(val);
  return isNaN(n) ? 0 : n;
}

function buildItemsRowsFromOrder(order) {
  var rows = [];
  var o = order || {};
  var items = Array.isArray(o.items) ? o.items : [];

  for (var j = 0; j < items.length; j++) {
    var it = items[j] || {};
    var meta = it.meta || {};
    var qty = toNumber(it.qty || 0);
    var unit = toNumber(it.unitPrice || 0);
    var lineTotal = qty * unit;

    rows.push({
      orderId: o.id || '',
      createdAt: o.createdAt || '',
      paidAt: o.paidAt || '',
      status: o.status || '',
      table: o.table || '',
      orderSubtotal: (o.totals && typeof o.totals.subtotal === 'number') ? o.totals.subtotal : (o.totals && o.totals.subtotal) || '',
      orderTotal: (o.totals && typeof o.totals.total === 'number') ? o.totals.total : (o.totals && o.totals.total) || '',
      promoDiscount: typeof o.promoDiscount === 'number' ? o.promoDiscount : (o.promoDiscount || 0),
      promoType: o.promoType || '',
      lineType: 'item',
      productId: it.productId || '',
      name: it.name || '',
      qty: qty,
      unitPrice: unit,
      lineTotal: lineTotal,
      size: meta && meta.size ? meta.size : '',
      spicy: meta && (meta.spicy !== undefined && meta.spicy !== null) ? meta.spicy : '',
      parentProductId: ''
    });

    var extras = meta && Array.isArray(meta.extras) ? meta.extras : [];
    for (var k = 0; k < extras.length; k++) {
      var ex = extras[k] || {};
      var exQty = toNumber(ex.qty || 0);
      var exUnit = toNumber(ex.unitPrice || 0);
      var exTotal = exQty * exUnit;
      rows.push({
        orderId: o.id || '',
        createdAt: o.createdAt || '',
        paidAt: o.paidAt || '',
        status: o.status || '',
        table: o.table || '',
        orderSubtotal: (o.totals && typeof o.totals.subtotal === 'number') ? o.totals.subtotal : (o.totals && o.totals.subtotal) || '',
        orderTotal: (o.totals && typeof o.totals.total === 'number') ? o.totals.total : (o.totals && o.totals.total) || '',
        promoDiscount: typeof o.promoDiscount === 'number' ? o.promoDiscount : (o.promoDiscount || 0),
        promoType: o.promoType || '',
        lineType: 'extra',
        productId: ex.productId || '',
        name: ex.name || '',
        qty: exQty,
        unitPrice: exUnit,
        lineTotal: exTotal,
        size: meta && meta.size ? meta.size : '',
        spicy: meta && (meta.spicy !== undefined && meta.spicy !== null) ? meta.spicy : '',
        parentProductId: it.productId || ''
      });
    }
  }

  return rows;
}

function ordersToItemsCsvRows(orders) {
  var lines = [];
  lines.push([
    'orderId','createdAt','paidAt','status','table',
    'orderSubtotal','orderTotal','promoDiscount','promoType',
    'lineType','productId','name','qty','unitPrice','lineTotal',
    'size','spicy','parentProductId'
  ].join(','));

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i] || {};
    var rows = buildItemsRowsFromOrder(o);

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      lines.push([
        csvEscape(o.id || ''),
        csvEscape(o.createdAt || ''),
        csvEscape(o.paidAt || ''),
        csvEscape(o.status || ''),
        csvEscape(o.table || ''),
        csvEscape(typeof o.totals?.subtotal === 'number' ? o.totals.subtotal : (o.totals?.subtotal || '')),
        csvEscape(typeof o.totals?.total === 'number' ? o.totals.total : (o.totals?.total || '')),
        csvEscape(typeof o.promoDiscount === 'number' ? o.promoDiscount : (o.promoDiscount || 0)),
        csvEscape(o.promoType || ''),
        csvEscape(row.lineType),
        csvEscape(row.productId),
        csvEscape(row.name),
        csvEscape(row.qty),
        csvEscape(row.unitPrice),
        csvEscape(row.lineTotal),
        csvEscape(row.size),
        csvEscape(row.spicy),
        csvEscape(row.parentProductId)
      ].join(','));
    }
  }

  return lines.join('\n') + '\n';
}

function generateOrderId() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ORD-${Date.now()}-${random}`;
}

function generateItemId(prefix = "item") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildLegacyItemId(orderId, index) {
  return `legacy-${orderId}-${index}`;
}

function normalizeIncomingItem(item, fallbackId) {
  return {
    ...item,
    id: item && item.id ? item.id : fallbackId || generateItemId(),
    parentItemId: item && item.parentItemId ? item.parentItemId : undefined,
    prepared: item && typeof item.prepared === "boolean" ? item.prepared : false
  };
}

function ensureExistingOrderItemIds(order) {
  if (!order || !Array.isArray(order.items)) {
    return;
  }
  order.items = order.items.map((item, index) => {
    if (item && item.id) {
      return item;
    }
    return {
      ...item,
      id: buildLegacyItemId(order.id, index)
    };
  });
}

function validateOrderPayload(payload) {
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return "La orden debe incluir items.";
  }
  if (!payload.totals || typeof payload.totals.total !== "number") {
    return "La orden debe incluir totales válidos.";
  }
  const table = normalizeTable(payload.table);
  if (!table) {
    return "La orden debe incluir mesa válida.";
  }
  return null;
}

function isThursdayNow(now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: PROMO_TZ, weekday: "short" }).format(now);
  return weekday === "Thu";
}

function buildPromoPayload(promoState, now = new Date()) {
  const isThursday = isThursdayNow(now);
  const manualOverrideEnabled = Boolean(promoState.manualOverrideEnabled);
  const promoActive = isThursday || manualOverrideEnabled;
  const promoSource = promoActive ? (isThursday ? "auto_thursday" : "manual_override") : null;
  return {
    isThursdayNow: isThursday,
    manualOverrideEnabled,
    promoActive,
    promoSource,
    tz: PROMO_TZ,
    nowISO: now.toISOString(),
    promoType: "2x1_jueves"
  };
}

function calculatePromoDiscount(items) {
  const menu = loadMenu();
  const menuById = new Map(menu.products.map((product) => [product.id, product]));
  const ramenBasePrices = [];
  items.forEach((item) => {
    const product = menuById.get(item.productId);
    if (!product || product.category !== "ramen") {
      return;
    }
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitPrice)) {
      return;
    }
    const extrasTotal = Array.isArray(item.meta && item.meta.extras)
      ? item.meta.extras.reduce((sum, extra) => {
        const extraUnit = Number(extra.unitPrice);
        const extraQty = Number(extra.qty);
        if (!Number.isFinite(extraUnit) || !Number.isFinite(extraQty)) {
          return sum;
        }
        return sum + extraUnit * extraQty;
      }, 0)
      : 0;
    const basePrice = unitPrice - extrasTotal;
    const safeBasePrice = Number.isFinite(basePrice) ? Math.max(0, basePrice) : 0;
    for (let i = 0; i < qty; i += 1) {
      ramenBasePrices.push(safeBasePrice);
    }
  });
  ramenBasePrices.sort((a, b) => a - b);
  let discount = 0;
  for (let i = 0; i + 1 < ramenBasePrices.length; i += 2) {
    discount += ramenBasePrices[i];
  }
  return discount;
}

app.get("/api/menu", (req, res) => {
  const menu = loadMenu();
  res.json(menu);
});

app.get("/api/promo", (req, res) => {
  const promoState = loadPromoState();
  const payload = buildPromoPayload(promoState);
  res.json(payload);
});

app.post("/api/promo/override", (req, res) => {
  const { enabled } = req.body || {};
  const promoState = {
    manualOverrideEnabled: Boolean(enabled),
    updatedAt: new Date().toISOString()
  };
  savePromoState(promoState);
  const payload = buildPromoPayload(promoState);
  res.json(payload);
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const normalizedUser = typeof username === "string" ? username.trim().toLowerCase() : "";
  const normalizedPass = typeof password === "string" ? password.trim() : "";
  if (normalizedUser === "aurora" && normalizedPass === "pucca123") {
    res.cookie(SESSION_COOKIE, SESSION_VALUE, { httpOnly: true, sameSite: "lax" });
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Credenciales inválidas." });
});

app.get("/logout", (req, res) => {
  res.clearCookie(SESSION_COOKIE);
  res.redirect("/login");
});

app.get("/api/orders", (req, res) => {
  const { status } = req.query;
  let orders = loadOrders();
  if (status) {
    orders = orders.filter((order) => order.status === status);
  }
  orders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json(orders);
});

app.post("/api/orders", (req, res) => {
  const error = validateOrderPayload(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const table = normalizeTable(req.body.table);
  if (!table) {
    return res.status(400).json({ error: "Mesa inválida." });
  }

  const now = new Date();
  const promoState = loadPromoState();
  const promoPayload = buildPromoPayload(promoState, now);
  const promoDiscount = calculatePromoDiscount(req.body.items);
  const promoApplied = promoPayload.promoActive && promoDiscount > 0;
  const totals = req.body.totals;
  const noteValue = typeof req.body.note === "string"
    ? req.body.note.trim()
    : typeof req.body.notes === "string"
      ? req.body.notes.trim()
      : "";
  const note = noteValue || null;

  const orders = loadOrders();
  const order = {
    id: generateOrderId(),
    createdAt: now.toISOString(),
    status: "pending",
    table,
    items: req.body.items.map((item) => normalizeIncomingItem(item, generateItemId())),
    totals,
    note,
    notes: noteValue
  };
  if (!order.sentToKitchenAt) {
    order.sentToKitchenAt = order.createdAt;
  }
  order.promoApplied = promoApplied;
  order.promoType = "2x1_jueves";
  order.promoSource = promoPayload.promoActive ? promoPayload.promoSource : null;
  order.promoDiscount = promoDiscount;
  order.promoTimestamp = now.toISOString();
  orders.push(order);
  saveOrders(orders);
  broadcast("order:new", order);
  syncReadyTimer(order);
  res.status(201).json(order);
});

app.patch("/api/orders/:id", async (req, res) => {
  const { id } = req.params;
  const { status, cancelReason, cashReceived, changeGiven, paymentMethod, payments } = req.body;
  if (!status || !["pending", "preparing", "ready", "delivered", "paid", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Status inválido." });
  }
  const result = await updateOrderStatus(id, status, {
    cancelReason,
    cashReceived,
    changeGiven,
    paymentMethod,
    payments
  });
  if (result.error) {
    const code = result.error === "Orden no encontrada." ? 404 : 400;
    return res.status(code).json({ error: result.error });
  }
  res.json(result.order);
});

app.post("/api/orders/:id/items", (req, res) => {
  const { id } = req.params;
  const itemsToAppend = req.body && Array.isArray(req.body.items) ? req.body.items : null;
  if (!itemsToAppend || !itemsToAppend.length) {
    return res.status(400).json({ error: "Items inválidos." });
  }

  const orders = loadOrders();
  const order = orders.find((item) => item.id === id);
  if (!order) {
    return res.status(404).json({ error: "Orden no encontrada." });
  }
  if (["paid", "cancelled"].includes(order.status)) {
    return res.status(400).json({ error: "La orden no puede editarse." });
  }

  ensureExistingOrderItemIds(order);

  const normalizedItems = itemsToAppend
    .map((item) => normalizeIncomingItem({
      productId: item && item.productId,
      name: item && item.name,
      qty: Number(item && item.qty),
      basePrice: Number(item && item.basePrice),
      unitPrice: Number(item && item.unitPrice),
      meta: item && item.meta ? item.meta : {},
      parentItemId: item && item.parentItemId,
      prepared: item && typeof item.prepared === "boolean" ? item.prepared : false
    }, generateItemId()))
    .filter((item) => item.productId && item.name && Number.isFinite(item.qty) && item.qty > 0 && Number.isFinite(item.unitPrice));

  if (!normalizedItems.length) {
    return res.status(400).json({ error: "Items inválidos." });
  }

  order.items = [...(order.items || []), ...normalizedItems];

  const subtotal = order.items.reduce((sum, item) => {
    const qty = Number(item.qty);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(qty) || !Number.isFinite(unitPrice)) {
      return sum;
    }
    return sum + qty * unitPrice;
  }, 0);

  const now = new Date();
  const promoState = loadPromoState();
  const promoPayload = buildPromoPayload(promoState, now);
  const promoDiscount = calculatePromoDiscount(order.items);
  const promoApplied = promoPayload.promoActive && promoDiscount > 0;

  order.totals = {
    subtotal,
    total: promoApplied ? Math.max(0, subtotal - promoDiscount) : subtotal
  };
  order.promoApplied = promoApplied;
  order.promoType = "2x1_jueves";
  order.promoSource = promoPayload.promoActive ? promoPayload.promoSource : null;
  order.promoDiscount = promoDiscount;
  order.promoTimestamp = now.toISOString();

  saveOrders(orders);
  broadcast("order:updated", order);
  syncReadyTimer(order);
  res.json(order);
});

app.patch("/api/orders/:orderId/items/:index", (req, res) => {
  const { orderId, index } = req.params;
  const { prepared } = req.body || {};
  const itemIndex = Number(index);

  if (!Number.isInteger(itemIndex) || itemIndex < 0) {
    return res.status(400).json({ error: "Índice inválido." });
  }
  if (typeof prepared !== "boolean") {
    return res.status(400).json({ error: "Campo prepared inválido." });
  }

  const orders = loadOrders();
  const order = orders.find((item) => item.id === orderId);
  if (!order) {
    return res.status(404).json({ error: "Orden no encontrada." });
  }
  if (!Array.isArray(order.items) || !order.items[itemIndex]) {
    return res.status(404).json({ error: "Item no encontrado." });
  }

  order.items[itemIndex].prepared = prepared;

  if (prepared && !order.items[itemIndex].preparedAt) {
    const now = new Date().toISOString();
    if (!Array.isArray(order.events)) order.events = [];
    order.items[itemIndex].preparedAt = now;
    order.events.push({
      type: "item_prepared",
      itemId: order.items[itemIndex].id,
      timestamp: now
    });
  }

  saveOrders(orders);
  broadcast("order:updated", order);
  res.json(order);
});

app.post("/api/orders/cleanup-tests", (req, res) => {
  const body = req.body || {};
  if (body.confirmText !== "LIMPIAR") {
    return res.status(400).json({ error: "Confirmación inválida." });
  }
  const date = typeof body.date === "string" ? body.date.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "Fecha inválida." });
  }

  const orders = loadOrders();
  const keep = [];
  let removed = 0;

  orders.forEach((order) => {
    const sourceDate = order && (order.createdAt || order.timestamp || order.updatedAt);
    const parsed = sourceDate ? new Date(sourceDate) : null;
    if (!parsed || Number.isNaN(parsed.getTime())) {
      keep.push(order);
      return;
    }
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, "0");
    const day = String(parsed.getDate()).padStart(2, "0");
    const orderDate = `${year}-${month}-${day}`;
    if (orderDate === date) {
      removed += 1;
      clearReadyTimer(order.id);
      return;
    }
    keep.push(order);
  });

  saveOrders(keep);
  res.json({ ok: true, removed, date });
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.use(express.static(PUBLIC_DIR));

app.use((req, res, next) => {
  const pathName = req.path;
  if (pathName.startsWith("/kitchen")) {
    return next();
  }
  if (pathName.startsWith("/api")) {
    return next();
  }
  if (pathName === "/login" || pathName === "/logout" || pathName === "/login.css" || pathName === "/login.js") {
    return next();
  }
  if (pathName === "/admin/export.csv" || pathName === "/admin/export-items.csv") {
    return next();
  }
  if (pathName === "/assets/brand/logo.png" || pathName.startsWith("/assets/menu/")) {
    return next();
  }
  if (isAuthenticated(req)) {
    return next();
  }
  return res.redirect("/login");
});

function hasExportAccess(req) {
  var tokenEnv = process.env.ADMIN_EXPORT_TOKEN;
  var tokenQ = req.query && req.query.token ? String(req.query.token) : '';
  var hasValidToken = tokenEnv && tokenQ && tokenQ === tokenEnv;
  if (hasValidToken) {
    return true;
  }
  var cookieHeader = req.headers && req.headers.cookie ? String(req.headers.cookie) : '';
  return cookieHeader.indexOf('mesero_session=ok') !== -1;
}

function getFilteredOrdersForExport(req) {
  var include = (req.query && req.query.include) ? String(req.query.include) : 'paid';
  var range = (req.query && req.query.range) ? String(req.query.range) : 'week';
  var date = req.query.date;
  var bounds = getRangeBounds(range);
  var orders = loadOrders() || [];
  var filtered = [];

  for (var i = 0; i < orders.length; i++) {
    var o = orders[i];
    if (!o) continue;
    if (include !== 'all') {
      if (o.status !== 'paid') continue; // PAGADO real confirmado
    }
    // Excluir canceladas siempre salvo include=all (si quieren auditar)
    if (include !== 'all' && o.status === 'cancelled') continue;

    // NUEVO: filtro por día operativo si viene ?date
    if (date) {
      var opDate = getOperationalDate(o);
      if (opDate !== date) continue;
    } else {
      // comportamiento original
      var d = pickOrderDateForRange(o);
      if (!d || isNaN(d.getTime())) continue;
      if (d < bounds.from || d > bounds.to) continue;
    }
    filtered.push(o);
  }

  filtered.sort(function(a, b) {
    var da = date ? parseDateValue(a && a.createdAt) : pickOrderDateForRange(a);
    var db = date ? parseDateValue(b && b.createdAt) : pickOrderDateForRange(b);
    var ta = da ? da.getTime() : 0;
    var tb = db ? db.getTime() : 0;
    return ta - tb;
  });

  return filtered;
}

function handleOrdersCsvExport(req, res) {
  try {
    if (!hasExportAccess(req)) {
      res.status(401).send('Unauthorized');
      return;
    }

    var csv = ordersToCsvRows(getFilteredOrdersForExport(req));

    var now = new Date();
    var yyyy = String(now.getFullYear());
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var fname = 'deku_orders_' + yyyy + '-' + mm + '-' + dd + '.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
    res.status(200).send(csv);
  } catch (e) {
    console.error('[export.csv] error:', e);
    res.status(500).send('Export error');
  }
}

// Admin export CSV (JSON source of truth)
app.get('/admin/export.csv', handleOrdersCsvExport);
app.get('/api/export', handleOrdersCsvExport);

// Admin export detailed items CSV (JSON source of truth)
app.get('/admin/export-items.csv', function(req, res) {
  try {
    var tokenEnv = process.env.ADMIN_EXPORT_TOKEN;
    var tokenQ = req.query && req.query.token ? String(req.query.token) : '';
    var hasValidToken = tokenEnv && tokenQ && tokenQ === tokenEnv;

    if (!hasValidToken) {
      var cookieHeader = req.headers && req.headers.cookie ? String(req.headers.cookie) : '';
      if (cookieHeader.indexOf('mesero_session=ok') === -1) {
        res.status(401).send('Unauthorized');
        return;
      }
    }

    var include = (req.query && req.query.include) ? String(req.query.include) : 'paid';
    var range = (req.query && req.query.range) ? String(req.query.range) : 'week';
    var date = req.query.date;
    var bounds = getRangeBounds(range);

    var orders = loadOrders() || [];
    var filtered = [];
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o) continue;
      if (include !== 'all') {
        if (o.status !== 'paid') continue;
      }
      if (include !== 'all' && o.status === 'cancelled') continue;

      if (date) {
        var opDate = getOperationalDate(o);
        if (opDate !== date) continue;
      } else {
        var d = pickOrderDateForRange(o);
        if (!d || isNaN(d.getTime())) continue;
        if (d < bounds.from || d > bounds.to) continue;
      }
      filtered.push(o);
    }

    filtered.sort(function(a, b) {
      var da = pickOrderDateForRange(a);
      var db = pickOrderDateForRange(b);
      var ta = da ? da.getTime() : 0;
      var tb = db ? db.getTime() : 0;
      return ta - tb;
    });

    var csv = ordersToItemsCsvRows(filtered);

    var now = new Date();
    var yyyy = String(now.getFullYear());
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    var fname = 'deku_order_items_' + yyyy + '-' + mm + '-' + dd + '.csv';

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
    res.status(200).send(csv);
  } catch (e) {
    console.error('[export-items.csv] error:', e);
    res.status(500).send('Export error');
  }
});

app.use("/kitchen", express.static(path.join(__dirname, "../kitchen-display")));
app.use("/", express.static(path.join(__dirname, "../waiter-app")));

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ event: "connected", data: "ok" }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`POS backend running on http://localhost:${PORT}`);
  loadOrders().forEach((order) => syncReadyTimer(order));
});
