// Attaching files to Log posts and Cache items. With cloud storage set up (cloudflare/SETUP.md) a file goes
// to R2 through main and the record keeps only its id; without it, a small file travels inline in the record
// (a data: URL) so screenshots still sync on the free Firebase plan.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTACH_INLINE_MAX_CHARS, ATTACH_MAX_BYTES, ATTACH_MAX_FILES, type Attachment } from '../../core/model/types';
import { api } from '../api';

export type Area = 'log' | 'cache';

/** Raw bytes that still fit once base64 inflates them by a third, with room for the data: prefix. */
export const INLINE_MAX_BYTES = Math.floor(((ATTACH_INLINE_MAX_CHARS - 100) * 3) / 4);
const inlineChars = (list: Attachment[]) => list.reduce((n, a) => n + (a.data?.length ?? 0), 0);

export const isImage = (a: Pick<Attachment, 'mime'>): boolean => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/.test(a.mime);

export function sizeLabel(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const toDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** Turn a picked file into an attachment (uploading it when cloud storage is on). */
export async function prepare(file: File, area: Area, cloud: boolean, held: Attachment[]): Promise<{ ok: true; att: Attachment } | { ok: false; error: string }> {
  if (held.length >= ATTACH_MAX_FILES) return { ok: false, error: `At most ${ATTACH_MAX_FILES} files each.` };
  if (file.size > ATTACH_MAX_BYTES) return { ok: false, error: `${file.name} is over 25 MB.` };
  const name = (file.name || (file.type.startsWith('image/') ? 'image.png' : 'file')).slice(0, 200);
  const mime = (file.type || 'application/octet-stream').slice(0, 100);
  const id = crypto.randomUUID();
  let why = '';
  if (cloud && api.can.cloudFiles) {
    const r = await api.files.put({ area, id, name, mime, bytes: new Uint8Array(await file.arrayBuffer()) });
    if (r.ok) return { ok: true, att: { id, name, mime, size: file.size, cloud: true, data: null } };
    why = r.error;
  }
  if (file.size <= INLINE_MAX_BYTES) {
    const data = await toDataUrl(file);
    if (inlineChars(held) + data.length <= ATTACH_INLINE_MAX_CHARS) return { ok: true, att: { id, name, mime, size: file.size, cloud: false, data } };
    return { ok: false, error: 'Too many inline files on this one. Remove one, or set up file storage.' };
  }
  return { ok: false, error: why || `${name} is too big without file storage (about ${sizeLabel(INLINE_MAX_BYTES)} at most). See cloudflare/SETUP.md.` };
}

/** The files a record is holding while it is being written. */
export function useAttachments(area: Area, cloud: boolean) {
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = useRef<Attachment[]>([]);
  held.current = files;
  const add = useCallback(
    async (list: FileList | File[] | null) => {
      const picked = Array.from(list ?? []);
      if (!picked.length) return;
      setBusy(true);
      setError(null);
      let now = held.current;
      for (const f of picked) {
        try {
          const r = await prepare(f, area, cloud, now);
          if (r.ok) now = [...now, r.att];
          else setError(r.error);
        } catch {
          setError(`Could not read ${f.name || 'that file'}.`);
        }
      }
      setFiles(now);
      setBusy(false);
    },
    [area, cloud],
  );
  const remove = useCallback((id: string) => setFiles((x) => x.filter((a) => a.id !== id)), []);
  const clear = useCallback(() => (setFiles([]), setError(null)), []);
  return { files, busy, error, add, remove, clear };
}

/** Bytes of an attachment as a Blob (inline or from the cloud). */
export async function blobOf(a: Attachment, area: Area): Promise<{ ok: true; blob: Blob } | { ok: false; error: string }> {
  if (!a.cloud) {
    try {
      const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(a.data ?? '');
      if (!m) throw new Error('bad data url');
      const raw = m[2] ? atob(m[3]!) : decodeURIComponent(m[3]!);
      const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
      return { ok: true, blob: new Blob([bytes], { type: m[1] || a.mime }) };
    } catch {
      return { ok: false, error: 'That file is damaged.' };
    }
  }
  const r = await api.files.get(area, a.id);
  return r.ok ? { ok: true, blob: new Blob([r.bytes as BlobPart], { type: a.mime }) } : { ok: false, error: r.error };
}

/** A URL to show an image attachment, loaded once and released on unmount. */
export function useImageSrc(a: Attachment, area: Area): { src: string | null; error: string | null } {
  const [state, setState] = useState<{ src: string | null; error: string | null }>({ src: a.cloud ? null : a.data, error: null });
  useEffect(() => {
    if (!a.cloud) return setState({ src: a.data, error: null });
    let url: string | null = null;
    let dead = false;
    void blobOf(a, area).then((r) => {
      if (dead) return;
      if (r.ok) {
        url = URL.createObjectURL(r.blob);
        setState({ src: url, error: null });
      } else setState({ src: null, error: r.error });
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [a.id, a.cloud, a.data, area]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export async function saveAttachment(a: Attachment, area: Area): Promise<string | null> {
  const r = await blobOf(a, area);
  if (!r.ok) return r.error;
  const url = URL.createObjectURL(r.blob);
  const el = document.createElement('a');
  el.href = url;
  el.download = a.name;
  document.body.appendChild(el);
  el.click();
  el.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return null;
}

/** Copy an image to the clipboard (PNG only in browsers; others fall back to saving). */
export async function copyImage(a: Attachment, area: Area): Promise<boolean> {
  const r = await blobOf(a, area);
  if (!r.ok) return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [r.blob.type === 'image/png' ? 'image/png' : 'image/png']: r.blob.type === 'image/png' ? r.blob : await asPng(r.blob) })]);
    return true;
  } catch {
    return false;
  }
}

async function asPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
}

/** Files from a paste or drop event. */
export const filesOf = (dt: DataTransfer | null): File[] => (dt ? Array.from(dt.files) : []);
