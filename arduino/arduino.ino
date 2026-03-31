// ===== CONFIG =====
bool SIMULATE = false;     // ← set to false when using real sensors

// ===== PIN DEFINITIONS =====
const int BATT_PIN   = A0;
const int SOURCE_PIN = A1;
const int BUCK_PIN   = A2;

const int RELAY_PIN  = 7;   // Relay control pin

// Voltage divider ratios (adjust to your hardware)
const float BATT_DIVIDER_RATIO   = 3.13;
const float SOURCE_DIVIDER_RATIO = 3.13;
const float BUCK_DIVIDER_RATIO   = 3.13;

// ADC reference (will be measured dynamically on AVR boards)
const float ADC_REF_FALLBACK = 5.0;
const int ADC_MAX = 1023;

// Optional fixed Vcc values (useful if you know the rail sags with the relay)
const bool  USE_FIXED_VCC   = true;
const float VCC_RELAY_OFF   = 5.0;
const float VCC_RELAY_ON    = 4.6;

// ===== STATE =====
float battV   = 12.0;
float sourceV = 9.0;
float buckV   = 9.0;

bool relayState = false; // false = SOURCE (LOW), true = BATT (HIGH)
unsigned long lastRelayChange = 0;
const unsigned long RELAY_SETTLE_MS = 200;
const int ADC_SAMPLES = 8;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 1000; // ms

// ===== UTILS =====
// Measure Vcc using the internal 1.1V reference (AVR only).
// Falls back to ADC_REF_FALLBACK on non-AVR boards.
float readVccRaw() {
#if defined(__AVR__)
  // Save current ADC settings
  uint8_t admuxPrev = ADMUX;
  uint8_t adcsraPrev = ADCSRA;

  // Configure the ADC to measure the internal 1.1V bandgap against Vcc
  ADMUX = _BV(REFS0) | _BV(MUX3) | _BV(MUX2) | _BV(MUX1);
  delay(2); // allow Vref to settle
  // First conversion after mux change is discarded
  ADCSRA |= _BV(ADSC);
  while (bit_is_set(ADCSRA, ADSC)) { }

  ADCSRA |= _BV(ADSC);
  while (bit_is_set(ADCSRA, ADSC)) { }
  uint16_t raw = ADC;

  // Restore ADC settings
  ADMUX = admuxPrev;
  ADCSRA = adcsraPrev;

  // 1.1V * 1023 * 1000 / raw = Vcc in mV
  return 1125300.0 / (float)raw / 1000.0;
#else
  return ADC_REF_FALLBACK;
#endif
}

float readVcc() {
  static float vccFiltered = ADC_REF_FALLBACK;
  // Don't update Vcc during relay switching transients
  if (millis() - lastRelayChange < RELAY_SETTLE_MS) {
    return vccFiltered;
  }

  // Take multiple samples and use the median to reject outliers
  const int VCC_SAMPLES = 5;
  float samples[VCC_SAMPLES];
  for (int i = 0; i < VCC_SAMPLES; i++) {
    samples[i] = readVccRaw();
  }
  // Simple sort (VCC_SAMPLES is small)
  for (int i = 0; i < VCC_SAMPLES - 1; i++) {
    for (int j = i + 1; j < VCC_SAMPLES; j++) {
      if (samples[j] < samples[i]) {
        float t = samples[i];
        samples[i] = samples[j];
        samples[j] = t;
      }
    }
  }
  float vcc = samples[VCC_SAMPLES / 2];

  // Reject implausible Vcc values (keeps us from scale-jumping)
  if (vcc < 4.5 || vcc > 5.5) {
    return vccFiltered;
  }

  // Low-pass filter Vcc to avoid sudden scaling jumps
  const float alpha = 0.2;
  vccFiltered = vccFiltered + alpha * (vcc - vccFiltered);
  return vccFiltered;
}

float readVoltage(int pin, float dividerRatio, float vcc) {
  // Throw away the first read after mux changes
  analogRead(pin);

  long sum = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    sum += analogRead(pin);
  }
  int raw = (int)(sum / ADC_SAMPLES);
  float voltage = (raw / (float)ADC_MAX) * vcc;
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
  float vcc = USE_FIXED_VCC ? (relayState ? VCC_RELAY_ON : VCC_RELAY_OFF) : readVcc();
  battV   = readVoltage(BATT_PIN, BATT_DIVIDER_RATIO, vcc);
  sourceV = readVoltage(SOURCE_PIN, SOURCE_DIVIDER_RATIO, vcc);
  buckV   = readVoltage(BUCK_PIN, BUCK_DIVIDER_RATIO, vcc);

  // No additional relay-on scaling/offsets; rely on Vcc correction only.
}

// ===== SERIAL COMMANDS =====
void handleSerialCommands() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();

  if (cmd == "MODE SOURCE") {
    digitalWrite(RELAY_PIN, LOW);   // SOURCE
    relayState = false;
    lastRelayChange = millis();
  }
  else if (cmd == "MODE BATT") {
    digitalWrite(RELAY_PIN, HIGH);  // BATT
    relayState = true;
    lastRelayChange = millis();
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
      // Skip reading during relay switching transients
      if (millis() - lastRelayChange >= RELAY_SETTLE_MS) {
        readRealData();
      }
    }

    sendJSON();
  }
}
