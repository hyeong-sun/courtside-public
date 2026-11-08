(()=>{
const $=id=>document.getElementById(id);
const boot={config:{home:'HOME',away:'AWAY',periods:4,minutes:10,ot:5,timeouts:3,autoScoreSwitch:true},score:{home:0,away:0},foul:{home:0,away:0},timeouts:{home:3,away:3},possession:'home',period:1,gameMs:600000,shotMs:24000,gameRunning:false,shotRunning:false,ended:false,logs:[],results:[]};
const roomCode=(location.pathname.match(/^\/r\/([A-Z2-9]{8})\//)||[])[1];
if(!roomCode){location.replace('/');throw new Error('Missing room code')}
const routeSection=location.pathname.split('/').pop();
const deviceKey='courtside_controller_device_'+roomCode;
let deviceId=sessionStorage.getItem(deviceKey);
if(!deviceId){deviceId=crypto.randomUUID();sessionStorage.setItem(deviceKey,deviceId)}
let state=boot,receivedAt=performance.now(),socket,authed=false,style='classic',page='board',lastDetails='',lastSettings='',audioContext,selectedGame='live';
const clock=ms=>{const s=Math.ceil(Math.max(0,ms)/1000);return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')};
const shot=ms=>String(Math.ceil(Math.max(0,ms)/1000)).padStart(2,'0');
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=t=>{const e=$('toast');e.textContent=t;e.classList.remove('hidden');clearTimeout(notify.timer);notify.timer=setTimeout(()=>e.classList.add('hidden'),2200)};
const status=document.createElement('div');status.id='liveStatus';status.style.cssText='position:fixed;right:12px;bottom:12px;background:#102032;border:1px solid #36495e;border-radius:10px;padding:9px 12px;color:#bce0ff;font:12px system-ui;z-index:4;pointer-events:none';document.body.append(status);
const audioBtn=document.createElement('button');audioBtn.className='btn';audioBtn.textContent='🔊 전광판 소리 켜기';$('fullBtn').after(audioBtn);
audioBtn.onclick=()=>{try{audioContext??=new (window.AudioContext||window.webkitAudioContext)();audioContext.resume();audioBtn.textContent='🔊 전광판 소리 활성화';notify('이 기기의 소리가 활성화됐어')}catch{notify('소리를 활성화할 수 없어')}};
function buzzer(){if(!audioContext||audioContext.state!=='running')return;const t=audioContext.currentTime,o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sawtooth';o.frequency.value=440;g.gain.setValueAtTime(.001,t);g.gain.exponentialRampToValueAtTime(.12,t+.03);g.gain.setValueAtTime(.12,t+.5);g.gain.exponentialRampToValueAtTime(.001,t+.7);o.connect(g).connect(audioContext.destination);o.start(t);o.stop(t+.72)}
const isControl=routeSection==='control';
const authBar=document.createElement('div');authBar.className='notice';authBar.innerHTML='<label for="pinInput">조작 권한 PIN</label> <input id="pinInput" type="password" inputmode="numeric" maxlength="20" placeholder="서버 PIN" style="max-width:160px;padding:9px;background:#0e1520;color:#fff;border:1px solid #354056;border-radius:8px"> <button class="btn gold" id="pinButton">조작 권한 받기</button> <button class="btn red hidden" id="takeoverButton" type="button">기존 연결 해제하고 조작권 회수</button> <span id="pinStatus" style="margin-left:8px">읽기 전용</span>';
document.querySelector('.notice').after(authBar);
$('pinInput').value=sessionStorage.getItem('court_pin_'+roomCode)||'';
$('pinButton').onclick=()=>{sessionStorage.setItem('court_pin_'+roomCode,$('pinInput').value);send({type:'auth',pin:$('pinInput').value,deviceId})};
$('takeoverButton').onclick=()=>{
 if(!confirm('기존 조작기의 권한을 해제하고 이 기기로 전환할까? 경기 중이라면 상대 조작기가 더 이상 입력할 수 없게 돼.'))return;
 send({type:'auth',pin:$('pinInput').value,deviceId,takeover:true});
};
const originalNotice=document.querySelector('.notice');originalNotice.innerHTML='경기 코드 <b>'+roomCode+'</b> · 이 경기의 점수와 기록은 다른 경기와 분리돼. <a href="/" style="color:#ffc55b">메인으로</a>'; 
function send(data){if(!socket||socket.readyState!==WebSocket.OPEN){notify('서버 연결 중이야');return}socket.send(JSON.stringify(data))}
function connect(){status.textContent='● 연결 중';socket=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws?room='+roomCode);socket.onopen=()=>{status.textContent='● 서버 연결됨';if(isControl&&$('pinInput').value)send({type:'auth',pin:$('pinInput').value,deviceId})};socket.onmessage=e=>{let msg;try{msg=JSON.parse(e.data)}catch{return}if(msg.type==='state'){state=msg.state;receivedAt=performance.now();render()}else if(msg.type==='auth'){authed=msg.ok;$('pinStatus').textContent=authed?'✓ 조작 가능':(msg.reason||'PIN 확인 필요');$('takeoverButton').classList.toggle('hidden',authed||!msg.canTakeover);$('pinStatus').style.color=authed?'#68df9a':'#ffc466';notify(authed?'조작기 인증 완료':(msg.reason||'PIN이 맞지 않아'));setPermission()}else if(msg.type==='revoked'){authed=false;setPermission();$('takeoverButton').classList.remove('hidden');$('pinStatus').textContent=msg.reason;notify(msg.reason)}else if(msg.type==='buzzer'){buzzer()}else if(msg.type==='error'){notify(msg.message)}};socket.onclose=()=>{authed=false;setPermission();status.textContent='● 연결 끊김 · 재연결 중';setTimeout(connect,1800)};socket.onerror=()=>socket.close()}
function setPermission(){$('autoScoreSwitch').disabled=!authed;document.querySelectorAll('[data-action],#applySettings,#saveResult,#clearLog').forEach(b=>{b.disabled=!authed;b.style.opacity=authed?'1':'.4'});authBar.style.display=isControl||page==='settings'||page==='history'?'block':'none';}
function renderClocks(){const elapsed=Math.min(1500,Math.max(0,performance.now()-receivedAt));const gameMs=Math.max(0,state.gameMs-(state.gameRunning?elapsed:0));const shotMs=Math.max(0,state.shotMs-(state.shotRunning?elapsed:0));$('bclock').textContent=$('sclock').textContent=clock(gameMs);$('bshot').textContent=shot(shotMs);$('speriod').textContent=(state.period>state.config.periods?'OT '+(state.period-state.config.periods):state.period+'Q')+' · '+shot(shotMs)+'초';$('startBtn').textContent=state.gameRunning||state.shotRunning?'⏸ 전체 정지':'▶ 전체 시작';$('bend').classList.toggle('hidden',!state.ended)}
function render(){const c=state.config;$('autoScoreSwitch').checked=c.autoScoreSwitch!==false;
$('bhname').textContent=$('shname').textContent=c.home;$('baname').textContent=$('saname').textContent=c.away;
for(const side of ['home','away']){const x=side==='home'?'h':'a';$('b'+x+'score').textContent=String(state.score[side]).padStart(2,'0');$('s'+x+'score').textContent=state.score[side];$('b'+x+'foul').textContent=state.foul[side];$('b'+x+'timeout').textContent='●'.repeat(Math.min(state.timeouts[side],10))||'—'}
$('bperiod').textContent=state.period>c.periods?'OT'+(state.period-c.periods):state.period;$('bpossession').textContent=state.possession==='home'?'◀ HOME':'AWAY ▶';renderClocks();
const configKey=JSON.stringify(c);if(configKey!==lastSettings&&page!=='settings'){fillSettings();lastSettings=configKey}
const details=JSON.stringify([state.events,state.logs,state.results,state.config,state.score]);if(details!==lastDetails){lastDetails=details;renderHistory()}}
function renderHistory(){
 const options=state.results||[], selector=$('gameSelect');
 const previous=selectedGame;
 selector.innerHTML='<option value="live">● 현재 경기 (실시간)</option>'+options.map((g,i)=>`<option value="${esc(g.id||'legacy-'+i)}">${esc(g.home)} ${g.hs} : ${g.as} ${esc(g.away)} · ${esc(new Date(g.when).toLocaleDateString('ko-KR'))}</option>`).join('');
 if([...selector.options].some(o=>o.value===previous))selector.value=previous;else {selectedGame='live';selector.value='live'}
 const historic=selectedGame==='live'?null:options.find((g,i)=>(g.id||'legacy-'+i)===selectedGame);
 const conf=historic?.config||state.config,home=historic?.home||conf.home,away=historic?.away||conf.away;
 const hs=historic?historic.hs:state.score.home,as=historic?historic.as:state.score.away;
 const ev=historic?(historic.events||[]):(state.events||state.logs||[]).slice().reverse();
 const events=historic?ev:ev;
 const title=historic?'저장된 경기':'진행 중인 경기';
 $('analysisSummary').innerHTML=`<div><small>${esc(title)}</small><div><strong>${esc(home)} ${hs} : ${as} ${esc(away)}</strong></div></div><div><small>득점 이벤트</small><div><strong>${events.filter(e=>e.type==='score').length}회</strong></div></div><div><small>기록된 이벤트</small><div><strong>${events.length}개</strong></div></div>`;
 const qCount=Math.max(Number(conf.periods||4),...events.map(e=>Number(e.period||1)),1);
 const qs=Array.from({length:Math.min(qCount,24)},(_,i)=>({period:i+1,home:0,away:0}));
 let h=0,a=0;const pts=[{h:0,a:0,label:'시작'}];
 for(const e of events){const ph=Number(e.period||1)-1;if(e.type==='score'&&Number.isFinite(e.delta)&&['home','away'].includes(e.side)){
   if(e.side==='home'){h+=e.delta;if(qs[ph])qs[ph].home+=e.delta}else{a+=e.delta;if(qs[ph])qs[ph].away+=e.delta}
   pts.push({h,a,label:`${e.period}Q ${e.clock}`});
 }else if((e.type==='undo'||e.type==='scoreReset')&&e.adjustments){for(const side of ['home','away']){const d=Number(e.adjustments[side])||0;if(side==='home')h+=d;else a+=d;const idx=Number(e.undonePeriod||e.period||1)-1;if(qs[idx])qs[idx][side]+=d}pts.push({h,a,label:`${e.type==='scoreReset'?'점수 초기화':'정정'} ${e.clock}`})}}
 const haveStructured=events.some(e=>e.type==='score'||e.type==='undo'||e.type==='scoreReset');
 const qrows=qs.map(q=>`<tr><td>${q.period<=conf.periods?q.period+'Q':'OT'+(q.period-conf.periods)}</td><td>${q.home}</td><td>${q.away}</td></tr>`).join('');
 $('quarterScores').innerHTML=haveStructured?`<table class="quarter-table"><thead><tr><th>쿼터</th><th>${esc(home)}</th><th>${esc(away)}</th></tr></thead><tbody>${qrows}<tr><th>기록 합계</th><th>${qs.reduce((s,q)=>s+q.home,0)}</th><th>${qs.reduce((s,q)=>s+q.away,0)}</th></tr></tbody></table>`:'<div class="chart-empty">이 경기에 구조화된 득점 이벤트가 없어.</div>';
 if(!haveStructured){$('flowGraph').innerHTML='<div class="chart-empty">득점을 입력하면 흐름 그래프가 생성돼.</div>'}else{
 const v=pts.map(p=>p.h-p.a),low=Math.min(-2,...v),high=Math.max(2,...v),span=Math.max(1,high-low),W=680,H=270,L=48,R=16,T=20,B=42,gw=W-L-R,gh=H-T-B;
 const xy=(d,i)=>[L+(pts.length===1?0:i/(pts.length-1)*gw),T+(high-d)/span*gh];
 const line=v.map((d,i)=>xy(d,i).map(x=>x.toFixed(1)).join(',')).join(' ');
 const zeroY=xy(0,0)[1];const grid=[low,0,high].filter((x,i,a)=>a.indexOf(x)===i).map(n=>`<line x1="${L}" x2="${W-R}" y1="${xy(n,0)[1]}" y2="${xy(n,0)[1]}" stroke="${n===0?'#a4acb5':'#354459'}" stroke-dasharray="${n===0?'4 4':'2 6'}"/><text x="${L-10}" y="${xy(n,0)[1]+4}" text-anchor="end" font-size="13" fill="#aabbd0">${n>0?'+':''}${n}</text>`).join('');
 $('flowGraph').innerHTML=`<svg class="flow-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="득점 발생 순서에 따른 HOME과 AWAY의 점수 차이"><rect width="${W}" height="${H}" fill="transparent"/>${grid}<polyline fill="none" stroke="#ffcb65" stroke-width="3" stroke-linejoin="round" points="${line}"/>${v.map((d,i)=>{const [x,y]=xy(d,i);return `<circle cx="${x}" cy="${y}" r="${i===v.length-1?5:3}" fill="#ffcc70"><title>${esc(pts[i].label)} · HOME ${pts[i].h} : ${pts[i].a} AWAY</title></circle>`}).join('')}<text x="${L}" y="${H-12}" fill="#93a9bf" font-size="13">시작</text><text x="${W-R}" y="${H-12}" text-anchor="end" fill="#93a9bf" font-size="13">최근 득점</text></svg><p class="muted">가로축: 득점/정정 이벤트 순서 · 세로축: HOME − AWAY 점수 차이</p>`;
 }
 const filter=$('eventFilter').value;
 const filtered=events.slice().reverse().filter(e=>filter==='all'||e.type===filter||(filter==='score'&&(e.type==='undo'||e.type==='scoreReset')));
 $('timeline').innerHTML=filtered.length?filtered.slice(0,400).map(e=>`<div class="timeline-item ${e.type==='score'?'score':''}"><span class="pill">${esc(e.period||1)}Q · ${esc(e.clock||'--:--')}</span><div><b>${esc(e.description||'기록')}</b><small>${esc(new Date(e.at).toLocaleString('ko-KR'))}</small></div><span class="current-score">${Number.isFinite(e.home)&&Number.isFinite(e.away)?e.home+' : '+e.away:''}</span></div>`).join(''):'<p class="chart-empty">표시할 이벤트가 없어.</p>';
}
function fillSettings(){for(const [id,k] of [['inputHome','home'],['inputAway','away'],['inputPeriods','periods'],['inputMinutes','minutes'],['inputOT','ot'],['inputTimeouts','timeouts']])$(id).value=state.config[k]}
function showPage(p){page=p;document.querySelectorAll('.page').forEach(x=>x.classList.toggle('hidden',x.id!==p));document.querySelectorAll('[data-page]').forEach(x=>x.classList.toggle('active',x.dataset.page===p));if(p==='settings')fillSettings();setPermission();render()}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.page){showPage(b.dataset.page);return}if(b.dataset.style){style=b.dataset.style;$('controlSurface').className=style;document.querySelectorAll('[data-style]').forEach(x=>x.classList.toggle('active',x.dataset.style===style));return}if(b.dataset.action){if(!authed)return notify('먼저 PIN을 입력해');if(b.dataset.action==='resetScore'&&!confirm('HOME과 AWAY 점수를 모두 0:0으로 초기화할까? 경기시간·샷클락·파울·작전타임은 유지되고, 초기화 내역은 기록에 남아.'))return;send({type:'action',action:b.dataset.action,side:b.dataset.side,n:Number(b.dataset.n)});return}});
$('autoScoreSwitch').addEventListener('change',e=>{if(!authed){e.target.checked=state.config.autoScoreSwitch!==false;return notify('먼저 조작 권한 PIN을 입력해')}send({type:'action',action:'setAutoScoreSwitch',n:e.target.checked?1:0})});
$('applySettings').onclick=()=>{if(!confirm('새 경기를 시작하면 현재 점수와 이벤트 로그가 초기화돼. 계속할까?'))return;const cfg={home:$('inputHome').value.trim()||'HOME',away:$('inputAway').value.trim()||'AWAY',periods:Number($('inputPeriods').value),minutes:Number($('inputMinutes').value),ot:Number($('inputOT').value),timeouts:Number($('inputTimeouts').value)};send({type:'configure',config:cfg});showPage('board')};
$('goBoard').onclick=()=>showPage('board');$('fullBtn').onclick=()=>{const full=$('app').classList.toggle('fullscreen');$('fullBtn').textContent=full?'전체 화면 해제':'전체 화면';if(full&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});else if(document.fullscreenElement)document.exitFullscreen().catch(()=>{})};
$('saveResult').onclick=()=>{if(confirm('현재 경기 점수와 기록을 저장할까?'))send({type:'saveResult'})};$('clearLog').onclick=()=>{if(confirm('현재 경기의 이벤트와 분석 기록을 정말 지울까? 복구할 수 없어.'))send({type:'clearLog'})};$('downloadLog').onclick=()=>{const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='basketball-game-log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
$('gameSelect').addEventListener('change',e=>{selectedGame=e.target.value;renderHistory()});$('eventFilter').addEventListener('change',()=>renderHistory());
let initial=routeSection==='control'?'control':routeSection==='settings'?'settings':(routeSection==='history'||location.search.includes('view=records'))?'history':'board';showPage(initial);setInterval(renderClocks,70);connect();
})();