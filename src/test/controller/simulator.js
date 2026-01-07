const mqttService = require('../../services/mqtt.service');
const mqttClient = require('../../config/mqtt');

const simulateUserControl = async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { type, value } = req.query;

        await mqttService.sendCommand(mqttClient, vehicleId, type, value);

        res.json({
            status: "Simulation from app Success",
            vehicle: vehicleId,
            command_sent: { type, data: value },
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = { simulateUserControl };