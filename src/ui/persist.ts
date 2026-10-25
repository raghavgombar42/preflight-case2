// Per-viewer convenience only: keeps the current upload / chat across page
// navigation in this browser tab. Everything works without it.

export function load<T>(key: string): T | null {
  try {
    const s = window.sessionStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export function save(key: string, value: unknown) {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: ignore
  }
}

export function clear(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}
