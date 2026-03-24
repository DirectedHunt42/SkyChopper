// SkyChopper Arduino telemetry + relay control
// - Reads analog voltages and reports them over Serial as JSON (one line per sample).
// - Listens for mode commands from the Pi to control a relay (SOURCE/BATT).

#include <Arduino.h>

// ===== Hardware config =====
// Analog input pins
static const uint8_t PIN_BATT  = A0;
static const uint8_t PIN_SOURCE = A1;
static const uint8_t PIN_BUCK  = A2;

// Relay output pin
static const uint8_t PIN_RELAY = 8;

// If your relay is active LOW, set to false.
static const bool RELAY_ACTIVE_HIGH = true;

// ===== ADC + voltage scaling =====
// Set to your actual ADC reference voltage.
static const float ADC_REF_VOLTS = 5.0f;
static const float ADC_MAX_COUNTS = 1023.0f;

// Voltage divider multipliers:
//   V_actual = V_adc * MULT
// Example: If you use 100k (top) + 10k (bottom),
//   MULT = (100k + 10k) / 10k = 11.0
static const float BATT_DIVIDER_MULT  = 11.0f;
static const float SOURCE_DIVIDER_MULT = 11.0f;
static const float BUCK_DIVIDER_MULT  = 6.0f;

// ===== Telemetry =====
static const unsigned long SEND_INTERVAL_MS = 1000;
static const uint8_t ADC_SAMPLES = 8;

// ===== Serial =====
static const unsigned long SERIAL_BAUD = 115200;
static const uint8_t RX_LINE_MAX = 96;
static char rxLine[RX_LINE_MAX];
static uint8_t rxLen = 0;

// Current relay mode
static bool useSource = false;

static float readAnalogVolts(uint8_t pin, float multiplier) {
  unsigned long acc = 0;
  for (uint8_t i = 0; i < ADC_SAMPLES; i++) {
    acc += analogRead(pin);
    delayMicroseconds(200);
  }
  float raw = acc / (float)ADC_SAMPLES;
  float v_adc = (raw / ADC_MAX_COUNTS) * ADC_REF_VOLTS;
  return v_adc * multiplier;
}

static void setRelay(bool sourceMode) {
  useSource = sourceMode;
  bool level = RELAY_ACTIVE_HIGH ? sourceMode : !sourceMode;
  digitalWrite(PIN_RELAY, level ? HIGH : LOW);
}

static void sendTelemetry(float battV, float sourceV, float buckV) {
  // Minimal JSON that matches UI contract fields.
  Serial.print(F("{\"batt_voltage\":"));
  Serial.print(battV, 3);
  Serial.print(F(",\"source_voltage\":"));
  Serial.print(sourceV, 3);
  Serial.print(F(",\"buck_voltage\":"));
  Serial.print(buckV, 3);
  Serial.print(F(",\"use_source\":"));
  Serial.print(useSource ? F("true") : F("false"));
  Serial.println(F("}"));
}

static void handleCommand(const char *line) {
  // Accept simple commands:
  //   MODE SOURCE
  //   MODE BATT
  //   RELAY 1 / RELAY 0
  //   JSON with use_source: true/false (best effort)
  if (!line || !*line) return;

  // Uppercase copy for simple matching
  char buf[RX_LINE_MAX];
  uint8_t i = 0;
  for (; line[i] && i < RX_LINE_MAX - 1; i++) {
    char c = line[i];
    if (c >= 'a' && c <= 'z') c = c - 32;
    buf[i] = c;
  }
  buf[i] = '\0';

  if (strstr(buf, "MODE SOURCE")) {
    setRelay(true);
    return;
  }
  if (strstr(buf, "MODE BATT") || strstr(buf, "MODE BAT")) {
    setRelay(false);
    return;
  }
  if (strstr(buf, "RELAY 1") || strstr(buf, "RELAY ON")) {
    setRelay(true);
    return;
  }
  if (strstr(buf, "RELAY 0") || strstr(buf, "RELAY OFF")) {
    setRelay(false);
    return;
  }

  // Very small JSON parse: look for "USE_SOURCE": true/false
  char *p = strstr(buf, "\"USE_SOURCE\"");
  if (p) {
    if (strstr(p, "TRUE")) setRelay(true);
    if (strstr(p, "FALSE")) setRelay(false);
  }
}

static void pollSerial() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      rxLine[rxLen] = '\0';
      handleCommand(rxLine);
      rxLen = 0;
    } else if (rxLen < RX_LINE_MAX - 1) {
      rxLine[rxLen++] = c;
    } else {
      // overflow: reset buffer
      rxLen = 0;
    }
  }
}

void setup() {
  pinMode(PIN_RELAY, OUTPUT);
  setRelay(false);
  Serial.begin(SERIAL_BAUD);
}

void loop() {
  static unsigned long lastSend = 0;
  pollSerial();

  unsigned long now = millis();
  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    float battV = readAnalogVolts(PIN_BATT, BATT_DIVIDER_MULT);
    float sourceV = readAnalogVolts(PIN_SOURCE, SOURCE_DIVIDER_MULT);
    float buckV = readAnalogVolts(PIN_BUCK, BUCK_DIVIDER_MULT);
    sendTelemetry(battV, sourceV, buckV);
  }
}
