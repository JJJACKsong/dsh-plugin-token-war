import {readFile, realpath, lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export function safeRelativePath(p) {
  return typeof p === 'string' && p.length > 0 && !p.includes('\\') && !p.startsWith('/') &&
    !p.includes(':') && p.split('/').every(s => s && s !== '.' && s !== '..');
}

// Walk GIF blocks without decoding LZW: frame timing and transparency flags are
// checked here; the immutable SHA-256 also covers the complete encoded pixels.
export function gifInfo(data) {
  if (!/^GIF8[79]a$/.test(data.subarray(0,6).toString())) throw new Error('Invalid GIF signature');
  const need = (p,n) => { if (p+n>data.length) throw new Error('Truncated GIF'); };
  need(0,13);
  const width=data.readUInt16LE(6),height=data.readUInt16LE(8);
  let p=13, delay=0, transparent=false;
  const durationsMs=[],transparency=[];
  if (data[10]&128) p+=3*(2**((data[10]&7)+1));
  const subblocks=()=>{ while(true){need(p,1);const n=data[p++];if(!n)return;need(p,n);p+=n;} };
  while (p<data.length) {
    const tag=data[p++];
    if(tag===0x3b) return {width,height,durationsMs,transparency};
    if(tag===0x21){
      need(p,1);const label=data[p++];
      if(label===0xf9){
        need(p,6);if(data[p]!==4||data[p+5]!==0)throw new Error('Invalid GIF control block');
        transparent=!!(data[p+1]&1);delay=data.readUInt16LE(p+2)*10;p+=6;
      } else subblocks();
    } else if(tag===0x2c){
      need(p,9);const packed=data[p+8];p+=9;
      if(packed&128)p+=3*(2**((packed&7)+1));
      need(p,1);p++;subblocks();durationsMs.push(delay);transparency.push(transparent);
      delay=0;transparent=false;
    } else throw new Error('Unknown GIF block');
  }
  throw new Error('Missing GIF trailer');
}

export function checkBytes(data, entry) {
  if(data.length!==entry.bytes)throw new Error('File size mismatch');
  if(createHash('sha256').update(data).digest('hex')!==entry.sha256)throw new Error('SHA-256 mismatch');
  if(entry.format==='PNG'){
    if(data.length<33||data.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
       data.subarray(12,16).toString()!=='IHDR')throw new Error('Invalid PNG');
    if(data.readUInt32BE(16)!==entry.size[0]||data.readUInt32BE(20)!==entry.size[1]||data[25]!==6)
      throw new Error('Unexpected PNG dimensions or RGBA format');
  }
  if(entry.format==='GIF'){
    const g=gifInfo(data);
    if(g.width!==entry.size[0]||g.height!==entry.size[1]||
       JSON.stringify(g.durationsMs)!==JSON.stringify(entry.durationsMs)||
       !g.transparency.length||g.transparency.some(x=>!x))throw new Error('GIF timing/transparency mismatch');
  }
}

export async function verifyAssets(root, {includeSources=false}={}) {
  const base=await realpath(root);
  const inventory=JSON.parse(await readFile(path.join(base,'assets/inventory.json'),'utf8'));
  const catalog=JSON.parse(await readFile(path.join(base,'assets/catalog.json'),'utf8'));
  if(inventory.schemaVersion!==1||!Array.isArray(inventory.files))throw new Error('Invalid inventory');
  const paths=new Set(),errors=[];let checked=0;
  const required=new Set(catalog.characters.flatMap(c=>['atlas.png','portrait.png','idle.gif','move.gif','attack.gif']
    .map(name=>`assets/characters/${c.id}/${name}`)));
  for(const entry of inventory.files){
    if(!safeRelativePath(entry.path)||paths.has(entry.path)) {errors.push(`Unsafe/duplicate path: ${entry.path}`);continue;}
    paths.add(entry.path);
    if(entry.kind==='runtime')required.delete(entry.path);
    if(entry.kind!=='runtime'&&!includeSources)continue;
    try{
      let part=base;
      for(const segment of entry.path.split('/')){part=path.join(part,segment);if((await lstat(part)).isSymbolicLink())throw new Error('Symlink is not allowed');}
      const resolved=await realpath(part);
      if(!resolved.startsWith(base+path.sep))throw new Error('Path escapes project');
      checkBytes(await readFile(resolved),entry);checked++;
    }catch(e){errors.push(`${entry.path}: ${e.message}`);}
  }
  for(const p of required)errors.push(`Missing inventory entry: ${p}`);
  return {passed:errors.length===0,checked,includeSources,errors};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const root=fileURLToPath(new URL('..',import.meta.url));
    const result=await verifyAssets(root,{includeSources:process.argv.includes('--sources')});
    console.log(JSON.stringify(result,null,2));if(!result.passed)process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=1;}
}
