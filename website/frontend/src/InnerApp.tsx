import { useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, Button } from 'antd';
import { useState, useEffect } from 'react';
import { MenuOutlined } from '@ant-design/icons';

import Sidebar from './Components/SideBar';
import Files from './pages/Files';
import FileViewer from './pages/FileViewer';
import Auth from './pages/Auth';
import { RefreshProvider } from './contexts/RefreshContext';
import { AlertProvider } from './Components/Alert';

const { Content, Sider } = Layout;

const SIDEBAR_WIDTH = 250;

export default function InnerApp() {
  const location = useLocation();

  const hideSidebar =
    location.pathname === '/login' ||
    location.pathname === '/register' || location.pathname.startsWith('/share/');

  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      setCollapsed(mobile);
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const sidebarVisible = !hideSidebar && !isMobile;
  const alertOffsetLeft = sidebarVisible ? SIDEBAR_WIDTH / 2 : 0;

  return (
    <AlertProvider offsetLeft={alertOffsetLeft}>
      <RefreshProvider>
        <Layout style={{ height: '100vh', overflow: 'hidden', background: '#1c1c1c' }}>
          {isMobile && !collapsed && !hideSidebar && (
            <div
              onClick={() => setCollapsed(true)}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                zIndex: 999,
              }}
            />
          )}

          {/* sidebar */}
          {!hideSidebar && (
            <Sider
              width={SIDEBAR_WIDTH}
              collapsed={isMobile ? collapsed : false}
              collapsedWidth={0}
              trigger={null}
              style={{
                background: '#1c1c1c',
                borderRight: '1px solid #2d2d2d',
                height: '100vh',
                position: isMobile ? 'fixed' : 'relative',
                zIndex: 1000,
                left: 0,
                top: 0,
                bottom: 0,
              }}
            >
              <Sidebar onLinkClick={() => isMobile && setCollapsed(true)} />
            </Sider>
          )}

          <Layout>
            <Content style={{ background: '#252525', height: '100vh' }}>

              {/* mobile menu */}
              {isMobile && !hideSidebar && (
                <Button
                  type="text"
                  icon={<MenuOutlined style={{ fontSize: 12 }} />}
                  onClick={() => setCollapsed(!collapsed)}
                  style={{
                    position: 'fixed',
                    top: 6,
                    left: 6,
                    zIndex: 1001,
                    background: '#1c1c1c',
                    border: '1px solid #2d2d2d',
                    color: 'white',
                  }}
                />
              )}

              <Routes>
                <Route path="/" element={<Navigate to="/files" />} />
                <Route path="*" element={<Navigate to="/files" />} />
                <Route path="/files/*" element={<Files key={location.pathname} />} />
                <Route path="/file/*" element={<FileViewer />} />
                <Route path="/login" element={<Auth />} />
                <Route path="/register" element={<Auth />} />
                <Route path="/share/*" element={<FileViewer />} />
              </Routes>

            </Content>
          </Layout>

        </Layout>
      </RefreshProvider>
    </AlertProvider>
  );
}