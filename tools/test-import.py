from pathlib import Path
import shutil,json,subprocess,hashlib,tempfile,sys,argparse
root=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('bundle',type=Path);args=p.parse_args();bundle=args.bundle.resolve(strict=True)
manifest=json.loads((root/'assets/inventory.json').read_text())
def git(*args,cwd,check=True):
 return subprocess.run(['git',*args],cwd=cwd,check=check,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
report={'bundleSha256':hashlib.sha256(bundle.read_bytes()).hexdigest(),'bundleBytes':bundle.stat().st_size,'cases':[]}
with tempfile.TemporaryDirectory(prefix='tw-import-test-') as t:
 repo=Path(t);project=repo/'games/dsh-plugin-token-war';shutil.copytree(root,project,ignore=shutil.ignore_patterns('*.png','*.gif','*.zip','__pycache__'))
 git('init','-b','main',cwd=repo);git('config','user.name','Import test',cwd=repo);git('config','user.email','import-test@localhost',cwd=repo);git('add','.',cwd=repo);git('commit','-m','fixture text checkout',cwd=repo)
 (repo/'unrelated.txt').write_text('leave my unrelated file alone')
 cmd=[sys.executable,str(project/'tools/import-assets.py'),str(bundle),'--commit']
 first=subprocess.run(cmd,cwd=repo,capture_output=True,text=True);assert first.returncode==0,first.stderr
 assert all((project/e['path']).is_file() for e in manifest['files'])
 assert (repo/'unrelated.txt').read_text()=='leave my unrelated file alone'
 report['cases'].append({'name':'import_all_61_and_commit_without_touching_unrelated_files','passed':True})
 head=git('rev-parse','HEAD',cwd=repo).stdout
 second=subprocess.run(cmd,cwd=repo,capture_output=True,text=True);assert second.returncode==0,second.stderr
 assert git('rev-parse','HEAD',cwd=repo).stdout==head
 report['cases'].append({'name':'reimport_is_idempotent','passed':True})
 asset=project/manifest['files'][0]['path'];original=asset.read_bytes();asset.write_bytes(b'corrupt but preserve me')
 third=subprocess.run(cmd,cwd=repo,capture_output=True,text=True);assert third.returncode!=0 and 'refusing to overwrite' in third.stderr
 assert asset.read_bytes()==b'corrupt but preserve me'
 report['cases'].append({'name':'modified_assets_are_not_overwritten','passed':True});asset.write_bytes(original)
 git('remote','add','origin','https://github.com/example/unrelated.git',cwd=repo)
 fourth=subprocess.run(cmd+['--push'],cwd=repo,capture_output=True,text=True);assert fourth.returncode!=0 and 'Unexpected origin' in fourth.stderr
 report['cases'].append({'name':'unexpected_push_destination_is_refused','passed':True})
 assert not git('for-each-ref','refs/token-war',cwd=repo).stdout.strip()
 report['cases'].append({'name':'temporary_git_refs_are_cleaned_up','passed':True})
report['passed']=all(c['passed'] for c in report['cases']);print(json.dumps(report,indent=2))
(root/'docs/import-check.json').write_text(json.dumps(report,indent=2)+'\n')
