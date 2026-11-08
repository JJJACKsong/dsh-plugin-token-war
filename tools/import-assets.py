#!/usr/bin/env python3
"""Import the verified, existing binary assets from a local Git bundle.
No network unless --push is explicitly supplied. Never force-push or replace art.
"""
from __future__ import annotations
import argparse, hashlib, json, os, subprocess, sys, tempfile, uuid
from pathlib import Path, PurePosixPath

def run(args, cwd, *, capture=True):
    return subprocess.run(args,cwd=cwd,check=True,stdout=subprocess.PIPE if capture else None,
                          stderr=subprocess.PIPE if capture else None).stdout

def safe_path(value):
    return (isinstance(value,str) and bool(value) and not value.startswith('/') and
            '\\' not in value and ':' not in value and all(p not in ('','.','..') for p in value.split('/')))

def import_bundle(bundle: Path, project: Path, *, commit=False, push=False):
    if push and not commit: raise ValueError('--push requires --commit')
    project=project.resolve(); bundle=bundle.resolve(strict=True)
    repo=Path(run(['git','rev-parse','--show-toplevel'],project).decode().strip())
    branch=run(['git','symbolic-ref','--short','HEAD'],repo).decode().strip()
    if commit and run(['git','diff','--cached','--name-only'],repo).strip():
        raise ValueError('Already-staged changes exist. Import will not mix them into its commit.')
    if push:
        origin=run(['git','remote','get-url','origin'],repo).decode().strip()
        allowed={'https://github.com/JJJACKsong/dsh-games.git','https://github.com/JJJACKsong/dsh-games',
                 'git@github.com:JJJACKsong/dsh-games.git'}
        if origin not in allowed: raise ValueError('Unexpected origin; refusing automatic push.')
    manifest=json.loads((project/'assets/inventory.json').read_text())
    entries=manifest['files']; allowed_paths={e['path'] for e in entries}
    if len(allowed_paths)!=len(entries) or any(not safe_path(p) for p in allowed_paths):
        raise ValueError('Unsafe/duplicate inventory paths')
    run(['git','bundle','verify',str(bundle)],repo)
    ref='refs/token-war/import/'+uuid.uuid4().hex
    created=[]
    try:
        run(['git','fetch','--no-tags','--no-write-fetch-head',str(bundle),
             'refs/heads/token-war-assets:'+ref],repo)
        listed=set(run(['git','ls-tree','-r','--name-only',ref],repo).decode().splitlines())
        if listed!=allowed_paths|{'assets/inventory.json'}:
            raise ValueError('Bundle contains unexpected or missing files')
        incoming=json.loads(run(['git','show',ref+':assets/inventory.json'],repo))
        if incoming!=manifest: raise ValueError('Bundle inventory differs from the checked-in inventory')
        # Verify every byte and all destination paths BEFORE any file is installed.
        with tempfile.TemporaryDirectory(prefix='token-war-import-') as temp:
            temp=Path(temp)
            for e in entries:
                data=run(['git','show',ref+':'+e['path']],repo)
                if len(data)!=e['bytes'] or hashlib.sha256(data).hexdigest()!=e['sha256']:
                    raise ValueError('Invalid bytes: '+e['path'])
                dest=project/e['path']; part=project
                for name in PurePosixPath(e['path']).parts:
                    part=part/name
                    if part.is_symlink(): raise ValueError('Symlink destination: '+e['path'])
                if dest.exists() and (not dest.is_file() or dest.read_bytes()!=data):
                    raise ValueError('Existing modified asset; refusing to overwrite: '+e['path'])
                staged=temp/e['path'];staged.parent.mkdir(parents=True,exist_ok=True);staged.write_bytes(data)
            try:
                for e in entries:
                    dest=project/e['path']
                    if not dest.exists():
                        dest.parent.mkdir(parents=True,exist_ok=True)
                        fd,name=tempfile.mkstemp(prefix='.token-war-',dir=dest.parent)
                        try:
                            with os.fdopen(fd,'wb') as f:f.write((temp/e['path']).read_bytes())
                            os.chmod(name,0o644);os.replace(name,dest);created.append(dest)
                        finally:
                            if os.path.exists(name):os.unlink(name)
                run(['node','tools/check-assets.mjs','--sources'],project,capture=False)
            except Exception:
                for dest in reversed(created):dest.unlink(missing_ok=True)
                raise
        if commit:
            relpaths=[str((project/e['path']).relative_to(repo)) for e in entries]
            run(['git','add','--',*relpaths],repo)
            staged=run(['git','diff','--cached','--name-only'],repo).strip()
            if staged:run(['git','commit','-m','art(token-war): import verified existing character assets'],repo,capture=False)
            else:print('Assets are already committed; no new commit needed.')
        if push:run(['git','push','origin',branch],repo,capture=False)
        print(f'Verified {len(entries)} files; imported {len(created)} new files. No characters were added.')
        if not push:print('No network push performed.')
    finally:
        subprocess.run(['git','update-ref','-d',ref],cwd=repo,check=False,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('bundle',type=Path)
    p.add_argument('--commit',action='store_true');p.add_argument('--push',action='store_true')
    a=p.parse_args()
    try:import_bundle(a.bundle,Path(__file__).resolve().parents[1],commit=a.commit,push=a.push)
    except (ValueError,OSError,subprocess.CalledProcessError) as e:
        print('Import stopped: '+str(e),file=sys.stderr)
        if isinstance(e,subprocess.CalledProcessError) and e.stderr:print(e.stderr.decode(errors='replace'),file=sys.stderr)
        return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
