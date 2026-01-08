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

  //  Nếu đủ dữ liệu, thực hiện chèn hoặc cập nhật vào DB
  const queryText = `
    INSERT INTO vehicles (vehicle_id, model, color, battery_voltage, battery_capacity, max_range, last_online)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
      model = EXCLUDED.model,
      color = EXCLUDED.color,
      battery_voltage = EXCLUDED.battery_voltage,
      battery_capacity = EXCLUDED.battery_capacity,
      max_range = EXCLUDED.max_range,
      last_online = NOW()
    RETURNING *;
  `;

  const values = [vehicle_id, model, color, battery_voltage, battery_capacity, max_range];
  const result = await db.query(queryText, values);
  

  // Create stream vehicle data  redis with vehicle_id 
  const redisKey = `vehicle:stream:${vehicle_id}`;
  await redisClient.hSet(redisKey, {
    "vehicle_id" : vehicle_id,
  });
  console.log(`Vehicle ${vehicle_id} connected and save in Redis.`);
  return result.rows[0];
};

module.exports = {
  registerVehicle
};