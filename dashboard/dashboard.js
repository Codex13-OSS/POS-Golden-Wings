const mockData = {
  kpis: [
    { label: "Venta del día", value: "$4,850" },
    { label: "Efectivo", value: "$2,750" },
    { label: "Digital", value: "$2,100" },
    { label: "Órdenes pagadas", value: "42" },
    { label: "Ticket promedio", value: "$115" },
    { label: "Productos vendidos", value: "58" }
  ],
  cashClosing: {
    total: "$4,850",
    cash: "$2,750",
    digital: "$2,100",
    diff: "$0",
    status: "Caja cuadrada"
  },
  topProducts: [
    { name: "Alitas", units: 24, total: "$1,800" },
    { name: "Hamburguesa", units: 18, total: "$1,800" },
    { name: "Virutas de pollo", units: 16, total: "$1,520" }
  ],
  paymentMethods: [
    { name: "Efectivo", percent: 57 },
    { name: "Digital", percent: 43 }
  ],
  salesByHour: [
    { hour: "14:00", amount: 350 },
    { hour: "15:00", amount: 620 },
    { hour: "16:00", amount: 780 },
    { hour: "17:00", amount: 1100 },
    { hour: "18:00", amount: 1350 },
    { hour: "19:00", amount: 650 }
  ],
  operation: [
    { label: "Órdenes activas", value: "3" },
    { label: "En cocina", value: "2" },
    { label: "Listas para entregar", value: "1" },
    { label: "Tiempo promedio de preparación", value: "12 min" }
  ],
  insight:
    "Hoy las alitas representan el 37% de las unidades vendidas. Recomendación: mantener inventario fuerte para horas pico."
};

function formatMoney(value) {
  return `$${value.toLocaleString("es-MX")}`;
}

function renderKPIs() {
  const container = document.getElementById("kpiGrid");
  if (!container) return;
  container.innerHTML = mockData.kpis
    .map((item) => `<article class="kpi"><h3>${item.label}</h3><p>${item.value}</p></article>`)
    .join("");
}

function renderCashClosing() {
  const container = document.getElementById("cashClosing");
  if (!container) return;
  container.innerHTML = `
    <div class="cut-row"><span>Total vendido</span><strong>${mockData.cashClosing.total}</strong></div>
    <div class="cut-row"><span>Efectivo esperado</span><strong>${mockData.cashClosing.cash}</strong></div>
    <div class="cut-row"><span>Digital esperado</span><strong>${mockData.cashClosing.digital}</strong></div>
    <div class="cut-row"><span>Diferencia</span><strong>${mockData.cashClosing.diff}</strong></div>
    <span class="cut-badge">Estado: ${mockData.cashClosing.status}</span>
  `;
}

function renderTopProducts() {
  const tbody = document.getElementById("topProducts");
  if (!tbody) return;
  tbody.innerHTML = mockData.topProducts
    .map(
      (item) => `
      <tr>
        <td>${item.name}</td>
        <td>${item.units}</td>
        <td>${item.total}</td>
      </tr>
    `
    )
    .join("");
}

function renderPaymentMethods() {
  const container = document.getElementById("paymentMethods");
  if (!container) return;
  container.innerHTML = mockData.paymentMethods
    .map(
      (item) => `
      <div>
        <div class="bar-label"><span>${item.name}</span><strong>${item.percent}%</strong></div>
        <div class="track"><div class="fill" style="width:${item.percent}%"></div></div>
      </div>
    `
    )
    .join("");
}

function renderSalesByHour() {
  const container = document.getElementById("salesByHour");
  if (!container) return;
  const maxValue = Math.max(...mockData.salesByHour.map((item) => item.amount), 1);
  container.innerHTML = mockData.salesByHour
    .map((item) => {
      const width = Math.round((item.amount / maxValue) * 100);
      return `
        <div>
          <div class="bar-label"><span>${item.hour}</span><strong>${formatMoney(item.amount)}</strong></div>
          <div class="track"><div class="fill" style="width:${width}%"></div></div>
        </div>
      `;
    })
    .join("");
}

function renderOperationCards() {
  const container = document.getElementById("operationCards");
  if (!container) return;
  container.innerHTML = mockData.operation
    .map((item) => `<article class="ops-card"><h3>${item.label}</h3><p>${item.value}</p></article>`)
    .join("");
}

function renderInsight() {
  const element = document.getElementById("businessInsight");
  if (!element) return;
  element.textContent = mockData.insight;
}

function renderTodayDate() {
  const element = document.getElementById("todayDate");
  if (!element) return;
  const today = new Date();
  element.textContent = today.toLocaleDateString("es-MX", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function initDashboard() {
  renderTodayDate();
  renderKPIs();
  renderCashClosing();
  renderTopProducts();
  renderPaymentMethods();
  renderSalesByHour();
  renderOperationCards();
  renderInsight();
}

initDashboard();
