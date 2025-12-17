import { useEffect, useState } from 'react';
import { Table, Typography, Spin, Button, message, Breadcrumb, Dropdown, Modal, Input, Upload as AntUpload } from 'antd';
import { DownloadOutlined, DeleteOutlined, FileFilled, FolderAddOutlined, UploadOutlined } from '@ant-design/icons';
import { FcFolder } from 'react-icons/fc';
import { FaFilePdf, FaFileAudio, FaFileImage, FaFileVideo, FaFileArchive, FaFileCode, FaFileWord, FaFileExcel, FaFilePowerpoint, FaFileAlt } from 'react-icons/fa';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps, UploadProps } from 'antd';
import { useRefresh } from '../contexts/RefreshContext';
import UploadArea from '../Components/Upload';
const { Text } = Typography;

interface FileEntry {
    name: string;
    size?: number;
    is_dir: boolean;
    modified?: string;
}

const Files = () => {
    const params = useParams();
    const directory = params['*'];
    const location = useLocation();
    const { triggerRefresh, refreshTrigger } = useRefresh();

    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const API_BASE = '/api';
    const navigate = useNavigate();

    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [renameTarget, setRenameTarget] = useState<{ oldPath: string; isDir: boolean } | null>(null);

    const openRename = (oldPath: string, isDir: boolean) => {
        setRenameTarget({ oldPath, isDir });
        setRenameValue(oldPath.split('/').pop() || '');
        setRenameOpen(true);
    };

    const renameEntry = async () => {
        if (!renameTarget || !renameValue.trim()) return;

        const base = renameTarget.oldPath.split('/').slice(0, -1).join('/');
        const newPath = base ? `${base}/${renameValue}` : renameValue;

        const res = await fetch(`${API_BASE}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                old_path: renameTarget.oldPath,
                new_path: newPath,
            }),
        });

        if (res.ok) {
            message.success('Renamed.');
            setRenameOpen(false);
            fetchFiles();
            triggerRefresh();
        } else {
            message.error('Rename failed.');
        }
    };

    const fetchFiles = () => {
        setLoading(true);

        const url = directory
            ? `${API_BASE}/uploads/${encodeURIComponent(directory)}`
            : `${API_BASE}/uploads`;

        fetch(url, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        })
            .then(async res => {
                console.log('Response:', res);
                const text = await res.text();
                console.log('Response text:', text);
                const data = JSON.parse(text);
                setFiles(data);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to fetch or parse JSON:', err);
                message.error('Could not load files.');
                setLoading(false);
            });

    };

    useEffect(() => {
        fetchFiles();
    }, [directory, refreshTrigger]);

    const downloadFile = (filename: string) => {
        const link = document.createElement('a');
        link.href = `${API_BASE}/download/${encodeURIComponent(filename)}`;
        link.download = filename;
        link.click();
    };

    const deleteFile = async (filename: string) => {
        const path = `${API_BASE}/delete/${filename}`.replace(/\/+/g, '/');

        console.log("Deleting:", path);

        const res = await fetch(path, { method: 'DELETE' });

        if (res.ok) {
            message.success(`Deleted: ${filename}`);
            fetchFiles();
        } else {
            message.error(`Delete failed`);
        }
    };


    const currentPath = location.pathname.startsWith('/files')
        ? location.pathname.slice('/files'.length) || '/'
        : location.pathname;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    };

    const checkAllUploadsComplete = (fileList: any[]) => {
        const allDoneOrFailed = fileList.every(
            (file) => file.status === 'done' || file.status === 'error'
        );
        if (allDoneOrFailed) {
            fetchFiles();
            triggerRefresh();
        }
    };

    const uploadProps: UploadProps = {
        name: 'file',
        action: `${API_BASE}/upload${currentPath}`,
        headers: {
            authorization: 'authorization-text',
        },
        multiple: true,
        showUploadList: false,
        onChange(info) {
            if (info.file.status === 'done') {
                message.success(`${info.file.name} file uploaded successfully`);
            } else if (info.file.status === 'error') {
                message.error(`${info.file.name} file upload failed.`);
            }

            checkAllUploadsComplete(info.fileList);
        },
    };

    const contextMenuItems: MenuProps['items'] = [
        {
            key: 'createFolder',
            label: 'Create Folder',
            icon: <FolderAddOutlined />,
            onClick: () => {
                setContextMenuVisible(false);
            },
        },
        {
            key: 'uploadFile',
            label: (
                <AntUpload {...uploadProps}>
                    <span>Upload File</span>
                </AntUpload>
            ),
            icon: <UploadOutlined />,
        },
    ];

    useEffect(() => {
        const handleClick = () => setContextMenuVisible(false);
        document.addEventListener('click', handleClick);
        return () => document.removeEventListener('click', handleClick);
    }, []);

    if (loading) {
        return <Spin style={{ display: 'block', margin: '100px auto' }} />;
    }

    const pathParts = directory ? directory.split('/') : [];

    const breadcrumbItems = [
        {
            title: (
                <a
                    onClick={() => navigate('/files')}
                    style={{ cursor: 'pointer', userSelect: 'none' }}
                    aria-label="Go to root files directory"
                >
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
                    <a
                        onClick={() => navigate(`/files/${encodeURIComponent(path)}`)}
                        style={{ cursor: 'pointer', userSelect: 'none' }}
                        aria-label={`Go to ${path} directory`}
                    >
                        {part}
                    </a>
                ),
                key: path,
            };
        }),
    ];

    const formatDate = (dateString?: string) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'numeric',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    const formatSize = (bytes?: number) => {
        if (!bytes) return '-';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const getFileIcon = (filename: string) => {
        const ext = filename.toLowerCase().split('.').pop();

        // PDF files
        if (ext === 'pdf') {
            return <FaFilePdf style={{ fontSize: 16, color: '#ff0000' }} />;
        }

        // Audio files
        if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'aiff'].includes(ext || '')) {
            return <FaFileAudio style={{ fontSize: 16, color: '#9b59b6' }} />;
        }

        // Image files
        if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'tif'].includes(ext || '')) {
            return <FaFileImage style={{ fontSize: 16, color: '#3498db' }} />;
        }

        // Video files
        if (['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpeg', 'mpg'].includes(ext || '')) {
            return <FaFileVideo style={{ fontSize: 16, color: '#e74c3c' }} />;
        }

        // Archive files
        if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext || '')) {
            return <FaFileArchive style={{ fontSize: 16, color: '#f39c12' }} />;
        }

        // Code files
        if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'cs', 'php', 'rb', 'go', 'rs', 'html', 'css', 'json', 'xml', 'yaml', 'yml'].includes(ext || '')) {
            return <FaFileCode style={{ fontSize: 16, color: '#2ecc71' }} />;
        }

        // Word documents
        if (['doc', 'docx', 'odt', 'rtf'].includes(ext || '')) {
            return <FaFileWord style={{ fontSize: 16, color: '#2b579a' }} />;
        }

        // Excel documents
        if (['xls', 'xlsx', 'ods', 'csv'].includes(ext || '')) {
            return <FaFileExcel style={{ fontSize: 16, color: '#217346' }} />;
        }

        // PowerPoint documents
        if (['ppt', 'pptx', 'odp'].includes(ext || '')) {
            return <FaFilePowerpoint style={{ fontSize: 16, color: '#d24726' }} />;
        }

        // Text files
        if (['txt', 'md', 'log', 'cfg', 'ini', 'conf'].includes(ext || '')) {
            return <FaFileAlt style={{ fontSize: 16, color: '#95a5a6' }} />;
        }

        // Default file icon
        return <FileFilled style={{ fontSize: 16, color: '#b3b3b3' }} />;
    };

    const columns: ColumnsType<FileEntry> = [
        {
            title: 'Name',
            dataIndex: 'name',
            key: 'name',
            render: (name: string, record: FileEntry) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {record.is_dir ? (
                        <FcFolder style={{ fontSize: 20 }} />
                    ) : (
                        getFileIcon(name)
                    )}
                    <Text style={{ color: '#ffffff' }}>{name}</Text>
                </div>
            ),
            sorter: (a, b) => a.name.localeCompare(b.name),
        },
        {
            title: 'Date modified',
            dataIndex: 'modified',
            key: 'modified',
            render: (date: string) => (
                <Text style={{ color: '#b3b3b3' }}>{formatDate(date)}</Text>
            ),
            sorter: (a, b) => {
                const dateA = a.modified ? new Date(a.modified).getTime() : 0;
                const dateB = b.modified ? new Date(b.modified).getTime() : 0;
                return dateA - dateB;
            },
        },
        {
            title: 'Type',
            dataIndex: 'is_dir',
            key: 'type',
            render: (is_dir: boolean) => (
                <Text style={{ color: '#b3b3b3' }}>
                    {is_dir ? 'File folder' : 'File'}
                </Text>
            ),
            sorter: (a, b) => (a.is_dir === b.is_dir ? 0 : a.is_dir ? -1 : 1),
        },
        {
            title: 'Size',
            dataIndex: 'size',
            key: 'size',
            render: (size: number, record: FileEntry) => (
                <Text style={{ color: '#b3b3b3' }}>
                    {record.is_dir ? '-' : formatSize(size)}
                </Text>
            ),
            sorter: (a, b) => (a.size || 0) - (b.size || 0),
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 160,
            render: (_: any, record: FileEntry) => {
                const fullPath = directory ? `${directory}/${record.name}` : record.name;

                return (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, width: '100%' }}>
                        {!record.is_dir && (
                            <Button
                                size="small"
                                type="text"
                                icon={<DownloadOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    downloadFile(fullPath);
                                }}
                                style={{ color: '#b3b3b3' }}
                            />
                        )}

                        <Button
                            size="small"
                            type="text"
                            onClick={(e) => {
                                e.stopPropagation();
                                openRename(fullPath, record.is_dir);
                            }}
                        >
                            Rename
                        </Button>

                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                                e.stopPropagation();
                                deleteFile(fullPath);
                            }}
                            style={{ color: '#ff4d4f' }}
                        />
                    </div>
                );
            },
        },

    ];

    return (
        <div
            style={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                background: '#252525',
            }}
            onContextMenu={handleContextMenu}
        >
            {/* Windows Explorer-style Header */}
            <div style={{
                background: '#252525',
                borderBottom: '1px solid #2d2d2d',
                padding: '8px 16px 12px 16px',
            }}>
                <Breadcrumb
                    items={breadcrumbItems}
                    separator="/"
                    style={{
                        marginBottom: 12,
                        fontSize: 14,
                        paddingLeft: window.innerWidth <= 768 ? '60px' : '0',
                    }}
                />
            </div>

            <UploadArea fetchFiles={fetchFiles} />

            {/* File List/Table Area */}
            <div style={{
                flex: 1,
                overflow: 'auto',
                background: '#252525',
                padding: '0 16px',
            }}>
                <Table
                    columns={columns}
                    dataSource={files.map(file => ({ ...file, key: file.name }))}
                    pagination={false}
                    locale={{ emptyText: ' ' }}
                    onRow={(record) => ({
                        onClick: () => {
                            if (record.is_dir) {
                                const newPath = directory ? `${directory}/${record.name}` : record.name;
                                const encodedPath = newPath
                                    .split('/')
                                    .map(encodeURIComponent)
                                    .join('/');
                                navigate(`/files/${encodedPath}`);
                            } else {
                                const filePath = directory ? `${directory}/${record.name}` : record.name;
                                const encodedPath = filePath
                                    .split('/')
                                    .map(encodeURIComponent)
                                    .join('/');
                                navigate(`/file/${encodedPath}`);
                            }
                        },
                        style: { cursor: 'pointer' }
                    })}
                    style={{ background: '#252525' }}
                />
            </div>

            {/* Context Menu */}
            <Dropdown
                menu={{ items: contextMenuItems }}
                open={contextMenuVisible}
                onOpenChange={setContextMenuVisible}
            >
                <div
                    style={{
                        position: 'fixed',
                        left: contextMenuPosition.x,
                        top: contextMenuPosition.y,
                        width: 1,
                        height: 1,
                    }}
                />
            </Dropdown>

            <Modal
                title="Rename"
                open={renameOpen}
                onOk={renameEntry}
                onCancel={() => setRenameOpen(false)}
                okText="Rename"
                centered
            >
                <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={renameEntry}
                    autoFocus
                />
            </Modal>
        </div>
    );
};

export default Files;
