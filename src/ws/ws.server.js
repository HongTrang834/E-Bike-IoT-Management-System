const WebSocket = require('ws');
const redisClient = require('../config/redis');
const mqttService = require('../services/mqtt.service');
const mqttClient = require('../config/mqtt');

const initWebSocket = (server) => {
    const wss = new WebSocket.Server({ server, path: '/api/user/ws' });

    wss.on('connection', async (ws, req) => {
        // Lấy token từ Protocol Header
        const token = req.headers['sec-websocket-protocol'];
        console.log(`[WS] New connection attempt with token: ${token}`);

        if (!token) {
            console.log("[WS] Connection rejected: No token provided");
            ws.send(JSON.stringify({ type: "error", message: "No token provided" }));
            return ws.terminate();
        }

        // Truy vấn Redis
        const sessionKey = `user:token:${token}`;
        const sessionData = await redisClient.hGetAll(sessionKey);

        if (Object.keys(sessionData).length > 0) {
            // --- AUTH THÀNH CÔNG ---
            ws.userToken = token;
            ws.email = sessionData.email;
            ws.vehicle_id = sessionData.vehicle_id;
            ws.isAlive = true;
            ws.missedPings = 0;

            console.log(`[WS] Authorized: ${ws.email} (Vehicle: ${ws.vehicle_id})`);
            ws.send(JSON.stringify({ type: "token", data: "OK" }));

            // Gửi dữ liệu Snapshot ngay khi kết nối
if (ws.vehicle_id) {
    try {
        const streamKey = `vehicle:stream:${ws.vehicle_id}`;
    
        const payload = await redisClient.hGetAll(streamKey);

        if (Object.keys(payload).length > 0) {
            // payload lúc này là: { telemetry: '...', status: '...', cmd: '...', vehicle_id: '...' }
            if (payload.telemetry) {
                ws.send(JSON.stringify({
                    type: "telemetry",
                    vehicle_id: ws.vehicle_id,
                    data: JSON.parse(payload.telemetry)
                }));
            }

            if (payload.status) {
                ws.send(JSON.stringify({
                    type: "status",
                    vehicle_id: ws.vehicle_id,
                    data: JSON.parse(payload.status)
                }));
            }            
            console.log(`[WS] Snapshot sent from HASH for vehicle ${ws.vehicle_id}`);
        } else {
            console.log(`[WS] No data found in HASH for vehicle ${ws.vehicle_id}`);
        }
    } catch (err) {
        console.error(`[WS] Error fetching snapshot from HASH:`, err.message);
    }
}

            // LẮNG NGHE TIN NHẮN TỪ CLIENT
            ws.on('message', async (message) => {
                try {
                    const payload = JSON.parse(message);
                    
                    // XỬ LÝ HEARTBEAT PONG
                    if (payload.type === 'heartbeat' && payload.data === 'pong') {
                        ws.isAlive = true;
                        ws.missedPings = 0; 
                        console.log(`[WS] Received PONG from ${ws.email}`);
                        return;
                    }

                    // XỬ LÝ LỆNH ĐIỀU KHIỂN
                    if (payload.type !== undefined && payload.value !== undefined) {
                        await mqttService.sendCommand(mqttClient, ws.vehicle_id, payload.type, payload.value);
                    }
                } catch (e) {
                    console.error("[WS] Message Parse Error:", e.message);
                }
            });

            ws.on('close', () => {
                console.log(`[WS] Client ${ws.email} closed connection`);
            });

        } else {
            console.log(`[WS] Auth Failed: Token ${token} not found in Redis`);
            ws.send(JSON.stringify({ type: "token", data: "NG" }));
            ws.terminate();
        }
    });

    // CƠ CHẾ PING 
    const interval = setInterval(() => {
        wss.clients.forEach((ws) => {
            if (ws.readyState === WebSocket.OPEN && ws.userToken) {
                if (ws.missedPings >= 5) {
                    console.log(`[WS] Terminating ${ws.email} due to pong timeout`);
                    return ws.terminate();
                }
                
                ws.isAlive = false;
                ws.missedPings++;
                ws.send(JSON.stringify({ type: "heartbeat", data: "ping" }));
                console.log(`[WS] Sent Ping to ${ws.email} (Missed: ${ws.missedPings-1})`);
            }
        });
    }, 5000);

    wss.on('close', () => clearInterval(interval));
};

module.exports = initWebSocket;