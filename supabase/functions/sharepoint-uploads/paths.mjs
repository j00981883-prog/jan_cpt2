export function destination(job) {
 const clean=s=>String(s||'').normalize('NFKC').replace(/["*:<>?\/\\|#%\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').trim();
 if(!/^[0-9a-f-]{36}$/i.test(job.id)||!/^[0-9a-f-]{36}$/i.test(job.project_id)) throw Error('Invalid upload identity');
 if(!(job.storage_path.startsWith(job.project_id+'/')||job.storage_path.startsWith('field/'+job.project_id+'/'))||job.storage_path.split('/').includes('..')) throw Error('Invalid file path');
 const project=(clean(job.project_title).slice(0,90)||'Project')+' - '+job.project_id.slice(0,8);
 const category=job.category==='Photos'||/\.(jpe?g|png|gif|webp|heic|heif)$/i.test(job.file_name)?'Photos':'Files';
 const original=clean(job.file_name).slice(0,120)||'document';
 const dot=original.lastIndexOf('.');
 const filename=dot>0?original.slice(0,dot)+'__'+job.id+original.slice(dot):original+'__'+job.id;
 const folder='JAN CPT/'+project+'/'+category;
 return {folder,file_name:filename,folder_path:'/Shared Documents/'+folder,
 url:'https://jmaait.sharepoint.com/sites/CapitalProgramming/Shared%20Documents/'+folder.split('/').map(encodeURIComponent).join('/')+'/'+encodeURIComponent(filename)};
}
