/* Work grid, category filter and video lightbox. Content lives in works.js. */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const grid = $('#grid');
  const filters = $('#filters');
  const lightbox = $('#lightbox');
  const video = $('#vid');
  const caption = $('#cap');

  const PLAY_ICON = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  const categoryOf = (work) => work.id.split('-')[0];
  const formatDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  function createCard(work) {
    const poster = `media/posters/${work.id}.jpg`;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card' + (work.h > work.w ? ' vertical' : '');
    card.setAttribute('aria-label', `Play ${work.title}`);
    card.innerHTML = `
      <div class="thumb">
        <img class="bg" src="${poster}" alt="" aria-hidden="true" loading="lazy">
        <img class="fg" src="${poster}" alt="${work.title}" loading="lazy">
        <div class="play"><i>${PLAY_ICON}</i></div>
        <span class="dur">${formatDuration(work.d)}</span>
      </div>
      <div class="meta">
        <small>${CATS[categoryOf(work)]}</small>
        <h3>${work.title}</h3>
      </div>`;
    card.addEventListener('click', () => openPlayer(work));
    return card;
  }

  function renderGrid(category) {
    grid.replaceChildren(
      ...WORKS.filter((w) => category === 'all' || categoryOf(w) === category).map(createCard)
    );
  }

  function renderFilters() {
    const keys = ['all', ...Object.keys(CATS).filter((c) => WORKS.some((w) => categoryOf(w) === c))];
    keys.forEach((key, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = key === 'all' ? 'All' : CATS[key];
      chip.setAttribute('aria-pressed', i === 0);
      chip.addEventListener('click', () => {
        filters.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', c === chip));
        renderGrid(key);
      });
      filters.appendChild(chip);
    });
  }

  function openPlayer(work) {
    video.poster = `media/posters/${work.id}.jpg`;
    video.src = `media/videos/${work.id}.mp4`;
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
  lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closePlayer(); });
  lightbox.addEventListener('close', () => video.pause()); // also fires on Esc

  renderFilters();
  renderGrid('all');
  $('#year').textContent = new Date().getFullYear();
})();
