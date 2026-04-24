const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// rooms: roomId -> { players: {socketId: name}, best: {socketId,name,ms}, config: {...} }
let rooms = {};

io.on('connection', (socket) => {
  socket.on('join-room', (payload = {}) => {
    try {
      const roomId = (payload.roomId || 'room1').toString();
      const name = (payload.name || 'Player').toString();
      const incomingConfig = payload.config || {
        level: payload.level,
        customN: payload.customN,
        countdown: payload.countdown,
        cellSize: payload.cellSize,
        fontCell: payload.fontCell,
        fontTarget: payload.fontTarget
      };

      rooms[roomId] = rooms[roomId] || { players: {}, best: null, config: null, creator: null };

      const currentCount = Object.keys(rooms[roomId].players).length;
      if (currentCount >= 4) {
        socket.emit('room-full', {roomId});
        return;
      }

      // If room has no config yet, first joiner becomes creator and sets config
      if (!rooms[roomId].config) {
        // sanitize and normalize config
        const cfg = {
          level: incomingConfig.level || 'easy',
          customN: Math.max(10, parseInt(incomingConfig.customN) || 12),
          countdown: Math.max(10, parseInt(incomingConfig.countdown) || 600),
          cellSize: Math.max(20, parseInt(incomingConfig.cellSize) || 60),
          fontCell: Math.max(8, parseInt(incomingConfig.fontCell) || 25),
          fontTarget: Math.max(12, parseInt(incomingConfig.fontTarget) || 65)
        };
        rooms[roomId].config = cfg;
        rooms[roomId].creator = socket.id;
      }

      socket.join(roomId);
      socket.data.name = name;
      rooms[roomId].players[socket.id] = name;

      // send room-config to everyone in room (ensures all use same config)
      io.to(roomId).emit('room-config', rooms[roomId].config);

      // send room-update with players and best
      io.to(roomId).emit('room-update', { players: rooms[roomId].players, best: rooms[roomId].best });

    } catch (err) {
      socket.emit('error', { message: 'join-room failed' });
    }
  });

  socket.on('leave-room', ({roomId} = {}) => {
    roomId = (roomId || '').toString();
    if (!roomId) return;
    socket.leave(roomId);
    if (rooms[roomId]) {
      delete rooms[roomId].players[socket.id];
      // if leaving player was best, keep best or clear (we'll keep best as historical)
      if (rooms[roomId].creator === socket.id) {
        // if creator left and room becomes empty, clear config; otherwise leave config intact
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        } else {
          // transfer creator to another player (first one)
          const remaining = Object.keys(rooms[roomId].players);
          rooms[roomId].creator = remaining.length ? remaining[0] : null;
        }
      }
      io.to(roomId).emit('room-update', { players: rooms[roomId] ? rooms[roomId].players : {}, best: rooms[roomId] ? rooms[roomId].best : null });
    }
  });

  socket.on('chat', ({roomId, msg} = {}) => {
    if (!roomId) return;
    io.to(roomId).emit('chat', { from: socket.data.name || 'Player', msg: (msg||'').toString() });
  });

  socket.on('submit-time', ({roomId, ms} = {}) => {
    if (!roomId) return;
    const room = rooms[roomId];
    if (!room) return;
    const msNum = Number(ms) || 0;
    // update room.best if better (smaller) or not set
    if (!room.best || msNum < room.best.ms) {
      room.best = { socketId: socket.id, name: socket.data.name || 'Player', ms: msNum };
      io.to(roomId).emit('new-best', room.best);
    }
    // also emit best-times for clients who track multiple
    io.to(roomId).emit('best-times', { best: room.best });
  });

  socket.on('disconnecting', () => {
    const roomIds = Array.from(socket.rooms).filter(r => r !== socket.id);
    roomIds.forEach(roomId => {
      if (rooms[roomId]) {
        delete rooms[roomId].players[socket.id];
        // if creator left and room empty, delete room
        if (Object.keys(rooms[roomId].players).length === 0) {
          delete rooms[roomId];
        } else {
          if (rooms[roomId].creator === socket.id) {
            const remaining = Object.keys(rooms[roomId].players);
            rooms[roomId].creator = remaining.length ? remaining[0] : null;
          }
        }
        io.to(roomId).emit('room-update', { players: rooms[roomId] ? rooms[roomId].players : {}, best: rooms[roomId] ? rooms[roomId].best : null });
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
