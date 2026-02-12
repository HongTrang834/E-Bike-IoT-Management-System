import random
import struct
import requests
import time
import json
import sys
import paho.mqtt.client as mqtt

# ===== MQTT CONFIG =====
# MQTT_BROKER = "23.21.57.218"
MQTT_BROKER = "localhost"
MQTT_PORT = 1883
BASE_TOPIC = "bike"

# ===== VEHICLE IDS (FROM CLI) =====
# usage:
#   python bike_publisher.py 1
#   python bike_publisher.py 1,2,3

vehicle_status = {}
if len(sys.argv) > 1:
    VEHICLES = [v.strip() for v in sys.argv[1].split(",") if v.strip()]
else:
    VEHICLES = ["1"]

# ===== MQTT CLIENT =====
# Paho MQTT v2 thay đổi callback API, đảm bảo tương thích v1/v311
try:
    client = mqtt.Client(protocol=mqtt.MQTTv311)
except TypeError:
    # Fallback nếu môi trường dùng paho < 1.6
    client = mqtt.Client()

# ===== MQTT CALLBACK =====
def on_connect(client, userdata, flags, rc, properties=None):
    print("🔗 Connected to MQTT broker, rc =", rc)

    # Subscribe command topic for each vehicle
    for vid in VEHICLES:
        topic = f"{BASE_TOPIC}/{vid}/cmd"
        client.subscribe(topic, qos=0)
        print(f"🔔 Subscribed: {topic}")

def on_message(client, userdata, msg):
    try:
        topic = msg.topic
        payload = msg.payload

        # topic format: bike/{vehicle_id}/cmd
        _, vehicle_id, _ = topic.split("/")

        print(f"📥 CMD received for vehicle {vehicle_id}: {payload}")
        # Handle data
        field = int.from_bytes(payload[0:2], byteorder='little', signed=False)
        FIELD_MAP = {
            1: "locked",
            2: "trunk_locked",
            3: "horn",
            4: "answareback",
            5: "headlight",
            6: "rear_light",
            7: "turn_light",
            8: "push_notify",
            9: "batt_alerts",
            10: "security_alerts",
            11: "auto_lock",
            12: "bluetooth_unlock",
            13: "remote_access",
        }
        key = FIELD_MAP.get(field)
        if key is None:
            print("⚠ Unknown field:", field)
            return
        value = int.from_bytes(payload[2:4], byteorder='little', signed=False)
        vehicle_key = f"id_{vehicle_id}"
        if vehicle_key not in vehicle_status:
            # Khởi tạo mặc định nếu thiếu
            vehicle_status[vehicle_key] = {
                "mode": 0,
                "locked": 0,
                "trunk_locked": 0,
                "horn": 0,
                "answareback": 0,
                "headlight": 0,
                "rear_light": 0,
                "turn_light": 0,
                "push_notify": 0,
                "batt_alerts": 0,
                "security_alerts": 0,
                "auto_lock": 0,
                "bluetooth_unlock": 0,
                "remote_access": 0,
            }
        print(f"📥 Decode: {key}: {value}")
        
        # Update status và gửi lại cho backend
        vehicle_status[vehicle_key][key] = value
        vehicle_status[vehicle_key]["mode"] = random.randint(0, 2)
        
        # Map key sang format MQTT (với _suffix bit count)
        KEY_MAP = {
            "mode": "mode_2",
            "locked": "locked_1",
            "trunk_locked": "trunk_locked_1",
            "horn": "horn_1",
            "answareback": "answareback_1",
            "headlight": "headlight_1",
            "rear_light": "rear_light_1",
            "turn_light": "turn_light_1",
            "push_notify": "push_notify_1",
            "batt_alerts": "batt_alerts_1",
            "security_alerts": "security_alerts_1",
            "auto_lock": "auto_lock_1",
            "bluetooth_unlock": "bluetooth_unlock_1",
            "remote_access": "remote_access_1"
        }
        
        status_trans = {}
        for old_key, new_key in KEY_MAP.items():
            val = vehicle_status[vehicle_key].get(old_key, 0)
            status_trans[new_key] = val
        
        # Chuyển thành bytearray và gửi lại
        status_bytearr = to_bytearray(status_trans)
        
        # Publish status lên backend
        status_topic = f"{BASE_TOPIC}/{vehicle_id}/status"
        client.publish(status_topic, status_bytearr, qos=0)
        print(f"✅ Status published back: {status_topic}")
        print(f"   Updated state: {vehicle_status[vehicle_key]}")

    except Exception as e:
        print("CMD handling error:", e)

client.on_connect = on_connect
client.on_message = on_message

# Kết nối MQTT an toàn, tránh crash nếu broker chưa chạy
try:
    client.connect(MQTT_BROKER, MQTT_PORT, 60)
    client.loop_start()
except Exception as e:
    print(f"❌ MQTT connect error to {MQTT_BROKER}:{MQTT_PORT} -> {e}")
    print("👉 Hãy đảm bảo broker đang chạy (mosquitto) rồi thử lại.")

def to_bytearray(telemetry: dict) -> bytearray:
    buf = bytearray()

    for key, value in telemetry.items():
        try:
            name, num_bytes = key.rsplit("_", 1)
            num_bytes = int(num_bytes)

            # ===== INT =====
            if isinstance(value, int):
                b = value.to_bytes(
                    length=num_bytes,
                    byteorder="little",
                    signed=True
                )

            # ===== FLOAT =====
            elif isinstance(value, float):
                if num_bytes != 4:
                    raise ValueError("Float must be 4 bytes")
                b = struct.pack("<f", value)

            # ===== STRING =====
            elif isinstance(value, str):
                b = value.encode("ascii")

                if len(b) < num_bytes:
                    b = b.ljust(num_bytes, b'\x00')
                else:
                    b = b[:num_bytes]

            else:
                raise TypeError(f"Unsupported type: {type(value)}")

            buf.extend(b)

        except Exception as e:
            print(f"Encode error at {key}: {e}")

    return buf

# ===== RANDOM GENERATORS =====
soc = int(100)

def random_telemetry():
    global soc
    soc -= random.randint(0, 1)
    if soc < 0:
        soc = 100
    rangeleft = int(soc * 26 * 4/100)
    return {
        "speed_2": random.randint(0, 120),
        "odo_4": random.randint(1000, 50000),
        "trip_4": random.randint(0, 100),
        "rangeleft_2": rangeleft,
        "voltage_2": random.randint(48, 50),
        "current_2": random.randint(0, 26000),
        "soc_2": soc,
        "temperature_2": random.randint(20, 80),
        "tiltangle_2": random.randint(-30, 60),
        "hillassistance_1": random.randint(0, 1)
    }
currentLocation = {"lat": 16.082377, "lon": 108.221459}
def random_location():
    global currentLocation
    currentLocation["lat"] += round(random.uniform(-0.0001, 0.0001), 6)
    currentLocation["lon"] += round(random.uniform(-0.0001, 0.0001), 6)
    return {
        "lat_4": currentLocation["lat"],
        "lon_4": currentLocation["lon"],
        "heading_2": random.randint(0, 360)
    }

# event_name allowed: 0-12, 21-27
ALLOWED_EVENTS = (
    list(range(0, 13)) +
    list(range(21, 28))
)

def random_event():
    event_name = random.choice(ALLOWED_EVENTS)

    if 1 <= event_name <= 9:
        event_type = 2  # Error
    elif 11 <= event_name <= 12:
        event_type = 1  # Warning
    else:
        event_type = 0  # Info

    return {
        "eventname_4": event_name,
        "eventtype_2": event_type,
        "eventvalue_10": str(random.randint(0, 1))
    }


def post_vehicle_registration(url, vehicle_id, model, color, battery_voltage, battery_capacity, max_range):
    payload = {
        "vehicle_id": vehicle_id,
        "model": model,
        "color": color,
        "battery_voltage": battery_voltage,
        "battery_capacity": battery_capacity,
        "max_range": max_range,
    }
    try:
        print(f"📤 POST", url, "->", payload)
        resp = requests.post(url, json=payload, timeout=5)
        resp.raise_for_status()
        print(f"status: {resp.status_code}")
        try:
            return resp.json()
        except Exception:
            return resp.text
    except Exception as e:
        print("❌ POST error:", e)
        return None
# ===== VEHICLE REGISTRATION =====
for i in VEHICLES:
    # Khởi tạo mặc định trước tiên
    vehicle_status["id_" + i] = {
        "mode": 0,
        "locked": 0,
        "trunk_locked": 0,
        "horn": 0,
        "answareback": 0,
        "headlight": 0,
        "rear_light": 0,
        "turn_light": 0,
        "push_notify": 0,
        "batt_alerts": 0,
        "security_alerts": 0,
        "auto_lock": 0,
        "bluetooth_unlock": 0,
        "remote_access": 0,
    }
    # Get current state from Node.js backend (not Node-RED)
    try:
        r = requests.get(f"http://localhost:3000/api/vehicle/state/{i}", timeout=3)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, dict):
            vehicle_status["id_" + i].update(data)
            print(f"✅ Loaded state for vehicle {i} from backend")
    except Exception as e:
        print(f"⚠️  Bootstrap vehicle {i} from backend failed: {e}. Using defaults.")
# connect vehicles
# REGISTER_URL = "http://23.21.57.218:3000/api/vehicle/connect"
REGISTER_URL = "http://localhost:3000/api/vehicle/connect"
for i in VEHICLES:
    resp = post_vehicle_registration(
        REGISTER_URL,
        vehicle_id=int(i),
        model=f"E-Bike",
        color="White",
        battery_voltage=48,
        battery_capacity=26,
        max_range=100,
    )
    print("register response:", resp)

# ===== MAIN LOOP =====
print("✅ MQTT bike publisher + cmd subscriber started")
vehicle_index = 0

try:
    while True:
        data_map = {
            "telemetry": random_telemetry(),
            "location": random_location(),
            "event": random_event()
        }

        for vehicle_id in VEHICLES:
            for element, payload in data_map.items():
                qos = 2 if element == "event" else 0
                topic = f"{BASE_TOPIC}/{vehicle_id}/{element}"
                # topic = f"{BASE_TOPIC}/{vehicle_id}/"  + "test/" + f"{element}"
                element = to_bytearray(payload)
                client.publish(topic, element, qos=qos)
                print(f"Publish {topic}")
                print(payload)
                print("    ", element)
        time.sleep(1)
except KeyboardInterrupt:
    print("\n🛑 Stopping program...")
