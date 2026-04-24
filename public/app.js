const socket = io();

const playersContainer = document.getElementById('playersContainer');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const roomIdInput = document.getElementById('roomId');
const nameInput = document.getElementById('name');
const statusSpan = document.getElementById('status');
const levelSel = document.getElementById('level');
const customNlabel = document.getElementById('customNlabel');
const customN = document.getElementById('customN');
const playersCount = document.getElementById('playersCount');
const startBtn = document.getElementById('startBtn');
const cellSizeInput = document.getElementById('cellSize');
const fontCellInput = document.getElementById('fontCell');
const fontTargetInput = document.getElementById('fontTarget');
const countdownInput = document.getElementById('countdown');

const chatBox = document.getElementById('chatBox');
const chatInput = document.getElementById('chatInput');
const sendChat = document.getElementById('sendChat');

let localPlayerAreas = [];
let sessionBestTimes = {};
let roomConfig = null;
let amCreator = false;

levelSel.addEventListener('change', () => {
  customNlabel.style.display = levelSel.value === 'custom' ? 'inline-block' : 'none';
});

// Join / Leave
joinBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value || 'room1';
  const name = nameInput.value || 'Player';
  // build config payload from current UI (creator will set this if creating)
  const payload = {
    roomId, name,
    level: levelSel.value,
    customN: customN.value,
    countdown: countdownInput.value,
    cellSize: cellSizeInput.value,
    fontCell: fontCellInput.value,
    fontTarget: fontTargetInput.value
  };
  socket.emit('join-room', payload);
});

leaveBtn.addEventListener('click', () => {
  socket.emit('leave-room', { roomId: roomIdInput.value || 'room1' });
  statusSpan.textContent = 'Not connected';
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
  // re-enable controls
  enableLocalControls(true);
});

sendChat.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat', { roomId: roomIdInput.value || 'room1', msg });
  chatInput.value = '';
});

socket.on('room-full', ({roomId}) => {
  const d = document.createElement('div'); d.textContent = `Room ${roomId} is full (max 4).`; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('chat', ({from, msg}) => {
  const d = document.createElement('div'); d.textContent = `${from}: ${msg}`; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('room-config', (cfg) => {
  // server-sent config; apply to UI and lock controls for non-creator
  roomConfig = cfg || null;
  applyRoomConfigToUI(roomConfig);
});

socket.on('room-update', ({players, best}) => {
  const names = players ? Object.values(players) : [];
  statusSpan.textContent = `Room ${roomIdInput.value} — players: ${names.join(', ')}`;
  joinBtn.disabled = true;
  leaveBtn.disabled = false;
  enableLocalControls(false);
  // show current best in chat if any
  if (best) {
    const d = document.createElement('div');
    d.textContent = `Current best: ${best.name} — ${msToStr(best.ms)}`;
    chatBox.appendChild(d);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});

socket.on('new-best', (best) => {
  const d = document.createElement('div');
  d.textContent = `New best: ${best.name} — ${msToStr(best.ms)}`;
  chatBox.appendChild(d);
  chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('best-times', ({best}) => {
  if (best) {
    const d = document.createElement('div');
    d.textContent = `Best time: ${best.name} — ${msToStr(best.ms)}`;
    chatBox.appendChild(d);
    chatBox.scrollTop = chatBox.scrollHeight;
  }
});

// UTILS (same as before)
function randInt(min, max){ return Math.floor(Math.random()*(max-min+1))+min; }
function shuffle(arr){ for(let i=arr.length-1;i>0;i--){const j=randInt(0,i);[arr[i],arr[j]]=[arr[j],arr[i]];} return arr; }
function distinctColors(n){
  const colors = [];
  const hueStep = 360 / n;
  for(let i=0;i<n;i++){
    const h = Math.round(i*hueStep);
    const s = 60 + Math.floor(Math.random()*20);
    const l = 50 + Math.floor(Math.random()*10);
    colors.push(`hsl(${h} ${s}% ${l}%)`);
  }
  return shuffle(colors);
}
function contrastColor(hsl){
  const m = hsl.match(/hsl\(\s*\d+\s+\d+% (\d+)%\)/);
  if(m){ const l = parseInt(m[1],10); return l>55 ? '#111' : '#fff'; }
  return '#000';
}
function formatTime(ms){ const s = Math.floor(ms/1000); const mm = Math.floor(s/60).toString().padStart(2,'0'); const ss = (s%60).toString().padStart(2,'0'); return `${mm}:${ss}`; }
function msToStr(ms){ return (ms/1000).toFixed(3)+'s'; }

// UI creation
function createPlayerArea(idx){
  const area = document.createElement('div');
  area.className = 'player-area';
  area.dataset.areaId = `area-${Date.now()}-${idx}`;
  area.innerHTML = `
    <div class="topbar">
      <div>
        <strong class="player-name">Player ${idx+1}</strong>
        <div class="small">Target: <span class="targetNum">-</span></div>
      </div>
      <div>
        <div class="small">Time left: <span class="timeLeft">--:--</span></div>
        <div class="small">Elapsed: <span class="elapsed">0.000s</span></div>
        <div class="small">Best: <span class="best">--</span></div>
      </div>
    </div>
    <div class="grid-wrap"><svg class="grid" xmlns="http://www.w3.org/2000/svg"></svg></div>
    <div class="footer">
      <button class="btn resetBtn">Reset</button>
      <button class="btn stopBtn">Stop</button>
      <label class="small">Cellsize<input class="cellSizeInput" type="number" value="60" style="width:60px"></label>
      <label class="small">Font<input class="fontCellInput" type="number" value="25" style="width:60px"></label>
    </div>
  `;
  playersContainer.appendChild(area);
  return area;
}

function setupPlayersUI(count){
  playersContainer.innerHTML = '';
  localPlayerAreas = [];
  for(let i=0;i<count;i++){
    const area = createPlayerArea(i);
    const obj = {
      el: area,
      svg: area.querySelector('svg.grid'),
      targetSpan: area.querySelector('.targetNum'),
      timeLeftSpan: area.querySelector('.timeLeft'),
      elapsedSpan: area.querySelector('.elapsed'),
      bestSpan: area.querySelector('.best'),
      resetBtn: area.querySelector('.resetBtn'),
      stopBtn: area.querySelector('.stopBtn'),
      cellSizeInput: area.querySelector('.cellSizeInput'),
      fontCellInput: area.querySelector('.fontCellInput'),
      config: {}
    };
    obj.resetBtn.addEventListener('click', () => initGameForArea(obj, obj.config));
    obj.stopBtn.addEventListener('click', () => stopGameForArea(obj));
    obj.cellSizeInput.addEventListener('change', () => { obj.config.cellSize = parseInt(obj.cellSizeInput.value); initGameForArea(obj, obj.config); });
    obj.fontCellInput.addEventListener('change', () => { obj.config.fontCell = parseInt(obj.fontCellInput.value); initGameForArea(obj, obj.config); });
    localPlayerAreas.push(obj);
  }
  applyLayout(count);
}

function applyLayout(count){
  if(count===4){
    localPlayerAreas.forEach(a=> a.el.style.flex = '1 1 50%');
    playersContainer.style.flexWrap = 'wrap';
  } else {
    localPlayerAreas.forEach(a=> a.el.style.flex = `1 1 ${Math.floor(100/count)}%`);
    playersContainer.style.flexWrap = 'nowrap';
  }
}

function enableLocalControls(enabled){
  levelSel.disabled = !enabled;
  customN.disabled = !enabled;
  cellSizeInput.disabled = !enabled;
  fontCellInput.disabled = !enabled;
  fontTargetInput.disabled = !enabled;
  countdownInput.disabled = !enabled;
  playersCount.disabled = !enabled;
}

// Core game init (uses roomConfig if present)
function initGameForArea(areaObj, opts){
  const cfg = roomConfig || {};
  const level = cfg.level || levelSel.value;
  const cellSize = (opts && opts.cellSize) || cfg.cellSize || parseInt(cellSizeInput.value) || 60;
  const fontCell = (opts && opts.fontCell) || cfg.fontCell || parseInt(fontCellInput.value) || 25;
  const fontTarget = cfg.fontTarget || parseInt(fontTargetInput.value) || 65;
  const countdownSec = cfg.countdown || parseInt(countdownInput.value) || 600;

  let n, total;
  if(level==='easy'){ n=5; total=25; }
  else if(level==='medium'){ n=7; total=49; }
  else if(level==='hard'){ n=10; total=100; }
  else { n = Math.max(10, parseInt(cfg.customN || customN.value) || 12); total = n*n; }

  // responsive scaling
  const wrapRect = areaObj.el.querySelector('.grid-wrap').getBoundingClientRect();
  const maxW = Math.max(100, wrapRect.width - 10);
  const maxH = Math.max(100, wrapRect.height - 10);
  const requiredW = cellSize * n;
  const requiredH = cellSize * n;
  let scale = Math.min(1, Math.min(maxW/requiredW, maxH/requiredH));
  const finalCell = Math.max(20, Math.floor(cellSize * scale));

  const numbers = shuffle(Array.from({length: total}, (_,i)=>i+1));
  const bgColors = distinctColors(total);

  const svg = areaObj.svg;
  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${n*finalCell} ${n*finalCell}`);
  svg.style.width = `${Math.min(n*finalCell, wrapRect.width)}px`;

  for(let r=0;r<n;r++){
    for(let c=0;c<n;c++){
      const idx = r*n + c;
      const num = numbers[idx];
      const g = document.createElementNS('http://www.w3.org/2000/svg','g');
      const rect = document.createElementNS('http://www.w3.org/2000/svg','rect');
      rect.setAttribute('x', c*finalCell);
      rect.setAttribute('y', r*finalCell);
      rect.setAttribute('width', finalCell);
      rect.setAttribute('height', finalCell);
      rect.setAttribute('rx', Math.max(3, finalCell*0.08));
      rect.setAttribute('fill', bgColors[idx]);
      rect.setAttribute('data-num', num);
      rect.style.cursor = 'pointer';

      const text = document.createElementNS('http://www.w3.org/2000/svg','text');
      text.setAttribute('x', c*finalCell + finalCell/2);
      text.setAttribute('y', r*finalCell + finalCell/2 + (fontCell*0.15));
      text.setAttribute('text-anchor','middle');
      text.setAttribute('font-size', fontCell);
      text.setAttribute('font-family','system-ui,Segoe UI,Roboto,Helvetica,Arial');
      const txtColor = contrastColor(bgColors[idx]);
      text.setAttribute('fill', txtColor);
      text.textContent = num;
      text.setAttribute('pointer-events','none');

      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);

      rect.addEventListener('click', () => onCellClick(areaObj, rect, num));
    }
  }

  areaObj.state = {
    n, total, numbersOrder: numbers, nextNeeded: 1,
    started: false, startTs: null, elapsed: 0, remaining: countdownSec*1000,
    timerInterval: null, finalCell, fontCell, fontTarget
  };
  areaObj.config = {cellSize, fontCell, fontTarget, countdownSec, level, n};

  areaObj.targetSpan.textContent = '1';
  areaObj.timeLeftSpan.textContent = formatTime(areaObj.state.remaining);
  areaObj.elapsedSpan.textContent = '0.000s';
  areaObj.bestSpan.textContent = sessionBestTimes[areaObj.el.dataset.areaId] ? msToStr(sessionBestTimes[areaObj.el.dataset.areaId]) : '--';
}

function stopGameForArea(areaObj){
  if(areaObj.state && areaObj.state.timerInterval){
    clearInterval(areaObj.state.timerInterval);
    areaObj.state.timerInterval = null;
  }
  areaObj.state = null;
  areaObj.svg.innerHTML = '';
  areaObj.targetSpan.textContent = '-';
  areaObj.timeLeftSpan.textContent = '--:--';
  areaObj.elapsedSpan.textContent = '0.000s';
}

function onCellClick(areaObj, rect, num){
  if(!areaObj.state) return;
  const st = areaObj.state;
  if(num !== st.nextNeeded) return;

  if(!st.started){
    st.started = true;
    st.startTs = Date.now();
    st.timerInterval = setInterval(()=>{
      const elapsed = Date.now()-st.startTs;
      st.elapsed = elapsed;
      st.remaining = (areaObj.config.countdownSec*1000) - elapsed;
      areaObj.elapsedSpan.textContent = (elapsed/1000).toFixed(3)+'s';
      areaObj.timeLeftSpan.textContent = formatTime(Math.max(0, st.remaining));
      if(st.remaining<=0){
        clearInterval(st.timerInterval);
        st.timerInterval = null;
        areaObj.targetSpan.textContent = 'TIME';
      }
    }, 50);
  }

  rect.setAttribute('opacity', '0.35');
  const g = rect.parentNode;
  const check = document.createElementNS('http://www.w3.org/2000/svg','text');
  check.setAttribute('x', parseFloat(rect.getAttribute('x')) + parseFloat(rect.getAttribute('width'))/2);
  check.setAttribute('y', parseFloat(rect.getAttribute('y')) + parseFloat(rect.getAttribute('height'))/2 + 6);
  check.setAttribute('text-anchor','middle');
  check.setAttribute('font-size', Math.max(12, areaObj.state.fontTarget/3));
  check.setAttribute('fill', '#000');
  check.textContent = '✓';
  g.appendChild(check);

  st.nextNeeded++;
  areaObj.targetSpan.textContent = st.nextNeeded <= st.total ? st.nextNeeded : 'Done';

  if(st.nextNeeded > st.total){
    const totalTime = Date.now() - st.startTs;
    clearInterval(st.timerInterval);
    st.timerInterval = null;
    areaObj.elapsedSpan.textContent = (totalTime/1000).toFixed(3)+'s';
    areaObj.timeLeftSpan.textContent = formatTime(Math.max(0, (areaObj.config.countdownSec*1000)-totalTime));
    const aid = areaObj.el.dataset.areaId;
    const prev = sessionBestTimes[aid];
    if(!prev || totalTime < prev) sessionBestTimes[aid] = totalTime;
    areaObj.bestSpan.textContent = msToStr(sessionBestTimes[aid]);
    // notify server
    socket.emit('submit-time', { roomId: roomIdInput.value||'room1', ms: totalTime });
  }
}

// Start: setup UI areas using server config if present
startBtn.addEventListener('click', () => {
  const count = Math.min(4, parseInt(playersCount.value) || 1);
  setupPlayersUI(count);
  localPlayerAreas.forEach(a => {
    a.cellSizeInput.value = roomConfig ? roomConfig.cellSize : parseInt(cellSizeInput.value);
    a.fontCellInput.value = roomConfig ? roomConfig.fontCell : parseInt(fontCellInput.value);
    initGameForArea(a, {cellSize: parseInt(a.cellSizeInput.value), fontCell: parseInt(a.fontCellInput.value)});
  });
});

// initial setup
setupPlayersUI(Math.min(4, parseInt(playersCount.value)||1));

let resizeTimeout;
window.addEventListener('resize', ()=> {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(()=>{
    localPlayerAreas.forEach(a => {
      if(a.config) initGameForArea(a, a.config);
    });
  }, 250);
});

function applyRoomConfigToUI(cfg){
  if(!cfg) return;
  // apply settings to controls and lock them (only creator can change but server owns config)
  levelSel.value = cfg.level;
  customN.value = cfg.customN;
  cellSizeInput.value = cfg.cellSize;
  fontCellInput.value = cfg.fontCell;
  fontTargetInput.value = cfg.fontTarget;
  countdownInput.value = cfg.countdown;
  enableLocalControls(false);
}
