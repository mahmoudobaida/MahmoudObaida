/*
 * Portfolio content. To add, remove or reorder a project, edit this file only.
 *
 *   id     file name (no extension) in media/videos/ and media/posters/.
 *          The part before the dash is the category key from CATS.
 *   title  text shown on the card and under the player
 *   w, h   video size in pixels (h > w means vertical; the card adapts)
 *   d      duration in seconds
 */
const CATS = {
  editing: 'Video Editing',
  reels: 'Reels',
  motion: 'Motion Graphics',
  ai: 'AI Video',
};

const WORKS = [
  { id: 'editing-01', title: 'Qadasaha Al-Qadar Anthem — Anas Ayyad', w: 1276, h: 720,  d: 156 },
  { id: 'editing-04', title: 'Autism Children Film — Al-Shawa',       w: 1920, h: 1080, d: 100 },
  { id: 'editing-05', title: 'Autism Children Film — Al-Louh',        w: 1920, h: 1080, d: 98 },
  { id: 'editing-06', title: 'Al-Wafaa Village',                      w: 1920, h: 1080, d: 138 },
  { id: 'reels-07',   title: 'Orphans Appeal 2',                      w: 1080, h: 1920, d: 28 },
  { id: 'reels-08',   title: 'Orphans Project 2',                     w: 1080, h: 1920, d: 30 },
  { id: 'motion-09',  title: 'Jordanian Campaign',                    w: 1080, h: 1920, d: 136 },
  { id: 'motion-10',  title: 'Al-Diyar — Final Cut',                  w: 1080, h: 1920, d: 30 },
  { id: 'motion-11',  title: 'Scholar — Subtitled',                   w: 1080, h: 1920, d: 40 },
  { id: 'ai-12',      title: 'AI Advertisement',                      w: 1920, h: 1080, d: 23 },
  { id: 'ai-13',      title: 'Ramadan Clip',                          w: 1920, h: 1080, d: 45 },
];
