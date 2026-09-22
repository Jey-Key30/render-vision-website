# Deploy

`site/` is the whole website — plain HTML, CSS and JS, no build step.

    site/
      index.html
      assets/hero-robot.png
      assets/portrait.jpg
      data/portfolio.json

## Local check

Open it through a local server (the JSON fetch will not work from `file://`):

    cd site
    python3 -m http.server 8000     # → http://localhost:8000

## Publish

**Vercel** — push `site/` to the repo, import the repo, set Output Directory to `site`,
Framework Preset to "Other". Custom domain in Project → Settings → Domains.

**GitHub Pages** — put the contents of `site/` on the `gh-pages` branch (or set Pages
source to `/site` on `main`). Custom domain in Settings → Pages, plus a `CNAME` record
at your registrar.

**Any hosting** — upload the contents of `site/` to the web root.

## Before going live

1. `data/portfolio.json` — replace the placeholder projects with the real ones, fill
   `src` for images, `videoId` for YouTube blocks and `modelId` for Sketchfab.
   See `PROJECT.md` → "Формат portfolio.json" for the field contract.
2. Experience rows in `index.html` still read `[PERIOD] / [ROLE / STUDIO]`.
3. The brief form is in demo mode. Set `action` on `<form id="brief">` to a real endpoint
   (Formspree, Getform, your own handler) and it starts sending.
4. `og:image` points at the hero render — swap it for a wide 1200×630 image if you have one.

## Relation to the prototype

`Render Vision Prototype.dc.html` stays the working design file. `site/index.html` is the
deployable build of the same design; changes made in one do not travel to the other
automatically — tell me which one to update.
