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
Run locally to inspect: `node tools/seo.mjs https://example.com/ _site`.

After the first deploy, add the site to Google Search Console and Yandex Webmaster and
submit `sitemap.xml` there (on a github.io sub-path robots.txt is not read by crawlers,
so the sitemap has to be submitted by hand).

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

1. Renders → `site/assets/gallery/<id>/01.jpg…` (max side 1600px).
2. Strip copies at 480px height:

       for f in site/assets/gallery/<id>/*.jpg; do
         mkdir -p "$(dirname "$f")/sm"
         ffmpeg -y -i "$f" -vf "scale=-2:480" -q:v 4 "$(dirname "$f")/sm/$(basename "$f")"
       done

3. Thumbnail → `site/assets/thumbs/<id>.jpg` (see `PROJECT.md`).
4. Project object in `portfolio.json`; each image `{ "t": "image", "src": …, "sm": … }`.
