import { useState } from 'react';
import './FolderFloat.css';

type FolderItem = string | { label: string; value?: string };

interface FolderFloatProps {
  items?: FolderItem[];
  label?: string;
  sublabel?: string;
  defaultOpen?: boolean;
  closeOnSelect?: boolean;
  onSelect?: (value: string, index: number) => void;
}

const DEFAULT_ITEMS = [
  'Try a warmer palette',
  'Tighten the spacing',
  'Logo feels small',
  'Love the new hero',
];

const ITEM_ROTATIONS = [-4, 3, -2, 5, -3, 2];

export default function FolderFloat({
  items = DEFAULT_ITEMS,
  label = 'Design feedback',
  sublabel,
  defaultOpen = false,
}: FolderFloatProps) {
  const [open, setOpen] = useState(defaultOpen);
  const normalizedItems = items.map(item => (typeof item === 'string' ? { label: item, value: item } : item));
  const noteLabel = sublabel ?? `${normalizedItems.length} ${normalizedItems.length === 1 ? 'note' : 'notes'}`;

  return (
    <div
      className="folder-float"
      data-open={open || undefined}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <div className="folder-float__items" aria-label={`${label} notes`}>
        {normalizedItems.map((item, index) => (
          <button
            key={`${item.value ?? item.label}-${index}`}
            type="button"
            className="folder-float__item"
            style={{
              '--index': index,
              '--total': normalizedItems.length,
              '--column': index % 2,
              '--row': Math.floor(index / 2),
              '--rotation': `${ITEM_ROTATIONS[index % ITEM_ROTATIONS.length]}deg`,
            } as React.CSSProperties}
            tabIndex={open ? 0 : -1}
            aria-hidden={!open}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="folder-float__folder">
        <span className="folder-float__back" aria-hidden="true" />
        <span className="folder-float__paper folder-float__paper--back" aria-hidden="true" />
        <span className="folder-float__paper" aria-hidden="true" />
        <span className="folder-float__front">
          <span className="folder-float__label">{label}</span>
          <span className="folder-float__sub">{noteLabel}</span>
        </span>
        <button
          type="button"
          className="folder-float__trigger"
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Open'} ${label}`}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        />
      </div>
    </div>
  );
}
