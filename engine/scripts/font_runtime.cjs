'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{GlobalFonts}=require('@napi-rs/canvas');
const root=path.resolve(__dirname,'../assets/fonts'),manifestPath=path.resolve(root,'../font-manifest.json');
if(!fs.existsSync(manifestPath))throw Error('Missing bundled font manifest; prepare a complete current project.');
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8')),key=Symbol.for('illustrated-2-5d.font-registry.v1');
const registry=globalThis[key]||(globalThis[key]=new Map());
function digest(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function file(name){const p=path.join(root,name),expected=manifest.files[name];if(!expected||!fs.existsSync(p))throw Error('Missing required bundled font: '+name);if(digest(p)!==expected.sha256)throw Error('Bundled font hash mismatch: '+name);return p;}
function register(filePath,family,expected){
 const p=path.resolve(filePath),name=path.basename(p).replace(/^\d+-/,''),wanted=expected||manifest.files[name]?.sha256;
 if(!wanted||!fs.existsSync(p))throw Error('Font requires a bundled or explicitly hashed file: '+name);
 const hash=digest(p);if(hash!==wanted)throw Error('Font hash mismatch: '+family);
 const old=registry.get(family);if(old){if(old.sha256!==hash)throw Error('Conflicting font family '+family+'; use a fresh renderer process for a different font set.');return old;}
 if(!GlobalFonts.registerFromPath(p,family))throw Error('Cannot register font '+family);
 const value={family,file:p,sha256:hash};registry.set(family,value);return value;
}
function coreFile(family){const name=manifest.core_aliases[family];if(!name)throw Error("Missing core font family "+family);return file(name);}
function core(){for(const[family,name]of Object.entries(manifest.core_aliases))register(file(name),family);}
function projectDefaults(declared){for(const[family,name]of Object.entries(manifest.project_defaults))if(!declared.has(family))register(file(name),family);}
function snapshot(){return{manifest_sha256:digest(manifestPath),explicit_system_font_paths_used:false,registered:[...registry.values()]};}
module.exports={file,coreFile,register,core,projectDefaults,snapshot};
