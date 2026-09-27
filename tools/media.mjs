// Media pipeline: compresses new or replaced files in site/assets and keeps everything built
// from them in sync. Zero dependencies; needs ffmpeg + ffprobe (libsvtav1, libwebp, libx264) in PATH.
//
//   node tools/media.mjs            process what changed
//   node tools/media.mjs --dry      only show what would be done
//   node tools/media.mjs --check    same, exits 1 if anything is due (.githooks/pre-commit)
//   node tools/media.mjs --prune    also delete derived files whose source is gone
//   node tools/media.mjs --adopt    mark the current files as processed, encode nothing
//
// How it knows what is new: tools/media-manifest.json keeps, for every file the script owns,
// the hash of the file it was built from (for a source render: its own hash after compression).
// Source hash unknown → the file was added or replaced → compress it and rebuild what depends on it.
// Derived file missing or built from another source hash → rebuild it. Everything else is skipped,
// so a JPEG is never compressed twice.
//
// Sources and what is built from them:
//   gallery/<id>/NN.jpg   max side 1600 → sm/NN.jpg (480 high), .avif/.webp of both
//   thumbs/<id>.jpg       from the project's first render, 640×900 box → .avif/.webp
//   hero-robot, portrait, showreel-poster  resized to their slot → .avif/.webp
//   og.jpg                1200×630 crop, JPEG only (social networks)
//   showreel.mp4          h264, 480 high, no audio, faststart
//   gallery/<id>/NN.mp4   h264, max side 1920, no audio, faststart (project page) → sm/NN.mp4, max side 960,
//                         first 8 s (played over the card on hover); a project without renders gets its thumb from it
// A render can be dropped in as .png/.jpeg/.tif/.bmp (a video as .mov/.mkv/.webm/.avi/.m4v):
// it is converted to the .jpg/.mp4 name next to it and the original is deleted. Transparency becomes black.
// A render numbered without the leading zero fills that slot: 1.jpg → 01.jpg.
// The script stops before encoding if portfolio.json points to a render that is not there
// (e.g. 01.jpg deleted, render_1.jpg added): it cannot guess which new file replaces which.
//
// Afterwards portfolio.json is updated: `ratio` of every image, `thumb`/`thumbRatio`,
// missing `sm`, and new renders and clips in a project's gallery folder are appended to its media.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const MANIFEST = path.join(ROOT, "tools", "media-manifest.json");
const DATA = path.join(SITE, "data", "portfolio.json");
const argv = new Set(process.argv.slice(2));
const CHECK = argv.has("--check"), DRY = CHECK || argv.has("--dry"), PRUNE = argv.has("--prune"), ADOPT = argv.has("--adopt");
for (const a of argv) if (!["--dry", "--check", "--prune", "--adopt"].includes(a)) { console.error("media: unknown option " + a); process.exit(2); }

const RAW_IMG = [".png", ".jpeg", ".tif", ".tiff", ".bmp"];
const RAW_VID = [".mov", ".mkv", ".webm", ".avi", ".m4v"];

const fit = (w, h = w) => `scale=w='min(iw,${w})':h='min(ih,${h})':force_original_aspect_ratio=decrease`;
const still = ["-frames:v", "1"];
const ENC = {
  // premultiply = transparent PNG composited over black (the site background), no halo on soft edges
  jpg: (vf, q = 4) => ["-map_metadata", "-1", "-vf", "format=rgba,premultiply=inplace=1,format=rgb24," + vf + ",format=yuvj420p","-q:v", String(q), ...still, "-update", "1"],
  avif: () => ["-c:v", "libsvtav1", "-crf", "34", "-g", "1", "-pix_fmt", "yuv420p", ...still],
  webp: () => ["-c:v", "libwebp", "-quality", "76", "-preset", "picture", ...still],
  mp4: () => ["-map_metadata", "-1", "-vf", "scale=-2:'min(ih,480)'", "-c:v", "libx264", "-preset", "slow", "-crf", "28",
    "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"],
  clip: (max, crf, t) => ["-map_metadata", "-1", ...(t ? ["-t", String(t)] : []), "-vf", fit(max) + ":force_divisible_by=2", "-c:v", "libx264", "-preset", "slow", "-crf", String(crf),
    "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart"]
};
// standalone images in assets/: max side of the slot they fill on the page
const ROOT_IMAGES = { "hero-robot": 1200, "portrait": 640, "showreel-poster": 1280 };

// ---------- helpers

const abs = rel => path.join(SITE, rel);
const exists = rel => fs.existsSync(abs(rel));
const rel = p => path.relative(SITE, p).split(path.sep).join("/");
const swapExt = (p, ext) => p.replace(/\.[^./]+$/, ext);
const stem = f => f.replace(/\.[^.]+$/, "");
const hashCache = new Map();
const hash = r => {
  if (!hashCache.has(r)) hashCache.set(r, crypto.createHash("sha1").update(fs.readFileSync(abs(r))).digest("hex").slice(0, 16));
  return hashCache.get(r);
};
const probe = r => {
  const o = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", abs(r)], { encoding: "utf8" });
  const [w, h] = String(o.stdout).trim().split(",").map(Number);
  return w && h ? { w, h } : {};
};
// newest raw file that should become `target` (same folder, same stem, raw extension)
const rawFor = (target, exts) => {
  const dir = path.dirname(abs(target)), base = stem(path.basename(target));
  if (!fs.existsSync(dir)) return null;
  const hits = fs.readdirSync(dir).filter(f => stem(f) === base && exts.includes(path.extname(f).toLowerCase()) && f !== path.basename(target))
    .map(f => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return hits.length ? rel(hits[0]) : null;
};

function ffmpeg(input, args, out) {
  const tmp = swapExt(abs(out), ".tmp" + path.extname(out));
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-v", "error", "-y", "-i", abs(input), ...args, tmp], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", d => err += d);
    p.on("error", reject);
    p.on("close", code => {
      if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, abs(out)); resolve(); }
      else { fs.rmSync(tmp, { force: true }); reject(new Error(err.trim() || "ffmpeg exit " + code)); }
    });
  });
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}

// ---------- plan

if (spawnSync("ffmpeg", ["-version"]).status !== 0 || spawnSync("ffprobe", ["-version"]).status !== 0) {
  console.error("media: ffmpeg/ffprobe not found in PATH"); process.exit(1);
}
const manifest = fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : { files: {} };
const M = manifest.files;
const dataRaw = fs.readFileSync(DATA, "utf8");
const data = JSON.parse(dataRaw);
const projects = data.projects || [];

// stage 1: sources (compressed in place); stage 2: built from sources; stage 3: built from stage 2
const stages = [[], [], []];
const source = (out, raw, args) => stages[0].push({ out, raw, args, source: true });
const derive = (n, out, from, args) => stages[n].push({ out, from, args });
const pictures = (n, jpg) => { derive(n, swapExt(jpg, ".avif"), jpg, ENC.avif()); derive(n, swapExt(jpg, ".webp"), jpg, ENC.webp()); };

// gallery renders and clips; a number without the leading zero is the same slot: 1.png → 01.jpg, 1.mov → 01.mp4
const galleries = {}, clips = {}, shown = {}, blockers = [];
const gdir = abs("assets/gallery");
for (const id of fs.existsSync(gdir) ? fs.readdirSync(gdir).sort() : []) {
  if (!fs.statSync(path.join(gdir, id)).isDirectory()) continue;
  galleries[id] = []; clips[id] = [];
  for (const [ext, rawExts] of [[".jpg", RAW_IMG], [".mp4", RAW_VID]]) {
    const slots = new Map();      // canonical stem → files of the folder that fill it
    for (const f of fs.readdirSync(path.join(gdir, id))) {
      if (![ext, ...rawExts].includes(path.extname(f).toLowerCase()) || /\.tmp\.[^.]+$/.test(f)) continue;
      const s = /^\d$/.test(stem(f)) ? "0" + stem(f) : stem(f);
      slots.set(s, [...(slots.get(s) || []), f]);
    }
    for (const s of [...slots.keys()].sort()) {
      const dir = `assets/gallery/${id}/`, out = `${dir}${s}${ext}`;
      const own = slots.get(s).find(f => f.toLowerCase() === s.toLowerCase() + ext);
      const raws = slots.get(s).filter(f => f !== own);
      const renamed = raws.filter(f => stem(f) !== s);
      if (own && renamed.length) { blockers.push(`gallery/${id}: ${own} and ${renamed.join(", ")} are the same slot, keep one`); continue; }
      const raw = raws.map(f => dir + f).sort((a, b) => fs.statSync(abs(b)).mtimeMs - fs.statSync(abs(a)).mtimeMs)[0] || null;
      shown[out] = path.basename(raw || out);
      const sm = `${dir}sm/${s}${ext}`;
      if (ext === ".mp4") { clips[id].push(out); source(out, raw, ENC.clip(1920, 23)); derive(1, sm, out, ENC.clip(960, 28, 8)); continue; }
      galleries[id].push(out);
      source(out, raw, ENC.jpg(fit(1600)));
      derive(1, sm, out, ENC.jpg("scale=-2:'min(ih,480)'"));
      pictures(1, out);
      pictures(2, sm);
    }
  }
}

// card thumbnails: first render of each project (or of a gallery folder not in portfolio.json yet);
// no renders at all: the first frame of its first gallery clip
const thumbs = new Map();
const firstOf = (id, media) => {
  const img = media.find(m => m.t === "image" && m.src), clip = media.find(m => m.t === "video" && (m.src || "").startsWith("assets/gallery/"));
  return img ? img.src : (galleries[id] || [])[0] || (clip ? clip.src : (clips[id] || [])[0]);
};
for (const p of projects) {
  const src = firstOf(p.id, p.media || []);
  if (src) thumbs.set(p.thumb || `assets/thumbs/${p.id}.jpg`, src);
}
for (const id in galleries) {
  const src = !projects.some(p => p.id === id) && firstOf(id, []);
  if (src) thumbs.set(`assets/thumbs/${id}.jpg`, src);
}
for (const [thumb, src] of thumbs) {
  derive(1, thumb, src, ENC.jpg(fit(640, 900)));
  pictures(2, thumb);
}

// standalone images and the showreel
for (const [name, max] of Object.entries(ROOT_IMAGES)) {
  const jpg = `assets/${name}.jpg`;
  source(jpg, rawFor(jpg, RAW_IMG), ENC.jpg(fit(max)));
  pictures(1, jpg);
}
source("assets/og.jpg", rawFor("assets/og.jpg", RAW_IMG), ENC.jpg("scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630", 3));
source("assets/showreel.mp4", rawFor("assets/showreel.mp4", RAW_VID), ENC.mp4());

// portfolio.json must not point at renders that are gone: stop before encoding anything
const planned = new Set(stages[0].filter(j => j.raw).map(j => j.out));
for (const p of projects) {
  const local = (p.media || []).filter(m => (m.t === "image" || m.t === "video") && m.src && !/^https?:/.test(m.src));
  const missing = local.filter(m => !exists(m.src) && !planned.has(m.src)).map(m => path.basename(m.src));
  if (!missing.length) continue;
  const known = new Set(local.map(m => m.src));
  const extra = [...(galleries[p.id] || []), ...(clips[p.id] || [])].filter(s => !known.has(s)).map(s => shown[s]);
  blockers.push(`${p.id}: portfolio.json points to missing ${missing.join(", ")}` + (extra.length
    ? `\n    the folder has ${extra.join(", ")} not in portfolio.json: if they replace the missing ones, give them the missing names`
    : `\n    put the files back or remove these entries from portfolio.json`));
}
if (blockers.length) {
  console.error("media: nothing done, fix this first:\n" + blockers.map(b => "  " + b).join("\n"));
  process.exit(1);
}

// ---------- run

const dirty = new Set();      // outputs rebuilt in this run (or that would be, with --dry)
const failed = [];
const log = (tag, msg) => console.log(`  ${tag.padEnd(7)} ${msg}`);
const record = (out, src) => {
  M[out] = { src };
  if (/\.(jpg|mp4)$/.test(out) && (out.startsWith("assets/gallery/") && !out.includes("/sm/") || out.startsWith("assets/thumbs/"))) Object.assign(M[out], probe(out));
};

function due(job) {
  if (job.source) {
    if (job.raw) return true;
    return exists(job.out) && (!M[job.out] || M[job.out].src !== hash(job.out));
  }
  if (!exists(job.from) && !dirty.has(job.from)) return false;
  return dirty.has(job.from) || !exists(job.out) || !M[job.out] || M[job.out].src !== hash(job.from);
}

const n = Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));
for (const stage of stages) {
  const jobs = stage.filter(j => ADOPT ? !j.raw && exists(j.out) && (j.source || exists(j.from)) : due(j));
  await pool(jobs, n, async job => {
    const input = job.source ? job.raw || job.out : job.from;
    if (ADOPT) { record(job.out, hash(input)); return; }
    const what = job.source ? (job.raw ? `${job.raw} → ${job.out}` : `${job.out} (new or replaced)`) : `${job.out} ← ${job.from}`;
    if (DRY) { dirty.add(job.out); log(job.source ? "source" : "build", what); return; }
    try {
      await ffmpeg(input, job.args, job.out);
      if (job.raw) fs.rmSync(abs(job.raw));
      hashCache.delete(job.out);
      record(job.out, job.source ? hash(job.out) : hash(job.from));
      dirty.add(job.out);
      log(job.source ? "source" : "build", what);
    } catch (e) {
      failed.push(job.out);
      log("FAILED", `${what}\n          ${e.message.split("\n").join("\n          ")}`);
    }
  });
}
if (ADOPT) console.log(`  adopted ${Object.keys(M).length} files as already processed`);

// ---------- orphans: derived files whose source is gone

const owned = new Set(stages.flat().flatMap(j => j.raw ? [j.out, j.raw] : [j.out]));   // a raw still here failed to convert: keep it
const orphans = [];
for (const id of fs.existsSync(gdir) ? fs.readdirSync(gdir) : []) {
  for (const dir of [`assets/gallery/${id}`, `assets/gallery/${id}/sm`]) {
    if (!exists(dir) || !fs.statSync(abs(dir)).isDirectory()) continue;
    for (const f of fs.readdirSync(abs(dir))) {
      const r = `${dir}/${f}`;
      if (/\.(jpg|avif|webp|mp4)$/.test(f) && !owned.has(r)) orphans.push(r);
    }
  }
}
if (exists("assets/thumbs")) for (const f of fs.readdirSync(abs("assets/thumbs"))) if (!owned.has(`assets/thumbs/${f}`)) orphans.push(`assets/thumbs/${f}`);
for (const r of orphans) {
  if (PRUNE && !DRY) { fs.rmSync(abs(r)); log("pruned", r); }
  else log("orphan", r + (PRUNE ? "" : "  (--prune deletes it)"));
}
for (const r of Object.keys(M)) if (!exists(r) && !DRY) delete M[r];

// ---------- portfolio.json

const changes = [];
const ratioOf = r => M[r] && M[r].w ? `${M[r].w}/${M[r].h}` : null;
for (const p of projects) {
  const images = (p.media || []).filter(m => m.t === "image");
  for (const m of images) {
    if (!m.src) continue;
    if (!exists(m.src)) continue;   // only with --dry: a render that is still to be converted
    const sm = m.src.replace(/\/([^/]+)$/, "/sm/$1");
    if (!m.sm && m.src.startsWith("assets/gallery/") && owned.has(sm)) { m.sm = sm; changes.push(`${p.id}: sm for ${m.src}`); }
    const r = ratioOf(m.src);
    if (r && m.ratio !== r) { changes.push(`${p.id}: ratio ${m.src} ${m.ratio || "—"} → ${r}`); m.ratio = r; }
  }
  // renders added to the project's gallery folder
  const known = new Set(images.map(m => m.src));
  for (const src of galleries[p.id] || []) {
    if (known.has(src)) continue;
    const num = String(images.length + 1).padStart(2, "0");
    const m = { t: "image", label: `RENDER ${num}`, ratio: ratioOf(src) || undefined, src, sm: src.replace(/\/([^/]+)$/, "/sm/$1") };
    (p.media = p.media || []).push(m); images.push(m);
    changes.push(`${p.id}: added ${src}`);
  }
  // clips added to the project's gallery folder
  const videos = (p.media || []).filter(m => m.t === "video");
  for (const m of videos) {
    const sm = m.src && m.src.replace(/\/([^/]+)$/, "/sm/$1");
    if (sm && !m.sm && m.src.startsWith("assets/gallery/") && owned.has(sm)) { m.sm = sm; changes.push(`${p.id}: sm for ${m.src}`); }
    const r = m.src && exists(m.src) && ratioOf(m.src);
    if (r && m.ratio !== r) { changes.push(`${p.id}: ratio ${m.src} ${m.ratio || "—"} → ${r}`); m.ratio = r; }
  }
  const knownClips = new Set(videos.map(m => m.src));
  for (const src of clips[p.id] || []) {
    if (knownClips.has(src)) continue;
    const m = { t: "video", label: `VIDEO ${String(videos.length + 1).padStart(2, "0")}`, ratio: ratioOf(src) || undefined, src, sm: src.replace(/\/([^/]+)$/, "/sm/$1") };
    (p.media = p.media || []).push(m); videos.push(m);
    changes.push(`${p.id}: added ${src}` + (p.kindKey === "IMAGE" ? "  (kindKey is still IMAGE — VIDEO if the clip is the point of the work)" : ""));
  }
  if (!p.thumb && thumbs.has(`assets/thumbs/${p.id}.jpg`)) { p.thumb = `assets/thumbs/${p.id}.jpg`; changes.push(`${p.id}: thumb ${p.thumb}`); }
  const tr = p.thumb && ratioOf(p.thumb);
  if (tr && p.thumbRatio !== tr) { changes.push(`${p.id}: thumbRatio ${p.thumbRatio || "—"} → ${tr}`); p.thumbRatio = tr; }
}
for (const c of changes) log("json", c);
if (changes.length && !DRY) {
  const eol = dataRaw.includes("\r\n") ? "\r\n" : "\n";
  let out = JSON.stringify(data, null, 2).replace(/\n/g, eol);
  if (/\r?\n$/.test(dataRaw)) out += eol;
  fs.writeFileSync(DATA, out);
}

// gallery folders without a project: the object has to be written by hand
for (const id in galleries) {
  if (!galleries[id].length && !clips[id].length || projects.some(p => p.id === id)) continue;
  const skeleton = {
    id, title: "", year: "", role: "", software: "", tris: "", topic: "", tags: [], kindKey: clips[id].length && !galleries[id].length ? "VIDEO" : "IMAGE", layout: "render",
    slot: id.toUpperCase(), thumb: `assets/thumbs/${id}.jpg`, thumbRatio: ratioOf(`assets/thumbs/${id}.jpg`) || "", summary: "",
    media: [...galleries[id].map((src, i) => ({ t: "image", label: `RENDER ${String(i + 1).padStart(2, "0")}`, ratio: ratioOf(src) || "", src, sm: src.replace(/\/([^/]+)$/, "/sm/$1") })),
      ...clips[id].map((src, i) => ({ t: "video", label: `VIDEO ${String(i + 1).padStart(2, "0")}`, ratio: ratioOf(src) || "", src, sm: src.replace(/\/([^/]+)$/, "/sm/$1") }))]
  };
  console.log(`\n  gallery/${id} has no project in portfolio.json. Fill in and add to "projects":\n`);
  console.log(JSON.stringify(skeleton, null, 2).replace(/^/gm, "    "));
}

if (!DRY) fs.writeFileSync(MANIFEST, JSON.stringify({
  about: "Written by tools/media.mjs. For each file: hash of the file it was built from (a source: its own hash). Do not edit by hand.",
  files: Object.fromEntries(Object.keys(M).sort().map(k => [k, M[k]]))
}, null, 2) + "\n");

const built = dirty.size;
console.log(`\nmedia: ${DRY ? "would rebuild" : "rebuilt"} ${built} file(s)${failed.length ? `, ${failed.length} failed` : ""}${built || ADOPT || changes.length ? "" : " — everything is up to date"}`);
if (failed.length) process.exit(1);
if (CHECK && (built || changes.length)) {
  console.log("media: not processed yet — run `node tools/media.mjs`, then commit again");
  process.exit(1);
}
