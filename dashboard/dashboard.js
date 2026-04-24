const mockData = {
  kpis: [
    { label: "Venta del día", value: "$4,850", tone: "gold" },
    { label: "Efectivo", value: "$2,750", tone: "green" },
    { label: "Digital", value: "$2,100", tone: "blue" },
    { label: "Órdenes pagadas", value: "42", tone: "orange" },
    { label: "Ticket promedio", value: "$115", tone: "purple" },
    { label: "Productos vendidos", value: "58", tone: "orange" }
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
    { name: "Efectivo", percent: 57, tone: "green" },
    { name: "Digital", percent: 43, tone: "blue" }
  ],
  salesByHour: [
    { hour: "14:00", amount: 350, tone: "purple" },
    { hour: "15:00", amount: 620, tone: "blue" },
    { hour: "16:00", amount: 780, tone: "orange" },
    { hour: "17:00", amount: 1100, tone: "gold" },
    { hour: "18:00", amount: 1350, tone: "green" },
    { hour: "19:00", amount: 650, tone: "purple" }
  ],
  operation: [
    { label: "Órdenes activas", value: "3", tone: "orange" },
    { label: "En cocina", value: "2", tone: "blue" },
    { label: "Listas para entregar", value: "1", tone: "green" },
    { label: "Tiempo promedio de preparación", value: "12 min", tone: "purple" }
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
    .map((item) => `<article class="kpi kpi--${item.tone || "gold"}"><h3>${item.label}</h3><p>${item.value}</p></article>`)
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
    <span class="cut-badge cut-badge--green">Estado: ${mockData.cashClosing.status}</span>
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
      (item, index) => `
      <div class="bar-item">
        <div class="bar-label"><span>${item.name}</span><strong>${item.percent}%</strong></div>
        <div class="track"><div class="fill fill--${item.tone || "gold"}" style="width:${item.percent}%; --bar-delay:${index * 0.06}s"></div></div>
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
    .map((item, index) => {
      const width = Math.round((item.amount / maxValue) * 100);
      return `
        <div class="bar-item">
          <div class="bar-label"><span>${item.hour}</span><strong>${formatMoney(item.amount)}</strong></div>
          <div class="track"><div class="fill fill--${item.tone || "gold"}" style="width:${width}%; --bar-delay:${index * 0.05}s"></div></div>
        </div>
      `;
    })
    .join("");
}

function renderOperationCards() {
  const container = document.getElementById("operationCards");
  if (!container) return;
  container.innerHTML = mockData.operation
    .map((item) => `<article class="ops-card ops-card--${item.tone || "gold"}"><h3>${item.label}</h3><p>${item.value}</p></article>`)
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
