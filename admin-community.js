/* Admin: Community module. People, events and insights from past event sign-ups. Read only. */
(function () {
  "use strict";

  function start() {
    const A = window.__admin;
    if (!A) return;
    const { sb, $, esc, openModal, closeModal, fmtDate } = A;

    let D = null; // { people, events, regs }
    let UI = { tab: "people", q: "", event: "", repeat: false, sort: "recent" };

    const css = document.createElement("style");
    css.textContent = `
      .cm-tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:0 0 18px; overflow-x:auto; }
      .cm-tabs button { background:none; border:0; padding:10px 14px; font:inherit; font-weight:500; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; white-space:nowrap; }
      .cm-tabs button.on { color:var(--ink); border-bottom-color:var(--ink); }
      .cm-ev { display:flex; flex-wrap:wrap; gap:6px; margin-top:6px; }
      .cm-tag { font-size:12px; background:var(--soft); border-radius:99px; padding:3px 10px; }
      .cm-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; }
      .cm-n { font-variant-numeric: tabular-nums; }
    `;
    document.head.appendChild(css);

    const clean = (s) => String(s == null ? "" : s).trim();

    // ---------- grouping helpers (the old Google Form changed over time) ----------
    function ageGroup(raw) {
      const s = clean(raw).toLowerCase();
      if (!s) return "Not given";
      if (/below|under/.test(s)) return "Under 18";
      const m = /(\d{1,2})/.exec(s);
      if (!m) return "Not given";
      const lo = Number(m[1]);
      if (lo < 18) return "Under 18";
      if (lo <= 24) return "18 to 24";
      if (lo <= 34) return "25 to 34";
      return "35 and over";
    }
    function jobGroup(raw) {
      const s = clean(raw).toLowerCase();
      if (!s) return "Not given";
      if (/student|study|uni/.test(s)) return "Student";
      if (/self|freelanc/.test(s)) return "Self-employed";
      if (/business|owner|founder|entrepreneur/.test(s)) return "Business";
      if (/professional|employee|work|manager|engineer|office/.test(s)) return "Professional";
      return "Other";
    }
    function sourceGroup(raw) {
      const s = clean(raw).toLowerCase();
      if (!s) return "Not given";
      if (/insta|ig\b/.test(s)) return "Instagram";
      if (/telegram/.test(s)) return "Telegram";
      if (/facebook|fb\b/.test(s)) return "Facebook";
      if (/tiktok/.test(s)) return "TikTok";
      if (/previous|past|before|returning/.test(s)) return "Past events";
      if (/friend|wife|husband|family|brother|sister|colleague|word of mouth|invited|partner|bf|gf/.test(s)) return "Friends and family";
      return "Other";
    }
    const count = (arr, fn) => {
      const m = {};
      arr.forEach((x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };

    // ---------- data ----------
    async function load() {
      const [a, r, e] = await Promise.all([
        sb.from("attendees").select("id,full_name,email").range(0, 4999),
        sb.from("event_registrations").select("id,event_id,attendee_id,age_bracket,profession,referral_source").range(0, 9999),
        sb.from("events").select("id,event_name,date,tab_origin").order("date", { ascending: true }),
      ]);
      const err = a.error || r.error || e.error;
      if (err) throw err;
      const evById = Object.fromEntries(e.data.map((x) => [x.id, x]));
      const regsBy = {};
      r.data.forEach((g) => (regsBy[g.attendee_id] = regsBy[g.attendee_id] || []).push(g));
      const people = a.data.map((p) => {
        const regs = (regsBy[p.id] || []).map((g) => Object.assign({}, g, { ev: evById[g.event_id] })).filter((g) => g.ev).sort((x, y) => x.ev.date.localeCompare(y.ev.date));
        const last = regs[regs.length - 1];
        const first = regs[0];
        return {
          id: p.id,
          name: clean(p.full_name) || "No name",
          email: clean(p.email),
          regs,
          n: regs.length,
          firstDate: first ? first.ev.date : "",
          lastDate: last ? last.ev.date : "",
          age: last ? ageGroup(last.age_bracket) : "Not given",
          job: last ? jobGroup(last.profession) : "Not given",
          jobRaw: last ? clean(last.profession) : "",
          source: first ? sourceGroup(first.referral_source) : "Not given",
          sourceRaw: first ? clean(first.referral_source) : "",
        };
      });
      const attendance = Object.fromEntries(e.data.map((x) => [x.id, 0]));
      r.data.forEach((g) => { if (attendance[g.event_id] != null) attendance[g.event_id]++; });
      D = { people, events: e.data.map((x) => Object.assign({}, x, { n: attendance[x.id] })), regs: r.data };
    }

    // ---------- views ----------
    async function view() {
      const root = $("#view");
      root.innerHTML = A.loading();
      try {
        if (!D) await load();
      } catch (err) {
        return A.fail(root, err);
      }
      draw();
    }

    function draw() {
      const root = $("#view");
      const { people, events, regs } = D;
      const repeaters = people.filter((p) => p.n > 1);
      const wrap = document.createElement("div");
      const stat = (l, v, s) => `<div class="card stat"><div class="label">${esc(l)}</div><div class="value">${esc(v)}</div><div class="sub">${esc(s)}</div></div>`;
      const avg = events.length ? Math.round(regs.length / events.length) : 0;
      const best = events.slice().sort((a, b) => b.n - a.n)[0];
      wrap.innerHTML =
        `<div class="grid stats">` +
        stat("People", people.length, "unique attendees") +
        stat("Sign ups", regs.length, "across " + events.length + " events") +
        stat("Came back", repeaters.length, people.length ? Math.round((repeaters.length / people.length) * 100) + "% attended 2 or more" : "") +
        stat("Average event", avg, "sign ups per event") +
        stat("Biggest event", best ? best.n : 0, best ? best.event_name : "") +
        `</div>` +
        `<div class="cm-tabs">${[["people", "People"], ["events", "Events"], ["insights", "Insights"]].map(([k, l]) => `<button type="button" data-tab="${k}" class="${UI.tab === k ? "on" : ""}">${l}</button>`).join("")}</div>` +
        `<div id="cm-body"></div>`;
      root.textContent = "";
      root.appendChild(wrap);
      wrap.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { UI.tab = b.dataset.tab; draw(); }));
      const top = $("#top-actions");
      top.textContent = "";
      const ex = document.createElement("button");
      ex.className = "btn small";
      ex.type = "button";
      ex.textContent = "Export CSV";
      ex.onclick = exportCsv;
      top.appendChild(ex);
      if (UI.tab === "people") drawPeople();
      else if (UI.tab === "events") drawEvents();
      else drawInsights();
    }

    function filtered() {
      const q = UI.q.toLowerCase();
      let list = D.people.filter((p) => (!q || p.name.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)) && (!UI.event || p.regs.some((g) => g.event_id === UI.event)) && (!UI.repeat || p.n > 1));
      if (UI.sort === "recent") list.sort((a, b) => b.lastDate.localeCompare(a.lastDate));
      else if (UI.sort === "most") list.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
      else list.sort((a, b) => a.name.localeCompare(b.name));
      return list;
    }

    function drawPeople() {
      const body = $("#cm-body");
      body.innerHTML =
        `<div class="toolbar"><input class="input grow" id="cm-q" placeholder="Search name or email" value="${esc(UI.q)}" />` +
        `<select class="select" id="cm-ev"><option value="">All events</option>${D.events.slice().reverse().map((e) => `<option value="${esc(e.id)}"${UI.event === e.id ? " selected" : ""}>${esc(e.event_name)}</option>`).join("")}</select>` +
        `<select class="select" id="cm-sort"><option value="recent"${UI.sort === "recent" ? " selected" : ""}>Latest first</option><option value="most"${UI.sort === "most" ? " selected" : ""}>Most events</option><option value="name"${UI.sort === "name" ? " selected" : ""}>Name A to Z</option></select>` +
        `<label class="check"><input type="checkbox" id="cm-rep"${UI.repeat ? " checked" : ""} /> Came back</label></div>` +
        `<div id="cm-list"></div>`;
      const list = $("#cm-list");
      const render = () => {
        const rows = filtered();
        list.innerHTML = rows.length
          ? `<div class="table-wrap card"><table><thead><tr><th>Name</th><th>Email</th><th class="num">Events</th><th>Last event</th><th>Age</th><th>Work</th></tr></thead><tbody>${rows.slice(0, 300).map((p) => `<tr class="click" data-id="${esc(p.id)}"><td><strong>${esc(p.name)}</strong></td><td>${esc(p.email)}</td><td class="num cm-n">${p.n}</td><td>${p.lastDate ? esc(fmtDate(p.lastDate)) : ""}</td><td>${esc(p.age)}</td><td>${esc(p.job)}</td></tr>`).join("")}</tbody></table></div><p class="hint">${rows.length} ${rows.length === 1 ? "person" : "people"}${rows.length > 300 ? ", showing the first 300. Use search or export for the rest" : ""}</p>`
          : '<div class="card empty">No one matches.</div>';
        list.querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => openPerson(D.people.find((p) => p.id === tr.dataset.id))));
      };
      $("#cm-q").oninput = (e) => { UI.q = e.target.value; render(); };
      $("#cm-ev").onchange = (e) => { UI.event = e.target.value; render(); };
      $("#cm-sort").onchange = (e) => { UI.sort = e.target.value; render(); };
      $("#cm-rep").onchange = (e) => { UI.repeat = e.target.checked; render(); };
      render();
    }

    function openPerson(p) {
      if (!p) return;
      const body =
        `<p class="hint">${esc(p.email || "No email")}</p>` +
        `<div class="cm-ev">${p.regs.map((g) => `<span class="cm-tag">${esc(g.ev.event_name)} · ${esc(fmtDate(g.ev.date))}</span>`).join("")}</div>` +
        `<dl style="margin:18px 0 0"><dt class="hint">Age group</dt><dd style="margin:0 0 10px">${esc(p.age)}</dd><dt class="hint">Work</dt><dd style="margin:0 0 10px">${esc(p.jobRaw || "Not given")}</dd><dt class="hint">First heard about us</dt><dd style="margin:0">${esc(p.sourceRaw || "Not given")}</dd></dl>`;
      openModal(p.name, body, `<span class="spacer"></span><button class="btn light" type="button" data-close>Close</button>`);
    }

    function drawEvents() {
      const body = $("#cm-body");
      const mx = Math.max(1, ...D.events.map((e) => e.n));
      const byEvent = {};
      D.regs.forEach((g) => (byEvent[g.event_id] = byEvent[g.event_id] || []).push(g));
      const firstEver = {};
      D.people.forEach((p) => { if (p.regs[0]) firstEver[p.regs[0].event_id] = (firstEver[p.regs[0].event_id] || 0) + 1; });
      body.innerHTML = `<div class="table-wrap card"><table><thead><tr><th>Event</th><th>Date</th><th class="num">Sign ups</th><th class="num">New people</th><th>Top source</th><th style="width:22%"></th></tr></thead><tbody>${D.events.slice().reverse().map((e) => {
        const top = count(byEvent[e.id] || [], (g) => sourceGroup(g.referral_source))[0];
        const fresh = firstEver[e.id] || 0;
        return `<tr><td><strong>${esc(e.event_name)}</strong></td><td>${esc(fmtDate(e.date))}</td><td class="num cm-n">${e.n}</td><td class="num cm-n">${fresh}</td><td>${top ? esc(top[0]) : ""}</td><td><div class="ov-track"><i class="alt" style="width:${Math.max(3, Math.round((e.n / mx) * 100))}%"></i></div></td></tr>`;
      }).join("")}</tbody></table></div>`;
    }

    function drawInsights() {
      const body = $("#cm-body");
      const bars = (title, rows, note) => {
        const mx = Math.max(1, ...rows.map((r) => r[1]));
        const tot = rows.reduce((a, r) => a + r[1], 0) || 1;
        return `<div class="card"><h2>${esc(title)}</h2>${rows.map(([l, n]) => `<div class="ov-bar"><div class="ov-bar-top"><span>${esc(l)}</span><span>${n} (${Math.round((n / tot) * 100)}%)</span></div><div class="ov-track"><i style="width:${Math.max(2, Math.round((n / mx) * 100))}%"></i></div></div>`).join("")}${note ? `<p class="hint">${esc(note)}</p>` : ""}</div>`;
      };
      const people = D.people;
      const perPerson = count(people, (p) => (p.n >= 5 ? "5 or more" : String(p.n)));
      const order = ["1", "2", "3", "4", "5 or more"];
      perPerson.sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      const regulars = people.slice().sort((a, b) => b.n - a.n).slice(0, 8);
      const timeline = D.events.map((e) => [e.event_name, e.n]);
      body.innerHTML = `<div class="cm-grid">` +
        bars("Sign ups per event", timeline) +
        bars("How people found us (first time)", count(people, (p) => p.source)) +
        bars("Age groups", count(people, (p) => p.age), "Approximate. The sign up form changed its age ranges over time.") +
        bars("Work", count(people, (p) => p.job)) +
        bars("Events per person", perPerson.map(([k, n]) => [k + (k === "1" ? " event" : " events"), n])) +
        `<div class="card"><h2>Most regular</h2>${regulars.map((p) => `<div class="list-row"><div><a href="#community" class="link" data-p="${esc(p.id)}">${esc(p.name)}</a><div class="sub">${esc(p.email)}</div></div><div class="cm-n">${p.n} events</div></div>`).join("")}</div>` +
        `</div>`;
      body.querySelectorAll("[data-p]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); openPerson(D.people.find((p) => p.id === a.dataset.p)); }));
    }

    // ---------- export ----------
    const cell = (v) => {
      let s = clean(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    function exportCsv() {
      const lines = [["Name", "Email", "Events attended", "First event", "Last event", "Age", "Work", "How they found us"].map(cell).join(",")];
      filtered().forEach((p) => lines.push([p.name, p.email, p.n, p.regs[0] ? p.regs[0].ev.event_name : "", p.regs.length ? p.regs[p.regs.length - 1].ev.event_name : "", p.regs.length ? p.regs[p.regs.length - 1].age_bracket : "", p.jobRaw, p.sourceRaw].map(cell).join(",")));
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "community-" + new Date().toLocaleDateString("en-CA") + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    A.register("community", { title: "Community", ok: () => A.can("community"), render: () => { D = null; return view(); } });
  }

  if (window.__admin) start();
  else document.addEventListener("admin-ready", start);
})();
