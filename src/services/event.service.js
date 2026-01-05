const db = require('../config/db');

const registerVehicle = async (vehicleData) => {
  const { 
    vehicle_id, model, color, 
    battery_voltage, battery_capacity, max_range 
  } = vehicleData;

  // 1. Kiểm tra Validation: Nếu thiếu bất kỳ trường nào
  if (!vehicle_id || !model || !color || !battery_voltage || !battery_capacity || !max_range) {
    const error = new Error("Invalid JSON format!");
    error.statusCode = 400;
    throw error;
  }

  // 2. Nếu đủ dữ liệu, thực hiện chèn (hoặc cập nhật) vào DB
  const queryText = `
    INSERT INTO vehicles (vehicle_id, model, color, battery_voltage, battery_capacity, max_range, last_online)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (vehicle_id) 
    DO UPDATE SET 
      battery_voltage = EXCLUDED.battery_voltage,
      last_online = NOW()
    RETURNING *;
  `;

  const values = [vehicle_id, model, color, battery_voltage, battery_capacity, max_range];
  const result = await db.query(queryText, values);
  
console.log(`✅ Vehicle ${vehicle_id} connected and saved to DB`);
  return result.rows[0];
};

module.exports = {
  registerVehicle
};