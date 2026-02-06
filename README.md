# BE Server - Vehicle IoT System

Một backend server Node.js xây dựng hệ thống quản lý vehicle IoT thời gian thực, kết nối với MQTT broker, PostgreSQL database và Redis cache.

## Tính Năng

- **Authentication & Authorization**: Hệ thống đăng nhập, đăng ký với Redis session tokens
- **Vehicle Management**: Quản lý vehicle, thêm/chọn xe
- **Account Management**: Cập nhật thông tin người dùng, cài đặt cá nhân,...
- **Real-time Communication**: WebSocket để cập nhật dữ liệu thời gian thực
- **MQTT Integration**: Kết nối với MQTT broker để nhận dữ liệu từ sensor vehicle
- **Caching**: Sử dụng Redis để cache dữ liệu
- **Database**: PostgreSQL để lưu trữ dữ liệu người dùng và vehicle
- **Email Notification**: Gửi email thông báo 

## Yêu Cầu Hệ Thống

Trước khi cài đặt, đảm bảo đã cài đặt các phần mềm sau:

### 1. Node.js & npm
- **Node.js**: Phiên bản 14.0.0 trở lên
- **npm**: Phiên bản 6.0.0 trở lên
- Tải tại: https://nodejs.org/

### 2. PostgreSQL
- **Phiên bản**: 12.0 trở lên
- Tải tại: https://www.postgresql.org/download/
- **Port mặc định**: 5432

### 3. Redis
- **Phiên bản**: 6.0 trở lên
- Tải tại: https://redis.io/download
- **Port mặc định**: 6379

### 4. MQTT Broker (Mosquitto hoặc tương tự)
- **Phiên bản**: 1.6 trở lên
- Tải tại: https://mosquitto.org/download/
- **Port mặc định**: 1883

## Cài Đặt

### Bước 1: Clone Dự Án

```bash
git clone https://github.com/HongTrang834/E-Bike-IoT-Management-System.git
```

### Bước 2: Cài Đặt Dependencies

```bash
npm install
```

Lệnh này sẽ cài đặt tất cả các package được liệt kê trong file `package.json`:
- express: Framework web server
- pg: PostgreSQL client
- redis: Redis client
- mqtt: MQTT client
- bcrypt: Mã hóa mật khẩu
- nodemailer: Gửi email
- socket.io: Real-time communication
- ws: WebSocket
- cors: Cross-origin resource sharing
- dotenv: Quản lý biến môi trường

### Bước 3: Thiết Lập PostgreSQL Database

1. **Mở PostgreSQL Command Line** hoặc **pgAdmin**

2. **Tạo database**:
```sql
CREATE DATABASE vehicle_iot_system;
```

3. **Kết nối đến database vừa tạo**:
```sql
\c vehicle_iot_system
```

4. **Tạo các bảng cần thiết**:
```sql
-- Bảng người dùng
CREATE TABLE accounts (
email VARCHAR(50) PRIMARY KEY,
user_name VARCHAR(10) NOT NULL,
phone_number VARCHAR(15),
gender VARCHAR(10),
region VARCHAR(2), -- ISO 3166-1 alpha-2 (VN, TH, JP...)
password VARCHAR(255) NOT NULL, 
setting_darkmode BOOLEAN DEFAULT FALSE,
setting_sound BOOLEAN DEFAULT TRUE,
setting_language VARCHAR(2) DEFAULT 'en',
vehicle_id SERIAL, 
verify_code VARCHAR(6),
created_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
CONSTRAINT fk_selected_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(vehicle_id)
);

-- Bảng vehicle
CREATE TABLE vehicles (
vehicle_id SERIAL PRIMARY KEY,
model VARCHAR(10),
color VARCHAR(10),
battery_voltage SMALLINT,
battery_capacity SMALLINT,
max_range SMALLINT,
created_at TIMESTAMPTZ DEFAULT now(),
last_online TIMESTAMPTZ
);

-- Bảng dữ liệu user_vehicle_mapping
CREATE TABLE user_vehicle_mapping (
email VARCHAR(50) REFERENCES accounts(email),
vehicle_id VARCHAR(50) REFERENCES vehicles(vehicle_id),
vehicle_name VARCHAR(50), 
PRIMARY KEY (email, vehicle_id)
);

-- Tạo extension timescale
create extension if not exists timescaledb

-- Bảng ghi log event 
CREATE TABLE event_log (
time TIMESTAMPTZ not null,
vehicle_id serial references vehicles(vehicle_id),
name smallint, 
type smallint 
value char(10)
);

-- Bảng ghi log location 
CREATE TABLE location_log(
time TIMESTAMPTZ not null
vehicle_id serial reeferences vehicles(vehicle_id),
lat real, 
lon real,
heading smallint
);

-- Biến bảng thành hypertable
select create_hypertable('event_log', 'time');
select create_hypertable('location_log', 'time');

-- Kiểm tra các hypertable đã tạo
select * from timescaledb_information.hypertables;

```

### Bước 4: Cài Đặt và Chạy PostgreSQL, Redis, MQTT Broker

#### PostgreSQL:
```bash
# Windows
# Nếu cài đặt bằng installer, PostgreSQL sẽ tự động chạy như service

# Kiểm tra kết nối (sử dụng psql)
psql -U postgres
```

#### Redis:
```bash
# Windows - chạy Redis server
# Nếu cài Redis, mở Command Prompt tại folder Redis
redis-server.exe

# Hoặc nếu đã cài Redis service, nó sẽ tự động chạy
```

#### MQTT Broker (Mosquitto):
```bash
- Tải mosquitto và chạy file .exe
- Mở Services và đảm bảo tiến trình Mosquitto broker là running
- Thêm 2 dòng sau vào file C:/Program/mosquitto.CONF:
listener 1883
allow_anonymous true
- Restart mosquitto trong Services
```

## ⚙️ Cấu Hình

### Tạo File `.env`

Trong thư mục gốc dự án, tạo file `.env` với nội dung sau:

```env
DB_USER=postgres
DB_PASSWORD=your_postgres_password
DB_HOST=localhost
DB_PORT=5432
REDIS_HOST=127.0.0.1
MQTT_HOST=localhost
EMAIL_USER=your_email@gmail.com
EMAIL_PASSWORD=your_app_password_here
PORT=3000
```

**⚠️ Lưu ý quan trọng:**
- Thay `your_postgres_password`, `your_app_password_here`, `your_email@gmail.com` bằng nội dung thực tế
- EMAIL_PASSWORD phải là App Password (không phải mật khẩu Gmail), chỉ khả dụng khi bật 2-Step Verification
### Kiểm Tra Kết Nối (Optional)

Sau khi cấu hình, có thể kiểm tra xem các dịch vụ có chạy không:

```bash
# Kiểm tra PostgreSQL
psql -h localhost -U postgres -d vehicle_iot_system

# Kiểm tra Redis
redis-cli ping
# Kết quả sẽ là: PONG

# Kiểm tra MQTT
# Sử dụng một MQTT client để test kết nối đến localhost:1883
```

## Chạy Ứng Dụng

### Mode Sản Phẩm (Production)

```bash
npm start
# hoặc
node src/app.js
```

Server sẽ khởi động tại `http://localhost:3000`

Kết quả console sẽ hiển thị:
```
Server & WebSocket running on port 3000
Connected to Redis
Connected to MQTT Broker
Connected to PostgreSQL
```

### Mode Phát Triển (Development) - Với Auto Reload

Sử dụng `nodemon` để tự động reload khi có thay đổi code:

```bash
npm run dev
```

Hoặc cài đặt script trong `package.json`:

```json
"scripts": {
  "start": "node src/app.js",
  "dev": "nodemon src/app.js"
}
```

Sau đó chạy:
```bash
npm run dev
```

## 📁 Cấu Trúc Dự Án

```
BE_server/
├── src/
│   ├── app.js                 # Entry point chính
│   ├── api/
│   │   ├── user.route.js      # Routes cho người dùng
│   │   └── vehicle.route.js   # Routes cho vehicles
│   ├── config/
│   │   ├── db.js              # Cấu hình PostgreSQL
│   │   ├── mqtt.js            # Cấu hình MQTT
│   │   └── redis.js           # Cấu hình Redis
│   ├── controllers/
│   │   └── vehicle.controller.js  # Logic điều khiển vehicle
│   ├── middleware/
│   │   └── auth.js            # Middleware xác thực session
│   ├── services/
│   │   ├── mqtt.service.js    # Service xử lý MQTT messages
│   │   ├── user.service.js    # Business logic người dùng
│   │   └── vehicle.service.js # Business logic vehicle
│   ├── ws/
│      └── ws.server.js       # WebSocket server
|
├── package.json               # Node.js dependencies
├── .env                       # Biến môi trường (tạo tay)
└── README.md                  # Tài liệu này
```

## API Endpoints

### Người Dùng (User Routes)

#### 1. Đăng Ký
```
POST /api/user/signup
```

#### 2. Đăng Nhập
```
POST /api/user/login
```

#### 3. Thêm Vehicle
```
POST /api/user/add_vehicle
```

#### 4. Chọn Vehicle Hiện Tại
```
GET /api/user/select?vehicle_id=1
```

### Vehicle (Vehicle Routes)

#### 1. Kết Nối Vehicle
```
POST /api/vehicle/connect
```
#### Và nhiều API khác...
## 📡 MQTT Topics

Server đăng ký lắng nghe các topic sau:

| Topic | 
|-------|
| `bike/+/telemetry` |
| `bike/+/status`  |
| `bike/+/location` |
| `bike/+/event`|

## WebSocket Connection

WebSocket được khởi tạo trên cùng port với HTTP server:

## Testing

### Test MQTT với Python

Có thể sử dụng file `Simulation_mqtt.py` để simulate dữ liệu từ vehicle.
Chi tiết file xin vui lòng liên hệ chủ sở hữu dự án. 
### Kiểm tra dữ liệu trong Redis 
```bash
redis-cli
# Sử dụng các lệnh Redis để kiểm tra dữ liệu
KEYS *
HGETALL ... 
```

## Khắc Phục Sự Cố

### 1. "Cannot connect to PostgreSQL"
- Kiểm tra PostgreSQL service có chạy không
- Kiểm tra thông tin kết nối trong file `.env`
- Kiểm tra database `vehicle_iot_system` đã được tạo chưa

### 2. "Cannot connect to Redis"
- Kiểm tra Redis service có chạy không
- Mặc định Redis chạy trên port 6379
- Dùng `redis-cli ping` để kiểm tra

### 3. "Cannot connect to MQTT Broker"
- Kiểm tra MQTT Broker (Mosquitto) có chạy không
- Mặc định chạy trên port 1883
- Dùng `mosquitto_sub -h localhost -t 'bike/+/telemetry'` để kiểm tra

### 4. "Module not found"
- Chạy `npm install` lại
- Xóa folder `node_modules` và chạy `npm install` lại

```bash
rmdir /s node_modules
npm install
```

## 📚 Tài Liệu Tham Khảo

- [Express.js](https://expressjs.com/)
- [PostgreSQL](https://www.postgresql.org/docs/)
- [Redis](https://redis.io/documentation)
- [MQTT.js](https://github.com/mqttjs/MQTT.js)
- [Socket.io](https://socket.io/docs/)

**Tài liệu này được cập nhật lần cuối:** Tháng 02, 2026

Nếu có bất kỳ câu hỏi hoặc vấn đề nào, vui lòng tham khảo tài liệu chính thức của các thư viện hoặc kiểm tra logs của ứng dụng.
