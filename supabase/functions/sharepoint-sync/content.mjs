export const MAX_FILE_BYTES = 3_600_000;
export const MAX_BODY_BYTES = 4_850_000;
export const CONTENT_BUCKET = 'sharepoint-ai';
const TYPES = {pdf:'application/pdf',txt:'text/plain',md:'text/markdown',csv:'text/csv',json:'application/json'};

// Power Automate supplies the unmodified $content base64 string, not a data URL
// or a JSON-serialized binary object. No URL is fetched by this receiver.
export function decodeContent(input, fileName) {
  if (!Object.prototype.hasOwnProperty.call(input, 'content_base64')) return {content_status:'not_provided'};
  const ext=String(fileName||'').split('.').pop().toLowerCase();
  if (!TYPES[ext]) return {content_status:'unsupported',content_error:'Only PDF, TXT, MD, CSV and JSON files can be read.'};
  const value=input.content_base64;
  if(typeof value!=='string'||!value.length) return {content_status:'invalid',content_error:'File content must be a nonempty base64 string.'};
  if(value.length>4*Math.ceil(MAX_FILE_BYTES/3)) return {content_status:'too_large',content_error:'File content exceeds 3,600,000 bytes.'};
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0;
  if(value.length%4!==0||/[^A-Za-z0-9+/]/.test(value.slice(0,value.length-padding))) return {content_status:'invalid',content_error:'File content is not valid base64.'};
  let binary;
  try { binary=atob(value); } catch { return {content_status:'invalid',content_error:'File content is not valid base64.'}; }
  if(binary.length>MAX_FILE_BYTES) return {content_status:'too_large',content_error:'File content exceeds 3,600,000 bytes.'};
  if(!binary.length||btoa(binary)!==value) return {content_status:'invalid',content_error:'File content is not canonical base64.'};
  const bytes=Uint8Array.from(binary,char=>char.charCodeAt(0));
  if(ext==='pdf'){
    if(!/^%PDF-\d\.\d/.test(binary.slice(0,8))) return {content_status:'invalid',content_error:'The supplied file does not have a PDF header.'};
  }else{
    try {
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Binary data');
    }catch{return {content_status:'invalid',content_error:'Text files must contain UTF-8 text, not binary data.'};}
  }
  return {content_status:'ready',bytes,extension:ext,contentType:TYPES[ext]};
}

async function sha256(value){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
}

export async function contentPath(payload,content){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.project_id)) throw new Error('Invalid project identity.');
  const [source,version,hash]=await Promise.all([sha256(payload.source_id),sha256(payload.modified_at+'\n'+payload.source_version),sha256(content.bytes)]);
  return `${payload.project_id}/${source}/${version}/${hash}.${content.extension}`;
}

export function sameSourceVersion(record,payload){
  return !!record&&!record.content_version_conflict&&record.project_id===payload.project_id&&record.source_version===payload.source_version&&
    Number.isFinite(Date.parse(record.modified_at))&&Date.parse(record.modified_at)===Date.parse(payload.modified_at)&&record.file_name===payload.file_name;
}
