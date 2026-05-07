/**
 * WatchParty Signaling Server
 * مهمته فقط توصيل الأجهزة ببعض (Relay messages)
 * يُنشر مجاناً على Render.com أو Railway.app
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(express.json());

// Store active rooms in memory
const rooms = new Map();
// roomId -> { id, name, ownerId, ownerName, mediaUrl, mediaType, memberCount, createdAt }

// REST endpoint: Owner registers room
app.post('/register-room', (req, res) => {
    const data = req.body;
    if (!data.id) return res.status(400).json({ error: 'Missing room id' });
    rooms.set(data.id.toUpperCase(), { ...data, memberCount: 1, createdAt: Date.now() });
    console.log(`[Room] Registered: ${data.id}`);
    res.json({ success: true });
});

// REST endpoint: Get room info (used by joining users)
app.get('/room/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    res.json(room);
});

// REST endpoint: Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        rooms: rooms.size,
        uptime: process.uptime()
    });
});

// REST endpoint: List active rooms (optional feature)
app.get('/rooms', (req, res) => {
    const activeRooms = Array.from(rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        ownerName: r.ownerName,
        memberCount: r.memberCount
    }));
    res.json(activeRooms);
});

// Socket.IO signaling
io.on('connection', (socket) => {
    console.log(`[+] Client connected: ${socket.id}`);

    // Client joins a room channel
    socket.on('join-room', (data) => {
        try {
            const roomId = data.roomId?.toUpperCase();
            if (!roomId) return;

            socket.join(roomId);
            socket.data.roomId = roomId;
            console.log(`[Room] ${socket.id} joined room ${roomId}`);
        } catch (e) {
            console.error('join-room error:', e);
        }
    });

    // Client leaves a room channel
    socket.on('leave-room', (data) => {
        try {
            const roomId = data.roomId?.toUpperCase();
            if (!roomId) return;

            socket.leave(roomId);
            console.log(`[Room] ${socket.id} left room ${roomId}`);
        } catch (e) {
            console.error('leave-room error:', e);
        }
    });

    // Relay message to all others in the room
    socket.on('message', (data) => {
        try {
            const roomId = data.roomId?.toUpperCase();
            if (!roomId) return;

            // Handle room creation (owner announces themselves)
            if (data.type === 'join' && data.data) {
                // Try to parse room info if owner is creating
                try {
                    const roomInfo = JSON.parse(data.data);
                    if (roomInfo.isOwner) {
                        rooms.set(roomId, {
                            id: roomId,
                            name: roomInfo.roomName || 'Watch Party',
                            ownerId: data.senderId,
                            ownerName: data.senderName,
                            mediaUrl: roomInfo.mediaUrl || '',
                            mediaType: roomInfo.mediaType || 'OTHER',
                            memberCount: 1,
                            createdAt: Date.now()
                        });
                    }
                } catch (_) {
                    // Not JSON, that's fine
                }
            }

            // Update member count
            if (data.type === 'join') {
                const room = rooms.get(roomId);
                if (room) room.memberCount++;
            } else if (data.type === 'leave') {
                const room = rooms.get(roomId);
                if (room) {
                    room.memberCount = Math.max(0, room.memberCount - 1);
                    // Clean up empty rooms after delay
                    if (room.memberCount <= 0) {
                        setTimeout(() => {
                            if (rooms.get(roomId)?.memberCount <= 0) {
                                rooms.delete(roomId);
                                console.log(`[Room] ${roomId} deleted (empty)`);
                            }
                        }, 30000);
                    }
                }
            }

            // Broadcast to all others in the room (excluding sender)
            socket.to(roomId).emit('message', data);

        } catch (e) {
            console.error('message relay error:', e);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[-] Client disconnected: ${socket.id}`);
        const roomId = socket.data.roomId;
        if (roomId) {
            const room = rooms.get(roomId);
            if (room) {
                room.memberCount = Math.max(0, room.memberCount - 1);
            }
        }
    });
});

// Clean up old rooms every hour
setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    for (const [id, room] of rooms.entries()) {
        if (room.createdAt < oneHourAgo && room.memberCount <= 0) {
            rooms.delete(id);
        }
    }
}, 3600000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 WatchParty Signaling Server running on port ${PORT}`);
});
