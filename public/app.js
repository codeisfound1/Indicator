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

let localPlayerAreas = []; // store objects for each local player view
let sessionBestTimes = {}; // socket-session local bests keyed by areaId

levelSel.addEventListener('change', () => {
  customNlabel.style.display = levelSel.value === 'custom' ? 'inline-block' : 'none';
});

joinBtn.addEventListener('click', () => {
  const roomId = roomIdInput.value || 'room1';
  const name = nameInput.value || 'Player';
  socket.emit('join-room', {roomId, name});
  statusSpan.textContent = `Connected to ${roomId} as ${name}`;
  joinBtn.disabled = true;
  leaveBtn.disabled = false;
});

leaveBtn.addEventListener('click', () => {
  socket.emit('leave-room', {roomId: roomIdInput.value || 'room1'});
  statusSpan.textContent = 'Not connected';
  joinBtn.disabled = false;
  leaveBtn.disabled = true;
});

sendChat.addEventListener('click', () => {
  const msg = chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat', {roomId: roomIdInput.value || 'room1', msg});
  chatInput.value = '';
});

socket.on('chat', ({from, msg}) => {
  const d = document.createElement('div'); d.textContent = `${from}: ${msg}`; chatBox.appendChild(d); chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('room-update', ({players}) => {
  // show players in status
  statusSpan.textContent = `Room ${roomIdInput.value} — players: ${Object.values(players).join(', ')}`;
});

socket.on('best-times', ({bestTimes, players}) => {
  // not required to show more than update local session storage
  // optionally display in chatBox
  const d = document.createElement('div');
  d.textContent = `Best times updated.`;
  chatBox.appendChild(d);
});

// UTILS
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

// Create player-area DOM
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

// Build several player areas based on playersCount and layout rules
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

// layout: if 4 players enforce 2x2
function applyLayout(count){
  if(count===4){
    // make each area width 50%
    localPlayerAreas.forEach(a=> a.el.style.flex = '1 1 50%');
    playersContainer.style.flexWrap = 'wrap';
  } else {
    // distribute equally
    localPlayerAreas.forEach(a=> a.el.style.flex = `1 1 ${Math.floor(100/count)}%`);
    playersContainer.style.flexWrap = 'nowrap';
  }
}

// Core: init game for an area
function initGameForArea(areaObj, opts){
  // resolve options with defaults and UI global defaults
  const level = levelSel.value;
  const cellSize = (opts && opts.cellSize) || parseInt(cellSizeInput.value) || 60;
  const fontCell = (opts && opts.fontCell) || parseInt(fontCellInput.value) || 25;
  const fontTarget = parseInt(fontTargetInput.value) || 65;
  const countdownSec = parseInt(countdownInput.value) || 600;

  let n, total;
  if(level==='easy'){ n=5; total=25; }
  else if(level==='medium'){ n=7; total=49; }
  else if(level==='hard'){ n=10; total=100; }
  else { n = Math.max(10, parseInt(customN.value)||12); total = n*n; }

  // adjust cell size responsively: attempt to fit svg container
  const wrapRect = areaObj.el.querySelector('.grid-wrap').getBoundingClientRect();
  const maxW = Math.max(100, wrapRect.width - 10);
  const maxH = Math.max(100, wrapRect.height - 10);
  // try scale so grid fits
  const requiredW = cellSize * n;
  const requiredH = cellSize * n;
  let scale = Math.min(1, Math.min(maxW/requiredW, maxH/requiredH));
  const finalCell = Math.max(20, Math.floor(cellSize * scale));

  // generate numbers 1..total shuffled
  const numbers = shuffle(Array.from({length: total}, (_,i)=>i+1));

  // colors for each cell distinct
  const bgColors = distinctColors(total);
  // ensure number color not equal to bg: use black/white based on lightness
  function contrastColor(hsl){
    // crude: parse lightness
    const m = hsl.match(/hsl\(\s*\d+\s+\d+% (\d+)%\)/);
    if(m){
      const l = parseInt(m[1],10);
      return l>55 ? '#111' : '#fff';
    }
    return '#000';
  }

  // construct SVG grid
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

      // click behavior
      rect.addEventListener('click', () => onCellClick(areaObj, rect, num));
    }
  }

  // init state
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

  // start timer when first correct click happens
  // expose method
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
  if(num !== st.nextNeeded) return; // must click in order

  if(!st.started){
    st.started = true;
    st.startTs = Date.now();
    // start countdown
    st.timerInterval = setInterval(()=>{
      const elapsed = Date.now()-st.startTs;
      st.elapsed = elapsed;
      st.remaining = (areaObj.config.countdownSec*1000) - elapsed;
      areaObj.elapsedSpan.textContent = (elapsed/1000).toFixed(3)+'s';
      areaObj.timeLeftSpan.textContent = formatTime(Math.max(0, st.remaining));
      if(st.remaining<=0){
        clearInterval(st.timerInterval);
        st.timerInterval = null;
        // time up
        areaObj.targetSpan.textContent = 'TIME';
      }
    }, 50);
  }

  // mark cell as found: reduce opacity, strike, etc
  rect.setAttribute('opacity', '0.35');
  const g = rect.parentNode;
  // draw ring or check
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
    // finished
    const totalTime = Date.now() - st.startTs;
    clearInterval(st.timerInterval);
    st.timerInterval = null;
    areaObj.elapsedSpan.textContent = (totalTime/1000).toFixed(3)+'s';
    areaObj.timeLeftSpan.textContent = formatTime(Math.max(0, (areaObj.config.countdownSec*1000)-totalTime));
    // update best local session
    const aid = areaObj.el.dataset.areaId;
    const prev = sessionBestTimes[aid];
    if(!prev || totalTime < prev) sessionBestTimes[aid] = totalTime;
    areaObj.bestSpan.textContent = msToStr(sessionBestTimes[aid]);
    // notify server of submitted time
    socket.emit('submit-time', {roomId: roomIdInput.value||'room1', ms: totalTime});
  }
}

function formatTime(ms){
  const s = Math.floor(ms/1000);
  const mm = Math.floor(s/60).toString().padStart(2,'0');
  const ss = (s%60).toString().padStart(2,'0');
  return `${mm}:${ss}`;
}
function msToStr(ms){ return (ms/1000).toFixed(3)+'s'; }

// Start button handler: setup players and init each game
startBtn.addEventListener('click', () => {
  const count = parseInt(playersCount.value) || 1;
  setupPlayersUI(count);
  // initialize each area with initial config
  localPlayerAreas.forEach(a => {
    // apply global cell/font defaults to area controls
    a.cellSizeInput.value = parseInt(cellSizeInput.value);
    a.fontCellInput.value = parseInt(fontCellInput.value);
    initGameForArea(a, {cellSize: parseInt(cellSizeInput.value), fontCell: parseInt(fontCellInput.value)});
  });
});

// initial default setup
setupPlayersUI(parseInt(playersCount.value)||1);

// allow resizing: re-init when window resizes to adjust scale
let resizeTimeout;
window.addEventListener('resize', ()=> {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(()=>{
    localPlayerAreas.forEach(a => {
      if(a.config) initGameForArea(a, a.config);
    });
  }, 250);
});
