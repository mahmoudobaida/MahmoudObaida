// Re-encode source videos to web-friendly H.264 (visually lossless-ish) + posters.
// Usage: node tools/encode.mjs [path-to-original-CV-folder]   (default: ../CV next to this repo)
// Safe to re-run; skips finished files. Originals are never modified.
import { execFileSync } from 'node:child_process';
import { readdirSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const src = resolve(process.argv[2] || join(root, '..', 'CV'));
const out = join(root, 'media');
mkdirSync(join(out, 'videos'), { recursive: true });
mkdirSync(join(out, 'posters'), { recursive: true });

const CATS = { 'Video Editing CV': 'editing', 'Reels Editing CV': 'reels', 'Motion CV': 'motion', 'Ai CV': 'ai' };
const CRF = '20';
const SKIP = ['editing-02', 'editing-03']; // ids keep their numbers so the site data stays stable

const probe = (f) => JSON.parse(execFileSync('ffprobe', [
  '-v', 'error', '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height:format=duration', '-of', 'json', f,
]).toString());

const manifest = [];
let n = 0;
for (const [dir, cat] of Object.entries(CATS)) {
  const files = readdirSync(join(src, dir)).filter((f) => f.endsWith('.mp4')).sort();
  for (const f of files) {
    n++;
    const id = `${cat}-${String(n).padStart(2, '0')}`;
    if (SKIP.includes(id)) continue; // removed from the site
    const input = join(src, dir, f);
    const video = join(out, 'videos', `${id}.mp4`);
    const poster = join(out, 'posters', `${id}.jpg`);
    const p = probe(input);
    const { width, height } = p.streams[0];
    const duration = Math.round(parseFloat(p.format.duration));

    if (!existsSync(video) || statSync(video).size < 1000) {
      console.log(`[encode] ${id}  ${f}`);
      execFileSync('ffmpeg', [
        '-y', '-v', 'error', '-i', input,
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-c:v', 'libx264', '-preset', 'fast', '-crf', CRF, '-profile:v', 'high',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '160k', video,
      ], { stdio: 'inherit' });
    }
    if (!existsSync(poster)) {
      const t = Math.min(2, duration * 0.15).toFixed(2);
      execFileSync('ffmpeg', [
        '-y', '-v', 'error', '-ss', t, '-i', input, '-frames:v', '1',
        '-vf', "scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'", '-q:v', '3', poster,
      ]);
    }
    manifest.push({ id, cat, original: f, width, height, duration, mb: +(statSync(video).size / 1048576).toFixed(1) });
  }
}
writeFileSync(join(root, 'tools', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('DONE', manifest.length, 'videos', manifest.reduce((s, m) => s + m.mb, 0).toFixed(0), 'MB total');
