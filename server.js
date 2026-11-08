 'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {performance}=require('perf_hooks');
const {WebSocketServer,WebSocket}=require('ws');
const PORT=Number(process.env.PORT||3000);
const DATA_DIR=process.env.DATA_DIR||path.join(__dirname,'room-data');
const ROOT=path.join(__dirname,'public');
const BASE_URL=(process.env.PUBLIC_URL||'https://basketball-scoreboard-wvvd.onrender.com').replace(/\/$/,'');
fs.mkdirSync(DATA_DIR,{recursive:true});
const rooms=new Map();
const defaultState=(cfg={})=>({config:{home:'HOME',away:'AWAY',periods:4,minutes:10,ot:5,timeouts:3,autoScoreSwitch:true,...cfg},score:{home:0,away:0},foul:{home:0,away:0},timeouts:{home:cfg.timeouts??3,away:cfg.timeouts??3},possession:'home',period:1,gameMs:(cfg.minutes??10)*60000,shotMs:24000,gameRunning:false,shotRunning:false,ended:false,logs:[],events:[],results:[],gameId:crypto.randomUUID(),startedAt:new Date().toISOString(),revision:0});
const pinHash=(pin,salt)=>crypto.scryptSync(String(pin),salt,32).toString('hex');
function persistRoom(code,room){try{const dest=path.join(DATA_DIR,code+'.json');const tmp=dest+'.tmp';fs.writeFileSync(tmp,JSON.stringify({code,createdAt:room.createdAt,salt:room.salt,hash:room.hash,state:room.getState()}));fs.renameSync(tmp,dest)}catch(e){console.error('Failed to save room',code,e.message)}}
function makeRoom(code,pin,config={},saved){
 const salt=saved?saved.salt:crypto.randomBytes(16).toString('hex');
 const hash=saved?saved.hash:pinHash(pin,salt);
 const createdAt=saved?saved.createdAt:new Date().toISOString();
 let state=saved?{...defaultState(saved.state?.config||{}),...saved.state,gameRunning:false,shotRunning:false}:defaultState(config);
 let controller=null,undo=[],last=performance.now(),lastSave=0,lastBroadcast=0,lastHeartbeat=performance.now();
 const clients=new Set();
 const room={code,salt,hash,createdAt,getState:()=>state,attach,tick,shutdown};
const safeNum=(x,min,max,def=0)=>Number.isFinite(Number(x))?Math.min(max,Math.max(min,Number(x))):def;
const validSide=(x)=>x==='home'||x==='away';
const clock=()=>{const s=Math.ceil(Math.max(0,state.gameMs)/1000);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const record=(t,type='system',extra={})=>{const event={id:crypto.randomUUID(),at:new Date().toISOString(),period:state.period,clock:clock(),gameMs:Math.round(state.gameMs),type,description:t,home:state.score.home,away:state.score.away,...extra};state.events.push(event);state.events=state.events.slice(-10000);state.logs.unshift(event);state.logs=state.logs.slice(0,500)};
const snapshotGame=()=>({id:state.gameId,startedAt:state.startedAt,when:new Date().toISOString(),home:state.config.home,away:state.config.away,hs:state.score.home,as:state.score.away,config:structuredClone(state.config),events:structuredClone(state.events),finalPeriod:state.period});
function saveResult(){const result=snapshotGame();const idx=state.results.findIndex(r=>r.id===state.gameId);if(idx<0)state.results.unshift(result);else state.results[idx]=result;state.results=state.results.slice(0,150);publish();save()}

function save(){persistRoom(code,room)}
function send(ws,obj){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function broadcast(obj){for(const c of clients)send(c,obj)}
function publish(){state.revision++;broadcast({type:'state',state,serverTime:Date.now()})}
function alarm(reason){broadcast({type:'buzzer',reason})}
function advance(){const now=performance.now(),dt=Math.min(2000,Math.max(0,now-last));last=now;let stop=false;if(state.gameRunning){state.gameMs=Math.max(0,state.gameMs-dt);if(state.gameMs===0){state.gameRunning=false;state.shotRunning=false;state.ended=true;record('쿼터 시간 종료');alarm('game');stop=true}}if(state.shotRunning&&!state.ended){state.shotMs=Math.max(0,state.shotMs-dt);if(state.shotMs===0){state.shotRunning=false;record('샷클락 종료');alarm('shot');stop=true}}return stop}
function action(a,side,n){if(['score','foul','timeout','possession'].includes(a)&&!validSide(side))return false;const snap=structuredClone(state);let changed=true;switch(a){
case 'score':{
  n=safeNum(n,-3,3);
  if(!Number.isInteger(n)||!n)return false;
  const before=state.score[side];
  state.score[side]=Math.max(0,before+n);
  if(state.score[side]===before)return false;
  const delta=state.score[side]-before;
  // Made basket: start the opponent's possession at 24s. Keep the existing
  // shot clock running/paused state; do not change the game clock.
  if(delta>0&&state.config.autoScoreSwitch!==false){
    state.shotMs=24000;
    state.possession=side==='home'?'away':'home';
    record(`${state.config[side]} 점수 +${delta} · 샷클락 24초 · 공격권 ${state.config[state.possession]}`,'score',{
      side,delta,automaticShotReset:true,automaticPossession:state.possession
    });
  }else{
    // Manual setting disables auto-switch; deductions never change clocks/possession.
    record(`${state.config[side]} 점수 ${delta>0?'+':''}${delta}`,'score',{side,delta});
  }
  break;
}
case 'foul':n=safeNum(n,-1,1);state.foul[side]=safeNum(state.foul[side]+n,0,99);record(`${side} 파울 ${n>0?'+':'-'}1`,'foul',{side});break;
case 'timeout':n=safeNum(n,-1,1);state.timeouts[side]=safeNum(state.timeouts[side]+n,0,20);record(`${side} 작전타임 ${n>0?'+':'-'}1`,'timeout',{side});break;
case 'possession':state.possession=side;record(`공격권 ${side}`);break;
case 'toggleBoth':if(state.gameRunning||state.shotRunning){state.gameRunning=false;state.shotRunning=false;record('전체 정지')}else if(!state.ended){state.gameRunning=state.gameMs>0;state.shotRunning=state.shotMs>0;record('전체 시작')}break;
case 'stopBoth':state.gameRunning=false;state.shotRunning=false;record('전체 정지');break;
case 'toggleGame':if(!state.ended)state.gameRunning=!state.gameRunning&&state.gameMs>0;record(`경기시간 ${state.gameRunning?'시작':'정지'}`);break;
case 'toggleShot':if(!state.ended)state.shotRunning=!state.shotRunning&&state.shotMs>0;record(`샷클락 ${state.shotRunning?'시작':'정지'}`);break;
case 'gameAdjust':n=safeNum(n,-1,1);state.gameMs=safeNum(state.gameMs+n*1000,0,3600000);state.ended=state.gameMs===0;if(state.ended){state.gameRunning=false;state.shotRunning=false}record(`경기시간 ${n>0?'+':'-'}1초`);break;
case 'shotAdjust':n=safeNum(n,-1,1);state.shotMs=safeNum(state.shotMs+n*1000,0,99000);if(!state.shotMs)state.shotRunning=false;record(`샷클락 ${n>0?'+':'-'}1초`);break;
case 'resetScore':{
  const previousScore={...state.score};
  if(previousScore.home===0&&previousScore.away===0)return false;
  state.score={home:0,away:0};
  record('양 팀 점수 초기화 (0 : 0)','scoreReset',{
    adjustments:{home:-previousScore.home,away:-previousScore.away},
    previousScore
  });
  break;
}
case 'resetShot':if(n!==14&&n!==24)return false;state.shotMs=n*1000;record(`샷클락 ${n}초 리셋`);break;
case 'resetGame':state.gameMs=(state.period>state.config.periods?state.config.ot:state.config.minutes)*60000;state.shotMs=24000;state.gameRunning=false;state.shotRunning=false;state.ended=false;record('경기시간 및 샷클락 24초 리셋');break;
case 'setAutoScoreSwitch':if(n!==0&&n!==1)return false;if(state.config.autoScoreSwitch===(n===1))return false;state.config.autoScoreSwitch=n===1;record(`득점 후 자동 전환 ${n===1?'켜짐':'꺼짐'}`);break;
case 'period':n=safeNum(n,-1,1);state.period=safeNum(state.period+n,1,state.config.periods+12);state.gameMs=(state.period>state.config.periods?state.config.ot:state.config.minutes)*60000;state.shotMs=24000;state.foul={home:0,away:0};state.gameRunning=false;state.shotRunning=false;state.ended=false;record(`쿼터 변경 ${state.period}`,'period');break;
case 'buzzer':record('수동 부저');alarm('manual');break;
case 'undo':if(!undo.length)return false;{const previous=undo.pop();const current=state;const dh=previous.score.home-current.score.home,da=previous.score.away-current.score.away;state={...previous,events:current.events,logs:current.logs,results:current.results,gameRunning:false,shotRunning:false};record('마지막 조작 취소','undo',{adjustments:{home:dh,away:da},undonePeriod:current.period})}break;
default:changed=false}
if(changed){if(a!=='undo'&&a!=='buzzer'){undo.push(snap);if(undo.length>30)undo.shift()}publish();save()}return changed}
function configure(c){const cfg={home:String(c.home||'HOME').trim().slice(0,24)||'HOME',away:String(c.away||'AWAY').trim().slice(0,24)||'AWAY',periods:safeNum(c.periods,1,12,4),minutes:safeNum(c.minutes,1,60,10),ot:safeNum(c.ot,1,30,5),timeouts:safeNum(c.timeouts,0,20,3),autoScoreSwitch:state.config.autoScoreSwitch!==false};const results=state.results;if(state.events.length&&state.events.some(e=>e.type==='score')){const old=snapshotGame();const idx=results.findIndex(r=>r.id===old.id);if(idx<0)results.unshift(old);else results[idx]=old}state=defaultState(cfg);state.results=results;undo=[];record('새 경기 생성');publish();save()}

 function authPin(candidate){const h=pinHash(candidate,salt);return crypto.timingSafeEqual(Buffer.from(h,'hex'),Buffer.from(hash,'hex'))}
 function release(ws){if(controller===ws)controller=null;ws.isController=false}
 function grant(ws,deviceId){if(controller&&controller!==ws){const prev=controller;release(prev);send(prev,{type:'revoked',reason:'다른 기기에서 조작 권한을 인수했어.'});prev.close(4001,'Controller replaced')};controller=ws;ws.isController=true;ws.deviceId=deviceId;send(ws,{type:'auth',ok:true,reason:'조작 권한 연결 성공'})}
 function attach(ws){
   clients.add(ws);ws.isController=false;ws.isAlive=true;ws.failures=0;
   send(ws,{type:'state',state,serverTime:Date.now()});
   ws.on('pong',()=>{ws.isAlive=true});
   ws.on('message',raw=>{if(raw.length>8192)return;let msg;try{msg=JSON.parse(raw)}catch{return}
    if(msg.type==='auth'){
      if(ws.failures>=8){send(ws,{type:'auth',ok:false,reason:'PIN 입력 횟수 초과. 페이지를 다시 열어 잠시 후 시도해.'});return}
      const candidate=typeof msg.pin==='string'&&msg.pin.length<=64?msg.pin:'';
      if(!authPin(candidate)){ws.failures++;send(ws,{type:'auth',ok:false,reason:'PIN이 일치하지 않아.',canTakeover:false});return}
      const deviceId=typeof msg.deviceId==='string'&&/^[a-zA-Z0-9-]{16,100}$/.test(msg.deviceId)?msg.deviceId:'';
      if(controller&&controller.readyState!==WebSocket.OPEN)release(controller);
      if(controller&&controller!==ws&&controller.deviceId!==deviceId&&!msg.takeover){send(ws,{type:'auth',ok:false,reason:'다른 조작기가 연결 중이야. 본인 기기라면 조작권 회수를 선택해.',canTakeover:true});return}
      grant(ws,deviceId);return
    }
    if(!ws.isController||controller!==ws){send(ws,{type:'error',message:'조작 PIN 인증이 필요해.'});return}
    advance();
    if(msg.type==='action')action(msg.action,msg.side,msg.n);
    else if(msg.type==='configure')configure(msg.config||{});
    else if(msg.type==='saveResult')saveResult();
    else if(msg.type==='clearLog'){state.logs=[];state.events=[];publish();save()}
   });
   ws.on('close',()=>{clients.delete(ws);release(ws)});
   ws.on('error',()=>{release(ws)})
 }
 function tick(){const stop=advance(),now=performance.now();if(clients.size&&now-lastBroadcast>180){publish();lastBroadcast=now}if(stop||((state.gameRunning||state.shotRunning)&&now-lastSave>3000)){save();lastSave=now}if(now-lastHeartbeat>10000){for(const ws of clients){if(!ws.isAlive){ws.terminate();continue}ws.isAlive=false;ws.ping()}lastHeartbeat=now}for(const ws of clients){if(ws.readyState!==WebSocket.OPEN){clients.delete(ws);release(ws)}}}
 function shutdown(){save();for(const ws of clients)ws.close()}
 return room;
}
for(const filename of fs.readdirSync(DATA_DIR)){
 if(!/^[A-Z2-9]{8}\.json$/.test(filename))continue;
 try{const s=JSON.parse(fs.readFileSync(path.join(DATA_DIR,filename),'utf8'));if(!s.salt||!s.hash||!s.state)continue;rooms.set(s.code,makeRoom(s.code,null,{},s))}catch(e){console.error('Room load error',filename,e.message)}
}
const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
function social(html,kind,code){
 const desc=kind==='board'?'실시간 농구 경기 전광판':kind==='control'?'경기 조작기 · PIN 인증 필요':'경기 운영과 기록 분석을 한곳에서';
 const title=kind==='board'?'COURTSIDE | 농구 전광판':kind==='control'?'COURTSIDE | 농구 조작기':'COURTSIDE | 무료 농구 점수판';
 const route=code?'/r/'+code+'/'+kind:'/';const img=kind==='control'?'preview-control.png':'preview-board.png';
 const tags=[`<meta name="description" content="${esc(desc)}">`,'<meta property="og:type" content="website">',`<meta property="og:title" content="${esc(title)}">`,`<meta property="og:description" content="${esc(desc)}">`,`<meta property="og:url" content="${esc(BASE_URL+route)}">`,`<meta property="og:image" content="${esc(BASE_URL+'/'+img)}">`,'<meta name="twitter:card" content="summary_large_image">',`<meta name="twitter:title" content="${esc(title)}">`,`<meta name="twitter:description" content="${esc(desc)}">`,`<meta name="twitter:image" content="${esc(BASE_URL+'/'+img)}">`].join('\n');
 return html.replace(/<title>[^<]*<\/title>/,`<title>${esc(title)}</title>`).replace('</head>',tags+'\n</head>')
}
const server=http.createServer(async(req,res)=>{
 const sendJson=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data))};
 const url=new URL(req.url,'http://localhost'),pathname=url.pathname;
 if(pathname==='/api/rooms'&&req.method==='POST'){
  if(rooms.size>=100)return sendJson(503,{error:'서버의 경기 생성 한도에 도달했어.'});
  const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim();
  if(!allowCreate(ip))return sendJson(429,{error:'잠시 후 새 경기를 만들어줘. (시간당 5회 제한)'});
  let data='';for await(const chunk of req){data+=chunk;if(data.length>2048)return sendJson(413,{error:'요청이 너무 커.'})}
  let input;try{input=JSON.parse(data||'{}')}catch{return sendJson(400,{error:'잘못된 요청이야.'})}
  const home=String(input.home||'HOME').trim().slice(0,24)||'HOME',away=String(input.away||'AWAY').trim().slice(0,24)||'AWAY';
  const codeChars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let code;
  do{code=Array.from(crypto.randomBytes(8),x=>codeChars[x%codeChars.length]).join('')}while(rooms.has(code));
  const pin=String(crypto.randomInt(0,1000000)).padStart(6,'0');
  const room=makeRoom(code,pin,{home,away});rooms.set(code,room);persistRoom(code,room);
  return sendJson(201,{code,pin,board:'/r/'+code+'/board',control:'/r/'+code+'/control',message:'PIN은 생성 시 한 번만 표시돼. 별도로 보관해줘.'})
 }
 if(pathname==='/api/rooms'&&req.method!=='POST')return sendJson(405,{error:'허용되지 않은 요청'});
 if(req.method!=='GET'){res.writeHead(405);return res.end()}
 const match=pathname.match(/^\/r\/([A-Z2-9]{8})\/(board|control|settings|history)$/);
 if(match&&!rooms.has(match[1]))return sendJson(404,{error:'경기를 찾을 수 없어. 경기 코드와 서버 보존 상태를 확인해줘.'});
 if(pathname==='/board'||pathname==='/control'||pathname==='/history'||pathname==='/settings'){
  res.writeHead(302,{Location:'/'});return res.end()
 }
 const file=match?'index.html':pathname==='/'?'landing.html':pathname.slice(1);
 const target=path.resolve(ROOT,file);
 if(!target.startsWith(ROOT+path.sep)){res.writeHead(403);return res.end()}
 fs.readFile(target,(err,body)=>{if(err){res.writeHead(404);return res.end('Not found')};res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(file==='index.html'||file==='landing.html'?Buffer.from(social(body.toString('utf8'),match?match[2]:'home',match?.[1])):body)})
});
const createWindows=new Map();
function allowCreate(ip){const now=Date.now(),list=(createWindows.get(ip)||[]).filter(t=>now-t<3600000);if(list.length>=5)return false;list.push(now);createWindows.set(ip,list);return true}
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
 const u=new URL(req.url,'http://localhost');if(u.pathname!=='/ws'){socket.destroy();return}
 const code=u.searchParams.get('room');if(!/^[A-Z2-9]{8}$/.test(code||'')||!rooms.has(code)){socket.destroy();return}
 const origin=req.headers.origin;if(origin){try{if(new URL(origin).host!==req.headers.host){socket.destroy();return}}catch{socket.destroy();return}}
 wss.handleUpgrade(req,socket,head,ws=>rooms.get(code).attach(ws))
});
setInterval(()=>{for(const room of rooms.values())room.tick()},60);
server.listen(PORT,'0.0.0.0',()=>console.log(`COURTSIDE v1.0 running on port ${PORT}; rooms=${rooms.size}`));
process.on('SIGTERM',()=>{for(const room of rooms.values())room.shutdown();server.close(()=>process.exit(0))});
