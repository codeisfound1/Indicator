const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const shortid = require('shortid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const MAX_PLAYERS = 4;
const DEFAULT_COUNTDOWN = 600; // seconds

// In-memory store: rooms map
const rooms = {}; // roomId -> { id, name, hostId, level, players: {socketId: player}, createdAt, bestTimes: {playerName: bestSec}, countdown, state }

function makeRoomName() {
  return shortid.generate().slice(0,6);
}

function makePlayerName() {
  return 'P' + Math.random().toString(36).slice(2,7);
}

function createRoom(hostSocketId, opts = {}) {
  const id = shortid.generate().slice(0,6);
  const name = makeRoomName();
  const room = {
    id, name,
    hostId: hostSocketId,
    level: opts.level || 'easy',
    countdown: opts.countdown || DEFAULT_COUNTDOWN,
    players: {}, // socketId -> {id, name, color, ready, bestTime}
    createdAt: Date.now(),
    state: 'waiting', // waiting|playing|finished
    bestTimes: {}, // playerName -> bestSeconds
  };
  rooms[id] = room;
  return room;
}

function levelConfig(level, nOverride) {
  if (level === 'easy') return {n:5, max:25};
  if (level === 'medium') return {n:7, max:49};
  if (level === 'hard') return {n:10, max:100};
  if (level === 'super') {
    const n = Math.max(10, parseInt(nOverride || 10,10));
    return {n, max: n*n};
  }
  return {n:5, max:25};
}

io.on('connection', socket => {
  // create quick player object
  socket.data.name = makePlayerName();

  // send lobby list
  socket.emit('lobbyList', Object.values(rooms).map(r => ({
    id: r.id, name: r.name, players: Object.keys(r.players).length, level: r.level
  })));

  socket.on('createRoom', ({level, n, countdown}) => {
    const room = createRoom(socket.id, {level, countdown});
    room.level = level || 'easy';
    room.nOverride = n;
    socket.join(room.id);
    room.players[socket.id] = {id: socket.id, name: socket.data.name, color: null, ready: false, bestTime: null};
    socket.emit('roomJoined', {room});
    io.emit('lobbyList', Object.values(rooms).map(r => ({id: r.id, name: r.name, players: Object.keys(r.players).length, level: r.level})));
  });

  socket.on('joinRoom', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMsg', 'Room not found');
    if (Object.keys(room.players).length >= MAX_PLAYERS) return socket.emit('errorMsg','Room full');
    socket.join(room.id);
    room.players[socket.id] = {id: socket.id, name: socket.data.name, color: null, ready: false, bestTime: null};
    io.to(room.id).emit('roomUpdate', roomSnapshot(room));
    io.emit('lobbyList', Object.values(rooms).map(r => ({id: r.id, name: r.name, players: Object.keys(r.players).length, level: r.level})));
  });

  socket.on('leaveRoom', ({roomId}) => {
    leaveRoom(socket, roomId);
  });

  socket.on('setName', ({name}) => {
    socket.data.name = name || socket.data.name;
  });

  socket.on('startGame', ({roomId}) => {
    const room = rooms[roomId];
    if (!room) return;
    if (room.hostId !== socket.id) return;
    // start game: build per-player grids and assign colors
    room.state = 'playing';
    room.startAt = Date.now();
    room.timeLeft = room.countdown || DEFAULT_COUNTDOWN;
    const cfg = levelConfig(room.level, room.nOverride);
    const n = cfg.n;
    const max = cfg.max;
    // generate random colors for each cell per player, and unique number sequences 1..max
    room.playerGrids = {};
    Object.values(room.players).forEach(p => {
      const numbers = Array.from({length: max}, (_,i)=>i+1);
      // shuffle numbers
      for (let i = numbers.length-1;i>0;i--){
        const j = Math.floor(Math.random()*(i+1));
        [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
      }
      // take first n*n numbers
      const gridNums = numbers.slice(0, n*n);
      // shuffling colors for each cell: ensure different from text color (we'll use black text)
      const colors = gridNums.map(() => randomColor());
      room.playerGrids[p.id] = {n, max, numbers: gridNums, colors, nextToFind: 1, elapsed: 0};
    });
    io.to(room.id).emit('gameStarted', roomSnapshot(room));
    // start a countdown interval per room
    room.timer = setInterval(()=>{
      room.timeLeft--;
      if (room.timeLeft <= 0) {
        clearInterval(room.timer);
        room.state = 'finished';
        io.to(room.id).emit('timeUp', roomSnapshot(room));
      } else {
        io.to(room.id).emit('tick', {timeLeft: room.timeLeft});
      }
    },1000);
  });

  socket.on('cellSelected', ({roomId, cellIndex}) => {
    const room = rooms[roomId]; if(!room) return;
    const pg = room.playerGrids?.[socket.id]; if(!pg) return;
    const val = pg.numbers[cellIndex];
    if (val === pg.nextToFind) {
      pg.nextToFind++;
      // color feedback will be handled on client
      io.to(socket.id).emit('cellCorrect', {cellIndex, next: pg.nextToFind});
      // broadcast progress to room for realtime best/leaderboard
      io.to(room.id).emit('playerProgress', {playerId: socket.id, next: pg.nextToFind});
      if (pg.nextToFind > pg.max) {
        // finished by this player
        const elapsed = (room.countdown || DEFAULT_COUNTDOWN) - room.timeLeft;
        room.players[socket.id].bestTime = Math.min(room.players[socket.id].bestTime||Infinity, elapsed);
        room.bestTimes[socket.data.name] = Math.min(room.bestTimes[socket.data.name]||Infinity, elapsed);
        io.to(room.id).emit('playerFinished', {playerId: socket.id, elapsed});
        // mark player's grid finished; check if all finished or stop when all done
        const allFinished = Object.keys(room.playerGrids).every(pid => room.playerGrids[pid].nextToFind > room.playerGrids[pid].max);
        if (allFinished) {
          clearInterval(room.timer);
          room.state = 'finished';
          io.to(room.id).emit('allFinished', roomSnapshot(room));
        }
      }
    } else {
      io.to(socket.id).emit('cellWrong', {cellIndex, expected: pg.nextToFind});
    }
  });

  socket.on('sendChat', ({roomId, text}) => {
    const room = rooms[roomId];
    const name = socket.data.name;
    if (!room) return;
    io.to(roomId).emit('chat', {from: name, text, at: Date.now()});
  });

  socket.on('getLobby', ()=> {
    socket.emit('lobbyList', Object.values(rooms).map(r => ({id: r.id, name: r.name, players: Object.keys(r.players).length, level: r.level})));
  });

  socket.on('disconnect', reason => {
    // remove from any room
    Object.values(rooms).forEach(room=>{
      if (room.players[socket.id]) {
        // remove player
        delete room.players[socket.id];
        delete room.playerGrids?.[socket.id];
        io.to(room.id).emit('roomUpdate', roomSnapshot(room));
        // if host left, pick new host
        if (room.hostId === socket.id) {
          const remaining = Object.keys(room.players);
          room.hostId = remaining[0] || null;
        }
        // auto-kick logic: if disconnected for more than X -> here we'll immediately remove; to implement delayed kick, you'd store timestamp and set timer
        // if no players left -> remove room
        if (Object.keys(room.players).length === 0) {
          clearInterval(room.timer);
          delete rooms[room.id];
          io.emit('lobbyList', Object.values(rooms).map(r => ({id: r.id, name: r.name, players: Object.keys(r.players).length, level: r.level})));
        }
      }
    });
  });

  function leaveRoom(socket, roomId) {
    const room = rooms[roomId];
    if (!room) return;
    if (room.players[socket.id]) {
      delete room.players[socket.id];
      delete room.playerGrids?.[socket.id];
      socket.leave(room.id);
      io.to(room.id).emit('roomUpdate', roomSnapshot(room));
      if (Object.keys(room.players).length === 0) {
        clearInterval(room.timer);
        delete rooms[room.id];
      } else {
        if (room.hostId === socket.id) {
          room.hostId = Object.keys(room.players)[0];
        }
      }
      io.emit('lobbyList', Object.values(rooms).map(r => ({id: r.id, name: r.name, players: Object.keys(r.players).length, level: r.level})));
    }
  }

  function roomSnapshot(room) {
    return {
      id: room.id, name: room.name, hostId: room.hostId, level: room.level, state: room.state,
      players: Object.values(room.players).map(p => ({id: p.id, name: p.name, bestTime: p.bestTime})),
      timeLeft: room.timeLeft || room.countdown || DEFAULT_COUNTDOWN,
      bestTimes: room.bestTimes || {}
    };
  }

  function randomColor() {
    // ensure reasonably bright colors
    const r = Math.floor(80 + Math.random()*175);
    const g = Math.floor(80 + Math.random()*175);
    const b = Math.floor(80 + Math.random()*175);
    return `rgb(${r},${g},${b})`;
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('Server listening on', PORT));
