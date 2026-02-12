const db = require('../config/db');
const redisClient = require('../config/redis');


const registerVehicle = async (vehicleData) => {
  const {
    vehicle_id, model, color,
    battery_voltage, battery_capacity, max_range
  } = vehicleData;

  // Kiểm tra Validation: Nếu thiếu bất kỳ trường nào
  if (!vehicle_id || !model || !color || !battery_voltage || !battery_capacity || !max_range) {
    const error = new Error("Invalid JSON format!");
    error.statusCode = 400;
    throw error;
  }

  //  Nếu đủ dữ liệu, chỉ update last_online nếu xe đã tồn tại
  const existing = await db.query(
    'SELECT vehicle_id FROM vehicles WHERE vehicle_id = $1',
    [vehicle_id]
  );

  let result;
  if (existing.rows.length > 0) {
    result = await db.query(
      'UPDATE vehicles SET last_online = NOW() WHERE vehicle_id = $1 RETURNING *',
      [vehicle_id]
    );
  } else {
    const queryText = `
      INSERT INTO vehicles (vehicle_id, model, color, battery_voltage, battery_capacity, max_range, last_online)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      RETURNING *;
    `;
    const values = [vehicle_id, model, color, battery_voltage, battery_capacity, max_range];
    result = await db.query(queryText, values);
  }


  // Create stream vehicle data  redis with vehicle_id 
  const redisKey = `vehicle:stream:${vehicle_id}`;
  await redisClient.hSet(redisKey, {
    "vehicle_id": vehicle_id,
  });
  console.log(`Vehicle ${vehicle_id} connected and save in Redis.`);
  return result.rows[0];
};

const getVehicleState = async (vehicleId) => {
  const redisKey = `vehicle:stream:${vehicleId}`;
  const data = await redisClient.hGetAll(redisKey);
  const defaultState = {
    mode: 0,
    locked: 0,
    trunk_locked: 0,
    horn: 0,
    answareback: 0,
    headlight: 0,
    rear_light: 0,
    turn_light: 0,
    push_notify: 0,
    batt_alerts: 0,
    security_alerts: 0,
    auto_lock: 0,
    bluetooth_unlock: 0,
    remote_access: 0,
  };

  if (data && data.status) {
    try {
      const status = JSON.parse(data.status);
      Object.keys(status).forEach(key => {
        let value = status[key];
        if (typeof value === 'boolean') {
          value = value ? 1 : 0;
        }
        defaultState[key] = value;
      });
    } catch (e) {
      console.error('Error parsing status:', e);
    }
  }

  return defaultState;
};

module.exports = {
  registerVehicle,
  getVehicleState
};