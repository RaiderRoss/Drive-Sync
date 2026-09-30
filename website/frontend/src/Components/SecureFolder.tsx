import { LockOutlined } from '@ant-design/icons';
import { useState } from 'react';
import './SecureFolder.css';

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

            <span className="secure-folder__chain secure-folder__chain--TL" aria-hidden="true">
                {[0, 1, 2, 3].map(index => (
                    <span className="secure-folder__link" key={index} />
                ))}
            </span>

            <span className="secure-folder__chain secure-folder__chain--TR" aria-hidden="true">
                {[0, 1, 2, 3].map(index => (
                    <span className="secure-folder__link" key={index} />
                ))}
            </span>

            <span className="secure-folder__chain secure-folder__chain--BL" aria-hidden="true">
                {[0, 1, 2, 3].map(index => (
                    <span className="secure-folder__link" key={index} />
                ))}
            </span>

            <span className="secure-folder__chain secure-folder__chain--BR" aria-hidden="true">
                {[0, 1, 2, 3].map(index => (
                    <span className="secure-folder__link" key={index} />
                ))}
            </span>

            <span className="secure-folder__lock" aria-hidden="true">
                <LockOutlined />
            </span>
        </button>
    );
}