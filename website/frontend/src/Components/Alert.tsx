import {
    createContext,
    useCallback,
    useContext,
    useRef,
    useState,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type AlertType = 'success' | 'error' | 'info' | 'warning';

interface AlertItem {
    id: number;
    type: AlertType;
    text: string;
}

interface AlertContextValue {
    success: (text: string, durationMs?: number) => void;
    error: (text: string, durationMs?: number) => void;
    info: (text: string, durationMs?: number) => void;
    warning: (text: string, durationMs?: number) => void;
}

const AlertContext = createContext<AlertContextValue | null>(null);

const DEFAULT_DURATION = 3000;

const COLORS: Record<AlertType, { bg: string; border: string; icon: string }> = {
    success: { bg: '#1e2e22', border: '#2f9e57', icon: '#4ade80' },
    error: { bg: '#2e1e1e', border: '#c4453f', icon: '#f87171' },
    warning: { bg: '#2e2a1e', border: '#c4953f', icon: '#fbbf24' },
    info: { bg: '#1e242e', border: '#3f7ec4', icon: '#60a5fa' },
};

function AlertIcon({ type }: { type: AlertType }) {
    const color = COLORS[type].icon;
    const common = {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round' as const,
        strokeLinejoin: 'round' as const,
    };

    if (type === 'success') {
        return (
            <svg {...common}>
                <path d="M20 6 9 17l-5-5" />
            </svg>
        );
    }
    if (type === 'error') {
        return (
            <svg {...common}>
                <circle cx="12" cy="12" r="10" />
                <path d="M15 9l-6 6M9 9l6 6" />
            </svg>
        );
    }
    if (type === 'warning') {
        return (
            <svg {...common}>
                <path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
        );
    }
    return (
        <svg {...common}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
        </svg>
    );
}

interface AlertProviderProps {
    children: ReactNode;
    offsetLeft?: number;
}

export function AlertProvider({ children, offsetLeft = 0 }: AlertProviderProps) {
    const [items, setItems] = useState<AlertItem[]>([]);
    const nextId = useRef(0);

    const dismiss = useCallback((id: number) => {
        setItems(prev => prev.filter(item => item.id !== id));
    }, []);

    const push = useCallback(
        (type: AlertType, text: string, durationMs: number = DEFAULT_DURATION) => {
            const id = nextId.current++;
            setItems(prev => [...prev, { id, type, text }]);
            if (durationMs > 0) {
                setTimeout(() => dismiss(id), durationMs);
            }
        },
        [dismiss],
    );

    const value: AlertContextValue = {
        success: (text, durationMs) => push('success', text, durationMs),
        error: (text, durationMs) => push('error', text, durationMs),
        info: (text, durationMs) => push('info', text, durationMs),
        warning: (text, durationMs) => push('warning', text, durationMs),
    };

    return (
        <AlertContext.Provider value={value}>
            {children}
            {createPortal(
                <>
                    <div
                        style={{
                            position: 'fixed',
                            top: 16,
                            left: '50%',
                            transform: `translateX(calc(-50% + ${offsetLeft}px))`,
                            zIndex: 999999,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                            pointerEvents: 'none',
                        }}
                    >
                        {items.map(item => {
                            const palette = COLORS[item.type];
                            return (
                                <div
                                    key={item.id}
                                    role="status"
                                    style={{
                                        pointerEvents: 'auto',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        background: palette.bg,
                                        border: `1px solid ${palette.border}`,
                                        borderRadius: 6,
                                        padding: '10px 16px',
                                        color: '#ffffff',
                                        fontSize: 14,
                                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.35)',
                                        minWidth: 220,
                                        maxWidth: 420,
                                        animation: 'alert-slide-in 0.18s ease-out',
                                    }}
                                    onClick={() => dismiss(item.id)}
                                >
                                    <AlertIcon type={item.type} />
                                    <span style={{ flex: 1 }}>{item.text}</span>
                                </div>
                            );
                        })}
                    </div>
                    <style>
                        {`
                        @keyframes alert-slide-in {
                            from { opacity: 0; transform: translateY(-8px); }
                            to { opacity: 1; transform: translateY(0); }
                        }
                        `}
                    </style>
                </>,
                document.body,
            )}
        </AlertContext.Provider>
    );
}

export function useAlert(): AlertContextValue {
    const ctx = useContext(AlertContext);
    if (!ctx) {
        throw new Error('useAlert must be used within an <AlertProvider>');
    }
    return ctx;
}