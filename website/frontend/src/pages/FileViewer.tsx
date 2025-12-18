import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Spin, Alert, Breadcrumb, Input, Button, message } from 'antd';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

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

const FileViewer = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const rawPath = location.pathname.replace(/^\/file\//, '');
    const filename = decodeURIComponent(rawPath);

    const [content, setContent] = useState<string | null>(null);
    const [editedContent, setEditedContent] = useState<string>('');
    const [fileType, setFileType] = useState<string | null>(null);
    const [highlightLang, setHighlightLang] = useState<string>('text');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isEditing, setIsEditing] = useState(false);

    const API_BASE = '/api';
    const fileUrl = `${API_BASE}/download/${encodeURIComponent(filename)}`;
    const videoUrl = `${API_BASE}/stream/${encodeURIComponent(filename)}`;

    useEffect(() => {
        const ext = filename.split('.').pop()?.toLowerCase();

        if (!ext) {
            setFileType('text');
            setHighlightLang('text');
        } else if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'].includes(ext)) {
            setFileType('image');
            setLoading(false);
            return;
        } else if (['mp4', 'webm', 'mkv', 'avi'].includes(ext)) {
            setFileType('video');
            setLoading(false);
            return;
        } else if (['mp3', 'wav', 'ogg'].includes(ext)) {
            setFileType('audio');
            setLoading(false);
            return;

        }
        else if (ext === 'pdf') {
            setFileType('pdf');
            setLoading(false);
            return;
        } else {
            setFileType('text');
            setHighlightLang(extensionToLanguage[ext] || extensionToLanguage.default);
        }

        fetch(fileUrl)
            .then(res => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then(data => {
                setContent(data);
                setEditedContent(data);
            })
            .catch(err => {
                console.error('Text fetch error:', err);
                setError('Could not load file content.');
            })
            .finally(() => setLoading(false));

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
            });

            console.log('Save response:', res);
            if (res.ok) {
                message.success('File saved successfully');
                setContent(editedContent);
                setIsEditing(false);
            } else {
                message.error(`Save failed: ${res.status}`);
            }
        } catch (err) {
            console.error('Save error:', err);
            message.error('Save failed');
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
    if (error) return <Alert message="Error" description={error} type="error" showIcon />;

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
                            src={fileUrl}
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
                        src={fileUrl}
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
                        style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            backgroundColor: '#202020',
                        }}
                        src={videoUrl}
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
                            style={{
                                width: '100%',
                                outline: 'none',
                            }}
                            src={videoUrl}
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

export default FileViewer;
