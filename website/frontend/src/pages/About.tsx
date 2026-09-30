import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudOutlined,
  DesktopOutlined,
  LockOutlined,
  MobileOutlined,
  ShareAltOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { Card, Col, Divider, Row, Space, Statistic, Tag, Typography } from 'antd';
import FolderFloat from '../Components/FolderFloat';
import GhostFibers from '../Components/GhostFibers';
import SecureFolder from '../Components/SecureFolder';

const { Title, Text, Paragraph } = Typography;

const panelStyle: React.CSSProperties = {
  height: '100%',
  background: '#1f1f1f',
  border: '1px solid #2d2d30',
  borderRadius: 12,
  boxShadow: '0 10px 30px rgba(0, 0, 0, 0.14)',

};

const bodyStyle = { padding: 20 };

const capabilities = [
  { icon: <AppstoreOutlined />, label: 'Organize', title: 'A clear home for every file', copy: 'Keep projects, folders, and recent work easy to find.' },
  { icon: <ShareAltOutlined />, label: 'Share', title: 'Move work forward', copy: 'Create simple links when a file needs to leave your workspace.' },
  { icon: <LockOutlined />, label: 'Control', title: 'Private by default', copy: 'Your files stay in your space until you decide otherwise.' },
];

export default function About() {
  return (
    <main style={{ position: 'relative', height: '100vh', overflowY: 'auto', padding: '28px 32px 44px', background: '#0b0b12' }}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <GhostFibers
          lineColor="#140E35"
          glowColor="#3437A0"
          speed={0.2}
          scale={1.8}
          rotation={8}
          rotationSpeed={0}
          layers={14}
          waveAmplitude={0.018}
          waveFrequency={3}
          waveSpeed={0.14}
          layerSpeed={0.09}
          twist={0.12}
          twistFrequency={12}
          twistSpeed={1.15}
          lineFrequency={6}
          lineSpacing={2.2}
          lineSharpness={18}
          glowFalloff={9}
          glowIntensity={1.7}
          brightness={1.8}
          blueBoost={1.3}
          vignette={0.9}
          grain={0.04}
          lightMode={false}
        />

      </div>
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 1180, margin: '0 auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <Space size={10}>
            <img
              src="/logo.png"
              alt="Drive Sync"
              style={{
                width: 30,
                height: 30,
                borderRadius: 7,
                objectFit: 'contain',
              }}
            />
            <div>
              <Text strong style={{ color: '#fff', display: 'block', lineHeight: 1.1 }}>
                Drive Sync
              </Text>
              <Text style={{ color: '#7a7a7e', fontSize: 12 }}>
                Workspace overview
              </Text>
            </div>
          </Space>

          <Tag icon={<CheckCircleOutlined />} color="success" style={{ margin: 0 }}>
            Operational
          </Tag>
        </header>

        <section style={{ marginBottom: 24 }}>
          <Text style={{ color: '#5b8def', fontSize: 12, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase' }}>About Drive Sync</Text>
          <Title level={2} style={{ color: '#fff', margin: '8px 0 4px', fontWeight: 600 }}>A calmer place for work to land.</Title>
          <Paragraph style={{ color: '#9a9aa2', maxWidth: 650, margin: 0 }}>Store, organize, and share the files that keep your projects moving, without adding another layer of friction.</Paragraph>
        </section>

        <div
          style={{
            minHeight: 320,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 200,
            flexWrap: 'wrap',
          }}
        >
          <FolderFloat
            items={[
              'Make space for focus',
              'Share without friction',
              'Keep the good stuff',
              'Ready for what is next',
            ]}
            label="Drive Sync"
            sublabel="4 ways to move forward"
          />

          <SecureFolder />
        </div>

        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} md={8}>
            <Card style={panelStyle} styles={{ body: bodyStyle }}>
              <Statistic title={<Text style={{ color: '#9a9aa2', fontSize: 12 }}>WORKSPACE</Text>} value="Ready" valueStyle={{ color: '#fff', fontSize: 27 }} prefix={<CloudOutlined style={{ color: '#5b8def', fontSize: 18 }} />} />
              <Text style={{ color: '#7a7a7e', fontSize: 12 }}>Your files are close at hand.</Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card style={panelStyle} styles={{ body: bodyStyle }}>
              <Statistic title={<Text style={{ color: '#9a9aa2', fontSize: 12 }}>SHARING</Text>} value="Simple" valueStyle={{ color: '#fff', fontSize: 27 }} prefix={<ShareAltOutlined style={{ color: '#5b8def', fontSize: 18 }} />} />
              <Text style={{ color: '#7a7a7e', fontSize: 12 }}>Links stay easy to understand.</Text>
            </Card>
          </Col>
          <Col xs={24} md={8}>
            <Card style={panelStyle} styles={{ body: bodyStyle }}>
              <Statistic title={<Text style={{ color: '#9a9aa2', fontSize: 12 }}>ACCESS</Text>} value="Private" valueStyle={{ color: '#fff', fontSize: 27 }} prefix={<LockOutlined style={{ color: '#5b8def', fontSize: 18 }} />} />
              <Text style={{ color: '#7a7a7e', fontSize: 12 }}>You choose who sees what.</Text>
            </Card>
          </Col>
        </Row>

        <Card
          title={<Text style={{ color: '#fff', fontSize: 16 }}>One workspace, every device</Text>}
          extra={
            <Tag icon={<SyncOutlined spin />} color="processing">
              Sync active
            </Tag>
          }
          style={{ ...panelStyle, marginBottom: 24 }}
          styles={{ body: { padding: 24 } }}
        >
          <div className="sync-workspace">
            <Paragraph className="sync-workspace__description">
              Drive Sync keeps the same files close whether you are at your desk,
              moving between meetings, or checking in from the browser.
            </Paragraph>

            <div className="sync-workspace__status">
              <span className="sync-workspace__status-dot" />
              <span>All files synchronized</span>
              <span className="sync-workspace__status-time">
                Just now
              </span>
            </div>

            <div className="sync-workspace__devices">
              {[
                {
                  icon: <DesktopOutlined />,
                  label: 'Desktop',
                  state: 'Up to date',
                  detail: '247 files',
                },
                {
                  icon: <MobileOutlined />,
                  label: 'Mobile',
                  state: 'Connected',
                  detail: 'Syncing',
                },
                {
                  icon: <CloudOutlined />,
                  label: 'Cloud',
                  state: 'Protected',
                  detail: '247 files',
                },
              ].map((device, index) => (
                <div
                  key={device.label}
                  className="sync-workspace__device-wrapper"
                >
                  <div className="sync-workspace__device">
                    <div className="sync-workspace__device-icon">
                      {device.icon}
                      <span className="sync-workspace__device-pulse" />
                    </div>

                    <div className="sync-workspace__device-info">
                      <Text className="sync-workspace__device-label">
                        {device.label}
                      </Text>

                      <Text className="sync-workspace__device-state">
                        {device.state}
                      </Text>

                      <Text className="sync-workspace__device-detail">
                        {device.detail}
                      </Text>
                    </div>

                    <SyncOutlined className="sync-workspace__device-sync" />
                  </div>

                  {index < 2 && (
                    <div className="sync-workspace__connection">
                      <div className="sync-workspace__connection-line" />
                      <div className="sync-workspace__connection-dot" />
                      <div className="sync-workspace__connection-dot sync-workspace__connection-dot--2" />
                      <div className="sync-workspace__connection-dot sync-workspace__connection-dot--3" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="sync-workspace__progress">
              <div className="sync-workspace__progress-header">
                <span>Synchronization</span>
                <span>100%</span>
              </div>

              <div className="sync-workspace__progress-track">
                <div className="sync-workspace__progress-fill" />
              </div>
            </div>
          </div>
        </Card>


        <Card title={<Text style={{ color: '#fff' }}>Everything you need to keep moving</Text>} extra={<Text style={{ color: '#7a7a7e', fontSize: 12 }}>CORE WORKSPACE</Text>} style={{ ...panelStyle, marginBottom: 24 }} styles={{ body: { padding: 0 } }}>
          <Row>
            {capabilities.map((capability, index) => (
              <Col xs={24} md={8} key={capability.label}>
                <div style={{ padding: '22px 20px', borderRight: index < capabilities.length - 1 ? '1px solid #2d2d30' : undefined }}>
                  <Space align="center" size={10}><span style={{ color: '#5b8def', fontSize: 17 }}>{capability.icon}</span><Text style={{ color: '#9a9aa2', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8 }}>{capability.label}</Text></Space>
                  <Title level={5} style={{ color: '#fff', margin: '18px 0 6px' }}>{capability.title}</Title>
                  <Text style={{ color: '#9a9aa2', fontSize: 13, lineHeight: 1.6 }}>{capability.copy}</Text>
                </div>
              </Col>
            ))}
          </Row>
        </Card>

        <Card style={panelStyle} styles={{ body: { padding: 20 } }}>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Space><Text style={{ color: '#fff', fontWeight: 600 }}>A simpler rhythm</Text><Tag color="blue">3 steps</Tag></Space>
            <Divider style={{ borderColor: '#2d2d30', margin: '4px 0' }} />
            <Row gutter={[20, 16]}>
              {['Collect your work', 'Shape the latest version', 'Share with confidence'].map((step, index) => (
                <Col xs={24} sm={8} key={step}>
                  <Space align="start">
                    <Text style={{ color: '#5b8def', fontWeight: 600 }}>0{index + 1}</Text>
                    <div><Text style={{ color: '#fff', display: 'block' }}>{step}</Text><Text style={{ color: '#7a7a7e', fontSize: 12 }}>Keep the next action clear.</Text></div>
                  </Space>
                </Col>
              ))}
            </Row>
          </Space>
        </Card>

        <footer style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 20, marginTop: 24, borderTop: '1px solid #2d2d30', color: '#7a7a7e', fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          <span>Drive Sync / About</span>
          <span>Store / manage / share</span>
        </footer>
      </div>
      <style>{`@keyframes about-sync-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }`}</style>
    </main >
  );
}
