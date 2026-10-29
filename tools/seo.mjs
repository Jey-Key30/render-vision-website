// Static entry pages for search engines and clean URLs. Zero dependencies.
//
//   node tools/seo.mjs [site-url] [_site]           build; site-url defaults to BRAND.siteUrl in site/index.html
//   node tools/seo.mjs --check [site-url] [_site]   build, then check every page of the build; exits 1 on errors
//   node tools/seo.mjs --live [site-url]            the same checks against the published site, over HTTP
//
// Copies site/ to the output folder (default _site/) and adds:
//   en/, ru/                                   home in each language
//   index.html                                 stub for the bare root: canonical, meta refresh and a JS hop to /en/
//   <lang>/work/<id>/index.html                one page per project
//   <lang>/privacy/index.html                  privacy policy
//   404.html, sitemap.xml (<lastmod> from git history), robots.txt
//   data/portfolio.json                        the public copy: no hidden drafts, "TODO…" notes emptied
// Each page is site/index.html with its own <title>, description, canonical, hreflang, Open Graph, JSON-LD and
// prerendered text, so crawlers see content without running JS. Project, privacy and 404 pages hold only their own
// <main>: the home markup is left out of them, and their menu links load /<lang>/#<section>.
// Paths are absolute from the site root and there is no <base>: crawlers resolve strings they find in the script
// and in the JSON against the page address, so "assets/…" seen from /en/work/<id>/ was a 404 for them.
// GitHub Pages cannot answer with a 301: the bare root gets the stub above, a renamed project ("redirects" in
// portfolio.json) gets no file, and 404.html, whose script still opens the new id, answers its old address.
// The script prints the 301s a Cloudflare proxy would take over.
// site/ itself is never modified and keeps working on its own (hash routes, relative paths).

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// a top-level object literal from site/index.html: "const NAME = {" … "\n};"
function readConst(html, name) {
  const head = "const " + name + " = ", s0 = html.indexOf(head), s1 = html.indexOf("\n};", s0);
  if (s0 < 0 || s1 < 0) throw new Error("seo: " + name + " object not found in site/index.html");
  return Function("return " + html.slice(s0 + head.length, s1 + 2))();
}

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const filled = v => v != null && String(v).trim() !== "" && String(v).trim() !== "\u2014";
const tx = (v, l) => v && typeof v === "object" && !Array.isArray(v) ? (v[l] ?? v.en ?? "") : v;
const TODO = /^\s*TODO\b/;
// every string inside a JSON value through f
const deep = (v, f) => typeof v === "string" ? f(v) : Array.isArray(v) ? v.map(x => deep(x, f))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x, f)])) : v;
// what goes public: hidden drafts dropped, "TODO…" notes emptied ("" reads as "no data", so nothing shows, same as before)
const publish = data => deep({ ...data, projects: (data.projects || []).filter(p => !p.hidden) }, s => TODO.test(s) ? "" : s);

function build(html, data, siteUrl, dates) {
  const SITE = siteUrl.replace(/\/?$/, "/"), P = new URL(SITE).pathname;   // P: path of the site root, "/" on its own domain
  const I18N = readConst(html, "I18N"), BRAND = readConst(html, "BRAND");
  const tr = l => k => BRAND.fill(I18N[l][k] ?? I18N.en[k] ?? k);   // same as L() in site/index.html
  const pick = (p, k, l) => l === "ru" && filled(p[k + "_ru"]) ? p[k + "_ru"] : tx(p[k], l);   // same as loc()
  const summary = (p, l) => pick(p, "summary", l);
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
  const link = (l, r) => P + l + "/" + tail(r);   // href inside the site
  const LANGS = ["en", "ru"];
  const all = data.projects || [];   // hidden drafts are already out, see publish()
  const projects = all.filter(p => p.status !== "soon");   // SOON: a card in the grid, no page of its own
  // ids become folder names under <lang>/work/
  for (const p of all) if (!/^[a-z0-9][a-z0-9-]*$/.test(p.id || "")) throw new Error("seo: bad project id " + JSON.stringify(p.id) + " (a-z, 0-9, dashes)");
  // case fields, same as facts() / credit() / caseText() in site/index.html; "TODO…" notes never reach the published pages
  const shown = (v, l) => filled(tx(v, l)) && !TODO.test(tx(v, l));
  // names and meta in the page language, same as titleOf() / metaTitle() / metaDesc() / altOf() in site/index.html
  const own = (p, k, l) => { const v = pick(p, k, l); return shown(v, l) ? v : ""; };
  const name = (p, l) => own(p, "title", l) || p.title;
  const metaTitle = (p, l) => (own(p, "meta_title", l) || name(p, l)) + " | " + BRAND.full;
  const blurb = (p, l) => { const s = summary(p, l); return own(p, "meta_description", l) || (filled(s) ? clip(s) : ""); };
  const altOf = (p, m, k, l, T) => shown(m.alt, l) ? tx(m.alt, l) : name(p, l) + " — " + T("a.render") + " " + (k + 1);
  const person = {
    "@type": "Person", "@id": SITE + "#kirill", name: "Kirill", alternateName: "J-K3.0", jobTitle: "CG Generalist, 3D Artist", url: SITE,
    image: abs("assets/portrait.jpg"), email: BRAND.link("email"),
    address: { "@type": "PostalAddress", addressLocality: "Yekaterinburg", addressCountry: "RU" },
    knowsAbout: ["3D modeling", "Hard-surface modeling", "Blender", "Geometry Nodes", "VFX", "Lookdev", "Game-ready assets", "Unreal Engine", "Environment art", "Point clouds"],
    sameAs: Object.values(BRAND.links)
  };
  const brand = { "@type": "Organization", "@id": SITE + "#brand", name: BRAND.full, url: SITE, logo: abs("assets/apple-touch-icon.png"), founder: { "@id": person["@id"] } };
  const ref = o => ({ "@type": o["@type"], "@id": o["@id"], name: o.name, url: SITE });   // short copy; the full one is on the home page
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
    return `<${tag} class="card${st}"${soon ? "" : ` href="${link(l, { id: p.id })}"`}><div class="thumb"${p.thumbRatio ? ` style="aspect-ratio:${esc(p.thumbRatio)}"` : ""}>` +
      (p.thumb ? pic(p.thumb, ` alt="${esc(name(p, l))}" loading="lazy" decoding="async"`) : "") + `<div class="badge">${esc(p.kindKey || "IMAGE")}</div>${layer}</div>` +
      `<div class="cap"><span>${esc(name(p, l))}</span><span class="year">${filled(p.year) ? esc(p.year) : ""}</span></div>${filled(p.role) ? `<div class="role">${esc(p.role)}</div>` : ""}</${tag}>`;
  };
  // same as the vertical strip in gallery() and the next cards in renderProject() of site/index.html
  const vcard = (p, l) => `<a class="vcard" href="${link(l, { id: p.id })}"><div class="t">${p.thumb ? pic(p.thumb, ` alt="" loading="lazy" decoding="async"`) : ""}</div><div class="role">${esc(name(p, l))}</div></a>`;
  const others = (p, l, T) => {
    if (p.layout === "vertical") {
      const more = projects.filter(x => x !== p && x.layout === "vertical");
      return more.length ? `<div class="gal"><div class="gal-bar"><span>${T("p.moreV")}</span></div><div class="strip">${more.map(x => vcard(x, l)).join("")}</div></div>` : "";
    }
    const i = projects.indexOf(p), next = [1, 2, 3].map(o => projects[(i + o) % projects.length]).filter((x, k, a) => x !== p && a.indexOf(x) === k);
    return next.length ? `<div class="next"><h3>${T("p.next")}</h3><div class="gridwrap">${next.map(x => card(x, l, T)).join("")}</div></div>` : "";
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

  const ext = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)}</a>` : esc(t);
  const projectBody = (p, l, T) => {
    const s = summary(p, l), imgs = (p.media || []).filter(m => m.t === "image" && m.src);
    const pr = p.production || {}, c = p.credit || {};
    const facts = [["p.year", p.year], ["p.role", p.role], ["p.software", p.software], ["p.tris", p.tris]]
      .filter(([, v]) => filled(v)).map(([k, v]) => `<div><u>${T(k)}</u>${esc(v)}</div>`).join("") +
      (shown(pr.name, l) ? `<div><u>${T("p.production")}</u>${ext(pr.url, tx(pr.name, l))}</div>` : "") +
      (shown(p.ai_used, l) ? `<div><u>${T("p.ai")}</u>${esc(tx(p.ai_used, l))}</div>` : "");
    const [ca, cb = ""] = shown(c.text, l) ? tx(c.text, l).split("{name}") : [];
    const cases = [["task", "p.task"], ["what_i_did", "p.did"], ["result", "p.result"]].filter(([k]) => shown(p[k], l))
      .map(([k, t]) => `<div><u>${T(t)}</u>${rich(tx(p[k], l))}</div>`).join("");
    const text = (ca != null ? `<p class="credit">${esc(ca)}${c.name ? ext(c.url, c.name) : ""}${esc(cb)}</p>` : "") +
      (filled(s) ? rich(s) : "") + (cases ? `<div class="case">${cases}</div>` : "");
    const rework = p.status === "rework" ? `<div class="p-status"><b>REWORK</b>${T("st.reworkNote")}</div>` : "";
    return `<div class="crumbs"><a href="${link(l, {})}#work">${T("p.back")}</a>` +
      (p.artstationUrl ? `<a href="${esc(p.artstationUrl)}" target="_blank" rel="noopener">${T("p.as")}</a>` : "") + `</div>` +
      `<article class="info" style="display:flex;flex-direction:column;gap:20px">` +
      (filled(p.topic) ? `<div class="eyebrow">${esc(p.topic)}</div>` : "") +
      `<h1 class="p-title" style="margin:0">${esc(name(p, l))}</h1>` + (text ? `<div class="sub desc">${text}</div>` : "") +
      rework + (facts ? `<div class="facts">${facts}</div>` : "") + `</article>` +
      (imgs.length ? `<div class="strip" style="padding-top:24px">` +
        imgs.map((m, i) => pic(m.sm || m.src, ` alt="${esc(altOf(p, m, i, l, T))}" loading="lazy" decoding="async"`)).join("") + `</div>` : "") +
      others(p, l, T);
  };

  function page(lang, o) {
    const T = tr(lang);
    const cut = html.lastIndexOf("<script>");
    let h = html.slice(0, cut);
    const js = html.slice(cut);
    // a rewrite that has to happen: markup changed in site/index.html must not slip into the build half-done
    const must = (re, f) => {
      if (!(typeof re === "string" ? h.includes(re) : h.search(re) >= 0)) throw new Error("seo: not found in site/index.html: " + re);
      h = h.replace(re, f);
    };
    const set = (re, v) => { h = h.replace(re, (m, a) => a + v); };

    must('<meta charset="utf-8">', m => m + `\n<meta name="rv-static" content="${esc(SITE)}">`);
    must('<html lang="en">', `<html lang="${lang}">`);
    h = h.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(o.title)}</title>`);
    set(/(<meta name="description" content=")[^"]*/, esc(o.desc));
    set(/(<meta property="og:title" content=")[^"]*/, esc(o.title));
    set(/(<meta property="og:description" content=")[^"]*/, esc(o.desc));
    set(/(<meta name="twitter:title" content=")[^"]*/, esc(o.title));
    set(/(<meta name="twitter:description" content=")[^"]*/, esc(o.desc));
    set(/(<meta property="og:site_name" content=")[^"]*/, esc(BRAND.full));
    set(/(<meta property="og:image" content=")[^"]*/, esc(abs(o.image || "assets/og.jpg")));
    if (o.image) h = h.replace(/<meta property="og:image:(width|height)"[^>]*>\r?\n/g, "");
    const extra = [`<meta property="og:locale" content="${lang === "ru" ? "ru_RU" : "en_US"}">`];
    if (o.robots) extra.push(`<meta name="robots" content="${o.robots}">`);
    if (o.r) {
      const canon = url(lang, o.r);
      extra.push(`<meta property="og:url" content="${esc(canon)}">`, `<link rel="canonical" href="${esc(canon)}">`);
      LANGS.forEach(l => extra.push(`<link rel="alternate" hreflang="${l}" href="${esc(url(l, o.r))}">`));
      extra.push(`<link rel="alternate" hreflang="x-default" href="${esc(url("en", o.r))}">`);
    }
    if (o.ld) extra.push(ld(o.ld));
    h = h.replace("</head>", extra.join("\n") + "\n</head>");

    if (o.body) {   // project, privacy, 404: only their own <main>
      must(/<link rel="preload" href="[^"]*" as="image"[^>]*>\r?\n/, "");   // the hero render is on the home page only
      must(/<main id="home"[\s\S]*?<\/main>\s*/, "");
      must('<main id="project" tabindex="-1" hidden></main>', () => `<main id="project" tabindex="-1" style="display:block">${o.body(T)}</main>`);
    }
    h = h.replace(/(<([a-z0-9]+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (m, open, tag, key, inner, close) => open + T(key) + close);
    h = h.replace(/placeholder="[^"]*"(\s+data-i18n-ph="([^"]+)")/g, (m, rest, key) => `placeholder="${esc(T(key))}"` + rest);
    must(/<a data-pp/g, `<a data-pp href="${link(lang, { page: "privacy" })}"`);
    must(/(<a\b[^>]*?\sdata-go="(\w+)"[^>]*?) href="#\w+"/g, (m, a, id) => `${a} href="${link(lang, {})}#${id}"`);
    // EN / RU: links to this page in the other language
    must(/(<a data-lang="(en|ru)"[^>]*?) href="[^"]*"/g, (m, a, l) => a + ` href="${link(l, o.r || {})}"` + (l === lang ? ' class="on" aria-current="true"' : ""));
    // BRAND into the markup, same as paintBrand() in site/index.html
    h = h.replace(/(<([a-z0-9]+)\b[^>]*?\sdata-brand="(\w+)"[^>]*>)[^<]*(<\/\2>)/g, (m, open, tag, k, close) => open + esc(BRAND.text(k)) + close);
    h = h.replace(/(\sdata-link="(\w+)") href="[^"]*"/g, (m, a, k) => `${a} href="${esc(BRAND.link(k))}"`);
    if (!o.body) {
      const hero = esc(BRAND.hero), heroBase = esc(BRAND.hero.replace(/\.jpe?g$/i, ""));
      h = h.replace(/<picture data-hero>[\s\S]*?<\/picture>/g, () => `<picture data-hero><source srcset="${heroBase}.avif" type="image/avif"><source srcset="${heroBase}.webp" type="image/webp">` +
        `<img src="${hero}" alt="${esc(BRAND.full)} hero render" fetchpriority="high" decoding="async"></picture>`);
      set(/(<link rel="preload" href=")[^"]*(?=" as="image" type="image\/avif")/, heroBase + ".avif");
      must(/(<span id="syncLabel">)[^<]*/, (m, a) => a + T("work.source"));
      must(/(<b id="statTotal">)[^<]*/, (m, a) => a + projects.length);
      must('<div class="gridwrap" id="grid"></div>', () => `<div class="gridwrap" id="grid">${all.map(p => card(p, lang, T)).join("")}</div>`);
      must('<div id="expRoot"></div>', () => `<div id="expRoot">${experience(lang, T)}</div>`);
    }
    // paths from the site root, in the markup and in the script alike
    const rooted = s => s.replace(/(["'(])(assets\/|data\/portfolio\.json|favicon\.ico)/g, (m, q, x) => q + P + x);
    return rooted(h) + rooted(js);
  }

  const out = {};
  const homeLd = { "@type": "WebSite", "@id": SITE + "#website", name: BRAND.full, url: SITE, author: person, publisher: brand };
  // GitHub Pages cannot 301 the bare root to /en/: canonical, meta refresh and a JS hop instead. Old hash links ride along
  const stub = (l, to, title) => `<!doctype html>\n<html lang="${l}"><head><meta charset="utf-8"><title>${esc(title)}</title>` +
    `<link rel="canonical" href="${esc(to)}"><meta http-equiv="refresh" content="0; url=${esc(to)}">` +
    `<script>location.replace(${JSON.stringify(to).replace(/</g, "\\u003c")} + location.hash)</script></head>` +
    `<body><a href="${esc(to)}">${esc(to)}</a></body></html>\n`;
  out["index.html"] = stub("en", url("en", {}), tr("en")("title"));
  for (const l of LANGS) {
    const T = tr(l);
    out[l + "/index.html"] = page(l, { r: {}, title: T("title"), desc: T("desc"), ld: { ...homeLd, inLanguage: l } });
    for (const p of projects) {
      const pics = (p.media || []).filter(m => m.t === "image" && m.src), d = blurb(p, l);
      const sameAs = [p.artstationUrl, p.sketchfabUrl].filter(Boolean);
      out[`${l}/work/${p.id}/index.html`] = page(l, {
        r: { id: p.id }, title: metaTitle(p, l), desc: d || T("desc"), image: (pics[0] || {}).src || p.thumb,
        body: T => projectBody(p, l, T),
        ld: {
          "@type": "VisualArtwork", name: name(p, l), url: url(l, { id: p.id }), inLanguage: l,
          ...(d ? { description: d } : {}), ...(pics.length ? { image: pics.slice(0, 6).map(m => abs(m.src)) } : {}),
          ...(p.thumb ? { thumbnailUrl: abs(p.thumb) } : {}),
          ...(filled(p.year) ? { dateCreated: String(p.year) } : {}), ...(filled(p.software) ? { artMedium: p.software } : {}),
          ...(sameAs.length ? { sameAs } : {}),
          creator: ref(person), publisher: ref(brand), isPartOf: { "@id": SITE + "#website" }
        }
      });
    }
    out[`${l}/privacy/index.html`] = page(l, {
      r: { page: "privacy" }, title: T("pp.title"), desc: T("pp.desc"),
      body: T => `<div class="crumbs"><a href="${link(l, {})}#work">${T("p.back")}</a></div><article class="legal"><div class="eyebrow">${esc(BRAND.text("FULL"))}</div><h1>${T("pp.h")}</h1>${T("pp.body")}</article>`
    });
  }
  out["404.html"] = page("en", {
    robots: "noindex", title: tr("en")("title.nf"), desc: tr("en")("desc"),
    body: T => `<div class="nf"><div class="code">404</div><h1 class="h1" style="margin:0">${T("nf.h")}</h1><p class="sub">${T("nf.p")}</p><div class="socials"><a href="${link("en", {})}#work" style="background:var(--red);color:var(--ink);border-color:var(--red);padding:12px 20px">${T("nf.back")}</a></div></div>`
  });
  // the page script fetches this copy; its paths count from the root too
  out["data/portfolio.json"] = JSON.stringify(deep(data, s => s.replace(/^assets\//, P + "assets/")));

  // 301s a Cloudflare proxy would take over: the root and every renamed project. Old project ids get no page here,
  // so there is nothing to index twice; their old address is 404.html, whose script still opens the new id
  const moved = [["/", url("en", {})]];
  for (const [from, to] of Object.entries(data.redirects || {})) {
    if (!projects.some(p => p.id === to)) throw new Error(`seo: redirect ${from} → unknown project ${JSON.stringify(to)}`);
    if (all.some(p => p.id === from)) throw new Error(`seo: redirect ${from} shadows an existing project`);
    for (const l of LANGS) moved.push([new URL(url(l, { id: from })).pathname, url(l, { id: to })]);
  }

  const routes = [{}, ...projects.map(p => ({ id: p.id })), { page: "privacy" }];
  const mod = r => r.id ? (dates.work || {})[r.id] : r.page ? dates[r.page] : dates.home;
  // x-default is the English page, same as the <link> tags in each page's <head>
  const alt = r => [...LANGS, "x-default"].map(h => `<xhtml:link rel="alternate" hreflang="${h}" href="${esc(url(h === "x-default" ? "en" : h, r))}"/>`).join("");
  out["sitemap.xml"] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    routes.flatMap(r => LANGS.map(l => `<url><loc>${esc(url(l, r))}</loc>${mod(r) ? `<lastmod>${mod(r)}</lastmod>` : ""}${alt(r)}</url>`)).join("\n") + `\n</urlset>\n`;
  out["robots.txt"] = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`;
  return { out, moved };
}

/* LASTMOD */
// when each page's content last changed, from git history: a project — its object in portfolio.json and its media,
// privacy — its text, home — any change. Needs the full history (deploy checks out with fetch-depth: 0)
function lastmods(data) {
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).trim();
  try { if (git("rev-parse", "--is-shallow-repository") !== "false") throw new Error("shallow clone"); }
  catch (e) { console.warn("seo: no git history (" + e.message.split("\n")[0] + "), sitemap.xml goes without <lastmod>"); return {}; }
  const DATA = "site/data/portfolio.json", PAGE = "site/index.html";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const latest = ds => ds.filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0];
  const cache = new Map(), show = spec => { if (!cache.has(spec)) cache.set(spec, git("show", spec)); return cache.get(spec); };
  // date of the commit that gave value() its present result; a change not committed yet is dated now
  const since = (file, value) => {
    const want = value(fs.readFileSync(file, "utf8"));
    let at = now;
    if (!cache.has(file)) cache.set(file, git("log", "--format=%H %cI", "--", file));
    for (const line of cache.get(file).split("\n").filter(Boolean)) {
      const [sha, date] = line.split(" ");
      let v; try { v = value(show(sha + ":" + file)); } catch { break; }
      if (v !== want) break;
      at = date;
    }
    return at;
  };
  const work = {};
  for (const p of data.projects || []) {
    const media = git("log", "-1", "--format=%cI", "--", `site/assets/gallery/${p.id}`, `site/assets/thumbs/${p.id}.jpg`);
    work[p.id] = latest([since(DATA, s => JSON.stringify(JSON.parse(s).projects.find(x => x.id === p.id))), media]);
  }
  const privacy = since(PAGE, s => { const I = readConst(s, "I18N"); return JSON.stringify(["en", "ru"].map(l => [I[l]["pp.h"], I[l]["pp.body"]])); });
  return { work, privacy, home: latest([...Object.values(work), git("log", "-1", "--format=%cI", "--", PAGE, DATA)]) };
}

/* CHECK */
// the same checks run on the build and on the live site; get(url, head) → { status, text }
const fileGet = (dir, siteUrl) => async u => {
  const P = new URL(siteUrl.replace(/\/?$/, "/")).pathname, p = decodeURIComponent(new URL(u).pathname);
  if (!p.startsWith(P)) return { status: 404, text: "" };
  let f = path.join(dir, p.slice(P.length));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");   // GitHub Pages serves a folder's index.html
  if (!fs.existsSync(f)) return { status: 404, text: "" };
  return { status: 200, text: /\.(html|xml|json|txt)$/.test(f) ? fs.readFileSync(f, "utf8") : "" };
};
const httpGet = async (u, head) => {
  try { const r = await fetch(u, { method: head ? "HEAD" : "GET", signal: AbortSignal.timeout(20000) }); return { status: r.status, text: head ? "" : await r.text() }; }
  catch { return { status: 0, text: "" }; }
};

async function check(get, siteUrl, source) {
  const SITE = siteUrl.replace(/\/?$/, "/"), P = new URL(SITE).pathname, origin = new URL(SITE).origin;
  const errors = [], warns = [];
  const at = u => String(u).replace(SITE, "/");
  const err = (u, m) => errors.push(`${at(u)}: ${m}`), warn = (u, m) => warns.push(`${at(u)}: ${m}`);
  const unesc = s => String(s).replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const attr = (h, re) => { const m = h.match(re); return m ? unesc(m[1]) : null; };
  const refs = new Map();   // in-site address → first page that uses it
  const use = (u, from) => { try { const x = new URL(u, from); x.hash = ""; if (x.origin === origin && !refs.has(x.href)) refs.set(x.href, from); } catch {} };

  const sm = await get(SITE + "sitemap.xml");
  if (sm.status !== 200) { err("sitemap.xml", "status " + sm.status); return report(errors, warns); }
  const entries = sm.text.split("<url>").slice(1);
  const urls = entries.map(e => unesc((e.match(/<loc>([^<]+)<\/loc>/) || [])[1] || ""));
  const noMod = entries.filter(e => !e.includes("<lastmod>")).length;
  if (noMod) warn("sitemap.xml", `${noMod} of ${entries.length} URLs without <lastmod>`);
  const pages = {};
  for (const u of urls) { const r = await get(u); if (r.status !== 200) err(u, "status " + r.status); else pages[u] = r.text; }
  const nfAt = SITE + "404.html", nf = await get(nfAt);
  if (nf.status !== 200 || !nf.text.includes('<meta name="robots" content="noindex">')) err(nfAt, "missing, or no noindex");

  // what every page needs, the 404 page included
  let script = "";
  const structure = (u, h) => {
    const s = h.lastIndexOf("<script>"), body = h.slice(h.indexOf("<body"), s > 0 ? s : undefined);
    script = script || h.slice(s);
    const open = (body.match(/<main\b[^>]*>/g) || []).filter(m => !/\shidden[\s>]|display:\s*none/.test(m));
    if (open.length !== 1) err(u, `${open.length} visible <main>`);
    if (/<main\b[^>]*(\shidden\b|display:\s*none)[^>]*>(?!<\/main>)/.test(body)) err(u, "a hidden <main> with content");
    if (/<(section|article|div)\b[^>]*display:\s*none/.test(body)) err(u, "a display:none block in the markup");
    const h1 = (body.match(/<h1\b/g) || []).length;
    if (h1 !== 1) err(u, `${h1} <h1>`);
    if (/["'(](assets\/|data\/)/.test(h)) err(u, "a relative assets/ or data/ path: crawlers resolve it against the page address");
    for (const m of h.matchAll(/\s(?:src|href|poster)="([^"]*)"/g)) use(unesc(m[1]), u);
    for (const m of h.matchAll(/\ssrcset="([^"]*)"/g)) unesc(m[1]).split(",").forEach(x => use(x.trim().split(/\s+/)[0], u));
    for (const m of h.matchAll(/url\(([^)"']+)\)/g)) use(m[1], u);
    for (const m of h.matchAll(/<meta property="og:image" content="([^"]+)"/g)) use(unesc(m[1]), u);
    for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try { JSON.stringify(JSON.parse(m[1])).replace(/"(https?:[^"]+)"/g, (x, v) => use(v, u)); } catch { err(u, "JSON-LD is not valid JSON"); }
    }
    return body;
  };
  if (nf.status === 200) structure(nfAt, nf.text);

  const alts = {}, titles = {}, descs = {};
  for (const [u, h] of Object.entries(pages)) alts[u] = Object.fromEntries([...h.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(m => [m[1], unesc(m[2])]));
  for (const [u, h] of Object.entries(pages)) {
    const lang = new URL(u).pathname.slice(P.length).split("/")[0], head = h.slice(0, h.indexOf("</head>"));
    const body = structure(u, h);
    if (attr(h, /<html lang="([^"]+)"/) !== lang) err(u, `<html lang> is not "${lang}"`);
    const title = attr(head, /<title>([^<]*)<\/title>/), desc = attr(head, /<meta name="description" content="([^"]*)"/);
    if (!title) err(u, "no <title>");
    else { (titles[title] ||= []).push(u); if (title.length > 70) warn(u, `title is ${title.length} characters, keep it within 70`); }
    if (!desc) err(u, "no meta description");
    else { (descs[desc] ||= []).push(u); if (desc.length < 120 || desc.length > 160) warn(u, `description is ${desc.length} characters, 120–160 wanted`); }
    const words = body.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ").replace(/<[^>]+>/g, " ").replace(/&[#\w]+;/g, " ")
      .split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
    if (words < 150) warn(u, `${words} words of text, 150+ wanted`);
    if (attr(head, /<link rel="canonical" href="([^"]+)"/) !== u) err(u, "canonical is not the page itself");
    const a = alts[u];
    if (!a.en || !a.ru || !a["x-default"]) err(u, "hreflang en / ru / x-default missing");
    else {
      if (a[lang] !== u) err(u, `hreflang ${lang} is not the page itself`);
      if (a["x-default"] !== a.en) err(u, "x-default is not the English page");
      for (const l of ["en", "ru"]) if (a[l] !== u && (alts[a[l]] || {})[lang] !== u) err(u, `hreflang ${l} → ${at(a[l])} does not point back`);
    }
  }
  for (const [t, us] of Object.entries(titles)) if (us.length > 1) warn(us[0], `the same title on ${us.slice(1).map(at).join(", ")}`);
  for (const [d, us] of Object.entries(descs)) if (us.length > 1) warn(us[0], `the same description on ${us.slice(1).map(at).join(", ")}`);

  // strings in the page script that crawlers take for addresses have to lead somewhere
  const deepest = urls.find(u => u.includes("/work/")) || SITE;
  for (const m of script.matchAll(/(["'])((?:\/|\?)[A-Za-z][^"'\s]*|[^"'\s]*\.(?:jpe?g|png|webp|avif|mp4|json|pdf))\1/g)) use(m[2], deepest);

  const dj = await get(SITE + "data/portfolio.json");
  let data = null;
  if (dj.status !== 200) err("data/portfolio.json", "status " + dj.status);
  else try { data = JSON.parse(dj.text); } catch { err("data/portfolio.json", "not valid JSON"); }
  if (data) {
    let todo = 0, rel = 0;
    deep(data, s => { if (TODO.test(s)) todo++; if (/^assets\//.test(s)) rel++; else if (/^\/\S+\.\w+$/.test(s)) use(s, SITE); return s; });
    if (todo) err("data/portfolio.json", `${todo} "TODO…" notes are public`);
    if (rel) err("data/portfolio.json", `${rel} relative assets/ paths`);
    for (const p of data.projects || []) {
      if (p.hidden) err("data/portfolio.json", `the hidden draft "${p.id}" is public`);
      const want = p.status === "soon" ? 0 : 2, have = urls.filter(u => u.endsWith(`/work/${p.id}/`)).length;
      if (have !== want) err("sitemap.xml", `"${p.id}" has ${have} URLs, ${want} expected`);
    }
  }
  // SOON works and hidden drafts: no page, no link
  const closed = (source.projects || []).filter(p => p.hidden || p.status === "soon").map(p => p.id);
  for (const id of closed) {
    const u = SITE + "en/work/" + id + "/";
    if ((await get(u)).status !== 404) err(u, "a SOON work or hidden draft has a page");
  }
  for (const [u, from] of refs) if (closed.some(id => new URL(u).pathname.endsWith(`/work/${id}/`))) err(from, `links to ${at(u)}, which has no page`);

  const rb = await get(SITE + "robots.txt");
  if (rb.status !== 200 || !rb.text.includes("Sitemap: " + SITE + "sitemap.xml")) err("robots.txt", "missing, or no Sitemap line");
  const lost = await get(SITE + "no-such-page-" + Date.now() + "/");
  if (lost.status !== 404) err("/no-such-page/", `an unknown address answers ${lost.status}, not 404`);

  // every in-site address the pages, the script and the JSON use: 200, a few at a time
  const list = [...refs];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (next < list.length) {
      const [u, from] = list[next++], r = await get(u, true);
      if (r.status !== 200) err(from, `${at(u)} answers ${r.status || "nothing"}`);
    }
  }));
  console.log(`seo check: ${Object.keys(pages).length} pages from sitemap.xml, ${list.length} addresses on the site`);
  return report(errors, warns);
}
function report(errors, warns) {
  for (const w of warns.sort()) console.log("  warn   " + w);
  for (const e of errors.sort()) console.log("  ERROR  " + e);
  console.log(`seo check: ${errors.length} error(s), ${warns.length} warning(s)` + (errors.length ? "" : " — warnings are about the texts, they do not stop the deploy"));
  return errors.length ? 1 : 0;
}

/* MAIN */
const args = process.argv.slice(2), flags = args.filter(a => a.startsWith("--"));
const [siteArg, outDir = "_site"] = args.filter(a => !a.startsWith("--"));
for (const f of flags) if (!["--check", "--live"].includes(f)) { console.error("seo: unknown option " + f); process.exit(2); }
const html = fs.readFileSync("site/index.html", "utf8"), source = JSON.parse(fs.readFileSync("site/data/portfolio.json", "utf8"));
const siteUrl = siteArg || readConst(html, "BRAND").siteUrl;   // deploy passes the GitHub Pages address
if (flags.includes("--live")) process.exit(await check(httpGet, siteUrl, source));
fs.rmSync(outDir, { recursive: true, force: true });
fs.cpSync("site", outDir, { recursive: true, filter: src => path.basename(src) !== "README.md" });   // notes stay out of the published site
const data = publish(source);
const { out: files, moved } = build(html, data, siteUrl, lastmods(data));
for (const [f, c] of Object.entries(files)) {
  const p = path.join(outDir, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}
console.log(`seo: ${Object.keys(files).length} files → ${outDir}/`);
console.log("seo: 301s for a Cloudflare proxy, if it is ever turned on (Rules → Redirect Rules):\n" + moved.map(([a, b]) => `  ${a} → ${b}`).join("\n"));
if (flags.includes("--check")) process.exit(await check(fileGet(outDir, siteUrl), siteUrl, source));
