/* Slide preview renderer. Draws each slide of the outline in HTML so it matches the downloaded .pptx:
   same layouts, same theme colours, same text-fitting rules as builder-service/app/render.py.
   Geometry is in inches (the real slide is 13.333 x 7.5 in) converted to container-query units. */
"use strict";
(function () {
  const IN = 100 / 13.333;   // 1 inch in cqw
  const PT = IN / 72;        // 1 point in cqw
  const e = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cq = (inches) => `${(inches * IN).toFixed(3)}cqw`;
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const num = (v) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

  function box(cls, l, t, w, h, inner = "", style = "") {
    return `<div class="${cls}" style="left:${cq(l)};top:${cq(t)};width:${cq(w)};${h != null ? `height:${cq(h)};` : ""}${style}">${inner}</div>`;
  }

  /* Same estimate as render._fit: largest font size (pt) at which the items should fit. */
  function fit(items, widthIn, heightIn, sizes = [22, 20, 18, 17, 16, 15, 14, 13, 12], gap = 10) {
    for (const size of sizes) {
      const cpl = Math.max(8, ((widthIn - 0.45) * 72) / (size * 0.5));
      const lines = items.reduce((a, i) => a + Math.max(1, Math.ceil(String(i).length / cpl)), 0);
      if (lines * size * 1.28 + items.length * gap <= heightIn * 72) return size;
    }
    return sizes[sizes.length - 1];
  }

  function leadify(text) {
    const i = text.indexOf(": ");
    if (i >= 2 && i <= 46 && text.slice(i + 2).trim()) return `<b>${e(text.slice(0, i + 2))}</b>${e(text.slice(i + 2))}`;
    return e(text);
  }
  const ul = (items, pt, gap = 10) =>
    `<ul class="sp-ul" style="font-size:${(pt * PT).toFixed(3)}cqw;gap:${(gap * PT).toFixed(3)}cqw">${items.map((b) => `<li>${leadify(b)}</li>`).join("")}</ul>`;

  /* ---- frame shared by content slides */
  function frame(s, ctx, bodyHtml) {
    const title = s.title || "";
    const size = title.length <= 60 ? 28 : title.length <= 85 ? 25 : 22;
    const doms = [];
    for (const i of s.from_notes || []) for (const u of ctx.research?.notes?.[i]?.source_urls || []) if (!doms.includes(host(u))) doms.push(host(u));
    const src = doms.length ? "Sources: " + doms.slice(0, 3).join(", ") : "";
    return `<div class="sp-strip"></div><div class="sp-block"></div>` +
      box("sp-title", 0.85, 0.38, 11.65, 1.0, `<span style="font-size:${(size * PT).toFixed(3)}cqw">${e(title)}</span>`) +
      (s.takeaway ? box("sp-take", 0.85, 1.42, 11.65, 0.5, e(s.takeaway)) : "") +
      bodyHtml +
      (src ? box("sp-src", 0.85, 6.72, 11.65, 0.3, e(src)) : "") +
      box("sp-line", 0.85, 7.04, 11.65, 0) +
      box("sp-foot", 0.85, 7.08, 9, 0.3, e(ctx.label)) + box("sp-foot r", 11.5, 7.08, 1.0, 0.3, String(ctx.num));
  }

  const TOP = 2.05, BOTTOM = 6.6, W = 11.65, L = 0.85;

  /* ---- layouts */
  function bulletsLayout(s, ctx) {
    const img = s.image_index != null ? ctx.research?.images?.[s.image_index] : null;
    const width = img ? 7.3 : W;
    const pt = fit(s.bullets, width, BOTTOM - TOP);
    let html = box("sp-body", L, TOP, width, BOTTOM - TOP, ul(s.bullets, pt, pt >= 18 ? 12 : 9));
    if (img) {
      html += box("sp-img", 8.5, TOP, 4.0, 4.0, `<img src="${e(img.url)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentNode.remove()">`) +
        (img.caption ? box("sp-cap", 8.5, 6.1, 4.0, 0.5, e(img.caption) + " (Wikipedia)") : "");
    }
    return html;
  }

  function statsLayout(s) {
    const n = s.stats.length, gap = 0.3, cw = (W - gap * (n - 1)) / n;
    const hasB = s.bullets?.length > 0, ch = hasB ? 2.35 : 3.4;
    let html = "";
    s.stats.forEach((st, i) => {
      const x = L + i * (cw + gap), v = st.value.length <= 7 ? 44 : st.value.length <= 11 ? 36 : 28;
      html += box("sp-card", x, TOP, cw, ch) + box("sp-cardbar", x, TOP, cw, 0.08) +
        box("sp-statv", x + 0.15, TOP + 0.25, cw - 0.3, 1.0, e(st.value), `font-size:${(v * PT).toFixed(3)}cqw`) +
        box("sp-statl", x + 0.15, TOP + 1.3, cw - 0.3, ch - 1.4,
          `<b style="font-size:${((hasB ? 15 : 17) * PT).toFixed(3)}cqw">${e(st.label)}</b>${st.context ? `<span style="font-size:${((hasB ? 12.5 : 14) * PT).toFixed(3)}cqw">${e(st.context)}</span>` : ""}`);
    });
    if (hasB) {
      const top = TOP + ch + 0.3, h = BOTTOM - top, pt = Math.min(18, fit(s.bullets, W, h));
      html += box("sp-body", L, top, W, h, ul(s.bullets, pt, 8));
    }
    return html;
  }

  function twoColLayout(s) {
    const gap = 0.4, cw = (W - gap) / 2, bh = BOTTOM - TOP - 0.6;
    return s.columns.map((c, i) => {
      const x = L + i * (cw + gap), pt = Math.min(19, fit(c.bullets, cw - 0.2, bh - 0.3));
      return box("sp-colhead" + (i ? " alt" : ""), x, TOP, cw, 0.6, e(c.heading)) + box("sp-colbody", x, TOP + 0.6, cw, bh) +
        box("sp-body", x + 0.2, TOP + 0.8, cw - 0.4, bh - 0.3, ul(c.bullets, pt, 10));
    }).join("");
  }

  function processLayout(s) {
    const k = s.steps.length, gap = 0.25, w = (W - gap * (k - 1)) / k, cardTop = TOP + 0.5, cardH = Math.min(BOTTOM - cardTop, 3.5);
    let html = box("sp-conn", L + w / 2, cardTop, (k - 1) * (w + gap), 0);
    s.steps.forEach((st, i) => {
      const x = L + i * (w + gap), ts = k <= 4 ? 19 : 17;
      const tl = Math.max(1, Math.ceil(st.title.length / Math.max(8, ((w - 0.3) * 72) / (ts * 0.52)))), th = (tl * ts * 1.25) / 72 + 0.1, dTop = 0.55 + th + 0.1;
      const dp = Math.min(17, fit([st.detail], w - 0.2, cardH - dTop - 0.2, [17, 16, 15, 14, 13, 12]));
      html += box("sp-card", x, cardTop, w, cardH) + box("sp-num", x + w / 2 - 0.35, cardTop - 0.35, 0.7, 0.7, String(i + 1)) +
        box("sp-steph", x + 0.15, cardTop + 0.5, w - 0.3, th, e(st.title), `font-size:${(ts * PT).toFixed(3)}cqw`) +
        box("sp-stepd", x + 0.15, cardTop + dTop, w - 0.3, cardH - dTop - 0.2, e(st.detail), `font-size:${(dp * PT).toFixed(3)}cqw`);
    });
    return html;
  }

  function tableLayout(s) {
    const t = s.table, rows = t.rows.length + 1, longest = Math.max(0, ...t.rows.flat().map((c) => c.length));
    const size = longest <= 40 && rows <= 5 ? 15 : longest <= 70 ? 13 : 12;
    const h = Math.min(BOTTOM - TOP, 0.62 * rows + 0.3), rowH = h / rows;
    const first = t.headers.length > 2 ? 26 : 35;
    const cols = t.headers.map((_, i) => `<col style="width:${i === 0 ? first : (100 - first) / (t.headers.length - 1)}%">`).join("");
    const th = t.headers.map((x) => `<th style="font-size:${((size + 1) * PT).toFixed(3)}cqw">${e(x)}</th>`).join("");
    const tr = t.rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="f"' : ""} style="font-size:${(size * PT).toFixed(3)}cqw">${e(c)}</td>`).join("")}</tr>`).join("");
    return box("sp-table", L, TOP, W, h, `<table style="--rh:${cq(rowH)}"><colgroup>${cols}</colgroup><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
  }

  /* ---- charts (inline SVG in 1/100 inch units) */
  function chartSvg(ch, wIn, hIn) {
    const W_ = wIn * 100, H_ = hIn * 100, fs = (pt) => ((pt * 100) / 72).toFixed(1);
    const n = ch.categories.length, series = ch.series, multi = series.length > 1;
    const col = (i) => `var(--c${(i % 6) + 1})`;
    let g = "";
    if (ch.kind === "pie") {
      const vals = series[0].values, total = vals.reduce((a, b) => a + b, 0) || 1;
      const r = Math.min(H_ * 0.42, W_ * 0.26), cx = W_ * 0.32, cy = H_ / 2;
      let a0 = -Math.PI / 2;
      vals.forEach((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0;
        const p = (a) => `${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`;
        g += `<path d="M${cx} ${cy} L${p(a0)} A${r} ${r} 0 ${big} 1 ${p(a1)}Z" fill="${col(i)}" stroke="#fff" stroke-width="3"/>`;
        const am = (a0 + a1) / 2;
        g += `<text x="${(cx + r * 0.65 * Math.cos(am)).toFixed(1)}" y="${(cy + r * 0.65 * Math.sin(am) + 5).toFixed(1)}" text-anchor="middle" font-size="${fs(12)}" font-weight="700" fill="#fff">${Math.round((v / total) * 100)}%</text>`;
        g += `<rect x="${W_ * 0.62}" y="${H_ / 2 - n * 15 + i * 30 - 9}" width="18" height="18" fill="${col(i)}"/><text x="${W_ * 0.62 + 28}" y="${H_ / 2 - n * 15 + i * 30 + 6}" font-size="${fs(12)}" fill="var(--t-ink)">${e(ch.categories[i])}</text>`;
        a0 = a1;
      });
      return `<svg viewBox="0 0 ${W_} ${H_}" class="sp-svg">${g}</svg>`;
    }
    const all = series.flatMap((s) => s.values), max = Math.max(...all, 0), min = Math.min(...all, 0);
    const lo = min < 0 ? min : 0;
    let hi = max === min ? max + 1 : max + (max - min) * 0.08;
    if (lo === 0 && max > 0) {   // round the axis up to a tidy number so the gridline labels read well
      const raw = max / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
      const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map((m) => m * mag).find((x) => x * 4 >= max * 1.02) || raw;
      hi = step * 4;
    }
    const legendH = multi ? 36 : 0, pad = { l: ch.kind === "bar" ? 120 : 44, r: 24, t: 28, b: (ch.kind === "bar" ? 16 : 40) + legendH };
    const pw = W_ - pad.l - pad.r, ph = H_ - pad.t - pad.b;
    if (ch.kind === "bar") {
      const slot = ph / n, bw = (slot / (1 + 0.6)) / series.length;
      series.forEach((s, si) => s.values.forEach((v, i) => {
        const y = pad.t + slot * i + (slot - bw * series.length) / 2 + si * bw, w = (Math.abs(v) / (hi - lo)) * pw;
        g += `<rect x="${pad.l}" y="${y.toFixed(1)}" width="${Math.max(2, w).toFixed(1)}" height="${bw.toFixed(1)}" fill="${col(si)}"/>` +
          `<text x="${(pad.l + w + 8).toFixed(1)}" y="${(y + bw / 2 + 5).toFixed(1)}" font-size="${fs(12)}" font-weight="700" fill="var(--t-ink)">${num(v)}</text>`;
      }));
      ch.categories.forEach((c, i) => (g += `<text x="${pad.l - 10}" y="${(pad.t + slot * i + slot / 2 + 5).toFixed(1)}" text-anchor="end" font-size="${fs(12)}" fill="var(--t-ink)">${e(c.length > 16 ? c.slice(0, 15) + "…" : c)}</text>`));
    } else {
      for (let t = 0; t <= 4; t++) {
        const y = pad.t + ph - (ph * t) / 4, v = lo + ((hi - lo) * t) / 4;
        g += `<line x1="${pad.l}" x2="${pad.l + pw}" y1="${y}" y2="${y}" stroke="var(--t-line)"/><text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="${fs(11)}" fill="var(--t-muted)">${num(v)}</text>`;
      }
      const slot = pw / n, yOf = (v) => pad.t + ph - ((v - lo) / (hi - lo)) * ph;
      if (ch.kind === "line") {
        series.forEach((s, si) => {
          const pts = s.values.map((v, i) => `${(pad.l + slot * i + slot / 2).toFixed(1)},${yOf(v).toFixed(1)}`);
          g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${col(si)}" stroke-width="4" stroke-linejoin="round"/>`;
          s.values.forEach((v, i) => (g += `<circle cx="${(pad.l + slot * i + slot / 2).toFixed(1)}" cy="${yOf(v).toFixed(1)}" r="6" fill="${col(si)}"/><text x="${(pad.l + slot * i + slot / 2).toFixed(1)}" y="${(yOf(v) - 12).toFixed(1)}" text-anchor="middle" font-size="${fs(12)}" font-weight="700" fill="var(--t-ink)">${num(v)}</text>`));
        });
      } else {
        const bw = slot / 1.6 / series.length;
        series.forEach((s, si) => s.values.forEach((v, i) => {
          const x = pad.l + slot * i + (slot - bw * series.length) / 2 + si * bw, y = yOf(Math.max(v, 0)), h = Math.abs(yOf(v) - yOf(0));
          g += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${col(si)}"/>` +
            `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle" font-size="${fs(12)}" font-weight="700" fill="var(--t-ink)">${num(v)}</text>`;
        }));
      }
      ch.categories.forEach((c, i) => (g += `<text x="${(pad.l + slot * i + slot / 2).toFixed(1)}" y="${pad.t + ph + 26}" text-anchor="middle" font-size="${fs(12)}" fill="var(--t-ink)">${e(c.length > 14 ? c.slice(0, 13) + "…" : c)}</text>`));
    }
    if (multi) series.forEach((s, i) => (g += `<rect x="${pad.l + i * 190}" y="${H_ - 26}" width="16" height="16" fill="${col(i)}"/><text x="${pad.l + i * 190 + 24}" y="${H_ - 12}" font-size="${fs(12)}" fill="var(--t-ink)">${e((s.name || "").slice(0, 22))}</text>`));
    return `<svg viewBox="0 0 ${W_} ${H_}" class="sp-svg">${g}</svg>`;
  }

  function chartLayout(s) {
    const ch = s.chart, side = s.bullets?.length > 0, cw = side ? 7.6 : W;
    const caption = ch.title + (ch.unit && !ch.title.includes(ch.unit) ? ` (${ch.unit})` : "");
    const top = caption ? TOP + 0.45 : TOP;
    let html = (caption ? box("sp-chcap", L, TOP, cw, 0.4, e(caption)) : "") + box("sp-chart", L, top, cw, BOTTOM - top, chartSvg(ch, cw, BOTTOM - top));
    if (side) {
      const x = L + cw + 0.3, w = W - cw - 0.3, pt = Math.min(17, fit(s.bullets, w - 0.2, BOTTOM - TOP - 0.8));
      html += box("sp-colbody", x, TOP, w, BOTTOM - TOP) + box("sp-sidehead", x + 0.15, TOP + 0.15, w - 0.3, 0.4, "What this shows") +
        box("sp-body", x + 0.15, TOP + 0.65, w - 0.3, BOTTOM - TOP - 0.8, ul(s.bullets, pt, 9));
    }
    return html;
  }

  /* ---- title, agenda, sources */
  function titleSlide(o, ctx) {
    const t = o.title || "", size = t.length <= 38 ? 44 : t.length <= 65 ? 38 : 32;
    const th = (Math.ceil(t.length / ((8.3 * 72) / (size * 0.52))) * size * 1.2) / 72;
    const meta = [o.audience ? `Prepared for ${o.audience}` : "", ctx.dateLabel].filter(Boolean).join("  |  ");
    return `<div class="sp-tbg"></div><div class="sp-tpanel" style="left:${cq(9.6)}"></div>` +
      `<div class="sp-circ" style="left:${cq(8.3)};top:${cq(3.6)};width:${cq(5.4)};height:${cq(5.4)}"></div>` +
      `<div class="sp-circ b" style="left:${cq(10.6)};top:${cq(-1.6)};width:${cq(3.8)};height:${cq(3.8)}"></div>` +
      box("sp-tbar", 0.9, 2.0, 1.5, 0.1) +
      box("sp-ttitle", 0.85, 2.25, 8.3, 2.4, e(t), `font-size:${(size * PT).toFixed(3)}cqw`) +
      (o.subtitle ? box("sp-tsub", 0.85, 2.25 + th + 0.35, 8.0, 1.2, e(o.subtitle)) : "") +
      box("sp-tmeta", 0.85, 6.55, 8.5, 0.4, e(meta));
  }

  function agendaSlide(o, ctx) {
    const items = (o.agenda || []).slice(0, 6), rowH = 0.82, top = (7.5 - rowH * items.length) / 2;
    return `<div class="sp-apanel" style="width:${cq(4.4)}"></div>` + box("sp-tbar", 0.7, 2.9, 1.0, 0.09) +
      box("sp-ahead", 0.65, 3.1, 3.4, 1.0, "Agenda") +
      items.map((it, i) => box("sp-num", 5.2, top + i * rowH + 0.06, 0.58, 0.58, String(i + 1)) + box("sp-aitem", 6.0, top + i * rowH, 6.6, 0.7, e(it))).join("") +
      box("sp-foot r", 11.5, 7.08, 1.0, 0.3, String(ctx.num));
  }

  function sourcesSlide(srcs, ctx) {
    const items = srcs.slice(0, 24), per = Math.ceil(items.length / 2), eh = Math.min(0.6, (BOTTOM - TOP) / per), big = per <= 7, cw = (W - 0.4) / 2;
    const body = items.map((s, idx) => {
      const col = Math.floor(idx / per), row = idx % per, t = s.title || s.url;
      return box("sp-source", L + col * (cw + 0.4), TOP + row * eh, cw, eh,
        `<b style="font-size:${((big ? 11.5 : 10) * PT).toFixed(3)}cqw">${idx + 1}.&nbsp; ${e(t.length > 66 ? t.slice(0, 65) + "…" : t)}</b><span style="font-size:${((big ? 9.5 : 8.5) * PT).toFixed(3)}cqw">${e(s.url.length > 78 ? s.url.slice(0, 77) + "…" : s.url)}</span>`);
    }).join("");
    return frame({ title: "Sources", takeaway: "Every figure in this deck traces back to one of these pages." }, ctx, body);
  }

  /* ---- entry point */
  function slide(s, ctx) {
    let inner, cls = "";
    if (s.kind === "title") { inner = titleSlide(ctx.outline, ctx); cls = "t"; }
    else if (s.kind === "agenda") { inner = agendaSlide(ctx.outline, ctx); cls = "a"; }
    else if (s.kind === "sources") inner = sourcesSlide(s.sources, ctx);
    else {
      const body = { stats: statsLayout, chart: chartLayout, table: tableLayout, two_column: twoColLayout, process: processLayout }[s.layout] || bulletsLayout;
      let html;
      try { html = body(s, ctx); } catch { html = bulletsLayout({ ...s, bullets: s.bullets?.length ? s.bullets : [s.title] }, ctx); }
      inner = frame(s, ctx, html);
    }
    return `<div class="slide ${cls}">${inner}</div>`;
  }

  window.SlidePreview = { slide };
})();
