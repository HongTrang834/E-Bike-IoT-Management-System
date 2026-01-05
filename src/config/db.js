const { Pool } = require('pg');
require('dotenv').config();

// Khởi tạo Pool kết nối
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: 'vehicle_iot_system',
  port: process.env.DB_PORT || 5432,
});

// Kiểm tra kết nối
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL');
});

module.exports = {
  query: (text, params) => pool.query(text, params),
};