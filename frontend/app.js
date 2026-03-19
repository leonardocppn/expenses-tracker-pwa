// ⚠️ Set this to your own Cloudflare Worker URL before deploying
const API = "YOUR_WORKER_URL";

const CATEGORIES = ["food", "health", "transport", "subscriptions", "shopping", "entertainment", "gifts", "other"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const MOOD_COLORS  = ["", "#ef4444", "#fcc72b", "#a8cf2c", "#1fa647"];
const MOOD_MOUTHS  = ["", "M9 21Q16 16 23 21", "M9 20L23 20", "M9 20Q16 23 23 20", "M9 19Q16 25 23 19"];
const MOOD_LABELS  = ["", "Bad", "Low", "Good", "Great"];

const MACRO_ORDER  = ["essential", "leisure", "other"];
const MACRO_COLORS = { essential: "var(--accent2)", leisure: "var(--green)", other: "var(--muted)" };

let calYear, calMonth;
let macroChart = null;
let catChart = null;
let calMoodMap = {};
let calView = "monthly";
let yearlyYear = new Date().getFullYear();
let statsMonth = today().slice(0, 7);
let statsCatIdx = 0;

function moodIcon(val, size = 28) {
  return `<svg viewBox="0 0 32 32" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="15" fill="${MOOD_COLORS[val]}"/>
    <circle cx="11" cy="13" r="2" fill="rgba(0,0,0,.35)"/>
    <circle cx="21" cy="13" r="2" fill="rgba(0,0,0,.35)"/>
    <path d="${MOOD_MOUTHS[val]}" stroke="rgba(0,0,0,.35)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </svg>`;
}

// --- UTILS ---

function fmt(n) {
  return Number(n).toFixed(2) + " €";
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function showToast(msg, isErr = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isErr ? " err" : "");
  setTimeout(() => (t.className = ""), 2200);
}

async function api(path, method = "GET", body = null) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- NAV ---

const PAGES = ["add", "sleep", "mood", "stats"];

function navigateTo(pageId, slideDir) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active", "slide-right", "slide-left"));
  document.querySelector(`nav button[data-page="${pageId}"]`).classList.add("active");
  const page = document.getElementById(pageId);
  page.classList.add("active");
  if (slideDir) {
    page.classList.add(slideDir);
    page.addEventListener("animationend", () => page.classList.remove(slideDir), { once: true });
  }
  if (pageId === "sleep") loadSleep();
  if (pageId === "stats") loadStats();
  if (pageId === "mood") loadCalendar();
}

(function initSwipe() {
  let touchStartX = 0, touchStartY = 0;
  document.querySelector("main").addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.querySelector("main").addEventListener("touchend", (e) => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    const activeBtn = document.querySelector("nav button.active");
    const currentIdx = PAGES.indexOf(activeBtn.dataset.page);
    const nextIdx = dx < 0 ? currentIdx + 1 : currentIdx - 1;
    if (nextIdx < 0 || nextIdx >= PAGES.length) return;
    navigateTo(PAGES[nextIdx], dx < 0 ? "slide-right" : "slide-left");
  }, { passive: true });
})();

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    const currentBtn = document.querySelector("nav button.active");
    const currentIdx = PAGES.indexOf(currentBtn?.dataset.page);
    const nextIdx = PAGES.indexOf(btn.dataset.page);
    if (currentIdx === nextIdx) return;
    navigateTo(btn.dataset.page, nextIdx > currentIdx ? "slide-right" : "slide-left");
  });
});

// --- PAGE: ADD EXPENSE ---

// Populate mood buttons (quick + popup) with SVG icons
document.querySelectorAll("[data-val].mood-btn").forEach((btn) => {
  btn.innerHTML = moodIcon(parseInt(btn.dataset.val), 28);
});

(function initForm() {
  // Populate category dropdown
  const sel = document.getElementById("f-category");
  CATEGORIES.forEach((c) => {
    const o = document.createElement("option");
    o.value = o.textContent = c;
    sel.appendChild(o);
  });

  // Default date = today
  document.getElementById("f-date").value = today();

  // Macro toggle
  document.querySelectorAll(".macro-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".macro-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Date icon toggle
  const dateInput = document.getElementById("f-date");
  const dateBtn = document.getElementById("date-toggle-btn");

  dateBtn.addEventListener("click", () => {
    dateInput.classList.toggle("date-visible");
    dateBtn.classList.toggle("open", dateInput.classList.contains("date-visible"));
    if (dateInput.classList.contains("date-visible")) dateInput.focus();
  });

  // Quick mood
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const already = btn.classList.contains("selected");
      document.querySelectorAll(".quick-btn").forEach((b) => b.classList.remove("selected"));
      if (!already) {
        btn.classList.add("selected");
        try {
          await api("/mood", "POST", { value: parseInt(btn.dataset.val), note: null, date: today() });
          showToast("Mood saved ✓");
        } catch {
          showToast("Error saving mood", true);
        }
      }
    });
  });

  // Submit
  document.getElementById("form-expense").addEventListener("submit", async (e) => {
    e.preventDefault();
    const dateVal = dateInput.value;
    const macroActive = document.querySelector(".macro-btn.active");
    const body = {
      category: document.getElementById("f-category").value,
      macro: macroActive ? macroActive.dataset.val : "essential",
      amount: parseFloat(document.getElementById("f-amount").value.replace(",", ".")),
      note: document.getElementById("f-note").value || null,
      date: dateVal,
    };
    try {
      await api("/expenses", "POST", body);
      showToast("Expense saved ✓");
      e.target.reset();
      dateInput.value = today();
      dateInput.classList.remove("date-visible");
      dateBtn.classList.remove("open");
      document.querySelectorAll(".macro-btn").forEach((b) => b.classList.remove("active"));
      document.querySelector(".macro-btn[data-val='essential']").classList.add("active");
      document.querySelectorAll(".quick-btn").forEach((b) => b.classList.remove("selected"));
    } catch {
      showToast("Error saving expense", true);
    }
  });
})();

// --- PRESET EXPENSES POPUP ---

document.getElementById("preset-btn").addEventListener("click", () => {
  document.getElementById("preset-popup").classList.add("show");
});

document.getElementById("preset-popup").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("show");
});

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.getElementById("f-amount").value = btn.dataset.amount;
    document.getElementById("f-category").value = btn.dataset.cat;
    document.querySelectorAll(".macro-btn").forEach((b) => b.classList.remove("active"));
    document.querySelector(`.macro-btn[data-val='${btn.dataset.macro}']`).classList.add("active");
    document.getElementById("preset-popup").classList.remove("show");
  });
});

// --- PAGE: EXPENSE LIST ---

let filterState = { period: "today", macro: "all" };
let allExpenses = [];

document.getElementById("filter-toggle").addEventListener("click", () => {
  const panel = document.getElementById("filter-panel");
  const btn = document.getElementById("filter-toggle");
  panel.classList.toggle("hidden");
  btn.classList.toggle("open", !panel.classList.contains("hidden"));
});

document.querySelectorAll("[data-period]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-period]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    filterState.period = chip.dataset.period;
    renderList();
  });
});

document.querySelectorAll("[data-macro]").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("[data-macro]").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    filterState.macro = chip.dataset.macro;
    renderList();
  });
});

function filterExpenses(expenses) {
  const t = today();
  return expenses.filter((s) => {
    if (filterState.macro !== "all" && s.macro !== filterState.macro) return false;
    if (filterState.period === "today") return s.date === t;
    if (filterState.period === "week") {
      const limit = new Date(t);
      limit.setDate(limit.getDate() - 6);
      return s.date >= limit.toISOString().slice(0, 10);
    }
    if (filterState.period === "month") return s.date.slice(0, 7) === t.slice(0, 7);
    return true;
  });
}

function renderList() {
  const container = document.getElementById("expense-list");
  const expenses = filterExpenses(allExpenses);
  if (!expenses.length) {
    container.innerHTML = "<p class='empty'>No expenses</p>";
    return;
  }
  const total = expenses.reduce((s, x) => s + x.amount, 0);
  container.innerHTML = `
    <div class="stat-row" style="margin-bottom:12px">
      <span style="color:var(--muted)">${expenses.length} expense${expenses.length !== 1 ? "s" : ""}</span>
      <span class="stat-val">${fmt(total)}</span>
    </div>
    ${expenses.map((s) => `
      <div class="expense-item">
        <div class="expense-left">
          <div class="expense-cat">
            <span class="macro-badge macro-${s.macro}">${s.macro}</span>${s.category}
          </div>
          <div class="expense-meta">${s.note || ""}</div>
        </div>
        <div class="expense-right">
          <div class="expense-amount">${fmt(s.amount)}</div>
          <div class="expense-date">${s.date}</div>
        </div>
        <button class="btn-sm" data-id="${s.id}" title="Delete">✕</button>
      </div>
    `).join("")}
  `;
  container.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this expense?")) return;
      await api(`/expenses/${btn.dataset.id}`, "DELETE");
      showToast("Deleted");
      loadList();
    });
  });
}

async function loadList() {
  const container = document.getElementById("expense-list");
  container.innerHTML = "<p class='empty'>Loading...</p>";
  try {
    allExpenses = await api("/expenses");
    renderList();
  } catch {
    container.innerHTML = "<p class='empty'>Error loading data</p>";
  }
}

// --- PAGE: MOOD CALENDAR ---

async function loadCalendar() {
  const now = new Date();
  if (calYear === undefined) {
    calYear = now.getFullYear();
    calMonth = now.getMonth();
  }
  const toggleBtn = document.getElementById("cal-view-toggle");
  if (toggleBtn) toggleBtn.textContent = calView === "monthly" ? "Yearly" : "Monthly";
  try {
    const data = await api("/mood");
    calMoodMap = {};
    data.forEach((u) => { calMoodMap[u.date] = u.value; });
    if (calView === "yearly") renderYearly(); else renderCalendar();
  } catch {
    document.getElementById("cal-wrap").innerHTML = "<p class='empty'>Error</p>";
  }
}

document.getElementById("cal-view-toggle")?.addEventListener("click", () => {
  calView = calView === "monthly" ? "yearly" : "monthly";
  document.getElementById("cal-view-toggle").textContent = calView === "monthly" ? "Yearly" : "Monthly";
  if (calView === "yearly") renderYearly(); else renderCalendar();
});

function renderCalendar() {
  const wrap = document.getElementById("cal-wrap");
  const todayStr = today();
  const firstDay = new Date(calYear, calMonth, 1);
  const totalDays = new Date(calYear, calMonth + 1, 0).getDate();

  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="cal-prev">‹</button>
      <span class="cal-title">${MONTHS[calMonth]} ${calYear}</span>
      <button class="cal-nav" id="cal-next">›</button>
    </div>
    <div class="cal-grid">
      <div class="cal-dow">Mo</div><div class="cal-dow">Tu</div><div class="cal-dow">We</div>
      <div class="cal-dow">Th</div><div class="cal-dow">Fr</div><div class="cal-dow">Sa</div>
      <div class="cal-dow">Su</div>
  `;

  for (let i = 0; i < startDow; i++) {
    html += `<div class="cal-day empty"></div>`;
  }

  for (let d = 1; d <= totalDays; d++) {
    const mm = String(calMonth + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    const dateStr = `${calYear}-${mm}-${dd}`;
    const isFuture = dateStr > todayStr;
    const isToday = dateStr === todayStr;
    const mood = calMoodMap[dateStr];

    let cls = "cal-day";
    if (isFuture) cls += " future";
    else if (isToday) cls += " today";
    if (mood) cls += " has-mood";
    if (!isFuture) cls += " clickable";

    const icon = mood
      ? `<span class="cal-emoji">${moodIcon(mood, 22)}</span>`
      : `<span class="cal-plus">+</span>`;

    const attr = !isFuture ? `data-date="${dateStr}"` : "";
    html += `<div class="${cls}" ${attr}><span class="cal-num">${d}</span>${icon}</div>`;
  }

  html += `</div>`;
  wrap.innerHTML = html;

  document.getElementById("cal-prev").addEventListener("click", () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  });

  document.getElementById("cal-next").addEventListener("click", () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  });

  wrap.querySelectorAll(".cal-day.clickable").forEach((el) => {
    el.addEventListener("click", () => openMoodPopup(el.dataset.date));
  });
}

function renderYearly() {
  const wrap = document.getElementById("cal-wrap");
  const todayStr = today();
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  let html = `
    <div class="cal-header">
      <button class="cal-nav" id="ann-prev">‹</button>
      <span class="cal-title">${yearlyYear}</span>
      <button class="cal-nav" id="ann-next">›</button>
    </div>
    <div class="ann-grid">
  `;

  MONTHS_SHORT.forEach((m) => {
    html += `<div class="ann-month-label">${m}</div>`;
  });

  for (let d = 1; d <= 31; d++) {
    for (let m = 0; m < 12; m++) {
      const daysInMonth = new Date(yearlyYear, m + 1, 0).getDate();
      if (d > daysInMonth) {
        html += `<div class="ann-cell ann-void"></div>`;
        continue;
      }
      const mm = String(m + 1).padStart(2, "0");
      const dd = String(d).padStart(2, "0");
      const dateStr = `${yearlyYear}-${mm}-${dd}`;
      const isFuture = dateStr > todayStr;
      const mood = calMoodMap[dateStr];
      const style = mood ? `background:${MOOD_COLORS[mood]}` : "";
      const cls = "ann-cell" + (isFuture ? " ann-future" : "") + (mood ? "" : " ann-empty");
      html += `<div class="${cls}" style="${style}" title="${dateStr}"></div>`;
    }
  }

  html += `</div>`;
  wrap.innerHTML = html;

  document.getElementById("ann-prev").addEventListener("click", () => {
    yearlyYear--;
    renderYearly();
  });
  document.getElementById("ann-next").addEventListener("click", () => {
    yearlyYear++;
    renderYearly();
  });
}

function openMoodPopup(dateStr) {
  const popup = document.getElementById("mood-popup");
  const [y, m, d] = dateStr.split("-");
  document.getElementById("popup-date").textContent = `${d}/${m}/${y}`;
  popup.dataset.date = dateStr;
  document.getElementById("popup-remove").style.display = calMoodMap[dateStr] ? "block" : "none";
  popup.classList.add("show");
}

document.getElementById("popup-close").addEventListener("click", () => {
  document.getElementById("mood-popup").classList.remove("show");
});

document.getElementById("popup-remove").addEventListener("click", async () => {
  const popup = document.getElementById("mood-popup");
  const dateStr = popup.dataset.date;
  try {
    await api(`/mood/${dateStr}`, "DELETE");
    delete calMoodMap[dateStr];
    renderCalendar();
    popup.classList.remove("show");
    showToast("Mood removed");
  } catch {
    showToast("Error", true);
  }
});

document.getElementById("mood-popup").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.classList.remove("show");
});

document.querySelectorAll(".popup-emoji-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const popup = document.getElementById("mood-popup");
    const dateStr = popup.dataset.date;
    const value = parseInt(btn.dataset.val);
    try {
      await api("/mood", "POST", { value, note: null, date: dateStr });
      calMoodMap[dateStr] = value;
      renderCalendar();
      popup.classList.remove("show");
      showToast("Mood saved ✓");
    } catch {
      showToast("Error", true);
    }
  });
});

// --- PAGE: STATS ---

function renderCatSlider(cats, catMap) {
  const wrap = document.getElementById("cat-slider-wrap");
  if (!wrap || !cats.length) return;
  statsCatIdx = Math.min(statsCatIdx, cats.length - 1);
  const cat = cats[statsCatIdx];
  const { total, macros } = catMap[cat];
  const barsHtml = MACRO_ORDER.filter((m) => macros[m]).map((m) => {
    const val = macros[m];
    const pct = ((val / total) * 100).toFixed(0);
    return `
      <div class="cat-macro-row">
        <div class="cat-macro-label">
          <span style="color:${MACRO_COLORS[m]}">${m}</span>
          <span style="color:${MACRO_COLORS[m]}">${pct}%</span>
          <span>${fmt(val)}</span>
        </div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${MACRO_COLORS[m]}"></div></div>
      </div>`;
  }).join("");
  const macroKeys = MACRO_ORDER.filter((m) => macros[m]);
  const MACRO_CHART_COLORS = { essential: "#8ab5ff", leisure: "#22c55e", other: "#888888" };
  const tabsHtml = cats.map((c, i) => `
    <button class="cat-tab${i === statsCatIdx ? " active" : ""}" data-idx="${i}">${c}</button>
  `).join("");
  wrap.innerHTML = `
    <div class="stat-card">
      <div class="cat-tabs">${tabsHtml}</div>
      <div class="cat-card-body">
        <div class="chart-wrap-sm"><canvas id="cat-chart"></canvas></div>
        <div class="cat-bars">
          <div class="stat-total-row" style="padding-top:0;margin-bottom:10px">
            <span>Category total</span>
            <span class="stat-total-val" style="font-size:18px">${fmt(total)}</span>
          </div>
          ${barsHtml}
        </div>
      </div>
    </div>`;
  wrap.querySelectorAll(".cat-tab").forEach((btn) => {
    btn.addEventListener("click", () => { statsCatIdx = parseInt(btn.dataset.idx); renderCatSlider(cats, catMap); });
  });
  wrap.querySelector(".cat-tab.active")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

  const catCanvas = document.getElementById("cat-chart");
  if (catCanvas) {
    if (catChart) catChart.destroy();
    catChart = new Chart(catCanvas, {
      type: "doughnut",
      data: {
        labels: macroKeys,
        datasets: [{
          data: macroKeys.map((m) => macros[m]),
          backgroundColor: macroKeys.map((m) => MACRO_CHART_COLORS[m]),
          borderColor: "#111111",
          borderWidth: 2,
          hoverOffset: 4,
        }],
      },
      options: {
        responsive: true,
        cutout: "60%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${fmt(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(0)}%)`,
            },
          },
        },
      },
    });
  }
}

async function loadStats() {
  const container = document.getElementById("stats-content");
  container.innerHTML = "<p class='empty'>Loading...</p>";
  try {
    const s = await api(`/stats?month=${statsMonth}`);

    const [y, m] = statsMonth.split("-").map(Number);
    const monthLabel = MONTHS[m - 1] + " " + y;
    const isCurrentMonth = statsMonth >= today().slice(0, 7);

    // Month navigator
    const navHtml = `
      <div class="stat-month-nav">
        <button class="stat-month-btn" id="stat-prev">‹</button>
        <span class="stat-month-label">${monthLabel}</span>
        <button class="stat-month-btn" id="stat-next" ${isCurrentMonth ? "disabled" : ""}>›</button>
      </div>
    `;

    // Cost breakdown
    const grandTotal = s.total ?? 0;
    const macroTotals = {};
    const catMap = {};
    s.macro_categories.forEach((r) => {
      if (!macroTotals[r.macro]) macroTotals[r.macro] = { total: 0, categories: [] };
      macroTotals[r.macro].total += r.total;
      macroTotals[r.macro].categories.push(r);
      if (!catMap[r.category]) catMap[r.category] = { total: 0, macros: {} };
      catMap[r.category].total += r.total;
      catMap[r.category].macros[r.macro] = r.total;
    });
    const cats = Object.keys(catMap).sort();
    statsCatIdx = Math.min(statsCatIdx, Math.max(0, cats.length - 1));
    const costsHtml = MACRO_ORDER
      .filter((mac) => macroTotals[mac])
      .map((mac) => {
        const { total, categories } = macroTotals[mac];
        const pct = grandTotal > 0 ? ((total / grandTotal) * 100).toFixed(0) : 0;
        const catRows = categories.map((c) => `
          <div class="stat-cat-row">
            <span>${c.category}</span>
            <span>${fmt(c.total)}</span>
          </div>
        `).join("");
        return `
          <div class="stat-macro-block">
            <div class="stat-macro-header" style="color:${MACRO_COLORS[mac]}">
              <span>${mac} <span class="stat-macro-pct">${pct}%</span></span>
              <span>${fmt(total)}</span>
            </div>
            ${catRows}
          </div>
        `;
      }).join("") || "<p class='empty'>No expenses this month</p>";

    // Mood × sleep median
    const moodSleepHtml = s.mood_vs_sleep.length ? s.mood_vs_sleep.map((u) => `
      <div class="stat-row">
        <span style="display:flex;align-items:center;gap:8px">${moodIcon(u.value, 20)} ${MOOD_LABELS[u.value]}</span>
        <span class="stat-val">${u.median_hours !== null ? u.median_hours + "h" : "—"}</span>
      </div>
    `).join("") : "<p class='empty'>Not enough data</p>";

    // Weekly trend
    const maxWeek = Math.max(...s.weekly_trend.map((w) => w.total), 1);
    const trendHtml = s.weekly_trend.length ? s.weekly_trend.map((w) => `
      <div class="bar-wrap">
        <div class="bar-label"><span>${w.week}</span><span>${fmt(w.total)}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${(w.total / maxWeek * 100).toFixed(1)}%"></div></div>
      </div>
    `).join("") : "<p class='empty'>Not enough data</p>";

    container.innerHTML = `
      ${navHtml}
      <div class="stat-card">
        <div class="stat-total-row">
          <span>Total ${monthLabel}</span>
          <span class="stat-total-val">${fmt(grandTotal)}</span>
        </div>
        ${grandTotal > 0 ? `<div class="chart-wrap"><canvas id="macro-chart"></canvas></div>` : ""}
        ${costsHtml}
      </div>
      <div id="cat-slider-wrap"></div>
      <div class="stat-card">
        <h3>Mood × median sleep</h3>
        ${moodSleepHtml}
      </div>
      <div class="stat-card">
        <h3>Weekly trend</h3>
        ${trendHtml}
      </div>
    `;
    renderCatSlider(cats, catMap);

    // Macro doughnut chart
    const canvas = document.getElementById("macro-chart");
    if (canvas && grandTotal > 0) {
      if (macroChart) macroChart.destroy();
      const macroData = MACRO_ORDER.filter((m) => macroTotals[m]);
      const MACRO_CHART_COLORS = { essential: "#8ab5ff", leisure: "#22c55e", other: "#888888" };
      macroChart = new Chart(canvas, {
        type: "doughnut",
        data: {
          labels: macroData.map((m) => m.charAt(0).toUpperCase() + m.slice(1)),
          datasets: [{
            data: macroData.map((m) => macroTotals[m].total),
            backgroundColor: macroData.map((m) => MACRO_CHART_COLORS[m]),
            borderColor: "#111111",
            borderWidth: 2,
            hoverOffset: 6,
          }],
        },
        options: {
          responsive: true,
          cutout: "60%",
          plugins: {
            legend: {
              position: "bottom",
              labels: { color: "#f1f5f9", font: { size: 13 }, padding: 16 },
            },
            tooltip: {
              callbacks: {
                label: (ctx) => ` ${fmt(ctx.raw)} (${((ctx.raw / grandTotal) * 100).toFixed(0)}%)`,
              },
            },
          },
        },
      });
    }

    document.getElementById("stat-prev")?.addEventListener("click", () => {
      const [yr, mo] = statsMonth.split("-").map(Number);
      const d = new Date(yr, mo - 2, 1);
      statsMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      statsCatIdx = 0;
      loadStats();
    });
    document.getElementById("stat-next")?.addEventListener("click", () => {
      const [yr, mo] = statsMonth.split("-").map(Number);
      const d = new Date(yr, mo, 1);
      statsMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      statsCatIdx = 0;
      loadStats();
    });
  } catch {
    container.innerHTML = "<p class='empty'>Error loading data</p>";
  }
}

// --- PAGE: SLEEP ---

function renderSleepChart(completed, moodMap) {
  const canvas = document.getElementById("sleep-chart");
  if (!canvas) return;

  const W = Math.max(canvas.parentElement.clientWidth || 0, 260);
  const H = 150;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  const c = canvas.getContext("2d");
  c.scale(dpr, dpr);

  // Last 7 days, oldest → newest
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  const sleepMap = {};
  for (const r of completed) if (r.date && r.hours != null) sleepMap[r.date] = +r.hours;
  const vals = days.map(d => sleepMap[d] ?? null);
  const moodFill = days.map(d => moodMap[d] ? MOOD_COLORS[moodMap[d]] : null);

  const pl = 30, pr = 8, pt = 14, pb = 30;
  const CW = W - pl - pr, CH = H - pt - pb;
  const maxV = 12;
  const xAt = i => pl + (i / 6) * CW;
  const yAt = v => pt + CH - (v / maxV) * CH;
  const baseY = pt + CH;

  function hexRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  c.clearRect(0, 0, W, H);

  // Gridlines
  [4, 6, 8, 10].forEach(h => {
    const y = yAt(h);
    c.strokeStyle = "rgba(255,255,255,0.07)";
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(pl, y); c.lineTo(W - pr, y); c.stroke();
    c.fillStyle = "rgba(255,255,255,0.3)";
    c.font = "10px system-ui";
    c.textAlign = "right";
    c.fillText(h + "h", pl - 4, y + 3);
  });

  // Day labels
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  days.forEach((d, i) => {
    c.fillStyle = i === 6 ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.35)";
    c.font = i === 6 ? "bold 9px system-ui" : "9px system-ui";
    c.textAlign = "center";
    c.fillText(DOW[new Date(d + "T12:00:00").getDay()], xAt(i), H - pb + 14);
  });

  // Point coordinates (null if no data)
  const pts = vals.map((v, i) => v !== null ? { x: xAt(i), y: yAt(v) } : null);

  // Filled areas (per segment, color = mood of right endpoint day)
  for (let i = 0; i < 6; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    if (!p1 || !p2) continue;
    const p0 = (i > 0 && pts[i - 1]) ? pts[i - 1] : p1;
    const p3 = (i < 5 && pts[i + 2]) ? pts[i + 2] : p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    const col = moodFill[i];
    const colPrev = i > 0 ? moodFill[i - 1] : null;
    const colNext = moodFill[i + 1];
    const noCol = "rgba(150,150,150,0.08)";

    function mixFill(c1, c2) {
      if (!c1 && !c2) return noCol;
      if (!c1) return hexRgba(c2, 0.14);
      if (!c2) return hexRgba(c1, 0.14);
      const n1 = parseInt(c1.slice(1), 16), n2 = parseInt(c2.slice(1), 16);
      const r = Math.round(((n1 >> 16)       + (n2 >> 16))       / 2);
      const g = Math.round((((n1 >> 8) & 255) + ((n2 >> 8) & 255)) / 2);
      const b = Math.round(((n1 & 255)        + (n2 & 255))        / 2);
      return `rgba(${r},${g},${b},0.28)`;
    }

    c.beginPath();
    c.moveTo(p1.x, baseY);
    c.lineTo(p1.x, p1.y);
    c.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    c.lineTo(p2.x, baseY);
    c.closePath();
    const grad = c.createLinearGradient(p1.x, 0, p2.x, 0);
    grad.addColorStop(0,     mixFill(colPrev, col));
    grad.addColorStop(0.175, col ? hexRgba(col, 0.28) : noCol);
    grad.addColorStop(0.825, col ? hexRgba(col, 0.28) : noCol);
    grad.addColorStop(1,     mixFill(col, colNext));
    c.fillStyle = grad;
    c.fill();
  }

  // Smooth line (breaks at null points)
  c.lineWidth = 2;
  c.strokeStyle = "rgba(255,255,255,0.75)";
  c.lineJoin = "round";
  c.lineCap = "round";
  let open = false;
  for (let i = 0; i < 6; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    if (!p1 || !p2) { if (open) { c.stroke(); open = false; } continue; }
    const p0 = (i > 0 && pts[i - 1]) ? pts[i - 1] : p1;
    const p3 = (i < 5 && pts[i + 2]) ? pts[i + 2] : p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    if (!open) { c.beginPath(); c.moveTo(p1.x, p1.y); open = true; }
    c.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
  if (open) c.stroke();

  // Dots at each data point
  pts.forEach((p, i) => {
    if (!p) return;
    const col = moodFill[i];
    c.beginPath();
    c.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
    c.fillStyle = col || "rgba(255,255,255,0.7)";
    c.fill();
    c.strokeStyle = "rgba(255,255,255,0.85)";
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = "rgba(255,255,255,0.75)";
    c.font = "bold 10px system-ui";
    c.textAlign = "center";
    c.fillText(vals[i] + "h", p.x, p.y - 8);
  });
}

function renderSleepList(listEl, completed, showAll = false) {
  const MAX = 7;
  const items = showAll ? completed : completed.slice(0, MAX);
  listEl.innerHTML = items.map(r => `
    <div class="sleep-item">
      <div class="sleep-item-left">
        <div class="sleep-item-date">${r.date}</div>
        <div class="sleep-item-times">${r.bedtime} → ${r.wake_time}</div>
      </div>
      <div class="sleep-hours">${r.hours}h</div>
      <button class="btn-sm" data-id="${r.id}" title="Delete">✕</button>
    </div>
  `).join("") + (completed.length > MAX ? `
    <button class="btn-sm sleep-more-btn" data-show="${!showAll}" style="width:100%;margin-top:8px;text-align:center">
      ${showAll ? "↑ Show less" : `↓ Show all (${completed.length})`}
    </button>
  ` : "");
  listEl.querySelectorAll("[data-id]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this record?")) return;
      await api(`/sleep/${btn.dataset.id}`, "DELETE");
      showToast("Deleted");
      loadSleep();
    });
  });
  listEl.querySelector(".sleep-more-btn")?.addEventListener("click", e => {
    renderSleepList(listEl, completed, e.target.dataset.show === "true");
  });
}

function nowTime() {
  const now = new Date();
  return String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
}

async function tapBedtime() {
  try {
    await api("/sleep/bedtime", "POST", { bedtime: nowTime() });
    showToast("Good night 🌙");
    loadSleep();
  } catch {
    showToast("Error", true);
  }
}

async function tapWakeup() {
  try {
    const res = await api("/sleep/wakeup", "POST", { wake_time: nowTime(), date: today() });
    showToast(`Slept ${res.hours}h ☀️`);
    loadSleep();
  } catch {
    showToast("Error", true);
  }
}

function manualFormHtml() {
  return `
    <div class="sleep-manual">
      <button type="button" class="sleep-manual-toggle" id="manual-toggle">+ Enter manually</button>
      <div class="sleep-manual-panel hidden" id="manual-panel">
        <div class="sleep-manual-row">
          <label>Bedtime</label>
          <input type="time" id="m-bedtime" />
          <label>Wake-up</label>
          <input type="time" id="m-wakeup" />
        </div>
        <input type="date" id="m-date" value="${today()}" style="margin-top:8px" />
        <button type="button" class="btn" id="m-save" style="margin-top:10px">Save</button>
      </div>
    </div>
  `;
}

function bindManualForm() {
  document.getElementById("manual-toggle").addEventListener("click", () => {
    document.getElementById("manual-panel").classList.toggle("hidden");
  });
  document.getElementById("m-save").addEventListener("click", async () => {
    const bedtime = document.getElementById("m-bedtime").value;
    const wake_time = document.getElementById("m-wakeup").value;
    const date = document.getElementById("m-date").value;
    if (!bedtime || !wake_time || !date) {
      showToast("Fill in all fields", true);
      return;
    }
    try {
      const res = await api("/sleep", "POST", { bedtime, wake_time, date });
      showToast(`Saved: ${res.hours}h`);
      loadSleep();
    } catch {
      showToast("Error", true);
    }
  });
}

async function loadSleep() {
  const stateEl = document.getElementById("sleep-state");
  const chartWrap = document.getElementById("sleep-chart-wrap");
  const listEl = document.getElementById("sleep-list");
  stateEl.innerHTML = "";
  if (chartWrap) chartWrap.innerHTML = "";
  listEl.innerHTML = "";

  try {
    const [records, moodList] = await Promise.all([api("/sleep"), api("/mood")]);
    const moodMap = {};
    for (const u of moodList) moodMap[u.date] = u.value;

    const pending = records.find((r) => !r.wake_time);

    if (pending) {
      stateEl.innerHTML = `
        <div class="sleep-action">
          <p class="sleep-hint">You went to bed at <strong>${pending.bedtime}</strong></p>
          <button class="sleep-btn sleep-wakeup" id="btn-wakeup">
            <span class="sleep-icon">☀️</span>
            I woke up
          </button>
        </div>
        ${manualFormHtml()}
      `;
      document.getElementById("btn-wakeup").addEventListener("click", tapWakeup);
    } else {
      stateEl.innerHTML = `
        <div class="sleep-action">
          <button class="sleep-btn sleep-bedtime" id="btn-bedtime">
            <span class="sleep-icon">🌙</span>
            Going to bed
          </button>
        </div>
        ${manualFormHtml()}
      `;
      document.getElementById("btn-bedtime").addEventListener("click", tapBedtime);
    }
    bindManualForm();

    const completed = records.filter((r) => r.wake_time);

    if (chartWrap) {
      chartWrap.innerHTML = "<canvas id='sleep-chart'></canvas>";
      renderSleepChart(completed, moodMap);
    }

    if (!completed.length) {
      listEl.innerHTML = "<p class='empty'>No data yet</p>";
      return;
    }
    renderSleepList(listEl, completed);
  } catch {
    stateEl.innerHTML = "<p class='empty'>Error loading data</p>";
  }
}

// Load expense list on startup
loadList();

// --- SERVICE WORKER ---

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js");
}
