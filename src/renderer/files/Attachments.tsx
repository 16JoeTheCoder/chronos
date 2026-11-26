// Showing and holding attachments: thumbnails for images, a named chip for everything else.
import { useState } from 'react';
import type { Attachment } from '../../core/model/types';
import { Icon } from '../components/Icon';
import { toast } from '../store';
import { copyImage, isImage, saveAttachment, sizeLabel, useImageSrc, type Area } from './attach';
import './files.css';

function Thumb({ a, area }: { a: Attachment; area: Area }) {
  const { src, error } = useImageSrc(a, area);
  const [big, setBig] = useState(false);
  if (error) return <span className="att-chip att-gone" title={error}>{a.name} · unavailable</span>;
  return (
    <figure className={`att-img${big ? ' is-big' : ''}`}>
      {src ? (
        <button type="button" className="att-img-btn" onClick={() => setBig((v) => !v)} aria-label={`${big ? 'Shrink' : 'Enlarge'} ${a.name}`} aria-pressed={big}>
          <img src={src} alt={a.name} loading="lazy" />
        </button>
      ) : (
        <span className="att-img-wait" aria-label="Loading image" />
      )}
      <figcaption>
        <span className="att-name">{a.name}</span>
        <button type="button" className="att-act" onClick={async () => toast((await copyImage(a, area)) ? 'Image copied.' : 'Could not copy that image. Save it instead.', { error: false })}>Copy</button>
        <button type="button" className="att-act" onClick={async () => { const e = await saveAttachment(a, area); if (e) toast(e, { error: true }); }}>Save</button>
      </figcaption>
    </figure>
  );
}

/** Read-only list on a post or cache item. */
export function AttachList({ files, area }: { files: Attachment[] | undefined; area: Area }) {
  if (!files?.length) return null;
  return (
    <div className="att-list">
      {files.map((a) =>
        isImage(a) ? (
          <Thumb key={a.id} a={a} area={area} />
        ) : (
          <button key={a.id} type="button" className="att-chip" onClick={async () => { const e = await saveAttachment(a, area); if (e) toast(e, { error: true }); }} title={`Save ${a.name}`}>
            <Icon name="folder" size={14} />
            <span className="att-name">{a.name}</span>
            <span className="att-size">{sizeLabel(a.size)}</span>
          </button>
        ),
      )}
    </div>
  );
}

/** Files waiting to be posted, each removable. */
export function AttachPending({ files, busy, error, onRemove }: { files: Attachment[]; busy: boolean; error: string | null; onRemove: (id: string) => void }) {
  if (!files.length && !busy && !error) return null;
  return (
    <div className="att-pending" aria-live="polite">
      {files.map((a) => (
        <span key={a.id} className="att-chip">
          <Icon name={isImage(a) ? 'layers' : 'folder'} size={14} />
          <span className="att-name">{a.name}</span>
          <span className="att-size">{sizeLabel(a.size)}</span>
          <button type="button" className="att-x" onClick={() => onRemove(a.id)} aria-label={`Remove ${a.name}`}><Icon name="x" size={12} /></button>
        </span>
      ))}
      {busy && <span className="att-note">Adding…</span>}
      {error && <span className="att-note att-err" role="alert">{error}</span>}
    </div>
  );
}

/** The paperclip-style button: opens the file picker. */
export function AttachButton({ onPick, className = 'log-btn log-btn-quiet' }: { onPick: (f: FileList | null) => void; className?: string }) {
  return (
    <label className={`${className} att-pick`} title="Attach files or images. You can also paste or drop them.">
      <Icon name="plus" size={14} /> Attach
      <input type="file" multiple hidden onChange={(e) => { onPick(e.target.files); e.target.value = ''; }} />
    </label>
  );
}
