const socket = io();
let currentRoom = null;
let localPlayerId = null;
let localState = null;
let countdown = 600;
let countdownTimer = null;

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const playerNameInput = $('#playerName');
const levelSelect = $('#levelSelect');
const customN = $('#customN');
const createBtn = $('#createBtn');
const joinBtn = $('#joinBtn');
const joinRoomId = $('#joinRoomId');
const createStartBtn = $('#startGameBtn');
const leaveBtn = $('#leaveBtn');
const gridsContainer = $('#gridsContainer');
const timeLeftEl = $('#timeLeft');
const targetNumberEl = $('#targetNumber');
const elapsedEl = $('#elapsed');
const bestEl = $('#best');
const roomInfoEl = $('#roomInfo');

levelSelect.addEventListener('change', ()=> {
  customN.style.display = levelSelect.value === 'super' ? 'inline-block' : 'none';
});

createBtn.onclick = ()=> {
  socket.emit('createRoom', { playerName: playerNameInput.value || 'Player', level: levelSelect.value, options: { customN: customN.value }});
};

joinBtn.onclick = ()=> {
  const id = joinRoomId.value.trim();
  if (!id) { alert('Nhập mã room'); return; }
  socket.emit('joinRoom', { roomId: id, playerName: playerNameInput.value || 'Player' });
};

createStartBtn.onclick = ()=> {
  if (!currentRoom) return;
  socket.emit('startGame', { roomId: currentRoom.id, level: currentRoom.level, options: currentRoom.options });
  startLocalCountdown();
};

leaveBtn.onclick = ()=> {
  if (!currentRoom) return;
  socket.emit('leaveRoom', { roomId: currentRoom.id });
  resetToLobby();
};

socket.on('connect', ()=> {
  console.log('connected as', socket.id);
  localPlayerId = socket.id;
});

socket.on('roomCreated', ({roomId, roomName, room})=> {
  console.log('roomCreated', roomId, roomName, room);
  currentRoom = room;
  showGameArea();
  renderRoomInfo();
  renderGrids();
});

socket.on('roomUpdate', (room)=> {
  console.log('roomUpdate', room);
  currentRoom = room;
  // keep localPlayerId up to date if present
  if (socket.id && currentRoom.players && currentRoom.players[socket.id]) {
    localState = currentRoom.players[socket.id];
  }
  renderRoomInfo();
  renderGrids();
});

socket.on('gameStarted', (room)=> {
  console.log('gameStarted', room);
  currentRoom = room;
  if (socket.id && currentRoom.players && currentRoom.players[socket.id]) {
    localState = currentRoom.players[socket.id];
  }
  renderRoomInfo();
  renderGrids(true);
  startLocalCountdown();
});

socket.on('playerUpdate', ({ socketId, player })=>{
  console.log('playerUpdate', socketId, player);
  if (!currentRoom) return;
  currentRoom.players[socketId] = player;
  if (socketId === socket.id) localState = player;
  renderGrids();
});

socket.on('wrongSelection', ({expected, got})=>{
  // optional visual feedback
  console.log('wrong selection, expected', expected, 'got', got);
});

socket.on('errorMsg', msg => alert(msg));

function showGameArea(){
  $('#lobby').style.display='none';
  $('#gameArea').style.display='block';
}

function resetToLobby(){
  $('#lobby').style.display='flex';
  $('#gameArea').style.display='none';
  currentRoom = null;
  localState = null;
  clearInterval(countdownTimer);
  countdown = 600;
  timeLeftEl.textContent = countdown;
}

function renderRoomInfo(){
  if (!currentRoom) return;
  roomInfoEl.innerHTML = `<strong>${escapeHtml(currentRoom.name)}</strong> — Level: ${currentRoom.level}`;
  const names = Object.values(currentRoom.players || {}).map(p=>`<span class="playerBadge">${escapeHtml(p.name)}</span>`).join(' ');
  $('#roomsInfo').innerHTML = names;
}

function renderGrids(started=false){
  if (!currentRoom) return;
  console.log('renderGrids currentRoom.players', currentRoom.players);
  gridsContainer.innerHTML = '';
  const players = Object.entries(currentRoom.players || {});
  const playersCount = players.length || 1;
  const perRow = (playersCount===4)?2:Math.min(playersCount,3);

  players.forEach(([sid, p], idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'gridWrap';
    wrap.style.flex = `1 1 280px`;
    wrap.innerHTML = `<div class="gridTitle">${escapeHtml(p.name)} ${p.bestTime?`• Best ${p.bestTime}s`:''}</div>`;
    // ensure spec/numbers fallback
    const spec = p.spec || gridSpecFromLevel(currentRoom.level, currentRoom.options && currentRoom.options.customN);
    if (!p.numbers || p.numbers.length !== spec.count) {
      p.numbers = shuffleArray(Array.from({length: spec.count}, (_,i)=>i+1));
    }
    p.spec = spec;
    const svg = makeSVGForPlayer(p, started);
    wrap.appendChild(svg);
    gridsContainer.appendChild(wrap);
  });
}

function makeSVGForPlayer(p, started){
  const spec = p.spec || gridSpecFromLevel(currentRoom.level, currentRoom.options && currentRoom.options.customN);
  const n = spec.n;
  const cellBase = spec.sizePx || 60;
  const containerWidth = Math.min(window.innerWidth-40, 900);
  const playersCount = Object.keys(currentRoom.players).length || 1;
  const perRow = (playersCount===4)?2:Math.min(playersCount,3);
  const maxWidthPerGrid = Math.floor((containerWidth - (perRow*16)) / perRow);
  const computedCell = Math.max(24, Math.floor(Math.min(cellBase, maxWidthPerGrid / n)));
  const svgSize = computedCell * n;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width', svgSize);
  svg.setAttribute('height', svgSize);
  svg.classList.add('svgGrid');

  const numbers = p.numbers || Array.from({length: spec.count}, (_,i)=>i+1);
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const idx = r*n + c;
      const val = numbers[idx] || '';
      const x = c*computedCell;
      const y = r*computedCell;
      const cellColor = randomColorForIndex(idx + (p.id?hashCodeToSeed(p.id):0));
      const textColor = '#ffffff';
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x',x);
      rect.setAttribute('y',y);
      rect.setAttribute('width',computedCell-2);
      rect.setAttribute('height',computedCell-2);
      rect.setAttribute('fill', cellColor);
      rect.setAttribute('rx', Math.max(4, Math.floor(computedCell*0.08)));
      rect.classList.add('cell');
      rect.style.cursor = 'pointer';
      rect.dataset.value = val;
      rect.dataset.player = p.id;
      // click only if local player's grid
      rect.addEventListener('click', (e)=> onCellClick(e, p.id));
      svg.appendChild(rect);
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', x + (computedCell/2));
      t.setAttribute('y', y + (computedCell/2));
      t.setAttribute('fill', textColor);
      const fontSize = Math.max(12, Math.floor((p.spec && p.spec.fontSize || 25) * (computedCell/60)));
      t.setAttribute('font-size', fontSize);
      t.classList.add('cellText');
      t.textContent = val;
      svg.appendChild(t);
      if (p.next && val < p.next) {
        rect.setAttribute('opacity', '0.35');
        t.setAttribute('opacity', '0.35');
      }
    }
  }
  return svg;
}

function onCellClick(e, ownerId){
  const rect = e.currentTarget;
  const val = parseInt(rect.dataset.value);
  // only allow clicking your own grid
  if (socket.id !== ownerId) return;
  socket.emit('cellSelected', { roomId: currentRoom.id, value: val });
}

function gridSpecFromLevel(level, customN){
  if (level === 'easy') return {n:5, count:25, sizePx:60, fontSize:25};
  if (level === 'medium') return {n:7, count:49, sizePx:60, fontSize:25};
  if (level === 'hard') return {n:10, count:100, sizePx:60, fontSize:25};
  const n = Math.max(10, parseInt(customN) || 10);
  return {n, count:n*n, sizePx:60, fontSize:25};
}

// client-side shuffle (fallback)
function shuffleArray(arr) {
  for (let i = arr.length -1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]]=[arr[j],arr[i]];
  }
  return arr;
}

// countdown handling
function startLocalCountdown(){
  clearInterval(countdownTimer);
  countdown = 600;
  timeLeftEl.textContent = countdown;
  countdownTimer = setInterval(()=>{
    countdown--;
    if (countdown < 0) {
      clearInterval(countdownTimer);
      timeLeftEl.textContent = '0';
      return;
    }
    timeLeftEl.textContent = countdown;
  },1000);
}

// helpers
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

function randomColorForIndex(seed){
  const h = (Math.abs(Math.sin(seed+1))*360) | 0;
  const s = 60 + (seed % 30);
  const l = 45 + (seed % 10);
  return `hsl(${h} ${s}% ${l}%)`;
}

function hashCodeToSeed(str){
  let h=0;
  for(let i=0;i<str.length;i++) h = (h<<5)-h + str.charCodeAt(i) | 0;
  return Math.abs(h);
}

window.addEventListener('resize', ()=> {
  if (currentRoom) renderGrids();
});
