import { useEffect, useState } from 'react';
import { Button, Empty, Spin, Table, Tooltip } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import './admin.css';
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    CopyOutlined,
    DeleteOutlined,
    ShareAltOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { getAuthHeaders } from '../api/File';
import { useAlert } from '../Components/Alert';

interface ShareEntry {
    user_name: string;
    id: string;
    file_path: string;
    created_at: number;
}

interface AdminUser {
    id: string;
    username: string;
    is_admin: boolean;
}

const API_BASE = '/api';

const formatDate = (timestamp?: number) => {
    if (!timestamp) return '-';

    const date = new Date(timestamp * 1000);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${day}/${month}/${year} ${hours}:${minutes}`;
};

const timeAgo = (timestamp?: number) => {
    if (!timestamp) return '';

    const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
    if (seconds < 60) return 'just now';

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;

    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;

    const months = Math.floor(days / 30);
    if (months < 12) return `${months} mo ago`;

    return `${Math.floor(days / 365)} yr ago`;
};

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
        headers: {
            Accept: 'application/json',
            ...getAuthHeaders(),
        },
        cache: 'no-store',
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }

    const text = await res.text();
    if (!text.trim()) {
        return [] as T;
    }

    return JSON.parse(text) as T;
}

async function deleteUser(userId: string): Promise<void> {
    const url = `${API_BASE}/manage/delete/${encodeURIComponent(userId)}`;
    const res = await fetch(url, {
        method: 'DELETE',
        headers: getAuthHeaders(),
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
}

export default function Admin() {
    const navigate = useNavigate();
    const alert = useAlert();
    const { isAdmin, user_id } = useAuth();
    const [loading, setLoading] = useState(true);
    const [shares, setShares] = useState<ShareEntry[]>([]);
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [usersAvailable, setUsersAvailable] = useState(true);

    const loadDashboard = async () => {
        setLoading(true);
        try {
            const [sharesResult, usersResult] = await Promise.allSettled([
                fetchJson<ShareEntry[]>(`${API_BASE}/manage/shares`),
                fetchJson<AdminUser[]>(`${API_BASE}/manage/list`),
            ]);

            setShares(sharesResult.status === 'fulfilled' ? sharesResult.value : []);

            if (usersResult.status === 'fulfilled') {
                console.log('Fetched users:', usersResult.value);
                setUsers(usersResult.value);
                setUsersAvailable(true);
            } else {
                setUsers([]);
                setUsersAvailable(false);
            }
        } catch (err) {
            console.error('Failed to load admin dashboard:', err);
            alert.error('Could not load admin data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin === true) {
            loadDashboard();
        } else if (isAdmin === false) {
            setLoading(false);
        }
    }, [isAdmin]);

    useEffect(() => {
        const events = new EventSource('/api/events');

        events.addEventListener('connected', () => {
            console.log('SSE connected');
        });

        events.addEventListener('registered', (event) => {
            const data = JSON.parse(event.data);
            if (data.action === 'create') {
                setUsers(prev => [
                    ...prev,
                    {
                        id: data.user_id,
                        username: data.username,
                        is_admin: data.is_admin,
                    }
                ]);
            }

            if (data.action === 'delete') {
                setUsers(prev => prev.filter(user => user.id !== data.user_id));
            }
        });

        events.addEventListener('share_event', (event) => {
            const data = JSON.parse(event.data);
            if (data.action === 'delete') {
                setShares(prev => prev.filter(share => share.id !== data.share_id));
            }
            if (data.action === 'create') {
                setShares(prev => [
                    ...prev,
                    {
                        user_name: data.created_by,
                        id: data.share_id,
                        file_path: data.file_path,
                        created_at: Number(data.created_at),
                    }
                ]);
            }
        });

        events.onerror = (error) => {
            console.error('SSE connection error:', error);
        };

        return () => {
            events.close();
        };
    }, [isAdmin]);

    const copyToClipboard = async (value: string, label: string) => {
        try {
            await navigator.clipboard.writeText(value);
            alert.success(`${label} copied to clipboard.`);
        } catch (err) {
            console.error('Copy failed:', err);
            alert.error('Could not copy value.');
        }
    };

    const userColumns: ColumnsType<AdminUser> = [
        {
            title: 'User',
            dataIndex: 'username',
            key: 'username',
            render: (username: string, record: AdminUser) => (
                <div className="admin-user">
                    <span className="admin-user__name">{username}</span>
                    {record.is_admin && <span className="admin-tag">admin</span>}
                    {record.id === user_id && <span className="admin-note">you</span>}
                </div>
            ),
        },
        {
            title: 'User ID',
            dataIndex: 'id',
            key: 'id',
            render: (id: string) => (
                <div className="admin-id">
                    <code>{id}</code>
                    <Tooltip title="Copy ID">
                        <Button
                            type="text"
                            size="small"
                            className="admin-icon-btn admin-reveal"
                            icon={<CopyOutlined />}
                            onClick={(e) => {
                                e.stopPropagation();
                                copyToClipboard(id, 'User ID');
                            }}
                        />
                    </Tooltip>
                </div>
            ),
        },
        {
            title: '',
            key: 'action',
            width: 56,
            align: 'right',
            render: (_: unknown, record: AdminUser) => {
                const disabled = record.id === user_id;

                return (
                    <Tooltip title={disabled ? "You can't delete your own account" : 'Delete user'}>
                        <span className="admin-reveal">
                            <Button
                                size="small"
                                type="text"
                                disabled={disabled}
                                className="admin-icon-btn admin-icon-btn--danger"
                                icon={<DeleteOutlined />}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    deleteUser(record.id);
                                    setUsers(prev => prev.filter(user => user.id !== record.id));
                                }}
                            />
                        </span>
                    </Tooltip>
                );
            },
        },
    ];

    const shareColumns: ColumnsType<ShareEntry> = [
        {
            title: 'File',
            dataIndex: 'file_path',
            key: 'file_path',
            render: (filePath: string) => (
                <span className="admin-path" title={filePath}>
                    {filePath}
                </span>
            ),
        },
        {
            title: 'Shared by',
            dataIndex: 'user_name',
            key: 'user_name',
            width: 160,
        },
        {
            title: 'Created',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 160,
            render: (createdAt: number) => <span title={timeAgo(createdAt)}>{formatDate(createdAt)}</span>,
        },
        {
            title: '',
            key: 'link',
            width: 100,
            align: 'right',
            render: (_: unknown, record: ShareEntry) => (
                <Button
                    type="link"
                    className="admin-link-btn"
                    onClick={() => copyToClipboard(`${window.location.origin}/share/${record.id}`, 'Share link')}
                >
                    Copy link
                </Button>
            ),
        },
    ];

    if (isAdmin === null || loading) {
        return (
            <div className="admin-page admin-page--center">
                <Spin size="large" />
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div className="admin-page admin-page--center">
                <div className="admin-gate">
                    <p className="admin-gate__label">Access restricted</p>
                    <h1 className="admin-gate__title">Admin access required</h1>
                    <p className="admin-gate__text">
                        You do not have admin permissions. Only admin users can open this page.
                    </p>
                    <div className="admin-gate__actions">
                        <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate('/files')}>
                            Go to files
                        </Button>
                        <Button icon={<ShareAltOutlined />} onClick={() => navigate('/shares')}>
                            View shared files
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    const adminCount = users.filter(user => user.is_admin).length;
    const latestShare = shares.reduce((latest, share) => Math.max(latest, share.created_at || 0), 0);
    const sortedShares = [...shares].sort((a, b) => b.created_at - a.created_at);

    return (
        <div className="admin-page">
            <div className="admin-shell">
                <Button
                    type="text"
                    className="admin-back"
                    icon={<ArrowLeftOutlined />}
                    onClick={() => navigate(-1)}
                >
                    Back
                </Button>

                <h1 className="admin-title">Dashboard</h1>

                <div className="admin-summary">
                    <div className="admin-summary__item">
                        <span className="admin-summary__label">Users</span>
                        <span className="admin-summary__value">{users.length}</span>
                    </div>
                    <div className="admin-summary__item">
                        <span className="admin-summary__label">Admins</span>
                        <span className="admin-summary__value">{adminCount}</span>
                    </div>
                    <div className="admin-summary__item">
                        <span className="admin-summary__label">Shared links</span>
                        <span className="admin-summary__value">{shares.length}</span>
                    </div>
                    <div className="admin-summary__item">
                        <span className="admin-summary__label">Last shared</span>
                        <span className="admin-summary__value admin-summary__value--text">
                            {latestShare ? timeAgo(latestShare) : '—'}
                        </span>
                    </div>
                </div>

                <section className="admin-section">
                    <div className="admin-section__head">
                        <h2 className="admin-section__title">Users</h2>
                        <span className="admin-section__count">{users.length}</span>
                    </div>

                    <div className="admin-box">
                        {users.length > 0 ? (
                            <Table
                                columns={userColumns}
                                dataSource={users}
                                rowKey="id"
                                pagination={false}
                                size="middle"
                                scroll={{ x: 'max-content' }}
                                onRow={(record) => ({
                                    onClick: () => navigate(`/files/${record.id}`),
                                })}
                                rowClassName={() => 'admin-row admin-row--clickable'}
                            />
                        ) : (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={
                                    usersAvailable
                                        ? 'No users returned by the management endpoint yet.'
                                        : 'User management is not wired up on the backend yet.'
                                }
                                className="admin-empty"
                            />
                        )}
                    </div>
                </section>

                <section className="admin-section">
                    <div className="admin-section__head">
                        <h2 className="admin-section__title">Shared links</h2>
                        <span className="admin-section__count">{shares.length}</span>
                    </div>

                    <div className="admin-box">
                        {shares.length > 0 ? (
                            <Table
                                columns={shareColumns}
                                dataSource={sortedShares}
                                rowKey="id"
                                pagination={false}
                                size="middle"
                                scroll={{ x: 'max-content' }}
                                rowClassName={() => 'admin-row'}
                            />
                        ) : (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description="No shared links found for the current account."
                                className="admin-empty"
                            />
                        )}
                    </div>
                </section>
            </div>
        </div>
    );
}