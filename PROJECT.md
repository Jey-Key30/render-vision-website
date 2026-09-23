# Портфолио 3D-художника — Kirill (J-K3.0)

Статичный сайт-портфолио. Без сборки, без фреймворков, без зависимостей.
Работает из `site/` через любой локальный сервер. Публикация: GitHub Pages
(`.github/workflows/deploy.yml`), при деплое `tools/seo.mjs` дописывает SEO-страницы.

## Структура

    site/index.html              весь сайт: разметка, CSS и JS в одном файле
    site/data/portfolio.json     единственный источник контента, правится вручную
    site/assets/showreel.mp4     шоурил, играет локально (не с YouTube)
    site/assets/thumbs/          сжатые миниатюры карточек, копии первого кадра галереи
    site/assets/gallery/<id>/    галереи рендеров по каждому проекту (макс. сторона 1600px)
    site/assets/gallery/<id>/sm/ те же рендеры высотой 480px для ленты галереи
    tools/seo.mjs                генератор SEO-страниц, запускается только при деплое
    .github/workflows/deploy.yml публикация на GitHub Pages при push в main

Репозиторий: `Jey-Key30/render-vision-website`, ветка `main`.

## Как работает контент

Сайт не хранит контент в разметке. `site/index.html` читает `portfolio.json`
и рендерит из него сетку работ, страницы проектов и шоурил. Если fetch не удался,
страница показывает `SYNC FAILED · NO DATA` и остаётся рабочей.

Раньше контент собирался автоматическим скриптом (`sync/sync.mjs`) из ArtStation,
Sketchfab и YouTube через GitHub Actions. От этого отказались: ArtStation стоит
за Cloudflare и отдаёт 403 на IP дата-центров (GitHub Actions, большинство VPS),
так что автосинк с ArtStation никогда не отрабатывал в облаке. Скрипт и workflow
удалены. Пока работы храним и правим локально, прямо в `portfolio.json`.

Источники, из которых собран текущий контент (не часть репозитория, лежат рядом
на диске у владельца):

- `ArtStation_j-k30_artworks/` — папки с рендерами по каждой работе,
  сжатые копии лежат в `site/assets/gallery/<id>/`.
- `artstation_j-k30_metadata.json` — выгрузка метаданных с ArtStation
  (название, год, софт, теги, описание) для тех же работ.

## Формат portfolio.json

Верхний уровень: `source` (справочная информация), `reel` (шоурил),
`about.experience` (опыт и образование: `kind` work|edu, `period`, `role`, `company`,
`lead`, `points[]`, каждое поле объектом `{ "en": …, "ru": … }`),
`projects` (массив работ). Каждый проект:

    id            slug, используется в URL (#/project/<id>) и как ключ галереи
    title, year, role, software, tris, summary   текстовые поля
    topic, tags   категории для фильтра (ALL / HARD-SURFACE / ENVIRONMENT / VFX / SIM / GAME-READY)
    kindKey       бейдж и фильтр по типу медиа (IMAGE / VIDEO / YOUTUBE / SKETCHFAB)
    slot          подпись-заглушка, пока нет превью (обычно title.toUpperCase())
    thumb         сжатая миниатюра для карточки в сетке (assets/thumbs/<id>.jpg)
    thumbRatio    пропорции миниатюры в пикселях, "640/357" — из них считается высота
                  карточки в masonry-сетке до загрузки картинки
    artstationUrl, sketchfabUrl   ссылки на площадки (не обязательны)
    media[]       блоки на странице проекта, каждый — один из:
                    { t:"image", src, sm, label, ratio }   (sm — копия 480px по высоте)
                    { t:"sketchfab", modelId, label, ratio }
                    { t:"youtube", videoId, label } или { t:"youtube", url, label } (ссылка-заглушка)
    summary_ru    необязательный русский перевод summary

Пустая строка/`"—"` в текстовом поле — значит, данных пока нет, поле не показывается.

Языки: переключатель EN/RU в шапке, строки интерфейса лежат в объекте `I18N` в `site/index.html`.
Форма брифа отправляется через FormSubmit.co (бесплатно, без аккаунта), см. `site/README.md`.

## Адреса и SEO

На опубликованном сайте адреса чистые: `/en/`, `/ru/`, `/<lang>/work/<id>/`, `/<lang>/privacy/`.
За каждым стоит файл, который `tools/seo.mjs` генерирует при деплое в `_site/` (в репозиторий
не коммитится): свои title/description/canonical/hreflang/OG/JSON-LD и готовый текст для
поисковиков. Сайт узнаёт этот режим по `<meta name="rv-static">`. Локально и в превью
такого мета нет, работают hash-адреса `#/project/<id>`, `#/privacy`. `site/` генератор не меняет.

Политика конфиденциальности — ключи `pp.*` в `I18N`; форма не отправляется без галочки согласия.

## Правила работы с проектом

- Никаких зависимостей, сборщиков и фреймворков. Vanilla JS, один HTML-файл.
  Исключение — `tools/seo.mjs` (чистый Node, без пакетов), он только дописывает страницы при деплое.
- Стили — внутри `site/index.html`, отдельных CSS-файлов нет.
- Контент правится только через `site/data/portfolio.json`, никогда
  хардкодом в разметке.
- Новые работы: положить сжатые рендеры в `site/assets/gallery/<id>/`
  (см. пример импорта — сжатие через ffmpeg, макс. сторона 1600px), копии высотой 480px
  в `sm/` (`ffmpeg -i 01.jpg -vf scale=-2:480 -q:v 4 sm/01.jpg`), и вручную дописать
  объект проекта в `portfolio.json` с полями `src` и `sm` у каждой картинки.
- Миниатюра карточки делается из первого кадра галереи, пропорции сохраняются,
  кадр не обрезается:

      ffmpeg -y -i site/assets/gallery/<id>/01.jpg         -vf "scale=w=640:h=900:force_original_aspect_ratio=decrease"         -q:v 4 site/assets/thumbs/<id>.jpg

  Размеры получившегося файла (`ffprobe`) записать в `thumbRatio`.
- Сетка работ — masonry: рамка карточки принимает пропорции работы, высота строк
  пересчитывается в `masonry()` в `site/index.html`.
- Шоурил играет локально из `site/assets/showreel.mp4`: автоплей, muted, loop,
  поверх затемнение и ссылка на YouTube. Возврат к YouTube-эмбеду нежелателен —
  он требует прохождения проверки «вы не бот».

## Палитра и типографика

    фон        #0a0a0a
    акцент     #B22B2B
    текст      #e6e2de
    приглушён  #6f6b68

Моноширинный шрифт для меты и подписей, крупная жирная италика для заголовков.
