# Mahmoud Obaida — Portfolio

A static portfolio website for a photographer and video editor. Plain HTML, CSS and JavaScript. No framework and no build step.

## Structure

```
index.html        page markup
css/styles.css    all styling (design tokens are in :root)
js/works.js       project data: titles, categories, durations
js/main.js        grid, category filter, video lightbox
media/
  videos/         web-ready H.264 videos
  posters/        video thumbnails
  photos/         hero and about photos
tools/
  encode.mjs      compresses original footage into media/ (needs ffmpeg)
  serve.mjs       local static server with video seeking support
```

## Run locally

Requires Node 20+.

```bash
node tools/serve.mjs
```

Then open http://localhost:5173.

## Edit content

- **Add, remove or rename a project:** edit `js/works.js`.
- **Contact links:** edit the Contact section in `index.html`.
- **Colors and spacing:** edit the variables at the top of `css/styles.css`.

## Prepare videos

Original footage is not part of this repo. To rebuild `media/videos` and `media/posters` from a folder of originals (organized in the same category sub-folders):

```bash
node tools/encode.mjs /path/to/CV
```

GitHub rejects files over 100 MB, so keep each video under that.

## Deploy

Served as-is by GitHub Pages: **Settings → Pages → Deploy from a branch → main / (root)**.
