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

                    const defaultTelemetry = {
                        speed: 0, odo: 0, trip: 0, range_left: 0,
                        voltage: 0, current: 0, soc: 0, temperature: 0,
                        tilt_angle: 0, hill_asstistance: 0
                    };

                    const defaultStatus = {
                        mode: 0, locked: 0, trunk_locked: 0, horn: 0,
                        headlight: 0, rear_light: 0, turn_light: 0,
                        push_notify: 0, batt_alerts: 0, security_alerts: 0,
                        auto_lock: 0, bluetooth_unlock: 0, remote_access: 0
                    };

                    const telemetryData = payload.telemetry
                        ? JSON.parse(payload.telemetry)
                        : defaultTelemetry;

                    ws.send(JSON.stringify({
                        type: "telemetry",
                        vehicle_id: ws.vehicle_id,
                        data: telemetryData
                    }));

                    const statusData = payload.status
                        ? JSON.parse(payload.status)
                        : defaultStatus;

                    ws.send(JSON.stringify({
                        type: "status",
                        vehicle_id: ws.vehicle_id,
                        data: statusData
                    }));

                    console.log(`[WS] Snapshot sent for vehicle ${ws.vehicle_id}. (Source: ${payload.telemetry ? 'Redis' : 'Default'})`);

                } catch (err) {
                    console.error(`[WS] Error fetching snapshot from Redis:`, err.message);
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
                console.log(`[WS] Sent Ping to ${ws.email} (Missed: ${ws.missedPings - 1})`);
            }
        });
    }, 5000);

    wss.on('close', () => clearInterval(interval));
};

module.exports = initWebSocket;