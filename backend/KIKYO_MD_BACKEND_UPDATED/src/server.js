'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || process.env.SERVER_PORT || 3000);
const HOST = '0.0.0.0';
const API = '/api/v1';
const DATA_DIR = process.env.KIKYO_DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const BODY_LIMIT = 256 * 1024;
const SESSION_DAYS = Math.min(30, Math.max(1, Number(process.env.SESSION_DAYS || 14)));
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) writeStore({ trainers: {}, sessions: {}, invites: {}, world: { region: 'Kanto', weather: 'Clear', timeOfDay: 'Day', events: [] } });

function readStore() { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
function writeStore(s) { const tmp = DB_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 }); fs.renameSync(tmp, DB_FILE); }
function send(res, status, data, extra = {}) { res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'x-content-type-options':'nosniff', ...extra }); res.end(JSON.stringify(data)); }
function fail(res, status, code, message) { return send(res, status, { error: { code, message } }); }
function readBody(req) { return new Promise((resolve, reject) => { let raw=''; req.on('data', c => { raw += c; if (raw.length > BODY_LIMIT) { reject(Object.assign(new Error('Body too large'), { status:413 })); req.destroy(); } }); req.on('end', () => { if (!raw) return resolve({}); try { const value=JSON.parse(raw); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); resolve(value); } catch { reject(Object.assign(new Error('Invalid JSON'), { status:400 })); } }); req.on('error', reject); }); }
function hash(v) { return crypto.createHash('sha256').update(String(v)).digest('hex'); }
function randomToken() { return crypto.randomBytes(32).toString('base64url'); }
function authFor(req) { const h=req.headers.authorization || ''; if (!h.startsWith('Bearer ')) return null; const token=h.slice(7); const s=readStore(); const session=s.sessions[hash(token)]; if (!session || session.expiresAt <= Date.now()) return null; const trainer=s.trainers[session.trainerId]; return trainer ? { store:s, trainer, session, tokenHash:hash(token) } : null; }
function requireAuth(req,res) { const a=authFor(req); if (!a) { fail(res,401,'UNAUTHORIZED','Sign in with a valid KIKYO access token.'); return null; } return a; }
const hits = new Map();
function rateLimit(req,res) { const key=(req.socket.remoteAddress || 'unknown') + ':' + req.url; const now=Date.now(); const old=(hits.get(key)||[]).filter(t=>now-t<60000); if(old.length>=30) { fail(res,429,'RATE_LIMITED','Too many requests. Wait a minute and try again.'); return false; } old.push(now); hits.set(key,old); return true; }
function cleanText(v,max=60) { return typeof v==='string' ? v.trim().slice(0,max) : ''; }

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url, `http://${req.headers.host || 'localhost'}`); const p=url.pathname;
  if (req.method==='OPTIONS') return send(res,204,{}, {'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,PUT,OPTIONS','access-control-allow-headers':'Content-Type,Authorization'});
  if (!rateLimit(req,res)) return;
  if (req.method==='GET' && (p==='/health'||p===`${API}/health`)) return send(res,200,{ok:true,service:'KIKYO MD App API',version:'1.1.0',time:new Date().toISOString()},{'access-control-allow-origin':'*'});
  if (p.startsWith(API) && req.method==='GET' && p===`${API}/status`) return send(res,200,{ok:true,apiVersion:1,authentication:'invite-code',httpsRequiredInProduction:true,gameEngine:'not-connected',whatsappSync:'not-connected'});
  if (!p.startsWith(API)) return fail(res,404,'NOT_FOUND','Route not found.');
  let body={};
  if(['POST','PUT','PATCH'].includes(req.method)){ try { body=await readBody(req); } catch(e) { return fail(res,e.status||400,e.status===413?'BODY_TOO_LARGE':'BAD_JSON',e.status===413?'Request body is too large.':'Send a valid JSON object.'); } }

  // A single-use invite is generated from the server console, never embedded in the APK.
  if(req.method==='POST' && p===`${API}/auth/redeem-invite`){
    const code=cleanText(body.code,100); if(!code) return fail(res,400,'CODE_REQUIRED','Enter your one-time invite code.');
    const store=readStore(); const invite=store.invites[hash(code)];
    if(!invite || invite.usedAt || invite.expiresAt<Date.now()) return fail(res,401,'INVALID_INVITE','This invite is invalid, expired, or already used.');
    const trainer=store.trainers[invite.trainerId]; if(!trainer) return fail(res,404,'TRAINER_NOT_FOUND','Trainer profile was not provisioned.');
    invite.usedAt=Date.now(); const accessToken=randomToken(); const expiresAt=Date.now()+SESSION_DAYS*86400000;
    store.sessions[hash(accessToken)]={trainerId:trainer.id,expiresAt,createdAt:Date.now()}; writeStore(store);
    return send(res,200,{accessToken,tokenType:'Bearer',expiresAt:new Date(expiresAt).toISOString(),trainer:{id:trainer.id,displayName:trainer.displayName}});
  }
  if(req.method==='POST' && p===`${API}/auth/logout`){ const a=requireAuth(req,res); if(!a)return; delete a.store.sessions[a.tokenHash]; writeStore(a.store); return send(res,200,{ok:true}); }
  const a=requireAuth(req,res); if(!a)return; const {trainer,store}=a;
  if(req.method==='GET' && p===`${API}/me`) return send(res,200,{trainer:{id:trainer.id,displayName:trainer.displayName,level:trainer.level,badges:trainer.badges,currency:trainer.currency,guild:trainer.guild||null,createdAt:trainer.createdAt}});
  if(req.method==='GET' && p===`${API}/pokemon/collection`) return send(res,200,{party:trainer.party||[],pc:trainer.pc||[],pokedex:trainer.pokedex||{seen:0,caught:0},updatedAt:trainer.updatedAt||null});
  if(req.method==='POST' && p===`${API}/pokemon/party`){
    if(!Array.isArray(body.party)||body.party.length>6||body.party.some(x=>typeof x!=='string'||x.length>80)) return fail(res,400,'INVALID_PARTY','party must be an array of up to six Pokémon identifiers.');
    // This only stores identifiers already present in the trainer collection; it cannot create Pokémon.
    const owned=new Set([...(trainer.party||[]),...(trainer.pc||[])].map(x=>typeof x==='string'?x:x.id));
    if(body.party.some(x=>!owned.has(x))) return fail(res,400,'POKEMON_NOT_OWNED','Party can only contain Pokémon already owned by this trainer.');
    trainer.party=body.party; trainer.updatedAt=new Date().toISOString(); writeStore(store); return send(res,200,{ok:true,party:trainer.party});
  }
  if(req.method==='GET' && p===`${API}/inventory`) return send(res,200,{items:trainer.items||[],balls:trainer.balls||[]});
  if(req.method==='GET' && p===`${API}/world`) return send(res,200,store.world);
  if(req.method==='GET' && p===`${API}/regions`) return send(res,200,{regions:['Kanto','Johto','Hoenn','Sinnoh'].map((name,i)=>({name,unlocked:i===0}))});
  if(req.method==='GET' && p===`${API}/battles`) return send(res,200,{available:[],engineStatus:'not-connected',message:'Battle service must be integrated with the authoritative KIKYO game engine.'});
  if(req.method==='GET' && p===`${API}/pve/progress`) return send(res,200,{leaders:trainer.pveLeaders||[],engineStatus:'not-connected'});
  if(req.method==='GET' && p===`${API}/raids`) return send(res,200,{raids:[],engineStatus:'not-connected'});
  if(req.method==='GET' && p===`${API}/league`) return send(res,200,{season:null,ranking:[],rewards:[],engineStatus:'not-connected'});
  if(req.method==='GET' && p===`${API}/guild`) return send(res,200,{guild:trainer.guild||null});
  if(req.method==='POST' && /^\/api\/v1\/battles\/[^/]+\/(actions|forfeit)$/.test(p)) return fail(res,501,'GAME_ENGINE_NOT_CONNECTED','Battle actions are disabled until the real KIKYO battle engine is connected. No rewards were changed.');
  return fail(res,404,'NOT_FOUND','API route not found.');
});
server.listen(PORT,HOST,()=>console.log(`KIKYO MD API v1.1.0 listening on ${HOST}:${PORT}`));
function shutdown(){ server.close(()=>process.exit(0)); setTimeout(()=>process.exit(1),10000).unref(); }
process.on('SIGTERM',shutdown); process.on('SIGINT',shutdown);
