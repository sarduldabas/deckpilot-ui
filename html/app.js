/* DeckPilot UI. Plain JavaScript, no build step.
   Talks only to project-service (through nginx at /api). Every call is logged in the API console. */
"use strict";

/* ------------------------------------------------------------------ constants */
const ACTIVE = ["CREATED", "CHECKING_BRIEF", "RESEARCHING", "BUILDING"];
const STATUS = {
  CREATED: ["Queued", "run"],
  CHECKING_BRIEF: ["Checking the brief", "run"],
  NEEDS_INPUT: ["Needs your answers", "wait"],
  RESEARCHING: ["Researching the web", "run"],
  BUILDING: ["Building the deck", "run"],
  COMPLETED: ["Ready", "ok"],
  FAILED: ["Failed", "err"],
};
const AGENTS = [
  { key: "intake-service", icon: "chat", name: "Brief check", desc: "Decides if the brief is complete and asks up to three questions." },
  { key: "research-service", icon: "globe", name: "Web research", desc: "Runs cited web searches and looks for images." },
  { key: "builder-service", icon: "layers", name: "Deck builder", desc: "Writes the outline and renders the .pptx file." },
];
const AUDIENCES = ["Senior leadership", "Technical team", "Customers", "Students"];
const THEMES = [
  { id: "executive", name: "Executive", colors: ["#14213d", "#0e9f8e"] },
  { id: "graphite", name: "Graphite", colors: ["#22272e", "#f29d38"] },
  { id: "forest", name: "Forest", colors: ["#123b2c", "#2e9466"] },
  { id: "aubergine", name: "Aubergine", colors: ["#3b1f4b", "#e0546a"] },
];
const swatches = (selected, act) => THEMES.map((t) =>
  `<button class="swatch ${t.id === selected ? "on" : ""}" type="button" data-act="${act}" data-v="${t.id}" aria-pressed="${t.id === selected}" title="${t.name} theme">
    <i style="background:linear-gradient(135deg, ${t.colors[0]} 0 50%, ${t.colors[1]} 50% 100%)"></i><span>${t.name}</span></button>`).join("");
const SAMPLES = {
  short: { topic: "Solar power adoption in India", description: "Overview for a talk.", audience: "", slides: 9 },
  full: {
    topic: "Generative AI in customer support",
    description:
      "A briefing for our leadership team on how generative AI is changing customer support: cost impact, " +
      "quality and risk concerns, and which vendors or approaches we should evaluate next year. " +
      "Keep it practical and decision-oriented.",
    audience: "Senior leadership",
    slides: 9,
  },
};

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const DESC_HINT = "A fuller description means fewer follow-up questions. Type it, or press the mic and speak.";
const mic = { rec: null, on: false, base: "", final: "", fatal: false };

const state = {
  view: "new", selected: null, project: null, events: [], research: null, researchFor: null,
  projects: [], console: [], consoleOpen: new Set(), openEv: new Set(), tick: 0, sig: "",
  slide: 0, dealt: null, draft: { topic: "", description: "", audience: "", slides: 9, theme: "executive" },
};

/* ------------------------------------------------------------------ helpers */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (n) => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const parseTs = (v) => { const s = String(v || ""); return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s + "Z"); };
const fmtMs = (ms) => (ms == null ? "" : ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.round((ms % 60000) / 1000)} s`);
const fmtSec = (ms) => { if (ms < 1000) return fmtMs(Math.max(0, Math.round(ms))); const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, "0")} s`; };
const ago = (v) => {
  const s = Math.max(0, (Date.now() - parseTs(v).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
const pretty = (v, max = 8000) => {
  const t = typeof v === "string" ? tryJson(v) : JSON.stringify(v, null, 2);
  return t && t.length > max ? t.slice(0, max) + "\n… (shortened here)" : t ?? "";
};
function tryJson(s) { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; } }
/* JSON highlighter: input is escaped first, then wrapped in spans */
function hl(text) {
  const safe = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return safe.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
    (m, str, colon, bool) => {
      if (str) return colon ? `<span class="j-k">${str}</span>${colon}` : `<span class="j-s">${str}</span>`;
      if (bool) return `<span class="j-b">${m}</span>`;
      if (m === "null") return `<span class="j-z">null</span>`;
      return `<span class="j-n">${m}</span>`;
    },
  );
}
const code = (v) => `<pre class="code">${hl(pretty(v))}</pre>`;
function copyBtn(text) {
  const t = typeof text === "string" ? text : JSON.stringify(text, null, 2);
  return `<button type="button" data-act="copy" data-copy="${esc(t)}">${icon("copy")}Copy</button>`;
}
function toast(msg, kind = "") {
  const t = document.createElement("div");
  t.className = "toast " + kind; t.textContent = msg;
  $("toasts").appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 7000 : 3200);
}
const errText = (err) => {
  const m = String(err?.message || err);
  try {
    const d = JSON.parse(m);
    if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join("; ");
    return typeof d === "string" ? d : m;
  } catch { return m; }
};

/* ------------------------------------------------------------------ API + console */
async function api(method, path, body, { quiet = false, blob = false } = {}) {
  const entry = { id: Math.random().toString(36).slice(2), time: new Date(), method, url: "/api" + path, request: body ?? null, quiet, status: "…", ms: null, response: null };
  state.console.unshift(entry);
  if (state.console.length > 200) state.console.length = 200;
  const t0 = performance.now();
  renderConsole();
  try {
    const res = await fetch(entry.url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    entry.status = res.status;
    entry.ms = Math.round(performance.now() - t0);
    if (blob && res.ok) {
      const data = await res.blob();
      entry.response = `(binary file, ${data.size} bytes, ${res.headers.get("content-type")})`;
      renderConsole();
      return { blob: data, filename: (res.headers.get("content-disposition") || "").match(/filename="?([^"]+)"?/)?.[1] };
    }
    const text = await res.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
    entry.response = data === null ? "(empty body)" : data;
    renderConsole();
    if (!res.ok) throw new Error(typeof data === "object" && data?.detail ? JSON.stringify(data.detail) : `HTTP ${res.status}`);
    return data;
  } catch (err) {
    if (entry.status === "…") { entry.status = "ERR"; entry.response = String(err.message || err); }
    entry.ms ??= Math.round(performance.now() - t0);
    renderConsole();
    throw err;
  }
}

function renderConsole() {
  const showPoll = $("show-polling").checked;
  const rows = state.console.filter((e) => showPoll || !e.quiet);
  $("console-count").textContent = rows.length;
  const last = rows[0];
  $("console-peek").textContent = last
    ? `${last.method} ${last.url}  ${last.status}${last.ms != null ? "  " + last.ms + " ms" : ""}`
    : "Every request the page sends and every response it gets will appear here";
  if ($("console").classList.contains("collapsed")) return;
  $("console-list").innerHTML = rows.length
    ? rows.slice(0, 80).map((e) => {
        const ok = typeof e.status === "number" && e.status < 400;
        const open = state.consoleOpen.has(e.id);
        return `<div class="c-row"><button class="c-head" type="button" data-act="c-row" data-id="${e.id}">
            <span class="m ${e.method}">${e.method}</span><span class="u">${esc(e.url)}</span>
            <span class="st ${ok ? "ok" : "bad"}">${esc(e.status)}</span>
            <span class="ms">${e.ms != null ? fmtMs(e.ms) : ""}</span><span class="t">${e.time.toLocaleTimeString()}</span></button>
          ${open ? `<div class="c-body">
            <div><div class="pane-h"><span>Request</span>${e.request !== null ? copyBtn(e.request) : ""}</div>${e.request !== null ? code(e.request) : `<pre class="code j-z">No body</pre>`}</div>
            <div><div class="pane-h"><span>Response</span>${e.response != null ? copyBtn(e.response) : ""}</div>${code(e.response ?? "")}</div></div>` : ""}</div>`;
      }).join("")
    : `<p class="c-empty">Nothing yet. Create a deck and every call will show up here.</p>`;
}

function setConsole(open) {
  const c = $("console");
  c.classList.toggle("collapsed", !open);
  document.body.classList.toggle("console-open", open);
  c.querySelector(".console-toggle").setAttribute("aria-expanded", String(open));
  $("console-toggle-label").textContent = open ? "Collapse" : "Expand";
  renderConsole();
}

/* ------------------------------------------------------------------ rail */
function statusOf(s) { return STATUS[s] || [s, "run"]; }
function renderRail() {
  $("projects").innerHTML = state.projects.length
    ? state.projects.map((p) => {
        const [label, tone] = statusOf(p.status);
        return `<li><button class="pitem ${state.view === "project" && p.id === state.selected ? "on" : ""}" type="button" data-act="select" data-id="${p.id}">
          <i class="pdot ${tone}"></i><span><span class="pi-title">${esc(p.topic)}</span>
          <span class="pi-sub"><span>${label}</span><span>${ago(p.created_at)}</span></span></span></button></li>`;
      }).join("")
    : `<li class="none">No decks yet. Your first one will show up here.</li>`;
}

/* ------------------------------------------------------------------ composer */
function composerHtml() {
  const d = state.draft;
  return `<div class="composer">
    <h1>What is the deck about?</h1>
    <p class="lede">Type a topic and a few lines of context. Three agents check the brief, research the web with sources, and build a PowerPoint you can download.</p>
    <form id="create-form" autocomplete="off">
      <div class="cstage">
        <span class="cbar"></span>
        <textarea class="ctitle" id="f-topic" rows="2" maxlength="300" placeholder="Your topic goes here" aria-label="Topic" required>${esc(d.topic)}</textarea>
        <input class="csub" id="f-audience" maxlength="200" placeholder="Who is it for? (optional)" aria-label="Audience" value="${esc(d.audience)}">
        <span class="cfoot">Title slide preview</span>
      </div>
      <div class="cform">
        <div class="field"><span>Description <em id="desc-count">${d.description.length} / 8000</em></span>
          <div class="dwrap"><textarea id="f-description" rows="6" maxlength="8000" aria-label="Description" placeholder="What should the deck cover? Goals, scope, points you want included, tone.">${esc(d.description)}</textarea>
            ${SR ? `<button type="button" class="mic" id="mic" data-act="mic" aria-pressed="false" aria-label="Dictate the description" title="Speak your description">${icon("mic")}</button>` : ""}</div>
          <small id="desc-hint">${SR ? DESC_HINT : "A fuller description means fewer follow-up questions. Voice input works in Chrome and Edge."}</small></div>
        <div class="side">
          <div class="field"><span>Slides</span>
            <div class="slider"><input type="range" id="f-slides" min="5" max="14" value="${d.slides}" aria-label="Number of content slides"><output id="slides-out">${d.slides}</output></div>
            <small>Content slides. A title, agenda and sources slide are added.</small></div>
          <div class="field"><span>Theme</span><div class="swatches">${swatches(d.theme, "draft-theme")}</div></div>
          <div class="field"><span>Audience</span>
            <div class="chips">${AUDIENCES.map((a) => `<button class="chip" type="button" data-act="aud" data-v="${esc(a)}">${esc(a)}</button>`).join("")}</div></div>
          <div class="field"><span>Not sure what to type?</span>
            <div class="chips"><button class="chip" type="button" data-act="sample" data-sample="full">Complete example</button>
            <button class="chip" type="button" data-act="sample" data-sample="short">Vague example</button></div>
            <small>The vague one makes the agent ask questions.</small></div>
        </div>
      </div>
      <div class="submit-row"><button class="btn primary big" id="create-btn" type="submit">${icon("spark")}Generate deck</button>
        <small>Nothing is sent until you press this.</small></div>
    </form>
    <section class="how"><h2>What happens next</h2>
      <div class="how-steps">
        <div><strong>1. The brief is checked</strong><p>If something important is missing, you get up to three short questions. One round only.</p></div>
        <div><strong>2. The web is searched</strong><p>Several searches run in parallel. Findings keep their source links, and images come from Wikipedia.</p></div>
        <div><strong>3. The deck is built</strong><p>Slides are outlined, speaker notes added, and a sources slide closes the deck.</p></div>
      </div></section></div>`;
}

/* ------------------------------------------------------------------ voice input (browser speech recognition) */
function setMicUi(on) {
  const b = $("mic"); if (b) { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.title = on ? "Stop dictation" : "Speak your description"; }
  const h = $("desc-hint"); if (h && SR) h.textContent = on ? "Listening. Speak now, then press the mic again to stop." : DESC_HINT;
}
function syncDesc() {
  const ta = $("f-description"); if (!ta) return;
  state.draft.description = ta.value; $("desc-count").textContent = `${ta.value.length} / 8000`;
}
function stopMic() {
  mic.on = false;
  try { mic.rec?.stop(); } catch { /* already stopped */ }
  mic.rec = null; setMicUi(false);
}
function startMic() {
  if (!SR) return toast("Voice input needs Chrome or Edge", "err");
  if (!window.isSecureContext) return toast("The browser only allows the microphone on localhost or HTTPS", "err");
  const ta = $("f-description");
  const rebase = () => { mic.base = ta.value && !/\s$/.test(ta.value) ? ta.value + " " : ta.value; mic.final = ""; };
  rebase(); mic.fatal = false;
  const rec = new SR();
  rec.lang = navigator.language || "en-US"; rec.continuous = true; rec.interimResults = true;
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) mic.final += r[0].transcript.trim() + " "; else interim += r[0].transcript;
    }
    ta.value = (mic.base + mic.final + interim).slice(0, 8000); syncDesc();
  };
  rec.onerror = (e) => {
    if (e.error === "no-speech" || e.error === "aborted") return;
    mic.fatal = true;
    toast(e.error === "not-allowed" || e.error === "service-not-allowed"
      ? "Microphone is blocked. Allow it from the lock icon in the address bar, then try again."
      : e.error === "network" ? "Speech recognition needs an internet connection" : `Voice input stopped (${e.error})`, "err");
  };
  rec.onend = () => {
    if (mic.on && !mic.fatal && mic.rec === rec) { try { rebase(); rec.start(); return; } catch { /* fall through */ } }
    if (mic.rec === rec) stopMic();
  };
  mic.rec = rec; mic.on = true;
  try { rec.start(); setMicUi(true); } catch (err) { stopMic(); toast(errText(err), "err"); }
}

/* ------------------------------------------------------------------ pipeline state */
function stepStates(p, events) {
  const failedSvc = p.status === "FAILED" ? ([...events].reverse().find((e) => e.status === "ERROR")?.service || "intake-service") : null;
  const per = (svc) => {
    const l = events.filter((e) => e.service === svc);
    return { dur: l.reduce((a, e) => a + (e.duration_ms || 0), 0), running: l.find((e) => e.status === "RUNNING") || null, n: l.length };
  };
  const st = { "intake-service": "idle", "research-service": "idle", "builder-service": "idle" };
  switch (p.status) {
    case "CREATED": case "CHECKING_BRIEF": st["intake-service"] = "running"; break;
    case "NEEDS_INPUT": st["intake-service"] = "waiting"; break;
    case "RESEARCHING": st["intake-service"] = "done"; st["research-service"] = "running"; break;
    case "BUILDING": st["intake-service"] = st["research-service"] = "done"; st["builder-service"] = "running"; break;
    case "COMPLETED": AGENTS.forEach((a) => (st[a.key] = "done")); break;
    case "FAILED":
      if (failedSvc === "intake-service") st["intake-service"] = "error";
      else if (failedSvc === "research-service") { st["intake-service"] = "done"; st["research-service"] = "error"; }
      else { st["intake-service"] = st["research-service"] = "done"; st["builder-service"] = "error"; }
      break;
  }
  return AGENTS.map((a) => ({ ...a, state: st[a.key], ...per(a.key) }));
}

function pipelineHtml(p, events) {
  const steps = stepStates(p, events);
  const label = { idle: "Waiting", running: "Working", done: "Done", waiting: "Needs your answers", error: "Failed" };
  const glyph = (s) => (s === "done" ? icon("check") : s === "error" ? icon("alert") : s === "waiting" ? icon("chat") : "");
  const node = (s) => {
    const time = s.state === "running" && s.running ? `<span class="t" data-since="${esc(s.running.ts)}">${fmtSec(Date.now() - parseTs(s.running.ts))}</span>`
      : s.dur ? `<span class="t">${fmtMs(s.dur)}</span>` : "";
    return `<div class="step ${s.state}"><div class="step-top"><span class="glyph ${s.state}">${glyph(s.state)}</span>${s.name}</div>
      <p class="step-desc">${s.desc}</p><div class="step-state"><span>${label[s.state]}</span>${time}</div><span class="step-bar"></span></div>`;
  };
  const link = (a, b) => `<span class="link-l ${a.state === "done" && b.state === "done" ? "done" : a.state === "done" && b.state === "running" ? "flow" : a.state === "done" ? "done" : ""}"></span>`;
  return `<div class="pipe" aria-label="Pipeline progress">${node(steps[0])}${link(steps[0], steps[1])}${node(steps[1])}${link(steps[1], steps[2])}${node(steps[2])}</div>`;
}

/* ------------------------------------------------------------------ slides */
function slideList(p) {
  const o = p.outline;
  if (!o) return [];
  const list = [{ kind: "title" }];
  if ((o.agenda || []).length >= 3) list.push({ kind: "agenda" });
  (o.slides || []).forEach((s, i) => list.push({ kind: "content", n: i + 1, ...s }));
  if (p.sources?.length) list.push({ kind: "sources", sources: p.sources });
  return list;
}
function slideHtml(s, p, num) {
  const o = p.outline || {};
  const label = (o.title || p.topic || "").slice(0, 90);
  return window.SlidePreview.slide(s, { outline: o, research: state.research, num, label, dateLabel: parseTs(p.updated_at).toLocaleDateString([], { month: "long", year: "numeric" }) });
}
function viewerHtml(p) {
  const list = slideList(p);
  if (!list.length) return "";
  state.slide = Math.min(state.slide, list.length - 1);
  const cur = list[state.slide];
  const notes = cur.kind === "content" && cur.speaker_notes ? cur.speaker_notes : "";
  const deal = state.dealt !== p.id;
  state.dealt = p.id;
  const theme = esc(p.outline?.theme || p.theme || "executive");
  return `<div class="stage" data-theme="${theme}">${slideHtml(cur, p, state.slide + 1)}</div>
    <div class="viewer-bar"><button class="round" type="button" data-act="prev" aria-label="Previous slide" ${state.slide === 0 ? "disabled" : ""}>${icon("left")}</button>
      <span class="count">Slide ${state.slide + 1} of ${list.length}</span>
      <button class="round" type="button" data-act="next" aria-label="Next slide" ${state.slide === list.length - 1 ? "disabled" : ""}>${icon("right")}</button>
      <span class="hint">Use the arrow keys to move</span></div>
    <div class="thumbs ${deal ? "deal" : ""}">${list.map((s, i) => `<button class="thumb ${i === state.slide ? "on" : ""}" type="button" data-act="thumb" data-i="${i}" style="--i:${i}" aria-label="Go to slide ${i + 1}"><span class="tstage" data-theme="${theme}">${slideHtml(s, p, i + 1)}</span></button>`).join("")}</div>
    ${notes ? `<details class="notes" open><summary>Speaker notes</summary><p>${esc(notes)}</p></details>` : ""}`;
}
function renderViewer() { const v = $("viewer"); if (v && state.project) v.innerHTML = viewerHtml(state.project); }

/* ------------------------------------------------------------------ project view */
function sideHtml(p) {
  const b = p.brief;
  let h = "";
  if (b) {
    h += `<section><h2>Refined brief</h2><dl class="kv">
      ${[["Objective", b.objective], ["Audience", b.audience], ["Scope", b.scope], ["Tone", b.tone]].filter((x) => x[1]).map((x) => `<div><dt>${x[0]}</dt><dd>${esc(x[1])}</dd></div>`).join("")}</dl>
      ${b.key_points?.length ? `<p class="sub" style="margin-top:14px">Key points</p><ul class="points">${b.key_points.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
      <details><summary>Show raw JSON</summary>${code(b)}</details></section>`;
  }
  if (p.answers?.some((a) => a.answer)) {
    h += `<section><h2>Your answers</h2><div class="qa">${p.answers.filter((a) => a.answer).map((a) => `<div><b>${esc(a.question)}</b>${esc(a.answer)}</div>`).join("")}</div></section>`;
  }
  const r = state.research;
  if (r) {
    h += `<section><h2>Research</h2><p class="sub" style="margin:-8px 0 12px">${r.queries?.length || 0} searches, ${r.notes?.length || 0} topics, ${r.images?.length || 0} images found</p>
      <ol class="qlist">${(r.queries || []).map((q) => `<li>${esc(q)}</li>`).join("")}</ol>
      ${(r.notes || []).map((n) => `<details class="note"><summary>${esc(n.heading)}</summary><ul>${n.findings.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></details>`).join("")}</section>`;
  }
  if (p.sources?.length) {
    h += `<section><h2>Sources</h2><ul class="src">${p.sources.map((s) => `<li><a href="${esc(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title || domain(s.url))}</a><span>${esc(domain(s.url))}</span></li>`).join("")}</ul></section>`;
  }
  return h;
}

function activityHtml(events) {
  if (!events.length) return "";
  return `<section class="activity"><h2>Activity</h2><p class="sub">Every call the orchestrator made to the other services, with what it sent and got back.</p>
    <ol class="tl">${events.map((e) => {
      const open = state.openEv.has(e.id);
      return `<li class="ev ${e.status} ${open ? "open" : ""}"><button class="ev-head" type="button" data-act="ev" data-id="${e.id}" aria-expanded="${open}">
        <span class="ev-svc ${esc(e.service)}">${esc(e.service)}</span><span class="ev-op">${esc(e.operation)}</span>
        <span class="ev-st">${e.status === "OK" ? "OK" : e.status === "RUNNING" ? "Running" : "Error"}</span><span class="ev-ms">${e.duration_ms != null ? fmtMs(e.duration_ms) : ""}</span>${icon("chevron")}</button>
        ${open ? `<div class="ev-body"><div><div class="pane-h"><span>Request</span>${e.request ? copyBtn(e.request) : ""}</div>${code(e.request || "")}</div>
          <div><div class="pane-h"><span>Response</span>${e.response ? copyBtn(e.response) : ""}</div>${code(e.response || "Still running")}</div></div>` : ""}</li>`;
    }).join("")}</ol></section>`;
}

function mainStageHtml(p) {
  if (p.status === "NEEDS_INPUT") {
    return `<div class="ask"><h2>A few quick questions</h2><p class="sub">The brief check wants these cleared up before it starts researching. Leave any blank and it will make a sensible assumption.</p>
      <form id="answers-form">${p.questions.map((q, i) => `<label class="q"><span>${esc(q)}</span><textarea rows="2" data-q="${i}" placeholder="Your answer"></textarea></label>`).join("")}
      <div class="row-actions"><button class="btn primary" type="submit">Continue to research</button><button class="btn ghost" type="button" data-act="skip">Skip and use assumptions</button></div></form></div>`;
  }
  if (p.status === "COMPLETED" || (p.outline && slideList(p).length)) {
    const total = slideList(p).length;
    const work = state.events.reduce((a, e) => a + (e.duration_ms || 0), 0);
    const busy = ACTIVE.includes(p.status);
    const cur = p.outline?.theme || p.theme || "executive";
    return `<div class="deck-head"><div><h2>Your deck</h2></div><div class="stats"><span><b>${total}</b> slides</span><span><b>${p.sources.length}</b> sources</span>${work ? `<span><b>${fmtSec(work)}</b> total work</span>` : ""}</div></div>
      <div class="theme-row ${busy ? "busy" : ""}"><span>Theme</span><div class="swatches">${swatches(cur, "restyle")}</div>
        <small>${busy ? "Rebuilding the deck. This takes a few seconds." : "Pick another theme to rebuild the deck. No new web search is needed."}</small></div>
      <div id="viewer">${viewerHtml(p)}</div>`;
  }
  if (p.status === "FAILED") {
    return `<div class="ghost-stage"><div><strong>This deck could not be finished</strong><p>Check the activity log below to see which call failed, then retry.</p>
      <div class="errbox">${esc(p.error || "Unknown error")}</div></div></div>`;
  }
  const msg = { CREATED: ["Getting started", "The request is queued."], CHECKING_BRIEF: ["Reading your brief", "The brief check is deciding whether anything is missing."],
    RESEARCHING: ["Searching the web", "Searches run in parallel and every finding keeps its source link. This can take a minute or two."],
    BUILDING: ["Building your slides", "The outline is written and the PowerPoint file is rendered."] }[p.status] || ["Working", ""];
  return `<div class="ghost-stage"><div><strong>${msg[0]}</strong><p>${msg[1]}</p></div></div>`;
}

function projectHtml(p, events) {
  const [label, tone] = statusOf(p.status);
  const total = events.reduce((a, e) => a + (e.duration_ms || 0), 0);
  return `<div class="p-head"><div class="p-title"><h1>${esc(p.topic)}</h1><span class="p-status ${tone}"><i></i>${label}</span></div>
      <div class="p-actions">
        ${p.has_deck ? `<button class="btn primary" type="button" data-act="download">${icon("download")}Download .pptx</button>` : ""}
        ${p.status === "FAILED" ? `<button class="btn ghost" type="button" data-act="retry">${icon("refresh")}Retry</button>` : ""}
        <button class="btn ghost danger" type="button" data-act="delete">${icon("trash")}Delete</button></div></div>
    <dl class="p-meta">
      <div><dt>Project ID</dt><dd><button type="button" data-act="copy-id" title="Copy ID">${esc(p.id.slice(0, 8))}${icon("copy")}</button></dd></div>
      <div><dt>Started</dt><dd>${parseTs(p.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</dd></div>
      <div><dt>Audience</dt><dd>${esc(p.audience || p.brief?.audience || "Not set")}</dd></div>
      <div><dt>Slides</dt><dd>${p.slide_count || p.brief?.slide_count || "Auto"}</dd></div>
      ${total ? `<div><dt>Work time</dt><dd>${fmtSec(total)}</dd></div>` : ""}</dl>
    ${pipelineHtml(p, events)}
    <div class="work"><div class="work-main">${mainStageHtml(p)}</div><aside class="work-side">${sideHtml(p)}</aside></div>
    ${activityHtml(events)}`;
}

function renderMain(force = false) {
  stopMic();
  const p = state.project;
  if (state.view === "new" || !p) { $("main").innerHTML = composerHtml(); return; }
  const sig = JSON.stringify([p.id, p.status, p.updated_at, state.events.map((e) => [e.id, e.status, e.duration_ms]), !!state.research, [...state.openEv]]);
  if (!force && sig === state.sig) return;
  state.sig = sig;
  // keep half-typed answers while polling
  const typed = [...document.querySelectorAll("#answers-form textarea")].map((t) => t.value);
  const scroll = window.scrollY;
  $("main").innerHTML = projectHtml(p, state.events);
  document.querySelectorAll("#answers-form textarea").forEach((t, i) => { if (typed[i]) t.value = typed[i]; });
  window.scrollTo(0, scroll);
}

/* ------------------------------------------------------------------ data flow */
async function loadList() {
  try { state.projects = await api("GET", "/projects", undefined, { quiet: true }); renderRail(); } catch { /* health shows it */ }
}

async function loadResearch(p) {
  if (state.researchFor === p.id || !["BUILDING", "COMPLETED"].includes(p.status)) return;
  state.researchFor = p.id;
  try { state.research = await api("GET", `/projects/${p.id}/research`, undefined, { quiet: p.status !== "COMPLETED" }); }
  catch { state.research = null; }
}

async function select(id, quiet = false) {
  if (!quiet) { state.view = "project"; if (state.selected !== id) { state.slide = 0; state.research = null; state.researchFor = null; state.openEv = new Set(); } }
  state.selected = id;
  try {
    const [project, events] = await Promise.all([
      api("GET", `/projects/${id}`, undefined, { quiet }),
      api("GET", `/projects/${id}/events`, undefined, { quiet }),
    ]);
    if (state.selected !== id || state.view !== "project") return; // user navigated away
    const hadResearch = !!state.research;
    state.project = project; state.events = events;
    await loadResearch(project);
    renderMain(!quiet || hadResearch !== !!state.research);
    renderRail();
  } catch (err) {
    if (!quiet) { $("main").innerHTML = `<div class="ghost-stage"><div><strong>Could not open this deck</strong><div class="errbox">${esc(errText(err))}</div></div></div>`; }
  }
}

async function checkHealth() {
  const el = $("health"), label = el.querySelector("span");
  try {
    const h = await api("GET", "/health", undefined, { quiet: true });
    label.textContent = `Services ${h.status === "ok" ? "online" : h.status}`; el.className = "health ok";
  } catch { label.textContent = "Services unreachable"; el.className = "health bad"; }
}

function clock() {
  document.querySelectorAll("[data-since]").forEach((el) => { el.textContent = fmtSec(Date.now() - parseTs(el.dataset.since)); });
}

async function loop() {
  state.tick += 1;
  clock();
  if (state.tick % 2 === 0 && state.view === "project" && state.selected && ACTIVE.includes(state.project?.status)) {
    const before = state.project.status;
    await select(state.selected, true);
    if (before !== state.project?.status) loadList();
  }
  if (state.tick % 10 === 0) { loadList(); checkHealth(); }
}

function goNew() {
  state.view = "new"; state.selected = null; state.project = null; state.sig = "";
  renderMain(); renderRail(); $("main").focus({ preventScroll: true }); window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ events */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act, id = state.selected;
  try {
    switch (act) {
      case "new": goNew(); break;
      case "mic": mic.on ? stopMic() : startMic(); break;
      case "select": await select(el.dataset.id); window.scrollTo(0, 0); break;
      case "draft-theme": state.draft.theme = el.dataset.v; document.querySelectorAll('[data-act="draft-theme"]').forEach((b) => { const on = b.dataset.v === el.dataset.v; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); }); break;
      case "restyle": {
        if (el.dataset.v === (state.project.theme || state.project.outline?.theme)) break;
        await api("POST", `/projects/${id}/rebuild`, { theme: el.dataset.v });   // research is reused, only the deck is rebuilt
        toast("Rebuilding the deck in the new theme"); await select(id, true); renderMain(true); loadList(); break;
      }
      case "aud": $("f-audience").value = el.dataset.v; state.draft.audience = el.dataset.v; break;
      case "sample": {
        const s = SAMPLES[el.dataset.sample];
        state.draft = { ...state.draft, topic: s.topic, description: s.description, audience: s.audience, slides: s.slides };
        renderMain(); break;
      }
      case "prev": state.slide = Math.max(0, state.slide - 1); renderViewer(); break;
      case "next": state.slide += 1; renderViewer(); break;
      case "thumb": state.slide = Number(el.dataset.i); renderViewer(); break;
      case "ev": {
        const n = Number(el.dataset.id);
        state.openEv.has(n) ? state.openEv.delete(n) : state.openEv.add(n);
        renderMain(true); break;
      }
      case "c-row": {
        const k = el.dataset.id;
        state.consoleOpen.has(k) ? state.consoleOpen.delete(k) : state.consoleOpen.add(k);
        renderConsole(); break;
      }
      case "console-toggle": setConsole($("console").classList.contains("collapsed")); break;
      case "console-clear": state.console = []; state.consoleOpen.clear(); renderConsole(); break;
      case "copy": navigator.clipboard?.writeText(el.dataset.copy ?? "").then(() => toast("Copied"), () => toast("Copy is blocked by the browser", "err")); break;
      case "copy-id": navigator.clipboard?.writeText(id).then(() => toast("Project ID copied"), () => toast(id)); break;
      case "download": {
        const { blob, filename } = await api("GET", `/projects/${id}/download`, undefined, { blob: true });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = filename || "deck.pptx"; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        toast("Download started"); break;
      }
      case "retry": state.researchFor = null; state.research = null; await api("POST", `/projects/${id}/retry`); await select(id, true); renderMain(true); loadList(); break;
      case "skip": state.researchFor = null; await api("POST", `/projects/${id}/answers`, { answers: [] }); await select(id, true); renderMain(true); loadList(); break;
      case "delete":
        if (el.dataset.sure !== "1") {
          el.dataset.sure = "1"; el.lastChild.textContent = "Click again to delete"; el.classList.add("danger");
          setTimeout(() => { if (el.isConnected) { el.dataset.sure = ""; el.lastChild.textContent = "Delete"; } }, 3500);
          break;
        }
        await api("DELETE", `/projects/${id}`); toast("Deck deleted"); await loadList(); goNew(); break;
    }
  } catch (err) { toast(errText(err), "err"); }
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  try {
    if (f.id === "create-form") {
      const topic = $("f-topic").value.trim().replace(/\s+/g, " ");
      if (topic.length < 3) { toast("Give the deck a topic of at least 3 characters", "err"); $("f-topic").focus(); return; }
      const body = { topic, description: $("f-description").value, slide_count: Number($("f-slides").value), theme: state.draft.theme };
      if ($("f-audience").value.trim()) body.audience = $("f-audience").value.trim();
      const btn = $("create-btn"); btn.disabled = true;
      try {
        const p = await api("POST", "/projects", body);
        state.draft = { topic: "", description: "", audience: "", slides: 9, theme: state.draft.theme };
        await loadList(); await select(p.id); window.scrollTo(0, 0);
      } finally { btn.disabled = false; }
    } else if (f.id === "answers-form") {
      const answers = [...f.querySelectorAll("textarea")].map((ta) => ({ question: state.project.questions[Number(ta.dataset.q)], answer: ta.value.trim() }));
      state.researchFor = null;
      await api("POST", `/projects/${state.selected}/answers`, { answers });
      await select(state.selected, true); renderMain(true); loadList();
    }
  } catch (err) { toast(errText(err), "err"); }
});

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "f-topic") state.draft.topic = t.value;
  else if (t.id === "f-audience") state.draft.audience = t.value;
  else if (t.id === "f-description") { syncDesc(); if (mic.on) { mic.base = t.value && !/\s$/.test(t.value) ? t.value + " " : t.value; mic.final = ""; } }
  else if (t.id === "f-slides") { state.draft.slides = Number(t.value); $("slides-out").textContent = t.value; }
});
// Enter in the title field submits the form instead of adding a line break
document.addEventListener("keydown", (ev) => {
  if (ev.target.id === "f-topic" && ev.key === "Enter") { ev.preventDefault(); $("f-description").focus(); return; }
  if (ev.target.closest?.("input, textarea")) return;
  if (state.view !== "project" || !$("viewer")) return;
  if (ev.key === "ArrowRight") { state.slide += 1; renderViewer(); }
  if (ev.key === "ArrowLeft") { state.slide = Math.max(0, state.slide - 1); renderViewer(); }
});
$("show-polling").addEventListener("change", renderConsole);

/* ------------------------------------------------------------------ start */
renderMain();
renderRail();
renderConsole();
checkHealth();
loadList();
setInterval(loop, 1000);
