const express = require('express');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));

// In-memory state
const rooms = new Map(); // roomId -> room
const players = new Map(); // socketId -> { name, roomId }

const ADJECTIVES = ['Swift','Bright','Quick','Smart','Cool','Fast','Bold','Happy'];
const NOUNS = ['Tiger','Eagle','Dragon','Phoenix','Falcon','Wolf','Bear','Lion'];
const NAMES = ['Alex','Nova','Max','Zara','Kai','Luna','Rex','Sage','Jax','Aria'];

function genRoomName(){
  return ADJECTIVES[Math.floor(Math.random()*ADJECTIVES.length)]
    + NOUNS[Math.floor(Math.random()*NOUNS.length)]
    + Math.floor(Math.random()*100);
}
function genPlayerName(){
  return NAMES[Math.floor(Math.random()*NAMES.length)] + Math.floor(Math.random()*1000);
}

function getLevelConfig(level, customN){
  if(level === 'easy') return { rows:5, cols:5 };
  if(level === 'medium') return { rows:7, cols:7 };
  if(level === 'hard') return { rows:10, cols:10 };
  const n = Math.max(10, parseInt(customN) || 10);
  return { rows: n, cols: n };
}

function generateShuffledNumbers(rows, cols){
  const total = rows*cols;
  const arr = [];
  for(let i=1;i<=total;i++) arr.push(i);
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const PRESET_COLORS = [
  '#FF6B6B','#4ECDC4','#45B7D1','#FFA07A','#98D8C8',
  '#F7DC6F','#BB8FCE','#85C1E2','#F8B88B','#ABEBC6',
  '#FAD7A0','#D7BDE2','#A3E4D7','#F9E79F','#D5F4E6',
  '#FADBD8','#EBF5FB','#FCF3CF','#A2D5AB','#FEDABE'
];

function randomColor(exclude){
  const pool = PRESET_COLORS.filter(c => c !== exclude);
  return pool[Math.floor(Math.random()*pool.length)];
}

function makePlayerGrid(rows, cols){
  const nums = generateShuffledNumbers(rows, cols);
  const colors = [];
  for(let i=0;i<rows*cols;i++) colors.push(randomColor(null));
  return { numbers: nums, colors };
}

function getAvailableRooms(){
  const list = [];
  rooms.forEach((room, id) => {
    if(room.players.length < 4 && room.status === 'waiting'){
      list.push({
        roomId: id,
        hostName: room.players[0]?.name || 'Host',
        level: room.level,
        playerCount: room.players.length
      });
    }
  });
  return list;
}

io.on('connection', socket => {
  console.log('connected', socket.id);

  socket.on('createRoom', (data={}) => {
    const level = data.level || 'easy';
    const customN = data.customN;
    const roomId = genRoomName();
    const playerName = data.playerName || genPlayerName();
    const config = getLevelConfig(level, customN);

    const player = {
      id: socket.id,
      name: playerName,
      grid: makePlayerGrid(config.rows, config.cols),
      currentNumber: 1,
      startTime: null,
      endTime: null,
      bestTime: null,
      completed: false
    };

    const room = {
      id: roomId,
      level,
      customN: customN || null,
      rows: config.rows,
      cols: config.cols,
      host: socket.id,
      players: [player],
      status: 'waiting', // waiting | playing | finished
      createdAt: Date.now()
    };

    rooms.set(roomId, room);
    players.set(socket.id, { name: playerName, roomId });

    socket.join(roomId);
    socket.emit('roomCreated', { roomId, playerName, level, rows: config.rows, cols: config.cols });
    io.to(roomId).emit('updatePlayers', room.players.map(p => ({ id: p.id, name: p.name, currentNumber: p.currentNumber, bestTime: p.bestTime })));
    io.emit('updateLobbies', getAvailableRooms());
  });

  socket.on('joinRoom', (data={}, cb) => {
    const { roomId } = data;
    const room = rooms.get(roomId);
    if(!room){ if(cb) cb({ error: 'Room not found' }); return; }
    if(room.players.length >= 4){ if(cb) cb({ error: 'Room full' }); return; }

    const playerName = data.playerName || genPlayerName();
    const config = getLevelConfig(room.level, room.customN);
    const player = {
      id: socket.id,
      name: playerName,
      grid: makePlayerGrid(config.rows, config.cols),
      currentNumber: 1,
      startTime: null,
      endTime: null,
      bestTime: null,
      completed: false
    };

    room.players.push(player);
    players.set(socket.id, { name: playerName, roomId });
    socket.join(roomId);

    socket.emit('roomJoined', { roomId, playerName, level: room.level, rows: room.rows, cols: room.cols });
    io.to(roomId).emit('updatePlayers', room.players.map(p => ({ id: p.id, name: p.name, currentNumber: p.currentNumber, bestTime: p.bestTime })));
    io.emit('updateLobbies', getAvailableRooms());
    if(cb) cb({ ok: true });
  });

  socket.on('getAvailableRooms', () => {
    socket.emit('availableRooms', getAvailableRooms());
  });

  socket.on('startGame', (data={}) => {
    const meta = players.get(socket.id);
    if(!meta) return;
    const room = rooms.get(meta.roomId);
    if(!room) return;
    if(room.host !== socket.id) return;
    room.status = 'playing';
    room.players.forEach(p => { p.currentNumber = 1; p.startTime = Date.now(); p.endTime = null; p.completed = false; });
    io.to(room.id).emit('gameStarted', { timeLimit: 600 }); // 600s
  });

  socket.on('selectNumber', (data={}) => {
    const meta = players.get(socket.id);
    if(!meta) return;
    const room = rooms.get(meta.roomId);
    if(!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if(!player) return;

    const expected = player.currentNumber;
    const selected = data.selected;
    if(selected === expected){
      player.currentNumber++;
      if(player.currentNumber > room.rows*room.cols){
        player.completed = true;
        player.endTime = Date.now();
        const timeSpent = Math.round((player.endTime - player.startTime) / 1000);
        if(!player.bestTime || timeSpent < player.bestTime) player.bestTime = timeSpent;
        io.to(room.id).emit('playerCompleted', { playerId: player.id, name: player.name, timeSpent, bestTime: player.bestTime });
      }
      io.to(room.id).emit('numberSelected', { playerId: player.id, currentNumber: player.currentNumber, players: room.players.map(p=>({ id:p.id, currentNumber:p.currentNumber, completed:p.completed, bestTime:p.bestTime })) });
    } else {
      socket.emit('wrongNumber', { expected, selected });
    }
  });

  socket.on('sendMessage', (data={}) => {
    const meta = players.get(socket.id);
    if(!meta) return;
    io.to(meta.roomId).emit('chatMessage', { from: meta.name, message: data.message, ts: Date.now() });
  });

  socket.on('kickIfDisconnected', () => {
    // handled by 'disconnect'
  });

  socket.on('leaveRoom', () => {
    const meta = players.get(socket.id);
    if(!meta) return;
    const room = rooms.get(meta.roomId);
    if(!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    socket.leave(meta.roomId);
    players.delete(socket.id);
    if(room.players.length === 0){
      rooms.delete(room.id);
    } else {
      if(room.host === socket.id) room.host = room.players[0].id;
      io.to(room.id).emit('updatePlayers', room.players.map(p => ({ id:p.id, name:p.name, currentNumber:p.currentNumber })));
    }
    io.emit('updateLobbies', getAvailableRooms());
  });

  socket.on('disconnect', () => {
    const meta = players.get(socket.id);
    if(meta){
      const room = rooms.get(meta.roomId);
      if(room){
        room.players = room.players.filter(p => p.id !== socket.id);
        io.to(room.id).emit('playerDisconnected', { id: socket.id, name: meta.name });
        if(room.players.length === 0) rooms.delete(room.id);
        else if(room.host === socket.id) room.host = room.players[0].id;
      }
      players.delete(socket.id);
      io.emit('updateLobbies', getAvailableRooms());
    }
    console.log('disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Server running on', PORT));
