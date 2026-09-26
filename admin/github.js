/*
 * Minimal GitHub client for the admin page. Everything that changes the site goes through
 * commit(): one atomic commit (blobs -> tree -> commit -> ref), so GitHub Pages rebuilds once.
 */
export class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const explain = (status, apiMessage) => {
  if (status === 401) return 'التوكن غير صحيح أو انتهت صلاحيته. أنشئ توكن جديد وسجّل الدخول من جديد.';
  if (status === 403) return 'ما عندك صلاحية على هذا المستودع، أو تجاوزت الحد المسموح مؤقتًا. تأكد إن التوكن عنده صلاحية Contents: Read and write.';
  if (status === 404) return 'المستودع غير موجود أو التوكن ما بيغطيه. تأكد من اسم الحساب واسم المستودع.';
  if (status === 409 || status === 422) return 'تم تعديل الموقع من مكان آخر بنفس اللحظة. حدّث الصفحة وجرّب مرة ثانية.';
  return `صار خطأ من GitHub (${status}). ${apiMessage || ''}`.trim();
};

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result).split(',')[1]);
  reader.onerror = () => reject(new GitHubError('تعذّرت قراءة الملف.'));
  reader.readAsDataURL(blob);
});

export class GitHub {
  constructor({ token, owner, repo, branch = 'main', apiBase = 'https://api.github.com' }) {
    Object.assign(this, { token, owner, repo, branch, apiBase });
  }

  url(path) {
    return `${this.apiBase}/repos/${this.owner}/${this.repo}${path}`;
  }

  headers(extra = {}) {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...extra,
    };
  }

  async request(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new GitHubError('ما في اتصال بالإنترنت، أو GitHub غير متاح حاليًا.');
    }
    if (!res.ok) {
      let message = '';
      try { message = (await res.json()).message; } catch { /* no body */ }
      throw new GitHubError(explain(res.status, message), res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  /** Checks the token can reach the repo. Returns the repo info. */
  verify() {
    return this.request('');
  }

  async readJson(path) {
    const file = await this.request(`/contents/${path}?ref=${encodeURIComponent(this.branch)}`);
    const bytes = Uint8Array.from(atob(file.content.replace(/\n/g, '')), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /** Every file in the branch with its size, as { path: bytes }. */
  async fileSizes() {
    const head = await this.request(`/git/ref/heads/${this.branch}`);
    const commit = await this.request(`/git/commits/${head.object.sha}`);
    const tree = await this.request(`/git/trees/${commit.tree.sha}?recursive=1`);
    return Object.fromEntries(tree.tree.filter((e) => e.type === 'blob').map((e) => [e.path, e.size]));
  }

  uploadBlob(base64, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.url('/git/blobs'));
      Object.entries(this.headers({ 'Content-Type': 'application/json' })).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onerror = () => reject(new GitHubError('انقطع الاتصال أثناء الرفع. جرّب مرة ثانية.'));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) return resolve(JSON.parse(xhr.responseText).sha);
        let message = '';
        try { message = JSON.parse(xhr.responseText).message; } catch { /* no body */ }
        reject(new GitHubError(explain(xhr.status, message), xhr.status));
      };
      xhr.send(JSON.stringify({ content: base64, encoding: 'base64' }));
    });
  }

  /**
   * files: [{ path, text } | { path, blob } | { path, remove: true }]
   * onProgress(fraction, label) is called while uploading.
   */
  async commit(files, message, onProgress = () => {}) {
    onProgress(0, 'تجهيز الملفات…');
    const head = await this.request(`/git/ref/heads/${this.branch}`);
    const headCommit = await this.request(`/git/commits/${head.object.sha}`);
    const existing = await this.request(`/git/trees/${headCommit.tree.sha}?recursive=1`);
    const present = new Set(existing.tree.map((e) => e.path));

    const uploads = files.filter((f) => f.blob);
    const totalBytes = uploads.reduce((sum, f) => sum + f.blob.size, 0) || 1;
    let doneBytes = 0;
    const entries = [];

    for (const file of files) {
      if (file.remove) {
        if (present.has(file.path)) entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      } else if (file.text !== undefined) {
        entries.push({ path: file.path, mode: '100644', type: 'blob', content: file.text });
      } else {
        const base64 = await blobToBase64(file.blob);
        const sha = await this.uploadBlob(base64, (f) => onProgress((doneBytes + f * file.blob.size) / totalBytes * 0.95, 'رفع الملفات…'));
        doneBytes += file.blob.size;
        entries.push({ path: file.path, mode: '100644', type: 'blob', sha });
      }
    }

    onProgress(0.96, 'حفظ التغييرات…');
    const tree = await this.request('/git/trees', { method: 'POST', body: { base_tree: headCommit.tree.sha, tree: entries } });
    const commit = await this.request('/git/commits', { method: 'POST', body: { message, tree: tree.sha, parents: [head.object.sha] } });
    await this.request(`/git/refs/heads/${this.branch}`, { method: 'PATCH', body: { sha: commit.sha } });
    onProgress(1, 'تم');
  }
}
