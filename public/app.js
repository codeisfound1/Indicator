// app.js - client
const socket = io(); // default connects to same origin
const LEVELS = { easy:{n:5,max:25}, medium:{n:7,max:49}, hard:{n:10,max:100}, insane:{n:null,max:null} };
const DEFAULT_COUNTDOWN = 600;

let state = {
  roomId: null, name: null, level:'easy', insaneN:12,
  localGridSpec: null, target:1, countdown:DEFAULT_COUNTDOWN,
  timer:null, elapsedMs:0, running:false, bestSession:null, players:{}
};

const el = id => document.getElementById(id);
const randInt = (a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const shuffle = arr => { for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]} return arr; };

el('level').addEventListener('change', e=>{
  el('insaneN').style.display = e.target.value==='insane' ? 'inline-block' : 'none';
});
el('create').addEventListener('click', ()=>{
  const name = el('username').value || undefined;
  const level = el('level').value;
  socket.emit('create_room', { name, level }, res => {
    if(!res?.ok) return alert(res?.error || 'Không tạo được phòng');
    enterRoom(res.roomId, res.name);
    el('roomLevel').value = level;
  });
});
el('join').addEventListener('click', ()=>{
  const roomId = el('joinRoomInput').value.trim();
  if(!roomId) return alert('Nhập mã phòng');
  const name = el('username').value || undefined;
  socket.emit('join_room', { roomId, name }, res => {
    if(!res?.ok) return alert(res?.error || 'Không thể tham gia');
    enterRoom(res.roomId, res.name);
  });
});
el('leaveRoom').addEventListener('click', ()=> location.reload());
el('sendChat').addEventListener('click', sendChat);
el('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
el('startGame').addEventListener('click', ()=>{
  if(!state.roomId) return;
  startLocalGame();
  socket.emit('player_grid_ready', state.localGridSpec);
});
el('roomLevel').addEventListener('change', ()=> socket.emit('set_level', el('roomLevel').value));

function sendChat(){
  const v = el('chatInput').value.trim(); if(!v) return;
  socket.emit('chat', v); el('chatInput').value='';
}

function enterRoom(roomId, name){
  state.roomId = roomId; state.name = name;
  el('lobby').style.display = 'none'; el('room').style.display = 'block';
  el('roomIdDisplay').textContent = roomId;
  startKeepAlive();
}

function makeGridSpec(level, insaneN){
  let n,max;
  if(level==='insane'){ n = Math.max(10, Number(insaneN) || 12); max = n*n; }
  else { n = LEVELS[level].n; max = LEVELS[level].max; }
  const nums = shuffle(Array.from({length:max}, (_,i)=>i+1));
  const cells = [];
  for(let i=0;i<max;i++){
    cells.push({ num: nums[i], bg: randomDistinctColor() });
  }
  return { n, max, cells };
}

function randomDistinctColor(){
  const h = randInt(0,360), s=randInt(60,85), l=randInt(45,70);
  return `hsl(${h} ${s}% ${l}%)`;
}

function computeLayout(n, playersCount){
  const wrap = el('playerGrids').getBoundingClientRect();
  const containerWidth = Math.max(300, wrap.width || window.innerWidth*0.6);
  let cols = 1;
  if(playersCount===2) cols=2;
  else if(playersCount===3) cols=2;
  else if(playersCount===4) cols=2;
  const maxGridWidth = Math.floor((containerWidth - (cols-1)*12) / cols);
  const cellSize = Math.max(30, Math.floor(maxGridWidth / n));
  const cellFont = Math.max(12, Math.floor(cellSize * 0.42));
  return { cellSize, cellFont };
}

function renderGridSvg(container, spec, opts){
  const n = spec.n, cellSize = opts.cellSize, fontSize = opts.fontSize;
  const width = n*cellSize;
  const height = width;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('width', width); svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`); svg.classList.add('svgWrap');

  // clear
  container.innerHTML = '';
  container.appendChild(svg);

  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const idx = r*n + c;
      const cell = spec.cells[idx];
      const rect = document.createElementNS(svgNS,'rect');
      rect.setAttribute('x', c*cellSize); rect.setAttribute('y', r*cellSize);
      rect.setAttribute('width', cellSize); rect.setAttribute('height', cellSize);
      rect.setAttribute('fill', cell.bg); rect.setAttribute('stroke', '#999');
      svg.appendChild(rect);

      const txt = document.createElementNS(svgNS,'text');
      txt.setAttribute('x', c*cellSize + cellSize/2);
      txt.setAttribute('y', r*cellSize + cellSize/2 + fontSize*0.35);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', fontSize);
      txt.setAttribute('fill', '#111');
      txt.setAttribute('pointer-events', 'none');
      txt.textContent = cell.num;
      svg.appendChild(txt);
    }
  }

  svg.addEventListener('click', ev => {
    const rect = svg.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const c = Math.floor(x / cellSize), r = Math.floor(y / cellSize);
    if(c<0||r<0||c>=n||r>=n) return;
    const idx = r*n + c;
    onCellClick(idx, spec, svg, cellSize);
  });
}

function onCellClick(idx, spec, svg, cellSize){
  const cell = spec.cells[idx];
  if(!cell) return;
  const expected = state.target;
  if(cell.num !== expected){
    flashCell(svg, idx, cellSize, '#ff000020'); return;
  }
  markCellFound(svg, idx, cellSize);
  state.target++;
  el('targetNumber').textContent = state.target;
  socket.emit('player_progress', { current:{ target: state.target }, time: state.elapsedMs });
  if(state.target > spec.max) finishLocalGame();
}

function markCellFound(svg, idx, cellSize){
  const n = state.localGridSpec.n;
  const r = Math.floor(idx/n), c = idx % n;
  const svgNS = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(svgNS,'rect');
  overlay.setAttribute('x', c*cellSize); overlay.setAttribute('y', r*cellSize);
  overlay.setAttribute('width', cellSize); overlay.setAttribute('height', cellSize);
  overlay.setAttribute('fill', '#00000055');
  svg.appendChild(overlay);
}

function flashCell(svg, idx, cellSize, color){
  const n = state.localGridSpec.n;
  const r = Math.floor(idx/n), c = idx % n;
  const svgNS = "http://www.w3.org/2000/svg";
  const f = document.createElementNS(svgNS,'rect');
  f.setAttribute('x', c*cellSize); f.setAttribute('y', r*cellSize);
  f.setAttribute('width', cellSize); f.setAttribute('height', cellSize);
  f.setAttribute('fill', color);
  svg.appendChild(f);
  setTimeout(()=>f.remove(),300);
}

function startLocalGame(){
  const level = el('roomLevel').value || 'easy';
  const insaneN = Number(el('insaneNInput')?.value) || 12;
  const spec = makeGridSpec(level, insaneN);
  state.localGridSpec = spec;
  state.target = 1; el('targetNumber').textContent = state.target;
  state.countdown = DEFAULT_COUNTDOWN; el('countdown').textContent = state.countdown;
  state.elapsedMs = 0; el('elapsed').textContent = '0';
  state.running = true;
  const playersCount = Math.max(1, Object.keys(state.players).length || 1);
  const layout = computeLayout(spec.n, playersCount);
  const wrapper = document.createElement('div'); wrapper.className='playerGridWrap';
  wrapper.style.width = (layout.cellSize * spec.n) + 'px';
  const nameDiv = document.createElement('div'); nameDiv.className='playerName'; nameDiv.textContent = state.name + ' (you)';
  wrapper.appendChild(nameDiv);
  const gridDiv = document.createElement('div');
  wrapper.appendChild(gridDiv);
  renderGridSvg(gridDiv, spec, { cellSize: layout.cellSize, fontSize: layout.cellFont });
  el('playerGrids').innerHTML = ''; el('playerGrids').appendChild(wrapper);
  socket.emit('player_grid_ready', spec);
  if(state.timer) clearInterval(state.timer);
  const startTs = Date.now();
  let lastTick = startTs;
  state.timer = setInterval(()=>{
    const now = Date.now(); const dt = now - lastTick; lastTick = now;
    state.elapsedMs += dt;
    const secLeft = Math.max(0, state.countdown - Math.floor(state.elapsedMs/1000));
    el('countdown').textContent = secLeft; el('elapsed').textContent = Math.floor(state.elapsedMs/1000);
    if(secLeft<=0){
      clearInterval(state.timer); state.running=false; alert('Time up!');
    }
  }, 200);
}

function finishLocalGame(){
  state.running = false;
  if(state.timer) clearInterval(state.timer);
  if(!state.bestSession || state.elapsedMs < state.bestSession) state.bestSession = state.elapsedMs;
  el('bestSession').textContent = `${Math.floor(state.bestSession/1000)}s`;
  el('elapsed').textContent = Math.floor(state.elapsedMs/1000);
  socket.emit('player_progress', { current:{ doneAtMs: state.elapsedMs }, time: state.elapsedMs });
  alert(`Hoàn thành trong ${Math.floor(state.elapsedMs/1000)}s`);
}

socket.on('room_update', data => {
  if(!data) return;
  state.players = {};
  data.players.forEach(p => state.players[p.socketId] = p);
  el('roomIdDisplay').textContent = data.roomId;
  el('roomLevel').value = data.level || 'easy';
  el('ownerBadge').textContent = data.owner === socket.id ? '(Chủ phòng)' : '';
  renderOtherPlayers();
});

socket.on('chat', m => {
  const node = document.createElement('div');
  node.textContent = `[${new Date(m.ts).toLocaleTimeString()}] ${m.from}: ${m.msg}`;
  el('chatLog').appendChild(node); el('chatLog').scrollTop = el('chatLog').scrollHeight;
});

socket.on('player_progress', info => { renderOtherPlayers(); });

function renderOtherPlayers(){
  const container = el('playerGrids');
  const local = Array.from(container.children).find(c => c.querySelector('.playerName')?.textContent?.includes('(you)'));
  const snapshots = [];
  for(const [sid,p] of Object.entries(state.players)){
    if(p.name === state.name) continue;
    snapshots.push({ sid, ...p });
  }
  container.innerHTML = '';
  if(local) container.appendChild(local);
  const playersCount = snapshots.length + (local?1:0);
  snapshots.forEach(p=>{
    const wrap = document.createElement('div'); wrap.className='playerGridWrap';
    const nameDiv = document.createElement('div'); nameDiv.className='playerName'; nameDiv.textContent = p.name;
    wrap.appendChild(nameDiv);
    const gridDiv = document.createElement('div');
    if(p.gridSpec){
      const layout = computeLayout(p.gridSpec.n, Math.max(1, playersCount));
      renderGridSvg(gridDiv, p.gridSpec, { cellSize: Math.max(20, Math.floor(layout.cellSize*0.6)), fontSize: Math.max(10, Math.floor(layout.cellFont*0.6)) });
    } else {
      gridDiv.textContent = 'Waiting...';
    }
    const info = document.createElement('div'); info.textContent = `Best: ${p.bestTime ? Math.floor(p.bestTime/1000)+'s' : '—'}`;
    wrap.appendChild(gridDiv); wrap.appendChild(info);
    container.appendChild(wrap);
  });
}

function startKeepAlive(){ setInterval(()=>socket.emit('keepalive'), 10000); }

el('targetNumber').textContent='—'; el('countdown').textContent=DEFAULT_COUNTDOWN;
