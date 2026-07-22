import { useEffect, useRef, useState } from 'react';
import { LifeBuoy, Mail, X } from 'lucide-react';

const WHATSAPP_NUMBER = '27798196014';
const SUPPORT_EMAIL = 'jack@firmmind.co.za';
const TEMPLATE = 'Hi, the issue I am having with the portal is...';

const whatsappHref = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(TEMPLATE)}`;
const mailHref =
  `mailto:${SUPPORT_EMAIL}` +
  `?subject=${encodeURIComponent('Portal support')}` +
  `&body=${encodeURIComponent(TEMPLATE)}`;

/** WhatsApp glyph — lucide has no brand icons. */
function WhatsAppIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.174.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

export default function SupportButton() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="w-72 rounded-2xl border border-ink-200 bg-white p-4 shadow-lift animate-scale-in">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-sm font-bold text-ink-900">Need a hand?</h3>
            <button onClick={() => setOpen(false)} className="-mr-1 -mt-1 rounded-md p-1 text-ink-400 hover:bg-ink-100" aria-label="Close">
              <X size={14} />
            </button>
          </div>

          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            For technical issues, please contact app support and we will get back to you.
          </p>

          <div className="mt-3 flex gap-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex flex-1 flex-col items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-3 text-ink-600 transition-colors hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700"
            >
              <WhatsAppIcon size={20} />
              <span className="text-xs font-medium">WhatsApp</span>
            </a>
            <a
              href={mailHref}
              onClick={() => setOpen(false)}
              className="flex flex-1 flex-col items-center gap-1.5 rounded-xl border border-ink-200 px-3 py-3 text-ink-600 transition-colors hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
            >
              <Mail size={20} />
              <span className="text-xs font-medium">Email</span>
            </a>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-600 text-white shadow-lift transition-all hover:bg-brand-700 hover:scale-105 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2"
        aria-label="Support"
        title="Support"
      >
        {open ? <X size={20} /> : <LifeBuoy size={20} />}
      </button>
    </div>
  );
}
