// CV as PDF, in English and Russian, built from the same content as the site. Zero dependencies.
//
//   node tools/cv.mjs            → site/assets/cv/kirill-kadyrov-cv-en.pdf, …-ru.pdf
//
// Text comes from I18N in site/index.html (about.*) and about.experience in site/data/portfolio.json,
// so after editing either one, run this again and commit the PDFs. Prints with headless Chrome or Edge
// (set CHROME=<path to the browser> if it is installed somewhere unusual).
// No phone number or date of birth on purpose: the file is public, anyone can download it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SITE = "https://render-vision-cg.com/";
const OUT = "site/assets/cv";
// works listed under "Selected work", in this order (ids from portfolio.json)
const SELECTED = ["robot-chappie", "space-suit-j-30", "sci-fi-gun", "the-forgotten-shrine-environment-prop-study", "lightcycle-metro", "tron-lightcycle"];
const LINKS = [
  ["render-vision-cg.com", SITE],
  ["hh.ru", "https://hh.ru/resume/443dc4c7ff0c671dc00039ed1f505336556666"],
  ["ArtStation", "https://www.artstation.com/j-k30"],
  ["Sketchfab", "https://sketchfab.com/J-K3.0"],
  ["YouTube", "https://www.youtube.com/@Jey-Key_3.0"]
];
const T = {
  en: {
    name: "Kirill Kadyrov", where: "Yekaterinburg · ready to relocate to Moscow · remote, hybrid or office", title: "CG Generalist / 3D Artist", stack: "Blender · VFX · Unreal Engine",
    about: "Profile", work: "Experience", edu: "Education", doing: "What I do", tools: "Tools", langs: "Languages",
    langsText: "Russian — native<br>English — B1, read technical documentation freely", selected: "Selected work",
    links: "Links", foot: "Portfolio, showreel and interactive 3D viewers:"
  },
  ru: {
    name: "Кирилл Кадыров", where: "Екатеринбург · готов к переезду в Москву · удалёнка, гибрид или офис", title: "CG Generalist / 3D Artist", stack: "Blender · VFX · Unreal Engine",
    about: "О себе", work: "Опыт работы", edu: "Образование", doing: "Чем занимаюсь", tools: "Софт", langs: "Языки",
    langsText: "Русский — родной<br>Английский — B1, свободно читаю техническую документацию", selected: "Избранные работы",
    links: "Ссылки", foot: "Портфолио, шоурил и интерактивные 3D-модели:"
  }
};

const html = fs.readFileSync("site/index.html", "utf8");
const s0 = html.indexOf("const I18N = "), s1 = html.indexOf("\n};", s0);
if (s0 < 0 || s1 < 0) throw new Error("cv: I18N object not found in site/index.html");
const I18N = Function("return " + html.slice(s0 + 13, s1 + 2))();
const data = JSON.parse(fs.readFileSync("site/data/portfolio.json", "utf8"));

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const filled = v => v != null && String(v).trim() !== "" && String(v).trim() !== "\u2014";
const tx = (v, l) => v && typeof v === "object" && !Array.isArray(v) ? (v[l] ?? v.en ?? "") : v;
const lines = s => String(s).split(/<br\s*\/?>/i).map(x => x.trim()).filter(Boolean);   // I18N lists are <br>-separated HTML
const font = f => pathToFileURL(path.resolve("site/assets/fonts", f)).href;

function page(l) {
  const L = k => I18N[l][k] ?? I18N.en[k] ?? "";
  const t = T[l];
  const rows = (kind, head) => (data.about.experience || []).filter(r => (r.kind || "work") === kind).map((r, i) => {
    const pts = (tx(r.points, l) || []).filter(filled);
    return (i ? "" : `<div class="keep"><h2>${head}</h2>`) + `<div class="row"><div class="when">${esc(tx(r.period, l))}</div><div>` +
      `<b>${esc(tx(r.role, l))}</b>` + (filled(tx(r.company, l)) ? `<div class="co">${esc(tx(r.company, l))}</div>` : "") +
      (filled(tx(r.lead, l)) ? `<p>${esc(tx(r.lead, l))}</p>` : "") +
      (pts.length ? `<ul>${pts.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "") + `</div></div>` + (i ? "" : `</div>`);
  }).join("");
  const works = SELECTED.map(id => data.projects.find(p => p.id === id && !p.status)).filter(Boolean).map(p => {
    const u = SITE + l + "/work/" + p.id + "/";
    return `<li><a href="${esc(u)}">${esc(p.title)}</a> <span>${esc([p.year, p.topic].filter(filled).join(" · "))}</span></li>`;
  }).join("");

  return `<!DOCTYPE html><html lang="${l}"><head><meta charset="utf-8"><title>${esc(t.name)} — CV</title><style>
@font-face{font-family:Mono;src:url(${font("jetbrains-mono-latin.woff2")}) format('woff2');unicode-range:U+0000-00FF,U+2000-206F,U+2190-21FF}
@font-face{font-family:Mono;src:url(${font("jetbrains-mono-cyrillic.woff2")}) format('woff2');unicode-range:U+0400-045F,U+0490-0491}
@page{size:A4;margin:14mm 15mm 14mm}
*{box-sizing:border-box}
body{margin:0;font:9.6pt/1.45 Arial,Helvetica,sans-serif;color:#1d1b1a}
a{color:#B22B2B;text-decoration:none}
.top{display:grid;grid-template-columns:1fr auto;gap:18px;align-items:end;padding-bottom:12px;border-bottom:2px solid #B22B2B}
h1{margin:0;font-size:25pt;line-height:1;font-weight:700;letter-spacing:-.01em}
.role{margin-top:6px;font-size:12.5pt;font-weight:700}
.role span{color:#B22B2B}
.where{margin-top:4px;color:#5d5956}
.contacts{text-align:right;font:8.6pt/1.6 Mono,monospace}
h2{margin:16px 0 7px;font:700 8pt/1 Mono,monospace;letter-spacing:.14em;text-transform:uppercase;color:#B22B2B}
p{margin:0 0 5px}
.row{display:grid;grid-template-columns:31mm 1fr;gap:12px;padding:7px 0;border-top:1px solid #e4e0dc;break-inside:avoid}
.keep{break-inside:avoid}
.keep .row{border-top:none;padding-top:0}
.when{font:8.4pt/1.5 Mono,monospace;color:#B22B2B}
.row b{font-size:10.4pt}
.co{font:8.4pt/1.5 Mono,monospace;color:#5d5956;margin:1px 0 4px}
ul{margin:3px 0 0;padding:0;list-style:none}
li{position:relative;margin:0 0 3px;padding-left:12px}
li::before{content:"";position:absolute;left:0;top:.68em;width:6px;height:1px;background:#B22B2B}
.cols{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;break-inside:avoid}
.works{columns:2;column-gap:18px}
.works li{break-inside:avoid}
.works span{color:#5d5956;font-size:8.6pt}
.foot{margin-top:14px;padding-top:8px;border-top:1px solid #e4e0dc;font-size:8.8pt;color:#5d5956}
</style></head><body>
<div class="top">
  <div><h1>${esc(t.name)}</h1><div class="role">${esc(t.title)} <span>· ${esc(t.stack)}</span></div><div class="where">${esc(t.where)}</div></div>
  <div class="contacts"><a href="mailto:freelancejeykey@gmail.com">freelancejeykey@gmail.com</a><br><a href="https://t.me/J_K_3_0">Telegram @J_K_3_0</a><br><a href="${SITE}${l}/">render-vision-cg.com</a></div>
</div>
<h2>${t.about}</h2>
<p>${L("about.p1")}</p><p>${L("about.p2")}</p><p>${L("about.p3")}</p>
${rows("work", t.work)}
${rows("edu", t.edu)}
<div class="cols">
  <div><h2>${t.doing}</h2><ul>${lines(L("about.doList")).map(x => `<li>${x}</li>`).join("")}</ul></div>
  <div><h2>${t.tools}</h2><ul>${lines(L("about.toolsList")).map(x => `<li>${x}</li>`).join("")}</ul></div>
  <div><h2>${t.langs}</h2><p>${t.langsText}</p><h2>${t.links}</h2><p>${LINKS.map(([n, u]) => `<a href="${esc(u)}">${esc(n)}</a>`).join("<br>")}</p></div>
</div>
${works ? `<h2>${t.selected}</h2><ul class="works">${works}</ul>` : ""}
<div class="foot">${t.foot} <a href="${SITE}${l}/">${SITE.replace(/^https:\/\/|\/$/g, "")}</a></div>
</body></html>`;
}

function browser() {
  const env = process.env, pf = env.ProgramFiles || "C:\\Program Files", pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const list = [env.CHROME,
    path.join(pf, "Google/Chrome/Application/chrome.exe"), path.join(pf86, "Google/Chrome/Application/chrome.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe"),
    path.join(pf86, "Microsoft/Edge/Application/msedge.exe"), path.join(pf, "Microsoft/Edge/Application/msedge.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const hit = list.find(p => p && fs.existsSync(p));
  if (!hit) throw new Error("cv: Chrome or Edge not found, set CHROME=<path to the browser>");
  return hit;
}

/* MAIN */
const exe = browser(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rv-cv-"));
fs.mkdirSync(OUT, { recursive: true });
for (const l of ["en", "ru"]) {
  const src = path.join(tmp, `cv-${l}.html`), out = path.resolve(OUT, `kirill-kadyrov-cv-${l}.pdf`);
  fs.writeFileSync(src, page(l));
  fs.rmSync(out, { force: true });   // so a failed print cannot pass for the old file
  execFileSync(exe, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--print-to-pdf-no-header",
    "--user-data-dir=" + path.join(tmp, "profile"), "--print-to-pdf=" + out, pathToFileURL(src).href], { stdio: "ignore" });
  if (!fs.existsSync(out)) throw new Error("cv: browser did not write " + out);
  console.log(`cv: ${path.relative(".", out)} (${Math.round(fs.statSync(out).size / 1024)} KB)`);
}
fs.rmSync(tmp, { recursive: true, force: true });
