'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto'),{spawn,execFileSync}=require('node:child_process');
const{getFpmPath}=require('app-builder-lib/out/toolsets/linux');const root=path.resolve(__dirname,'..'),release=path.join(root,'release'),version=require('../package.json').version;
const run=(exe,args,cwd=root,env=process.env)=>new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd,env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${exe} failed: ${code}`)));});
async function install(source,target,mode=0o644){await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(source,target);await fs.chmod(target,mode);}
(async()=>{
 const stage=path.join(root,'build/tauri-stage');await fs.rm(stage,{recursive:true,force:true});await fs.mkdir(stage,{recursive:true});
 const binary=process.env.UFI_TAURI_BINARY||path.join(root,'build/tauri-debian-target/release/ufi-panel-linux');
 await run(binary,['--version']);
 const info=JSON.parse(execFileSync(binary,['--build-info'],{encoding:'utf8'}));if(info.version!==version)throw new Error('Native binary version mismatch');for(const [file,expected] of Object.entries(info.sources)){if(createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')!==expected)throw new Error('Stale native binary: '+file+'; rebuild Tauri first');}
 await install(binary,path.join(stage,'usr/bin/ufi-panel-linux'),0o755);
 const backend=path.join(stage,'usr/lib/ufi-panel-linux/backend');await fs.mkdir(backend,{recursive:true});
 for(const file of ['worker.cjs','backend.cjs'])await install(path.join(root,'src',file),path.join(backend,file));
 await fs.cp(path.join(root,'src/core'),path.join(backend,'core'),{recursive:true});
 for(const[from,to]of[['packaging/tauri/ufi-panel-linux.desktop','usr/share/applications/io.ufi.panel.linux.desktop'],['assets/icon.png','usr/share/icons/hicolor/512x512/apps/ufi-panel-linux.png'],['assets/icon.svg','usr/share/icons/hicolor/scalable/apps/ufi-panel-linux.svg'],['LICENSE','usr/share/licenses/ufi-panel-linux/LICENSE'],['packaging/INSTALL-TAURI.md','usr/share/doc/ufi-panel-linux/INSTALL.md']])await install(path.join(root,from),path.join(stage,to));
 await run('desktop-file-validate',[path.join(stage,'usr/share/applications/io.ufi.panel.linux.desktop')]);
 const filesArchive=`ufi-panel-linux-${version}-tauri-files.tar.gz`;
 await run('tar',['--sort=name','--owner=0','--group=0','--numeric-owner','-czf',path.join(release,filesArchive),'-C',stage,'usr']);
 const checksum=createHash('sha256').update(await fs.readFile(path.join(release,filesArchive))).digest('hex');
 const arch=path.join(root,'build/tauri-arch');await fs.mkdir(arch,{recursive:true});await install(path.join(release,filesArchive),path.join(arch,filesArchive));
 const pkgbuild=(await fs.readFile(path.join(root,'packaging/tauri/PKGBUILD.in'),'utf8')).replaceAll('@VERSION@',version).replaceAll('@APP_SHA256@',checksum);await fs.writeFile(path.join(arch,'PKGBUILD'),pkgbuild);
 await run('makepkg',['--force','--cleanbuild','--noconfirm'],arch,{...process.env,PKGDEST:release});
 const fpm=await getFpmPath();
 const common=['-s','dir','-n','ufi-panel-linux','-v',version,'--iteration','1','-C',stage,'--maintainer','UFI Panel Linux local builds <noreply@ufi-panel-linux.invalid>','--vendor','UFI Panel Linux contributors','--description','UFI-TOOLS Linux client using Tauri, system WebKitGTK and a system Node.js backend. No Electron or Chromium runtime.','--license','MIT','--after-install',path.join(root,'packaging/tauri/after-install.sh'),'--after-remove',path.join(root,'packaging/tauri/after-remove.sh'),'--force'];
 const debDeps=['nodejs (>= 18)','libc6 (>= 2.34)','libgtk-3-0 | libgtk-3-0t64','libwebkit2gtk-4.1-0 (>= 2.40)','libdbus-1-3','libgcc-s1'];
 await run(fpm,[...common,'-t','deb','-a','amd64','--deb-compression','xz','--deb-compression-level','6',...debDeps.flatMap(x=>['-d',x]),'--deb-recommends','gnome-keyring | kwalletmanager','-p',path.join(release,`ufi-panel-linux_${version}-1_amd64.deb`),'.']);
 const rpmDeps=['nodejs >= 18','glibc >= 2.34','gtk3','webkit2gtk4.1','dbus-libs','libgcc'];
 await run(fpm,[...common,'-t','rpm','-a','x86_64','--rpm-os','linux','--rpm-compression','xz','--rpm-compression-level','6','--rpm-user','root','--rpm-group','root','--rpm-digest','sha256','--rpm-rpmbuild-define','_rpmformat 4','--no-rpm-autoreqprov',...rpmDeps.flatMap(x=>['-d',x]),'-p',path.join(release,`ufi-panel-linux-${version}-1.x86_64.rpm`),'.']);
 const recipe=path.join(release,`ufi-panel-linux-${version}-arch-build`);await fs.mkdir(recipe,{recursive:true});await fs.writeFile(path.join(recipe,'PKGBUILD'),pkgbuild);await install(path.join(release,filesArchive),path.join(recipe,filesArchive));
 const names=[`ufi-panel-linux-${version}-1-x86_64.pkg.tar.zst`,`ufi-panel-linux_${version}-1_amd64.deb`,`ufi-panel-linux-${version}-1.x86_64.rpm`];
 const sizes=Object.fromEntries(await Promise.all(names.map(async n=>[n,(await fs.stat(path.join(release,n))).size])));
 await fs.writeFile(path.join(release,'package-sizes.json'),JSON.stringify({version,framework:'Tauri / system WebKitGTK',backend:'system Node.js >=18',bundledChromium:false,bytes:sizes},null,2)+'\n');console.log(JSON.stringify({result:'built',version,sizes}));
})().catch(e=>{console.error(e);process.exitCode=1});
