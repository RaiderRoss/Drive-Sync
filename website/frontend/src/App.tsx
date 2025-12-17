import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout, Button } from 'antd';
import { useState, useEffect } from 'react';
import { MenuOutlined } from '@ant-design/icons';
import Sidebar from './Components/SideBar';
import Files from './pages/Files';
import FileViewer from './pages/FileViewer';
import { RefreshProvider } from './contexts/RefreshContext';
const { Content, Sider } = Layout;


function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);
      if (mobile) {
        setCollapsed(true);
      } else {
        setCollapsed(false);
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Router>
      <RefreshProvider>
        <Layout style={{ height: '100vh', overflow: 'hidden', background: '#1c1c1c' }}>
          {/* Mobile backdrop */}
          {isMobile && !collapsed && (
            <div
              onClick={() => setCollapsed(true)}
              style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                zIndex: 999,
              }}
            />
          )}
          
          <Sider 
            width={250} 
            collapsed={isMobile ? collapsed : false}
            collapsedWidth={0}
            trigger={null}
            style={{ 
              background: '#1c1c1c', 
              borderRight: '1px solid #2d2d2d', 
              height: '100vh', 
              overflow: 'hidden',
              ...(isMobile ? {
                position: 'fixed',
                left: 0,
                top: 0,
                bottom: 0,
                zIndex: 1000,
                boxShadow: '2px 0 8px rgba(0, 0, 0, 0.5)',
              } : {})
            }}
          >
            <Sidebar onLinkClick={() => isMobile && setCollapsed(true)} />
          </Sider>
          <Layout style={{ height: '100vh', overflow: 'hidden' }}>
            <Content
              style={{
                padding: 0,
                background: '#252525',
                overflow: 'hidden',
                height: '100%',
              }}
            >
              {/* Hamburger menu button for mobile */}
              {isMobile && (
                <Button
                  type="text"
                  icon={<MenuOutlined style={{ fontSize: 20 }} />}
                  onClick={() => setCollapsed(!collapsed)}
                  style={{
                    position: 'fixed',
                    top: 16,
                    left: 16,
                    zIndex: 1001,
                    width: 44,
                    height: 44,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: '#1c1c1c',
                    border: '1px solid #2d2d2d',
                    borderRadius: 8,
                    color: '#ffffff',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.5)',
                  }}
                />
              )}
              
              <Routes>
                <Route path="*" element={<Navigate to="/files" />} />
                <Route path="/file/*" element={<FileViewer />} />
                <Route path="/files/*" element={<Files />} />
              </Routes>

            </Content>
          </Layout>
        </Layout>
      </RefreshProvider>
    </Router>
  );
}

export default App;
