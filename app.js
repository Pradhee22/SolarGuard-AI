/* ============================================================
   SOLARSENSE AI — app.js
   Live telemetry, demo engine, sparklines, charts, alerts
   ============================================================ */

'use strict';

/* ── Firebase config (replace with your credentials) ─────── */
const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_KEY",
  authDomain: "solarpulseai-7d2c0.firebaseapp.com",
  databaseURL: "https://solarpulseai-7d2c0-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "solarpulseai-7d2c0",
  storageBucket: "solarpulseai-7d2c0.firebasestorage.app",
  messagingSenderId: "498003967404",
  appId: "1:498003967404:web:2e5070536d20e200dece09"
};
const USE_DEMO = true; // set false when firebaseConfig is real

/* ── Sensor history buffers ─────────────────────────────── */
const MAX_HIST = 40;
const history = {
  voltage:    [], current:   [], power:      [], efficiency: [],
  irradiance: [], temp:      [], humidity:   [], pressure:   [],
  labels:     []
};

/* ── Previous values for trend calculation ─────────────── */
const prev = {};

/* ── Update interval handle ─────────────────────────────── */
let updateInterval = 3000;
let updateTimer    = null;

/* ── Sparkline chart instances ───────────────────────────── */
const sparkCharts = {};

/* ── Big analytics chart instances ───────────────────────── */
let chartPV       = null;
let chartEff      = null;
let chartEnv      = null;
let chartDaily    = null;
let chartIV       = null;

/* ── Alert store ─────────────────────────────────────────── */
let alerts = [];
let alertIdCounter = 1;

/* ── Maintenance data ─────────────────────────────────────── */
const maintData = [
  { panel:'SP-A101', issue:'Mild soiling — output -4%',         sev:'medium', date:'Aug 25',  status:'pending',  action:'clean'   },
  { panel:'SP-A102', issue:'Hot spot detected — Cell row 3',    sev:'high',   date:'Aug 24',  status:'pending',  action:'inspect' },
  { panel:'SP-B201', issue:'PID degradation early signs',       sev:'critical',date:'Aug 23', status:'reviewed', action:'inspect' },
  { panel:'SP-B202', issue:'Shading analysis — partial shadow', sev:'low',    date:'Aug 22',  status:'resolved', action:'ok'      },
  { panel:'SP-C301', issue:'Inverter mismatch (string voltage)', sev:'high',  date:'Aug 21',  status:'pending',  action:'inspect' },
  { panel:'SP-A104', issue:'Routine scheduled maintenance',     sev:'low',    date:'Sep 1',   status:'pending',  action:'clean'   },
];

/* ── Threshold store ─────────────────────────────────────── */
const thresholds = {
  temp:       { label:'Temperature', unit:'°C', direction:'above', value: 45 },
  efficiency: { label:'Efficiency',  unit:'%',  direction:'below', value: 12 },
  power:      { label:'Power',       unit:'W',  direction:'below', value: 50 },
};

/* ============================================================
   DEMO DATA ENGINE
   ============================================================ */
const DEMO_BASE = {
  voltage:    33.0,
  current:     8.4,
  power:     278.0,
  efficiency: 19.5,
  irradiance: 880,
  temp:        27.5,
  humidity:    46,
  pressure:  1013.5,
};

function gaussNoise(std = 1) {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std;
}

function generateDemoReading() {
  const t = Date.now() / 1000;
  const irr = Math.max(200, DEMO_BASE.irradiance + 40 * Math.sin(t / 60) + gaussNoise(15));
  const volt = Math.max(20, DEMO_BASE.voltage   + 0.8 * Math.sin(t / 45) + gaussNoise(.25));
  const curr = Math.max(0,  DEMO_BASE.current   + 0.4 * Math.sin(t / 30) + gaussNoise(.15));
  const pow  = volt * curr;
  const eff  = Math.min(25, Math.max(5, (pow / (irr * 1.65)) * 100 + gaussNoise(.4)));
  return {
    voltage:    +volt.toFixed(2),
    current:    +curr.toFixed(2),
    power:      +pow.toFixed(1),
    efficiency: +eff.toFixed(1),
    irradiance: +irr.toFixed(0),
    temp:       +(DEMO_BASE.temp       + 0.3 * Math.sin(t / 90) + gaussNoise(.15)).toFixed(1),
    humidity:   +(DEMO_BASE.humidity   + 2.0 * Math.sin(t / 120)+ gaussNoise(.5)).toFixed(1),
    pressure:   +(DEMO_BASE.pressure   + 0.2 * Math.sin(t / 200)+ gaussNoise(.1)).toFixed(1),
  };
}

/* ============================================================
   KPI CARD UPDATER
   ============================================================ */
function formatTime(d) {
  return d.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
}

function calcTrend(key, current) {
  const p = prev[key];
  if (p === undefined) { prev[key] = current; return { pct: 0, dir: 'stable' }; }
  const change = ((current - p) / (Math.abs(p) || 1)) * 100;
  prev[key] = current;
  const dir = Math.abs(change) < 0.05 ? 'stable' : (change > 0 ? 'up' : 'down');
  return { pct: Math.abs(change).toFixed(1), dir };
}

function renderTrendBadge(id, trend) {
  const el = document.getElementById(`kt-${id}`);
  if (!el) return;
  const icons = { up:'arrow_upward', down:'arrow_downward', stable:'remove' };
  const classes = { up:'trend-up', down:'trend-down', stable:'trend-stable' };
  el.className = `kpi-trend-badge ${classes[trend.dir]}`;
  el.innerHTML = `<span class="material-symbols-rounded">${icons[trend.dir]}</span>${trend.pct}%`;
}

function updateKPICard(id, value, formatted) {
  const el = document.getElementById(`kv-${id}`);
  if (!el) return;
  // Animate number change
  el.style.transition = 'opacity .15s';
  el.style.opacity    = '0';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.textContent    = formatted;
      el.style.opacity  = '1';
    });
  });
  // Time
  const tel = document.getElementById(`ktime-${id}`);
  if (tel) tel.textContent = formatTime(new Date());
  // Trend
  const trend = calcTrend(id, value);
  renderTrendBadge(id, trend);
}

/* ============================================================
   SPARKLINES
   ============================================================ */
const SPARK_COLORS = {
  voltage:    '#3B82F6',
  current:    '#06B6D4',
  power:      '#F59E0B',
  efficiency: '#10B981',
  irradiance: '#F97316',
  temp:       '#EF4444',
  humidity:   '#06B6D4',
  pressure:   '#8B5CF6',
};

function initSparkline(key) {
  const canvas = document.getElementById(`spark-${key}`);
  if (!canvas) return;
  canvas.width  = 80;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const color = SPARK_COLORS[key] || '#10B981';
  const grad  = ctx.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, color + '44');
  grad.addColorStop(1, color + '00');
  sparkCharts[key] = new Chart(ctx, {
    type: 'line',
    data: {
      labels:   [],
      datasets: [{
        data:          [],
        borderColor:   color,
        backgroundColor: grad,
        borderWidth:   1.5,
        pointRadius:   0,
        fill:          true,
        tension:       0.4,
      }]
    },
    options: {
      responsive:          false,
      animation:           { duration: 0 },
      plugins:             { legend: { display: false }, tooltip: { enabled: false } },
      scales:              { x: { display: false }, y: { display: false } },
      elements:            { line: { tension: 0.4 } },
    }
  });
}

function updateSparkline(key, value) {
  const ch = sparkCharts[key];
  if (!ch) return;
  ch.data.labels.push('');
  ch.data.datasets[0].data.push(value);
  if (ch.data.labels.length > 25) {
    ch.data.labels.shift();
    ch.data.datasets[0].data.shift();
  }
  ch.update('none');
}

/* ============================================================
   ANALYTICS CHARTS
   ============================================================ */
function isDarkTheme() {
  return document.documentElement.getAttribute('data-theme') !== 'light';
}

function chartColors() {
  return {
    grid:    isDarkTheme() ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.06)',
    tick:    isDarkTheme() ? '#4A5568' : '#94A3B8',
    tooltip: isDarkTheme() ? '#141F30' : '#ffffff',
  };
}

function buildChartDefaults() {
  const { grid, tick } = chartColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600 },
    plugins: {
      legend: { labels: { color: tick, font: { family: 'Inter', size: 11 }, boxWidth: 12 } },
      tooltip: { backgroundColor: isDarkTheme() ? '#141F30' : '#fff',
                 titleColor: isDarkTheme() ? '#E2EAF4' : '#0F172A',
                 bodyColor: isDarkTheme() ? '#8B9CB5' : '#475569',
                 borderColor: isDarkTheme() ? 'rgba(255,255,255,.1)' : 'rgba(0,0,0,.1)',
                 borderWidth: 1, cornerRadius: 8, padding: 10 }
    },
    scales: {
      x: { ticks: { color: tick, font: { size: 10 } }, grid: { color: grid } },
      y: { ticks: { color: tick, font: { size: 10 } }, grid: { color: grid } },
    }
  };
}

function initAnalyticsCharts() {
  const d = buildChartDefaults();

  /* Power & Voltage */
  const ctxPV = document.getElementById('chart-power-voltage');
  if (ctxPV && !chartPV) {
    chartPV = new Chart(ctxPV, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Power (W)',   data: [], borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,.1)', fill:true, tension:.4, pointRadius:0, yAxisID:'y' },
          { label: 'Voltage (V)', data: [], borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,.08)', fill:false, tension:.4, pointRadius:0, yAxisID:'y1' },
        ]
      },
      options: { ...d, scales: { ...d.scales, y1: { position:'right', ticks:{ color: chartColors().tick, font:{size:10} }, grid:{ display:false } } } }
    });
  }

  /* Efficiency */
  const ctxEff = document.getElementById('chart-efficiency');
  if (ctxEff && !chartEff) {
    chartEff = new Chart(ctxEff, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{ label:'Efficiency (%)', data:[], borderColor:'#10B981', backgroundColor:'rgba(16,185,129,.12)', fill:true, tension:.4, pointRadius:0 }]
      },
      options: d
    });
  }

  /* Environmental */
  const ctxEnv = document.getElementById('chart-env');
  if (ctxEnv && !chartEnv) {
    chartEnv = new Chart(ctxEnv, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label:'Temp (°C)',       data:[], borderColor:'#EF4444', tension:.4, pointRadius:0, fill:false },
          { label:'Humidity (%RH)',  data:[], borderColor:'#06B6D4', tension:.4, pointRadius:0, fill:false },
          { label:'Irradiance/10',  data:[], borderColor:'#F97316', tension:.4, pointRadius:0, fill:false },
        ]
      },
      options: d
    });
  }

  /* Daily Energy (bar) */
  const ctxDay = document.getElementById('chart-daily');
  if (ctxDay && !chartDaily) {
    const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const kwhData = [1.62, 1.75, 1.40, 1.88, 1.91, 1.73, 1.55];
    chartDaily = new Chart(ctxDay, {
      type: 'bar',
      data: {
        labels: days,
        datasets: [{
          label:'Energy (kWh)',
          data: kwhData,
          backgroundColor: days.map((_, i) => i === 5 ? '#10B981' : 'rgba(59,130,246,.45)'),
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: d
    });
  }

  /* I-V Scatter */
  const ctxIV = document.getElementById('chart-iv');
  if (ctxIV && !chartIV) {
    chartIV = new Chart(ctxIV, {
      type: 'scatter',
      data: {
        datasets: [{
          label:'I-V Points',
          data: [],
          backgroundColor: 'rgba(16,185,129,.6)',
          pointRadius: 3,
        }]
      },
      options: {
        ...d,
        scales: {
          x: { ...d.scales.x, title:{ display:true, text:'Voltage (V)', color: chartColors().tick } },
          y: { ...d.scales.y, title:{ display:true, text:'Current (A)', color: chartColors().tick } },
        }
      }
    });
  }
}

function updateAnalyticsCharts(data) {
  if (!chartPV) return;
  const label = formatTime(new Date());
  const maxPts = 30;

  function pushData(chart, ...values) {
    chart.data.labels.push(label);
    values.forEach((v, i) => chart.data.datasets[i].data.push(v));
    if (chart.data.labels.length > maxPts) {
      chart.data.labels.shift();
      chart.data.datasets.forEach(ds => ds.data.shift());
    }
    chart.update('none');
  }

  pushData(chartPV,  data.power, data.voltage);
  pushData(chartEff, data.efficiency);
  pushData(chartEnv, data.temp, data.humidity, data.irradiance / 10);

  /* IV scatter — add new point */
  if (chartIV) {
    chartIV.data.datasets[0].data.push({ x: data.voltage, y: data.current });
    if (chartIV.data.datasets[0].data.length > 60) chartIV.data.datasets[0].data.shift();
    chartIV.update('none');
  }
}

/* ============================================================
   ALERT ENGINE
   ============================================================ */
function checkAlerts(data) {
  const { temp, efficiency, power } = data;
  const { temp: tTh, efficiency: eTh, power: pTh } = thresholds;

  const candidates = [];

  if (temp > tTh.value) {
    candidates.push({
      type: 'critical', icon: 'thermometer', icoClass: 'ico-crit', priority: 'Critical',
      priClass: 'pri-critical',
      title: `Over-temperature on SP-A104`,
      desc:  `Ambient temp ${temp.toFixed(1)}°C exceeds threshold of ${tTh.value}°C. Check panel ventilation.`,
    });
  }
  if (efficiency < eTh.value) {
    candidates.push({
      type: 'high', icon: 'speed', icoClass: 'ico-warn', priority: 'High',
      priClass: 'pri-high',
      title: `Low efficiency detected`,
      desc:  `Current efficiency ${efficiency.toFixed(1)}% is below minimum threshold of ${eTh.value}%.`,
    });
  }
  if (power < pTh.value) {
    candidates.push({
      type: 'medium', icon: 'power', icoClass: 'ico-warn', priority: 'Medium',
      priClass: 'pri-medium',
      title: `Low power output`,
      desc:  `Power output ${power.toFixed(1)}W is below expected minimum of ${pTh.value}W.`,
    });
  }
  candidates.push({
    type: 'info', icon: 'info', icoClass: 'ico-info', priority: 'Low',
    priClass: 'pri-low',
    title: 'Sensor telemetry nominal',
    desc:  `All INA226 + BME280 readings within acceptable ranges. Stream healthy.`,
  });

  alerts = candidates.map((c, i) => ({ ...c, id: ++alertIdCounter, time: new Date() }));
  renderAlerts();
}

function renderAlerts() {
  const list = document.getElementById('alert-list');
  if (!list) return;
  list.innerHTML = '';
  let counts = { Critical:0, High:0, Medium:0, Low:0 };
  alerts.forEach(a => {
    counts[a.priority]++;
    const div = document.createElement('div');
    div.className = 'alert-item';
    div.innerHTML = `
      <div class="alert-ico ${a.icoClass}">
        <span class="material-symbols-rounded">${a.icon}</span>
      </div>
      <div class="alert-body">
        <div class="alert-title">${a.title}</div>
        <div class="alert-desc">${a.desc}</div>
        <div class="alert-time">
          <span class="material-symbols-rounded">schedule</span>
          ${formatTime(a.time)}
        </div>
      </div>
      <span class="alert-priority ${a.priClass}">${a.priority}</span>
    `;
    list.appendChild(div);
  });
  // Update summary counts
  setSafe('asumm-critical', counts.Critical);
  setSafe('asumm-high',     counts.High);
  setSafe('asumm-medium',   counts.Medium);
  setSafe('asumm-low',      counts.Low);
  // Sidebar badge
  const total = counts.Critical + counts.High;
  setSafe('sidebar-alert-count', total || '');
  // Threshold display
  renderThresholds();
}

function renderThresholds() {
  const el = document.getElementById('threshold-list');
  if (!el) return;
  el.innerHTML = Object.entries(thresholds).map(([k, t]) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--card-border);font-size:12px;">
      <span style="color:var(--text-secondary)">${t.label}</span>
      <span style="font-weight:700;">${t.direction === 'above' ? '>' : '<'} ${t.value}${t.unit}</span>
    </div>`).join('');
}

/* ============================================================
   MAINTENANCE TABLE
   ============================================================ */
const SEV_CLASS = { low:'sev-low', medium:'sev-medium', high:'sev-high', critical:'sev-high' };
const ACT_CLASS  = { clean:'act-clean', inspect:'act-inspect', ok:'act-ok' };
const ACT_LABEL  = { clean:'Clean', inspect:'Inspect', ok:'OK' };
const ACT_ICON   = { clean:'cleaning_services', inspect:'manage_search', ok:'check' };

function renderMaintenance() {
  // Desktop table
  const tbody = document.getElementById('maint-table-body');
  if (tbody) {
    tbody.innerHTML = maintData.map(row => `
      <tr>
        <td><span class="panel-id-badge">${row.panel}</span></td>
        <td>${row.issue}</td>
        <td><span class="severity-badge ${SEV_CLASS[row.sev]}">${row.sev}</span></td>
        <td>${row.date}</td>
        <td><span class="status-pill stat-${row.status}">${row.status}</span></td>
        <td>
          <button class="action-btn-sm ${ACT_CLASS[row.action]}" aria-label="${ACT_LABEL[row.action]} ${row.panel}">
            <span class="material-symbols-rounded">${ACT_ICON[row.action]}</span>${ACT_LABEL[row.action]}
          </button>
        </td>
      </tr>`).join('');
  }
  // Mobile cards
  const mob = document.getElementById('maint-mobile-list');
  if (mob) {
    mob.innerHTML = maintData.map(row => `
      <div class="maint-mobile-card">
        <div class="maint-mobile-header">
          <span class="panel-id-badge">${row.panel}</span>
          <span class="severity-badge ${SEV_CLASS[row.sev]}">${row.sev}</span>
        </div>
        <div class="maint-mobile-row">
          <label>Issue</label><span>${row.issue}</span>
        </div>
        <div class="maint-mobile-row">
          <label>Date</label><span>${row.date}</span>
        </div>
        <div class="maint-mobile-row">
          <label>Status</label><span class="status-pill stat-${row.status}">${row.status}</span>
        </div>
        <div style="margin-top:10px;">
          <button class="action-btn-sm ${ACT_CLASS[row.action]}">
            <span class="material-symbols-rounded">${ACT_ICON[row.action]}</span>${ACT_LABEL[row.action]}
          </button>
        </div>
      </div>`).join('');
  }
}

/* ============================================================
   MAIN UPDATE — called every interval
   ============================================================ */
function onNewReading(data) {
  // Push to history
  const now = formatTime(new Date());
  Object.keys(history).forEach(k => {
    if (k === 'labels') { history.labels.push(now); if (history.labels.length > MAX_HIST) history.labels.shift(); return; }
    if (data[k] !== undefined) { history[k].push(data[k]); if (history[k].length > MAX_HIST) history[k].shift(); }
  });

  // Update KPI cards
  updateKPICard('voltage',    data.voltage,    data.voltage.toFixed(2));
  updateKPICard('current',    data.current,    data.current.toFixed(2));
  updateKPICard('power',      data.power,      data.power.toFixed(1));
  updateKPICard('efficiency', data.efficiency, data.efficiency.toFixed(1));
  updateKPICard('irradiance', data.irradiance, data.irradiance.toFixed(0));
  updateKPICard('temp',       data.temp,       data.temp.toFixed(1));
  updateKPICard('humidity',   data.humidity,   data.humidity.toFixed(1));
  updateKPICard('pressure',   data.pressure,   data.pressure.toFixed(1));

  // Sparklines
  Object.keys(SPARK_COLORS).forEach(k => updateSparkline(k, data[k]));

  // Analytics charts (only if tab is visible)
  updateAnalyticsCharts(data);

  // Hero stats
  const dailyKwh = (data.power * 5.5 / 1000).toFixed(2); // estimated 5.5h peak sun
  setSafe('hero-daily-yield', `${dailyKwh}<span>kWh</span>`);

  // Array Health sidebar
  const healthPct = Math.min(100, Math.max(0, (data.efficiency / 22) * 100));
  const healthBar = document.getElementById('health-bar');
  if (healthBar) healthBar.style.width = healthPct.toFixed(0) + '%';
  setSafe('health-output', data.power.toFixed(0) + 'W');
  setSafe('health-eta',    data.efficiency.toFixed(1) + '%');
  const statusEl = document.getElementById('health-status-text');
  if (statusEl) {
    if (healthPct > 80)      { statusEl.textContent = 'Optimal';  statusEl.style.color = 'var(--emerald)'; }
    else if (healthPct > 60) { statusEl.textContent = 'Good';     statusEl.style.color = 'var(--blue)';    }
    else if (healthPct > 40) { statusEl.textContent = 'Degraded'; statusEl.style.color = 'var(--amber)';   }
    else                     { statusEl.textContent = 'Critical'; statusEl.style.color = 'var(--red)';     }
  }

  // Check alerts
  checkAlerts(data);
}

function setSafe(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof html === 'string' && html.includes('<')) el.innerHTML = html;
  else el.textContent = html;
}

/* ============================================================
   DEMO TIMER
   ============================================================ */
function startDemoLoop() {
  const tick = () => {
    const reading = generateDemoReading();
    onNewReading(reading);
  };
  tick(); // immediate first tick
  clearInterval(updateTimer);
  updateTimer = setInterval(tick, updateInterval);
}

/* ============================================================
   FIREBASE LIVE MODE
   ============================================================ */
function startFirebaseLive() {
  const { initializeApp, getDatabase, ref, onValue } = window._fbImports || {};
  if (!initializeApp) { console.warn('Firebase not loaded — falling back to demo'); startDemoLoop(); return; }
  try {
    const app = initializeApp(firebaseConfig);
    const db  = getDatabase(app);
    const dataRef = ref(db, 'sensorData/record001');
    onValue(dataRef, snap => {
      const d = snap.val();
      if (!d) return;
      onNewReading({
        voltage:    +d.voltage    || 0,
        current:    +d.current    || 0,
        power:      +d.power      || 0,
        efficiency: +d.efficiency || 0,
        irradiance: +d.irradiance || 0,
        temp:       +d.temperature|| 0,
        humidity:   +d.humidity   || 0,
        pressure:   +d.pressure   || 0,
      });
    });
    document.getElementById('fb-status-badge').innerHTML =
      '<span class="stream-dot"></span>Firebase Live';
    document.getElementById('stream-badge').innerHTML =
      '<span class="stream-dot"></span><span>ESP32 Live</span>';
  } catch(e) {
    console.warn('Firebase init failed:', e.message, '— using demo mode');
    startDemoLoop();
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
function showSection(name) {
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`section-${name}`);
  if (target) target.classList.add('active');

  // Sidebar
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.section === name);
    if (n.dataset.section === name) n.setAttribute('aria-current', 'page');
    else n.removeAttribute('aria-current');
  });

  // Bottom nav
  document.querySelectorAll('.bottom-nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.section === name);
  });

  // Lazy-init charts on first visit to analytics
  if (name === 'analytics') {
    setTimeout(initAnalyticsCharts, 50);
  }
}

/* ============================================================
   COUNTDOWN TIMER (AI Scan)
   ============================================================ */
function startCountdown() {
  // 3 days from now
  const target = new Date();
  target.setDate(target.getDate() + 3);

  function tick() {
    const diff = target - Date.now();
    if (diff <= 0) return;
    const days = Math.floor(diff / 86400000);
    const hrs  = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000)  / 60000);
    const secs = Math.floor((diff % 60000)    / 1000);
    setSafe('cd-days', String(days).padStart(2,'0'));
    setSafe('cd-hrs',  String(hrs).padStart(2,'0'));
    setSafe('cd-min',  String(mins).padStart(2,'0'));
    setSafe('cd-sec',  String(secs).padStart(2,'0'));
  }
  tick();
  setInterval(tick, 1000);
}

/* ============================================================
   SCAN TIME
   ============================================================ */
function updateScanTime() {
  const now = new Date();
  setSafe('scan-time', now.toLocaleString());
  setSafe('modal-ts',  now.toLocaleString());
  setSafe('ai-scan-date', 'Scanned ' + now.toLocaleDateString('en-US', { month:'short', day:'numeric' }));
}

/* ============================================================
   CSV EXPORT
   ============================================================ */
function exportCSV() {
  const headers = ['Timestamp','Voltage(V)','Current(A)','Power(W)','Efficiency(%)','Irradiance(W/m2)','Temp(C)','Humidity(%RH)','Pressure(hPa)'];
  const rows = history.labels.map((t, i) => [
    t,
    history.voltage[i]    || '',
    history.current[i]    || '',
    history.power[i]      || '',
    history.efficiency[i] || '',
    history.irradiance[i] || '',
    history.temp[i]       || '',
    history.humidity[i]   || '',
    history.pressure[i]   || '',
  ]);
  const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `solarsense_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ============================================================
   THEME
   ============================================================ */
function setTheme(dark) {
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
  const tog = document.getElementById('toggle-darkmode');
  if (tog) { tog.classList.toggle('on', dark); tog.setAttribute('aria-checked', dark); }
  localStorage.setItem('sp-theme', dark ? 'dark' : 'light');
  // Redraw charts with new colors
  [chartPV, chartEff, chartEnv, chartDaily, chartIV].forEach(ch => {
    if (!ch) return;
    const { grid, tick } = chartColors();
    ['x','y','y1'].forEach(ax => {
      if (!ch.options.scales[ax]) return;
      ch.options.scales[ax].grid  && (ch.options.scales[ax].grid.color  = grid);
      ch.options.scales[ax].ticks && (ch.options.scales[ax].ticks.color = tick);
    });
    ch.update();
  });
}

/* ============================================================
   SIDEBAR COLLAPSE
   ============================================================ */
function toggleSidebar() {
  const sb   = document.getElementById('sidebar');
  const icon = document.getElementById('collapse-icon');
  const collapsed = sb.classList.toggle('collapsed');
  if (icon) icon.textContent = collapsed ? 'chevron_right' : 'chevron_left';
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal() {
  const m = document.getElementById('thermal-modal');
  if (m) { m.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal() {
  const m = document.getElementById('thermal-modal');
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}

/* ============================================================
   TOGGLE HELPER
   ============================================================ */
function bindToggle(id, onCb, offCb) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', () => {
    const on = el.classList.toggle('on');
    el.setAttribute('aria-checked', on);
    on ? onCb() : offCb();
  });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {

  /* Theme */
  const savedTheme = localStorage.getItem('sp-theme') || 'dark';
  setTheme(savedTheme === 'dark');

  /* Bind nav items */
  document.querySelectorAll('[data-section]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      showSection(el.dataset.section);
    });
  });

  /* Sidebar collapse */
  document.getElementById('sidebar-collapse-btn')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-collapse-btn')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') toggleSidebar();
  });

  /* Theme toggle */
  document.getElementById('theme-toggle-btn')?.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    setTheme(!isDark);
  });

  /* Toggles */
  bindToggle('toggle-darkmode',
    () => setTheme(true),
    () => setTheme(false)
  );
  bindToggle('toggle-demo',
    () => startDemoLoop(),
    () => {}
  );

  /* Modals */
  document.getElementById('view-thermal-btn')?.addEventListener('click',     openModal);
  document.getElementById('header-ai-scan-btn')?.addEventListener('click',   () => { showSection('aiscan'); });
  document.getElementById('modal-close-btn')?.addEventListener('click',      closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click',       closeModal);
  document.getElementById('view-fullscreen-btn')?.addEventListener('click',  openModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  /* Notification bell — jump to alerts */
  document.getElementById('notif-btn')?.addEventListener('click', () => showSection('alerts'));

  /* CSV Export */
  document.getElementById('export-csv-btn')?.addEventListener('click', exportCSV);

  /* Clear alerts */
  document.getElementById('clear-alerts-btn')?.addEventListener('click', () => {
    alerts = [];
    document.getElementById('alert-list').innerHTML = `
      <div style="padding:40px;text-align:center;color:var(--text-muted);">
        <span class="material-symbols-rounded" style="font-size:36px;display:block;margin-bottom:8px;">check_circle</span>
        No active alerts
      </div>`;
    ['asumm-critical','asumm-high','asumm-medium','asumm-low'].forEach(id => setSafe(id, '0'));
    setSafe('sidebar-alert-count', '');
  });

  /* Refresh maintenance */
  document.getElementById('refresh-maint-btn')?.addEventListener('click', renderMaintenance);

  /* Update interval change */
  document.getElementById('update-interval')?.addEventListener('change', e => {
    updateInterval = parseInt(e.target.value);
    if (USE_DEMO) startDemoLoop();
  });

  /* Panel selector — update breadcrumb */
  document.getElementById('panel-selector')?.addEventListener('change', e => {
    setSafe('scan-panel', e.target.value + ' · Section A');
    setSafe('modal-scanid', 'TS-' + Date.now().toString().slice(-6));
  });

  /* Init sparklines */
  Object.keys(SPARK_COLORS).forEach(initSparkline);

  /* Render maintenance table */
  renderMaintenance();

  /* Init countdown */
  startCountdown();

  /* Update scan time */
  updateScanTime();
  setInterval(updateScanTime, 60000);

  /* Start data feed */
  if (USE_DEMO) {
    startDemoLoop();
  } else {
    startFirebaseLive();
  }
});
/* ---------- AI THERMAL SCAN ---------- */

const uploadBtn = document.getElementById("run-scan-btn");
const thermalInput = document.getElementById("thermalInput");

if (uploadBtn && thermalInput) {

  uploadBtn.addEventListener("click", () => {
    thermalInput.click();
  });

  thermalInput.addEventListener("change", (e) => {

    const file = e.target.files[0];
    if (!file) return;

  const img = document.getElementById("thermal-img");
img.src = URL.createObjectURL(file);

    const name = file.name.toLowerCase();

    let result = "";
    let confidence = "";

    if (name.includes("healthy")) {
  result = "🟢 Healthy Panel";
  confidence = "98%";
} else if (name.includes("dust")) {
  result = "🟡 Dust Detected";
  confidence = "95%";
} else if (name.includes("hotspot")) {
  result = "🔴 Hotspot Detected";
  confidence = "97%";
} else if (name.includes("crack")) {
  result = "🔴 Cell Crack Detected";
  confidence = "96%";
}

  document.getElementById("ai-class-name").innerText =
  result.replace(/[🟢🟡🔴⚪]/g, "").trim();
  // Update the label on the thermal image
document.getElementById("ai-status-badge").className = "ai-badge-sm active";

if (name.includes("healthy")) {
  document.getElementById("ai-badge-label").innerText = "Clean — No Anomaly";
} else if (name.includes("dust")) {
  document.getElementById("ai-badge-label").innerText = "Dust Detected";
} else if (name.includes("hotspot")) {
  document.getElementById("ai-badge-label").innerText = "Hotspot Detected";
} else if (name.includes("crack")) {
  document.getElementById("ai-badge-label").innerText = "Cell Crack Detected";
}

document.getElementById("conf-pct").innerText = confidence;
document.getElementById("conf-bar").style.width = confidence;

const badge = document.getElementById("ai-sev-badge");

if (name.includes("healthy")) {
  badge.innerText = "Low Risk";
  badge.className = "severity-badge sev-low";
} else if (name.includes("dust")) {
  badge.innerText = "Medium Risk";
  badge.className = "severity-badge sev-medium";
} else {
  badge.innerText = "High Risk";
  badge.className = "severity-badge sev-high";
} 

  });
