
const API_BASE = '/api';

function getAuthToken() {
	return localStorage.getItem('token');
}

export function getAuthHeaders() {
	const headers: Record<string, string> = {};
	const token = getAuthToken();

	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	return headers;
}

export async function fetchFiles(directory?: string) {
	console.log('Fetching files with auth token:', getAuthToken());
	const url = directory
		? `${API_BASE}/uploads/${encodeURIComponent(directory)}`
		: `${API_BASE}/uploads`;
		console.log('Constructed URL for fetching files:', url);

	const res = await fetch(url, {
		headers: {
			Accept: 'application/json',
			...getAuthHeaders(),
		},
		cache: 'no-store',
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || 'Failed to fetch files');
	}

	const text = await res.text();
	return JSON.parse(text);
}

export async function downloadFileApi(filename: string) {
  const res = await fetch(`${API_BASE}/download/${encodeURIComponent(filename)}`, {
    headers: getAuthHeaders(),
  });

  if (!res.ok) throw new Error('Download failed');

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();

  window.URL.revokeObjectURL(url);
}

export async function deleteFileApi(filename: string) {
	const path = `${API_BASE}/delete/${filename}`.replace(/\/\/+/g, '/');
	const res = await fetch(path, {
		method: 'DELETE',
		headers: getAuthHeaders(),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || 'Delete failed');
	}
	return res;
}

export async function renameEntryApi(old_path: string, new_path: string) {
	const res = await fetch(`${API_BASE}/rename`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...getAuthHeaders(),
		},
		body: JSON.stringify({ old_path, new_path }),
	});

	if (!res.ok) {
		const text = await res.text();
		throw new Error(text || 'Rename failed');
	}
	return res;
}

export function uploadAction(currentPath: string) {
	return `${API_BASE}/upload${currentPath}`.replace(/\/\/+/g, '/');
}

export default {
	fetchFiles,
	downloadFileApi,
	deleteFileApi,
	renameEntryApi,
	uploadAction,
};
