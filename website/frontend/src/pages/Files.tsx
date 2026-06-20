import { useEffect, useState } from 'react';
import { Table, Typography, Spin, Button, Breadcrumb, Dropdown, Modal, Input, Upload as AntUpload, Popover, Space } from 'antd';
import { DownloadOutlined, DeleteOutlined, FileFilled, FolderAddOutlined, UploadOutlined, SendOutlined, LinkOutlined, UserOutlined, EditOutlined } from '@ant-design/icons';
import { FcFolder } from 'react-icons/fc';
import { FaFilePdf, FaFileAudio, FaFileImage, FaFileVideo, FaFileArchive, FaFileCode, FaFileWord, FaFileExcel, FaFilePowerpoint, FaFileAlt } from 'react-icons/fa';
import { useNavigate, useLocation } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps, UploadProps } from 'antd';
import { useRefresh } from '../contexts/RefreshContext';
import UploadArea from '../Components/Upload';
import * as FileAPI from '../api/File';
import { downloadFileApi } from '../api/File';
import { useAlert } from '../Components/Alert';
const { Text } = Typography;

interface FileEntry {
    name: string;
    size?: number;
    is_dir: boolean;
    date_modified?: number;
    file_type?: string;
}

export default function Files() {
    const location = useLocation();
    const { triggerRefresh, refreshTrigger } = useRefresh();
    const alert = useAlert();

    const directory = location.pathname.startsWith('/files/')
        ? decodeURIComponent(location.pathname.replace(/^\/files\/?/, '')) || undefined
        : undefined;

    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
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
        try {
            await FileAPI.renameEntryApi(renameTarget.oldPath, newPath);
            alert.success('Renamed.');
            setRenameOpen(false);
            fetchFiles();
            triggerRefresh();
        } catch (err) {
            console.error('Rename failed', err);
            alert.error('Rename failed.');
        }
    };

    const createShareLink = async (filePath: string) => {
        try {
            console.log('Creating share link for:', filePath);
            let link = await FileAPI.createShareLink(filePath);
            const fullLink = `${window.location.origin}/share/${link}`;
            console.log('Share link created:', fullLink);
            await navigator.clipboard.writeText(fullLink);
            alert.success('Share link created and copied to clipboard!');
        } catch (err) {
            console.error('Failed to create share link', err);
            alert.error('Failed to create share link.');
        }
    };

    const fetchFiles = async () => {
        setLoading(true);
        try {
            const data = await FileAPI.fetchFiles(directory || undefined);
            setFiles(data);
        } catch (err) {
            console.error('Failed to fetch or parse JSON:', err);
            alert.error('Could not load files.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchFiles();
    }, [directory, refreshTrigger]);

    const deleteFile = async (filename: string) => {
        try {
            await FileAPI.deleteFileApi(filename);
            alert.success(`Deleted: ${filename}`);
            fetchFiles();
        } catch (err) {
            console.error('Delete failed', err);
            alert.error(`Delete failed`);
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
        action: FileAPI.uploadAction(currentPath),
        headers: FileAPI.getAuthHeaders(),
        multiple: true,
        showUploadList: false,
        onChange(info) {
            if (info.file.status === 'done') {
                alert.success(`${info.file.name} file uploaded successfully`);
            } else if (info.file.status === 'error') {
                alert.error(`${info.file.name} file upload failed.`);
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

    const formatDate = (timestamp?: number) => {
        if (!timestamp) return '-';

        const date = new Date(timestamp * 1000);
        const day = date.getDate();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');

        return `${day}/${month}/${year} ${hours}:${minutes}`;
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

    const compareByName = (a: FileEntry, b: FileEntry) =>
        a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

    const getType = (entry: FileEntry) => entry.file_type || (entry.is_dir ? 'folder' : 'file');

    const compareByType = (a: FileEntry, b: FileEntry) =>
        getType(a).localeCompare(getType(b), undefined, { numeric: true, sensitivity: 'base' });

    const compareByDateModified = (a: FileEntry, b: FileEntry) =>
        (a.date_modified || 0) - (b.date_modified || 0);

    const compareBySize = (a: FileEntry, b: FileEntry) => (a.size || 0) - (b.size || 0);

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
            sorter: {
                compare: compareByName,
                multiple: 1,
            },
            defaultSortOrder: 'ascend',
        },
        {
            title: 'Date modified',
            dataIndex: 'date_modified',
            key: 'modified',
            render: (date: number) => (
                <Text style={{ color: '#b3b3b3' }}>{formatDate(date)}</Text>
            ),
            sorter: {
                compare: compareByDateModified,
                multiple: 2,
            },
        },
        {
            title: 'Type',
            dataIndex: 'file_type',
            key: 'type',
            render: (_type: string, record: FileEntry) => (
                <Text style={{ color: '#b3b3b3' }}>
                    {record.file_type || (record.is_dir ? 'folder' : 'file')}
                </Text>
            ),
            sorter: {
                compare: compareByType,
                multiple: 3,
            },
            defaultSortOrder: 'ascend',
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
            sorter: {
                compare: compareBySize,
                multiple: 2,
            },
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 100,
            render: (_: any, record: FileEntry) => {
                const fullPath = directory ? `${directory}/${record.name}` : record.name;

                return (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, width: '100%' }}>
                        {!record.is_dir && (
                            <>


                                <Button
                                    size="small"
                                    type="text"
                                    icon={<DownloadOutlined style={{ color: "#7782b4" }} />}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        downloadFileApi(fullPath);
                                    }}
                                    style={{ color: '#b3b3b3' }}
                                />


                                <Popover
                                    overlayStyle={{
                                        "--antd-arrow-background-color": "#313131",
                                    } as React.CSSProperties}
                                    trigger="click"
                                    placement="bottomRight"
                                    styles={{
                                        body: {
                                            background: "#313131",
                                            color: "#fff",
                                        },
                                    }}
                                    content={
                                        <Space direction="vertical" style={{ width: 160 }}>
                                            <Button
                                                block
                                                icon={<LinkOutlined />}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    createShareLink(fullPath);
                                                }}
                                            >
                                                Create Link
                                            </Button>

                                            <Button
                                                block
                                                icon={<UserOutlined />}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                }}
                                            >
                                                Send to User
                                            </Button>
                                        </Space>
                                    }>
                                    <Button
                                        size="small"
                                        type="text"
                                        icon={<SendOutlined style={{ color: '#9acc81' }} />}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                        }}
                                    />
                                </Popover>
                            </>

                        )}

                        <Button
                            size="small"
                            type="text"
                            icon={<EditOutlined style={{ color: "#f5a524" }} />}
                            onClick={(e) => {
                                e.stopPropagation();
                                openRename(fullPath, record.is_dir);
                            }}
                        >

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




                    </div >
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

            <UploadArea fetchFiles={fetchFiles} currentPath={currentPath} />

            <div style={{
                flex: 1,
                overflow: 'auto',
                background: '#252525',
                padding: '10px 16px',
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