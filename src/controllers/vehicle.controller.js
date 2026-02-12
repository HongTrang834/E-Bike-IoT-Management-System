const redisClient = require('../config/redis');

const getFleetDashboard = async (req, res) => {
    try {
        const keys = await redisClient.keys('vehicle:stream:*');

        const fleetData = await Promise.all(keys.map(async (key) => {
            const vehicleId = key.split(':').pop();

            const streamData = await redisClient.hGetAll(key);


            const locationData = await redisClient.hGetAll(`vehicle:last_location:${vehicleId}`);

            const safeParse = (str) => {
                try {
                    return str ? JSON.parse(str) : {};
                } catch (e) {
                    return { raw_value: str };
                }
            };

            const telemetry = streamData.telemetry ? JSON.parse(streamData.telemetry) : {};
            const status = streamData.status ? JSON.parse(streamData.status) : {};

            return {
                vehicle_id: vehicleId,
                last_update: new Date().toISOString(),
                // Thông tin Pin & Vận hành
                speed: telemetry.speed || 0,
                soc: telemetry.soc || 0,
                voltage: telemetry.voltage || 0,
                // Trạng thái xe
                is_locked: status.locked || false,
                mode: status.mode || 0,
                // Tọa độ bản đồ
                location: {
                    lat: parseFloat(locationData.lat) || 0,
                    lon: parseFloat(locationData.lon) || 0,
                    heading: parseInt(locationData.heading) || 0
                }
            };
        }));

        res.status(200).json({
            success: true,
            total_vehicles: fleetData.length,
            data: fleetData
        });
    } catch (error) {
        console.error('Dashboard API Error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getFleetDashboard };