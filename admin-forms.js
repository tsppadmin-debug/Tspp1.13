/* Admin: Forms module (list, builder, responses). Registers itself through window.__admin. */
(function () {
  "use strict";

  function start() {
    const A = window.__admin;
    if (!A || !window.FB) return;
    const { sb, S, $, esc, toast, openModal, closeModal, fmtStamp, ask, toastUndo } = A;

    const STATUS = { draft: "Draft", published: "Live", closed: "Closed" };
    const STATUS_CLS = { draft: "s-draft", published: "s-won", closed: "s-lost" };
    const SWATCHES = ["#1a1a1a", "#2e5bff", "#00a3ff", "#1f7a4d", "#d9480f", "#b0306b", "#7048e8"];
    const OPT_TYPES = ["choice", "multi", "dropdown"];
    const PH_TYPES = ["short", "long", "email", "phone", "number"];
    const MAX_FIELDS = 80;

    // ---------- tiny DOM helper ----------
    function h(tag, attrs, ...kids) {
      const n = document.createElement(tag);
      if (attrs) {
        for (const k in attrs) {
          const v = attrs[k];
          if (v == null || v === false) continue;
          if (k === "class") n.className = v;
          else if (k === "text") n.textContent = v;
          else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
          else if (k === "value") n.value = v;
          else if (v === true) n.setAttribute(k, "");
          else n.setAttribute(k, v);
        }
      }
      kids.flat().forEach((c) => {
        if (c == null || c === false) return;
        n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
      return n;
    }

    const slugify = (t) =>
      String(t || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 50);
    const formUrl = (slug) => location.origin + "/f/" + slug;
    const clone = (o) => JSON.parse(JSON.stringify(o));

    async function copyText(t) {
      try {
        await navigator.clipboard.writeText(t);
        toast("Link copied");
      } catch (e) {
        window.prompt("Copy this link", t);
      }
    }

    // ---------- styles ----------
    const css = document.createElement("style");
    css.textContent = `
      .fe-tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:-4px 0 18px; overflow-x:auto; }
      .fe-tabs button { background:none; border:0; padding:10px 14px; font:inherit; font-weight:500; color:var(--muted); cursor:pointer; border-bottom:2px solid transparent; white-space:nowrap; }
      .fe-tabs button.on { color:var(--ink); border-bottom-color:var(--ink); }
      .fe-wrap { max-width:760px; margin:0 auto; }
      .fe-head { display:grid; gap:10px; }
      .fe-title { font-size:24px; font-weight:600; border:0; border-bottom:1px solid var(--line); background:transparent; padding:8px 0; width:100%; font-family:inherit; color:inherit; }
      .fe-title:focus, .fe-q-label:focus { outline:none; border-bottom-color:var(--ink); }
      .fe-q { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-top:12px; cursor:pointer; }
      .fe-q.on { cursor:default; border-left:4px solid var(--accent-deep); box-shadow:0 4px 16px rgba(0,0,0,.06); }
      .fe-q .fe-sum { display:flex; justify-content:space-between; gap:10px; align-items:baseline; }
      .fe-q .fe-sum b { font-weight:500; overflow:hidden; text-overflow:ellipsis; }
      .fe-q .fe-sum span { font-size:12px; color:var(--muted); white-space:nowrap; }
      .fe-row { display:grid; grid-template-columns:1fr 200px; gap:12px; margin-bottom:12px; }
      .fe-q-label { font-size:17px; border:0; border-bottom:1px solid var(--line); background:var(--soft); padding:12px; border-radius:8px 8px 0 0; width:100%; font-family:inherit; color:inherit; }
      .fe-foot { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:flex-end; margin-top:14px; padding-top:12px; border-top:1px solid var(--line); }
      .fe-foot .grow { flex:1; }
      .fe-switch { display:inline-flex; gap:8px; align-items:center; font-size:14px; cursor:pointer; }
      .fe-add { display:flex; gap:8px; flex-wrap:wrap; margin-top:16px; }
      .fe-save { font-size:13px; color:var(--muted); margin-right:6px; }
      .fe-save.err { color:var(--danger); }
      .fe-frame { margin:0 auto; border:1px solid var(--line); border-radius:22px; overflow:hidden; background:#fff; }
      .fe-frame.phone { max-width:390px; }
      .fe-frame.desk { max-width:100%; }
      .fe-frame-inner { max-height:72vh; overflow:auto; }
      .fe-sw { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
      .fe-sw button { width:30px; height:30px; border-radius:50%; border:2px solid #fff; box-shadow:0 0 0 1px var(--line); cursor:pointer; }
      .fe-sw button.on { box-shadow:0 0 0 2px var(--ink); }
      .fe-link { display:flex; gap:8px; flex-wrap:wrap; align-items:center; background:var(--soft); border-radius:10px; padding:10px 12px; }
      .fe-link code { flex:1; min-width:180px; overflow-wrap:anywhere; font-size:13px; }
      .fe-bar { height:10px; background:var(--soft); border-radius:99px; overflow:hidden; }
      .fe-bar i { display:block; height:100%; background:var(--accent-deep); }
      .fe-sumrow { display:grid; grid-template-columns:minmax(0,1fr) 54px; gap:10px; align-items:center; margin:8px 0; font-size:14px; }
      .fe-sumrow .t { grid-column:1/-1; display:flex; justify-content:space-between; gap:10px; }
      .fe-txt { padding:8px 10px; background:var(--soft); border-radius:8px; margin:6px 0; font-size:14px; white-space:pre-wrap; overflow-wrap:anywhere; }
      .fe-unread td:first-child { font-weight:600; }
      .fe-dot { display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--accent-deep); margin-right:8px; }
      .fe-ans { margin:0 0 14px; }
      .fe-ans dt { font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:2px; }
      .fe-ans dd { margin:0; white-space:pre-wrap; overflow-wrap:anywhere; }
      @media (max-width:640px) { .fe-row { grid-template-columns:1fr; } .fe-title { font-size:20px; } }
    `;
    document.head.appendChild(css);

    // ---------- templates ----------
    const f = (type, label, extra) => Object.assign({ id: FB.uid(), type, label, help: "", required: false }, extra || {});
    const TEMPLATES = {
      blank: { name: "Blank form", slug: "", description: "", fields: () => [f("short", "Untitled question")] },
      membership: {
        name: "Membership application",
        slug: "membership",
        description: "Join The Social Phnom Penh community. It takes about a minute.",
        thank: "Thanks for applying. We will be in touch soon.",
        fields: () => [
          f("short", "Full name", { required: true }),
          f("date", "Birthday"),
          f("email", "Email", { required: true }),
          f("phone", "Phone number", { required: true }),
          f("short", "Occupation"),
          f("short", "Social media link", { help: "Instagram, Facebook, TikTok or LinkedIn" }),
          f("dropdown", "How did you hear about us?", { options: ["Social Media", "Word of Mouth", "At an Event", "Press or Article", "Other"] }),
        ],
      },
      event: {
        name: "Event registration",
        slug: "",
        description: "Save your spot. Fill in the details below.",
        thank: "You are registered. See you there.",
        fields: () => [
          f("short", "Full name", { required: true }),
          f("email", "Email", { required: true }),
          f("phone", "Phone number", { required: true }),
          f("choice", "How many people are you bringing?", { required: true, options: ["Just me", "1 guest", "2 guests", "3 or more"] }),
          f("multi", "Anything we should know?", { options: ["Vegetarian", "Allergies", "Need accessibility support"] }),
          f("long", "Notes", { placeholder: "Optional" }),
        ],
      },
      partner: {
        name: "Partner inquiry",
        slug: "partner",
        description: "Tell us about your brand and what you have in mind.",
        thank: "Thanks for reaching out. Our team will reply within a few days.",
        fields: () => [
          f("short", "Brand or company name", { required: true }),
          f("short", "Your name", { required: true }),
          f("email", "Email", { required: true }),
          f("phone", "Phone or Telegram"),
          f("choice", "What are you interested in?", { required: true, options: ["Sponsoring an event", "Hosting at our venue", "Media or content", "Product placement", "Something else"] }),
          f("long", "Tell us more", { required: true }),
        ],
      },
      feedback: {
        name: "Event feedback",
        slug: "",
        description: "Two minutes. It helps us make the next one better.",
        thank: "Thanks for the feedback.",
        fields: () => [
          f("scale", "How was the event overall?", { required: true, min: 1, max: 5, lowLabel: "Not great", highLabel: "Loved it" }),
          f("scale", "Would you recommend it to a friend?", { required: true, min: 1, max: 5, lowLabel: "No", highLabel: "Definitely" }),
          f("multi", "What did you enjoy most?", { options: ["Music", "Crowd", "Venue", "Food and drinks", "Activities"] }),
          f("long", "What should we change?"),
          f("email", "Email", { help: "Only if you want a reply" }),
        ],
      },
    };

    // =====================================================
    // LIST
    // =====================================================
    async function viewList() {
      const root = $("#view");
      root.innerHTML = A.loading();
      $("#top-actions").appendChild(h("button", { class: "btn", type: "button", onclick: openNew }, "New form"));
      const { data, error } = await sb
        .from("forms")
        .select("id,slug,title,status,updated_at,closes_at,form_responses(count)")
        .order("updated_at", { ascending: false });
      if (error) return A.fail(root, error);
      root.textContent = "";
      if (!data.length) {
        root.appendChild(
          h("div", { class: "card" }, h("h2", null, "No forms yet"), h("p", { class: "hint" }, "Build your first form, share the link, and answers land here. Nothing to install and no Google account needed for the people filling it in."), h("button", { class: "btn", type: "button", onclick: openNew }, "Create a form"))
        );
        return;
      }
      const wrap = h("div", { class: "table-wrap card" });
      const tb = h("tbody");
      data.forEach((r) => {
        const n = (r.form_responses && r.form_responses[0] && r.form_responses[0].count) || 0;
        const tr = h(
          "tr",
          { class: "click" },
          h("td", null, h("strong", null, r.title), h("div", { class: "sub" }, "/f/" + r.slug)),
          h("td", null, h("span", { class: "badge " + STATUS_CLS[r.status] }, STATUS[r.status] || r.status)),
          h("td", { class: "num" }, String(n)),
          h("td", null, fmtStamp(r.updated_at)),
          h(
            "td",
            { class: "actions" },
            h("button", { class: "btn light small", type: "button", onclick: (e) => { e.stopPropagation(); copyText(formUrl(r.slug)); } }, "Copy link"),
            " ",
            h("button", { class: "btn light small", type: "button", onclick: (e) => { e.stopPropagation(); location.hash = "forms/r/" + r.id; } }, "Responses"),
            " ",
            h("button", { class: "btn light small", type: "button", onclick: (e) => { e.stopPropagation(); duplicate(r.id); } }, "Duplicate"),
            " ",
            h("button", { class: "btn danger small", type: "button", onclick: (e) => { e.stopPropagation(); removeForm(r, n); } }, "Delete")
          )
        );
        tr.addEventListener("click", () => (location.hash = "forms/e/" + r.id));
        tb.appendChild(tr);
      });
      wrap.appendChild(
        h("table", null, h("thead", null, h("tr", null, h("th", null, "Form"), h("th", null, "Status"), h("th", { class: "num" }, "Responses"), h("th", null, "Updated"), h("th"))), tb)
      );
      root.appendChild(wrap);
    }

    function openNew() {
      const body = h("div");
      body.appendChild(h("p", { class: "hint" }, "Pick a starting point. You can change everything afterwards."));
      const grid = h("div", { style: "display:grid;gap:10px;margin-top:10px" });
      Object.entries(TEMPLATES).forEach(([k, t]) => {
        grid.appendChild(
          h(
            "button",
            { class: "btn light", type: "button", style: "justify-content:flex-start;text-align:left;padding:14px 16px", onclick: () => createFrom(k) },
            h("span", null, h("strong", null, t.name), h("span", { class: "hint", style: "display:block;font-weight:400" }, t.description || "Start from one empty question"))
          )
        );
      });
      body.appendChild(grid);
      const m = openModal("New form", "", "");
      m.querySelector(".modal-body").appendChild(body);
    }

    async function freeSlug(base) {
      base = slugify(base) || "form";
      if (base.length < 2) base = base + "-form";
      let slug = base;
      for (let i = 0; i < 6; i++) {
        const { data } = await sb.from("forms").select("id").eq("slug", slug).maybeSingle();
        if (!data) return slug;
        slug = base.slice(0, 44) + "-" + Math.random().toString(36).slice(2, 6);
      }
      return slug;
    }

    async function createFrom(key) {
      const t = TEMPLATES[key];
      closeModal();
      const title = t.name === "Blank form" ? "Untitled form" : t.name;
      const row = {
        slug: await freeSlug(t.slug || title),
        title,
        description: t.description || "",
        fields: t.fields(),
        status: "draft",
        theme: { accent: "#1a1a1a", mode: "light", cover_url: "" },
        thank_you: t.thank || "Thanks, we got your answers.",
        created_by: S.me.email,
      };
      const { data, error } = await sb.from("forms").insert(row).select("id").single();
      if (error) return toast(error.message, true);
      location.hash = "forms/e/" + data.id;
    }

    async function duplicate(id) {
      const { data, error } = await sb.from("forms").select("*").eq("id", id).single();
      if (error) return toast(error.message, true);
      const copy = {
        slug: await freeSlug(data.slug + "-copy"),
        title: data.title + " (copy)",
        description: data.description,
        fields: data.fields,
        status: "draft",
        theme: data.theme,
        thank_you: data.thank_you,
        closes_at: null,
        max_responses: data.max_responses,
        created_by: S.me.email,
      };
      const r = await sb.from("forms").insert(copy).select("id").single();
      if (r.error) return toast(r.error.message, true);
      toast("Duplicated as a draft");
      viewList();
    }

    async function removeForm(r, n) {
      const msg = n
        ? `Delete "${r.title}" and its ${n} response${n === 1 ? "" : "s"}? This cannot be undone. Export the responses first if you need them.`
        : `Delete "${r.title}"? This cannot be undone.`;
      if (!(await ask(msg))) return;
      const { error } = await sb.from("forms").delete().eq("id", r.id);
      if (error) return toast(error.message, true);
      toast("Form deleted");
      viewList();
    }

    // =====================================================
    // EDITOR
    // =====================================================
    let ED = null; // { form, tab, active, timer, saving, dirty, saveEl, device }

    async function viewEditor(id, tab) {
      const root = $("#view");
      root.innerHTML = A.loading();
      const { data, error } = await sb.from("forms").select("*").eq("id", id).maybeSingle();
      if (error) return A.fail(root, error);
      if (!data) return A.fail(root, "Form not found");
      data.fields = Array.isArray(data.fields) ? data.fields : [];
      data.theme = Object.assign({ accent: "#1a1a1a", mode: "light", cover_url: "" }, data.theme || {});
      data.payment = data.payment && typeof data.payment === "object" ? data.payment : {};
      ED = { form: data, tab: tab || "questions", active: data.fields[0] ? data.fields[0].id : null, timer: null, saving: false, dirty: false, device: "phone" };
      drawEditor();
    }

    function drawEditor() {
      const root = $("#view");
      const fm = ED.form;
      root.textContent = "";
      $("#top-actions").textContent = "";
      ED.saveEl = h("span", { class: "fe-save" }, "All changes saved");
      $("#top-actions").append(
        ED.saveEl,
        h("button", { class: "btn light small", type: "button", onclick: () => flushSave().then(() => (location.hash = "forms")) }, "All forms"),
        " ",
        h("button", { class: "btn small", type: "button", onclick: () => flushSave(true) }, "Save")
      );

      const tabs = h("div", { class: "fe-tabs" });
      [["questions", "Questions"], ["design", "Design and settings"], ["preview", "Preview"], ["share", "Share"]].forEach(([k, label]) =>
        tabs.appendChild(h("button", { type: "button", class: ED.tab === k ? "on" : "", onclick: () => { ED.tab = k; drawEditor(); } }, label))
      );
      tabs.appendChild(h("button", { type: "button", onclick: () => flushSave().then(() => (location.hash = "forms/r/" + fm.id)) }, "Responses"));
      const wrap = h("div", { class: "fe-wrap" }, tabs);
      root.appendChild(wrap);

      if (ED.tab === "questions") drawQuestionsTab(wrap);
      else if (ED.tab === "design") drawSettingsTab(wrap);
      else if (ED.tab === "preview") drawPreviewTab(wrap);
      else drawShareTab(wrap);
    }

    // ----- autosave -----
    function touch() {
      ED.dirty = true;
      setSave("Unsaved changes");
      clearTimeout(ED.timer);
      ED.timer = setTimeout(() => flushSave(), 1500);
    }
    function setSave(t, err) {
      if (!ED || !ED.saveEl) return;
      ED.saveEl.textContent = t;
      ED.saveEl.className = "fe-save" + (err ? " err" : "");
    }
    async function flushSave(loud) {
      if (!ED) return;
      clearTimeout(ED.timer);
      if (!ED.dirty) {
        if (loud) toast("Saved");
        return;
      }
      if (ED.saving) {
        ED.timer = setTimeout(() => flushSave(loud), 600);
        return;
      }
      const fm = ED.form;
      if (!/^[a-z0-9][a-z0-9-]{1,58}$/.test(fm.slug)) {
        setSave("Link name is not valid", true);
        if (loud) toast("Link name must be 2 to 59 characters: lowercase letters, numbers, hyphens", true);
        return;
      }
      ED.saving = true;
      ED.dirty = false;
      setSave("Saving");
      const row = {
        slug: fm.slug,
        title: (fm.title || "").trim() || "Untitled form",
        description: fm.description || "",
        fields: fm.fields,
        status: fm.status,
        theme: fm.theme,
        thank_you: fm.thank_you || "",
        payment: fm.payment || {},
        closes_at: fm.closes_at || null,
        max_responses: fm.max_responses || null,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("forms").update(row).eq("id", fm.id);
      ED.saving = false;
      if (error) {
        ED.dirty = true;
        const taken = error.code === "23505";
        setSave(taken ? "That link name is taken" : "Not saved", true);
        toast(taken ? "That link name is already used by another form" : error.message, true);
        return;
      }
      if (ED.dirty) {
        ED.timer = setTimeout(() => flushSave(), 800);
        setSave("Unsaved changes");
      } else {
        setSave("All changes saved");
        if (loud) toast("Saved");
      }
    }
    window.addEventListener("beforeunload", (e) => {
      if (ED && ED.dirty && location.hash.indexOf("forms/e/") >= 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    window.addEventListener("hashchange", () => {
      if (ED && ED.dirty) flushSave();
    });

    // ----- questions -----
    function drawQuestionsTab(wrap) {
      const fm = ED.form;
      const head = h("div", { class: "card fe-head" });
      const title = h("input", { class: "fe-title", value: fm.title, placeholder: "Form title", maxlength: "120", "aria-label": "Form title" });
      title.addEventListener("input", () => { fm.title = title.value; touch(); });
      const desc = h("textarea", { class: "textarea", rows: "2", placeholder: "Form description (optional)", "aria-label": "Form description" });
      desc.value = fm.description || "";
      desc.addEventListener("input", () => { fm.description = desc.value; touch(); });
      head.append(title, desc);
      wrap.appendChild(head);

      const list = h("div", { id: "fe-list" });
      wrap.appendChild(list);
      drawQuestions(list);

      const add = h("div", { class: "fe-add" });
      add.append(
        h("button", { class: "btn", type: "button", onclick: () => addField("short") }, "Add question"),
        h("button", { class: "btn light", type: "button", onclick: () => addField("section") }, "Add title and text")
      );
      wrap.appendChild(add);
    }

    function addField(type, after) {
      const fm = ED.form;
      if (fm.fields.length >= MAX_FIELDS) return toast("A form can hold up to " + MAX_FIELDS + " items", true);
      const nf = f(type, type === "section" ? "Section title" : "Untitled question");
      if (OPT_TYPES.indexOf(type) >= 0) nf.options = ["Option 1", "Option 2"];
      const i = after == null ? fm.fields.length : after + 1;
      fm.fields.splice(i, 0, nf);
      ED.active = nf.id;
      touch();
      drawQuestions($("#fe-list"));
      const el = $("#fe-list .fe-q.on");
      if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); const inp = el.querySelector(".fe-q-label"); if (inp) { inp.focus(); inp.select(); } }
    }

    function drawQuestions(list) {
      list.textContent = "";
      const fm = ED.form;
      if (!fm.fields.length) list.appendChild(h("div", { class: "empty" }, "No questions yet. Add the first one below."));
      fm.fields.forEach((fld, i) => list.appendChild(fld.id === ED.active ? activeCard(fld, i) : compactCard(fld, i)));
    }

    function compactCard(fld, i) {
      const label = fld.label || (fld.type === "section" ? "Section title" : "Untitled question");
      const c = h("div", { class: "fe-q", tabindex: "0", role: "button", "aria-label": "Edit " + label },
        h("div", { class: "fe-sum" }, h("b", null, label + (fld.required ? " *" : "")), h("span", null, FB.TYPES[fld.type] || fld.type)));
      const open = () => { ED.active = fld.id; drawQuestions($("#fe-list")); const el = $("#fe-list .fe-q.on"); if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
      c.addEventListener("click", open);
      c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
      return c;
    }

    function activeCard(fld, i) {
      const fm = ED.form;
      const card = h("div", { class: "fe-q on" });
      const isSection = fld.type === "section";

      const label = h("input", { class: "fe-q-label", value: fld.label || "", placeholder: isSection ? "Section title" : "Question", maxlength: "200", "aria-label": "Question text" });
      label.addEventListener("input", () => { fld.label = label.value; touch(); });

      const typeSel = h("select", { class: "select", "aria-label": "Question type" });
      Object.entries(FB.TYPES).forEach(([k, v]) => typeSel.appendChild(h("option", { value: k, selected: k === fld.type }, v)));
      typeSel.addEventListener("change", () => changeType(fld, typeSel.value));

      card.appendChild(h("div", { class: "fe-row" }, label, isSection ? h("span") : typeSel));
      if (isSection) card.lastChild.style.gridTemplateColumns = "1fr";

      const help = h("input", { class: "input", value: fld.help || "", placeholder: isSection ? "Text under the title (optional)" : "Help text (optional)", maxlength: "500", "aria-label": "Help text" });
      help.addEventListener("input", () => { fld.help = help.value; touch(); });
      card.appendChild(help);

      if (OPT_TYPES.indexOf(fld.type) >= 0) {
        const ta = h("textarea", { class: "textarea", rows: "5", style: "margin-top:12px", "aria-label": "Options, one per line", placeholder: "One option per line" });
        ta.value = (fld.options || []).join("\n");
        ta.addEventListener("input", () => {
          const seen = {};
          fld.options = ta.value.split("\n").map((s) => s.trim().slice(0, 200)).filter((s) => s && !seen[s] && (seen[s] = 1)).slice(0, 60);
          touch();
        });
        card.appendChild(ta);
        card.appendChild(h("p", { class: "hint" }, "One option per line. People see them in this order."));
      }

      if (fld.type === "scale") {
        const mn = h("select", { class: "select", "aria-label": "Scale start" }, [0, 1].map((n) => h("option", { value: n, selected: (fld.min == null ? 1 : fld.min) === n }, String(n))));
        const mx = h("select", { class: "select", "aria-label": "Scale end" }, [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => h("option", { value: n, selected: (fld.max == null ? 5 : fld.max) === n }, String(n))));
        mn.addEventListener("change", () => { fld.min = Number(mn.value); touch(); });
        mx.addEventListener("change", () => { fld.max = Number(mx.value); touch(); });
        fld.min = fld.min == null ? 1 : fld.min;
        fld.max = fld.max == null ? 5 : fld.max;
        const lo = h("input", { class: "input", value: fld.lowLabel || "", placeholder: "Label for the low end (optional)", maxlength: "40" });
        const hi = h("input", { class: "input", value: fld.highLabel || "", placeholder: "Label for the high end (optional)", maxlength: "40" });
        lo.addEventListener("input", () => { fld.lowLabel = lo.value; touch(); });
        hi.addEventListener("input", () => { fld.highLabel = hi.value; touch(); });
        card.appendChild(h("div", { style: "display:flex;gap:10px;align-items:center;margin-top:12px" }, mn, "to", mx));
        card.appendChild(h("div", { style: "display:grid;gap:8px;margin-top:10px" }, lo, hi));
      }

      if (PH_TYPES.indexOf(fld.type) >= 0) {
        const ph = h("input", { class: "input", style: "margin-top:12px", value: fld.placeholder || "", placeholder: "Example text inside the box (optional)", maxlength: "120" });
        ph.addEventListener("input", () => { fld.placeholder = ph.value; touch(); });
        card.appendChild(ph);
      }

      const foot = h("div", { class: "fe-foot" });
      if (!isSection) {
        const sw = h("label", { class: "fe-switch" });
        const cb = h("input", { type: "checkbox", checked: !!fld.required });
        cb.addEventListener("change", () => { fld.required = cb.checked; touch(); });
        sw.append(cb, "Required");
        foot.appendChild(sw);
      }
      foot.appendChild(h("span", { class: "grow" }));
      const iconBtn = (txt, title, fn, disabled, cls) => h("button", { class: "btn " + (cls || "light") + " small", type: "button", title, "aria-label": title, disabled: !!disabled, onclick: fn }, txt);
      foot.append(
        iconBtn("Up", "Move up", () => move(i, -1), i === 0),
        iconBtn("Down", "Move down", () => move(i, 1), i === fm.fields.length - 1),
        iconBtn("Duplicate", "Duplicate", () => dupField(i)),
        iconBtn("Add below", "Add a question below", () => addField("short", i)),
        iconBtn("Delete", "Delete", () => delField(i), false, "danger")
      );
      card.appendChild(foot);
      return card;
    }

    function changeType(fld, type) {
      const wasOpt = OPT_TYPES.indexOf(fld.type) >= 0;
      fld.type = type;
      if (OPT_TYPES.indexOf(type) >= 0 && !wasOpt) fld.options = fld.options && fld.options.length ? fld.options : ["Option 1", "Option 2"];
      if (type === "scale") { fld.min = fld.min == null ? 1 : fld.min; fld.max = fld.max == null ? 5 : fld.max; }
      if (type === "section") fld.required = false;
      touch();
      drawQuestions($("#fe-list"));
    }
    function move(i, d) {
      const a = ED.form.fields, j = i + d;
      if (j < 0 || j >= a.length) return;
      [a[i], a[j]] = [a[j], a[i]];
      touch();
      drawQuestions($("#fe-list"));
      const el = $("#fe-list .fe-q.on");
      if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    function dupField(i) {
      const a = ED.form.fields;
      if (a.length >= MAX_FIELDS) return toast("A form can hold up to " + MAX_FIELDS + " items", true);
      const c = clone(a[i]);
      c.id = FB.uid();
      a.splice(i + 1, 0, c);
      ED.active = c.id;
      touch();
      drawQuestions($("#fe-list"));
    }
    function delField(i) {
      const a = ED.form.fields;
      const gone = a[i];
      a.splice(i, 1);
      ED.active = a[Math.min(i, a.length - 1)] ? a[Math.min(i, a.length - 1)].id : null;
      touch();
      drawQuestions($("#fe-list"));
      toastUndo("Question deleted.", () => {
        if (!ED) return;
        ED.form.fields.splice(Math.min(i, ED.form.fields.length), 0, gone);
        ED.active = gone.id;
        touch();
        if ($("#fe-list")) drawQuestions($("#fe-list"));
      });
    }

    // ----- settings -----
    function drawSettingsTab(wrap) {
      const fm = ED.form;
      const card = h("div", { class: "card" });
      const grid = h("div", { class: "form-grid" });
      const field = (lab, node, hint, full) => h("div", { class: full ? "full" : "" }, h("label", { class: "f" }, lab), node, hint ? h("div", { class: "hint" }, hint) : null);

      const status = h("select", { class: "select" }, Object.entries(STATUS).map(([k, v]) => h("option", { value: k, selected: k === fm.status }, k === "published" ? "Live (taking responses)" : k === "draft" ? "Draft (only the team sees it)" : "Closed (no new responses)")));
      status.addEventListener("change", () => { fm.status = status.value; touch(); });

      const slug = h("input", { class: "input", value: fm.slug, maxlength: "59" });
      const slugHint = h("div", { class: "hint" }, formUrl(fm.slug));
      slug.addEventListener("input", () => {
        slug.value = slug.value.toLowerCase().replace(/[^a-z0-9-]/g, "");
        fm.slug = slug.value;
        slugHint.textContent = formUrl(fm.slug);
        touch();
      });

      const swatches = h("div", { class: "fe-sw" });
      const color = h("input", { type: "color", value: FB.safeColor(fm.theme.accent), "aria-label": "Accent color", style: "width:40px;height:34px;border:0;background:none;padding:0" });
      const paint = () => {
        swatches.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.c.toLowerCase() === (fm.theme.accent || "").toLowerCase()));
        color.value = FB.safeColor(fm.theme.accent);
      };
      SWATCHES.forEach((c) => {
        const b = h("button", { type: "button", "data-c": c, "aria-label": "Use " + c, style: "background:" + c, onclick: () => { fm.theme.accent = c; paint(); touch(); } });
        swatches.appendChild(b);
      });
      color.addEventListener("input", () => { fm.theme.accent = color.value; paint(); touch(); });
      swatches.appendChild(color);

      const mode = h("select", { class: "select" }, [["light", "Light"], ["dark", "Dark"], ["auto", "Match the visitor's device"]].map(([k, v]) => h("option", { value: k, selected: k === fm.theme.mode }, v)));
      mode.addEventListener("change", () => { fm.theme.mode = mode.value; touch(); });

      const cover = h("input", { class: "input", value: fm.theme.cover_url || "", placeholder: "https://res.cloudinary.com/..." });
      cover.addEventListener("input", () => { fm.theme.cover_url = cover.value.trim(); touch(); });

      const thanks = h("textarea", { class: "textarea", rows: "3", maxlength: "500" });
      thanks.value = fm.thank_you || "";
      thanks.addEventListener("input", () => { fm.thank_you = thanks.value; touch(); });

      const closes = h("input", { class: "input", type: "datetime-local" });
      if (fm.closes_at) {
        const d = new Date(fm.closes_at);
        const p = (n) => String(n).padStart(2, "0");
        closes.value = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
      }
      closes.addEventListener("change", () => { fm.closes_at = closes.value ? new Date(closes.value).toISOString() : null; touch(); });

      const max = h("input", { class: "input", type: "number", min: "1", step: "1", placeholder: "No limit" });
      if (fm.max_responses) max.value = fm.max_responses;
      max.addEventListener("input", () => { const n = parseInt(max.value, 10); fm.max_responses = n > 0 ? n : null; touch(); });

      const payOn = h("input", { type: "checkbox", checked: !!fm.payment.enabled });
      const payAmt = h("input", { class: "input", type: "number", min: "0.1", max: "5000", step: "0.01", placeholder: "10.00" });
      if (fm.payment.amount) payAmt.value = fm.payment.amount;
      const payDesc = h("input", { class: "input", maxlength: "80", placeholder: "Entry fee, Ticket, Deposit" });
      payDesc.value = fm.payment.description || "";
      const syncPay = () => {
        const n = parseFloat(payAmt.value);
        fm.payment = { enabled: payOn.checked && n >= 0.1, amount: n >= 0.1 ? Math.round(n * 100) / 100 : "", description: payDesc.value.trim(), currency: "USD" };
        if (payOn.checked && !(n >= 0.1)) setSave("Enter a price of at least 0.10", true);
        else touch();
      };
      payOn.addEventListener("change", syncPay); payAmt.addEventListener("input", syncPay); payDesc.addEventListener("input", syncPay);

      grid.append(
        field("Status", status, null),
        field("Link name", slug, null),
        field("Accent color", swatches, null),
        field("Theme", mode, null),
        field("Cover image link", cover, "Optional. Paste an https image link, for example from Cloudinary.", true),
        field("Message after submitting", thanks, null, true),
        field("Close automatically on", closes, "Optional. Uses your time zone."),
        field("Maximum responses", max, "Optional. The form closes when it is full."),
        h("div", { class: "full sect" }, h("h3", null, "Payment with ABA PayWay"), h("div", { class: "hint" }, "People pay after they submit. A response only counts as paid once ABA PayWay confirms it."),
          h("label", { class: "check", style: "margin-top:10px" }, payOn, "Ask for payment on this form")),
        field("Price in US dollars", payAmt, null),
        field("What it is for", payDesc, "Shown next to the price.")
      );
      card.appendChild(grid);
      wrap.appendChild(card);
      paint();
      grid.children[1].appendChild(slugHint);
    }

    // ----- preview -----
    function drawPreviewTab(wrap) {
      const bar = h("div", { style: "display:flex;gap:8px;justify-content:center;margin-bottom:14px" });
      ["phone", "desk"].forEach((k) =>
        bar.appendChild(h("button", { class: "btn small " + (ED.device === k ? "" : "light"), type: "button", onclick: () => { ED.device = k; drawEditor(); } }, k === "phone" ? "Phone" : "Laptop"))
      );
      const inner = h("div", { class: "fe-frame-inner" });
      const frame = h("div", { class: "fe-frame " + ED.device }, inner);
      wrap.append(bar, frame);
      const fm = ED.form;
      FB.render(inner, { slug: fm.slug, title: fm.title, description: fm.description, fields: fm.fields, theme: fm.theme, thank_you: fm.thank_you, payment: fm.payment }, { preview: true, embed: true });
      wrap.appendChild(h("p", { class: "hint", style: "text-align:center;margin-top:10px" }, "This is how people see it. Submitting here saves nothing."));
    }

    // ----- share -----
    function drawShareTab(wrap) {
      const fm = ED.form;
      const card = h("div", { class: "card" });
      const url = formUrl(fm.slug);
      card.appendChild(h("h2", null, "Share this form"));
      if (fm.status !== "published") {
        card.appendChild(h("p", { class: "hint" }, "This form is " + (fm.status === "draft" ? "a draft" : "closed") + ". Set it to Live under Design and settings so people can fill it in."));
        card.appendChild(h("button", { class: "btn", type: "button", onclick: () => { fm.status = "published"; touch(); flushSave(true).then(drawEditor); } }, "Make it live"));
        card.appendChild(h("div", { style: "height:14px" }));
      }
      card.appendChild(h("div", { class: "fe-link" }, h("code", null, url), h("button", { class: "btn small", type: "button", onclick: () => copyText(url) }, "Copy link"), h("a", { class: "btn light small", href: url, target: "_blank", rel: "noopener" }, "Open")));
      card.appendChild(h("p", { class: "hint", style: "margin-top:12px" }, "Paste it in your Instagram bio, Telegram, or turn it into a QR code for posters. Works on any phone or laptop, no sign in needed."));
      wrap.appendChild(card);
    }

    // =====================================================
    // RESPONSES
    // =====================================================
    let RS = null;

    async function viewResponses(id) {
      const root = $("#view");
      root.innerHTML = A.loading();
      const [fr, rr] = await Promise.all([
        sb.from("forms").select("id,slug,title,fields").eq("id", id).maybeSingle(),
        sb.from("form_responses").select("*").eq("form_id", id).order("created_at", { ascending: false }).limit(2000),
      ]);
      if (fr.error || !fr.data) return A.fail(root, fr.error || "Form not found");
      if (rr.error) return A.fail(root, rr.error);
      RS = { form: fr.data, rows: rr.data, tab: (RS && RS.form && RS.form.id === id && RS.tab) || "summary" };
      drawResponses();
    }

    const valText = (v) => (v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v));
    const PAY = { paid: ["Paid", "s-won"], pending: ["Waiting", "s-draft"], failed: ["Failed", "s-lost"], mismatch: ["Check amount", "s-lost"] };
    const payBadge = (r) => (r.payment ? h("span", { class: "badge " + (PAY[r.payment.status] || PAY.pending)[1] }, (PAY[r.payment.status] || PAY.pending)[0]) : null);
    const answerOf = (row, fid) => {
      const a = (row.answers || []).find((x) => x.id === fid);
      return a ? a.value : null;
    };

    function drawResponses() {
      const root = $("#view");
      const { form, rows } = RS;
      root.textContent = "";
      $("#top-actions").textContent = "";
      $("#top-actions").append(
        h("button", { class: "btn light small", type: "button", onclick: () => (location.hash = "forms") }, "All forms"),
        " ",
        h("button", { class: "btn light small", type: "button", onclick: () => (location.hash = "forms/e/" + form.id) }, "Edit form"),
        " ",
        h("button", { class: "btn small", type: "button", disabled: !rows.length, onclick: exportCsv }, "Export CSV")
      );
      const wrap = h("div");
      wrap.appendChild(h("div", { style: "margin-bottom:10px" }, h("h2", { style: "margin:0 0 4px" }, form.title), h("div", { class: "hint" }, (rows.some((r) => r.payment) ? "Paid " + rows.filter((r) => r.payment && r.payment.status === "paid").reduce((a, r) => a + Number(r.payment.amount || 0), 0).toFixed(2) + " USD from " + rows.filter((r) => r.payment && r.payment.status === "paid").length + " paid, " + rows.filter((r) => r.payment && r.payment.status !== "paid").length + " not paid. " : "") + rows.length + " response" + (rows.length === 1 ? "" : "s") + (rows.length >= 2000 ? " (showing the latest 2000, export to get these)" : ""))));
      const tabs = h("div", { class: "fe-tabs" });
      [["summary", "Summary"], ["list", "Responses"]].forEach(([k, l]) => tabs.appendChild(h("button", { type: "button", class: RS.tab === k ? "on" : "", onclick: () => { RS.tab = k; drawResponses(); } }, l)));
      wrap.appendChild(tabs);
      if (!rows.length) wrap.appendChild(h("div", { class: "card empty" }, "No responses yet. Share the link and they will show up here."));
      else wrap.appendChild(RS.tab === "summary" ? summaryNode() : tableNode());
      root.appendChild(wrap);
    }

    function summaryNode() {
      const { form, rows } = RS;
      const box = h("div", { style: "display:grid;gap:14px" });
      form.fields.forEach((fld) => {
        if (fld.type === "section") return;
        const card = h("div", { class: "card" }, h("h2", { style: "margin:0 0 2px;font-size:16px" }, fld.label || "Untitled question"));
        const vals = rows.map((r) => answerOf(r, fld.id)).filter((v) => v != null && v !== "" && !(Array.isArray(v) && !v.length));
        card.appendChild(h("div", { class: "hint" }, vals.length + " of " + rows.length + " answered"));
        if (OPT_TYPES.indexOf(fld.type) >= 0) {
          const counts = {};
          (fld.options || []).forEach((o) => (counts[o] = 0));
          vals.forEach((v) => (Array.isArray(v) ? v : [v]).forEach((x) => (counts[x] = (counts[x] || 0) + 1)));
          Object.entries(counts).forEach(([o, n]) => card.appendChild(barRow(o, n, vals.length)));
        } else if (fld.type === "scale") {
          const nums = vals.map(Number);
          const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
          card.appendChild(h("div", { style: "font-size:28px;font-weight:600;margin:6px 0" }, nums.length ? avg.toFixed(2) : "No data", h("span", { class: "hint", style: "font-size:13px;font-weight:400" }, nums.length ? "  average" : "")));
          for (let i = fld.min == null ? 1 : fld.min; i <= (fld.max == null ? 5 : fld.max); i++) card.appendChild(barRow(String(i), nums.filter((n) => n === i).length, nums.length));
        } else {
          vals.slice(0, 8).forEach((v) => card.appendChild(h("div", { class: "fe-txt" }, valText(v))));
          if (vals.length > 8) card.appendChild(h("div", { class: "hint" }, "Plus " + (vals.length - 8) + " more in the Responses tab and the CSV export."));
        }
        box.appendChild(card);
      });
      return box;
    }
    function barRow(label, n, total) {
      const pct = total ? Math.round((n / total) * 100) : 0;
      return h("div", { class: "fe-sumrow" }, h("div", { class: "t" }, h("span", null, label), h("span", { class: "hint" }, n + " (" + pct + "%)")), h("div", { class: "fe-bar", style: "grid-column:1/-1" }, h("i", { style: "width:" + pct + "%" })));
    }

    function tableNode() {
      const { form, rows } = RS;
      const cols = form.fields.filter((x) => x.type !== "section").slice(0, 4);
      const tb = h("tbody");
      const hasPay = rows.some((r) => r.payment);
      rows.forEach((r) => {
        const tr = h("tr", { class: "click" + (r.is_read ? "" : " fe-unread") },
          h("td", null, r.is_read ? null : h("span", { class: "fe-dot", title: "New" }), fmtStamp(r.created_at)),
          cols.map((c) => h("td", null, valText(answerOf(r, c.id)).slice(0, 80))),
          hasPay ? h("td", null, payBadge(r)) : null);
        tr.addEventListener("click", () => openRow(r));
        tb.appendChild(tr);
      });
      return h("div", { class: "table-wrap card" }, h("table", null, h("thead", null, h("tr", null, h("th", null, "Received"), cols.map((c) => h("th", null, c.label || "Question")), hasPay ? h("th", null, "Payment") : null)), tb));
    }

    async function openRow(r) {
      const dl = h("dl");
      (r.answers || []).forEach((a) => {
        dl.appendChild(h("div", { class: "fe-ans" }, h("dt", null, a.label || a.id), h("dd", null, valText(a.value) || "No answer")));
      });
      if (r.payment) {
        const p = r.payment;
        dl.appendChild(h("div", { class: "fe-ans" }, h("dt", null, "Payment"), h("dd", null, ((PAY[p.status] || PAY.pending)[0]) + " " + Number(p.amount || 0).toFixed(2) + " USD" + (p.paid_at ? ", " + fmtStamp(p.paid_at) : "") + (p.apv ? ", approval " + p.apv : "") + "  (ref " + (p.tran_id || "") + ")")));
      }
      const body = h("div", null, h("p", { class: "hint" }, "Received " + fmtStamp(r.created_at)), dl);
      const m = openModal("Response", "", "", true);
      m.querySelector(".modal-body").appendChild(body);
      const foot = h("div", { class: "modal-foot" },
        h("button", { class: "btn danger small", type: "button", onclick: async () => {
          if (!(await ask("Delete this response? This cannot be undone."))) return;
          const { error } = await sb.from("form_responses").delete().eq("id", r.id);
          if (error) return toast(error.message, true);
          RS.rows = RS.rows.filter((x) => x.id !== r.id);
          closeModal(); drawResponses(); toast("Response deleted");
        } }, "Delete"),
        h("span", { class: "spacer" }),
        h("button", { class: "btn light", type: "button", onclick: closeModal }, "Close"));
      m.querySelector(".modal").appendChild(foot);
      if (!r.is_read) {
        const { error } = await sb.from("form_responses").update({ is_read: true }).eq("id", r.id);
        if (!error) { r.is_read = true; const row = RS.rows.find((x) => x.id === r.id); if (row) row.is_read = true; if (RS.tab === "list" && $("#view table")) drawResponses(); }
      }
    }

    function csvCell(v) {
      let s = valText(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula guard
      return '"' + s.replace(/"/g, '""') + '"';
    }
    function exportCsv() {
      const { form, rows } = RS;
      const cols = form.fields.filter((x) => x.type !== "section");
      const hasPay = rows.some((r) => r.payment);
      const lines = [["Received"].concat(cols.map((c) => c.label || c.id), hasPay ? ["Payment status", "Amount USD", "Paid at", "Reference"] : []).map(csvCell).join(",")];
      rows.forEach((r) => lines.push([new Date(r.created_at).toISOString()].concat(cols.map((c) => answerOf(r, c.id)), hasPay ? (r.payment ? [r.payment.status, r.payment.amount, r.payment.paid_at || "", r.payment.tran_id || ""] : ["", "", "", ""]) : []).map(csvCell).join(",")));
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (form.slug || "form") + "-responses-" + new Date().toLocaleDateString("en-CA") + ".csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }

    // =====================================================
    // ROUTER
    // =====================================================
    A.register("forms", {
      title: "Forms",
      ok: () => A.can("forms"),
      render: (param) => {
        if (ED && ED.dirty) flushSave();
        const m = /^(e|r)\/([0-9a-f-]{36})(?:\/(\w+))?$/.exec(param || "");
        if (m && m[1] === "e") return viewEditor(m[2], m[3]);
        if (m && m[1] === "r") return viewResponses(m[2]);
        ED = null;
        return viewList();
      },
    });
  }

  if (window.__admin) start();
  else document.addEventListener("admin-ready", start);
})();
