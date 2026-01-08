const redisClient = require('../config/redis');
const db = require('../config/db');

/**
 * Xử lý giải mã dữ liệu Binary MQTT từ xe gửi lên
 */
const handleMqttMessage = async (topic, message) => {
    try {
        const topicParts = topic.split('/');
        const vehicleId = topicParts[1];
        const dataType = topicParts[2];
        const buffer = Buffer.from(message);
        let decodedData = {};

        // 1. Giải mã Telemetry (23 bytes tổng cộng)
        if (dataType === "telemetry") {
            decodedData = {
                speed: buffer.readUInt16BE(0),            // 2 bytes
                odo: buffer.readUInt32BE(2),              // 4 bytes
                trip: buffer.readUInt32BE(6),             // 4 bytes
                range_left: buffer.readUInt16BE(10),      // 2 bytes
                voltage: buffer.readUInt16BE(12),         // 2 bytes
                current: buffer.readInt16BE(14),          // 2 bytes
                soc: buffer.readUInt16BE(16),             // 2 bytes
                temperature: buffer.readInt16BE(18),      // 2 bytes
                tilt_angle: buffer.readInt16BE(20),       // 2 bytes
                hill_assistance: buffer.readUInt8(22)     // 1 byte
            };
            console.log(`[Telemetry] Decoded for ${vehicleId}:`, decodedData);
        }

        // 2. Giải mã Status (15 bytes tổng cộng)
        else if (dataType === "status") {
            decodedData = {
                mode: buffer.readUInt16BE(0),             // 2 bytes
                locked: buffer.readUInt8(2) === 1,        // 1 byte -> boolean
                trunk_locked: buffer.readUInt8(3) === 1,
                horn: buffer.readUInt8(4) === 1,
                answareback: buffer.readUInt8(5) === 1,
                headlight: buffer.readUInt8(6) === 1,
                rear_light: buffer.readUInt8(7) === 1,
                turn_light: buffer.readUInt8(8),
                push_notify: buffer.readUInt8(9) === 1,
                batt_alerts: buffer.readUInt8(10) === 1,
                security_alerts: buffer.readUInt8(11) === 1,
                auto_lock: buffer.readUInt8(12) === 1,
                bluetooth_unlock: buffer.readUInt8(13) === 1,
                remote_access: buffer.readUInt8(14) === 1
            };
            console.log(`[Status] Decoded for ${vehicleId}:`, decodedData);
        }

        // 3. Giải mã Location (10 bytes tổng cộng)
        else if (dataType === "location") {
            const lat = buffer.readInt32BE(0) / 10000000; // 4 bytes
            const lon = buffer.readInt32BE(4) / 10000000; // 4 bytes
            const heading = buffer.readUInt16BE(8);       // 2 bytes

            const redisKey = `vehicle:last_location:${vehicleId}`;
            const lastLoc = await redisClient.hGetAll(redisKey);

            // Chỉ lưu DB nếu có sự thay đổi tọa độ
            if (lat != lastLoc.lat || lon != lastLoc.lon || heading != lastLoc.heading) {
                const query = 'INSERT INTO location_log (time, vehicle_id, lat, lon, heading) VALUES (NOW(), $1, $2, $3, $4)';
                await db.query(query, [vehicleId, lat, lon, heading]);
                
                // Cập nhật Redis làm bộ đệm so sánh
                await redisClient.hSet(redisKey, { lat: lat.toString(), 
                lon: lon.toString(), 
                heading: heading.toString() });
                console.log(`[Location] Updated DB for ${vehicleId}`);
            }
            return; 
        }

        // 4. Giải mã Event (16 bytes tổng cộng)
        else if (dataType === "event") {
            const eventId = buffer.readUInt32BE(0);    // 4 bytes đầu là name 
            const typeId = buffer.readUInt16BE(4);     // 2 bytes tiếp là type
            // value 10 byte: Đọc dưới dạng chuỗi ký tự
            const value = buffer.toString('utf8', 6, 16).replace(/\0/g, '');
            
            // Ánh xạ tên sự kiện dùng cho App
            /*
            const names = {
                0: 'None',
                1: 'theft',
                2: 'crash',
                3: 'overtemp',
                11: 'low_soc',
                12: 'dtc',
                21: 'lock_on',
                22: 'lock_off',
                23: 'trunk_lock',
                24: 'horn',
                25: 'vehicle_packed',
                26: 'vehicle_stand',
                27: 'vehicle_reverse'
            };

            const types = {
                0: 'Info',
                1: 'Warning',
                2: 'Error'
            };
            */

            //save to DB
            const query = 'INSERT INTO event_log (time, vehicle_id, name, type, value) VALUES (NOW(), $1, $2, $3, $4)';
            await db.query(query, [vehicleId, eventId, typeId, value]);
            console.log(`[Event] Logged for ${vehicleId}: ${eventId} (${typeId}) with value ${value}`);
            return;
        }

        // LƯU VÀO REDIS CHO TELEMETRY/STATUS/CMD (Stream Data)
        if (Object.keys(decodedData).length > 0) {
            const redisStreamKey = `vehicle:stream:${vehicleId}`;
            await redisClient.hSet(redisStreamKey, {
                "vehicle_id": vehicleId,
                [dataType]: JSON.stringify(decodedData)
            });
        }

    } catch (error) {
        console.error('Error handling Binary MQTT message:', error.message);
    }
};

/**
 * Gửi lệnh điều khiển xuống xe (QoS 2)
 */
const sendCommand = async (mqttClient, vehicleId, type, value) => {
    const topic = `bike/${vehicleId}/cmd`;
    const payload = JSON.stringify({ type, data: value });

    mqttClient.publish(topic, payload, { qos: 2 });

    const redisKey = `vehicle:stream:${vehicleId}`;
    await redisClient.hSet(redisKey, {
        "vehicle_id": vehicleId,
        "cmd": payload
    });
    console.log(`[Command] Sent to ${vehicleId}: ${type}`);
};

module.exports = { handleMqttMessage, sendCommand };