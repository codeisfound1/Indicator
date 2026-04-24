// Client-side: responsible for grid generation, SVG drawing, random colors, numbering, UI, socket comms.
const socket = io();
const LEVELS = {
  easy: {n:5, max:25},
  medium: {n:7, max:49},
  hard: {n:10, max:100},
  insane: {n:null, max:null}
};
const DEFAULT_COUNTDOWN = 600; // seconds
let state = {
  roomId: null,
  name: null,
  level: 'easy',
  insaneN: 12,
  localGridSpec: null,
  target: 1,
  countdown: DEFAULT_COUNTDOWN,
  timer: null,
  elapsedMs: 0,
  running: false,
  bestSession: null,
  players: {}
};

function el(id){return document.getElementById(id);}
function randInt(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]]} return arr; }

// UI bindings
el('level').addEventListener('change', e=>{
  const v=e.target.value;
  el('insaneN').style.display = v==='insane' ? 'inline-block' : 'none';
});
el('create').addEventListener('click', ()=>{
  const name = el('username').value || undefined;
  const level = el('level').value;
  const n = parseInt(el('insaneNInput').value) || 12;
  socket.emit('create_room', {name, level}, (res)=>{
    if(res.ok){ enterRoom(res.roomId, res.name); el('roomLevel').innerHTML = makeLevelOptions(level); el('roomLevel').value = level; }
    else alert(res.error);
  });
});
el('join').addEventListener('click', ()=>{
  const roomId = el('joinRoomInput').value.trim();
  if(!roomId) return alert('Nhập mã phòng');
  const name = el('username').value || undefined;
  socket.emit('join_room', {roomId, name}, (res)=>{
    if(res.ok){ enterRoom(res.roomId, res.name); el('roomLevel').value = el('level').value; }
    else alert(res.error);
  });
});
el('leaveRoom').addEventListener('click', ()=> location.reload());
el('sendChat').addEventListener('click', sendChat);
el('chatInput').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });

el('roomLevel').addEventListener('change', ()=>{
  socket.emit('set_level', el('roomLevel').value);
});

// start game right away for simplicity
el('startGame').addEventListener('click', ()=>{
  startLocalGame();
  // notify server grid ready
  socket.emit('player_grid_ready', state.localGridSpec);
});

function sendChat(){
  const v = el('chatInput').value.trim();
  if(!v) return;
  socket.emit('chat', v);
  el('chatInput').value = '';
}

function enterRoom(roomId, name){
  state.roomId = roomId;
  state.name = name;
  el('lobby').style.display='none';
  el('room').style.display='block';
  el('roomIdDisplay').textContent = roomId;
  el('roomLevel').innerHTML = makeLevelOptions(state.level);
  startKeepAlive();
}

function makeLevelOptions(selected){
  return `
    <option value="easy">Dễ (5x5)</option>
    <option value="medium">Trung bình (7x7)</option>
    <option value="hard">Khó (10x10)</option>
    <option value="insane">Siêu khó (NxN)</option>
  `;
}

// GRID GENERATION
function makeGridSpec(level, insaneN){
  let n, max;
  if(level==='insane'){ n = Math.max(10, parseInt(insaneN)||12); max = n*n; }
  else { n = LEVELS[level].n; max = LEVELS[level].max; }
  // generate numbers 1..max in random order
  const nums = shuffle(Array.from({length:max}, (_,i)=>i+1));
  // generate unique colors for each cell, ensuring number color is different from cell background: we'll render number as black; ensure bg not black-ish.
  const cells = [];
  for(let i=0;i<max;i++){
    const bg = randomDistinctColor();
    cells.push({num: nums[i], bg});
  }
  return {n, max, cells};
}

function randomDistinctColor(){
  // pick HSL with good saturation/lightness to contrast black/white numbers
  const h = randInt(0,360);
  const s = randInt(60,85);
  const l = randInt(45,70);
  return `hsl(${h} ${s}% ${l}%)`;
}

// Render SVG grid for a player
function renderGridSvg(container, spec, opts){
  // opts: cellSize, fontSize
  const n = spec.n;
  const cellSize = opts.cellSize;
  const fontSize = opts.fontSize;
  const width = n * cellSize;
  const height = width;
  // create svg
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.classList.add('svgWrap');

  // create defs for border stroke style
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const idx = r*n + c;
      const cell = spec.cells[idx];
      // rect
      const rect = document.createElementNS(svgNS,'rect');
      rect.setAttribute('x', c*cellSize);
      rect.setAttribute('y', r*cellSize);
      rect.setAttribute('width', cellSize);
      rect.setAttribute('height', cellSize);
      rect.setAttribute('fill', cell.bg);
      rect.setAttribute('stroke', '#999');
      rect.setAttribute('data-idx', idx);
      rect.setAttribute('rx', Math.max(2, cellSize*0.05));
      svg.appendChild(rect);

      // number text (centered)
      const txt = document.createElementNS(svgNS,'text');
      txt.setAttribute('x', c*cellSize + cellSize/2);
      txt.setAttribute('y', r*cellSize + cellSize/2 + fontSize*0.35);
      txt.setAttribute('text-anchor', 'middle');
      txt.setAttribute('font-size', fontSize);
      txt.setAttribute('fill', '#111'); // ensure contrast
      txt.setAttribute('pointer-events', 'none');
      txt.textContent = cell.num;
      svg.appendChild(txt);
    }
  }

  // enable clicks: attach listener to svg and compute cell by mouse pos
  svg.addEventListener('click', (ev)=>{
    const rect = svg.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const c = Math.floor(x / cellSize);
    const r = Math.floor(y / cellSize);
    if(c<0||r<0||c>=n||r>=n) return;
    const idx = r*n + c;
    const cell = spec.cells[idx];
    onCellClick(idx, spec, svg, cellSize, fontSize);
  });

  container.innerHTML = '';
  container.appendChild(svg);
}

// stateful click handling for solving sequence
function onCellClick(idx, spec, svg, cellSize, fontSize){
  const cell = spec.cells[idx];
  const expectedNum = state.target;
  if(cell.num !== expectedNum) {
    // optional: flash
    flashCell(svg, idx, cellSize, '#ff000020');
    return;
  }
  // mark cell as found: overlay check / change stroke
  markCellFound(svg, idx, cellSize);
  state.target++;
  el('targetNumber').textContent = state.target;
  // if finished
  if(state.target > spec.max){
    finishLocalGame();
  } else {
    // notify server progress
    socket.emit('player_progress', { current: { target: state.target }, time: state.elapsedMs });
  }
}

function markCellFound(svg, idx, cellSize){
  const n = state.localGridSpec.n;
  const r = Math.floor(idx/n), c=Math.floor(idx % n);
  const svgNS = "http://www.w3.org/2000/svg";
  const overlay = document.createElementNS(svgNS,'rect');
  overlay.setAttribute('x', c*cellSize);
  overlay.setAttribute('y', r*cellSize);
  overlay.setAttribute('width', cellSize);
  overlay.setAttribute('height', cellSize);
  overlay.setAttribute('fill', '#00000055');
  svg.appendChild(overlay);
}

function flashCell(svg, idx, cellSize, color){
  const n = state.localGridSpec.n;
  const r = Math.floor(idx/n), c=Math.floor(idx % n);
  const svgNS = "http://www.w3.org/2000/svg";
  const f = document.createElementNS(svgNS,'rect');
  f.setAttribute('x', c*cellSize);
  f.setAttribute('y', r*cellSize);
  f.setAttribute('width', cellSize);
  f.setAttribute('height', cellSize);
  f.setAttribute('fill', color);
  svg.appendChild(f);
  setTimeout(()=>f.remove(),300);
}

// layout calculation: determine best cellSize and font based on screen, players, and n
function computeLayout(n, playersCount){
  // base available width for grid area
  const wrap = el('playerGrids').getBoundingClientRect();
  const containerWidth = Math.max(300, wrap.width || window.innerWidth*0.6);
  // when multiple players show multiple grids: choose rows/cols: if playersCount==4 enforce 2x2
  let cols = 1;
  if(playersCount===1) cols = 1;
  else if(playersCount===2) cols = 2;
  else if(playersCount===3) cols = 2;
  else if(playersCount===4) cols = 2;
  const rows = Math.ceil(playersCount/cols);
  const maxGridWidth = Math.floor((containerWidth - (cols-1)*12) / cols);
  // constrain cell size so grid fits width
  const cellSize = Math.max(30, Math.floor(maxGridWidth / n));
  // font sizes proportionate
  const cellFont = Math.max(12, Math.floor(cellSize * 0.42)); // number in cells
  return { cellSize, cellFont };
}

// start local game: generate grid for this player, render and start timer
function startLocalGame(){
  const level = el('roomLevel').value || 'easy';
  const insaneN = parseInt(el('insaneNInput').value) || 12;
  const spec = makeGridSpec(level, insaneN);
  state.localGridSpec = spec;
  state.target = 1;
  el('targetNumber').textContent = state.target;
  state.countdown = DEFAULT_COUNTDOWN;
  el('countdown').textContent = state.countdown;
  state.elapsedMs = 0;
  el('elapsed').textContent = '0';
  state.running = true;
  // compute layout based on players count (ask server later to update players)
  const playersCount = Math.max(1, Object.keys(state.players).length || 1);
  const layout = computeLayout(spec.n, playersCount);
  // create a player grid wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'playerGridWrap';
  wrapper.style.width = (layout.cellSize * spec.n) + 'px';
  const nameDiv = document.createElement('div');
  nameDiv.className = 'playerName';
  nameDiv.textContent = state.name + ' (you)';
  wrapper.appendChild(nameDiv);
  const gridDiv = document.createElement('div');
  wrapper.appendChild(gridDiv);
  renderGridSvg(gridDiv, spec, {cellSize: layout.cellSize, fontSize: layout.cellFont});
  el('playerGrids').innerHTML = '';
  el('playerGrids').appendChild(wrapper);
  state.bestSession = state.bestSession; // preserved
  // start timers
  if(state.timer) clearInterval(state.timer);
  const startTs = Date.now();
  let lastTick = Date.now();
  state.timer = setInterval(()=>{
    const now = Date.now();
    const dt = now - lastTick;
    lastTick = now;
    state.elapsedMs += dt;
    const secLeft = Math.max(0, state.countdown - Math.floor(state.elapsedMs/1000));
    el('countdown').textContent = secLeft;
    el('elapsed').textContent = Math.floor(state.elapsedMs/1000);
    if(secLeft<=0){
      clearInterval(state.timer);
      state.running = false;
      alert('Time up!');
    }
  }, 200);
}

// finish game
function finishLocalGame(){
  state.running = false;
  if(state.timer) clearInterval(state.timer);
  const elapsedSec = Math.floor(state.elapsedMs/1000);
  el('bestSession').textContent = state.bestSession ? `${Math.floor(state.bestSession/1000)}s` : '—';
  // update best session
  if(!state.bestSession || state.elapsedMs < state.bestSession) state.bestSession = state.elapsedMs;
  el('bestSession').textContent = `${Math.floor(state.bestSession/1000)}s`;
  el('elapsed').textContent = Math.floor(state.elapsedMs/1000);
  socket.emit('player_progress', { current: { doneAtMs: state.elapsedMs }, time: state.elapsedMs });
  alert(`Hoàn thành trong ${Math.floor(state.elapsedMs/1000)}s`);
}

// update players listing and render other players' grids (basic representation: show their best time and a small snapshot)
socket.on('room_update', (data)=>{
  if(!data) return;
  state.players = {};
  data.players.forEach(p => state.players[p.socketId] = p);
  renderOtherPlayers();
  el('roomIdDisplay').textContent = data.roomId;
  el('roomLevel').value = data.level;
});

socket.on('chat', m=>{
  const node = document.createElement('div');
  node.textContent = `[${new Date(m.ts).toLocaleTimeString()}] ${m.from}: ${m.msg}`;
  el('chatLog').appendChild(node);
  el('chatLog').scrollTop = el('chatLog').scrollHeight;
});

socket.on('player_progress', (info)=>{
  // update display best times
  renderOtherPlayers();
});

function renderOtherPlayers(){
  // render small grid cards for other players
  const container = el('playerGrids');
  // keep local grid first
  const localWrapper = Array.from(container.children).find(c=>c.querySelector('.playerName')?.textContent?.includes('(you)'));
  container.innerHTML = '';
  if(localWrapper) container.appendChild(localWrapper);
  const players = Object.values(state.players).filter(p=>p.name !== state.name);
  const playersCount = players.length + (localWrapper?1:0);
  players.forEach(p=>{
    const wrap = document.createElement('div');
    wrap.className = 'playerGridWrap';
    const nameDiv = document.createElement('div'); nameDiv.className='playerName';
    nameDiv.textContent = p.name;
    wrap.appendChild(nameDiv);
    const gridDiv = document.createElement('div');
    // if player has gridSpec, render tiny snapshot; else placeholder
    if(p.gridSpec){
      // compute layout for small preview
      const layout = computeLayout(p.gridSpec.n, playersCount);
      renderGridSvg(gridDiv, p.gridSpec, {cellSize: Math.max(20, Math.floor(layout.cellSize*0.6)), fontSize: Math.max(10, Math.floor(layout.cellFont*0.6))});
    } else {
      gridDiv.textContent = 'Waiting...';
    }
    const info = document.createElement('div');
    info.textContent = `Best: ${p.bestTime ? Math.floor(p.bestTime/1000) + 's' : '—'}`;
    wrap.appendChild(gridDiv);
    wrap.appendChild(info);
    container.appendChild(wrap);
  });
}

// keepalive ping
function startKeepAlive(){
  setInterval(()=>{ socket.emit('keepalive'); }, 10_000);
}

// initial UI
el('targetNumber').textContent = '—';
el('countdown').textContent = DEFAULT_COUNTDOWN;
