import { initials } from '../../lib/format';

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface AvatarProps {
  name: string;
  avatarUrl?: string | null;
  emoji?: string | null;
  size?: Size;
  onClick?: () => void;
  title?: string;
  className?: string;
}

const sizeMap: Record<Size, { box: string; text: string; emoji: string }> = {
  xs: { box: 'h-7 w-7', text: 'text-[11px]', emoji: 'text-[10px] -bottom-0.5 -right-0.5' },
  sm: { box: 'h-9 w-9', text: 'text-sm', emoji: 'text-xs -bottom-1 -right-1' },
  md: { box: 'h-10 w-10', text: 'text-sm', emoji: 'text-sm -bottom-1 -right-1' },
  lg: { box: 'h-14 w-14', text: 'text-lg', emoji: 'text-lg -bottom-1 -right-1' },
  xl: { box: 'h-24 w-24', text: 'text-3xl', emoji: 'text-2xl bottom-0 right-0' },
};

// A small deterministic palette so avatars aren't all identical.
const palettes = [
  'bg-brand-100 text-brand-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-rose-100 text-rose-700',
];

function paletteFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return palettes[h % palettes.length];
}

export default function Avatar({ name, avatarUrl, emoji, size = 'md', onClick, title, className = '' }: AvatarProps) {
  const s = sizeMap[size];
  const clickable = !!onClick;
  const label = initials(name || '?') || '?';

  return (
    <button
      type="button"
      onClick={onClick}
      title={title || name}
      disabled={!clickable}
      className={`relative shrink-0 rounded-full ${clickable ? 'cursor-pointer transition-transform hover:scale-105 hover:ring-2 hover:ring-brand-300 focus:outline-none focus:ring-2 focus:ring-brand-400' : 'cursor-default'} ${className}`}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className={`${s.box} rounded-full object-cover`} />
      ) : (
        <span className={`flex ${s.box} items-center justify-center rounded-full font-semibold ${s.text} ${paletteFor(name)}`}>
          {label}
        </span>
      )}
      {emoji && (
        <span className={`absolute ${s.emoji} flex items-center justify-center rounded-full bg-white shadow-sm leading-none p-0.5`}>
          {emoji}
        </span>
      )}
    </button>
  );
}
