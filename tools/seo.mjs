// Static entry pages for search engines and clean URLs. Zero dependencies.
//
//   node tools/seo.mjs https://jey-key30.github.io/render-vision-website/ [_site]
//
// Copies site/ to the output folder (default _site/) and adds:
//   index.html, en/, ru/                       home in each language
//   <lang>/work/<id>/index.html                 one page per project
//   <lang>/privacy/index.html                   privacy policy
//   404.html, sitemap.xml, robots.txt
// Each page is site/index.html with its own <title>, description, canonical, hreflang,
// Open Graph, JSON-LD and prerendered text, so crawlers see content without running JS.
// site/ itself is never modified and keeps working on its own (hash routes).

import fs from "node:fs";
import path from "node:path";

function build(html, data, siteUrl) {
  const SITE = siteUrl.replace(/\/?$/, "/");
  const s0 = html.indexOf("const I18N = "), s1 = html.indexOf("\n};", s0);
  if (s0 < 0 || s1 < 0) throw new Error("seo: I18N object not found in site/index.html");
  const I18N = Function("return " + html.slice(s0 + 13, s1 + 2))();
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const filled = v => v != null && String(v).trim() !== "" && String(v).trim() !== "\u2014";
  const tx = (v, l) => v && typeof v === "object" && !Array.isArray(v) ? (v[l] ?? v.en ?? "") : v;
  const summary = (p, l) => l === "ru" && filled(p.summary_ru) ? p.summary_ru : p.summary;
  const clip = s => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > 160 ? s.slice(0, 157).replace(/\s+\S*$/, "") + "…" : s; };
  const abs = u => /^https?:/.test(u) ? u : SITE + String(u).replace(/^\.?\//, "");
  const tail = r => r.id ? "work/" + encodeURIComponent(r.id) + "/" : r.page ? r.page + "/" : "";
  const url = (l, r) => SITE + l + "/" + tail(r);
  const LANGS = ["en", "ru"];
  const projects = data.projects || [];
  // ids become folder names under <lang>/work/
  for (const p of projects) if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id || "")) throw new Error("seo: bad project id " + JSON.stringify(p.id) + " (a-z, 0-9, dashes)");
  const person = {
    "@type": "Person", name: "Kirill", alternateName: "J-K3.0", jobTitle: "CG Generalist, 3D Artist", url: SITE,
    image: abs("assets/portrait.jpg"), email: "mailto:freelancejeykey@gmail.com",
    address: { "@type": "PostalAddress", addressLocality: "Moscow", addressCountry: "RU" },
    knowsAbout: ["3D modeling", "Hard-surface modeling", "Blender", "Geometry Nodes", "VFX", "Lookdev", "Game-ready assets"],
    sameAs: ["https://www.artstation.com/j-k30", "https://sketchfab.com/J-K3.0", "https://www.youtube.com/@Jey-Key_3.0",
      "https://www.instagram.com/jey_key_30/", "https://t.me/J_K_3_0", "https://t.me/j_k_3d_blog"]
  };
  const ld = o => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...o }).replace(/</g, "\\u003c")}</script>`;

  const card = (p, l) => `<a class="card" href="${l}/work/${encodeURIComponent(p.id)}/"><div class="thumb"${p.thumbRatio ? ` style="aspect-ratio:${esc(p.thumbRatio)}"` : ""}>` +
    (p.thumb ? `<img src="${esc(p.thumb)}" alt="${esc(p.title)}" loading="lazy">` : "") + `<div class="badge">${esc(p.kindKey || "IMAGE")}</div></div>` +
    `<div class="cap"><span>${esc(p.title)}</span><span class="year">${filled(p.year) ? esc(p.year) : ""}</span></div>${filled(p.role) ? `<div class="role">${esc(p.role)}</div>` : ""}</a>`;

  const experience = (l, T) => [["work", "exp.work"], ["edu", "exp.edu"]].map(([kind, label]) => {
    const rows = ((data.about && data.about.experience) || []).filter(r => (r.kind || "work") === kind);
    if (!rows.length) return "";
    return `<div class="exp"><div class="label">${T(label)}</div>` + rows.map(r => {
      const pts = (tx(r.points, l) || []).filter(filled);
      return `<div class="exp-row"><i>${esc(tx(r.period, l))}</i><div><b>${esc(tx(r.role, l))}</b>` +
        (filled(tx(r.company, l)) ? `<span class="co">${esc(tx(r.company, l))}</span>` : "") + `</div><div>` +
        (filled(tx(r.lead, l)) ? `<p>${esc(tx(r.lead, l))}</p>` : "") +
        (pts.length ? "<ul>" + pts.map(x => `<li>${esc(x)}</li>`).join("") + "</ul>" : "") + `</div></div>`;
    }).join("") + `</div>`;
  }).join("");

  const projectBody = (p, l, T) => {
    const s = summary(p, l), imgs = (p.media || []).filter(m => m.t === "image" && m.src);
    const facts = [["p.year", p.year], ["p.role", p.role], ["p.software", p.software], ["p.tris", p.tris]]
      .filter(([, v]) => filled(v)).map(([k, v]) => `<div><u>${T(k)}</u>${esc(v)}</div>`).join("");
    return `<div class="crumbs"><a href="${l}/">${T("p.back")}</a>` +
      (p.artstationUrl ? `<a href="${esc(p.artstationUrl)}" target="_blank" rel="noopener">${T("p.as")}</a>` : "") + `</div>` +
      `<article class="info" style="display:flex;flex-direction:column;gap:20px">` +
      (filled(p.topic) ? `<div class="eyebrow">${esc(p.topic)}</div>` : "") +
      `<h1 class="p-title" style="margin:0">${esc(p.title)}</h1>` + (filled(s) ? `<p class="sub">${esc(s)}</p>` : "") +
      (facts ? `<div class="facts">${facts}</div>` : "") + `</article>` +
      (imgs.length ? `<div class="strip" style="padding-top:24px">` +
        imgs.map((m, i) => `<img src="${esc(m.sm || m.src)}" alt="${esc(p.title)} — ${T("a.render")} ${i + 1}" loading="lazy">`).join("") + `</div>` : "");
  };

  function page(file, lang, o) {
    const T = k => I18N[lang][k] ?? I18N.en[k] ?? k;
    const cut = html.lastIndexOf("<script>");
    let h = html.slice(0, cut);
    const js = html.slice(cut);
    const depth = file.split("/").length - 1;
    const base = o.base ?? "../".repeat(depth);
    const set = (re, v) => { h = h.replace(re, (m, a) => a + v); };

    h = h.replace('<meta charset="utf-8">', m => m + (base ? `\n<base href="${base}">` : "") + `\n<meta name="rv-static" content="${esc(SITE)}">`);
    h = h.replace('<html lang="en">', `<html lang="${lang}">`);
    h = h.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(o.title)}</title>`);
    set(/(<meta name="description" content=")[^"]*/, esc(o.desc));
    set(/(<meta property="og:title" content=")[^"]*/, esc(o.title));
    set(/(<meta property="og:description" content=")[^"]*/, esc(o.desc));
    set(/(<meta property="og:image" content=")[^"]*/, esc(abs(o.image || "assets/og.jpg")));
    if (o.image) h = h.replace(/<meta property="og:image:(width|height)"[^>]*>\n/g, "");
    const extra = [`<meta property="og:locale" content="${lang === "ru" ? "ru_RU" : "en_US"}">`];
    if (o.robots) extra.push(`<meta name="robots" content="${o.robots}">`);
    if (o.r) {
      const canon = o.canonical || url(lang, o.r);
      extra.push(`<meta property="og:url" content="${esc(canon)}">`, `<link rel="canonical" href="${esc(canon)}">`);
      LANGS.forEach(l => extra.push(`<link rel="alternate" hreflang="${l}" href="${esc(url(l, o.r))}">`));
      extra.push(`<link rel="alternate" hreflang="x-default" href="${esc(tail(o.r) ? url("en", o.r) : SITE)}">`);
    }
    if (o.ld) extra.push(ld(o.ld));
    h = h.replace("</head>", extra.join("\n") + "\n</head>");

    h = h.replace(/(<([a-z0-9]+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => open + T(key) + close);
    h = h.replace(/placeholder="[^"]*"(\s+data-i18n-ph="([^"]+)")/g, (m, rest, key) => `placeholder="${esc(T(key))}"` + rest);
    h = h.replace(/<a data-pp/g, `<a data-pp href="${lang}/privacy/"`);
    h = h.replace(/(<button data-lang="(en|ru)")/g, (m, a, l) => a + ` aria-pressed="${l === lang}"` + (l === lang ? ' class="on"' : ""));
    h = h.replace(/(<span id="syncLabel">)[^<]*/, (m, a) => a + T("work.source"));
    h = h.replace(/(<b id="statTotal">)[^<]*/, (m, a) => a + projects.length);
    h = h.replace('<div class="gridwrap" id="grid"></div>', () => `<div class="gridwrap" id="grid">${projects.map(p => card(p, lang)).join("")}</div>`);
    h = h.replace('<div id="expRoot"></div>', () => `<div id="expRoot">${experience(lang, T)}</div>`);
    if (o.body) {
      h = h.replace('<main id="home" tabindex="-1">', '<main id="home" tabindex="-1" style="display:none">');
      h = h.replace('<main id="project" tabindex="-1"></main>', () => `<main id="project" tabindex="-1" style="display:block">${o.body(T)}</main>`);
    }
    return h + js;
  }

  const out = {};
  const homeLd = { "@type": "WebSite", name: "Render Vision", url: SITE, author: person, inLanguage: ["en", "ru"] };
  out["index.html"] = page("index.html", "en", { r: {}, canonical: url("en", {}), title: I18N.en.title, desc: I18N.en.desc, ld: homeLd });
  for (const l of LANGS) {
    const T = k => I18N[l][k] ?? I18N.en[k];
    out[l + "/index.html"] = page(l + "/index.html", l, { r: {}, title: T("title"), desc: T("desc"), ld: { ...homeLd, inLanguage: l } });
    for (const p of projects) {
      const s = summary(p, l), img = ((p.media || []).find(m => m.t === "image" && m.src) || {}).src || p.thumb;
      const imgs = (p.media || []).filter(m => m.t === "image" && m.src).slice(0, 6).map(m => abs(m.src));
      out[`${l}/work/${p.id}/index.html`] = page(`${l}/work/${p.id}/index.html`, l, {
        r: { id: p.id }, title: p.title + " — Render Vision", desc: filled(s) ? clip(s) : T("desc"), image: img,
        body: T => projectBody(p, l, T),
        ld: {
          "@type": "VisualArtwork", name: p.title, url: url(l, { id: p.id }), inLanguage: l,
          ...(filled(s) ? { description: clip(s) } : {}), ...(imgs.length ? { image: imgs } : {}),
          ...(filled(p.year) ? { dateCreated: String(p.year) } : {}), ...(filled(p.software) ? { artMedium: p.software } : {}),
          ...(p.artstationUrl ? { sameAs: [p.artstationUrl, p.sketchfabUrl].filter(Boolean) } : {}),
          creator: { "@type": "Person", name: "Kirill", url: SITE }
        }
      });
    }
    out[`${l}/privacy/index.html`] = page(`${l}/privacy/index.html`, l, {
      r: { page: "privacy" }, title: T("pp.title"), desc: T("desc"),
      body: T => `<div class="crumbs"><a href="${l}/">${T("p.back")}</a></div><article class="legal"><div class="eyebrow">RENDER VISION</div><h1>${T("pp.h")}</h1>${T("pp.body")}</article>`
    });
  }
  out["404.html"] = page("404.html", "en", {
    base: new URL(SITE).pathname, robots: "noindex", title: I18N.en["title.nf"], desc: I18N.en.desc,
    body: T => `<div class="nf"><div class="code">404</div><h1 class="h1" style="margin:0">${T("nf.h")}</h1><p class="sub">${T("nf.p")}</p><div class="socials"><a href="en/" style="background:var(--red);color:var(--ink);border-color:var(--red);padding:12px 20px">${T("nf.back")}</a></div></div>`
  });

  const routes = [{}, ...projects.map(p => ({ id: p.id })), { page: "privacy" }];
  const alt = r => LANGS.map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(url(l, r))}"/>`).join("");
  out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    routes.flatMap(r => LANGS.map(l => `<url><loc>${esc(url(l, r))}</loc>${alt(r)}</url>`)).join("\n") + `\n</urlset>\n`;
  out["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`;
  return out;
}

/* MAIN */
const [, , siteUrl, outDir = "_site"] = process.argv;
if (!siteUrl) { console.error("usage: node tools/seo.mjs <site-url> [out-dir]"); process.exit(1); }
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync("site", outDir, { recursive: true, filter: src => path.basename(src) !== "README.md" });   // notes stay out of the published site
const files = build(
  fs.readFileSync("site/index.html", "utf8"),
  JSON.parse(fs.readFileSync("site/data/portfolio.json", "utf8")),
  siteUrl
);
for (const [f, c] of Object.entries(files)) {
  const p = path.join(outDir, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}
console.log(`seo: ${Object.keys(files).length} files → ${outDir}/`);
