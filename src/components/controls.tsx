import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

const ICONS = {
  play: <path d="M5 3.2v9.6a.5.5 0 0 0 .77.42l7.2-4.8a.5.5 0 0 0 0-.84l-7.2-4.8A.5.5 0 0 0 5 3.2Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="3.75" y="3" width="3" height="10" rx=".75" fill="currentColor" stroke="none" />
      <rect x="9.25" y="3" width="3" height="10" rx=".75" fill="currentColor" stroke="none" />
    </>
  ),
  restart: (
    <>
      <rect x="2.5" y="3" width="2" height="10" rx=".5" fill="currentColor" stroke="none" />
      <path d="M14 3.5v9a.5.5 0 0 1-.77.42L6.3 8.42a.5.5 0 0 1 0-.84l6.93-4.5A.5.5 0 0 1 14 3.5Z" fill="currentColor" stroke="none" />
    </>
  ),
  cut: (
    <>
      <circle cx="4.25" cy="4.5" r="1.75" />
      <circle cx="4.25" cy="11.5" r="1.75" />
      <path d="M5.75 5.5 13.5 12M5.75 10.5 13.5 4" />
    </>
  ),
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  up: <path d="M8 12.5v-9M4.5 7 8 3.5 11.5 7" />,
  down: <path d="M8 3.5v9M4.5 9 8 12.5 11.5 9" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 8.5h6l.5-8.5" />,
  chevron: <path d="m4.5 6.5 3.5 3.5 3.5-3.5" />,
  info: (
    <>
      <circle cx="8" cy="8" r="5.75" />
      <path d="M8 7.5v3.25" />
      <circle cx="8" cy="5.4" r=".6" fill="currentColor" stroke="none" />
    </>
  ),
  warn: (
    <>
      <path d="M8 2.75 14 13H2L8 2.75Z" />
      <path d="M8 6.75v3" />
      <circle cx="8" cy="11.3" r=".55" fill="currentColor" stroke="none" />
    </>
  ),
  upload: <path d="M8 10.5v-7M5 6l3-3 3 3M3 10.5V13h10v-2.5" />,
  download: <path d="M8 3v7.5M5 7.5l3 3 3-3M3 10.5V13h10v-2.5" />,
  video: (
    <>
      <rect x="2" y="3.5" width="12" height="9" rx="2" />
      <path d="M7 6.4v3.2L9.6 8 7 6.4Z" fill="currentColor" stroke="none" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <circle cx="6" cy="6" r="1" />
      <path d="m3 11.5 3.5-3 2.5 2 2-1.5 2.5 2" />
    </>
  ),
  center: (
    <>
      <path d="M8 2v2.5M8 11.5V14M2 8h2.5M11.5 8H14" />
      <rect x="5" y="5" width="6" height="6" rx="1.25" />
    </>
  ),
  fresh: <path d="M9.5 2H4.5v12h7V4l-2-2ZM8 7v4M6 9h4" />,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="ico" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** Icon-only button. The label is both the accessible name and the tooltip. */
export function IconButton({ icon, label, onClick, disabled, className = '' }: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`icon-btn ${className}`} aria-label={label} data-tip={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** Small "i" that keeps an explanation out of the layout until it is asked for. */
export function Info({ tip }: { tip: string }) {
  return (
    <button type="button" className="info" aria-label={tip} data-tip={tip}>
      <Icon name="info" size={13} />
    </button>
  );
}

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem('wr-collapsed') ?? '[]');
  } catch {
    return [];
  }
}

export function Section({ id, title, children, action, tip }: { id?: string; title: string; children: ReactNode; action?: ReactNode; tip?: string }) {
  const key = id ?? title;
  const [open, setOpen] = useState(() => !readCollapsed().includes(key));
  const toggle = () => {
    setOpen(!open);
    try {
      const rest = readCollapsed().filter((k) => k !== key);
      localStorage.setItem('wr-collapsed', JSON.stringify(open ? [...rest, key] : rest));
    } catch {
      /* storage blocked: the section just forgets its state */
    }
  };
  return (
    <section className={`section${open ? '' : ' collapsed'}`}>
      <header className="section-head">
        <button type="button" className="section-title" aria-expanded={open} onClick={toggle}>
          <h2>{title}</h2>
          <Icon name="chevron" size={12} />
        </button>
        {tip && <Info tip={tip} />}
        <span className="spacer" />
        {open && action}
      </header>
      {open && children}
    </section>
  );
}

/** Label on the left, control on the right. */
export function Row({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <label className="row">
      <span className="label">
        {label}
        {tip && <Info tip={tip} />}
      </span>
      <span className="control">{children}</span>
    </label>
  );
}

interface NumProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  /** Short tag inside the box, e.g. W or H. */
  prefix?: string;
  label?: string;
}

/** Number input that only commits valid, clamped values, so half-typed input never corrupts state. */
export function Num({ value, onChange, min = -Infinity, max = Infinity, step = 1, suffix, prefix, label }: NumProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(n)) return setText(String(value));
    const clamped = Math.min(max, Math.max(min, n));
    onChange(clamped);
    setText(String(clamped));
  };
  return (
    <span className="num">
      {prefix && <i>{prefix}</i>}
      <input
        type="number"
        value={text}
        aria-label={label}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={(e) => commit(e.target.value)}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

interface SliderProps extends NumProps {
  label: string;
  format?: (value: number) => string;
}

export function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, format }: SliderProps) {
  const fill = `${((value - min) / (max - min)) * 100}%`;
  return (
    <label className="row slider">
      <span className="label">{label}</span>
      <span className="control">
        <input type="range" value={value} min={min} max={max} step={step} style={{ '--fill': fill } as React.CSSProperties} onChange={(e) => onChange(Number(e.target.value))} />
        <output>{format ? format(value) : value}</output>
      </span>
    </label>
  );
}

export function Color({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <span className="color">
      <input type="color" value={value} aria-label="Pick color" onChange={(e) => onChange(e.target.value)} />
      <input
        type="text"
        value={text}
        spellCheck={false}
        aria-label="Hex color"
        onChange={(e) => {
          setText(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
        }}
        onBlur={() => setText(value)}
      />
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return <input type="checkbox" role="switch" className="toggle" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice({ tone, children }: { tone: 'warn' | 'error' | 'info'; children: ReactNode }) {
  return (
    <p className={`notice ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'info' ? 'info' : 'warn'} size={13} />
      <span>{children}</span>
    </p>
  );
}

/** Closes a popover on Escape or a press outside it. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  });
}

/**
 * One tooltip for the whole app: anything with data-tip gets it on hover or
 * keyboard focus. It is drawn at the document level so panels cannot clip it,
 * and it flips/clamps to stay inside the window.
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; rect: DOMRect } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let timer = 0;
    const find = (t: EventTarget | null) => (t instanceof Element ? (t.closest('[data-tip]') as HTMLElement | null) : null);
    const hide = () => {
      clearTimeout(timer);
      current = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      clearTimeout(timer);
      current = el;
      timer = window.setTimeout(() => {
        if (el.isConnected && el.dataset.tip) setTip({ text: el.dataset.tip, rect: el.getBoundingClientRect() });
      }, delay);
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = find(e.target);
      if (el === current) return;
      if (el) show(el, 350);
      else hide();
    };
    const onDown = (e: PointerEvent) => {
      const el = find(e.target);
      // Touch has no hover: tapping an info icon opens its note, tapping elsewhere closes it.
      if (e.pointerType === 'touch' && el?.classList.contains('info') && el !== current) show(el, 0);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = find(e.target);
      if (el && el.matches(':focus-visible')) show(el, 0);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', hide, true);
    document.documentElement.addEventListener('pointerleave', hide);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', hide, true);
      document.documentElement.removeEventListener('pointerleave', hide);
    };
  }, []);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || !tip) return;
    const { rect } = tip;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = Math.min(Math.max(rect.left + rect.width / 2 - w / 2, 8), window.innerWidth - w - 8);
    const above = rect.top - h - 8;
    box.style.left = `${left}px`;
    box.style.top = `${above >= 8 ? above : rect.bottom + 8}px`;
  }, [tip]);

  return tip ? (
    <div className="tooltip" role="tooltip" ref={boxRef}>
      {tip.text}
    </div>
  ) : null;
}
