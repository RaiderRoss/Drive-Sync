import { useEffect, useState } from 'react';
import { Button, Dropdown, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { FcFolder, FcOpenedFolder } from 'react-icons/fc';
import { useNavigate, useLocation } from 'react-router-dom';
import { useRefresh } from '../contexts/RefreshContext';
import { FaAngleDown, FaFileAlt, FaSignOutAlt, FaLink } from 'react-icons/fa';
import { HiPlus } from 'react-icons/hi';
import { getAuthHeaders } from '../api/File';

interface FileEntry {
    name: string;
    is_dir: boolean;
    path?: string;
}

interface SidebarProps {
    onLinkClick?: () => void;
}

const Sidebar = ({ onLinkClick }: SidebarProps) => {
    const navigate = useNavigate();
    const location = useLocation();
    const { refreshTrigger, triggerRefresh } = useRefresh();
    const [treeData, setTreeData] = useState<DataNode[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<string[]>(['root']);
    const [loadedKeys, setLoadedKeys] = useState<string[]>([]);
    const API_BASE = '/api';


    const buildTreeNode = (file: FileEntry, parentPath: string = ''): DataNode => {
        const fullPath = parentPath ? `${parentPath}/${file.name}` : file.name;
        return {
            title: file.name,
            key: fullPath,
            icon: ({ expanded }: any) => expanded ? <FcOpenedFolder /> : <FcFolder />,
            isLeaf: !file.is_dir,
            children: file.is_dir ? [] : undefined,
        };
    };

    const fetchRootFiles = async () => {
        try {
            const res = await fetch(`${API_BASE}/uploads`, {
                headers: {
                    Accept: 'application/json',
                    ...getAuthHeaders(),
                },
            });
            const data: FileEntry[] = await res.json();
            const folders = data.filter(f => f.is_dir);

            const nodes: DataNode[] = folders.map(folder => buildTreeNode(folder, ''));
            setTreeData([
                {
                    title: 'Files',
                    key: 'root',
                    icon: <FcFolder />,
                    children: nodes,
                }
            ]);
        } catch (err) {
            console.error('Failed to fetch files:', err);
        }
    };

    useEffect(() => {
        fetchRootFiles();
    }, []);

    useEffect(() => {
        if (refreshTrigger > 0) {
            const currentPath = location.pathname.replace(/^\/files\/?/, '');
            if (currentPath) {
                const decodedPath = decodeURIComponent(currentPath);
                reloadFolder(decodedPath);
            } else {
                fetchRootFiles();
            }
        }
    }, [refreshTrigger]);

    const reloadFolder = async (folderPath: string) => {
        try {
            const encodedPath = folderPath
                .split('/')
                .filter(Boolean)
                .map(encodeURIComponent)
                .join('/');
            const url = `${API_BASE}/uploads/${encodedPath}`;
            const res = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    ...getAuthHeaders(),
                },
                cache: 'no-store',
            });
            const data: FileEntry[] = await res.json();
            const folders = data.filter(f => f.is_dir);

            const childNodes = folders.map(folder => buildTreeNode(folder, folderPath));

            setTreeData(prevData => {
                const updateNode = (nodes: DataNode[]): DataNode[] => {
                    return nodes.map(n => {
                        if (n.key === folderPath) {
                            return { ...n, children: childNodes };
                        }
                        if (n.children) {
                            return { ...n, children: updateNode(n.children) };
                        }
                        return n;
                    });
                };
                return updateNode(prevData);
            });
        } catch (err) {
            console.error('Failed to reload folder:', err);
        }
    };

    const fetchFiles = async () => {
        if (currentPath) {
            const decodedPath = decodeURIComponent(currentPath);
            await reloadFolder(decodedPath);
        } else {
            await fetchRootFiles();
        }
    };

    useEffect(() => {

        if (!location.pathname.startsWith('/files')) {
            return;
        }

        const currentPath = location.pathname.replace(/^\/files\/?/, '');
        if (currentPath) {
            const decodedPath = decodeURIComponent(currentPath);
            const pathParts = decodedPath.split('/');
            const keysToExpand = ['root'];

            let accumulatedPath = '';
            for (let i = 0; i < pathParts.length; i++) {
                accumulatedPath = accumulatedPath ? `${accumulatedPath}/${pathParts[i]}` : pathParts[i];
                keysToExpand.push(accumulatedPath);
            }

            const loadParentFolders = async () => {
                for (let i = 0; i < keysToExpand.length - 1; i++) {
                    const key = keysToExpand[i];
                    if (!loadedKeys.includes(key)) {
                        await onLoadData({ key, children: [] });
                    }
                }
                setExpandedKeys(keysToExpand);
            };

            loadParentFolders();
        } else {
            setExpandedKeys(['root']);
        }
    }, [location.pathname]);

    const onLoadData = async (node: any): Promise<void> => {
        const path = node.key === 'root' ? '' : node.key;

        if (node.children && node.children.length > 0) {
            return;
        }

        try {
            const url = path
                ? `${API_BASE}/uploads/${path
                    .split('/')
                    .filter(Boolean)
                    .map(encodeURIComponent)
                    .join('/')}`
                : `${API_BASE}/uploads`;

            const res = await fetch(url, {
                headers: {
                    Accept: 'application/json',
                    ...getAuthHeaders(),
                },
                cache: 'no-store',
            });
            const data: FileEntry[] = await res.json();
            const folders = data.filter(f => f.is_dir);

            const childNodes = folders.map(folder => buildTreeNode(folder, path));

            setTreeData(prevData => {
                const updateNode = (nodes: DataNode[]): DataNode[] => {
                    return nodes.map(n => {
                        if (n.key === node.key) {
                            return { ...n, children: childNodes };
                        }
                        if (n.children) {
                            return { ...n, children: updateNode(n.children) };
                        }
                        return n;
                    });
                };
                return updateNode(prevData);
            });

            setLoadedKeys([...loadedKeys, node.key]);
        } catch (err) {
            console.error('Failed to load folder:', err);
        }
    };

    const onSelect = (selectedKeys: any[]) => {
        if (selectedKeys.length > 0) {
            const key = selectedKeys[0];
            if (key === 'root') {
                navigate('/files');
            } else {
                const encodedPath = key
                    .split('/')
                    .map(encodeURIComponent)
                    .join('/');
                navigate(`/files/${encodedPath}`);
            }
            if (onLinkClick) {
                onLinkClick();
            }
        }
    };

    const onExpand = (expandedKeysValue: any[]) => {
        setExpandedKeys(expandedKeysValue);
    };
    const onCreateFolder = async () => {
        const basePath = currentPath === '/' ? '' : currentPath.replace(/\/$/, '');
        const fullPath = `${basePath}/New folder`.replace(/^\/+/, '');

        const res = await fetch(`/api/create_path/${fullPath}/`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });

        if (res.ok) {
            triggerRefresh();
            await fetchFiles();
        } else {
            console.error(await res.text());
        }
    };

    const onCreateFile = async () => {
        const basePath = currentPath === '/' ? '' : currentPath.replace(/\/$/, '');
        const fullPath = `${basePath}/New file.txt`.replace(/^\/+/, '');

        const res = await fetch(`/api/create_path/${fullPath}`, {
            method: 'POST',
            headers: getAuthHeaders(),
        });

        if (res.ok) {
            triggerRefresh();
            await fetchFiles();
        } else {
            console.error(await res.text());
        }
    };

    const logout = () => {
        localStorage.removeItem('token');
        navigate('/login');
    }

    const goToSharedFiles = () => {
        navigate('/shares');
        if (onLinkClick) {
            onLinkClick();
        }
    };

    const currentPath = location.pathname.startsWith('/files')
        ? location.pathname.replace(/^\/files\/?/, '')
        : '';
    const selectedKeys = currentPath ? [decodeURIComponent(currentPath)] : location.pathname.startsWith('/files') ? ['root'] : [];

    return (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1c1c1c' }}>
            <div
                style={{
                    borderBottom: '1px solid #2d2d2d',
                    userSelect: 'none',
                    background: '#1c1c1c',
                    padding: '14px 12px 10px',
                }}
            >

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>

                    <Dropdown
                        trigger={['click']}
                        placement="bottomLeft"
                        menu={{
                            items: [
                                {
                                    key: 'folder',
                                    icon: <FcFolder size={22} />,
                                    label: <span style={{ fontSize: 16 }}>New Folder</span>,
                                    onClick: onCreateFolder
                                },
                                {
                                    key: 'file',
                                    icon: <FaFileAlt style={{ fontSize: 20, color: '#95a5a6' }} />,
                                    label: <span style={{ fontSize: 16 }}>New File</span>,
                                    onClick: onCreateFile
                                },
                            ],
                        }}
                    >
                        <Button
                            type="primary"
                            size="small"
                            shape="round"
                            style={{
                                fontSize: 12,
                                fontWeight: 600,
                                height: 28,
                                padding: '0 12px 0 10px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                flex: 1,
                                justifyContent: 'center',
                                border: 'none',
                            }}
                        >
                            <HiPlus size={13} />
                            New
                            <FaAngleDown size={8} style={{ opacity: 0.7 }} />
                        </Button>
                    </Dropdown>

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            paddingLeft: 10,
                            borderLeft: '1px solid #2d2d2d',
                        }}
                    >
                        <Button
                            type="text"
                            size="small"
                            shape="circle"
                            title="Shared files"
                            onClick={goToSharedFiles}
                            style={{
                                width: 28,
                                height: 28,
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(124, 134, 245, 0.12)',
                            }}
                        >
                            <span
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '100%',
                                    height: '100%',
                                    color: '#8d94f2',
                                }}
                            >
                                <FaLink size={12} />
                            </span>
                        </Button>
                        <Button
                            type="text"
                            size="small"
                            shape="circle"
                            title="Log out"
                            onClick={logout}
                            style={{
                                width: 28,
                                height: 28,
                                padding: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(231, 76, 60, 0.12)',
                            }}
                        >
                            <span
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: '100%',
                                    height: '100%',
                                    color: '#e74c3c',
                                }}
                            >
                                <FaSignOutAlt size={12} />
                            </span>
                        </Button>
                    </div>
                </div>
            </div>
            <div style={{
                marginTop: 10,
                flex: 1,
                overflow: 'auto',
                background: '#1c1c1c',
            }}>
                <Tree
                    showIcon
                    loadData={onLoadData}
                    treeData={treeData}
                    onSelect={onSelect}
                    onExpand={onExpand}
                    expandedKeys={expandedKeys}
                    selectedKeys={selectedKeys}
                    style={{
                        background: '#1c1c1c',
                        color: '#ffffff',
                    }}
                    className="folder-tree"
                />
            </div>
        </div>
    );
};

export default Sidebar;