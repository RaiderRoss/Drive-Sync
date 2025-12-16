import React, { useState } from 'react';
import { UploadOutlined } from '@ant-design/icons';
import type { UploadProps } from 'antd';
import { Button, message, Upload, Card, Typography } from 'antd';
import { useLocation } from 'react-router-dom';

const { Title, Paragraph } = Typography;

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
        style={{ 
          borderRadius: 4, 
          border: '1px solid #3d3d3d',
          background: '#2b2b2b'
        }}
        bodyStyle={{ padding: '24px' }}
      >
        <Title level={4} style={{ textAlign: 'center', marginBottom: 8, color: '#ffffff' }}>
          Upload Files
        </Title>
        <Paragraph style={{ textAlign: 'center', marginBottom: 16, color: '#b3b3b3', fontSize: 13 }}>
          Select or drag your files here
        </Paragraph>
        <Upload
          {...props}
          style={{ width: '100%' }}
          showUploadList={{ showRemoveIcon: true }}
        >
          <Button
            icon={<UploadOutlined />}
            type="primary"
            size="large"
            style={{ width: '100%', fontSize: 14 }}
          >
            Choose Files
          </Button>
        </Upload>
      </Card>
    </div>
  );
};

export default UploadArea;
