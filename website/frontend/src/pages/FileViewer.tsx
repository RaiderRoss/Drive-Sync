import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spin, Alert as AntdAlert, Breadcrumb, Input, Button } from 'antd';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { getAuthHeaders } from '../api/File';
import { useAlert } from '../Components/Alert';

const { TextArea } = Input;

const extensionToLanguage: Record<string, string> = {
    js: 'javascript',
    ts: 'typescript',
    jsx: 'jsx',
    tsx: 'tsx',
    py: 'python',
    rb: 'ruby',
    java: 'java',
    cpp: 'cpp',
    c: 'c',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    txt: 'text',
    sh: 'bash',
    rs: 'rust',
    go: 'go',
    php: 'php',
    default: 'text',
};

export default function FileViewer() {
    const location = useLocation();
    const navigate = useNavigate();
    const alert = useAlert();
    const API_BASE = '/api';

    const isShare = location.pathname.startsWith('/share');

    const rawPath = isShare
        ? location.pathname.replace(/^\/share\//, '')
        : location.pathname.startsWith('/file')
            ? location.pathname.replace(/^\/file\//, '')
            : '';

    const filename = decodeURIComponent(rawPath);

    const fileUrl = isShare
        ? `${API_BASE}/share/${encodeURIComponent(filename)}`
        : `${API_BASE}/download/${encodeURIComponent(filename)}`;

    const [content, setContent] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState<string>('');
    const [fileType, setFileType] = useState<string | null>(null);
    const [highlightLang, setHighlightLang] = useState<string>('text');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);

    const getMediaMimeType = (ext?: string) => {
        switch (ext) {
            case 'pdf':
                return 'application/pdf';
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'png':
                return 'image/png';
            case 'gif':
                return 'image/gif';
            case 'bmp':
                return 'image/bmp';
            case 'webp':
                return 'image/webp';
            case 'mp4':
                return 'video/mp4';
            case 'webm':
                return 'video/webm';
            case 'mkv':
                return 'video/x-matroska';
            case 'avi':
                return 'video/x-msvideo';
            case 'mp3':
                return 'audio/mpeg';
            case 'wav':
                return 'audio/wav';
            case 'ogg':
                return 'audio/ogg';
            default:
                return 'application/octet-stream';
        }
    };

    useEffect(() => {
        // For /file/:path the filename in the URL is real and has an
        // extension we can trust as a hint. For /share/:id the "filename"
        // is actually a share UUID with no extension — the real file type
        // is only known server-side. So we always do a single fetch and
        // classify the result by the response's Content-Type header
        // (which serve_file/serve_video already set correctly), falling
        // back to the URL extension only as a hint for syntax highlighting
        // language on text files.
        let objectUrl: string | null = null;
        let cancelled = false;

        setLoading(true);
        setError(null);
        setContent(null);
        setPreviewSrc(null);

        const urlExt = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';

        const classify = (contentType: string, disposition: string | null): 'image' | 'video' | 'audio' | 'pdf' | 'text' => {
            const type = contentType.toLowerCase();

            // Prefer the real filename from Content-Disposition if the server sent one
            // (useful for /share where the URL itself has no extension).
            let realExt = urlExt;
            if (disposition) {
                const match = disposition.match(/filename="?([^"]+)"?/i);
                if (match && match[1].includes('.')) {
                    realExt = match[1].split('.').pop()!.toLowerCase();
                }
            }

            if (type.startsWith('image/')) return 'image';
            if (type.startsWith('video/')) return 'video';
            if (type.startsWith('audio/')) return 'audio';
            if (type.includes('pdf')) return 'pdf';

            // Content-Type was generic (e.g. application/octet-stream) — fall
            // back to whatever extension we have.
            if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(realExt)) return 'image';
            if (['mp4', 'webm', 'mkv', 'avi'].includes(realExt)) return 'video';
            if (['mp3', 'wav', 'ogg'].includes(realExt)) return 'audio';
            if (realExt === 'pdf') return 'pdf';
            return 'text';
        };

        fetch(fileUrl, {
            headers: getAuthHeaders(),
        })
            .then(async res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                if (cancelled) return;

                const contentType = res.headers.get('Content-Type') || '';
                const disposition = res.headers.get('Content-Disposition');
                const kind = classify(contentType, disposition);

                if (kind === 'text') {
                    const text = await res.text();
                    if (cancelled) return;
                    setFileType('text');
                    // Use Content-Disposition filename if we got one, else URL extension.
                    let langExt = urlExt;
                    if (disposition) {
                        const match = disposition.match(/filename="?([^"]+)"?/i);
                        if (match && match[1].includes('.')) {
                            langExt = match[1].split('.').pop()!.toLowerCase();
                        }
                    }
                    setHighlightLang(extensionToLanguage[langExt] || extensionToLanguage.default);
                    setContent(text);
                    setEditedContent(text);
                } else {
                    const buffer = await res.arrayBuffer();
                    if (cancelled) return;
                    const blob = new Blob([buffer], { type: contentType || getMediaMimeType(urlExt) });
                    objectUrl = URL.createObjectURL(blob);
                    setFileType(kind);
                    setHighlightLang('text');
                    setPreviewSrc(objectUrl);
                }
            })
            .catch(err => {
                if (cancelled) return;
                console.error('File fetch error:', err);
                setError('Could not load file content.');
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filename]);

    const handleSave = async () => {
        try {
            const formData = new FormData();
            const blob = new Blob([editedContent], { type: 'text/plain' });

            formData.append('file', blob, filename);

            const uploadPath = `/api/upload/${encodeURIComponent(filename)}`;

            const res = await fetch(uploadPath || '/api/upload', {
                method: 'POST',
                body: formData,
                headers: getAuthHeaders(),
            });

            console.log('Save response:', res);
            if (res.ok) {
                alert.success('File saved successfully');
                setContent(editedContent);
                setIsEditing(false);
            } else {
                alert.error(`Save failed: ${res.status}`);
            }
        } catch (err) {
            console.error('Save error:', err);
            alert.error('Save failed');
        }
    };

    const pathParts = filename.split('/');
    const breadcrumbItems = [
        {
            title: (
                <a onClick={() => navigate('/files')} style={{ cursor: 'pointer' }}>
                    Files
                </a>
            ),
            key: 'files-root',
        },
        ...pathParts.map((part, idx) => {
            const isLast = idx === pathParts.length - 1;
            const path = pathParts.slice(0, idx + 1).join('/');
            return {
                title: isLast ? (
                    <span>{part}</span>
                ) : (
                    <a onClick={() => navigate(`/files/${encodeURIComponent(path)}`)} style={{ cursor: 'pointer' }}>
                        {part}
                    </a>
                ),
                key: path,
            };
        }),
    ];

    if (loading) return <Spin style={{ display: 'block', margin: '100px auto' }} />;
    if (error) return <AntdAlert message="Error" description={error} type="error" showIcon />;

    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            flexDirection: 'column',
            background: '#252525'
        }}>

            <div style={{
                background: '#252525',
                borderBottom: '1px solid #3d3d3d',
                paddingTop: 12,
                paddingBottom: 12,
                paddingRight: 16,
                paddingLeft: window.innerWidth <= 768 ? 60 : 16,
            }}>
                <Breadcrumb
                    items={breadcrumbItems}
                    separator="/"
                    style={{ paddingLeft: window.innerWidth <= 768 ? 0 : 0 }}
                />
            </div>

            {fileType === 'text' && content !== null && (
                <div
                    style={{
                        background: '#252525',
                        borderBottom: '1px solid #3d3d3d',
                        paddingTop: 12,
                        paddingBottom: 12,
                        paddingRight: 16,
                        paddingLeft: window.innerWidth <= 768 ? 60 : 16,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}
                >
                    <span style={{ color: '#ffffff', fontSize: '14px', fontWeight: 500 }}>
                        {isEditing ? 'Editing' : 'Preview'}
                    </span>
                    <div>
                        {isEditing ? (
                            <>
                                <Button
                                    type="primary"
                                    onClick={handleSave}
                                    style={{ marginRight: 8 }}
                                >
                                    Save
                                </Button>
                                <Button
                                    onClick={() => {
                                        setIsEditing(false);
                                        setEditedContent(content);
                                    }}
                                >
                                    Cancel
                                </Button>
                            </>
                        ) : (
                            <Button onClick={() => setIsEditing(true)}>Edit</Button>
                        )}
                    </div>
                </div>
            )}

            <div style={{
                flex: 1,
                overflow: 'hidden',
                background: '#202020',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
            }}>
                {fileType === 'pdf' && (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            background: '#2b2b2b',
                            overflow: 'hidden',
                        }}
                    >
                        <iframe
                            title="PDF Viewer"
                            src={previewSrc || ''}
                            style={{
                                width: '100%',
                                height: '100%',
                                border: 'none',
                            }}
                        />
                    </div>
                )}

                {fileType === 'image' && (
                    <img
                        src={previewSrc || ''}
                        alt={filename}
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            backgroundColor: '#202020',
                        }}
                    />
                )}

                {fileType === 'video' && (
                    <video
                        controls
                        preload="metadata"
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            backgroundColor: '#202020',
                        }}
                        src={previewSrc || ''}
                    />
                )}

                {fileType === 'audio' && (
                    <div
                        style={{
                            width: '100%',
                            maxWidth: '600px',
                            background: '#2b2b2b',
                            border: '1px solid #3d3d3d',
                            borderRadius: '4px',
                            padding: '32px',
                        }}
                    >
                        <audio
                            controls
                            preload="metadata"
                            style={{
                                width: '100%',
                                outline: 'none',
                            }}
                            src={previewSrc || ''}
                        >
                            Your browser does not support the audio element.
                        </audio>
                    </div>
                )}

                {fileType === 'text' && content !== null && (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            overflow: 'auto',
                            background: '#1e1e1e',
                            padding: '16px',
                        }}
                    >
                        {isEditing ? (
                            <TextArea
                                value={editedContent}
                                onChange={e => setEditedContent(e.target.value)}
                                autoSize={{ minRows: 30 }}
                                style={{
                                    fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                                    fontSize: 14,
                                    background: '#1e1e1e',
                                    border: 'none',
                                    color: '#ffffff',
                                    width: '100%',
                                    resize: 'none',
                                }}
                            />
                        ) : (
                            <SyntaxHighlighter
                                language={highlightLang}
                                style={vscDarkPlus}
                                customStyle={{
                                    background: '#1e1e1e',
                                    fontSize: 14,
                                    margin: 0,
                                    padding: 0,
                                }}
                                showLineNumbers
                                wrapLines
                            >
                                {content}
                            </SyntaxHighlighter>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};