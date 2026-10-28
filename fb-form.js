/* Shared form renderer. Used by f.html (public) and the admin builder preview.
   FB.render(root, form, { preview, embed, onSubmit }) */
(function (global) {
  "use strict";

  var TYPES = {
    short: "Short answer", long: "Paragraph", email: "Email", phone: "Phone", number: "Number",
    date: "Date", choice: "Multiple choice", multi: "Checkboxes", dropdown: "Dropdown",
    scale: "Linear scale", section: "Title and text"
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function uid() { return "q" + Math.random().toString(36).slice(2, 8); }
  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(c || "") ? c : "#1a1a1a"; }
  function onColor(hex) {
    var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111111" : "#ffffff";
  }
  function httpsUrl(u) { return /^https:\/\/[^\s"'()<>]+$/i.test(u || "") ? u : ""; }

  var ERR = {
    form_closed: "This form is closed and is no longer taking responses.",
    form_full: "This form has reached its limit of responses.",
    form_unavailable: "This form is not available.",
    rate_limited: "Too many tries from your connection. Wait a few minutes and send again.",
    invalid_payload: "Something went wrong with your answers. Refresh the page and try again.",
    payment_misconfigured: "Payment is not set up for this form yet. Please tell the organiser."
  };

  /* Validate one value on the client. Mirrors the server rules. */
  function validate(f, v) {
    if (f.type === "section") return null;
    var empty = v == null || v === "" || (Array.isArray(v) && !v.length);
    if (empty) return f.required ? "This question is required." : null;
    var s = String(v).trim();
    switch (f.type) {
      case "short": if (s.length > 300) return "Keep this under 300 characters."; break;
      case "long": if (s.length > 5000) return "Keep this under 5000 characters."; break;
      case "email": if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return "Enter a valid email address."; break;
      case "phone": if (!/^[0-9+()\s.-]{5,40}$/.test(s)) return "Enter a valid phone number."; break;
      case "number": if (!/^-?[0-9]{1,15}(\.[0-9]{1,6})?$/.test(s)) return "Enter a number."; break;
      case "date": if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "Pick a date."; break;
      case "choice": case "dropdown": if ((f.options || []).indexOf(s) < 0) return "Pick one of the options."; break;
      case "multi": if (!Array.isArray(v) || v.some(function (x) { return (f.options || []).indexOf(x) < 0; })) return "Pick from the options."; break;
      case "scale":
        var n = Number(s), mn = f.min == null ? 1 : f.min, mx = f.max == null ? 5 : f.max;
        if (!/^\d{1,2}$/.test(s) || n < mn || n > mx) return "Pick a value.";
        break;
    }
    return null;
  }

  function render(root, form, opts) {
    opts = opts || {};
    var theme = form.theme || {};
    var accent = safeColor(theme.accent);
    var fields = Array.isArray(form.fields) ? form.fields : [];
    var draftKey = opts.preview ? null : "fb-draft:" + form.slug;
    var state = {};
    var nodes = {};
    var sending = false;

    root.textContent = "";
    var wrap = el("div", "fb" + (opts.embed ? " fb--embed" : ""));
    wrap.dataset.mode = ["light", "dark", "auto"].indexOf(theme.mode) >= 0 ? theme.mode : "light";
    wrap.style.setProperty("--fb-accent", accent);
    wrap.style.setProperty("--fb-on-accent", onColor(accent));
    root.appendChild(wrap);

    var bar = el("div", "fb-progress");
    var barI = el("i");
    bar.appendChild(barI);
    wrap.appendChild(bar);

    var cover = httpsUrl(theme.cover_url);
    if (cover) {
      var c = el("div", "fb-cover");
      c.style.backgroundImage = 'url("' + cover.replace(/"/g, "%22") + '")';
      wrap.appendChild(c);
    }

    var page = el("div", "fb-wrap");
    wrap.appendChild(page);

    if (opts.brand) {
      var b = el("a", "fb-brand");
      b.href = "/";
      var logo = el("img");
      logo.src = "/favicon.svg"; logo.alt = "";
      b.appendChild(logo);
      b.appendChild(document.createTextNode("The Social Phnom Penh"));
      page.appendChild(b);
    }

    var formEl = el("form", "fb-form");
    formEl.noValidate = true;
    formEl.setAttribute("autocomplete", "on");
    page.appendChild(formEl);

    var head = el("div", "fb-card fb-head");
    head.appendChild(el("h1", "fb-title", form.title || "Untitled form"));
    if (form.description) head.appendChild(el("p", "fb-desc", form.description));
    if (fields.some(function (f) { return f.required; })) head.appendChild(el("p", "fb-reqnote", "* Required"));
    formEl.appendChild(head);

    /* restore draft */
    var draft = {};
    if (draftKey) { try { draft = JSON.parse(localStorage.getItem(draftKey) || "{}") || {}; } catch (e) { draft = {}; } }

    function saveDraft() {
      if (!draftKey) return;
      try { localStorage.setItem(draftKey, JSON.stringify(state)); } catch (e) {}
    }
    function clearDraft() { if (draftKey) { try { localStorage.removeItem(draftKey); } catch (e) {} } }

    function answeredCount() {
      var n = 0, tot = 0;
      fields.forEach(function (f) {
        if (f.type === "section") return;
        tot++;
        var v = state[f.id];
        if (!(v == null || v === "" || (Array.isArray(v) && !v.length))) n++;
      });
      return tot ? n / tot : 0;
    }
    function updateBar() { barI.style.width = Math.round(answeredCount() * 100) + "%"; }

    function setError(f, msg) {
      var n = nodes[f.id];
      if (!n) return;
      n.card.classList.toggle("has-error", !!msg);
      n.err.textContent = msg || "";
    }

    function changed(f, v) {
      state[f.id] = v;
      var n = nodes[f.id];
      if (n && n.card.classList.contains("has-error")) setError(f, validate(f, v));
      saveDraft(); updateBar();
    }

    fields.forEach(function (f) {
      if (f.type === "section") {
        var sec = el("div", "fb-section");
        sec.appendChild(el("h2", null, f.label || ""));
        if (f.help) sec.appendChild(el("p", null, f.help));
        formEl.appendChild(sec);
        return;
      }

      var card = el("div", "fb-card");
      var id = "fb_" + f.id;
      var lab = el("label", "fb-label", f.label || "Question");
      if (f.required) lab.appendChild(el("span", "fb-req", "*"));
      card.appendChild(lab);
      if (f.help) card.appendChild(el("p", "fb-help", f.help));
      var control;
      var saved = draft[f.id];

      if (f.type === "short" || f.type === "email" || f.type === "phone" || f.type === "number" || f.type === "date") {
        control = el("input", "fb-input");
        control.id = id;
        control.type = { short: "text", email: "email", phone: "tel", number: "text", date: "date" }[f.type];
        if (f.type === "number") control.inputMode = "decimal";
        if (f.type === "email") control.autocomplete = "email";
        if (f.type === "phone") control.autocomplete = "tel";
        if (f.type === "short") control.maxLength = 300;
        if (f.placeholder) control.placeholder = f.placeholder;
        if (typeof saved === "string") { control.value = saved; state[f.id] = saved; }
        lab.htmlFor = id;
        control.addEventListener("input", function () { changed(f, control.value); });
        card.appendChild(control);
      } else if (f.type === "long") {
        control = el("textarea", "fb-input");
        control.id = id; control.maxLength = 5000; control.rows = 4;
        if (f.placeholder) control.placeholder = f.placeholder;
        if (typeof saved === "string") { control.value = saved; state[f.id] = saved; }
        lab.htmlFor = id;
        control.addEventListener("input", function () { changed(f, control.value); });
        card.appendChild(control);
      } else if (f.type === "dropdown") {
        control = el("select", "fb-input");
        control.id = id; lab.htmlFor = id;
        var ph = el("option", null, "Choose");
        ph.value = "";
        control.appendChild(ph);
        (f.options || []).forEach(function (o) {
          var op = el("option", null, o); op.value = o; control.appendChild(op);
        });
        if (typeof saved === "string" && (f.options || []).indexOf(saved) >= 0) { control.value = saved; state[f.id] = saved; }
        control.addEventListener("change", function () { changed(f, control.value); });
        card.appendChild(control);
      } else if (f.type === "choice" || f.type === "multi") {
        var multi = f.type === "multi";
        var list = el("div", "fb-opts");
        list.setAttribute("role", multi ? "group" : "radiogroup");
        list.setAttribute("aria-labelledby", id + "_l");
        lab.id = id + "_l";
        var cur = multi ? (Array.isArray(saved) ? saved.filter(function (x) { return (f.options || []).indexOf(x) >= 0; }) : []) : (typeof saved === "string" ? saved : "");
        if (multi ? cur.length : cur) state[f.id] = cur;
        (f.options || []).forEach(function (o) {
          var row = el("label", "fb-opt" + (multi ? " is-multi" : ""));
          var inp = el("input");
          inp.type = multi ? "checkbox" : "radio";
          inp.name = id; inp.value = o;
          if (multi ? cur.indexOf(o) >= 0 : cur === o) inp.checked = true;
          inp.addEventListener("change", function () {
            if (multi) {
              var vals = [];
              list.querySelectorAll("input:checked").forEach(function (i) { vals.push(i.value); });
              changed(f, vals);
            } else changed(f, inp.value);
          });
          row.appendChild(inp);
          row.appendChild(el("span", "fb-mark"));
          row.appendChild(el("span", null, o));
          list.appendChild(row);
        });
        card.appendChild(list);
      } else if (f.type === "scale") {
        var mn = f.min == null ? 1 : f.min, mx = f.max == null ? 5 : f.max;
        var sc = el("div", "fb-scale");
        sc.setAttribute("role", "radiogroup");
        var cv = saved != null ? String(saved) : "";
        if (cv && Number(cv) >= mn && Number(cv) <= mx) state[f.id] = Number(cv); else cv = "";
        for (var i = mn; i <= mx; i++) {
          (function (i) {
            var w = el("label", "fb-sc");
            var inp = el("input");
            inp.type = "radio"; inp.name = id; inp.value = String(i);
            if (cv === String(i)) inp.checked = true;
            inp.addEventListener("change", function () { changed(f, i); });
            w.appendChild(inp);
            w.appendChild(el("span", null, String(i)));
            sc.appendChild(w);
          })(i);
        }
        card.appendChild(sc);
        if (f.lowLabel || f.highLabel) {
          var ll = el("div", "fb-scale-lab");
          ll.appendChild(el("span", null, f.lowLabel || ""));
          ll.appendChild(el("span", null, f.highLabel || ""));
          card.appendChild(ll);
        }
      }

      var err = el("p", "fb-err");
      err.setAttribute("role", "alert");
      card.appendChild(err);
      nodes[f.id] = { card: card, err: err, control: control };
      formEl.appendChild(card);
    });

    /* honeypot */
    var hpWrap = el("div", "fb-hp");
    hpWrap.setAttribute("aria-hidden", "true");
    var hp = el("input");
    hp.type = "text"; hp.name = "website"; hp.tabIndex = -1; hp.autocomplete = "off";
    hpWrap.appendChild(hp);
    formEl.appendChild(hpWrap);

    var pay = form.payment && form.payment.enabled && Number(form.payment.amount) > 0 ? form.payment : null;
    if (pay) {
      var pc = el("div", "fb-card fb-pay");
      pc.appendChild(el("div", "fb-pay-amt", "$" + Number(pay.amount).toFixed(2)));
      pc.appendChild(el("div", "fb-pay-txt", (pay.description ? pay.description + ". " : "") + "After you submit, you pay securely on ABA PayWay with ABA Mobile, KHQR or card."));
      formEl.appendChild(pc);
    }

    var banner = el("div", "fb-banner");
    banner.hidden = true;
    banner.setAttribute("role", "alert");
    formEl.appendChild(banner);

    var actions = el("div", "fb-actions");
    var submitLabel = pay ? "Continue to payment" : "Submit";
    var submit = el("button", "fb-submit", opts.preview ? submitLabel + " (preview)" : submitLabel);
    submit.type = "submit";
    var clear = el("button", "fb-clear", "Clear form");
    clear.type = "button";
    actions.appendChild(submit);
    actions.appendChild(clear);
    formEl.appendChild(actions);
    if (opts.brand) {
      var foot = el("div", "fb-foot", "Built by The Social Phnom Penh");
      page.appendChild(foot);
    }

    clear.addEventListener("click", function () {
      state = {};
      clearDraft();
      render(root, form, opts);
    });

    function showBanner(msg, info) {
      banner.textContent = msg;
      banner.className = "fb-banner" + (info ? " info" : "");
      banner.hidden = !msg;
    }

    function done(message) {
      clearDraft();
      var d = el("div", "fb-card fb-done");
      d.appendChild(el("div", "tick"));
      d.appendChild(el("h2", null, "Response recorded"));
      d.appendChild(el("p", null, message || form.thank_you || "Thanks, we got your answers."));
      var again = el("button", "fb-clear", "Send another response");
      again.type = "button";
      again.addEventListener("click", function () { state = {}; render(root, form, opts); });
      d.appendChild(again);
      formEl.hidden = true;
      page.insertBefore(d, formEl);
      barI.style.width = "100%";
      try { wrap.scrollIntoView({ block: "start" }); window.scrollTo(0, 0); } catch (e) {}
    }

    formEl.addEventListener("submit", function (ev) {
      ev.preventDefault();
      if (sending) return;
      showBanner("");
      var first = null;
      fields.forEach(function (f) {
        if (f.type === "section") return;
        var msg = validate(f, state[f.id]);
        setError(f, msg);
        if (msg && !first) first = f;
      });
      if (first) {
        var n = nodes[first.id];
        try { n.card.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
        var focusable = n.control || n.card.querySelector("input");
        if (focusable && focusable.focus) { try { focusable.focus({ preventScroll: true }); } catch (e) {} }
        showBanner("Check the highlighted questions and try again.");
        return;
      }
      var answers = {};
      fields.forEach(function (f) {
        if (f.type === "section") return;
        var v = state[f.id];
        if (v == null || v === "" || (Array.isArray(v) && !v.length)) return;
        answers[f.id] = typeof v === "string" ? v.trim() : v;
      });
      if (opts.preview) { done("This is a preview. Nothing was saved."); return; }
      sending = true; submit.disabled = true; submit.textContent = "Sending";
      Promise.resolve(opts.onSubmit(answers, hp.value)).then(function (res) {
        sending = false; submit.disabled = false; submit.textContent = submitLabel;
        if (res && res.ok && res.pay && opts.onPay) {
          clearDraft();
          sending = true; submit.disabled = true; submit.textContent = "Opening ABA PayWay";
          var go = function () {
            return Promise.resolve(opts.onPay(res.pay)).catch(function () {
              sending = false;
              formEl.hidden = true;
              var c = el("div", "fb-card fb-done");
              c.appendChild(el("h2", null, "Answers saved, payment not started"));
              c.appendChild(el("p", null, "We could not open the payment page. Your answers are safe. Try again to finish."));
              var again = el("button", "fb-submit", "Try payment again");
              again.type = "button"; again.style.marginTop = "20px";
              again.addEventListener("click", function () { again.disabled = true; go().then(function () { again.disabled = false; }); });
              c.appendChild(again);
              page.insertBefore(c, formEl);
            });
          };
          go();
          return;
        }
        if (res && res.ok) { done(res.message); return; }
        var code = (res && res.error) || "";
        var m = /^(required|invalid):(.+)$/.exec(code);
        if (m) {
          var fld = fields.filter(function (x) { return x.id === m[2]; })[0];
          if (fld) {
            setError(fld, m[1] === "required" ? "This question is required." : "This answer is not valid.");
            try { nodes[fld.id].card.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (e) {}
          }
          showBanner("Check the highlighted question and try again.");
        } else {
          showBanner(ERR[code] || "We could not send your answers. Check your connection and try again. Your answers are still here.");
        }
      }).catch(function () {
        sending = false; submit.disabled = false; submit.textContent = submitLabel;
        showBanner("We could not send your answers. Check your connection and try again. Your answers are still here.");
      });
    });

    updateBar();
    return { destroy: function () { root.textContent = ""; } };
  }

  /* A simple message page in the form's look: FB.status(root, form, {title, text, button, onButton, brand}) */
  function status(root, form, cfg) {
    var theme = (form && form.theme) || {};
    var accent = safeColor(theme.accent);
    root.textContent = "";
    var wrap = el("div", "fb");
    wrap.dataset.mode = ["light", "dark", "auto"].indexOf(theme.mode) >= 0 ? theme.mode : "light";
    wrap.style.setProperty("--fb-accent", accent);
    wrap.style.setProperty("--fb-on-accent", onColor(accent));
    var page = el("div", "fb-wrap");
    if (cfg.brand) {
      var b = el("a", "fb-brand"); b.href = "/";
      var logo = el("img"); logo.src = "/favicon.svg"; logo.alt = "";
      b.appendChild(logo); b.appendChild(document.createTextNode("The Social Phnom Penh"));
      page.appendChild(b);
    }
    var c = el("div", "fb-card fb-done");
    if (cfg.tick !== false) c.appendChild(el("div", "tick"));
    c.appendChild(el("h2", null, cfg.title || ""));
    c.appendChild(el("p", null, cfg.text || ""));
    if (cfg.button) {
      var btn = el("button", "fb-submit", cfg.button);
      btn.type = "button"; btn.style.marginTop = "20px";
      btn.addEventListener("click", function () { cfg.onButton && cfg.onButton(btn); });
      c.appendChild(btn);
    }
    page.appendChild(c);
    wrap.appendChild(page);
    root.appendChild(wrap);
  }

  global.FB = { status: status, render: render, validate: validate, TYPES: TYPES, uid: uid, safeColor: safeColor, httpsUrl: httpsUrl };
})(window);
