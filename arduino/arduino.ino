// ===== CONFIG =====
bool SIMULATE = true;     // ← set to false when using real sensors

// ===== PIN DEFINITIONS (used when SIMULATE = false) =====
const int BATT_PIN   = A0;
const int SOURCE_PIN = A1;
const int BUCK_PIN   = A2;

// Voltage divider ratios (adjust to your hardware)
const float BATT_DIVIDER_RATIO   = 4.2;   // example: 100k / 33k
const float SOURCE_DIVIDER_RATIO = 4.2;
const float BUCK_DIVIDER_RATIO   = 4.2;

// ADC reference
const float ADC_REF = 5.0;
const int ADC_MAX = 1023;

// ===== SIMULATION STATE =====
float battV   = 12.0;
float sourceV = 9.0;
float buckV   = 9.0;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 1000; // ms

// ===== UTILS =====
float readVoltage(int pin, float dividerRatio) {
  int raw = analogRead(pin);
  float voltage = (raw / (float)ADC_MAX) * ADC_REF;
  return voltage * dividerRatio;
}

float clamp(float x, float a, float b) {
  if (x < a) return a;
  if (x > b) return b;
  return x;
}

// ===== SIMULATION =====
void simulateData() {
  // Simulate battery slow discharge/charge
  battV += (random(-5, 5) / 1000.0); // small noise
  battV = clamp(battV, 9.0, 12.6);

  // Simulate source appearing/disappearing
  if (random(0, 1000) < 10) { // occasional drop
    sourceV = 0;
  } else {
    sourceV += (random(-10, 10) / 100.0);
    sourceV = clamp(sourceV, 8.0, 10.5);
  }

  // Buck tracks ~9V
  buckV += (9.0 - buckV) * 0.2 + (random(-5, 5) / 100.0);
  buckV = clamp(buckV, 8.5, 9.5);
}

// ===== REAL SENSOR READ =====
void readRealData() {
  battV   = readVoltage(BATT_PIN, BATT_DIVIDER_RATIO);
  sourceV = readVoltage(SOURCE_PIN, SOURCE_DIVIDER_RATIO);
  buckV   = readVoltage(BUCK_PIN, BUCK_DIVIDER_RATIO);
}

// ===== SEND JSON =====
void sendJSON() {
  Serial.print("{");
  
  Serial.print("\"batt_voltage\":");
  Serial.print(battV, 3);
  Serial.print(",");

  Serial.print("\"source_voltage\":");
  Serial.print(sourceV, 3);
  Serial.print(",");

  Serial.print("\"buck_voltage\":");
  Serial.print(buckV, 3);

  Serial.println("}");
}

// ===== RECEIVE COMMANDS =====
void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  if (cmd == "MODE SOURCE") {
    // You could switch a relay here
    // digitalWrite(RELAY_PIN, HIGH);
  }
  else if (cmd == "MODE BATT") {
    // digitalWrite(RELAY_PIN, LOW);
  }
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));

  if (!SIMULATE) {
    pinMode(BATT_PIN, INPUT);
    pinMode(SOURCE_PIN, INPUT);
    pinMode(BUCK_PIN, INPUT);
  }
}

// ===== LOOP =====
void loop() {
  handleSerialCommands();

  if (millis() - lastSend >= SEND_INTERVAL) {
    lastSend = millis();

    if (SIMULATE) {
      simulateData();
    } else {
      readRealData();
    }

    sendJSON();
  }
}