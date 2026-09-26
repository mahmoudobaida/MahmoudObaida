/*
 * Admin dashboard: manage videos and categories in data/works.json and upload media,
 * all through GitHub commits (see github.js). Nothing here runs on a server.
 */
import { GitHub, GitHubError } from './github.js';

const DATA_PATH = 'data/works.json';
const MAX_VIDEO_BYTES = 90 * 1024 * 1024;   // GitHub rejects files over 100 MB; stay well under
const REPO_SOFT_LIMIT_MB = 1000;            // size GitHub recommends for a Pages site
const TOKEN_KEY = 'obaida-admin-token';

class UserError extends Error {}

/* ---------- small helpers ---------- */
const $ = (selector) => document.querySelector(selector);
const mb = (bytes) => Math.round(bytes / 1048576);
const fmtDuration = (s) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'value') node.value = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  node.append(...kids.flat().filter((k) => k != null && k !== false));
  return node;
}
/** Numbers like 1080×1920 must not be reordered inside right-to-left text. */
const ltr = (text) => h('span', { class: 'ltr', text });

function toast(message, kind = 'ok', ms = 7000) {
  const node = h('div', { class: `toast ${kind}`, text: message });
  $('#toasts').append(node);
  setTimeout(() => node.remove(), ms);
}

async function busy(text, task) {
  const box = $('#busy');
  const bar = $('#busy-bar');
  $('#busy-text').textContent = text;
  bar.style.width = '0';
  box.hidden = false;
  try {
    return await task((fraction, label) => {
      bar.style.width = `${Math.round(fraction * 100)}%`;
      if (label) $('#busy-text').textContent = label;
    });
  } finally {
    box.hidden = true;
  }
}

/** Opens a modal. buildBody(close) returns the content; close(value) resolves the promise. */
function showDialog(title, buildBody) {
  return new Promise((resolve) => {
    const dialog = h('dialog', { class: 'modal' });
    const close = (value) => { dialog.close(); dialog.remove(); resolve(value ?? null); };
    dialog.append(
      h('div', { class: 'modal-head' }, h('h2', { text: title }), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: () => close(null) }, '✕')),
      buildBody(close),
    );
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function confirmAction({ title, message, okLabel, danger = false }) {
  return showDialog(title, (close) => h('div', {},
    h('p', { text: message }),
    h('div', { class: 'modal-actions' },
      h('button', { class: `btn ${danger ? 'btn-danger solid' : 'btn-primary'}`, type: 'button', onclick: () => close(true) }, okLabel),
      h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'إلغاء'),
    )));
}

/* ---------- state ---------- */
const params = new URLSearchParams(location.search);
// The API address can only be overridden on localhost (used for testing), never on the live site.
const apiBase = location.hostname === 'localhost' && params.get('api') ? params.get('api') : 'https://api.github.com';

function defaultRepo() {
  const owner = location.hostname.endsWith('.github.io') ? location.hostname.split('.')[0] : 'mahmoudobaida';
  const first = location.pathname.split('/')[1];
  const repo = location.hostname.endsWith('.github.io') && first && first !== 'admin' ? first : 'MahmoudObaida';
  return { owner, repo, branch: 'main' };
}

const state = { gh: null, data: null, sizes: {}, tab: 'videos', localPosters: {} };

/*
 * The token is kept in sessionStorage (gone when the browser closes) unless the user ticks
 * "remember me", which moves it to localStorage. The repository comes from the page address (see defaultRepo).
 */
const readToken = () => { try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY); } catch { return null; } };
const storeToken = (token, persistent) => {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    (persistent ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch { /* storage blocked: the session still works, just without remembering */ }
};
const forgetToken = () => { try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };

/* ---------- data changes (each one is a single GitHub commit) ---------- */
async function mutate({ message, busyText = 'جاري الحفظ…', apply, files = [] }) {
  try {
    await busy(busyText, async (progress) => {
      const fresh = await state.gh.readJson(DATA_PATH);          // always start from the latest version
      const next = apply(structuredClone(fresh));
      await state.gh.commit([{ path: DATA_PATH, text: `${JSON.stringify(next, null, 2)}\n` }, ...files], message, progress);
      state.data = next;
      files.forEach((f) => { if (f.remove) delete state.sizes[f.path]; else if (f.blob) state.sizes[f.path] = f.blob.size; });
    });
    render();
    toast('تم الحفظ. التغييرات بتظهر على الموقع خلال دقيقة أو اثنتين.');
    return true;
  } catch (err) {
    toast(err instanceof UserError || err instanceof GitHubError ? err.message : 'صار خطأ غير متوقع. جرّب مرة ثانية.', 'bad');
    if (!(err instanceof UserError) && !(err instanceof GitHubError)) console.error(err);
    return false;
  }
}

function slugify(name, taken) {
  let base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `c${Date.now().toString(36)}`;
  let slug = base;
  for (let i = 2; taken.includes(slug); i++) slug = `${base}-${i}`;
  return slug;
}

const nameTaken = (data, name, exceptId) => data.categories.some((c) => c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase());

const addCategory = (name) => mutate({
  message: `Add category: ${name}`,
  apply(data) {
    if (nameTaken(data, name)) throw new UserError('في تصنيف بنفس الاسم.');
    data.categories.push({ id: slugify(name, data.categories.map((c) => c.id)), name });
    return data;
  },
});

const renameCategory = (id, name) => mutate({
  message: `Rename category: ${name}`,
  apply(data) {
    if (nameTaken(data, name, id)) throw new UserError('في تصنيف بنفس الاسم.');
    data.categories.find((c) => c.id === id).name = name;
    return data;
  },
});

const deleteCategory = (id) => mutate({
  message: `Delete category: ${id}`,
  apply(data) {
    if (data.works.some((w) => w.category === id)) throw new UserError('التصنيف فيه فيديوهات. انقلها لتصنيف تاني أو احذفها أولًا.');
    data.categories = data.categories.filter((c) => c.id !== id);
    return data;
  },
});

function swap(list, a, b) { [list[a], list[b]] = [list[b], list[a]]; }

const moveCategory = (id, step) => mutate({
  message: 'Reorder categories',
  apply(data) {
    const i = data.categories.findIndex((c) => c.id === id);
    if (data.categories[i + step]) swap(data.categories, i, i + step);
    return data;
  },
});

const moveWork = (id, step) => mutate({
  message: 'Reorder videos',
  apply(data) {
    const work = data.works.find((w) => w.id === id);
    const peers = data.works.filter((w) => w.category === work.category);
    const target = peers[peers.indexOf(work) + step];
    if (target) swap(data.works, data.works.indexOf(work), data.works.indexOf(target));
    return data;
  },
});

const editWork = (id, { title, category }) => mutate({
  message: `Edit video: ${title}`,
  apply(data) {
    Object.assign(data.works.find((w) => w.id === id), { title, category });
    return data;
  },
});

const deleteWork = (work) => mutate({
  message: `Delete video: ${work.title}`,
  busyText: 'جاري الحذف…',
  apply(data) { data.works = data.works.filter((w) => w.id !== work.id); return data; },
  files: [{ path: work.video, remove: true }, { path: work.poster, remove: true }],
});

/* ---------- tools (the chips under Services on the site) ---------- */
const toolsOf = (data) => { if (!Array.isArray(data.tools)) data.tools = []; return data.tools; };
const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();
const findTool = (tools, name) => {
  const i = tools.indexOf(name);
  if (i === -1) throw new UserError('هذه الأداة تغيّرت أو انحذفت من مكان آخر. حدّث الصفحة.');
  return i;
};

const addTool = (name) => mutate({
  message: `Add tool: ${name}`,
  apply(data) {
    const tools = toolsOf(data);
    if (tools.some((t) => sameName(t, name))) throw new UserError('هذه الأداة موجودة مسبقًا.');
    tools.push(name);
    return data;
  },
});

const renameTool = (oldName, name) => mutate({
  message: `Rename tool: ${name}`,
  apply(data) {
    const tools = toolsOf(data);
    const i = findTool(tools, oldName);
    if (tools.some((t, j) => j !== i && sameName(t, name))) throw new UserError('هذه الأداة موجودة مسبقًا.');
    tools[i] = name;
    return data;
  },
});

const deleteTool = (name) => mutate({
  message: `Delete tool: ${name}`,
  apply(data) {
    const tools = toolsOf(data);
    tools.splice(findTool(tools, name), 1);
    return data;
  },
});

const moveTool = (name, step) => mutate({
  message: 'Reorder tools',
  apply(data) {
    const tools = toolsOf(data);
    const i = findTool(tools, name);
    if (tools[i + step] !== undefined) swap(tools, i, i + step);
    return data;
  },
});

/* ---------- upload ---------- */
async function sniffCodec(file) {
  const decode = async (blob) => new TextDecoder('latin1').decode(await blob.arrayBuffer());
  const chunk = 3 * 1024 * 1024;
  const text = (await decode(file.slice(0, chunk))) + (await decode(file.slice(Math.max(0, file.size - chunk))));
  if (/hvc1|hev1/.test(text)) return 'hevc';
  if (/avc1/.test(text)) return 'h264';
  return 'unknown';
}

async function inspectVideo(file) {
  if (!/\.mp4$/i.test(file.name) && file.type !== 'video/mp4') throw new UserError('الملف لازم يكون بصيغة MP4.');
  if (file.size > MAX_VIDEO_BYTES) throw new UserError(`حجم الفيديو ${mb(file.size)} ميجا، والحد الأقصى ${mb(MAX_VIDEO_BYTES)} ميجا. صدّره بجودة أقل أو قصّه ثم حاول من جديد.`);
  if (await sniffCodec(file) === 'hevc') throw new UserError('هذا الفيديو بصيغة H.265 (HEVC) وما بيشتغل على أغلب المتصفحات. صدّره من برنامج المونتاج بصيغة MP4 مع ترميز H.264.');
  const url = URL.createObjectURL(file);
  const video = h('video', { preload: 'metadata', muted: true });
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new UserError('ما قدرت أقرأ الفيديو. تأكد إنه MP4 بترميز H.264.'));
      setTimeout(() => reject(new UserError('انتهت مهلة قراءة الفيديو. جرّب ملف ثاني.')), 20000);
    });
    if (!video.videoWidth) throw new UserError('ما قدرت أقرأ صورة الفيديو. تأكد إنه MP4 بترميز H.264.');
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
  return { url, width: video.videoWidth, height: video.videoHeight, duration: Math.round(video.duration) };
}

function captureFrame(video) {
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  const canvas = h('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

function buildUpload(close) {
  const stage = h('div');
  const categories = state.data.categories;

  const pick = async (file) => {
    if (!file) return;
    let info;
    try {
      stage.replaceChildren(h('p', { class: 'muted', text: 'جاري فحص الفيديو…' }));
      info = await inspectVideo(file);
    } catch (err) {
      stage.replaceChildren(dropZone(), h('p', { class: 'notice bad', role: 'alert', text: err instanceof UserError ? err.message : 'تعذّر فتح الملف.' }));
      return;
    }
    showDetails(file, info);
  };

  const dropZone = () => {
    const input = h('input', { type: 'file', accept: 'video/mp4', onchange: (e) => pick(e.target.files[0]) });
    const zone = h('label', { class: 'drop' }, h('strong', { text: 'اضغط لاختيار الفيديو أو اسحبه وأفلته هون' }), h('small', { text: `MP4 بترميز H.264، حتى ${mb(MAX_VIDEO_BYTES)} ميجا` }), input);
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); pick(e.dataTransfer.files[0]); });
    return zone;
  };

  const showDetails = (file, info) => {
    let poster = null;
    let posterUrl = null;
    const video = h('video', { controls: true, muted: true, playsinline: true, src: info.url });
    const posterImg = h('img', { alt: 'الصورة المصغّرة', hidden: true });
    const title = h('input', { type: 'text', id: 'up-title', value: file.name.replace(/\.mp4$/i, '').replace(/[-_]+/g, ' '), maxlength: '120' });
    const category = h('select', { id: 'up-cat' }, categories.map((c) => h('option', { value: c.id, text: c.name })));
    const submit = h('button', { class: 'btn btn-primary', type: 'button', disabled: true }, 'رفع ونشر');

    const useFrame = async () => {
      poster = await captureFrame(video);
      if (posterUrl) URL.revokeObjectURL(posterUrl);
      posterUrl = URL.createObjectURL(poster);
      posterImg.src = posterUrl;
      posterImg.hidden = false;
      submit.disabled = false;
    };
    video.addEventListener('loadeddata', () => { video.currentTime = Math.min(2, info.duration * 0.15); }, { once: true });
    video.addEventListener('seeked', () => { if (!poster) useFrame(); }, { once: true });

    submit.addEventListener('click', () => {
      if (!title.value.trim()) { title.focus(); return; }
      if (posterUrl) URL.revokeObjectURL(posterUrl);
      close({ file, poster, info, title: title.value.trim(), category: category.value });
    });

    stage.replaceChildren(
      h('div', { class: 'preview' }, video, h('small', {}, ltr(`${info.width}×${info.height}`), ' · ', ltr(fmtDuration(info.duration)), ` · ${mb(file.size)} ميجا`)),
      h('div', { class: 'field' }, h('label', { for: 'up-title', text: 'اسم الفيديو' }), title),
      h('div', { class: 'field' }, h('label', { for: 'up-cat', text: 'التصنيف' }), category),
      h('div', { class: 'field' },
        h('label', { text: 'الصورة المصغّرة' }),
        h('div', { class: 'poster-row' }, posterImg,
          h('button', { class: 'btn btn-sm', type: 'button', onclick: useFrame }, 'استخدم المشهد الحالي'),
        ),
        h('small', { text: 'حرّك الفيديو للمشهد اللي بتريده ثم اضغط الزر.' }),
      ),
      h('div', { class: 'modal-actions' }, submit, h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'إلغاء')),
    );
  };

  stage.append(dropZone());
  return stage;
}

async function uploadVideo() {
  if (!state.data.categories.length) { toast('أضف تصنيفًا أولًا من تبويب «التصنيفات».', 'bad'); return; }
  const picked = await showDialog('رفع فيديو جديد', buildUpload);
  if (!picked) return;
  const id = `${picked.category}-${Date.now().toString(36)}`;
  const work = {
    id, title: picked.title, category: picked.category,
    video: `media/videos/${id}.mp4`, poster: `media/posters/${id}.jpg`,
    width: picked.info.width, height: picked.info.height, duration: picked.info.duration,
  };
  const ok = await mutate({
    message: `Add video: ${work.title}`,
    busyText: 'جاري رفع الفيديو…',
    apply(data) { data.works.push(work); return data; },
    files: [{ path: work.video, blob: picked.file }, { path: work.poster, blob: picked.poster }],
  });
  if (ok) { state.localPosters[id] = URL.createObjectURL(picked.poster); render(); }
}

/* ---------- edit dialogs ---------- */
function editVideoDialog(work) {
  return showDialog('تعديل الفيديو', (close) => {
    const title = h('input', { type: 'text', id: 'ed-title', value: work.title, maxlength: '120' });
    const known = state.data.categories.some((c) => c.id === work.category);
    const category = h('select', { id: 'ed-cat' },
      known ? null : h('option', { value: '', text: 'اختر تصنيفًا…' }),
      state.data.categories.map((c) => h('option', { value: c.id, text: c.name, selected: c.id === work.category })));
    const error = h('p', { class: 'error-text', role: 'alert' });
    return h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (!title.value.trim()) { error.textContent = 'اكتب اسم للفيديو.'; return; }
        if (!category.value) { error.textContent = 'اختر تصنيفًا.'; return; }
        close({ title: title.value.trim(), category: category.value });
      },
    },
      h('div', { class: 'field' }, h('label', { for: 'ed-title', text: 'اسم الفيديو' }), title),
      h('div', { class: 'field' }, h('label', { for: 'ed-cat', text: 'التصنيف' }), category),
      error,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'حفظ'), h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'إلغاء')),
    );
  });
}

/** A small "type a name" dialog, used for renaming categories and tools. */
function nameDialog(titleText, initial = '', label = 'اسم التصنيف') {
  return showDialog(titleText, (close) => {
    const input = h('input', { type: 'text', id: 'cat-name', value: initial, maxlength: '40' });
    const error = h('p', { class: 'error-text', role: 'alert' });
    setTimeout(() => input.focus(), 0);
    return h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        if (!input.value.trim()) { error.textContent = `اكتب ${label}.`; return; }
        close(input.value.trim());
      },
    },
      h('div', { class: 'field' }, h('label', { for: 'cat-name', text: label }), input),
      error,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn btn-primary', type: 'submit' }, 'حفظ'), h('button', { class: 'btn', type: 'button', onclick: () => close(null) }, 'إلغاء')),
    );
  });
}

/* ---------- views ---------- */
function thumb(work) {
  const box = h('div', { class: `thumb${work.height > work.width ? ' vertical' : ''}` });
  const img = h('img', { alt: '', src: state.localPosters[work.id] || `../${work.poster}` });
  img.addEventListener('error', () => box.replaceChildren('بدون صورة'), { once: true });
  box.append(img);
  return box;
}

function workRow(work, index, peers) {
  return h('li', { class: 'row' },
    thumb(work),
    h('div', {},
      h('div', { class: 'row-title', text: work.title }),
      h('small', {}, ltr(`${work.width}×${work.height}`), ' · ', ltr(fmtDuration(work.duration)), ` · ${work.height > work.width ? 'عمودي' : 'عرضي'}`),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'تحريك للأعلى', title: 'تحريك للأعلى', disabled: index === 0, onclick: () => moveWork(work.id, -1) }, '▲'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'تحريك للأسفل', title: 'تحريك للأسفل', disabled: index === peers.length - 1, onclick: () => moveWork(work.id, 1) }, '▼'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
        const result = await editVideoDialog(work);
        if (result) editWork(work.id, result);
      } }, 'تعديل'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
        const yes = await confirmAction({
          title: 'حذف الفيديو', danger: true, okLabel: 'احذف الفيديو نهائيًا',
          message: `رح ينحذف «${work.title}» من الموقع ومن الملفات. ما في تراجع.`,
        });
        if (yes) deleteWork(work);
      } }, 'حذف'),
    ),
  );
}

function videosPanel() {
  const { categories, works } = state.data;
  const total = Object.values(state.sizes).reduce((a, b) => a + b, 0);
  const groups = categories
    .map((c) => ({ name: c.name, list: works.filter((w) => w.category === c.id), hidden: false }))
    .concat([{ name: 'بدون تصنيف', list: works.filter((w) => !categories.some((c) => c.id === w.category)), hidden: true }])
    .filter((g) => g.list.length);

  const panel = h('div', {},
    h('div', { class: 'toolbar' },
      h('button', { class: 'btn btn-primary', type: 'button', onclick: uploadVideo }, '＋ رفع فيديو جديد'),
      h('span', { class: `storage${mb(total) > REPO_SOFT_LIMIT_MB * 0.8 ? ' warn' : ''}`, text: `حجم ملفات الموقع: ${mb(total)} ميجا من ${REPO_SOFT_LIMIT_MB} ميجا (الحد الموصى به)` }),
    ),
  );
  if (!groups.length) {
    panel.append(h('div', { class: 'empty' },
      h('h2', { text: 'ما في فيديوهات لسه' }),
      h('p', { text: 'الموقع فاضي حاليًا، وكل فيديو بترفعه بيظهر لزوّار الموقع.' }),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: uploadVideo }, 'ارفع أول فيديو'),
    ));
    return panel;
  }
  groups.forEach((g) => panel.append(h('section', { class: 'group' },
    h('div', { class: 'group-head' }, h('h2', { text: g.name }), h('small', { text: `${g.list.length} فيديو` })),
    g.hidden ? h('p', { class: 'notice bad', text: 'هذه الفيديوهات مخفية عن الموقع لأن تصنيفها انحذف. اضغط «تعديل» واختر تصنيفًا.' }) : null,
    h('ul', { class: 'rows' }, g.list.map((w, i) => workRow(w, i, g.list))),
  )));
  return panel;
}

function categoriesPanel() {
  const { categories, works } = state.data;
  const input = h('input', { type: 'text', 'aria-label': 'اسم التصنيف الجديد', placeholder: 'اسم تصنيف جديد، مثلًا: إعلانات', maxlength: '40' });
  const add = () => { const name = input.value.trim(); if (name) addCategory(name); else input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  const panel = h('div', {}, h('div', { class: 'add-cat' }, input, h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, 'إضافة')));
  if (!categories.length) {
    panel.append(h('div', { class: 'empty' }, h('h2', { text: 'ما في تصنيفات' }), h('p', { text: 'أضف تصنيفًا (مثل «مونتاج») عشان تقدر ترفع فيديوهات وتظهر على الموقع.' })));
    return panel;
  }
  panel.append(h('ul', { class: 'rows' }, categories.map((c, i) => {
    const count = works.filter((w) => w.category === c.id).length;
    return h('li', { class: 'row cat' },
      h('div', {}, h('div', { class: 'row-title', text: c.name }), h('small', { text: `${count} فيديو` })),
      h('div', { class: 'actions' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'تحريك للأعلى', title: 'تحريك للأعلى', disabled: i === 0, onclick: () => moveCategory(c.id, -1) }, '▲'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'تحريك للأسفل', title: 'تحريك للأسفل', disabled: i === categories.length - 1, onclick: () => moveCategory(c.id, 1) }, '▼'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
          const name = await nameDialog('إعادة تسمية التصنيف', c.name);
          if (name && name !== c.name) renameCategory(c.id, name);
        } }, 'تعديل'),
        h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
          if (count) { toast(`لا يمكن حذف «${c.name}» لأن فيه ${count} فيديو. انقل الفيديوهات لتصنيف تاني أو احذفها أولًا.`, 'bad'); return; }
          const yes = await confirmAction({ title: 'حذف التصنيف', danger: true, okLabel: 'احذف التصنيف', message: `رح ينحذف التصنيف «${c.name}».` });
          if (yes) deleteCategory(c.id);
        } }, 'حذف'),
      ),
    );
  })));
  panel.append(h('p', { class: 'small', text: 'ترتيب التصنيفات هون هو نفس ترتيبها على الموقع.' }));
  return panel;
}

function toolsPanel() {
  const tools = Array.isArray(state.data.tools) ? state.data.tools : [];
  const input = h('input', { type: 'text', 'aria-label': 'اسم الأداة الجديدة', placeholder: 'اسم أداة جديدة، مثلًا: DaVinci Resolve', maxlength: '40' });
  const add = () => { const name = input.value.trim(); if (name) addTool(name); else input.focus(); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });

  const panel = h('div', {}, h('div', { class: 'add-cat' }, input, h('button', { class: 'btn btn-primary', type: 'button', onclick: add }, 'إضافة')));
  if (!tools.length) {
    panel.append(h('div', { class: 'empty' },
      h('h2', { text: 'ما في أدوات' }),
      h('p', { text: 'الأدوات بتظهر تحت قسم الخدمات على الموقع. أضف أول أداة (مثل «Premiere Pro»). وإذا القائمة فاضية، بينخفي عنوان الأدوات من الموقع.' }),
    ));
    return panel;
  }
  panel.append(h('ul', { class: 'rows' }, tools.map((name, i) => h('li', { class: 'row cat' },
    h('div', { class: 'row-title', text: name }),
    h('div', { class: 'actions' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'تحريك للأعلى', title: 'تحريك للأعلى', disabled: i === 0, onclick: () => moveTool(name, -1) }, '▲'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'تحريك للأسفل', title: 'تحريك للأسفل', disabled: i === tools.length - 1, onclick: () => moveTool(name, 1) }, '▼'),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => {
        const next = await nameDialog('تعديل اسم الأداة', name, 'اسم الأداة');
        if (next && next !== name) renameTool(name, next);
      } }, 'تعديل'),
      h('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: async () => {
        const yes = await confirmAction({ title: 'حذف الأداة', danger: true, okLabel: 'احذف الأداة', message: `رح تنحذف «${name}» من قائمة الأدوات على الموقع.` });
        if (yes) deleteTool(name);
      } }, 'حذف'),
    ),
  ))));
  panel.append(h('p', { class: 'small', text: 'ترتيب الأدوات هون هو نفس ترتيبها على الموقع.' }));
  return panel;
}

function renderLogin(message = '') {
  const token = h('input', { type: 'password', id: 'token', autocomplete: 'off', placeholder: 'github_pat_…' });
  const remember = h('input', { type: 'checkbox', id: 'remember' });
  const error = h('p', { class: 'error-text', role: 'alert', text: message });

  const form = h('form', {
    class: 'login',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!token.value.trim()) { error.textContent = 'الصق التوكن أولًا.'; token.focus(); return; }
      error.textContent = '';
      const config = { ...defaultRepo(), token: token.value.trim() };
      try {
        await connect(config);
        storeToken(config.token, remember.checked);
      } catch (err) {
        error.textContent = err.message;
      }
    },
  },
    h('div', { class: 'login-head' },
      h('h1', { text: 'لوحة تحكم الموقع' }),
      h('p', { class: 'muted', text: 'أدخل التوكن لإدارة الفيديوهات والتصنيفات.' }),
    ),
    h('div', { class: 'field' }, h('label', { for: 'token', text: 'التوكن' }), token, error),
    h('label', { class: 'check', for: 'remember' }, remember,
      h('span', {}, h('b', { text: 'تذكّرني على هذا الجهاز' }), h('small', { text: 'بدونها بيطلب منك التوكن كل مرة تفتح المتصفح. لا تفعّلها على جهاز مشترك.' }))),
    h('button', { class: 'btn btn-primary block', type: 'submit' }, 'دخول'),
  );
  $('#app').replaceChildren(h('main', { class: 'gate' }, h('div', { class: 'float' }, form)));
  token.focus();
}

function render() {
  if (!state.data) return;
  const tab = (id, label) => h('button', { class: 'tab', type: 'button', role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => { state.tab = id; render(); } }, label);
  $('#app').replaceChildren(h('div', { class: 'wrap' },
    h('header', { class: 'top' },
      h('h1', { text: 'لوحة تحكم الموقع' }),
      h('div', { class: 'links' },
        h('a', { class: 'btn btn-sm', href: '../', target: '_blank', rel: 'noopener' }, 'فتح الموقع ↗'),
        h('button', { class: 'btn btn-sm', type: 'button', onclick: () => { forgetToken(); state.gh = null; state.data = null; renderLogin(); } }, 'تسجيل الخروج'),
      ),
    ),
    h('div', { class: 'tabs', role: 'tablist' }, tab('videos', 'الفيديوهات'), tab('categories', 'التصنيفات'), tab('tools', 'الأدوات')),
    { videos: videosPanel, categories: categoriesPanel, tools: toolsPanel }[state.tab](),
  ));
}

/* ---------- start ---------- */
async function connect(config) {
  const gh = new GitHub({ ...config, apiBase });
  await busy('جاري التحقق…', async () => {
    await gh.verify();
    const data = await gh.readJson(DATA_PATH);
    if (!Array.isArray(data.categories) || !Array.isArray(data.works)) throw new GitHubError('ملف بيانات الموقع غير صالح.');
    state.data = data;
    state.sizes = await gh.fileSizes();
  });
  state.gh = gh;
  render();
}

// Earlier versions kept the token under this key in localStorage; remove any leftover copy.
try { localStorage.removeItem('obaida-admin'); } catch { /* ignore */ }

const storedToken = readToken();
if (storedToken) {
  connect({ ...defaultRepo(), token: storedToken })
    .catch((err) => { forgetToken(); renderLogin(err.message); });
} else {
  renderLogin();
}
