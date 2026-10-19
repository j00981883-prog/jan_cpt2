export const SITE = 'https://jmaait.sharepoint.com/sites/CapitalProgramming';
const ROOT = '/sites/CapitalProgramming/Shared Documents/';

export function sharepointPath(value) {
  const url = new URL(value);
  if (url.origin !== 'https://jmaait.sharepoint.com' || url.username || url.password || url.search || url.hash)
    throw new Error('A direct JMAA SharePoint file URL is required.');
  const path = decodeURIComponent(url.pathname);
  if (!path.startsWith(ROOT) || /[\\\u0000-\u001f]/.test(path) || path.split('/').some(p=>p==='.'||p==='..'))
    throw new Error('File must belong to Capital Programming Documents.');
  return path;
}

export function prepareDocument(input, projects) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('A file object is required.');
  if (input.is_folder === true || input.is_folder === 'true') return {status:'ignored_folder'};
  if (input.site_url !== SITE) throw new Error('Unexpected SharePoint site.');
  const library = String(input.library_id || '').toLowerCase();
  const item = String(input.item_id || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(library) || !/^[1-9][0-9]{0,12}$/.test(item))
    throw new Error('A library ID and item ID are required.');
  const name=String(input.file_name || '').trim();
  if (!name || name.length>512 || /[\\/\u0000-\u001f]/.test(name)) throw new Error('Invalid file name.');
  const url=String(input.url || '');
  if (url.length>4096) throw new Error('File URL is too long.');
  const path=sharepointPath(url);
  if (path.split('/').pop()!==name) throw new Error('File name does not match its URL.');
  const date=String(input.modified_at || '');
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)))
    throw new Error('An ISO modified timestamp with timezone is required.');
  if (Date.parse(date)>Date.now()+86400000) throw new Error('Modified timestamp is in the future.');
  const matches=projects.filter(p=>{
    try { const prefix=sharepointPath(p.sharepoint_folder_url).replace(/\/$/,'')+'/'; return path.startsWith(prefix); }
    catch { return false; }
  });
  if (!matches.length) return {status:'unmapped'};
  if (matches.length!==1) throw new Error('Multiple projects match this file. Review folder mappings.');
  return {payload:{source_id:library+':'+item,project_id:matches[0].id,mapping_url:matches[0].sharepoint_folder_url,
    file_name:name,url,source_path:path,modified_at:new Date(date).toISOString(),source_version:String(input.version || '').slice(0,100)}};
}
