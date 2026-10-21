const clean=s=>String(s||'').normalize('NFKC').replace(/["*:<>?\/\\|#%\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').trim();
export function projectFolder(job) {
 if(!/^[0-9a-f-]{36}$/i.test(job.project_id))throw Error('Invalid project identity');
 return 'JAN CPT/'+(clean(job.project_title).slice(0,90)||'Project')+' - '+job.project_id.slice(0,8);
}
export function folderUrl(folder) {
 return 'https://jmaait.sharepoint.com/sites/CapitalProgramming/Shared%20Documents/'+folder.split('/').map(encodeURIComponent).join('/');
}
export function destination(job, savedFolder) {
 if(!/^[0-9a-f-]{36}$/i.test(job.id)||!/^[0-9a-f-]{36}$/i.test(job.project_id)) throw Error('Invalid upload identity');
 if(!(job.storage_path.startsWith(job.project_id+'/')||job.storage_path.startsWith('field/'+job.project_id+'/'))||job.storage_path.split('/').includes('..')) throw Error('Invalid file path');
 const project=savedFolder||projectFolder(job);
 if(!project.startsWith('JAN CPT/')||project.split('/').length!==2||!project.endsWith(' - '+job.project_id.slice(0,8))||/[\\\x00-\x1f]/.test(project))throw Error('Invalid destination folder');
 const category=job.category==='Photos'||/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(job.file_name)?'Photos':'Files';
 const original=clean(job.file_name).slice(0,120)||'document';
 const dot=original.lastIndexOf('.');
 const filename=dot>0?original.slice(0,dot)+'__'+job.id+original.slice(dot):original+'__'+job.id;
 const folder=project+'/'+category;
 return {folder,file_name:filename,folder_path:'/Shared Documents/'+folder,
 url:folderUrl(folder)+'/'+encodeURIComponent(filename)};
}
