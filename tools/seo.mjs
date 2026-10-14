// Static entry pages for search engines and clean URLs. Zero dependencies.
//
//   node tools/seo.mjs [site-url] [_site]      site-url defaults to BRAND.siteUrl in site/index.html
//
// Copies site/ to the output folder (default _site/) and adds:
//   en/, ru/                                   home in each language
//   index.html                                  fallback stub for the bare root (Cloudflare 301s "/" to /en/)
//   <lang>/work/<id>/index.html                 one page per project
//   <lang>/privacy/index.html                   privacy policy
//   404.html, sitemap.xml, robots.txt
// GitHub Pages cannot answer with a 301, so "/" → /en/ and renamed projects ("redirects" in portfolio.json)
// are Cloudflare Redirect Rules; the script prints the ones it expects. A renamed project gets no file here:
// without the rule its old address is the 404 page, whose script still opens the new one.
// Each page is site/index.html with its own <title>, description, canonical, hreflang,
// Open Graph, JSON-LD and prerendered text, so crawlers see content without running JS.
// site/ itself is never modified and keeps working on its own (hash routes).

import fs from "node:fs";
import path from "node:path";

// a top-level object literal from site/index.html: "const NAME = {" … "\n};"
function readConst(html, name) {
  const head = "const " + name + " = ", s0 = html.indexOf(head), s1 = html.indexOf("\n};", s0);
  if (s0 < 0 || s1 < 0) throw new Error("seo: " + name + " object not found in site/index.html");
  return Function("return " + html.slice(s0 + head.length, s1 + 2))();
}

function build(html, data, siteUrl) {
  const SITE = siteUrl.replace(/\/?$/, "/");
  const I18N = readConst(html, "I18N"), BRAND = readConst(html, "BRAND");
  const tr = l => k => BRAND.fill(I18N[l][k] ?? I18N.en[k] ?? k);   // same as L() in site/index.html
  const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const filled = v => v != null && String(v).trim() !== "" && String(v).trim() !== "\u2014";
  const tx = (v, l) => v && typeof v === "object" && !Array.isArray(v) ? (v[l] ?? v.en ?? "") : v;
  const summary = (p, l) => l === "ru" && filled(p.summary_ru) ? p.summary_ru : p.summary;
  // same format as rich() in site/index.html: blank line = paragraph, "- " lines = list
  const rich = s => String(s).split(/\n\s*\n/).map(block => {
    const head = [], items = [];
    block.split("\n").forEach(l => /^\s*-\s+/.test(l) ? items.push(l.replace(/^\s*-\s+/, "")) : l.trim() && head.push(l.trim()));
    return (head.length ? `<p>${esc(head.join(" "))}</p>` : "") + (items.length ? "<ul>" + items.map(x => `<li>${esc(x)}</li>`).join("") + "</ul>" : "");
  }).join("");
  const clip = s => { s = String(s).split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim(); return s.length > 160 ? s.slice(0, 157).replace(/\s+\S*$/, "") + "…" : s; };
  const abs = u => /^https?:/.test(u) ? u : SITE + String(u).replace(/^\.?\//, "");
  const tail = r => r.id ? "work/" + encodeURIComponent(r.id) + "/" : r.page ? r.page + "/" : "";
  const url = (l, r) => SITE + l + "/" + tail(r);
  const LANGS = ["en", "ru"];
  const all = data.projects || [];
  const projects = all.filter(p => p.status !== "soon");   // SOON: a card in the grid, no page of its own
  // ids become folder names under <lang>/work/
  for (const p of all) if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id || "")) throw new Error("seo: bad project id " + JSON.stringify(p.id) + " (a-z, 0-9, dashes)");
  const person = {
    "@type": "Person", name: "Kirill", alternateName: "J-K3.0", jobTitle: "CG Generalist, 3D Artist", url: SITE,
    image: abs("assets/portrait.jpg"), email: BRAND.link("email"),
    address: { "@type": "PostalAddress", addressLocality: "Yekaterinburg", addressCountry: "RU" },
    knowsAbout: ["3D modeling", "Hard-surface modeling", "Blender", "Geometry Nodes", "VFX", "Lookdev", "Game-ready assets", "Unreal Engine", "Environment art", "Point clouds"],
    sameAs: Object.values(BRAND.links)
  };
  // same as wrap() in site/index.html: .avif and .webp next to every .jpg. A bare <img> here would start the JPEG
  // download before the script swaps in its <picture>, and the browser would fetch the same image twice
  const pic = (src, attrs) => {
    const img = `<img src="${esc(src)}"${attrs}>`;
    if (!/\.jpe?g$/i.test(src)) return img;
    const b = esc(src.replace(/\.jpe?g$/i, ""));
    return `<picture><source srcset="${b}.avif" type="image/avif"><source srcset="${b}.webp" type="image/webp">${img}</picture>`;
  };
  const ld = o =>`<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", ...o }).replace(/</g, "\\u003c")}</script>`;

  // same markup as card() in site/index.html, status layers included
  const card = (p, l, T) => {
    const soon = p.status === "soon", st = p.status === "rework" ? " rework" : soon ? " soon" : "", tag = soon ? "div" : "a";
    const layer = soon ? `<div class="st"><b>SOON</b><i>${T("st.soon")}</i></div>`
      : p.status === "rework" ? `<div class="st"><span class="vh">REWORK</span><div class="tape" aria-hidden="true">${"<span></span>".repeat(9)}</div></div>` : "";
    return `<${tag} class="card${st}"${soon ? "" : ` href="${l}/work/${encodeURIComponent(p.id)}/"`}><div class="thumb"${p.thumbRatio ? ` style="aspect-ratio:${esc(p.thumbRatio)}"` : ""}>` +
      (p.thumb ? pic(p.thumb, ` alt="${esc(p.title)}" loading="lazy" decoding="async"`) : "") + `<div class="badge">${esc(p.kindKey || "IMAGE")}</div>${layer}</div>` +
      `<div class="cap"><span>${esc(p.title)}</span><span class="year">${filled(p.year) ? esc(p.year) : ""}</span></div>${filled(p.role) ? `<div class="role">${esc(p.role)}</div>` : ""}</${tag}>`;
  };

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
    const rework = p.status === "rework" ? `<div class="p-status"><b>REWORK</b>${T("st.reworkNote")}</div>` : "";
    return `<div class="crumbs"><a href="${l}/">${T("p.back")}</a>` +
      (p.artstationUrl ? `<a href="${esc(p.artstationUrl)}" target="_blank" rel="noopener">${T("p.as")}</a>` : "") + `</div>` +
      `<article class="info" style="display:flex;flex-direction:column;gap:20px">` +
      (filled(p.topic) ? `<div class="eyebrow">${esc(p.topic)}</div>` : "") +
      `<h1 class="p-title" style="margin:0">${esc(p.title)}</h1>` + (filled(s) ? `<div class="sub desc">${rich(s)}</div>` : "") +
      rework + (facts ? `<div class="facts">${facts}</div>` : "") + `</article>` +
      (imgs.length ? `<div class="strip" style="padding-top:24px">` +
        imgs.map((m, i) => pic(m.sm || m.src, ` alt="${esc(p.title)} — ${T("a.render")} ${i + 1}" loading="lazy" decoding="async"`)).join("") + `</div>` : "");
  };

  function page(file, lang, o) {
    const T = tr(lang);
    const cut = html.lastIndexOf("<script>");
    let h = html.slice(0, cut);
    const js = html.slice(cut);
    const depth = file.split("/").length - 1;
    // the root page needs a <base> too: route() moves the bare root to /<lang>/ with replaceState, and without
    // a base, lazy images and media resolved after that would point at /<lang>/assets/... (404)
    const base = o.base ?? (depth ? "../".repeat(depth) : new URL(SITE).pathname);
    const set = (re, v) => { h = h.replace(re, (m, a) => a + v); };

    h = h.replace('<meta charset="utf-8">', m => m + (base ? `\n<base href="${base}">` : "") + `\n<meta name="rv-static" content="${esc(SITE)}">`);
    h = h.replace('<html lang="en">', `<html lang="${lang}">`);
    h = h.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(o.title)}</title>`);
    set(/(<meta name="description" content=")[^"]*/, esc(o.desc));
    set(/(<meta property="og:title" content=")[^"]*/, esc(o.title));
    set(/(<meta property="og:description" content=")[^"]*/, esc(o.desc));
    set(/(<meta name="twitter:title" content=")[^"]*/, esc(o.title));
    set(/(<meta name="twitter:description" content=")[^"]*/, esc(o.desc));
    set(/(<meta property="og:site_name" content=")[^"]*/, esc(BRAND.full));
    set(/(<meta property="og:image" content=")[^"]*/, esc(abs(o.image || "assets/og.jpg")));
    if (o.image) h = h.replace(/<meta property="og:image:(width|height)"[^>]*>\n/g, "");
    const extra = [`<meta property="og:locale" content="${lang === "ru" ? "ru_RU" : "en_US"}">`];
    if (o.robots) extra.push(`<meta name="robots" content="${o.robots}">`);
    if (o.r) {
      const canon = o.canonical || url(lang, o.r);
      extra.push(`<meta property="og:url" content="${esc(canon)}">`, `<link rel="canonical" href="${esc(canon)}">`);
      LANGS.forEach(l => extra.push(`<link rel="alternate" hreflang="${l}" href="${esc(url(l, o.r))}">`));
      extra.push(`<link rel="alternate" hreflang="x-default" href="${esc(url("en", o.r))}">`);
    }
    if (o.ld) extra.push(ld(o.ld));
    h = h.replace("</head>", extra.join("\n") + "\n</head>");

    h = h.replace(/(<([a-z0-9]+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => open + T(key) + close);
    h = h.replace(/placeholder="[^"]*"(\s+data-i18n-ph="([^"]+)")/g, (m, rest, key) => `placeholder="${esc(T(key))}"` + rest);
    h = h.replace(/<a data-pp/g, `<a data-pp href="${lang}/privacy/"`);
    h = h.replace(/(<a data-go="(\w+)") href="#\w+"/g, (m, a, id) => `${a} href="${lang}/#${id}"`);   // <base> would send "#work" to the site root
    h = h.replace(/(<button data-lang="(en|ru)")/g, (m, a, l) => a + ` aria-pressed="${l === lang}"` + (l === lang ? ' class="on"' : ""));
    // BRAND into the markup, same as paintBrand() in site/index.html
    h = h.replace(/(<([a-z0-9]+)\b[^>]*?\sdata-brand="(\w+)"[^>]*>)[^<]*(<\/\2>)/g, (m, open, tag, k, close) => open + esc(BRAND.text(k)) + close);
    h = h.replace(/(\sdata-link="(\w+)") href="[^"]*"/g, (m, a, k) => `${a} href="${esc(BRAND.link(k))}"`);
    const hero = esc(BRAND.hero);
    h = h.replace(/<picture data-hero>[\s\S]*?<\/picture>/g, () => `<picture data-hero><source srcset="${hero}.avif" type="image/avif"><source srcset="${hero}.webp" type="image/webp">` +
      `<img src="${hero}.jpg" alt="${esc(BRAND.full)} hero render" fetchpriority="high" decoding="async"></picture>`);
    set(/(<link rel="preload" href=")[^"]*(?=" as="image" type="image\/avif")/, hero + ".avif");
    h = h.replace(/(<span id="syncLabel">)[^<]*/, (m, a) => a + T("work.source"));
    h = h.replace(/(<b id="statTotal">)[^<]*/, (m, a) => a + projects.length);
    h = h.replace('<div class="gridwrap" id="grid"></div>', () => `<div class="gridwrap" id="grid">${all.map(p => card(p, lang, T)).join("")}</div>`);
    h = h.replace('<div id="expRoot"></div>', () => `<div id="expRoot">${experience(lang, T)}</div>`);
    if (o.body) {
      h = h.replace('<main id="home" tabindex="-1">', '<main id="home" tabindex="-1" style="display:none">');
      h = h.replace('<main id="project" tabindex="-1"></main>', () => `<main id="project" tabindex="-1" style="display:block">${o.body(T)}</main>`);
    }
    return h + js;
  }

  const out = {};
  const homeLd = { "@type": "WebSite", name: BRAND.full, url: SITE, author: person, inLanguage: ["en", "ru"] };
  // the bare root is a 301 to /en/ at Cloudflare; this stub only answers if that rule is off. Old hash links ride along
  const stub = (l, to, title) => `<!doctype html>\n<html lang="${l}"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<link rel="canonical" href="${esc(to)}"><meta http-equiv="refresh" content="0; url=${esc(to)}">` +
    `<script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")} + location.hash)</script></head>` +
    `<body><a href="${esc(to)}">${esc(to)}</a></body></html>\n`;
  out["index.html"] = stub("en", url("en", {}), tr("en")("title"));
  for (const l of LANGS) {
    const T = tr(l);
    out[l + "/index.html"] = page(l + "/index.html", l, { r: {}, title: T("title"), desc: T("desc"), ld: { ...homeLd, inLanguage: l } });
    for (const p of projects) {
      const s = summary(p, l), img = ((p.media || []).find(m => m.t === "image" && m.src) || {}).src || p.thumb;
      const imgs = (p.media || []).filter(m => m.t === "image" && m.src).slice(0, 6).map(m => abs(m.src));
      out[`${l}/work/${p.id}/index.html`] = page(`${l}/work/${p.id}/index.html`, l, {
        r: { id: p.id }, title: p.title + " — " + BRAND.full, desc: filled(s) ? clip(s) : T("desc"), image: img,
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
      body: T => `<div class="crumbs"><a href="${l}/">${T("p.back")}</a></div><article class="legal"><div class="eyebrow">${esc(BRAND.text("FULL"))}</div><h1>${T("pp.h")}</h1>${T("pp.body")}</article>`
    });
  }
  out["404.html"] = page("404.html", "en", {
    base: new URL(SITE).pathname, robots: "noindex", title: tr("en")("title.nf"), desc: tr("en")("desc"),
    body: T => `<div class="nf"><div class="code">404</div><h1 class="h1" style="margin:0">${T("nf.h")}</h1><p class="sub">${T("nf.p")}</p><div class="socials"><a href="en/" style="background:var(--red);color:var(--ink);border-color:var(--red);padding:12px 20px">${T("nf.back")}</a></div></div>`
  });

  // 301s the site needs from Cloudflare: the root and every renamed project. Old project ids get no page here,
  // so there is nothing to index twice; without the rule they hit 404.html, whose script still opens the new id
  const moved = [["/", url("en", {})]];
  for (const [from, to] of Object.entries(data.redirects || {})) {
    if (!projects.some(p => p.id === to)) throw new Error(`seo: redirect ${from} → unknown project ${JSON.stringify(to)}`);
    if (all.some(p => p.id === from)) throw new Error(`seo: redirect ${from} shadows an existing project`);
    for (const l of LANGS) moved.push([new URL(url(l, { id: from })).pathname, url(l, { id: to })]);
  }

  const routes = [{}, ...projects.map(p => ({ id: p.id })), { page: "privacy" }];
  // x-default is the English page, same as the <link> tags in each page's <head>
  const alt = r => [...LANGS, "x-default"].map(h => `<xhtml:link rel="alternate" hreflang="${h}" href="${esc(url(h === "x-default" ? "en" : h, r))}"/>`).join("");
  out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    routes.flatMap(r => LANGS.map(l => `<url><loc>${esc(url(l, r))}</loc>${alt(r)}</url>`)).join("\n") + `\n</urlset>\n`;
  out["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`;
  return { out, moved };
}

/* MAIN */
const html = fs.readFileSync("site/index.html", "utf8");
const [, , siteUrl = readConst(html, "BRAND").siteUrl, outDir = "_site"] = process.argv;   // deploy passes the GitHub Pages address
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync("site", outDir, { recursive: true, filter: src => path.basename(src) !== "README.md" });   // notes stay out of the published site
const { out: files, moved } = build(html, JSON.parse(fs.readFileSync("site/data/portfolio.json", "utf8")), siteUrl);
for (const [f, c] of Object.entries(files)) {
  const p = path.join(outDir, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}
console.log(`seo: ${Object.keys(files).length} files → ${outDir}/`);
console.log("seo: 301s to keep in Cloudflare Redirect Rules:\n" + moved.map(([a, b]) => `  ${a} → ${b}`).join("\n"));
