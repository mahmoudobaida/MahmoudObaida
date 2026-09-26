# Mahmoud Obaida — Portfolio

A static portfolio website for a photographer and video editor. Plain HTML, CSS and JavaScript. No framework and no build step.

## Structure

```
index.html          page markup (Hero, About, Services, Projects, Contact)
css/styles.css      all styling (design tokens are in :root)
js/main.js          renders the projects section, video lightbox, nav highlight
data/works.json     categories, tools and projects (the only content file you edit by hand)
admin/              dashboard for managing videos and categories (see below)
media/
  videos/           web-ready H.264 videos
  posters/          video thumbnails
  photos/           hero and about photos
tools/
  encode.mjs        compresses original footage into media/ (needs ffmpeg)
  serve.mjs         local static server with video seeking support
```

## Run locally

Requires Node 20+. The site loads `data/works.json` with `fetch`, so it must be served over HTTP (opening `index.html` directly will not show the projects).

```bash
node tools/serve.mjs
```

Then open http://localhost:5173.

## Admin dashboard

Open `/admin/` on the live site (for example `https://<user>.github.io/<repo>/admin/`). It is a static page that edits `data/works.json` and uploads media by committing to this repository through the GitHub API, so there is no server.

- **Sign in** with a GitHub fine-grained personal access token limited to this repository with **Contents: Read and write**. The token is stored only in that browser.
- **Videos:** upload (MP4, H.264, up to 90 MB; the thumbnail is chosen from a frame of the video), edit title and category, reorder, delete.
- **Categories:** add, rename, reorder, delete (a category with videos cannot be deleted).
- **Tools:** the chips under Services on the site. Add, rename, reorder, delete.
- Every action is one commit. GitHub Pages republishes the site 1–2 minutes later.
- Deleting a video removes its files from the site, but they remain in the Git history.

## Edit content

- **Projects and categories:** use the admin dashboard, or edit `data/works.json` by hand. Categories appear in the order listed, and each shows the projects that reference its `id`. A project needs `id`, `title`, `category`, `video`, `poster`, `width`, `height` and `duration` (seconds). Vertical videos (height greater than width) open full screen; horizontal ones keep their own aspect ratio.
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
