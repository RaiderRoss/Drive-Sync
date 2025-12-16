// CreateFolder.tsx
import React, { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Modal, Input, message } from 'antd';

interface CreateFolderProps {
  fetchFiles: () => void;
}

const CreateFolder: React.FC<CreateFolderProps> = ({ fetchFiles }) => {
  const location = useLocation();
  const currentPath = location.pathname.startsWith('/files')
    ? location.pathname.slice('/files'.length) || '/'
    : location.pathname;

  const [visible, setVisible] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [loading, setLoading] = useState(false);

  const openModal = () => setVisible(true);
  const closeModal = () => {
    setVisible(false);
    setFolderName('');
  };

  const handleCreate = async () => {
    if (!folderName.trim()) {
      return message.error('Folder name cannot be empty');
    }
    setLoading(true);
    try {
      let basePath = currentPath === '/' ? '' : currentPath.replace(/\/$/, '');
      const segments = basePath.split('/').filter(Boolean).map(encodeURIComponent);
      segments.push(encodeURIComponent(folderName.trim()));
      const fullPath = segments.join('/');

      const res = await fetch(`/api/create_folder/${fullPath}`, {
        method: 'POST',
      });

      if (res.ok) {
        message.success(`Folder "${folderName}" created`);
        closeModal();
        fetchFiles();
      } else {
        const text = await res.text();
        message.error(`Failed: ${text}`);
      }
    } catch (e) {
      message.error(`Error: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button type="primary" onClick={openModal} style={{ marginBottom: 8 }}>
        Create Folder
      </Button>
      <Modal
        title="Create New Folder"
        open={visible}
        onOk={handleCreate}
        onCancel={closeModal}
        confirmLoading={loading}
        okButtonProps={{ disabled: !folderName.trim() }}
      >
        <Input
          autoFocus
          placeholder="Folder name"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
          onPressEnter={handleCreate}
          disabled={loading}
        />
      </Modal>
    </>
  );
};

export default CreateFolder;
