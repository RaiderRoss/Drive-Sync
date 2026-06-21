import { useEffect, useState } from 'react';
import { Table, Typography, Spin, Button, Breadcrumb, Popconfirm } from 'antd';
import { DeleteOutlined, LinkOutlined, CopyOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { getAuthHeaders } from '../api/File';
import { useAlert } from '../Components/Alert';

const { Text } = Typography;

interface ShareEntry {
    id: string;
    file_path: string;
    created_at: number;
}

const API_BASE = '/api';

export default function SharesViewer() {
    const navigate = useNavigate();
    const alert = useAlert();

    const [shares, setShares] = useState<ShareEntry[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchShares = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/shares`, {
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data: ShareEntry[] = await res.json();
            setShares(data);
        } catch (err) {
            console.error('Failed to fetch shares:', err);
            alert.error('Could not load shared files.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchShares();
    }, []);

    const unshare = async (share: ShareEntry) => {
        try {
            const res = await fetch(`${API_BASE}/share/${encodeURIComponent(share.id)}`, {
                method: 'DELETE',
                headers: getAuthHeaders(),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            alert.success(`Unshared: ${share.file_path}`);
            setShares(prev => prev.filter(s => s.id !== share.id));
        } catch (err) {
            console.error('Unshare failed:', err);
            alert.error('Failed to unshare file.');
        }
    };

    const copyLink = async (share: ShareEntry) => {
        const link = `${window.location.origin}/share/${share.id}`;
        try {
            await navigator.clipboard.writeText(link);
            alert.success('Share link copied to clipboard!');
        } catch (err) {
            console.error('Copy failed:', err);
            alert.error('Could not copy link.');
        }
    };

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

    const compareByPath = (a: ShareEntry, b: ShareEntry) =>
        a.file_path.localeCompare(b.file_path, undefined, { numeric: true, sensitivity: 'base' });

    const compareByCreatedAt = (a: ShareEntry, b: ShareEntry) =>
        a.created_at - b.created_at;

    const columns: ColumnsType<ShareEntry> = [
        {
            title: 'Path',
            dataIndex: 'file_path',
            key: 'file_path',
            render: (path: string) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <LinkOutlined style={{ fontSize: 14, color: '#7782b4' }} />
                    <Text style={{ color: '#ffffff' }}>{path}</Text>
                </div>
            ),
            sorter: {
                compare: compareByPath,
                multiple: 1,
            },
            defaultSortOrder: 'ascend',
        },
        {
            title: 'Date created',
            dataIndex: 'created_at',
            key: 'created_at',
            width: 180,
            render: (timestamp: number) => (
                <Text style={{ color: '#b3b3b3' }}>{formatDate(timestamp)}</Text>
            ),
            sorter: {
                compare: compareByCreatedAt,
                multiple: 2,
            },
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 100,
            render: (_: any, record: ShareEntry) => (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 30, width: '100%' }}>
                    <Popconfirm
                        title={<span style={{ color: '#ffffff' }}>Unshare this file?</span>}
                        okText="Unshare"
                        okType="danger"
                        cancelText="Cancel"
                        icon={<DeleteOutlined style={{ color: '#ff4d4f' }} />}
                        overlayClassName="dark-popconfirm"
                        styles={{
                            root: {
                                '--antd-arrow-background-color': '#2b2b2b',
                            } as React.CSSProperties,
                        }}
                        color="#2b2b2b"
                        onConfirm={() => unshare(record)}
                    >
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            style={{ color: '#ff4d4f' }}
                        />
                    </Popconfirm>

                    <Button
                        size="small"
                        type="text"
                        icon={<CopyOutlined style={{ color: '#9acc81' }} />}
                        onClick={() => copyLink(record)}
                    />

                </div>
            ),
        },
    ];

    if (loading) {
        return <Spin style={{ display: 'block', margin: '100px auto' }} />;
    }

    return (
        <div
            style={{
                height: '100vh',
                display: 'flex',
                flexDirection: 'column',
                background: '#252525',
            }}
        >
            <div style={{
                background: '#252525',
                borderBottom: '1px solid #2d2d2d',
                padding: '8px 16px 12px 16px',
            }}>
                <Breadcrumb
                    items={[
                        {
                            title: (
                                <a
                                    onClick={() => navigate('/files')}
                                    style={{ cursor: 'pointer', userSelect: 'none' }}
                                >
                                    Files
                                </a>
                            ),
                            key: 'files-root',
                        },
                        {
                            title: <span>Shared</span>,
                            key: 'shared',
                        },
                    ]}
                    separator="/"
                    style={{
                        marginBottom: 12,
                        fontSize: 14,
                        paddingLeft: window.innerWidth <= 768 ? '90px' : '0',
                    }}
                />
            </div>

            <div style={{
                flex: 1,
                overflow: 'auto',
                background: '#252525',
                padding: '10px 16px',
            }}>
                <Table
                    columns={columns}
                    dataSource={shares.map(s => ({ ...s, key: s.id }))}
                    pagination={false}
                    locale={{ emptyText: 'No shared files yet' }}
                    style={{ background: '#252525' }}
                />
            </div>

            <style>
                {`
                .dark-popconfirm .ant-popconfirm-buttons .ant-btn-default {
                    background: #3a3a3a;
                    border-color: #4a4a4a;
                    color: #ffffff;
                }
                .dark-popconfirm .ant-popconfirm-buttons .ant-btn-default:hover {
                    background: #454545;
                    border-color: #5a5a5a;
                    color: #ffffff;
                }
                `}
            </style>
        </div>
    );
}