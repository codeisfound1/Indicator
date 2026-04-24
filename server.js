// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { /* cors if needed */ });

app.use(express.static('public')); // serve client files from ./public

// Utils
const randInt = (min,max)=> Math.floor(Math.random()*(max-min+1))+min;
const shuffle = (arr)=> { for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]] } return arr; }

function makeRoomId(){ return crypto.randomBytes(3).toString('hex'); }

const rooms = {}; // roomId -> {players: {socketId: playerIndex,...}, config, state, interval}

io.on('connection', socket => {
  console.log('conn', socket.id);

  socket.on('createRoom', ({level, customN, playersCount, cellSize, countdown})=>{
    const roomId = makeRoomId();
    rooms[roomId] = {
      config: {level, customN, playersCount, cellSize, countdown},
      players: {}, // socketId -> {index, name, found, target, time, best}
      sockets: [], // list of socket ids in join order
      grids: {}, // per playerIndex: {n, numbers: []}
      state: {running:false, globalRemaining: countdown || 600},
      interval: null
    };
    socket.join(roomId);
    rooms[roomId].players[socket.id] = {index:0,name:'Player 1',found:0,target:1,time:0,best:null};
    rooms[roomId].sockets.push(socket.id);
    rooms[roomId].owner = socket.id;
    socket.emit('roomCreated', {roomId, playerIndex:0});
    console.log('room created', roomId);
  });

  socket.on('joinRoom', ({roomId})=>{
    const room = rooms[roomId];
    if(!room){ socket.emit('joinError', {msg:'Room không tồn tại'}); return; }
    if(room.sockets.length >= (room.config.playersCount || 4)){ socket.emit('joinError', {msg:'Full'}); return; }
    const idx = room.sockets.length;
    room.players[socket.id] = {index: idx, name:`Player ${idx+1}`, found:0, target:1, time:0, best:null};
    room.sockets.push(socket.id);
    socket.join(roomId);
    io.to(roomId).emit('playerList', {count: room.sockets.length});
    socket.emit('joined', {roomId, playerIndex: idx});
    console.log('joined', roomId, socket.id);
  });

  socket.on('startGameRoom', ({roomId, configOverrides})=>{
    const room = rooms[roomId];
    if(!room) return;
    // only owner can start
    if(socket.id !== room.owner){ socket.emit('startError',{msg:'Not owner'}); return; }
    // set config from overrides if provided
    const cfg = Object.assign({}, room.config, configOverrides || {});
    room.config = cfg;
    // determine n per config and prepare grids per player
    const level = cfg.level;
    let n;
    if(level==='easy') n=5;
    else if(level==='medium') n=7;
    else if(level==='hard') n=10;
    else n = Math.max(10, parseInt(cfg.customN)||10);
    const total = n*n;
    for(let i=0;i<room.sockets.length;i++){
      const numbers = shuffle(Array.from({length:total},(_,k)=>k+1));
      room.grids[i] = {n, numbers, total};
      // reset player states
      const sid = room.sockets[i];
      room.players[sid].found = 0;
      room.players[sid].target = 1;
      room.players[sid].time = 0;
    }
    room.state.running = true;
    room.state.globalRemaining = parseInt(cfg.countdown) || 600;

    // broadcast init to all clients with their assigned grid
    room.sockets.forEach((sid, idx)=>{
      const sock = io.sockets.sockets.get(sid);
      if(sock){
        sock.emit('initGrid', {
          playerIndex: idx,
          n,
          numbers: room.grids[idx].numbers,
          total: room.grids[idx].total,
          countdown: room.state.globalRemaining,
          config: room.config
        });
      }
    });

    // start global timer
    if(room.interval) clearInterval(room.interval);
    room.interval = setInterval(()=>{
      room.state.globalRemaining = Math.max(0, room.state.globalRemaining - 1);
      // increment each player's time
      room.sockets.forEach(sid=>{
        room.players[sid].time++;
      });
      // broadcast tick
      io.to(roomId).emit('tick', {globalRemaining: room.state.globalRemaining, players: room.sockets.map(sid=>({
        index: room.players[sid].index,
        time: room.players[sid].time,
        found: room.players[sid].found,
        target: room.players[sid].target
      }))});
      // timeout
      if(room.state.globalRemaining<=0){
        endRoom(roomId, 'timeout');
      }
    }, 1000);

    io.to(roomId).emit('gameStarted', {msg:'started'});
  });

  // player attempts a click (value)
  socket.on('attempt', ({roomId, val})=>{
    const room = rooms[roomId];
    if(!room) return;
    const player = room.players[socket.id];
    if(!player || !room.state.running) return;
    const pIdx = player.index;
    // validate against player's target (server authoritative)
    if(val === player.target){
      // correct
      player.found++;
      player.target++;
      // update best/time when complete
      const grid = room.grids[pIdx];
      if(player.found >= grid.total){
        // finished
        // store best
        if(!player.best || player.time < player.best) player.best = player.time;
        // send update to all
        io.to(roomId).emit('playerFinished', {index: pIdx, time: player.time, best: player.best});
        // check if all done
        const allDone = room.sockets.every(sid=> room.players[sid].found >= room.grids[room.players[sid].index].total );
        if(allDone) endRoom(roomId, 'all_done');
      } else {
        // send update (single cell correct)
        io.to(roomId).emit('cellCorrect', {playerIndex: pIdx, val, found: player.found, target: player.target});
      }
    } else {
      // wrong: notify only the player (so UI can flash)
      socket.emit('cellWrong', {val});
    }
  });

  socket.on('leaveRoom', ({roomId})=>{
    leaveRoom(socket, roomId);
  });

  socket.on('disconnect', ()=> {
    // remove from any room
    for(const rid in rooms){
      if(rooms[rid].players[socket.id]){
        leaveRoom(socket, rid);
      }
    }
  });

  function leaveRoom(socket, roomId){
    const room = rooms[roomId];
    if(!room) return;
    socket.leave(roomId);
    // remove socket from arrays
    const idx = room.sockets.indexOf(socket.id);
    if(idx !== -1) room.sockets.splice(idx,1);
    delete room.players[socket.id];
    io.to(roomId).emit('playerList', {count: room.sockets.length});
    // if room empty, clear interval and delete
    if(room.sockets.length === 0){
      if(room.interval) clearInterval(room.interval);
      delete rooms[roomId];
    } else {
      // if owner left, assign new owner
      if(room.owner === socket.id) room.owner = room.sockets[0];
    }
  }

  function endRoom(roomId, reason){
    const room = rooms[roomId];
    if(!room) return;
    room.state.running = false;
    if(room.interval) { clearInterval(room.interval); room.interval = null; }
    io.to(roomId).emit('gameEnded', {reason});
  }
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, ()=> console.log('listening', PORT));
