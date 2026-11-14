import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { SignatureConfig, SignatureKind } from '../../core/theme';
import { useOptionalTheme } from '../theme/ThemeProvider';
import './signature.css';

export interface SignatureTimerProps {
  /** 0..1 of the block elapsed. */
  progress: number;
  /** Seconds left (or seconds over, when overrun). */
  remainingSec: number;
  running: boolean;
  overrun?: boolean;
  /** ~20-28 px variant for the overlay pill and notepad header. */
  mini?: boolean;
  /** Set true to fire the completion flare. */
  onComplete?: boolean;
  /** Override the theme's signature kind (theme previews). */
  kind?: SignatureKind;
  /** Pixel size. Full: reactor/accretion diameter, slab height, digit font-size. Mini: height. */
  size?: number;
  className?: string;
}

export function formatClock(sec: number, overrun = false): string {
  const s = Math.max(0, Math.floor(Math.abs(sec)));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return (overrun ? '+' : '') + (h ? `${h}:${p(m)}:${p(x)}` : `${p(m)}:${p(x)}`);
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** 0 on first paint, then the real value on the next frame, so rings "charge" on mount and ease between updates. */
function useCharged(v: number): number {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(v));
    return () => cancelAnimationFrame(id);
  }, [v]);
  return shown;
}

interface Inner { p: number; text: string; cfg: SignatureConfig; size?: number; mini: boolean; flare: boolean }

export function SignatureTimer(props: SignatureTimerProps) {
  const theme = useOptionalTheme();
  const cfg: SignatureConfig = theme?.theme.motion.signature ?? { kind: 'ticking-digits' };
  const kind = props.kind ?? cfg.kind;
  const p = clamp01(props.progress);
  const mini = !!props.mini;
  const text = formatClock(props.remainingSec, props.overrun);
  const inner: Inner = { p, text, cfg, size: props.size, mini, flare: !!props.onComplete };
  const root = {
    className: `sig sig-${kind}${mini ? ' sig-mini' : ''}${props.className ? ' ' + props.className : ''}`,
    'data-running': String(props.running),
    'data-overrun': String(!!props.overrun),
    'data-complete': String(!!props.onComplete),
    role: 'img' as const,
    'aria-label': `${Math.round(p * 100)} percent done, ${text} ${props.overrun ? 'over' : 'left'}`,
  };
  switch (kind) {
    case 'reactor-ring': return <Reactor root={root} {...inner} />;
    case 'slab-monolith': return <Slabs root={root} {...inner} />;
    case 'accretion-ring': return <Accretion root={root} {...inner} />;
    default: return <Digits root={root} {...inner} />;
  }
}

type Root = Record<string, string | undefined>;
type P = Inner & { root: Root };

/* ---------- reactor-ring ---------- */
const R_RING = 170;
const R_C = 2 * Math.PI * R_RING;

function Reactor({ root, p, text, cfg, size, mini, flare }: P) {
  const id = "sigm" + useId().replace(/[^a-zA-Z0-9]/g, "");
  const shown = useCharged(p);
  const n = mini ? Math.min(cfg.segments ?? 40, 12) : (cfg.segments ?? 40);
  const seg = R_C / n;
  const dash = `${seg * 0.75} ${seg * 0.25}`;
  const k = cfg.plasma?.brightnessFollowsProgress === false ? 0.7 : 0.25 + p * 0.75;
  const px = size ?? (mini ? 24 : 400);
  const ring = (cls: string, mask?: string) => (
    <circle className={cls} cx="220" cy="220" r={R_RING} strokeDasharray={dash} mask={mask} />
  );
  const svg = (
    <svg viewBox="0 0 440 440" width="100%" height="100%" aria-hidden="true">
      <defs>
        <mask id={id}>
          <circle className="sig-mask" cx="220" cy="220" r={R_RING} strokeDasharray={`${R_C} ${R_C}`} strokeDashoffset={R_C * (1 - shown)} transform="rotate(-90 220 220)" />
        </mask>
      </defs>
      {!mini && <g className="sig-ticks"><circle cx="220" cy="220" r="206" strokeDasharray="1.5 10.4" /></g>}
      {ring('sig-seg-track')}
      {ring('sig-seg-on', `url(#${id})`)}
      {mini ? <circle className="sig-core-m" cx="220" cy="220" r="86" style={{ opacity: k }} /> : (
        <>
          <circle className="sig-inner-ring" cx="220" cy="220" r="138" />
          <circle className="sig-disc" cx="220" cy="220" r="132" />
          <text className="sig-time" x="220" y="236" textAnchor="middle" fontSize={text.length > 5 ? 54 : 76}>{text}</text>
        </>
      )}
      {flare && <circle className="sig-flare-svg" cx="220" cy="220" r="100" />}
    </svg>
  );
  const style = { width: px, height: px, '--k': k.toFixed(3) } as CSSProperties;
  if (mini) return <span {...root} style={style}>{svg}</span>;
  return (
    <div {...root} style={style}>
      <div className="sig-plasma" />
      <div className="sig-core" />
      {flare && <div className="sig-flare" />}
      {svg}
    </div>
  );
}

/* ---------- slab-monolith ---------- */
function Slabs({ root, p, text, size, mini }: P) {
  const px = size ?? (mini ? 24 : 380);
  const slabs = [0, 1, 2, 3].map((i) => (
    <span key={i} className="sig-slab">
      <i className="sig-slab-fill" style={{ transform: `scaleY(${clamp01(p * 4 - i)})` }} />
      {!mini && <><b className="sig-rule sig-rule-t" /><b className="sig-rule sig-rule-b" /></>}
    </span>
  ));
  const style = { '--s': `${px}px` } as CSSProperties;
  if (mini) return <span {...root} style={style}>{slabs}</span>;
  return (
    <div {...root} style={style}>
      <div className="sig-slabs">{slabs}</div>
      <span className="sig-time">{text}</span>
    </div>
  );
}

/* ---------- accretion-ring ---------- */
const A_C = 2 * Math.PI * 206;

function Accretion({ root, p, text, size, mini, flare }: P) {
  const shown = useCharged(p);
  const px = size ?? (mini ? 24 : 480);
  return (
    <span {...root} style={{ width: px, height: px }}>
      <svg viewBox="0 0 720 720" width="100%" height="100%" aria-hidden="true">
        <ellipse className="sig-halo" cx="360" cy="360" rx="330" ry="64" />
        <circle className="sig-hole" cx="360" cy="360" r="200" />
        <circle className="sig-rim" cx="360" cy="360" r="206" />
        <circle className="sig-prog" cx="360" cy="360" r="206" strokeDasharray={`${A_C} ${A_C}`} strokeDashoffset={A_C * (1 - shown)} transform="rotate(-90 360 360)" />
        <g className="sig-disk"><path d="M30 360 A330 64 0 0 0 690 360" /></g>
        {flare && <circle className="sig-flare-svg" cx="360" cy="360" r="206" />}
        {!mini && <text className="sig-time" x="360" y="380" textAnchor="middle" fontSize={text.length > 5 ? 46 : 64}>{text}</text>}
      </svg>
    </span>
  );
}

/* ---------- ticking-digits ---------- */
function Digits({ root, text, size, mini }: P) {
  const prev = useRef(text);
  const changed = [...text].map((c, i) => c !== prev.current[i]);
  useEffect(() => { prev.current = text; });
  const px = size ?? (mini ? 24 : 120);
  return (
    <span {...root} style={{ fontSize: mini ? px * 0.72 : px, height: mini ? px : undefined }}>
      {[...text].map((c, i) => (
        <span key={`${i}${c}`} className={`sig-digit${changed[i] && /\d/.test(c) ? ' sig-tick' : ''}`} aria-hidden="true">{c}</span>
      ))}
    </span>
  );
}
