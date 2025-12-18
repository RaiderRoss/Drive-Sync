import React, { useState } from 'react';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { Button, message, Upload, Card, Typography } from 'antd';
import { useLocation } from 'react-router-dom';

const { Paragraph } = Typography;
const { Dragger } = Upload;

interface UploadAreaProps {
  fetchFiles: () => void;
}

const UploadArea: React.FC<UploadAreaProps> = ({ fetchFiles }) => {
  const location = useLocation();
  const [, setUploadingFiles] = useState<any[]>([]);

  const currentPath = location.pathname.startsWith('/files')
    ? location.pathname.slice('/files'.length) || '/'
    : location.pathname;

  const checkAllUploadsComplete = (fileList: any[]) => {
    const allDoneOrFailed = fileList.every(
      (file) => file.status === 'done' || file.status === 'error'
    );
    if (allDoneOrFailed) {
      fetchFiles();
    }
  };

  const props: UploadProps = {
    name: 'file',
    action: `/api/upload${currentPath}`,
    headers: {
      authorization: 'authorization-text',
    },
    multiple: true,
    onChange(info) {
      setUploadingFiles(info.fileList);
      if (info.file.status === 'done') {
        message.success(`${info.file.name} file uploaded successfully`);
      } else if (info.file.status === 'error') {
        message.error(`${info.file.name} file upload failed.`);
      }

      checkAllUploadsComplete(info.fileList);
    },
    progress: {
      strokeColor: {
        '0%': '#108ee9',
        '100%': '#87d068',
      },
      strokeWidth: 3,
      format: (percent) => percent && `${parseFloat(percent.toFixed(2))}%`,
    },
  };

  return (
    <div style={{ width: '100%' }}>
      <Card
        className="upload-card"
        style={{
          borderRadius: 4,
          border: '2px dashed #446e4dff',
          background: '#2b2b2b',
        }}


        bodyStyle={{ padding: 0 }}
      >
        <Dragger
          {...props}
          style={{ width: '100%', border: 'none', background: 'transparent', paddingBottom: '12px' }}
          showUploadList={{ showRemoveIcon: true }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '10px 24px' }}>
            <Button
              icon={<UploadOutlined />}
              type="primary"
              size="large"
              style={{ fontSize: 14, minWidth: '200px' }}
            >
              Upload files
            </Button>
            <Paragraph style={{ textAlign: 'center', margin: 0, color: '#b3b3b3', fontSize: 13 }}>
              Select or drag your files here
            </Paragraph>
          </div>
        </Dragger>

      </Card>
    </div>
  );
};

export default UploadArea;
