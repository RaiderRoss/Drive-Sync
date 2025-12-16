import { useEffect, useState } from 'react';
import { Table, Typography, Spin, Button, message, Breadcrumb, Dropdown, Modal, Input, Upload as AntUpload } from 'antd';
import { DownloadOutlined, DeleteOutlined, FileFilled, FolderAddOutlined, UploadOutlined } from '@ant-design/icons';
import { FcFolder } from 'react-icons/fc';
import { FaFilePdf, FaFileAudio, FaFileImage, FaFileVideo, FaFileArchive, FaFileCode, FaFileWord, FaFileExcel, FaFilePowerpoint, FaFileAlt } from 'react-icons/fa';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import type { ColumnsType } from 'antd/es/table';
import type { MenuProps, UploadProps } from 'antd';
import { useRefresh } from '../contexts/RefreshContext';
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
    const { triggerRefresh } = useRefresh();

    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [contextMenuVisible, setContextMenuVisible] = useState(false);
    const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 });
    const [createFolderModalVisible, setCreateFolderModalVisible] = useState(false);
    const [folderName, setFolderName] = useState('');
    const [folderLoading, setFolderLoading] = useState(false);
    const API_BASE = '/api';
    const navigate = useNavigate();

    const fetchFiles = () => {
        setLoading(true);

        const url = directory
            ? `${API_BASE}/uploads/${encodeURIComponent(directory)}`
            : `${API_BASE}/uploads`;

        fetch(url, {
            headers: { Accept: 'application/json' },
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
    }, [directory]);

    const downloadFile = (filename: string) => {
        const link = document.createElement('a');
        link.href = `${API_BASE}/download/${encodeURIComponent(filename)}`;
        link.download = filename;
        link.click();
    };

    const deleteFile = async (_filename: string) => {
        // try {
        //     const res = await fetch(`${API_BASE}/download/${encodeURIComponent(filename)}`, {
        //         method: 'DELETE',
        //     });

        //     if (res.ok) {
        //         message.success(`Deleted: ${filename}`);
        //         fetchFiles();
        //     } else {
        //         message.error(`Failed to delete ${filename}`);
        //     }
        // } catch (error) {
        //     console.error('Delete error:', error);
        //     message.error('An error occurred while deleting the file.');
        // }
    };

    const currentPath = location.pathname.startsWith('/files')
        ? location.pathname.slice('/files'.length) || '/'
        : location.pathname;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenuPosition({ x: e.clientX, y: e.clientY });
        setContextMenuVisible(true);
    };

    const handleCreateFolder = async () => {
        if (!folderName.trim()) {
            return message.error('Folder name cannot be empty');
        }
        setFolderLoading(true);
        try {
            let basePath = currentPath === '/' ? '' : currentPath.replace(/\/$/, '');
            const segments = basePath.split('/').filter(Boolean).map(encodeURIComponent);
            segments.push(encodeURIComponent(folderName.trim()));
            const fullPath = segments.join('/');

            const res = await fetch(`${API_BASE}/create_folder/${fullPath}`, {
                method: 'POST',
            });

            if (res.ok) {
                message.success(`Folder "${folderName}" created`);
                setCreateFolderModalVisible(false);
                setFolderName('');
                fetchFiles();
                triggerRefresh(); // Refresh the sidebar tree
            } else {
                const text = await res.text();
                message.error(`Failed: ${text}`);
            }
        } catch (e) {
            message.error(`Error: ${(e as Error).message}`);
        } finally {
            setFolderLoading(false);
        }
    };

    const checkAllUploadsComplete = (fileList: any[]) => {
        const allDoneOrFailed = fileList.every(
            (file) => file.status === 'done' || file.status === 'error'
        );
        if (allDoneOrFailed) {
            fetchFiles();
            triggerRefresh(); // Refresh the sidebar tree after upload
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
                setCreateFolderModalVisible(true);
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
            width: 120,
            render: (_: any, record: FileEntry) => {
                if (record.is_dir) return null;
                const filePath = directory ? `${directory}/${record.name}` : record.name;
                return (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                            size="small"
                            type="text"
                            icon={<DownloadOutlined />}
                            onClick={(e) => {
                                e.stopPropagation();
                                downloadFile(filePath);
                            }}
                            style={{ color: '#b3b3b3' }}
                        />
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={(e) => {
                                e.stopPropagation();
                                deleteFile(filePath);
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
                    style={{ marginBottom: 12, fontSize: 14 }}
                />
            </div>

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

            {/* Create Folder Modal */}
            <Modal
                title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FolderAddOutlined style={{ fontSize: '18px', color: '#0078d4' }} />
                        <span style={{ fontSize: '16px', fontWeight: 500 }}>Create New Folder</span>
                    </div>
                }
                open={createFolderModalVisible}
                onOk={handleCreateFolder}
                onCancel={() => {
                    setCreateFolderModalVisible(false);
                    setFolderName('');
                }}
                confirmLoading={folderLoading}
                okText="Create"
                cancelText="Cancel"
                width={480}
                centered
                styles={{
                    body: {
                        paddingTop: '24px',
                        paddingBottom: '8px',
                    }
                }}
            >
                <div>
                    <Text style={{ 
                        color: '#b3b3b3', 
                        fontSize: '13px',
                        display: 'block',
                        marginBottom: '12px',
                        fontWeight: 400,
                    }}>
                        Enter a name for the new folder:
                    </Text>
                    <Input
                        placeholder="New folder"
                        value={folderName}
                        onChange={(e) => setFolderName(e.target.value)}
                        onPressEnter={handleCreateFolder}
                        autoFocus
                        size="large"
                        prefix={<FcFolder style={{ fontSize: '18px', marginRight: '4px' }} />}
                        style={{
                            fontSize: '14px',
                            height: '40px',
                            paddingLeft: '12px',
                            background: '#2b2b2b',
                            border: '1px solid #3d3d3d',
                        }}
                        className="folder-name-input"
                    />
                </div>
            </Modal>
        </div>
    );
};

export default Files;
