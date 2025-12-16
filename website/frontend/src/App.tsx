import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from 'antd';
import Sidebar from './Components/SideBar';
import Files from './pages/Files';
import FileViewer from './pages/FileViewer';
import { RefreshProvider } from './contexts/RefreshContext';
const { Content, Sider } = Layout;


function App() {
  return (
    <Router>
      <RefreshProvider>
        <Layout style={{ height: '100vh', overflow: 'hidden', background: '#1c1c1c' }}>
          <Sider width={250} style={{ background: '#1c1c1c', borderRight: '1px solid #2d2d2d', height: '100vh', overflow: 'hidden' }}>
            <Sidebar />
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
