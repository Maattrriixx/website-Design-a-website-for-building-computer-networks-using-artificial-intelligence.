import * as Utils from '../utils/utils';

export const API_CONFIG = {
  BASE_URL: 'http://localhost:8000/api', // Laravel backend
  TOKEN_KEY: 'netarch_token',
};

async function _apiRequest(method, endpoint, body = null, isFormData = false) {
  const token = sessionStorage.getItem(API_CONFIG.TOKEN_KEY);
  const headers = {};
  if (!isFormData) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const options = { method, headers };
  if (body) options.body = isFormData ? body : JSON.stringify(body);
  const res = await fetch(API_CONFIG.BASE_URL + endpoint, options);
  const data = await res.json().catch(() => ({}));
  
  if (!res.ok) {
    // Extract validation errors from Laravel
    if (data.errors) {
      // Get the first error message from the errors object
      const firstErrorKey = Object.keys(data.errors)[0];
      const errorMessage = data.errors[firstErrorKey][0];
      throw new Error(errorMessage);
    }
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

function _saveToken(token) { if (token) sessionStorage.setItem(API_CONFIG.TOKEN_KEY, token); }
function _clearToken() { sessionStorage.removeItem(API_CONFIG.TOKEN_KEY); }

export const AuthAPI = {
  async login(email, password) {
    const data = await _apiRequest('POST', '/Login', { email, password });
    _saveToken(data.access_token);
    const userData = await _apiRequest('GET', '/user');
    return Utils.setSession(userData);
  },
  async register(name, email, password) {
    const data = await _apiRequest('POST', '/Register', {
      name,
      email,
      password,
      password_confirmation: password,
    });
    return data;
  },
  async forgotPassword(email) {
    const data = await _apiRequest('POST', '/Forget_Password', { email });
    return data;
  },
  async resetPassword(token, email, password) {
    const data = await _apiRequest('POST', '/New_Password', {
      token,
      email,
      password,
      password_confirmation: password,
    });
    return data;
  },
  async logout() {
    await _apiRequest('GET', '/Logout').catch(() => {});
    _clearToken();
    Utils.clearSession();
  },
  async me() {
    try {
      const data = await _apiRequest('GET', '/user');
      return data;
    } catch {
      return null;
    }
  },
};

export const UsersAPI = {
  async update(updates) {
    const data = await _apiRequest('PUT', '/Change_Name', updates);
    const user = Utils.getCurrentUser();
    if (user) Utils.setSession({ ...user, ...data });
    return data;
  },
  async delete(password) {
    await _apiRequest('DELETE', '/Delete_Account', { password });
    _clearToken();
    Utils.clearSession();
  },
};

export const ProjectsAPI = {
  async list() {
    const data = await _apiRequest('GET', '/projects');
    return Array.isArray(data) ? data : data.projects;
  },
  async getUserProjects() {
    const data = await _apiRequest('GET', '/projects');
    return Array.isArray(data) ? data : data.projects;
  },
  async getProjectSettings() {
    const data = await _apiRequest('GET', '/projects/settings');
    return data;
  },
  async createProject({ name, type, description, imageFile, measureOfDraw }) {
    const form = new FormData();
    form.append('name', name);
    form.append('type', type);
    if (description) form.append('description', description);
    form.append('image', imageFile);
    form.append('measure_of_draw', measureOfDraw);
    const data = await _apiRequest('POST', '/create_project', form, true);
    return data.project;
  },
  async analyzeProject(projectId) {
    const data = await _apiRequest('POST', `/projects/${projectId}/analyze`);
    return data;
  },
  async optimizeNetwork(projectId) {
    const data = await _apiRequest('POST', `/projects/${projectId}/wired-network`);
    return data;
  },
  async getProjectTopology(projectId) {
    const data = await _apiRequest('GET', `/projects/${projectId}/topology`);
    return data;
  },
  async getRoomsWithDevices(projectId) {
    const data = await _apiRequest('GET', `/projects/${projectId}/rooms-devices`);
    return data;
  },
  async getFullProject(projectId) {
    const data = await _apiRequest('GET', `/projects/${projectId}/full`);
    return data;
  },
  async save(appState, name, existingId) {
    let thumbnail = null;
    try {
      const canvas = document.getElementById('mainCanvas');
      if (canvas && canvas.width > 0) {
        const tmp = document.createElement('canvas');
        const scale = Math.min(1, 240 / canvas.width);
        tmp.width = Math.round(canvas.width * scale);
        tmp.height = Math.round(canvas.height * scale);
        tmp.getContext('2d').drawImage(canvas, 0, 0, tmp.width, tmp.height);
        thumbnail = tmp.toDataURL('image/jpeg', 0.75);
      }
    } catch (_) {}
    let floorPlanDataUrl = null;
    try {
      if (appState.floorPlan?.src?.startsWith('data:')) floorPlanDataUrl = appState.floorPlan.src;
    } catch (_) {}
    const payload = {
      name: name || Utils._autoProjectName(),
      thumbnail,
      floorPlanDataUrl,
      canvasW: appState.canvasW,
      canvasH: appState.canvasH,
      rooms: appState.rooms,
      devices: appState.devices,
      connections: appState.connections,
      phase: appState.phase,
    };
    const method = existingId ? 'PUT' : 'POST';
    const endpoint = existingId ? `/projects/${existingId}` : '/projects';
    const data = await _apiRequest(method, endpoint, payload);
    return data.project;
  },
  async rename(projectId, newName) {
    await _apiRequest('PUT', `/projects/${projectId}`, { name: newName });
  },
  async delete(projectId) {
    await _apiRequest('DELETE', `/projects/${projectId}`);
  },
  openInApp(projectId) {
    Utils.queueOpenProject(projectId);
    window.location.href = '/designer';
  },
};

export const IconsAPI = {
  async getIcons() {
    const data = await _apiRequest('GET', '/Display_Icon');
    return data.icons;
  },
};

export const RoomsAPI = {
  async getRooms(projectId) {
    const data = await _apiRequest('GET', `/projects/${projectId}/rooms`);
    return data;
  },
  async updateType(roomId, type) {
    const data = await _apiRequest('PATCH', `/rooms/${roomId}/type`, { type });
    return data;
  },
};

export const AiAPI = {
  async analyzeFloorPlan(file) {
    const form = new FormData();
    form.append('image', file);
    const data = await _apiRequest('POST', '/ai/analyze', form, true);
    if (!data.rooms || !Array.isArray(data.rooms)) throw new Error('Backend returned unexpected format for rooms.');
    return data.rooms;
  },
};
export const DevicesAPI = {
  async addDevice(projectId, { type, room_id, x, y, quantity, vlan_id, ports }) {
    const data = await _apiRequest('POST', `/projects/${projectId}/devices`, {
      type,
      room_id,
      x,
      y,
      quantity: quantity ?? 1,
      ...(vlan_id != null && { vlan_id }),
      ...(ports != null && { ports }),
    });
    return data;
  },
  // Backend: PATCH /devices/{deviceId} (DeviceController::updateQuantity)
  async updateQuantity(deviceId, quantity) {
    const data = await _apiRequest('PATCH', `/devices/${deviceId}`, { quantity });
    return data;
  },
  // Backend: DELETE /devices/{deviceId} (DeviceController::destroyDevice)
  async deleteDevice(deviceId) {
    await _apiRequest('DELETE', `/devices/${deviceId}`);
  },
};