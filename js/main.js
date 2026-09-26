/*
 * Renders the projects section from data/works.json (categories in order, each with its videos),
 * runs the video lightbox and highlights the current section in the nav.
 * To add, remove or rename projects and categories, edit data/works.json.
 */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const container = $('#works');
  const lightbox = $('#lightbox');
  const video = $('#vid');
  const caption = $('#cap');

  const isVertical = (work) => work.height > work.width;
  const formatDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  /* Small DOM helper. Text is always set via textContent, so titles can never inject markup. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'text') node.textContent = value;
      else if (key === 'class') node.className = value;
      else node.setAttribute(key, value);
    }
    node.append(...children);
    return node;
  }
  const svg = (markup) => { const t = document.createElement('template'); t.innerHTML = markup; return t.content.firstChild; };
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const PLAY = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';

  function createCard(work) {
    const thumb = el('div', { class: 'thumb', style: `aspect-ratio:${work.width}/${work.height}` }, [
      el('img', { src: work.poster, alt: work.title, loading: 'lazy' }),
      el('div', { class: 'play' }, [el('i', {}, [svg(PLAY)])]),
      el('span', { class: 'dur', text: formatDuration(work.duration) }),
    ]);
    const meta = el('div', { class: 'meta' }, [el('h4', { text: work.title }), svg(ARROW)]);
    const card = el('button', { class: 'card', type: 'button', 'aria-label': `Play ${work.title}` }, [thumb, meta]);
    card.addEventListener('click', () => openPlayer(work));
    return card;
  }

  function createCategory(category, works) {
    const grid = el('div', { class: 'grid' + (works.every(isVertical) ? ' grid--vertical' : '') }, works.map(createCard));
    return el('div', { class: 'cat', id: `cat-${category.id}` }, [
      el('div', { class: 'cat-head' }, [el('h3', { text: category.name })]),
      grid,
    ]);
  }

  function render({ categories, works }) {
    const blocks = categories
      .map((category) => [category, works.filter((w) => w.category === category.id)])
      .filter(([, list]) => list.length > 0)
      .map(([category, list]) => createCategory(category, list));
    container.replaceChildren(...(blocks.length ? blocks : [el('p', { class: 'state', text: 'Projects are coming soon.' })]));
    reveal(container.querySelectorAll('.cat-head'));
    reveal(container.querySelectorAll('.card'), { mod: 4 });
  }

  async function load() {
    try {
      const res = await fetch('data/works.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(res.status);
      render(await res.json());
    } catch {
      const hint = location.protocol === 'file:' ? ' Open the site through a local server (see README).' : ' Please refresh the page.';
      container.replaceChildren(el('p', { class: 'state', text: `Projects could not be loaded.${hint}` }));
    }
  }

  function openPlayer(work) {
    lightbox.classList.toggle('vertical', isVertical(work));
    video.poster = work.poster;
    video.src = work.video;
    caption.textContent = work.title;
    lightbox.showModal();
    video.play().catch(() => {});
  }

  function closePlayer() {
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (lightbox.open) lightbox.close();
  }

  $('#close').addEventListener('click', closePlayer);
  $('#player').addEventListener('click', (e) => { if (e.target === e.currentTarget) closePlayer(); });
  lightbox.addEventListener('close', () => video.pause()); // also fires on Esc

  /* Highlight the nav link of the section currently in view. */
  const links = [...document.querySelectorAll('#nav-links a')];
  const sections = links.map((a) => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.filter((e) => e.isIntersecting).forEach((e) => {
        links.forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach((s) => observer.observe(s));
  }

  /*
   * Scroll motion. Elements get a .reveal class here and rise into view once, staggered by their
   * position inside the parent. Skipped for visitors who prefer reduced motion.
   */
  const io = 'IntersectionObserver' in window && !calm
    ? new IntersectionObserver((entries) => {
      entries.filter((e) => e.isIntersecting).forEach((e) => { e.target.classList.add('in'); io.unobserve(e.target); });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' })
    : null;

  function reveal(nodes, { dir, mod = 7 } = {}) {
    if (!io) return;
    const seen = new Map();
    nodes.forEach((node) => {
      if (node.classList.contains('reveal')) return;
      const index = seen.get(node.parentElement) ?? 0;
      seen.set(node.parentElement, index + 1);
      node.classList.add('reveal');
      if (dir) node.classList.add(`reveal--${dir}`);
      node.style.setProperty('--d', `${(index % mod) * 90}ms`);
      io.observe(node);
    });
  }

  const all = (selector) => document.querySelectorAll(selector);
  reveal(all('.hero .wrap > div:first-child > *'));
  reveal(all('.hero-photo'), { dir: 'right' });
  reveal(all('.timeline'));
  reveal(all('.portrait'), { dir: 'left' });
  reveal(all('.about > div:last-child > *'));
  reveal(all('#services .kicker, #services h2'));
  reveal(all('.service'), { mod: 4 });
  reveal(all('.tools-label, .tools li'));
  reveal(all('#projects .kicker, #projects h2'));
  reveal(all('.contact-box > *'));

  /* Scroll progress bar, and a gentle parallax on the hero photo. */
  const hero = document.querySelector('.hero-photo');
  if (hero && !calm) hero.classList.add('parallax');
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      document.documentElement.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
      if (hero && !calm) hero.style.setProperty('--py', `${Math.min(scrollY, 700) * 0.06}px`);
      ticking = false;
    });
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  $('#year').textContent = new Date().getFullYear();
  load();
})();
