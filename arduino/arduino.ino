// ===== CONFIG =====
bool SIMULATE = true;     // ← set to false when using real sensors

// ===== PIN DEFINITIONS =====
const int BATT_PIN   = A0;
const int SOURCE_PIN = A1;
const int BUCK_PIN   = A2;

const int RELAY_PIN  = 7;   // Relay control pin

// Voltage divider ratios (adjust to your hardware)
const float BATT_DIVIDER_RATIO   = 4.2;
const float SOURCE_DIVIDER_RATIO = 4.2;
const float BUCK_DIVIDER_RATIO   = 4.2;

// ADC reference
const float ADC_REF = 5.0;
const int ADC_MAX = 1023;

// ===== STATE =====
float battV   = 12.0;
float sourceV = 9.0;
float buckV   = 9.0;

bool relayState = false; // false = SOURCE (LOW), true = BATT (HIGH)

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
  // Battery drift
  battV += (random(-5, 5) / 1000.0);
  battV = clamp(battV, 9.0, 12.6);

  // Source behavior
  if (random(0, 1000) < 10) {
    sourceV = 0;
  } else {
    sourceV += (random(-10, 10) / 100.0);
    sourceV = clamp(sourceV, 8.0, 10.5);
  }

  // Buck stabilizes around 9V
  buckV += (9.0 - buckV) * 0.2 + (random(-5, 5) / 100.0);
  buckV = clamp(buckV, 8.5, 9.5);
}

// ===== REAL SENSOR READ =====
void readRealData() {
  battV   = readVoltage(BATT_PIN, BATT_DIVIDER_RATIO);
  sourceV = readVoltage(SOURCE_PIN, SOURCE_DIVIDER_RATIO);
  buckV   = readVoltage(BUCK_PIN, BUCK_DIVIDER_RATIO);
}

// ===== SERIAL COMMANDS =====
void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  if (cmd == "MODE SOURCE") {
    digitalWrite(RELAY_PIN, LOW);   // SOURCE
    relayState = false;
  }
  else if (cmd == "MODE BATT") {
    digitalWrite(RELAY_PIN, HIGH);  // BATT
    relayState = true;
  }
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
  Serial.print(",");

  Serial.print("\"relay_state\":");
  Serial.print(relayState ? 1 : 0);

  Serial.println("}");
}

// ===== SETUP =====
void setup() {
  Serial.begin(115200);
  randomSeed(analogRead(0));

  pinMode(RELAY_PIN, OUTPUT);

  // Default to SOURCE (safe)
  digitalWrite(RELAY_PIN, LOW);
  relayState = false;

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