require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const redisClient = require('./config/redis');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

// Khởi tạo HTTP Server từ Express App
const server = http.createServer(app); 

// Khởi tạo WebSocket Server gắn với HTTP Server
const wss = new WebSocket.Server({
    server,
    path: '/api/user/ws' 
});

global.activeSockets = new Map();

// Import routes
const vehicleRoutes = require('./api/vehicle.route');
const userRoutes = require('./api/user.route');
const mqttClient = require('./config/mqtt');
const mqttService = require('./services/mqtt.service');

app.use('/api/user', userRoutes);
app.use('/api/vehicle', vehicleRoutes);

mqttClient.on('message', (topic, message) => {
    mqttService.handleMqttMessage(topic, message);
}); 

wss.on('connection', async (ws, req) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        const email = url.searchParams.get('email');

        if (!token || !email) {
            console.log('[WS] Connection rejected: Missing token/email');
            ws.terminate();
            return;
        }

        // Kiểm tra Redis 
        const storedToken = await redisClient.hGet(`user:token:${email}`, 'token');
        console.log(`[DEBUG] Email: ${email} | URL Token: [${token}] | Redis Token: [${storedToken}]`);
        if (token !== storedToken) {
            console.log('[WS] Connection rejected: Invalid token');
            ws.terminate();
            return;
        }

        // thiet lap trang thai cho heartbeat
        ws.email = email;
        ws.isAlive = true; 
        global.activeSockets.set(email, ws);
        console.log(`[WS] User ${email} connected`);

        // đếm số lần không nhận được pong, nếu đủ 5 lần thì ngắt kết nối 
        ws.missedPings = 0;

        // Lắng nghe PONG từ Client
        ws.on('pong', () => {
            ws.isAlive = true;
            ws.missedPings = 0; // cap nhat lai so lan dem
            // Cập nhật lasttime_pong (Mục 4.2.3.1)
            redisClient.hSet(`user:token:${email}`, 'lasttime_pong', new Date().toISOString());
            console.log(`[WS] Received PONG from ${email}`);
        });

        // SAU KHI AUTH THÀNH CÔNG: Lấy thêm vehicle_id từ Redis và lưu vào đối tượng ws
    const vehicleId = await redisClient.hGet(`user:token:${email}`, 'vehicle_id');
    ws.email = email;
    ws.vehicle_id = vehicleId; // Lưu lại để dùng cho CMD
    
    global.activeSockets.set(email, ws);

    ws.on('message', async (message) => {
        try {
            const payload = JSON.parse(message);
            
            // Bây giờ App chỉ cần gửi cmd_type và value
            const { type, value } = payload; 

            if (type !== undefined && value !== undefined) {
                // Sử dụng ws.vehicle_id đã lưu khi handshake để gửi lệnh
                await mqttService.sendCommand(mqttClient, ws.vehicle_id, type, value);
                console.log(`[WS] Sent CMD ${type} to Vehicle ${ws.vehicle_id} for User ${ws.email}`);
            }
        } catch (e) {
            console.error('[WS] Error processing CMD:', e.message);
        }
    });

    ws.on('close', () => {
        global.activeSockets.delete(email);
        console.log(`[WS] ${email} disconnected`);
    });

    } catch (err) {
        ws.terminate();
    }
});

// CƠ CHẾ PING MỖI 5 GIÂY 
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        // Nếu đã quá 5 lần không phản hồi
        if (ws.missedPings >= 5) {
            console.log(`[WS] Terminating ${ws.email} after 5 failed pings.`);
            global.activeSockets.delete(ws.email);
            return ws.terminate();
        }

        // Tăng biến đếm và gửi Ping
        ws.isAlive = false; 
        ws.missedPings++; // Tạm thời coi là thất bại cho đến khi nhận được Pong
        ws.ping(); 
        console.log(`[WS] Sent PING #${ws.missedPings} to ${ws.email}`);
    });
}, 5000);

wss.on('close', () => {
    clearInterval(interval);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server & WS running on port ${PORT}`);
});