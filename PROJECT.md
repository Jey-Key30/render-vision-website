# Портфолио 3D-художника — Kirill (J-K3.0)

Статичный сайт-портфолио. Без сборки, без фреймворков, без зависимостей.
Открывается прямым открытием `site/index.html` в браузере.

## Структура

    site/index.html              весь сайт: разметка, CSS и JS в одном файле
    site/data/portfolio.json     единственный источник контента, правится вручную
    site/assets/showreel.mp4     шоурил, играет локально (не с YouTube)
    site/assets/thumbs/          превью старых Sketchfab-only работ
    site/assets/gallery/<id>/    галереи рендеров по каждому проекту

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
`projects` (массив работ). Каждый проект:

    id            slug, используется в URL (#/project/<id>) и как ключ галереи
    title, year, role, software, tris, summary   текстовые поля
    topic, tags   категории для фильтра (ALL / HARD-SURFACE / ENVIRONMENT / VFX / SIM / GAME-READY)
    kindKey       бейдж и фильтр по типу медиа (IMAGE / VIDEO / YOUTUBE / SKETCHFAB)
    slot          подпись-заглушка, пока нет превью (обычно title.toUpperCase())
    artstationUrl, sketchfabUrl   ссылки на площадки (не обязательны)
    media[]       блоки на странице проекта, каждый — один из:
                    { t:"image", src, label, ratio }
                    { t:"sketchfab", modelId, label, ratio }
                    { t:"youtube", videoId, label }

Пустая строка/`"—"` в текстовом поле — значит, данных пока нет, это нормально.

## Правила работы с проектом

- Никаких зависимостей, сборщиков и фреймворков. Vanilla JS, один HTML-файл.
- Стили — внутри `site/index.html`, отдельных CSS-файлов нет.
- Контент правится только через `site/data/portfolio.json`, никогда
  хардкодом в разметке.
- Новые работы: положить сжатые рендеры в `site/assets/gallery/<id>/`
  (см. пример импорта — сжатие через ffmpeg, макс. сторона 1600px) и вручную
  дописать объект проекта в `portfolio.json`.
- Шоурил играет локально из `site/assets/showreel.mp4`: автоплей, muted, loop,
  поверх затемнение и ссылка на YouTube. Возврат к YouTube-эмбеду нежелателен —
  он требует прохождения проверки «вы не бот».

## Палитра и типографика

    фон        #0a0a0a
    акцент     #B22B2B
    текст      #e6e2de
    приглушён  #6f6b68

Моноширинный шрифт для меты и подписей, крупная жирная италика для заголовков.
