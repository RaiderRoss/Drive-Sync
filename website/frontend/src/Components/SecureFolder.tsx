import { useState } from 'react';
import type { CSSProperties } from 'react';
import './SecureFolder.css';

// Four chain arms radiate from the lock (the hub).
// All geometry (angles, pitch, hub position) lives in the CSS.
const ARMS = ['TL', 'TR', 'BL', 'BR'] as const;

type Arm = (typeof ARMS)[number];

type ChainStyle = CSSProperties & {
    '--i': number;
    '--k': number;
};

// Links are numbered outward from the hub.
// Odd = edge-on bar, even = face-on ring.
const LINKS = [1, 2, 3, 4, 5, 6];

// Deterministic per-link variation (-1..1).
const JITTER: Record<Arm, number[]> = {
    TL: [0.6, -0.8, 0.3, -0.5, 0.9, -0.2],
    TR: [-0.4, 0.7, -0.9, 0.5, -0.3, 0.8],
    BL: [0.8, -0.3, 0.6, -0.9, 0.2, -0.6],
    BR: [-0.7, 0.4, -0.2, 0.9, -0.8, 0.3],
};

export default function SecureFolder() {
    const [open, setOpen] = useState(false);

    return (
        <button
            type="button"
            className="secure-folder"
            data-open={open || undefined}
            aria-pressed={open}
            onPointerEnter={() => setOpen(true)}
            onPointerLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
        >
            <span className="secure-folder__folder" aria-hidden="true">
                <span className="secure-folder__tab" />
                <span className="secure-folder__back" />
                <span className="secure-folder__paper" />
                <span className="secure-folder__paper secure-folder__paper--back" />
                <span className="secure-folder__front" />
            </span>

            <span className="secure-folder__lockup" aria-hidden="true">
                <span className="secure-folder__chains">
                    {ARMS.map((arm) => (
                        <span
                            className={`secure-folder__chain secure-folder__chain--${arm}`}
                            key={arm}
                        >
                            {LINKS.map((i, n) => (
                                <span
                                    className={`secure-folder__link ${
                                        i % 2
                                            ? 'secure-folder__link--bar'
                                            : 'secure-folder__link--ring'
                                    }`}
                                    key={i}
                                    style={
                                        {
                                            '--i': i,
                                            '--k': JITTER[arm][n],
                                        } as ChainStyle
                                    }
                                />
                            ))}
                        </span>
                    ))}
                </span>

                <span className="secure-folder__lock">
                    <span className="secure-folder__shackle" />
                    <span className="secure-folder__body">
                        <svg
                            className="secure-folder__keyhole"
                            viewBox="4 3 16 25"
                            focusable="false"
                        >
                            <path d="M12 4a6.5 6.5 0 0 0-3.2 12.2L7.5 27h9l-1.3-10.8A6.5 6.5 0 0 0 12 4z" />
                        </svg>
                    </span>
                </span>
            </span>
        </button>
    );
}