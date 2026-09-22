#!/usr/bin/env node
/**
 * Portfolio sync — ArtStation (primary) + Sketchfab + YouTube (enrichment).
 * Node 18+, zero dependencies. Writes site/data/portfolio.json.
 *
 *   node sync/sync.mjs                 # normal run
 *   node sync/sync.mjs --dry           # print result, write nothing
 *   node sync/sync.mjs --thumbs        # also download thumbnails into site/assets/thumbs
 *   node sync/sync.mjs --limit 12      # cap project count
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = n => argv.includes("--" + n);
const opt = (n, d) => { const i = argv.indexOf("--" + n); return i > -1 ? argv[i + 1] : d; };

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const BROWSER_HEADERS = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
  "Referer": "https://www.artstation.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin"
};
const log = (...a) => console.log("·", ...a);
const warn = (...a) => console.warn("!", ...a);

async function json(url, tries = 3) {
  let last;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: "application/json, text/plain, */*" } });
      if (r.status === 429) { await sleep(4000 * i); continue; }
      if (r.status === 403) { const e = new Error("403 " + url); e.blocked = true; throw e; }
      if (!r.ok) throw new Error(r.status + " " + url);
      return await r.json();
    } catch (e) {
      last = e;
      if (e.blocked || i === tries) throw e;
      await sleep(1200 * i);
    }
  }
  throw last;
}
async function text(url) {
  const r = await fetch(url, { headers: { ...BROWSER_HEADERS, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
  if (r.status === 403) { const e = new Error("403 " + url); e.blocked = true; throw e; }
  if (!r.ok) throw new Error(r.status + " " + url);
  return r.text();
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- config ---------------- */

const cfg = JSON.parse(await readFile(path.join(ROOT, "sync/config.json"), "utf8"));
const overridesPath = path.join(ROOT, "sync/overrides.json");
const overridesRaw = existsSync(overridesPath) ? JSON.parse(await readFile(overridesPath, "utf8")) : {};
const overrides = Object.fromEntries(Object.entries(overridesRaw).filter(([k]) => !k.startsWith("_")));
const outPath = path.join(ROOT, cfg.output || "site/data/portfolio.json");
const LIMIT = Number(opt("limit", cfg.limit || 40));

/* ---------------- ArtStation ---------------- */
/* Undocumented but stable public JSON endpoints used by artstation.com itself. */

async function artstationList(user) {
  const out = [];
  for (let page = 1; page <= 8; page++) {
    const d = await json(`https://www.artstation.com/users/${user}/projects.json?page=${page}`);
    const rows = d.data || [];
    out.push(...rows);
    log(`artstation page ${page}: +${rows.length} (total ${d.total_count ?? "?"})`);
    if (!rows.length || out.length >= (d.total_count || out.length) || out.length >= LIMIT) break;
    await sleep(500);
  }
  return out.slice(0, LIMIT);
}

const artstationDetail = hashId => json(`https://www.artstation.com/projects/${hashId}.json`);

/* ---------------- embed parsing ---------------- */

const YT = [/youtube\.com\/embed\/([\w-]{6,})/i, /youtu\.be\/([\w-]{6,})/i, /youtube\.com\/watch\?v=([\w-]{6,})/i];
const SF = [/sketchfab\.com\/models\/([0-9a-f]{16,})/i, /sketchfab\.com\/3d-models\/[^"'\s]*-([0-9a-f]{16,})/i];

const firstMatch = (s, pats) => { for (const p of pats) { const m = p.exec(s || ""); if (m) return m[1]; } return null; };

function assetToBlock(a) {
  const embed = a.player_embedded || "";
  const type = (a.asset_type || "").toLowerCase();
  const label = (a.title || "").trim();

  const yt = firstMatch(embed, YT);
  if (yt) return { t: "youtube", videoId: yt, label: label || "BREAKDOWN · YOUTUBE" };

  const sf = firstMatch(embed, SF);
  if (sf) return { t: "sketchfab", modelId: sf, label: label || "3D VIEWER · SKETCHFAB" };

  if (type === "video" || type === "video_clip") {
    const src = a.image_url || firstMatch(embed, [/src="([^"]+\.mp4[^"]*)"/i]);
    if (src) return { t: "video", src, label: label || "TURNTABLE" };
  }
  if (a.image_url && (type === "image" || type === "cover" || type === "pano")) {
    return { t: "image", src: a.image_url, label: label || "", ratio: a.width && a.height ? `${a.width}/${a.height}` : undefined };
  }
  return null;
}

/* ---------------- taxonomy ---------------- */

const BUCKETS = cfg.buckets || {
  "HARD-SURFACE": ["hard surface", "hardsurface", "mech", "weapon", "vehicle", "robot", "prop", "armor", "helmet", "sci-fi", "scifi"],
  ENVIRONMENT: ["environment", "architecture", "level", "landscape", "interior", "exterior", "scene", "archviz"],
  "VFX / SIM": ["vfx", "simulation", "houdini", "fx", "particles", "cloth", "destruction", "fluid", "smoke"],
  "GAME-READY": ["game", "game-ready", "gameready", "unreal", "unity", "low poly", "lowpoly", "pbr", "real-time", "realtime"]
};

function bucketsFor(p) {
  const hay = [p.title, p.description, ...(p.tags || []), ...(p.categories || []).map(c => c.name || c), (p.medium && p.medium.name) || ""]
    .join(" ").toLowerCase();
  const hits = Object.entries(BUCKETS).filter(([, words]) => words.some(w => hay.includes(w))).map(([b]) => b);
  return hits.length ? hits : ["HARD-SURFACE"];
}

const KIND_ORDER = ["SKETCHFAB", "YOUTUBE", "VIDEO", "IMAGE"];
const kindFor = media => {
  const kinds = new Set(media.map(m => m.t.toUpperCase()));
  return KIND_ORDER.find(k => kinds.has(k)) || "IMAGE";
};

const slug = s => (s || "").toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 48) || "project";
const stripTags = s => (s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const clip = (s, n) => s.length > n ? s.slice(0, s.lastIndexOf(" ", n)) + "…" : s;

/* ---------------- Sketchfab (public API v3, no key) ---------------- */

async function sketchfabModels(user) {
  if (!user) return [];
  try {
    const d = await json(`https://api.sketchfab.com/v3/search?type=models&user=${encodeURIComponent(user)}&sort_by=-publishedAt&count=24`);
    const rows = (d.results || []).map(m => ({
      modelId: m.uid,
      name: m.name,
      faceCount: m.faceCount,
      thumb: (((m.thumbnails || {}).images || []).sort((a, b) => b.width - a.width)[0] || {}).url || null
    }));
    log(`sketchfab: ${rows.length} models for @${user}`);
    return rows;
  } catch (e) { warn("sketchfab failed:", e.message); return []; }
}

/* ---------------- YouTube (public RSS, no key) ---------------- */

/* resolve @handle -> UC... channel id, so config can hold just the handle */
async function youtubeChannelId() {
  if (cfg.youtubeChannelId) return cfg.youtubeChannelId;
  const handle = cfg.youtubeHandle;
  if (!handle) return null;
  try {
    const html = await text(`https://www.youtube.com/${handle.startsWith("@") ? handle : "@" + handle}`);
    const id = (/"(?:channelId|externalId)":"(UC[\w-]{20,})"/.exec(html) || [])[1];
    if (id) log("resolved youtube handle", handle, "->", id);
    return id || null;
  } catch (e) { warn("youtube handle lookup failed:", e.message); return null; }
}

async function youtubeUploads(channelId) {
  if (!channelId) return [];
  try {
    const xml = await text(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    const rows = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
      videoId: (/<yt:videoId>(.*?)<\/yt:videoId>/.exec(e) || [])[1],
      title: stripTags((/<title>(.*?)<\/title>/.exec(e) || [])[1] || ""),
      published: (/<published>(.*?)<\/published>/.exec(e) || [])[1]
    })).filter(r => r.videoId);
    log(`youtube: ${rows.length} uploads`);
    return rows;
  } catch (e) { warn("youtube failed:", e.message); return []; }
}

/* fuzzy title match, so a Sketchfab/YouTube item attaches to the right project.
   Requires two shared significant words (one is too weak: "Robot Chappie" and
   "Robot Scout" would both grab the same video), and never reuses an item. */
const claimed = new Set();
function bestMatch(title, rows, key) {
  const norm = s => (s || "").toLowerCase().replace(/[^a-z0-9\u0400-\u04FF ]/g, " ").split(/\s+/).filter(w => w.length > 2);
  const a = norm(title);
  if (!a.length) return null;
  let best = null, score = 0;
  for (const r of rows) {
    const stamp = r.modelId || r.videoId;
    if (stamp && claimed.has(stamp)) continue;
    const b = norm(r[key] || r.name || r.title);
    const shared = a.filter(w => b.includes(w)).length;
    if (shared < 2) continue;
    const s = shared / Math.max(1, Math.min(a.length, b.length));
    if (s > score) { score = s; best = r; }
  }
  if (best) claimed.add(best.modelId || best.videoId);
  return score >= 0.5 ? best : null;
}

/* ---------------- thumbnails ---------------- */

async function downloadThumbs(projects) {
  const dir = path.join(ROOT, "site/assets/thumbs");
  await mkdir(dir, { recursive: true });
  for (const p of projects) {
    const first = (p.media || []).find(m => m.t === "image" && /^https?:/.test(m.src || ""));
    if (!first) continue;
    try {
      const r = await fetch(first.src, { headers: { "User-Agent": UA } });
      if (!r.ok) continue;
      const ext = (first.src.split("?")[0].match(/\.(jpg|jpeg|png|webp)$/i) || [, "jpg"])[1];
      const rel = `assets/thumbs/${p.id}.${ext}`;
      await writeFile(path.join(ROOT, "site", rel), Buffer.from(await r.arrayBuffer()));
      first.src = rel;
      log("thumb", rel);
    } catch (e) { warn("thumb failed", p.id, e.message); }
  }
}

/* ---------------- build ---------------- */

function mapProject(d, list, sfRows, ytRows) {
  const media = (d.assets || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0))
    .map(assetToBlock).filter(Boolean);

  // dedupe consecutive identical blocks
  const seen = new Set();
  const blocks = media.filter(m => {
    const k = m.t + ":" + (m.src || m.videoId || m.modelId);
    if (seen.has(k)) return false; seen.add(k); return true;
  });

  const title = stripTags(d.title) || list.title || "Untitled";
  const id = slug(title);
  const tags = bucketsFor(d);
  const software = (d.software_items || []).map(s => s.name).filter(Boolean).slice(0, 4).join(" · ");
  const year = String(new Date(d.published_at || list.published_at || Date.now()).getFullYear());
  const desc = stripTags(d.description);

  // enrichment: attach a Sketchfab model / YouTube video when ArtStation has none
  if (!blocks.some(b => b.t === "sketchfab")) {
    const m = bestMatch(title, sfRows, "name");
    if (m) blocks.push({ t: "sketchfab", modelId: m.modelId, label: "3D VIEWER · SKETCHFAB" });
  }
  if (!blocks.some(b => b.t === "youtube")) {
    const v = bestMatch(title, ytRows, "title");
    if (v) blocks.push({ t: "youtube", videoId: v.videoId, label: "BREAKDOWN · YOUTUBE" });
  }

  const sfHit = blocks.find(b => b.t === "sketchfab");
  const sfMeta = sfHit && sfRows.find(r => r.modelId === sfHit.modelId);

  const base = {
    id,
    title,
    year,
    role: cfg.defaults?.role || "3D Artist",
    software: software || cfg.defaults?.software || "Blender · Substance Painter",
    tris: sfMeta?.faceCount ? Intl.NumberFormat("en-US").format(sfMeta.faceCount) : cfg.defaults?.tris || "—",
    topic: tags[0],
    tags,
    kindKey: kindFor(blocks),
    slot: title.toUpperCase(),
    artstationUrl: d.permalink || list.permalink,
    summary: desc ? clip(desc, 320) : `${title} — ${tags.join(", ").toLowerCase()}.`,
    media: blocks.length ? blocks : [{ t: "image", src: list.cover?.thumb_url || null, label: title.toUpperCase() }]
  };
  return { ...base, ...(overrides[id] || {}) };
}

/* ---------------- main ---------------- */

const user = cfg.artstation;
if (!user) { console.error("sync/config.json: set \"artstation\" to your ArtStation username"); process.exit(1); }

log("artstation user:", user);
let list = [];
let artstationBlocked = false;
try {
  list = await artstationList(user);
} catch (e) {
  if (e.blocked) {
    artstationBlocked = true;
    warn("ArtStation returned 403 — Cloudflare blocked this IP.");
    warn("Datacenter IPs (GitHub Actions, most VPS) are refused; a home connection usually works.");
    warn("Falling back to Sketchfab + YouTube only. Existing portfolio.json data is preserved.");
  } else {
    warn("ArtStation failed:", e.message);
  }
}
if (!list.length && !artstationBlocked) warn("no ArtStation projects returned — check the username");

const [sfRows, ytRows] = await Promise.all([
  sketchfabModels(cfg.sketchfab),
  youtubeChannelId().then(youtubeUploads)
]);

/* ---------------- previous run, kept as the base ---------------- */

const prev = existsSync(outPath) ? JSON.parse(await readFile(outPath, "utf8")) : { projects: [] };
const prevById = new Map((prev.projects || []).map(p => [p.id, p]));

const projects = [];
for (const row of list) {
  try {
    const d = await artstationDetail(row.hash_id);
    const mapped = mapProject(d, row, sfRows, ytRows);
    /* keep anything a previous run or hand-edit filled in that ArtStation left empty */
    const old = prevById.get(mapped.id);
    if (old) for (const k of ["tris", "role", "software", "sketchfabUrl"]) {
      if ((!mapped[k] || mapped[k] === "\u2014") && old[k]) mapped[k] = old[k];
    }
    projects.push(mapped);
    log("ok", row.title);
  } catch (e) {
    warn("skip", row.title, e.message);
  }
  await sleep(400);
}

/* ArtStation unreachable: keep the projects we already have, refresh their
   Sketchfab / YouTube attachments so the run is still worth something */
if (!projects.length && (prev.projects || []).length) {
  for (const p of prev.projects) {
    const c = { ...p, media: (p.media || []).slice() };
    if (!c.media.some(b => b.t === "sketchfab")) {
      const m = bestMatch(c.title, sfRows, "name");
      if (m) c.media.unshift({ t: "sketchfab", modelId: m.modelId, label: "DRAG TO ORBIT", ratio: "16/9" });
    }
    if (!c.media.some(b => b.t === "youtube")) {
      const v = bestMatch(c.title, ytRows, "title");
      if (v) c.media.push({ t: "youtube", videoId: v.videoId, label: "BREAKDOWN · YOUTUBE" });
    }
    const sfHit = c.media.find(b => b.t === "sketchfab");
    const sfMeta = sfHit && sfRows.find(r => r.modelId === sfHit.modelId);
    if (sfMeta?.faceCount && (!c.tris || c.tris === "\u2014")) c.tris = Intl.NumberFormat("en-US").format(sfMeta.faceCount);
    if (sfMeta?.thumb) {
      const img = c.media.find(b => b.t === "image");
      if (img && !img.src) img.src = sfMeta.thumb;
      else if (!img) c.media.push({ t: "image", src: sfMeta.thumb, label: "RENDER", ratio: "4/3" });
    }
    c.kindKey = kindFor(c.media);
    projects.push({ ...c, ...(overrides[c.id] || {}) });
  }
  log(`kept ${projects.length} existing projects, enriched from Sketchfab/YouTube`);
}

/* local-only projects: fully authored in overrides.json (title + media present),
   no ArtStation/Sketchfab/YouTube candidate at all — e.g. renders imported by hand
   when a project only lives on ArtStation and ArtStation can't be reached. These
   survive every future sync run because they come from the checked-in overrides file,
   not from a platform fetch. */
const existingIds = new Set(projects.map(p => p.id));
for (const [id, ov] of Object.entries(overrides)) {
  if (existingIds.has(id) || !ov.title || !ov.media) continue;
  projects.push({
    id,
    title: ov.title,
    year: ov.year || "",
    role: ov.role || cfg.defaults?.role || "3D Artist",
    software: ov.software || cfg.defaults?.software || "Blender · Substance Painter",
    tris: ov.tris || cfg.defaults?.tris || "—",
    topic: ov.topic || (ov.tags && ov.tags[0]) || "",
    tags: ov.tags || [],
    kindKey: ov.kindKey || kindFor(ov.media),
    slot: ov.slot || ov.title.toUpperCase(),
    artstationUrl: ov.artstationUrl || `https://www.artstation.com/${user}`,
    summary: ov.summary || "",
    media: ov.media
  });
  log("local", ov.title);
}

if (!projects.length) { console.error("nothing to write — no ArtStation data and no existing portfolio.json"); process.exit(1); }

/* unique ids */
const used = new Map();
for (const p of projects) {
  const n = (used.get(p.id) || 0) + 1;
  used.set(p.id, n);
  if (n > 1) p.id += "-" + n;
}

if (flag("thumbs")) await downloadThumbs(projects);

const reelId = cfg.reel?.videoId || ytRows[0]?.videoId || null;
const out = {
  source: {
    platform: artstationBlocked ? "sketchfab+youtube" : "artstation",
    profile: `https://www.artstation.com/${user}`,
    sketchfab: cfg.sketchfab ? `https://sketchfab.com/${cfg.sketchfab}` : undefined,
    youtube: prev.source?.youtube || (cfg.youtubeHandle ? `https://www.youtube.com/${cfg.youtubeHandle}` : undefined),
    syncedAt: new Date().toISOString(),
    status: artstationBlocked ? "partial" : "ok",
    note: artstationBlocked
      ? "ArtStation refused this IP (403 via Cloudflare). Run the sync from a home connection to pull ArtStation data."
      : undefined,
    counts: { projects: projects.length, sketchfab: sfRows.length, youtube: ytRows.length }
  },
  reel: prev.reel && prev.reel.src ? prev.reel : { videoId: reelId, duration: cfg.reel?.duration || "", title: cfg.reel?.title || "Showreel" },
  projects
};

if (flag("dry")) {
  console.log(JSON.stringify(out, null, 2));
} else {
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(out, null, 2) + "\n");
  log(`wrote ${path.relative(ROOT, outPath)} — ${projects.length} projects`);
}
