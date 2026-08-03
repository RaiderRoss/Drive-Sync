import { useEffect, useState } from 'react';
import { Button, Card, Empty, Spin, Table, Tag, Typography, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
    CopyOutlined,
    ShareAltOutlined,
    TeamOutlined,
    ArrowRightOutlined,
    DeleteOutlined,
    ReloadOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../contexts/AuthContext';
import { getAuthHeaders } from '../api/File';
import { useAlert } from '../Components/Alert';

const { Title, Text, Paragraph } = Typography;

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

const panelStyle: React.CSSProperties = {
    background: '#1f1f1f',
    border: '1px solid #2d2d2d',
    borderRadius: 16,
    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.22)',
};

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
            title: 'Username',
            dataIndex: 'username',
            key: 'username',
            render: (username: string) => <Text style={{ color: '#ffffff' }}>{username}</Text>,
        },
        {
            title: 'User ID',
            dataIndex: 'id',
            key: 'id',
            render: (id: string) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: '#b3b3b3' }}>{id}</Text>
                    <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => copyToClipboard(id, 'User ID')}
                    />
                </div>
            ),
        },
        {
            title: 'Action',
            key: 'action',
            width: 120,
            render: (_: any, record: AdminUser) => {
                const disabled = record.id === user_id;

                return (
                    <Button
                        size="small"
                        type="text"
                        disabled={disabled}
                        icon={
                            <DeleteOutlined
                                style={{
                                    color: disabled ? '#6b6b6b' : '#ff4d4f',
                                }}
                            />
                        }
                        onClick={(e) => {
                            e.stopPropagation();
                            deleteUser(record.id)
                        }}
                    />
                );
            },
        },
    ];

    const shareColumns: ColumnsType<ShareEntry> = [
        {
            title: 'User Name',
            dataIndex: 'user_name',
            key: 'user_name',
            render: (user_name: string) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: '#b3b3b3' }}>{user_name}</Text>
                </div>
            )
        },
        {
            title: 'Shared file',
            dataIndex: 'file_path',
            key: 'file_path',
            render: (filePath: string) => <Text style={{ color: '#ffffff' }}>{filePath}</Text>,
        },
        {
            title: 'Created',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 180,
            render: (createdAt: number) => <Text style={{ color: '#b3b3b3' }}>{formatDate(createdAt)}</Text>,
        },
        {
            title: 'Link',
            key: 'link',
            width: 110,
            render: (_: unknown, record: ShareEntry) => (
                <Button
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => copyToClipboard(`${window.location.origin}/share/${record.id}`, 'Share link')}
                >
                    Copy
                </Button>
            ),
        },
    ];

    if (isAdmin === null || loading) {
        return (
            <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', background: '#252525' }}>
                <Spin />
            </div>
        );
    }

    if (!isAdmin) {
        return (
            <div
                style={{
                    minHeight: '100%',
                    background: '#252525',
                    padding: 24,
                    display: 'grid',
                    placeItems: 'center',
                }}
            >
                <Card style={{ ...panelStyle, width: 'min(720px, 100%)' }}>
                    <Space direction="vertical" size={18} style={{ width: '100%' }}>
                        <Tag color="red" style={{ width: 'fit-content', margin: 0 }}>
                            Access restricted
                        </Tag>
                        <Title level={2} style={{ color: '#ffffff', margin: 0 }}>
                            Admin access required
                        </Title>
                        <Paragraph style={{ color: '#b3b3b3', marginBottom: 0 }}>
                            You do not have admin permissions.
                            Only admin users can open this page.
                        </Paragraph>
                        <Space wrap>
                            <Button type="primary" icon={<ArrowRightOutlined />} onClick={() => navigate('/files')}>
                                Go to files
                            </Button>
                            <Button icon={<ShareAltOutlined />} onClick={() => navigate('/shares')}>
                                View shared files
                            </Button>
                        </Space>
                    </Space>
                </Card>
            </div>
        );
    }

    return (
        <div style={{ minHeight: '100%', background: '#1c1c1e', padding: '32px 32px 48px' }}>

            <div style={{ marginBottom: 28 }}>
                <Title level={3} style={{ color: '#ffffff', margin: 0, fontWeight: 600, letterSpacing: -0.3 }}>
                    Dashboard
                </Title>
                <Text style={{ color: '#7a7a7e', fontSize: 14 }}>
                    Overview of shared links and user access.
                </Text>
            </div>

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: 16,
                    marginBottom: 24,
                }}
            >
                <Card
                    style={{
                        ...panelStyle,
                        minHeight: 132,
                        border: '1px solid #2d2d30',
                        borderRadius: 12,
                    }}
                    bodyStyle={{ padding: 20 }}
                >
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space size={8} align="center">
                            <ShareAltOutlined style={{ color: '#5b8def', fontSize: 15 }} />
                            <Text style={{ color: '#9a9aa2', fontSize: 13, fontWeight: 500 }}>
                                SHARED LINKS
                            </Text>
                        </Space>
                        <Title level={2} style={{ color: '#ffffff', margin: 0, fontWeight: 600 }}>
                            {shares.length}
                        </Title>
                        <Text style={{ color: '#7a7a7e', fontSize: 13 }}>
                            Active links, copyable or revocable from the shared files view.
                        </Text>
                    </Space>
                </Card>

                <Card
                    style={{
                        ...panelStyle,
                        minHeight: 132,
                        border: '1px solid #2d2d30',
                        borderRadius: 12,
                    }}
                    bodyStyle={{ padding: 20 }}
                >
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space size={8} align="center">
                            <TeamOutlined style={{ color: '#5b8def', fontSize: 15 }} />
                            <Text style={{ color: '#9a9aa2', fontSize: 13, fontWeight: 500 }}>
                                USERS
                            </Text>
                        </Space>
                        <Title level={2} style={{ color: '#ffffff', margin: 0, fontWeight: 600 }}>
                            {users.length}
                        </Title>
                        <Text style={{ color: '#7a7a7e', fontSize: 13 }}>
                            {usersAvailable ? 'Loaded from the management endpoint.' : 'Management endpoint is not available yet.'}
                        </Text>
                    </Space>
                </Card>

                <Card
                    style={{
                        ...panelStyle,
                        minHeight: 132,
                        border: '1px solid #2d2d30',
                        borderRadius: 12,
                    }}
                    bodyStyle={{ padding: 20 }}
                >
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Space size={8} align="center">
                            <UserOutlined style={{ color: '#5b8def', fontSize: 15 }} />
                            <Text style={{ color: '#9a9aa2', fontSize: 13, fontWeight: 500 }}>
                                SIGNED IN AS
                            </Text>
                        </Space>
                        <Title level={4} style={{ color: '#ffffff', margin: 0, fontWeight: 600 }}>
                            {user_id || 'Unknown user'}
                        </Title>
                        <Text style={{ color: '#7a7a7e', fontSize: 13 }}>Admin permissions enabled.</Text>
                    </Space>
                </Card>
            </div>

            <Card
                title={<span style={{ color: '#ffffff', fontWeight: 600, fontSize: 15 }}>All users</span>}
                style={{ ...panelStyle, marginBottom: 20, border: '1px solid #2d2d30', borderRadius: 12 }}
                styles={{
                    body: { padding: 3 },
                }}
            >
                {users.length > 0 ? (
                    <Table
                        columns={userColumns}
                        dataSource={users.map(user => ({ ...user, key: user.id }))}
                        pagination={false}
                        size="middle"
                        onRow={(record) => ({
                            onClick: () => navigate(`/files/${record.id}`),
                            style: { cursor: 'pointer' },
                        })}
                        rowClassName={() => 'dashboard-row'}
                    />
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <Text style={{ color: '#7a7a7e' }}>
                                {usersAvailable
                                    ? 'No users returned by the management endpoint yet.'
                                    : 'User management is not wired up on the backend yet.'}
                            </Text>
                        }
                        style={{ padding: '32px 0' }}
                    />
                )}
            </Card>

            <Card
                title={<span style={{ color: '#ffffff', fontWeight: 600, fontSize: 15 }}>All existing links</span>}
                style={{ ...panelStyle, border: '1px solid #2d2d30', borderRadius: 12 }}
                styles={{
                    body: { padding: 3 },
                }}
            >
                {shares.length > 0 ? (
                    <Table
                        columns={shareColumns}
                        dataSource={shares.map(share => ({ ...share, key: share.id }))}
                        pagination={false}
                        size="middle"
                        rowClassName={() => 'dashboard-row'}
                    />
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <Text style={{ color: '#7a7a7e' }}>
                                No shared links found for the current account.
                            </Text>
                        }
                        style={{ padding: '32px 0' }}
                    />
                )}
            </Card>

            <style>{`
            .dashboard-row:hover td {
                background: #232326 !important;
            }
            .ant-table {
                background: transparent !important;
            }
            .ant-table-thead > tr > th {
                background: #1f1f22 !important;
                color: #9a9aa2 !important;
                border-bottom: 1px solid #2d2d30 !important;
                font-weight: 500 !important;
                font-size: 12px !important;
                text-transform: uppercase;
                letter-spacing: 0.4px;
            }
            .ant-table-tbody > tr > td {
                background: transparent !important;
                border-bottom: 1px solid #232326 !important;
                color: #d4d4d8;
            }
        `}</style>

        </div>
    );
}