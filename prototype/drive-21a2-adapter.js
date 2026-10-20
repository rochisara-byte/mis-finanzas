'use strict';

// Isolated experiment. No production OAuth flow or automatic network entrypoint.
const { randomUUID } = require('node:crypto');
const { digest, scan, unpack } = require('./drive-21a');

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const requireValue = (ok, message) => { if (!ok) throw Error(message); };

class Drive21A2Adapter {
  constructor({ fetchImpl, accessToken, namespace, approvedTestEnvironment }) {
    requireValue(approvedTestEnvironment === true, 'Entorno de prueba no autorizado');
    requireValue(typeof fetchImpl === 'function', 'Se requiere transporte explicito');
    requireValue(typeof accessToken === 'string' && accessToken.length, 'Token de prueba ausente');
    requireValue(/^mf21a2-[a-z0-9]{16,32}$/.test(namespace || ''), 'Espacio experimental invalido');
    this.fetch = fetchImpl;
    this.token = accessToken;
    this.prefix = namespace + '-';
    this.knownIds = new Set();
  }

  async request(url, options = {}) {
    // Never put tokens into URLs or error messages.
    const target = new URL(url);
    const method = options.method || 'GET';
    requireValue(target.origin === 'https://www.googleapis.com' &&
      (target.pathname.startsWith('/drive/v3/') || target.pathname === '/drive/v3/files' || target.pathname === '/drive/v3/changes' || target.pathname === '/upload/drive/v3/files'), 'Endpoint fuera del experimento');
    requireValue(method === 'GET' || method === 'POST', 'Metodo de escritura no permitido');
    const response = await this.fetch(target, {
      ...options,
      headers: { ...options.headers, Authorization: 'Bearer ' + this.token }
    });
    requireValue(response && response.ok, 'Google Drive no confirmo la solicitud (HTTP ' + (response?.status ?? 'sin respuesta') + ')');
    return response;
  }

  async json(url, options) {
    const value = await (await this.request(url, options)).json();
    requireValue(value && typeof value === 'object', 'Respuesta JSON invalida');
    return value;
  }

  async create(file) {
    const id = file?.payload?.id;
    requireValue(typeof id === 'string' && /^[a-zA-Z0-9-]{3,128}$/.test(id), 'ID logico invalido');
    unpack(file);
    const name = this.prefix + id + '.json';
    const boundary = 'mf21a2' + randomUUID().replaceAll('-', '');
    const metadata = { name, parents: ['appDataFolder'], mimeType: 'application/json' };
    const body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
      '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + JSON.stringify(file) + '\r\n--' + boundary + '--';
    const created = await this.json(UPLOAD + '/files?uploadType=multipart&fields=id,name,parents', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body
    });
    requireValue(typeof created.id === 'string' && created.name === name && created.parents?.includes('appDataFolder'), 'Creacion no verificada');
    this.knownIds.add(created.id);
    return created.id;
  }

  async list(cursor = null, pageSize = 100) {
    requireValue(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 1000, 'Tamano de pagina invalido');
    const url = new URL(API + '/files');
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set('q', "name contains '" + this.prefix + "' and trashed = false");
    url.searchParams.set('fields', 'nextPageToken,incompleteSearch,files(id,name,mimeType,parents)');
    url.searchParams.set('pageSize', String(pageSize));
    if (cursor !== null) url.searchParams.set('pageToken', cursor);
    const result = await this.json(url);
    requireValue(Array.isArray(result.files) && !result.incompleteSearch, 'Listado experimental incompleto');
    const files = [];
    for (const file of result.files) {
      if (!file.name?.startsWith(this.prefix)) continue;
      requireValue(typeof file.id === 'string' && file.name.endsWith('.json') && file.mimeType === 'application/json', 'Archivo experimental incompatible');
      this.knownIds.add(file.id);
      files.push({ id: file.id });
    }
    return { files, nextPageToken: result.nextPageToken || null, incomplete: false };
  }

  async get(id) {
    requireValue(this.knownIds.has(id), 'Lectura fuera del espacio experimental bloqueada');
    const raw = await (await this.request(API + '/files/' + encodeURIComponent(id) + '?alt=media')).text();
    requireValue(raw.length <= 1024 * 1024, 'Commit experimental demasiado grande');
    try { return JSON.parse(raw); } catch { throw Error('Commit experimental incompleto'); }
  }

  async startPageToken() {
    const result = await this.json(API + '/changes/startPageToken');
    requireValue(typeof result.startPageToken === 'string' && result.startPageToken, 'Token inicial de cambios ausente');
    return result.startPageToken;
  }

  async changesPage(cursor, pageSize = 100) {
    requireValue(typeof cursor === 'string' && cursor, 'Token de cambios ausente');
    const url = new URL(API + '/changes');
    url.searchParams.set('pageToken', cursor);
    url.searchParams.set('pageSize', String(pageSize));
    url.searchParams.set('spaces', 'appDataFolder');
    url.searchParams.set('restrictToMyDrive', 'false');
    url.searchParams.set('includeRemoved', 'true');
    url.searchParams.set('fields', 'nextPageToken,newStartPageToken,changes(fileId,removed,file(id,name,mimeType,parents))');
    const result = await this.json(url);
    requireValue(Array.isArray(result.changes), 'Lista de cambios invalida');
    const ids = [];
    for (const change of result.changes) {
      if (this.knownIds.has(change.fileId) && change.removed) throw Error('Commit experimental eliminado o inaccesible');
      if (!change.file?.name) {
        throw Error('Cambio sin metadatos: no se puede descartar que sea experimental');
      }
      if (!change.file.name.startsWith(this.prefix)) continue;
      requireValue(!change.removed && change.file.mimeType === 'application/json' && typeof change.fileId === 'string', 'Cambio experimental incompatible');
      this.knownIds.add(change.fileId);
      ids.push(change.fileId);
    }
    return { ids, nextPageToken: result.nextPageToken || null, newStartPageToken: result.newStartPageToken || null };
  }

  async recoverChanges(startToken, pageSize = 100) {
    const ids = new Set();
    const pages = new Set();
    let cursor = startToken;
    while (true) {
      requireValue(!pages.has(cursor), 'Paginacion de cambios ciclica');
      pages.add(cursor);
      const page = await this.changesPage(cursor, pageSize);
      page.ids.forEach(id => ids.add(id));
      if (!page.nextPageToken) {
        requireValue(page.newStartPageToken, 'No se confirmo el final del historial de cambios');
        return { ids: [...ids], nextToken: page.newStartPageToken };
      }
      cursor = page.nextPageToken;
    }
  }
}

async function discoverWithChanges(adapter, pageSize = 100) {
  // Start the feed before listing so additions during pagination are replayed.
  const start = await adapter.startPageToken();
  const commits = await scan(adapter, pageSize);
  const recovered = await adapter.recoverChanges(start, pageSize);
  for (const id of recovered.ids) {
    const commit = unpack(await adapter.get(id));
    const previous = commits.get(commit.id);
    requireValue(!previous || digest(previous) === digest(commit), 'ID logico ambiguo en cambios');
    commits.set(commit.id, commit);
  }
  return { commits, nextToken: recovered.nextToken, status: 'observado-hasta-token-sin-garantia-global' };
}

module.exports = { Drive21A2Adapter, discoverWithChanges };
