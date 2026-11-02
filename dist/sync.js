export class LibrarySync {
  constructor({revision, save, onChange = () => {}}) {
    this.revision = revision; this.save = save; this.onChange = onChange;
    this.pending = null; this.running = null; this.error = null; this.paused = false;
  }
  enqueue(library) {
    this.pending = structuredClone(library);
    this.onChange(this);
  }
  pause(error) {this.paused = true; this.error = error; this.onChange(this);}
  async flush() {
    if (this.running) return this.running;
    if (this.paused) return false;
    this.running = this.drain();
    try {return await this.running;} finally {this.running = null;this.onChange(this);}
  }
  async drain() {
    this.error = null;
    while (this.pending && !this.paused) {
      const payload = this.pending;
      this.onChange(this);
      try {
        const result = await this.save({revision: this.revision, library: payload});
        this.revision = result.revision;
        if (this.pending === payload) this.pending = null;
        this.onChange(this);
      } catch (error) {
        this.error = error;
        if ([401,409].includes(error.status)) this.paused = true;
        this.onChange(this); return false;
      }
    }
    return !this.pending && !this.paused;
  }
}
export async function apiRequest(path, {method = 'GET', body, accountId} = {}) {
  const response = await fetch(path, {method, credentials: 'same-origin', cache: 'no-store', headers: {
    ...(method !== 'GET' ? {'Content-Type':'application/json'} : {}),
    ...(accountId ? {'X-Account-ID':accountId} : {})
  }, ...(body !== undefined ? {body:JSON.stringify(body)} : {})});
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {const error = new Error(data?.error?.message || 'Не удалось связаться с сервером');error.status = response.status;error.code = data?.error?.code;throw error;}
  return data;
}
