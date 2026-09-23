repo: Jey-Key30/render-vision-website
branch: main

## Last sync
date: 2026-09-23T12:00:00Z

### Updated in this project
- Публикация на GitHub Pages: .github/workflows/deploy.yml + tools/seo.mjs (SEO-страницы, sitemap, 404)
- Чистые адреса /en/, /ru/, /<lang>/work/<id>/, политика конфиденциальности и согласие в форме
- Русские описания проектов (summary_ru), копии рендеров 480px (gallery/<id>/sm), постер шоурила
- Удалены старые прототипы (*.dc.html, support.js) и корневые assets/, data/

## Screen map
| Экран | Источник данных |
| --- | --- |
| Work (сетка работ) | site/data/portfolio.json → projects[] |
| Страница проекта | projects[].media (image + sm из assets/gallery, sketchfab, youtube) |
| Showreel | reel.src → site/assets/showreel.mp4, reel.poster |
| About / опыт | about.experience[] + I18N в site/index.html |
| Политика | I18N → pp.* в site/index.html |

## Sync history
- 2026-09-22T13:44:30Z — галерея рендеров, ручное ведение portfolio.json
- 2026-09-22T11:41:55Z — прогон GitHub Actions, данные Sketchfab, ArtStation 403
- 2026-08-30T22:05:39Z — репозиторий привязан, данные заполнялись вручную
