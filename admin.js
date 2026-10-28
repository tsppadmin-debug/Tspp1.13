(() => {
  "use strict";

  // Public (publishable) key. Safe in the browser: every table is locked by row level security.
  const SUPABASE_URL = "https://vxamxpmhgkgxwecdycjj.supabase.co";
  const SUPABASE_KEY = "sb_publishable_CRnwiQGclzMiH7AAlZi0tw_w4bkNp1T";

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const money = (n) =>
    "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const today = () => new Date().toLocaleDateString("en-CA");
  const fmtDate = (d) =>
    d ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Not set";
  const fmtStamp = (d) =>
    new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const opts = (map, sel) =>
    Object.entries(map)
      .map(([k, v]) => `<option value="${esc(k)}"${k === sel ? " selected" : ""}>${esc(v)}</option>`)
      .join("");

  function toast(msg, isErr) {
    const t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), isErr ? 6000 : 3200);
  }

  function show(which) {
    ["boot", "login", "denied", "app"].forEach((id) => {
      $("#" + id).hidden = id !== which;
    });
  }

  // ---------- constants ----------
  const STAGES = {
    lead: "Lead",
    contacted: "Contacted",
    proposal: "Proposal sent",
    negotiation: "Negotiation",
    won: "Won",
    lost: "Lost",
    on_hold: "On hold",
  };
  const CATEGORIES = { sponsor: "Sponsor", venue: "Venue", media: "Media", brand: "Brand", community: "Community", other: "Other" };
  const ACT_KINDS = { note: "Note", call: "Call", email: "Email", meeting: "Meeting", proposal: "Proposal" };
  const DOC_TYPES = { invoice: "Invoice", quotation: "Quotation" };
  const DOC_STATUS = { draft: "Draft", sent: "Sent", paid: "Paid" };
  const MODULES = [
    { key: "partners", label: "Partners" },
    { key: "documents", label: "Invoices" },
    { key: "gallery", label: "Gallery" },
  ];
  const closedStage = (p) => p.stage === "won" || p.stage === "lost";

  const S = {
    user: null,
    me: null,
    view: "overview",
    partners: [],
    docs: [],
    team: [],
    photos: [],
    gcol: "saturday",
    settings: {},
    pf: { q: "", stage: "", category: "", due: false },
    df: { q: "", type: "", status: "" },
  };
  const can = (m) => !!S.me && (S.me.role === "admin" || (S.me.modules || []).includes(m));
  const isAdmin = () => !!S.me && S.me.role === "admin";

  // ---------- auth ----------
  async function boot() {
    show("boot");
    const {
      data: { session },
    } = await sb.auth.getSession();
    await onSession(session);
    sb.auth.onAuthStateChange((evt, sess) => {
      if (evt === "SIGNED_OUT") onSession(null);
      else if (evt === "SIGNED_IN" && sess && (!S.user || S.user.id !== sess.user.id)) onSession(sess);
    });
  }

  async function onSession(session) {
    if (!session) {
      S.user = null;
      S.me = null;
      show("login");
      return;
    }
    S.user = session.user;
    const email = (session.user.email || "").toLowerCase();
    const { data, error } = await sb.from("admin_users").select("*").eq("email", email).maybeSingle();
    if (error || !data || !data.active) {
      $("#denied-email").textContent = email || "This account";
      $("#denied-error").textContent = error ? error.message : "";
      show("denied");
      return;
    }
    S.me = data;
    renderShell();
    show("app");
    go((location.hash || "").slice(1) || "overview");
  }

  async function signIn() {
    $("#login-error").textContent = "";
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.origin + "/admin.html", queryParams: { prompt: "select_account" } },
    });
    if (error) $("#login-error").textContent = error.message;
  }

  async function signOut() {
    await sb.auth.signOut();
    S.me = null;
    S.user = null;
    show("login");
  }

  // ---------- shell / routing ----------
  const VIEWS = {
    overview: { title: "Overview", ok: () => true, render: viewOverview },
    partners: { title: "Partners", ok: () => can("partners"), render: viewPartners },
    documents: { title: "Invoices", ok: () => can("documents"), render: viewDocuments },
    gallery: { title: "Gallery", ok: () => can("gallery"), render: viewGallery },
    team: { title: "Team access", ok: () => isAdmin(), render: viewTeam },
  };

  function renderShell() {
    $("#me-email").textContent = S.me.full_name || S.me.email;
    $("#me-role").textContent = S.me.role + (S.me.full_name ? " · " + S.me.email : "");
    $("#nav").innerHTML = Object.entries(VIEWS)
      .filter(([, v]) => v.ok())
      .map(([k, v]) => `<a href="#${k}" data-view="${k}">${esc(v.title)}</a>`)
      .join("");
  }

  function go(view) {
    if (!VIEWS[view] || !VIEWS[view].ok()) view = "overview";
    S.view = view;
    $$("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.view === view));
    $("#view-title").textContent = VIEWS[view].title;
    $("#top-actions").innerHTML = "";
    $("#sidebar").classList.remove("open");
    VIEWS[view].render();
  }

  const loading = () => '<div class="empty">Loading...</div>';
  function fail(root, error) {
    root.innerHTML = `<div class="card"><h2>Something went wrong</h2><p class="msg-error">${esc(error.message || error)}</p></div>`;
  }

  // ---------- modal ----------
  function openModal(title, bodyHtml, footHtml, wide) {
    closeModal();
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `<div class="modal${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="btn-ghost" type="button" data-close aria-label="Close">&times;</button></div>
      <div class="modal-body">${bodyHtml}</div>
      ${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ""}
    </div>`;
    wrap.addEventListener("mousedown", (e) => {
      if (e.target === wrap) closeModal();
    });
    wrap.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeModal();
    });
    $("#modal-root").appendChild(wrap);
    return wrap;
  }
  function closeModal() {
    $("#modal-root").innerHTML = "";
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // =====================================================
  // OVERVIEW
  // =====================================================
  async function viewOverview() {
    const root = $("#view");
    root.innerHTML = loading();
    const t = today();
    let html = "";
    const stats = [];
    const lists = [];

    if (can("partners")) {
      const { data, error } = await sb.from("partners").select("id,name,stage,value_usd,next_follow_up,contact_name");
      if (error) return fail(root, error);
      const open = data.filter((p) => !closedStage(p));
      const won = data.filter((p) => p.stage === "won");
      const due = open.filter((p) => p.next_follow_up && p.next_follow_up <= t).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up));
      stats.push(
        { l: "Open partners", v: open.length, s: money(open.reduce((a, p) => a + Number(p.value_usd), 0)) + " in pipeline" },
        { l: "Won", v: won.length, s: money(won.reduce((a, p) => a + Number(p.value_usd), 0)) + " secured" },
        { l: "Follow-ups due", v: due.length, s: due.length ? "Needs a nudge today" : "All caught up" }
      );
      lists.push(`<div class="card"><h2>Partner follow-ups due</h2>${
        due.length
          ? due.slice(0, 8).map((p) => `<div class="list-row"><div><a href="#partners" data-open-partner="${esc(p.id)}" class="link">${esc(p.name)}</a><div class="sub">${esc(p.contact_name || "No contact")}</div></div><div class="overdue">${fmtDate(p.next_follow_up)}</div></div>`).join("")
          : '<div class="empty">Nothing due. Nice.</div>'
      }</div>`);
    }

    if (can("documents")) {
      const { data, error } = await sb.from("ts_documents").select("id,number,doc_type,status,total,due_date,client_name");
      if (error) return fail(root, error);
      const invoices = data.filter((d) => d.doc_type === "invoice");
      const sent = invoices.filter((d) => d.status === "sent");
      const overdue = sent.filter((d) => d.due_date && d.due_date < t);
      const paid = invoices.filter((d) => d.status === "paid");
      stats.push(
        { l: "Outstanding", v: money(sent.reduce((a, d) => a + Number(d.total), 0)), s: sent.length + " invoice" + (sent.length === 1 ? "" : "s") + " sent" },
        { l: "Overdue", v: overdue.length, s: money(overdue.reduce((a, d) => a + Number(d.total), 0)) },
        { l: "Paid (all time)", v: money(paid.reduce((a, d) => a + Number(d.total), 0)), s: paid.length + " invoice" + (paid.length === 1 ? "" : "s") }
      );
      lists.push(`<div class="card"><h2>Invoices waiting on payment</h2>${
        sent.length
          ? sent.sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999")).slice(0, 8).map((d) => `<div class="list-row"><div><strong>${esc(d.number)}</strong><div class="sub">${esc(d.client_name)}</div></div><div style="text-align:right">${money(d.total)}<div class="sub ${d.due_date && d.due_date < t ? "overdue" : ""}">due ${fmtDate(d.due_date)}</div></div></div>`).join("")
          : '<div class="empty">No unpaid invoices.</div>'
      }</div>`);
    }

    if (!stats.length) {
      html = '<div class="card"><h2>Welcome</h2><p class="sub">You are signed in, but no modules are assigned to you yet. Ask an admin to give you access.</p></div>';
    } else {
      html =
        `<div class="grid stats">${stats.map((s) => `<div class="card stat"><div class="label">${esc(s.l)}</div><div class="value">${esc(s.v)}</div><div class="sub">${esc(s.s)}</div></div>`).join("")}</div>` +
        `<div class="grid two">${lists.join("")}</div>`;
    }
    root.innerHTML = html;
    $$("[data-open-partner]", root).forEach((a) =>
      a.addEventListener("click", (e) => {
        e.preventDefault();
        S.pendingPartner = a.dataset.openPartner;
        location.hash = "partners";
      })
    );
  }

  // =====================================================
  // PARTNERS CRM
  // =====================================================
  async function viewPartners() {
    const root = $("#view");
    root.innerHTML = loading();
    const { data, error } = await sb.from("partners").select("*").order("updated_at", { ascending: false });
    if (error) return fail(root, error);
    S.partners = data;

    $("#top-actions").innerHTML = '<button class="btn" id="add-partner" type="button">Add partner</button>';
    $("#add-partner").onclick = () => openPartner(null);

    root.innerHTML = `
      <div id="pstrip" class="strip"></div>
      <div class="toolbar">
        <input class="input" id="pq" type="search" placeholder="Search name, contact, owner..." value="${esc(S.pf.q)}" />
        <select class="select" id="pcat"><option value="">All categories</option>${opts(CATEGORIES, S.pf.category)}</select>
        <label style="display:flex;gap:6px;align-items:center;font-size:14px"><input type="checkbox" id="pdue" ${S.pf.due ? "checked" : ""}/> Follow-up due</label>
        <span class="grow"></span>
        <button class="btn light small" id="pcsv" type="button">Export CSV</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Partner</th><th>Stage</th><th>Contact</th><th class="num">Value</th><th>Owner</th><th>Follow-up</th></tr></thead>
        <tbody id="pbody"></tbody>
      </table></div>`;

    $("#pq").oninput = (e) => { S.pf.q = e.target.value; drawPartners(); };
    $("#pcat").onchange = (e) => { S.pf.category = e.target.value; drawPartners(); };
    $("#pdue").onchange = (e) => { S.pf.due = e.target.checked; drawPartners(); };
    $("#pcsv").onclick = exportPartnersCsv;
    drawPartners();

    if (S.pendingPartner) {
      const id = S.pendingPartner;
      S.pendingPartner = null;
      if (S.partners.some((p) => p.id === id)) openPartner(id);
    }
  }

  function filteredPartners() {
    const f = S.pf;
    const t = today();
    const q = f.q.trim().toLowerCase();
    return S.partners.filter(
      (p) =>
        (!f.stage || p.stage === f.stage) &&
        (!f.category || p.category === f.category) &&
        (!f.due || (p.next_follow_up && p.next_follow_up <= t && !closedStage(p))) &&
        (!q || [p.name, p.contact_name, p.contact_email, p.owner_email, p.notes].join(" ").toLowerCase().includes(q))
    );
  }

  function drawPartners() {
    const t = today();
    // pipeline strip counts ignore the stage filter so chips stay clickable
    const strip = Object.keys(STAGES).map((k) => {
      const list = S.partners.filter((p) => p.stage === k);
      const val = list.reduce((a, p) => a + Number(p.value_usd), 0);
      return `<button type="button" class="chip${S.pf.stage === k ? " on" : ""}" data-stage="${k}"><div class="n">${list.length}</div><div class="t">${esc(STAGES[k])}${val ? " · " + money(val) : ""}</div></button>`;
    });
    $("#pstrip").innerHTML = strip.join("");
    $$("#pstrip .chip").forEach((c) =>
      c.addEventListener("click", () => {
        S.pf.stage = S.pf.stage === c.dataset.stage ? "" : c.dataset.stage;
        drawPartners();
      })
    );

    const rows = filteredPartners();
    $("#pbody").innerHTML = rows.length
      ? rows
          .map((p) => {
            const od = p.next_follow_up && p.next_follow_up <= t && !closedStage(p);
            return `<tr class="click" data-id="${esc(p.id)}">
              <td><strong>${esc(p.name)}</strong>${p.published ? ' <span class="badge s-won">On website</span>' : ""}<div class="sub">${esc(CATEGORIES[p.category] || p.category)}</div></td>
              <td><span class="badge s-${esc(p.stage)}">${esc(STAGES[p.stage] || p.stage)}</span></td>
              <td>${esc(p.contact_name || "None")}<div class="sub">${esc(p.contact_email || p.contact_phone || "")}</div></td>
              <td class="num">${p.value_usd ? money(p.value_usd) : "None"}</td>
              <td class="sub">${esc(p.owner_email || "None")}</td>
              <td class="${od ? "overdue" : ""}">${fmtDate(p.next_follow_up)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="6"><div class="empty">${S.partners.length ? "No partners match these filters." : "No partners yet. Add your first one to start the pipeline."}</div></td></tr>`;
    $$("#pbody tr.click").forEach((tr) => tr.addEventListener("click", () => openPartner(tr.dataset.id)));
  }

  function csvCell(v) {
    let s = String(v ?? "");
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // block spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function downloadCsv(name, header, rows) {
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  function exportPartnersCsv() {
    const rows = filteredPartners().map((p) => [p.name, CATEGORIES[p.category], STAGES[p.stage], p.contact_name, p.contact_email, p.contact_phone, p.value_usd, p.owner_email, p.next_follow_up, p.notes]);
    downloadCsv(`partners-${today()}.csv`, ["Name", "Category", "Stage", "Contact", "Email", "Phone", "Value USD", "Owner", "Next follow-up", "Notes"], rows);
  }

  // ---- partner website profile helpers ----
  function slugify(t) {
    return String(t || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  function cleanUrl(v) {
    let s = String(v || "").trim();
    if (!s) return null;
    if (!/^https?:\/\//i.test(s)) s = "https://" + s;
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
    } catch (e) {
      return null;
    }
  }
  async function uploadPartnerImage(file, slug, kind) {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error("Use a PNG, JPG, WebP or SVG image.");
    if (file.size > 3 * 1024 * 1024) throw new Error("Image is over 3 MB. Please shrink it first.");
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[file.type];
    const path = `${slug || "partner"}/${kind}-${Date.now()}.${ext}`;
    const { error } = await sb.storage.from("partner-media").upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return sb.storage.from("partner-media").getPublicUrl(path).data.publicUrl;
  }
  function thumbHtml(url, wide) {
    return `<div class="thumb${wide ? " wide" : ""}">${url ? `<img src="${esc(url)}" alt="" />` : "None"}</div>`;
  }

  function openPartner(id) {
    const p = id ? S.partners.find((x) => x.id === id) : null;
    const v = p || { name: "", category: "sponsor", stage: "lead", contact_name: "", contact_email: "", contact_phone: "", value_usd: "", owner_email: S.me.email, next_follow_up: "", notes: "", published: false, featured: false, sort_order: 100, slug: "", tagline: "", description: "", logo_url: "", cover_url: "", website_url: "", instagram_url: "", facebook_url: "", tiktok_url: "", other_url: "", partner_since: "" };
    const body = `
      <form id="pform" class="form-grid" autocomplete="off">
        <div class="full"><label class="f" for="pf-name">Partner name</label><input class="input" id="pf-name" name="name" required maxlength="160" value="${esc(v.name)}" /></div>
        <div><label class="f">Category</label><select class="select" name="category">${opts(CATEGORIES, v.category)}</select></div>
        <div><label class="f">Stage</label><select class="select" name="stage">${opts(STAGES, v.stage)}</select></div>
        <div><label class="f">Contact person</label><input class="input" name="contact_name" maxlength="120" value="${esc(v.contact_name)}" /></div>
        <div><label class="f">Contact email</label><input class="input" type="email" name="contact_email" maxlength="160" value="${esc(v.contact_email)}" /></div>
        <div><label class="f">Contact phone</label><input class="input" name="contact_phone" maxlength="40" value="${esc(v.contact_phone)}" /></div>
        <div><label class="f">Deal value (USD)</label><input class="input" type="number" min="0" step="0.01" name="value_usd" value="${esc(v.value_usd)}" /></div>
        <div><label class="f">Owner on our team</label><input class="input" type="email" name="owner_email" maxlength="160" value="${esc(v.owner_email)}" /></div>
        <div><label class="f">Next follow-up</label><input class="input" type="date" name="next_follow_up" value="${esc(v.next_follow_up)}" /></div>
        <div class="full"><label class="f">Notes</label><textarea class="textarea" name="notes" maxlength="4000">${esc(v.notes)}</textarea></div>
        <div class="full sect"><h3>Website profile</h3><div class="sub">What visitors see on the public Partners page. Nothing below is shown until you tick Show on website.</div></div>
        <div class="full"><label class="check"><input type="checkbox" name="published" ${v.published ? "checked" : ""} /> Show on website</label></div>
        <div class="full"><label class="check"><input type="checkbox" name="featured" ${v.featured ? "checked" : ""} /> Feature at the top</label></div>
        <div class="full"><label class="f">Logo</label>
          <div class="media-row"><div id="logo-prev">${thumbHtml(v.logo_url)}</div>
          <div style="flex:1"><input class="input" type="file" id="logo-file" accept="image/png,image/jpeg,image/webp,image/svg+xml" />
          <div class="hint">PNG, JPG, WebP or SVG, up to 3 MB. Transparent PNG looks best. Or paste a link below.</div>
          <input class="input" name="logo_url" placeholder="https://... (optional image link)" maxlength="500" value="${esc(v.logo_url)}" style="margin-top:6px" /></div></div></div>
        <div class="full"><label class="f">Cover photo (optional)</label>
          <div class="media-row"><div id="cover-prev">${thumbHtml(v.cover_url, true)}</div>
          <div style="flex:1"><input class="input" type="file" id="cover-file" accept="image/png,image/jpeg,image/webp" />
          <input class="input" name="cover_url" placeholder="https://... (optional image link)" maxlength="500" value="${esc(v.cover_url)}" style="margin-top:6px" /></div></div></div>
        <div class="full"><label class="f">Tagline</label><input class="input" name="tagline" maxlength="140" placeholder="One line, for example: Matcha bar on Street 240" value="${esc(v.tagline)}" /></div>
        <div class="full"><label class="f">About this partner</label><textarea class="textarea" name="description" maxlength="2000" placeholder="What they do and how we work together.">${esc(v.description)}</textarea></div>
        <div><label class="f">Website</label><input class="input" name="website_url" maxlength="300" placeholder="example.com" value="${esc(v.website_url)}" /></div>
        <div><label class="f">Instagram</label><input class="input" name="instagram_url" maxlength="300" placeholder="instagram.com/..." value="${esc(v.instagram_url)}" /></div>
        <div><label class="f">Facebook</label><input class="input" name="facebook_url" maxlength="300" placeholder="facebook.com/..." value="${esc(v.facebook_url)}" /></div>
        <div><label class="f">TikTok</label><input class="input" name="tiktok_url" maxlength="300" placeholder="tiktok.com/@..." value="${esc(v.tiktok_url)}" /></div>
        <div><label class="f">Other link</label><input class="input" name="other_url" maxlength="300" placeholder="Telegram, Google Maps, menu..." value="${esc(v.other_url)}" /></div>
        <div><label class="f">Partner since</label><input class="input" type="date" name="partner_since" value="${esc(v.partner_since)}" /></div>
        <div><label class="f">Display order</label><input class="input" type="number" min="0" max="9999" step="1" name="sort_order" value="${esc(v.sort_order)}" /><div class="hint">Lower numbers show first.</div></div>
      </form>
      ${p ? '<div class="timeline"><h3>Activity</h3><form id="actform" class="act-form"><select class="select" name="kind">' + opts(ACT_KINDS, "note") + '</select><input class="input" name="note" placeholder="What happened?" maxlength="2000" required /><button class="btn small" type="submit">Log</button></form><div id="acts"><div class="empty">Loading...</div></div></div>' : ""}`;
    const foot = `${p && isAdmin() ? '<button class="btn danger" type="button" id="pdel">Delete</button>' : ""}<span class="spacer"></span><button class="btn light" type="button" data-close>Cancel</button><button class="btn" type="submit" form="pform" id="psave">${p ? "Save changes" : "Add partner"}</button>`;
    const m = openModal(p ? p.name : "Add partner", body, foot, true);

    $("#pform", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const links = {};
      for (const k of ["website_url", "instagram_url", "facebook_url", "tiktok_url", "other_url"]) {
        const raw = String(fd.get(k) || "").trim();
        links[k] = cleanUrl(raw);
        if (raw && !links[k]) return toast("That link in " + k.replace("_url", "") + " does not look right", true);
      }
      const row = {
        ...links,
        published: fd.get("published") === "on",
        featured: fd.get("featured") === "on",
        sort_order: Math.min(9999, Math.max(0, Math.round(num(fd.get("sort_order")) || 100))),
        tagline: String(fd.get("tagline") || "").trim() || null,
        description: String(fd.get("description") || "").trim() || null,
        logo_url: cleanUrl(fd.get("logo_url")),
        cover_url: cleanUrl(fd.get("cover_url")),
        partner_since: fd.get("partner_since") || null,
        name: String(fd.get("name") || "").trim(),
        category: fd.get("category"),
        stage: fd.get("stage"),
        contact_name: String(fd.get("contact_name") || "").trim() || null,
        contact_email: String(fd.get("contact_email") || "").trim() || null,
        contact_phone: String(fd.get("contact_phone") || "").trim() || null,
        value_usd: Math.max(0, num(fd.get("value_usd"))),
        owner_email: String(fd.get("owner_email") || "").trim().toLowerCase() || null,
        next_follow_up: fd.get("next_follow_up") || null,
        notes: String(fd.get("notes") || "").trim() || null,
      };
      if (!row.name) return toast("Partner name is required", true);
      const btn = $("#psave", m);
      btn.disabled = true;
      row.slug = (p && p.slug) || slugify(row.name) || null;
      try {
        const lf = $("#logo-file", m).files[0];
        const cf = $("#cover-file", m).files[0];
        if (lf) row.logo_url = await uploadPartnerImage(lf, row.slug, "logo");
        if (cf) row.cover_url = await uploadPartnerImage(cf, row.slug, "cover");
      } catch (err) {
        btn.disabled = false;
        return toast(err.message || "Image upload failed", true);
      }
      const res = p ? await sb.from("partners").update(row).eq("id", p.id) : await sb.from("partners").insert({ ...row, created_by: S.me.email });
      btn.disabled = false;
      if (res.error) return toast(/partners_slug_key/.test(res.error.message) ? "Another partner already uses a very similar name. Add a word to make it unique." : res.error.message, true);
      toast(p ? "Partner updated" : "Partner added");
      closeModal();
      viewPartners();
    });

    [["#logo-file", "#logo-prev", false], ["#cover-file", "#cover-prev", true]].forEach(([fi, pv, wide]) =>
      $(fi, m).addEventListener("change", (e) => {
        const f = e.target.files[0];
        if (f && /^image\//.test(f.type)) $(pv, m).innerHTML = thumbHtml(URL.createObjectURL(f), wide);
      })
    );

    if (p) {
      loadActivities(p.id, m);
      $("#actform", m).addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const note = String(fd.get("note") || "").trim();
        if (!note) return;
        const { error } = await sb.from("partner_activities").insert({ partner_id: p.id, kind: fd.get("kind"), note, created_by: S.me.email });
        if (error) return toast(error.message, true);
        e.target.reset();
        loadActivities(p.id, m);
      });
      const del = $("#pdel", m);
      if (del)
        del.onclick = async () => {
          if (!confirm(`Delete ${p.name} and its activity log? This cannot be undone.`)) return;
          const { error } = await sb.from("partners").delete().eq("id", p.id);
          if (error) return toast(error.message, true);
          toast("Partner deleted");
          closeModal();
          viewPartners();
        };
    }
  }

  async function loadActivities(partnerId, m) {
    const box = $("#acts", m);
    const { data, error } = await sb.from("partner_activities").select("*").eq("partner_id", partnerId).order("created_at", { ascending: false });
    if (!box) return;
    if (error) return (box.innerHTML = `<div class="msg-error">${esc(error.message)}</div>`);
    box.innerHTML = data.length
      ? data.map((a) => `<div class="act"><div class="meta"><span class="kind">${esc(ACT_KINDS[a.kind] || a.kind)}</span> · ${esc(fmtStamp(a.created_at))} · ${esc(a.created_by || "")}</div><div>${esc(a.note)}</div></div>`).join("")
      : '<div class="empty">No activity logged yet.</div>';
  }

  // =====================================================
  // GALLERY (photos live on Cloudinary, rows live in Supabase)
  // =====================================================
  const COLLECTIONS = { wednesday: "Social Night", saturday: "Social Saturday" };

  // Ask Cloudinary for a small, optimized copy. Other hosts pass through untouched.
  function cl(url, w) {
    const m = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/.exec(String(url || ""));
    return m ? `${m[1]}f_auto,q_auto,c_limit,w_${w}/${m[2]}` : url;
  }
  function httpsUrl(v) {
    try {
      const u = new URL(String(v || "").trim());
      return u.protocol === "https:" ? u.href : "";
    } catch (e) {
      return "";
    }
  }

  async function loadSettings() {
    const { data } = await sb.from("site_settings").select("key,value");
    S.settings = {};
    (data || []).forEach((r) => (S.settings[r.key] = r.value || ""));
  }

  async function viewGallery() {
    const root = $("#view");
    root.innerHTML = loading();
    const [ph, _] = await Promise.all([
      sb.from("gallery_photos").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: false }),
      loadSettings(),
    ]);
    if (ph.error) return fail(root, ph.error);
    S.photos = ph.data;

    $("#top-actions").innerHTML = '<button class="btn" id="add-photos" type="button">Upload photos</button>';
    $("#add-photos").onclick = () => openUpload();

    const ready = !!S.settings.cloudinary_preset;
    root.innerHTML = `
      <div class="card" id="cl-card" style="margin-bottom:16px">
        <h2 style="margin-bottom:6px">Cloudinary</h2>
        ${
          ready
            ? `<p class="sub">Uploads go to cloud <strong>${esc(S.settings.cloudinary_cloud || "")}</strong> using the preset <strong>${esc(S.settings.cloudinary_preset)}</strong>. The website asks Cloudinary for small, optimized versions, so pages stay fast.</p>`
            : `<p class="sub">One setup step is left before uploads work. In Cloudinary go to Settings, Upload, Upload presets, add a preset, set Signing mode to Unsigned, and save. Then type its name here. Until then you can still add photos by pasting links.</p>`
        }
        ${
          isAdmin()
            ? `<form id="cl-form" class="act-form" style="margin-top:10px"><input class="input" name="cloud" placeholder="Cloud name" maxlength="60" value="${esc(S.settings.cloudinary_cloud || "")}" style="max-width:180px" /><input class="input" name="preset" placeholder="Unsigned upload preset name" maxlength="80" value="${esc(S.settings.cloudinary_preset || "")}" /><button class="btn small" type="submit">Save</button></form>`
            : ready
            ? ""
            : '<p class="sub" style="margin-top:8px">Ask an admin to finish this step.</p>'
        }
      </div>
      <div id="gstrip" class="strip"></div>
      <div id="ggrid" class="photo-grid"></div>`;

    const clf = $("#cl-form");
    if (clf)
      clf.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const cloud = String(fd.get("cloud") || "").trim();
        const preset = String(fd.get("preset") || "").trim();
        if (!/^[A-Za-z0-9_-]*$/.test(cloud) || !/^[A-Za-z0-9_.-]*$/.test(preset)) return toast("Use letters, numbers and underscores only", true);
        const rows = [
          { key: "cloudinary_cloud", value: cloud, updated_by: S.me.email, updated_at: new Date().toISOString() },
          { key: "cloudinary_preset", value: preset, updated_by: S.me.email, updated_at: new Date().toISOString() },
        ];
        const { error } = await sb.from("site_settings").upsert(rows);
        if (error) return toast(error.message, true);
        toast("Cloudinary settings saved");
        viewGallery();
      });
    drawGallery();
  }

  function drawGallery() {
    const strip = Object.keys(COLLECTIONS).map((k) => {
      const n = S.photos.filter((p) => p.collection === k).length;
      return `<button type="button" class="chip${S.gcol === k ? " on" : ""}" data-col="${k}"><div class="n">${n}</div><div class="t">${esc(COLLECTIONS[k])}</div></button>`;
    });
    $("#gstrip").innerHTML = strip.join("");
    $$("#gstrip .chip").forEach((c) =>
      c.addEventListener("click", () => {
        S.gcol = c.dataset.col;
        drawGallery();
      })
    );
    const list = S.photos.filter((p) => p.collection === S.gcol);
    $("#ggrid").innerHTML = list.length
      ? list
          .map(
            (p) => `<button type="button" class="photo" data-id="${esc(p.id)}" aria-label="Edit ${esc(p.caption || "photo")}">
              <img src="${esc(cl(p.image_url, 320))}" alt="${esc(p.alt_text || p.caption || "")}" loading="lazy" />
              ${p.published ? "" : '<span class="badge photo-flag">Hidden</span>'}
              <span class="photo-cap">${esc(p.caption || "No caption")}</span>
            </button>`
          )
          .join("")
      : `<div class="empty">No photos in ${esc(COLLECTIONS[S.gcol])} yet. Use Upload photos to add some.</div>`;
    $$("#ggrid .photo").forEach((b) => b.addEventListener("click", () => openPhoto(b.dataset.id)));
  }

  function openUpload() {
    const ready = !!S.settings.cloudinary_preset;
    const body = `
      <form id="upform" class="form-grid" autocomplete="off">
        <div><label class="f">Collection</label><select class="select" name="collection">${opts(COLLECTIONS, S.gcol)}</select></div>
        <div><label class="f">Label (optional)</label><input class="input" name="tag" maxlength="60" placeholder="Example: Cafe Night" /></div>
        <div class="full"><label class="f">Caption for all (optional)</label><input class="input" name="caption" maxlength="140" placeholder="Example: Movie night at Jiang" /></div>
        <div class="full"><label class="f">Photos</label>
          <input class="input" type="file" id="upfiles" accept="image/png,image/jpeg,image/webp" multiple ${ready ? "" : "disabled"} />
          <div class="hint">${ready ? "JPG, PNG or WebP, up to 10 MB each, 30 at a time. No need to resize first." : "Uploading is off until the Cloudinary preset is saved on this page. You can paste links below instead."}</div>
        </div>
        <div class="full"><label class="f">Or paste image links</label><textarea class="textarea" name="links" placeholder="One https link per line, for example a Cloudinary link" maxlength="6000"></textarea></div>
        <div class="full"><div id="upstatus" class="up-status"></div></div>
      </form>`;
    const foot = `<span class="spacer"></span><button class="btn light" type="button" data-close>Close</button><button class="btn" type="submit" form="upform" id="upgo">Add to gallery</button>`;
    const m = openModal("Upload photos", body, foot, true);

    $("#upform", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const files = Array.from($("#upfiles", m).files || []);
      const links = String(fd.get("links") || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (!files.length && !links.length) return toast("Choose photos or paste a link first", true);
      if (files.length > 30) return toast("Please upload 30 photos or fewer at a time", true);
      const badLink = links.find((l) => !httpsUrl(l));
      if (badLink) return toast("This link does not start with https: " + badLink.slice(0, 60), true);
      for (const f of files) {
        if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return toast(f.name + " is not a JPG, PNG or WebP", true);
        if (f.size > 10 * 1024 * 1024) return toast(f.name + " is over 10 MB", true);
      }
      const collection = fd.get("collection");
      const tag = String(fd.get("tag") || "").trim() || null;
      const caption = String(fd.get("caption") || "").trim() || null;
      const btn = $("#upgo", m);
      btn.disabled = true;
      const box = $("#upstatus", m);
      const say = (t, cls) => (box.innerHTML += `<div class="${cls || ""}">${esc(t)}</div>`);
      const done = [];
      const base = Math.max(0, ...S.photos.filter((p) => p.collection === collection).map((p) => p.sort_order)) + 10;

      for (const [i, f] of files.entries()) {
        say(`Uploading ${f.name} (${i + 1} of ${files.length})...`);
        try {
          const body = new FormData();
          body.append("file", f);
          body.append("upload_preset", S.settings.cloudinary_preset);
          body.append("folder", "the-social/" + collection);
          const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(S.settings.cloudinary_cloud)}/image/upload`, { method: "POST", body });
          const j = await res.json();
          if (!res.ok || !j.secure_url) throw new Error((j.error && j.error.message) || "Cloudinary refused the upload");
          done.push({ image_url: j.secure_url, alt_text: caption || f.name.replace(/\.[^.]+$/, "").slice(0, 120) });
        } catch (err) {
          say(f.name + ": " + (err.message || "failed"), "msg-error");
        }
      }
      links.forEach((l) => done.push({ image_url: httpsUrl(l), alt_text: caption }));

      if (!done.length) {
        btn.disabled = false;
        return toast("Nothing was added", true);
      }
      const rows = done.map((d, i) => ({ collection, tag, caption, alt_text: d.alt_text, image_url: d.image_url, sort_order: base + i * 10, published: true, created_by: S.me.email }));
      const { error } = await sb.from("gallery_photos").insert(rows);
      btn.disabled = false;
      if (error) return toast(error.message, true);
      toast(`${rows.length} photo${rows.length === 1 ? "" : "s"} added to ${COLLECTIONS[collection]}`);
      S.gcol = collection;
      closeModal();
      viewGallery();
    });
  }

  function openPhoto(id) {
    const p = S.photos.find((x) => x.id === id);
    if (!p) return;
    const body = `
      <div class="media-row" style="margin-bottom:16px"><div class="thumb wide" style="width:160px;height:120px"><img src="${esc(cl(p.image_url, 400))}" alt="" /></div></div>
      <form id="phform" class="form-grid" autocomplete="off">
        <div><label class="f">Collection</label><select class="select" name="collection">${opts(COLLECTIONS, p.collection)}</select></div>
        <div><label class="f">Label</label><input class="input" name="tag" maxlength="60" value="${esc(p.tag)}" /></div>
        <div class="full"><label class="f">Caption</label><input class="input" name="caption" maxlength="140" value="${esc(p.caption)}" /></div>
        <div class="full"><label class="f">Description for screen readers</label><input class="input" name="alt_text" maxlength="160" value="${esc(p.alt_text)}" /></div>
        <div><label class="f">Display order</label><input class="input" type="number" min="0" max="99999" step="1" name="sort_order" value="${esc(p.sort_order)}" /><div class="hint">Lower numbers show first.</div></div>
        <div style="align-self:end"><label class="check"><input type="checkbox" name="published" ${p.published ? "checked" : ""} /> Show on website</label></div>
      </form>`;
    const foot = `<button class="btn danger" type="button" id="phdel">Delete</button><span class="spacer"></span><button class="btn light" type="button" data-close>Cancel</button><button class="btn" type="submit" form="phform" id="phsave">Save changes</button>`;
    const m = openModal("Edit photo", body, foot);
    $("#phform", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const row = {
        collection: fd.get("collection"),
        tag: String(fd.get("tag") || "").trim() || null,
        caption: String(fd.get("caption") || "").trim() || null,
        alt_text: String(fd.get("alt_text") || "").trim() || null,
        sort_order: Math.min(99999, Math.max(0, Math.round(num(fd.get("sort_order"))))),
        published: fd.get("published") === "on",
      };
      const { error } = await sb.from("gallery_photos").update(row).eq("id", p.id);
      if (error) return toast(error.message, true);
      toast("Photo updated");
      S.gcol = row.collection;
      closeModal();
      viewGallery();
    });
    $("#phdel", m).onclick = async () => {
      if (!confirm("Remove this photo from the gallery? The file stays in your Cloudinary account.")) return;
      const { error } = await sb.from("gallery_photos").delete().eq("id", p.id);
      if (error) return toast(error.message, true);
      toast("Photo removed");
      closeModal();
      viewGallery();
    };
  }

  // =====================================================
  // INVOICES / DOCUMENTS
  // =====================================================
  async function viewDocuments() {
    const root = $("#view");
    root.innerHTML = loading();
    const { data, error } = await sb.from("ts_documents").select("*").order("created_at", { ascending: false });
    if (error) return fail(root, error);
    S.docs = data;

    $("#top-actions").innerHTML = '<button class="btn" id="add-doc" type="button">New document</button>';
    $("#add-doc").onclick = () => openDoc(null);

    root.innerHTML = `
      <div class="toolbar">
        <input class="input" id="dq" type="search" placeholder="Search number or client..." value="${esc(S.df.q)}" />
        <select class="select" id="dtype"><option value="">All types</option>${opts(DOC_TYPES, S.df.type)}</select>
        <select class="select" id="dstatus"><option value="">All statuses</option>${opts({ ...DOC_STATUS, overdue: "Overdue" }, S.df.status)}</select>
        <span class="grow"></span>
        <button class="btn light small" id="dcsv" type="button">Export CSV</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Number</th><th>Client</th><th>Issued</th><th>Due</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
        <tbody id="dbody"></tbody>
      </table></div>`;
    $("#dq").oninput = (e) => { S.df.q = e.target.value; drawDocs(); };
    $("#dtype").onchange = (e) => { S.df.type = e.target.value; drawDocs(); };
    $("#dstatus").onchange = (e) => { S.df.status = e.target.value; drawDocs(); };
    $("#dcsv").onclick = () => {
      const rows = filteredDocs().map((d) => [d.number, DOC_TYPES[d.doc_type], d.client_name, d.issued_date, d.due_date, d.subtotal, d.vat_amount, d.total, DOC_STATUS[d.status]]);
      downloadCsv(`documents-${today()}.csv`, ["Number", "Type", "Client", "Issued", "Due", "Subtotal", "VAT", "Total", "Status"], rows);
    };
    drawDocs();
  }

  const isOverdue = (d) => d.doc_type === "invoice" && d.status === "sent" && d.due_date && d.due_date < today();

  function filteredDocs() {
    const f = S.df;
    const q = f.q.trim().toLowerCase();
    return S.docs.filter(
      (d) =>
        (!f.type || d.doc_type === f.type) &&
        (!f.status || (f.status === "overdue" ? isOverdue(d) : d.status === f.status)) &&
        (!q || (d.number + " " + d.client_name).toLowerCase().includes(q))
    );
  }

  function drawDocs() {
    const rows = filteredDocs();
    $("#dbody").innerHTML = rows.length
      ? rows
          .map(
            (d) => `<tr data-id="${esc(d.id)}">
          <td><strong>${esc(d.number)}</strong><div class="sub">${esc(DOC_TYPES[d.doc_type] || d.doc_type)}${d.is_official ? " - official" : ""}</div></td>
          <td>${esc(d.client_name)}</td>
          <td>${fmtDate(d.issued_date)}</td>
          <td class="${isOverdue(d) ? "overdue" : ""}">${fmtDate(d.due_date)}</td>
          <td class="num">${money(d.total)}</td>
          <td><select class="select st" data-id="${esc(d.id)}" style="width:auto;padding:4px 8px">${opts(DOC_STATUS, d.status)}</select>${isOverdue(d) ? ' <span class="badge s-overdue">Overdue</span>' : ""}</td>
          <td><div class="actions"><button class="btn light small" data-act="view" type="button">View</button>${d.status === "draft" ? '<button class="btn light small" data-act="edit" type="button">Edit</button>' : ""}${isAdmin() ? '<button class="btn danger small" data-act="del" type="button">Delete</button>' : ""}</div></td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="7"><div class="empty">${S.docs.length ? "No documents match these filters." : "No documents yet. Create your first quotation or invoice."}</div></td></tr>`;

    $$("#dbody select.st").forEach((sel) =>
      sel.addEventListener("change", async () => {
        const { error } = await sb.from("ts_documents").update({ status: sel.value }).eq("id", sel.dataset.id);
        if (error) {
          toast(error.message, true);
          return viewDocuments();
        }
        const d = S.docs.find((x) => x.id === sel.dataset.id);
        if (d) d.status = sel.value;
        toast("Status updated");
        drawDocs();
      })
    );
    $$("#dbody button[data-act]").forEach((b) =>
      b.addEventListener("click", async () => {
        const id = b.closest("tr").dataset.id;
        const d = S.docs.find((x) => x.id === id);
        if (b.dataset.act === "view") previewDoc(d);
        if (b.dataset.act === "edit") openDoc(d);
        if (b.dataset.act === "del") {
          if (!confirm(`Delete ${d.number}? This cannot be undone.`)) return;
          const { error } = await sb.from("ts_documents").delete().eq("id", id);
          if (error) return toast(error.message, true);
          toast("Document deleted");
          viewDocuments();
        }
      })
    );
  }

  const itemRow = (it = {}) => `<div class="item-row">
    <input class="input i-desc" placeholder="Description" maxlength="300" value="${esc(it.description ?? it.desc ?? it.name ?? "")}" />
    <input class="input i-qty" type="number" min="0" step="any" value="${esc(it.qty ?? it.quantity ?? 1)}" />
    <input class="input i-price" type="number" min="0" step="any" placeholder="0.00" value="${esc(it.unit_price ?? it.price ?? "")}" />
    <span class="i-amt">$0.00</span>
    <button type="button" class="btn-ghost i-del" aria-label="Remove line">&times;</button></div>`;

  function readItems(root) {
    return $$(".item-row", root)
      .map((r) => {
        const qty = num($(".i-qty", r).value);
        const unit = num($(".i-price", r).value);
        return { description: $(".i-desc", r).value.trim(), qty, unit_price: unit, amount: round2(qty * unit) };
      })
      .filter((i) => i.description);
  }

  function recalc(root) {
    let sub = 0;
    $$(".item-row", root).forEach((r) => {
      const a = num($(".i-qty", r).value) * num($(".i-price", r).value);
      $(".i-amt", r).textContent = money(a);
      sub += a;
    });
    sub = round2(sub);
    const rate = Math.min(100, Math.max(0, num($("[name=vat_rate]", root).value)));
    const vat = round2((sub * rate) / 100);
    $("#t-sub", root).textContent = money(sub);
    $("#t-vat", root).textContent = money(vat);
    $("#t-total", root).textContent = money(sub + vat);
    return { sub, vat, total: round2(sub + vat), rate };
  }

  function openDoc(d) {
    const isNew = !d;
    const v = d || { doc_type: "invoice", issued_date: today(), due_date: "", client_name: "", client_address: "", client_tin: "", client_reg_no: "", vat_rate: 0, notes: "", is_official: false, items: [], payment: {} };
    const items = Array.isArray(v.items) && v.items.length ? v.items : [{}];
    const body = `<form id="dform" autocomplete="off">
      <div class="form-grid">
        <div><label class="f">Type</label><select class="select" name="doc_type" ${isNew ? "" : "disabled"}>${opts(DOC_TYPES, v.doc_type)}</select></div>
        <div><label class="f">Number</label><input class="input" value="${isNew ? "Assigned on save" : esc(d.number)}" disabled /></div>
        <div class="full"><label class="f">Client name</label><input class="input" name="client_name" required maxlength="200" value="${esc(v.client_name)}" /></div>
        <div class="full"><label class="f">Client address</label><textarea class="textarea" name="client_address" maxlength="500" style="min-height:60px">${esc(v.client_address)}</textarea></div>
        <div><label class="f">Client TIN</label><input class="input" name="client_tin" maxlength="60" value="${esc(v.client_tin)}" /></div>
        <div><label class="f">Client registration no.</label><input class="input" name="client_reg_no" maxlength="60" value="${esc(v.client_reg_no)}" /></div>
        <div><label class="f">Issue date</label><input class="input" type="date" name="issued_date" required value="${esc(v.issued_date)}" /></div>
        <div><label class="f">Due date</label><input class="input" type="date" name="due_date" value="${esc(v.due_date)}" /></div>
      </div>
      <h3 style="margin:24px 0 10px;font-size:15px">Line items</h3>
      <div class="item-head"><span>Description</span><span>Qty</span><span>Unit price</span><span style="text-align:right">Amount</span><span></span></div>
      <div id="items">${items.map(itemRow).join("")}</div>
      <button type="button" class="btn light small" id="add-item">Add line</button>
      <div class="totals">
        <div><span>Subtotal</span><span id="t-sub">$0.00</span></div>
        <div><span>VAT (%) <input class="input" type="number" min="0" max="100" step="any" name="vat_rate" value="${esc(v.vat_rate)}" style="width:70px;padding:3px 6px;display:inline-block" /></span><span id="t-vat">$0.00</span></div>
        <div class="grand"><span>Total</span><span id="t-total">$0.00</span></div>
      </div>
      <div class="form-grid" style="margin-top:20px">
        <div class="full"><label class="f">Payment instructions</label><textarea class="textarea" name="payment_instructions" maxlength="1000" placeholder="Bank, account name, how to pay...">${esc((v.payment && v.payment.instructions) || "")}</textarea></div>
        <div class="full"><label class="f">Notes</label><textarea class="textarea" name="notes" maxlength="2000" style="min-height:60px">${esc(v.notes)}</textarea></div>
        <div class="full checks"><label><input type="checkbox" name="is_official" ${v.is_official ? "checked" : ""} /> Official tax document</label></div>
      </div></form>`;
    const foot = `<span class="spacer"></span><button class="btn light" type="button" data-close>Cancel</button><button class="btn" type="submit" form="dform" id="dsave">${isNew ? "Create draft" : "Save changes"}</button>`;
    const m = openModal(isNew ? "New document" : "Edit " + d.number, body, foot, true);
    const form = $("#dform", m);

    const refresh = () => recalc(form);
    form.addEventListener("input", refresh);
    $("#add-item", m).onclick = () => {
      $("#items", m).insertAdjacentHTML("beforeend", itemRow());
      refresh();
    };
    $("#items", m).addEventListener("click", (e) => {
      if (!e.target.closest(".i-del")) return;
      const rows = $$(".item-row", m);
      if (rows.length > 1) e.target.closest(".item-row").remove();
      else $$("input", rows[0]).forEach((i) => (i.value = i.classList.contains("i-qty") ? 1 : ""));
      refresh();
    });
    refresh();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const lines = readItems(form);
      if (!lines.length) return toast("Add at least one line item", true);
      const t = recalc(form);
      const row = {
        client_name: String(fd.get("client_name") || "").trim(),
        client_address: String(fd.get("client_address") || "").trim() || null,
        client_tin: String(fd.get("client_tin") || "").trim() || null,
        client_reg_no: String(fd.get("client_reg_no") || "").trim() || null,
        issued_date: fd.get("issued_date"),
        due_date: fd.get("due_date") || null,
        items: lines,
        vat_rate: t.rate,
        subtotal: t.sub,
        vat_amount: t.vat,
        total: t.total,
        notes: String(fd.get("notes") || "").trim() || null,
        payment: { instructions: String(fd.get("payment_instructions") || "").trim() },
        is_official: fd.get("is_official") === "on",
      };
      if (!row.client_name) return toast("Client name is required", true);
      const btn = $("#dsave", m);
      btn.disabled = true;
      let res;
      if (isNew) {
        const type = fd.get("doc_type");
        const prefix = (type === "quotation" ? "QUO" : "INV") + "-" + new Date().getFullYear() + "-";
        const { data: number, error: nerr } = await sb.rpc("ts_next_doc_number", { p_prefix: prefix });
        if (nerr) {
          btn.disabled = false;
          return toast(nerr.message, true);
        }
        res = await sb.from("ts_documents").insert({ ...row, number, doc_type: type, status: "draft" });
      } else {
        res = await sb.from("ts_documents").update(row).eq("id", d.id);
      }
      btn.disabled = false;
      if (res.error) return toast(res.error.message, true);
      toast(isNew ? "Draft created" : "Document saved");
      closeModal();
      viewDocuments();
    });
  }

  function sheetHtml(d) {
    const items = (Array.isArray(d.items) ? d.items : [])
      .map((i) => {
        const q = num(i.qty ?? i.quantity ?? 1);
        const u = num(i.unit_price ?? i.price ?? 0);
        return `<tr><td>${esc(i.description ?? i.desc ?? i.name ?? "")}</td><td class="num">${esc(q)}</td><td class="num">${money(u)}</td><td class="num">${money(i.amount ?? q * u)}</td></tr>`;
      })
      .join("");
    const pay = d.payment && d.payment.instructions ? `<p><strong>Payment</strong>\n${esc(d.payment.instructions)}</p>` : "";
    return `<div id="print-sheet" class="sheet">
      <div class="sh-top">
        <div><div class="brand">The Social Phnom Penh</div><div class="sub" style="margin-top:6px">Phnom Penh, Cambodia</div></div>
        <div><div class="doc-title">${esc(DOC_TYPES[d.doc_type] || d.doc_type)}</div><div class="doc-meta">${esc(d.number)}<br />Issued ${fmtDate(d.issued_date)}${d.due_date ? "<br />Due " + fmtDate(d.due_date) : ""}${d.is_official ? '<br /><span class="tag">Official</span>' : ""}</div></div>
      </div>
      <div><div class="brand" style="font-size:11px;color:var(--muted)">Bill to</div><strong>${esc(d.client_name)}</strong>
        ${d.client_address ? `<div style="white-space:pre-wrap">${esc(d.client_address)}</div>` : ""}
        ${d.client_tin ? `<div class="sub">TIN: ${esc(d.client_tin)}</div>` : ""}
        ${d.client_reg_no ? `<div class="sub">Reg. no: ${esc(d.client_reg_no)}</div>` : ""}</div>
      <table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>${items}</tbody></table>
      <div class="totals"><div><span>Subtotal</span><span>${money(d.subtotal)}</span></div>${Number(d.vat_rate) ? `<div><span>VAT (${esc(d.vat_rate)}%)</span><span>${money(d.vat_amount)}</span></div>` : ""}<div class="grand"><span>Total</span><span>${money(d.total)}</span></div></div>
      <div class="foot">${pay}${d.notes ? `<p><strong>Notes</strong>\n${esc(d.notes)}</p>` : ""}</div>
    </div>`;
  }

  function previewDoc(d) {
    const m = openModal(d.number, sheetHtml(d), '<span class="spacer"></span><button class="btn light" type="button" data-close>Close</button><button class="btn" type="button" id="print-btn">Print / Save as PDF</button>', true);
    $("#print-btn", m).onclick = () => window.print();
  }

  // =====================================================
  // TEAM ACCESS (admins only)
  // =====================================================
  async function viewTeam() {
    const root = $("#view");
    root.innerHTML = loading();
    const { data, error } = await sb.from("admin_users").select("*").order("created_at", { ascending: true });
    if (error) return fail(root, error);
    S.team = data;
    $("#top-actions").innerHTML = '<button class="btn" id="add-member" type="button">Add team member</button>';
    $("#add-member").onclick = () => openMember(null);

    root.innerHTML = `<p class="sub" style="margin-top:0;color:var(--muted)">Only Google accounts listed here can sign in. Admins see every module. Team members only see the modules ticked for them.</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Person</th><th>Role</th><th>Modules</th><th>Status</th></tr></thead>
        <tbody>${data
          .map(
            (u) => `<tr class="click" data-email="${esc(u.email)}">
          <td><strong>${esc(u.full_name || u.email)}</strong><div class="sub">${esc(u.email)}</div></td>
          <td style="text-transform:capitalize">${esc(u.role)}</td>
          <td>${u.role === "admin" ? "All" : esc((u.modules || []).map((k) => (MODULES.find((m) => m.key === k) || {}).label || k).join(", ") || "None")}</td>
          <td><span class="badge ${u.active ? "s-won" : "s-draft"}">${u.active ? "Active" : "Disabled"}</span></td></tr>`
          )
          .join("")}</tbody></table></div>`;
    $$("tr.click", root).forEach((tr) => tr.addEventListener("click", () => openMember(tr.dataset.email)));
  }

  function openMember(email) {
    const u = email ? S.team.find((x) => x.email === email) : null;
    const v = u || { email: "", full_name: "", role: "team", modules: ["partners", "documents"], active: true };
    const body = `<form id="mform" class="form-grid" autocomplete="off">
      <div class="full"><label class="f">Google account email</label><input class="input" type="email" name="email" required maxlength="160" value="${esc(v.email)}" ${u ? "readonly" : ""} /><div class="hint">They must sign in with exactly this Google account.</div></div>
      <div class="full"><label class="f">Name</label><input class="input" name="full_name" maxlength="120" value="${esc(v.full_name)}" /></div>
      <div><label class="f">Role</label><select class="select" name="role"><option value="team"${v.role === "team" ? " selected" : ""}>Team member</option><option value="admin"${v.role === "admin" ? " selected" : ""}>Admin</option></select></div>
      <div><label class="f">Access</label><select class="select" name="active"><option value="true"${v.active ? " selected" : ""}>Active</option><option value="false"${v.active ? "" : " selected"}>Disabled</option></select></div>
      <div class="full"><label class="f">Modules (team members)</label><div class="checks">${MODULES.map((m) => `<label><input type="checkbox" name="mod" value="${m.key}" ${(v.modules || []).includes(m.key) ? "checked" : ""} /> ${esc(m.label)}</label>`).join("")}</div><div class="hint">Admins always see every module.</div></div>
    </form>`;
    const foot = `${u && u.email !== S.me.email ? '<button class="btn danger" type="button" id="mdel">Remove</button>' : ""}<span class="spacer"></span><button class="btn light" type="button" data-close>Cancel</button><button class="btn" type="submit" form="mform" id="msave">${u ? "Save" : "Add"}</button>`;
    const m = openModal(u ? "Edit team member" : "Add team member", body, foot);

    const activeAdmins = () => S.team.filter((x) => x.role === "admin" && x.active);

    $("#mform", m).addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const row = {
        email: String(fd.get("email") || "").trim().toLowerCase(),
        full_name: String(fd.get("full_name") || "").trim() || null,
        role: fd.get("role"),
        active: fd.get("active") === "true",
        modules: fd.getAll("mod"),
      };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) return toast("Enter a valid email", true);
      if (!u && S.team.some((x) => x.email === row.email)) return toast("That person is already on the list", true);
      // never lock the team out: keep at least one active admin
      if (u && u.role === "admin" && u.active && (row.role !== "admin" || !row.active) && activeAdmins().length <= 1)
        return toast("There must be at least one active admin", true);
      if (u && u.email === S.me.email && (row.role !== "admin" || !row.active)) return toast("You cannot remove your own admin access", true);
      const btn = $("#msave", m);
      btn.disabled = true;
      const res = u ? await sb.from("admin_users").update(row).eq("email", u.email) : await sb.from("admin_users").insert(row);
      btn.disabled = false;
      if (res.error) return toast(res.error.message, true);
      toast(u ? "Saved" : "Team member added");
      closeModal();
      viewTeam();
    });

    const del = $("#mdel", m);
    if (del)
      del.onclick = async () => {
        if (u.role === "admin" && u.active && activeAdmins().length <= 1) return toast("There must be at least one active admin", true);
        if (!confirm(`Remove ${u.email}? They will no longer be able to sign in.`)) return;
        const { error } = await sb.from("admin_users").delete().eq("email", u.email);
        if (error) return toast(error.message, true);
        toast("Removed");
        closeModal();
        viewTeam();
      };
  }

  // ---------- wire up ----------
  $("#google-btn").addEventListener("click", signIn);
  $("#signout").addEventListener("click", signOut);
  $("#denied-out").addEventListener("click", signOut);
  $("#menu-btn").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  window.addEventListener("hashchange", () => {
    if (S.me) go((location.hash || "").slice(1) || "overview");
  });

  boot();
})();
