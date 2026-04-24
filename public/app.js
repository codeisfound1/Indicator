const socket = io();
let currentRoom = null;
let me = {name: null, id: null};
let grids = {}; // socketId -> {n,max,numbers,colors,nextToFind,svgEl,cellSize,fontSize}
const defaultCellSize = 60; // 60px default
const defaultFontSize = 25;

function $(id){return document.getElementById(id)}

// Lobby UI
const roomsList = $('rooms');
const playerName = $('playerName');
const nameInput = $('nameInput');
const createEasy = $('createEasy');
const createMedium = $('createMedium');
const createHard = $('createHard');
const createSuper = $('createSuper');
const superN = $('superN');
const countdownInput = $('countdown');

createEasy.onclick = ()=> createRoom('easy');
createMedium.onclick = ()=> createRoom('medium');
createHard.onclick = ()=> createRoom('hard');
createSuper.onclick = ()=> createRoom('super', parseInt(superN.value,10));

$('chatInput').addEventListener('keydown', e=>{
  if (e.key === 'Enter') {
    const text = e.target.value.trim();
    if (!text || !currentRoom) return;
    socket.emit('sendChat',{roomId: currentRoom.id, text});
    e.target.value = '';
  }
});

// name change
nameInput.addEventListener('change', ()=>{
  const name = nameInput.value.trim();
  if (!name) return;
  socket.emit('setName',{name});
  playerName.textContent = name;
});

// lobby handlers
socket.on('lobbyList', list => {
  roomsList.innerHTML = '';
  list.forEach(r=>{
    const li = document.createElement('li');
    li.textContent = `${r.name} [${r.level}] (${r.players}/4)`;
    const btn = document.createElement('button');
    btn.textContent = 'Join';
    btn.onclick = ()=> socket.emit('joinRoom',{roomId: r.id});
    li.appendChild(btn);
    roomsList.appendChild(li);
  });
});

socket.on('roomJoined', ({room})=>{
  enterRoom(room);
});

socket.on('roomUpdate', room=>{
  enterRoom(room);
});

socket.on('errorMsg', m=> alert(m));

// Room UI
$('leaveRoom').onclick = ()=> {
  if (!currentRoom) return;
  socket.emit('leaveRoom',{roomId: currentRoom.id});
  leaveRoomUI();
};

$('startGame').onclick = ()=> {
  if (!currentRoom) return;
  socket.emit('startGame',{roomId: currentRoom.id});
};

socket.on('gameStarted', snapshot=>{
  currentRoom = snapshot;
  $('roomState').textContent = snapshot.state;
  // request grid data will come in separate event via room snapshot on server
  renderRoom(snapshot);
});

socket.on('tick', ({timeLeft})=>{
  $('timeLeft').textContent = formatTime(timeLeft);
});

socket.on('timeUp', snapshot=>{
  $('timeLeft').textContent = '00:00';
  alert('Time up!');
  renderRoom(snapshot);
});

socket.on('playerProgress', ({playerId, next})=>{
  // update UI small badge
  const el = document.querySelector(`#player-${playerId} .progress`);
  if (el) el.textContent = next-1;
});

socket.on('playerFinished', ({playerId, elapsed})=>{
  const el = document.querySelector(`#player-${playerId} .progress`);
  if (el) el.textContent = 'Finished';
  // show elapsed
  const p = document.querySelector(`#player-${playerId} .time`);
  if (p) p.textContent = formatTime(elapsed);
});

socket.on('allFinished', snapshot=>{
  renderRoom(snapshot);
  alert('All finished');
});

socket.on('chat', msg=>{
  const box = $('chatBox');
  const el = document.createElement('div');
  el.textContent = `${msg.from}: ${msg.text}`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
});

socket.on('roomJoined', r => renderRoom(r));
socket.on('roomUpdate', r => renderRoom(r));

function enterRoom(room){
  currentRoom = room;
  $('lobby').classList.add('hidden');
  $('room').classList.remove('hidden');
  $('roomName').textContent = room.name;
  $('roomState').textContent = room.state;
  $('levelLabel').textContent = room.level;
  renderPlayersList(room.players || []);
}

function leaveRoomUI(){
  currentRoom = null;
  $('lobby').classList.remove('hidden');
  $('room').classList.add('hidden');
  grids = {};
  $('gridsContainer').innerHTML = '';
}

function renderPlayersList(players){
  const ul = $('players');
  ul.innerHTML = '';
  players.forEach(p=>{
    const li = document.createElement('li');
    li.id = `player-${p.id}`;
    li.innerHTML = `<div class="playerLabel">${p.name} <span class="progress">0</span> <span class="time">${p.bestTime?formatTime(p.bestTime):'-'}</span></div>`;
    ul.appendChild(li);
  });
}

function renderRoom(room){
  renderPlayersList(room.players || []);
  $('roomState').textContent = room.state;
  $('timeLeft').textContent = formatTime(room.timeLeft || 0);
  // best times
  const bt = $('bestTimes'); bt.innerHTML = '';
  Object.entries(room.bestTimes||{}).forEach(([name,val])=>{
    const li = document.createElement('li'); li.textContent = `${name}: ${formatTime(val)}`; bt.appendChild(li);
  });
  // if playing, request grids from server via current snapshot: but server currently sent grids at startGame only in 'gameStarted' with snapshot including playerGrids? For simplicity, we simulate fetch by asking server to send per-player grid (not implemented separately), so the server sends 'gameStarted' earlier.
}

// helper time formatting
function formatTime(sec){
  if (sec == null) return '--:--';
  const m = Math.floor(sec/60).toString().padStart(2,'0');
  const s = Math.floor(sec%60).toString().padStart(2,'0');
  return `${m}:${s}`;
}

// create room helper
function createRoom(level, n){
  const cd = parseInt(countdownInput.value,10) || undefined;
  socket.emit('createRoom',{level, n, countdown: cd});
}

// Receiving initial room snapshot (when join/create)
socket.on('roomJoined', ({room})=>{
  enterRoom(room);
});

// The server doesn't currently send actual per-player grids content in this simplified client; we'll request them by listening to a 'gameStarted' event that includes necessary playerGrids. For demonstration we'll handle a client-side generation when receiving gameStarted.
socket.on('gameStarted', ({id, players, timeLeft, level})=>{
  // We'll request a lightweight 'gridData' from server by asking server to include it; but to keep client working with server above, assume server sends playerGrids embedded in snapshot
});

// For simulation: we handle grid rendering when server sends 'gameStarted' with full snapshot including playerGrids (server currently includes playerGrids in memory but not emitted fully — let's instead ask server to emit full snapshot via 'roomUpdate' that contains playerGrids).
socket.on('roomUpdate', room=>{
  if (room.state === 'playing' && room.playerGrids) {
    // we expect server to include playerGrids keyed by playerId
    renderGrids(room);
  }
});

// But because server above emits 'gameStarted' with roomSnapshot only, and we attached playerGrids there, add handler:
socket.on('gameStarted', room=>{
  renderGrids(room);
  $('timeLeft').textContent = formatTime(room.timeLeft);
  // set target number for local player
  if (grids[socket.id]) updateTargetNumber(grids[socket.id].nextToFind);
});

// The renderGrids function: build responsive SVG grids per player
function renderGrids(room){
  const container = $('gridsContainer');
  container.innerHTML = '';
  grids = {};
  // assume server included playerGrids in payload at key playerGrids (matching server implementation)
  const playerGrids = room.playerGrids || {};
  const playerIds = Object.keys(playerGrids);

  // compute layout: if 4 players -> 2x2 fixed
  let cols = 1;
  if (playerIds.length === 4) cols = 2;
  else if (playerIds.length === 3) cols = 2;
  else if (playerIds.length === 2) cols = 2;
  else cols = 1;

  playerIds.forEach(pid=>{
    const pg = playerGrids[pid];
    const wrapper = document.createElement('div');
    wrapper.className = 'gridWrap';
    wrapper.style.flex = `1 1 ${Math.floor(100/cols)-2}%`;
    const playerLabel = document.createElement('div');
    playerLabel.className = 'playerLabel';
    const pl = room.players.find(p=>p.id===pid);
    playerLabel.textContent = pl ? pl.name : pid;
    wrapper.appendChild(playerLabel);

    // responsive cell size calculation: try to fit in available width
    const availableWidth = Math.max(200, window.innerWidth * 0.45 / cols);
    const n = pg.n;
    let cellSize = 60;
    // adjust cell size so that grid fits within available width
    const maxGridWidth = Math.min(availableWidth, 800);
    const calcCell = Math.floor(maxGridWidth / n) - 4;
    if (calcCell > 30) cellSize = Math.min(calcCell, 80);
    else cellSize = Math.max(calcCell, 24);

    const svg = createGridSVG(pg.n, pg.numbers, pg.colors, cellSize, defaultFontSize, pid);
    wrapper.appendChild(svg);
    container.appendChild(wrapper);

    grids[pid] = {n:pg.n, max:pg.max, numbers:pg.numbers, colors:pg.colors, nextToFind:pg.nextToFind, svgEl:svg, cellSize, fontSize: defaultFontSize};
    // attach click handler
    svg.addEventListener('click', e=>{
      const target = e.target;
      if (!target.dataset?.idx) return;
      const idx = parseInt(target.dataset.idx,10);
      // send selection
      socket.emit('cellSelected',{roomId: room.id, cellIndex: idx});
    });
  });

  // set target for local player (socket.id)
  if (grids[socket.id]) updateTargetNumber(grids[socket.id].nextToFind);
}

function createGridSVG(n, numbers, colors, cellSize, fontSize, ownerId){
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS,'svg');
  svg.setAttribute('width', cellSize * n + 2);
  svg.setAttribute('height', cellSize * n + 2);
  svg.classList.add('gridSVG');

  for (let r=0;r<n;r++){
    for (let c=0;c<n;c++){
      const idx = r*n + c;
      const rect = document.createElementNS(svgNS,'rect');
      rect.setAttribute('x', c*cellSize);
      rect.setAttribute('y', r*cellSize);
      rect.setAttribute('width', cellSize);
      rect.setAttribute('height', cellSize);
      rect.setAttribute('fill', colors[idx]);
      rect.classList.add('cellRect');
      rect.dataset.idx = idx;
      svg.appendChild(rect);

      const text = document.createElementNS(svgNS,'text');
      text.setAttribute('x', c*cellSize + cellSize/2);
      text.setAttribute('y', r*cellSize + cellSize/2 + fontSize/3);
      text.setAttribute('text-anchor','middle');
      text.setAttribute('font-size', fontSize);
      text.setAttribute('fill','#000');
      text.classList.add('cellText');
      text.textContent = numbers[idx];
      svg.appendChild(text);
    }
  }
  return svg;
}

socket.on('cellCorrect', ({cellIndex, next})=>{
  // mark cell visually for this client
  const g = grids[socket.id];
  if (!g) return;
  const svg = g.svgEl;
  const rect = svg.querySelector(`rect[data-idx='${cellIndex}']`);
  if (rect) {
    rect.setAttribute('stroke','limegreen');
    rect.setAttribute('stroke-width','4');
  }
  g.nextToFind = next;
  updateTargetNumber(next);
});

socket.on('cellWrong', ({cellIndex, expected})=>{
  // flash red border
  const g = grids[socket.id];
  if (!g) return;
  const svg = g.svgEl;
  const rect = svg.querySelector(`rect[data-idx='${cellIndex}']`);
  if (rect) {
    rect.setAttribute('stroke','crimson');
    rect.setAttribute('stroke-width','4');
    setTimeout(()=>{ rect.setAttribute('stroke','#fff'); rect.setAttribute('stroke-width','2'); }, 400);
  }
});

function updateTargetNumber(next){
  $('targetNumber').textContent = next;
}

// initial player name display
socket.on('connect', ()=>{
  me.id = socket.id;
  $('playerName').textContent = 'Guest';
});

// small UX helpers
window.addEventListener('resize', ()=>{
  // Re-render grids to adapt sizes if needed
});
