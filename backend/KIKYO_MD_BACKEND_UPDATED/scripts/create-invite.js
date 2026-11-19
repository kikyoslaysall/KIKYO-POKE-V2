'use strict';
const fs=require('node:fs'); const path=require('node:path'); const crypto=require('node:crypto');
const dataDir=process.env.KIKYO_DATA_DIR || path.join(__dirname,'..','data'); const db=path.join(dataDir,'store.json');
if(!fs.existsSync(db)){console.error('No store.json yet. Start the API once, then run this script.');process.exit(1);}
const name=(process.argv[2]||'KIKYO Trainer').trim().slice(0,60); const id=(process.argv[3]||crypto.randomUUID()).trim();
const store=JSON.parse(fs.readFileSync(db,'utf8')); store.trainers ||= {}; store.invites ||= {}; store.sessions ||= {};
if(store.trainers[id]){console.error('Trainer ID already exists. Choose another ID.');process.exit(1);}
store.trainers[id]={id,displayName:name,level:1,badges:[],currency:0,guild:null,party:[],pc:[],pokedex:{seen:0,caught:0},items:[],balls:[],createdAt:new Date().toISOString()};
const code=crypto.randomBytes(24).toString('base64url'); store.invites[crypto.createHash('sha256').update(code).digest('hex')]={trainerId:id,createdAt:Date.now(),expiresAt:Date.now()+24*60*60*1000,usedAt:null};
const tmp=db+'.tmp';fs.writeFileSync(tmp,JSON.stringify(store,null,2),{mode:0o600});fs.renameSync(tmp,db);
console.log('\nKIKYO one-time invite (valid 24 hours):\n'+code+'\n\nTrainer ID: '+id+'\nGive the invite code to the intended account owner once. Do not publish it.\n');
