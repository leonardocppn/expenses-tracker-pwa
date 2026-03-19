const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function error(msg, status = 400) {
  return json({ error: msg }, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // --- EXPENSES ---

    if (path === "/expenses" && method === "GET") {
      const month = url.searchParams.get("month"); // e.g. "2026-03"
      let stmt;
      if (month) {
        stmt = env.DB.prepare(
          "SELECT * FROM expenses WHERE date LIKE ? ORDER BY date DESC"
        ).bind(`${month}%`);
      } else {
        stmt = env.DB.prepare("SELECT * FROM expenses ORDER BY date DESC");
      }
      const { results } = await stmt.all();
      return json(results);
    }

    if (path === "/expenses" && method === "POST") {
      const body = await request.json();
      const { category, macro, amount, note, date } = body;
      if (!category || !macro || !amount || !date) {
        return error("Required fields: category, macro, amount, date");
      }
      const result = await env.DB.prepare(
        "INSERT INTO expenses (category, macro, amount, note, date) VALUES (?, ?, ?, ?, ?)"
      )
        .bind(category, macro, amount, note ?? null, date)
        .run();
      return json({ id: result.meta.last_row_id }, 201);
    }

    const deleteExpense = path.match(/^\/expenses\/(\d+)$/);
    if (deleteExpense && method === "DELETE") {
      await env.DB.prepare("DELETE FROM expenses WHERE id = ?").bind(deleteExpense[1]).run();
      return json({ deleted: true });
    }

    // --- MOOD ---

    if (path === "/mood" && method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM mood ORDER BY date DESC"
      ).all();
      return json(results);
    }

    if (path === "/mood" && method === "POST") {
      const body = await request.json();
      const { value, note, date } = body;
      if (!value || !date) {
        return error("Required fields: value, date");
      }
      if (value < 1 || value > 4) {
        return error("value must be between 1 and 4");
      }
      const result = await env.DB.prepare(
        "INSERT OR REPLACE INTO mood (value, note, date) VALUES (?, ?, ?)"
      )
        .bind(value, note ?? null, date)
        .run();
      return json({ id: result.meta.last_row_id }, 201);
    }

    const deleteMood = path.match(/^\/mood\/(.+)$/);
    if (deleteMood && method === "DELETE") {
      await env.DB.prepare("DELETE FROM mood WHERE date = ?").bind(deleteMood[1]).run();
      return json({ deleted: true });
    }

    // --- STATS ---

    if (path === "/stats" && method === "GET") {
      const month = url.searchParams.get("month") || new Date().toISOString().slice(0, 7);

      const [monthTotal, macroCat, allMonths, moodExpense, moodSleep, sleepExpense, weeklyTrend] = await Promise.all([
        // Total for selected month
        env.DB.prepare(
          "SELECT SUM(amount) as total FROM expenses WHERE substr(date,1,7) = ?"
        ).bind(month).first(),

        // Breakdown by macro and category for selected month
        env.DB.prepare(
          "SELECT macro, category, SUM(amount) as total FROM expenses WHERE substr(date,1,7) = ? GROUP BY macro, category ORDER BY macro, total DESC"
        ).bind(month).all(),

        // Historical totals by month
        env.DB.prepare(
          "SELECT substr(date,1,7) as month, SUM(amount) as total FROM expenses GROUP BY month ORDER BY month DESC"
        ).all(),

        // Median daily expense per mood level (historical)
        env.DB.prepare(`
          SELECT value, ROUND(AVG(day_total), 2) as median_expense
          FROM (
            SELECT m.value, e.day_total,
              ROW_NUMBER() OVER (PARTITION BY m.value ORDER BY e.day_total) as rn,
              COUNT(*) OVER (PARTITION BY m.value) as cnt
            FROM mood m
            JOIN (SELECT date, SUM(amount) as day_total FROM expenses GROUP BY date) e ON e.date = m.date
          )
          WHERE rn IN ((cnt+1)/2, (cnt+2)/2)
          GROUP BY value
          ORDER BY value
        `).all(),

        // Median sleep hours per mood level (historical)
        env.DB.prepare(`
          SELECT value, ROUND(AVG(hours), 2) as median_hours, MAX(cnt) as days
          FROM (
            SELECT m.value, s.hours,
              ROW_NUMBER() OVER (PARTITION BY m.value ORDER BY s.hours) as rn,
              COUNT(*) OVER (PARTITION BY m.value) as cnt
            FROM mood m
            JOIN sleep s ON s.date = m.date
            WHERE s.hours IS NOT NULL
          )
          WHERE rn IN ((cnt+1)/2, (cnt+2)/2)
          GROUP BY value
          ORDER BY value
        `).all(),

        // Median daily expense per sleep band (historical)
        env.DB.prepare(`
          SELECT band, ROUND(AVG(day_total), 2) as median_expense, MAX(cnt) as days
          FROM (
            SELECT
              CASE
                WHEN s.hours < 6 THEN '<6h'
                WHEN s.hours < 7 THEN '6-7h'
                WHEN s.hours < 8 THEN '7-8h'
                ELSE '8h+'
              END as band,
              COALESCE(e.day_total, 0) as day_total,
              ROW_NUMBER() OVER (PARTITION BY
                CASE WHEN s.hours < 6 THEN 1 WHEN s.hours < 7 THEN 2 WHEN s.hours < 8 THEN 3 ELSE 4 END
                ORDER BY COALESCE(e.day_total, 0)
              ) as rn,
              COUNT(*) OVER (PARTITION BY
                CASE WHEN s.hours < 6 THEN 1 WHEN s.hours < 7 THEN 2 WHEN s.hours < 8 THEN 3 ELSE 4 END
              ) as cnt
            FROM sleep s
            LEFT JOIN (SELECT date, SUM(amount) as day_total FROM expenses GROUP BY date) e ON e.date = s.date
            WHERE s.hours IS NOT NULL
          )
          WHERE rn IN ((cnt+1)/2, (cnt+2)/2)
          GROUP BY band
          ORDER BY CASE band WHEN '<6h' THEN 1 WHEN '6-7h' THEN 2 WHEN '7-8h' THEN 3 ELSE 4 END
        `).all(),

        // Weekly trend (last 8 weeks)
        env.DB.prepare(`
          SELECT strftime('%Y-W%W', date) as week, SUM(amount) as total
          FROM expenses
          WHERE date >= date('now', '-56 days')
          GROUP BY week
          ORDER BY week ASC
        `).all(),
      ]);

      return json({
        month,
        total: monthTotal?.total ?? 0,
        macro_categories: macroCat.results,
        monthly_totals: allMonths.results,
        mood_vs_expense: moodExpense.results,
        mood_vs_sleep: moodSleep.results,
        sleep_vs_expense: sleepExpense.results,
        weekly_trend: weeklyTrend.results,
      });
    }

    // --- SLEEP ---

    if (path === "/sleep" && method === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM sleep ORDER BY id DESC"
      ).all();
      return json(results);
    }

    if (path === "/sleep" && method === "POST") {
      const body = await request.json();
      const { bedtime, wake_time, date } = body;
      if (!bedtime || !wake_time || !date) return error("Required: bedtime, wake_time, date");
      const [nh, nm] = bedtime.split(":").map(Number);
      const [sh, sm] = wake_time.split(":").map(Number);
      let minutes = (sh * 60 + sm) - (nh * 60 + nm);
      if (minutes < 0) minutes += 1440;
      const hours = Math.floor((minutes + 10) / 30) / 2;
      await env.DB.prepare(
        "INSERT INTO sleep (bedtime, wake_time, date, hours) VALUES (?, ?, ?, ?)"
      ).bind(bedtime, wake_time, date, hours).run();
      return json({ hours }, 201);
    }

    if (path === "/sleep/bedtime" && method === "POST") {
      const body = await request.json();
      const { bedtime } = body;
      if (!bedtime) return error("Required: bedtime");
      // Remove any pending (incomplete) sleep record
      await env.DB.prepare("DELETE FROM sleep WHERE wake_time IS NULL").run();
      await env.DB.prepare(
        "INSERT INTO sleep (bedtime) VALUES (?)"
      ).bind(bedtime).run();
      return json({ ok: true }, 201);
    }

    if (path === "/sleep/wakeup" && method === "POST") {
      const body = await request.json();
      const { wake_time, date } = body;
      if (!wake_time || !date) return error("Required: wake_time, date");

      const pending = await env.DB.prepare(
        "SELECT * FROM sleep WHERE wake_time IS NULL ORDER BY id DESC LIMIT 1"
      ).first();
      if (!pending) return error("No bedtime recorded", 404);

      const [nh, nm] = pending.bedtime.split(":").map(Number);
      const [sh, sm] = wake_time.split(":").map(Number);
      let minutes = (sh * 60 + sm) - (nh * 60 + nm);
      if (minutes < 0) minutes += 1440;
      const hours = Math.floor((minutes + 10) / 30) / 2;

      await env.DB.prepare(
        "UPDATE sleep SET wake_time = ?, date = ?, hours = ? WHERE id = ?"
      ).bind(wake_time, date, hours, pending.id).run();
      return json({ hours });
    }

    const deleteSleep = path.match(/^\/sleep\/(\d+)$/);
    if (deleteSleep && method === "DELETE") {
      await env.DB.prepare("DELETE FROM sleep WHERE id = ?").bind(deleteSleep[1]).run();
      return json({ deleted: true });
    }

    return error("Not found", 404);
  },
};
