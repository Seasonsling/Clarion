import { 时间轴数据, User } from './types';

async function fetchWithAuth(url: string, token: string, options: RequestInit = {}): Promise<any> {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errorData.message || `API Error: ${response.status}`);
    }
    if (response.status === 204) { // Handle No Content response
        return null;
    }
    return response.json();
}

export function fetchProjects(token: string): Promise<时间轴数据[]> {
    return fetchWithAuth('/api/projects', token);
}

export function fetchAllUsers(token: string): Promise<User[]> {
    return fetchWithAuth('/api/users', token);
}

export function createProject(projectData: 时间轴数据, token: string): Promise<时间轴数据> {
    return fetchWithAuth('/api/projects', token, {
        method: 'POST',
        body: JSON.stringify(projectData),
    });
}

export function updateProject(projectData: 时间轴数据, token: string): Promise<时间轴数据> {
    return fetchWithAuth(`/api/projects/${projectData.id}`, token, {
        method: 'PUT',
        body: JSON.stringify(projectData),
    });
}
  
export function deleteProject(projectId: string, token: string): Promise<null> {
    return fetchWithAuth(`/api/projects/${projectId}`, token, { method: 'DELETE' });
}
