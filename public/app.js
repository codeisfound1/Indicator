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
  socket.emit('joinRoom', { roomId: joinRoomId.value.trim(), playerName: playerNameInput.value || 'Player' });
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

socket.on('roomCreated', ({roomId, roomName, room})=> {
  currentRoom = room;
  showGameArea();
  renderRoomInfo();
});

socket.on('roomUpdate', (room)=> {
  currentRoom = room;
  renderRoomInfo();
  renderGrids(); // show players present
});

socket.on('gameStarted', (room)=> {
  currentRoom = room;
  renderRoomInfo();
  renderGrids(true);
  startLocalCountdown();
});

// individual player update
socket.on('playerUpdate', ({ socketId, player })=>{
  if (!currentRoom) return;
  currentRoom.players[socketId] = player;
  renderGrids();
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
  // players
  const names = Object.values(currentRoom.players).map(p=>`<span class="playerBadge">${escapeHtml(p.name)}</span>`).join(' ');
  $('#roomsInfo').innerHTML = names;
}

function renderGrids(started=false){
  if (!currentRoom) return;
  gridsContainer.innerHTML = '';
  const players = Object.entries(currentRoom.players);
  // layout: if 4 players -> 2x2 fixed. else stack in row wrap.
  const perRow = (players.length===4)?2:players.length;
  players.forEach(([sid, p], idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'gridWrap';
    wrap.style.flex = `1 1 280px`;
    wrap.innerHTML = `<div class="gridTitle">${escapeHtml(p.name)} ${p.bestTime?`• Best ${p.bestTime}s`:''}</div>`;
    const svg = makeSVGForPlayer(p, started);
    wrap.appendChild(svg);
    gridsContainer.appendChild(wrap);
  });
}

function makeSVGForPlayer(p, started){
  const spec = p.spec || gridSpecFromLevel(currentRoom.level, currentRoom.options && currentRoom.options.customN);
  const n = spec.n;
  const cellBase = spec.sizePx || 60;
  // responsive adjust: compute available width
  const containerWidth = Math.min(window.innerWidth-40, 900);
  const playersCount = Object.keys(currentRoom.players).length || 1;
  // if 2x2 layout with 4 players we halve container width for each column
  const perRow = (playersCount===4)?2:Math.min(playersCount,3);
  const maxWidthPerGrid = Math.floor((containerWidth - (perRow*16)) / perRow);
  // compute cell size so that whole grid fits width
  const computedCell = Math.max(24, Math.floor(Math.min(cellBase, maxWidthPerGrid / n)));
  const svgSize = computedCell * n;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('width', svgSize);
  svg.setAttribute('height', svgSize);
  svg.classList.add('svgGrid');

  // build color palette (unique per cell)
  const numbers = p.numbers || Array.from({length: spec.count}, (_,i)=>i+1);
  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const idx = r*n + c;
      const val = numbers[idx] || '';
      const x = c*computedCell;
      const y = r*computedCell;
      const cellColor = randomColorForIndex(idx + (p.id?hashCodeToSeed(p.id):0));
      const textColor = '#ffffff';
      // rect
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
      rect.addEventListener('click', onCellClick);
      svg.appendChild(rect);
      // text
      const t = document.createElementNS('http://www.w3.org/2000/svg','text');
      t.setAttribute('x', x + (computedCell/2));
      t.setAttribute('y', y + (computedCell/2));
      t.setAttribute('fill', textColor);
      const fontSize = Math.max(12, Math.floor((p.spec && p.spec.fontSize || 25) * (computedCell/60)));
      t.setAttribute('font-size', fontSize);
      t.classList.add('cellText');
      t.textContent = val;
      svg.appendChild(t);
      // mark selected style if already advanced
      if (p.next && val < p.next) {
        rect.setAttribute('opacity', '0.35');
        t.setAttribute('opacity', '0.35');
      }
    }
  }
  return svg;
}

function onCellClick(e){
  const rect = e.currentTarget;
  const val = parseInt(rect.dataset.value);
  const playerId = rect.dataset.player;
  // only local player's grid is interactive
  // determine local socket id
  // socket.id not immediately available until connected
  if (socket.id !== playerId) return;
  socket.emit('cellSelected', { roomId: currentRoom.id, value: val });
  // optimistic: update UI
}

function gridSpecFromLevel(level, customN){
  if (level === 'easy') return {n:5, count:25, sizePx:60, fontSize:25};
  if (level === 'medium') return {n:7, count:49, sizePx:60, fontSize:25};
  if (level === 'hard') return {n:10, count:100, sizePx:60, fontSize:25};
  const n = Math.max(10, parseInt(customN) || 10);
  return {n, count:n*n, sizePx:60, fontSize:25};
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
      // game over handling can be extended
      return;
    }
    timeLeftEl.textContent = countdown;
  },1000);
}

// helpers
function escapeHtml(s){ return (s||'').toString().replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

function randomColorForIndex(seed){
  // deterministic-ish color generator
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
