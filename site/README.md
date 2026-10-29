# Site

`site/` is the whole website — plain HTML, CSS and JS, no build step, no dependencies.

    site/
      index.html                 markup, styles, scripts, UI strings (EN/RU)
      data/portfolio.json        all content: projects, reel, experience
      assets/showreel.mp4        local showreel (autoplay, muted, loop) + showreel-poster.jpg
      assets/thumbs/             grid thumbnails
      assets/gallery/<id>/       project renders, max side 1600px
      assets/gallery/<id>/sm/    the same renders at 480px height (gallery strip on phones / 1x screens)
      assets/favicon.svg, apple-touch-icon.png, og.jpg (1200×630 link preview)
    tools/seo.mjs                generates SEO pages at deploy time (see below)
    .github/workflows/deploy.yml publishes to GitHub Pages on every push to main

Content is edited by hand in `data/portfolio.json`. There is no automatic sync
(ArtStation blocks data-centre IPs), see `PROJECT.md`.

## Local check

The JSON fetch does not work from `file://`, use a local server:

    cd site
    python3 -m http.server 8000     # → http://localhost:8000

Locally the site uses hash routes (`#/project/<id>`, `#/privacy`).

## Publishing (GitHub Pages, free)

1. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
   On a free account the repository must be public.
2. Push to `main`. The "Deploy site" workflow runs `tools/seo.mjs` and publishes.
   Progress: Actions tab. The site appears at `https://jey-key30.github.io/render-vision-website/`.
3. Custom domain later: buy it, add it in Settings → Pages → Custom domain, and at the
   registrar create a `CNAME` record `www → jey-key30.github.io` (or four `A` records for the
   bare domain: 185.199.108.153, .109.153, .110.153, .111.153). Tick "Enforce HTTPS".
   The next deploy picks up the domain automatically — canonical links, sitemap and
   link previews switch to it without code changes.

## SEO pages (tools/seo.mjs)

On deploy the script copies `site/` to `_site/` and adds real pages for every URL:
`/en/`, `/ru/`, `/<lang>/work/<id>/`, `/<lang>/privacy/`, plus `404.html`, `sitemap.xml`,
`robots.txt`. Each page carries its own title, description, canonical, hreflang, Open Graph,
JSON-LD and prerendered text; the page script then takes over and navigates with clean URLs.
Project, privacy and 404 pages carry only their own `<main>` (no hidden home page), and every path
is absolute from the site root, without `<base>`. Details: `PROJECT.md`, «Адреса и SEO».
Run locally to inspect: `node tools/seo.mjs https://example.com/ _site` (without the address it uses `BRAND.siteUrl`).
`node tools/seo.mjs --check` builds and checks every page (deploy runs it: errors stop the deploy,
text warnings do not); `node tools/seo.mjs --live https://hardframe3d.com` checks the published site.

After the first deploy, add the site to Google Search Console and Yandex Webmaster and
submit `sitemap.xml` there (on a github.io sub-path robots.txt is not read by crawlers,
so the sitemap has to be submitted by hand).

## Brand

Name, hero words, site address, contact email, hero render and profile links are set once, in
`const BRAND` in `index.html`. The page, `tools/seo.mjs` and `tools/cv.mjs` all read it; UI strings
refer to it as `{brand}`, `{email}`, `{tg}`, `{tgName}`. After changing `siteUrl`, `email` or the
links, run `node tools/cv.mjs` so the PDF CVs pick them up.

## Brief form

Sends through FormSubmit.co (free, no account) to `freelancejeykey@gmail.com`. The form posts to the
random alias `formsubmit.co/ajax/8454ad22614da842f6a7f4a38544bf36`, so the address is not in the page code.
The first submission from the **published** site sends an "Activate Form" email to that
address (check spam). Click it once; from then on briefs arrive as normal emails.
Submissions from a local file or a preview sandbox are rejected by FormSubmit.
The form requires ticking the personal-data consent box; the policy lives at `/<lang>/privacy/`
(text in `I18N` → `pp.body`).

## Languages

EN / RU switch in the header. On the published site the language is part of the URL
(`/en/…`, `/ru/…`); locally it is stored in `localStorage` (`rv-lang`), `?lang=ru` forces it.
UI strings live in `I18N` in `index.html`. Project text: `summary_ru` next to `summary`;
experience entries use `{ "en": …, "ru": … }` objects.

## Adding a project

Shortcut: drop renders into `site/assets/gallery/<id>/` and run `node tools/media.mjs` —
it compresses them and builds `sm/`, the thumbnail, AVIF/WebP and the `portfolio.json`
ratios (see `PROJECT.md`). The manual steps below are what it does.

1. Renders → `site/assets/gallery/<id>/01.jpg…` (max side 1600px).
2. Strip copies at 480px height:

       for f in site/assets/gallery/<id>/*.jpg; do
         mkdir -p "$(dirname "$f")/sm"
         ffmpeg -y -i "$f" -vf "scale=-2:480" -q:v 4 "$(dirname "$f")/sm/$(basename "$f")"
       done

3. Thumbnail → `site/assets/thumbs/<id>.jpg` (see `PROJECT.md`).
4. Project object in `portfolio.json`; each image `{ "t": "image", "src": …, "sm": … }`.

## Adding a client case (not on ArtStation)

A case is an ordinary project: same card in the grid, same project page. It simply has no
`artstationUrl` (then the page shows no "View on ArtStation" link) and usually fills the case fields.

1. In `portfolio.json` copy the `case-template` project (it is at the end of `projects`).
   Give the copy its own `id` (a-z, 0-9, dashes — it becomes the URL) and keep `"hidden": true` for now.
2. Put renders and videos into `site/assets/gallery/<id>/` (`01.png`, `02.mov`… any size)
   and run `node tools/media.mjs`: it compresses them, makes the thumbnail and fills `media`.
3. Fill the fields. Text is a string or `{ "en": …, "ru": … }`; delete any field you don't need:
   - `summary` / `summary_ru` — the description, first paragraph goes to the meta description;
   - `task`, `what_i_did`, `result` — "task — what I did — result" blocks under the description;
   - `production` — `{ "name": "Studio", "url": "https://…" }`, a "Production" line in the facts (`url` optional);
   - `ai_used` — what AI did, one line in the facts;
   - `credit` — `{ "text": { "en": "Based on the design by {name}.", … }, "name": "Author", "url": "https://…" }`,
     the first line of the description; `{name}` becomes the link.
4. Check it locally: `http://localhost:8000/#/project/<id>` opens hidden projects too.
   A value starting with `TODO` is shown with a red dashed frame locally and never on the published site.
5. Remove `"hidden": true` — the case appears in the grid, counters, SEO pages and sitemap.
   Leave `case-template` itself hidden, it is the pattern for the next case.
