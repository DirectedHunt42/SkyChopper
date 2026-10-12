// Source voltage monitor only.
// Upload this sketch instead of arduino.ino when the Arduino should only
// sample SOURCE_PIN and report the result to the Raspberry Pi.

const int SOURCE_PIN = A1;
const int ADC_MAX = 1023;
const int ADC_SAMPLES = 8;

// Keep these calibrated to the source voltage divider and Arduino 5 V rail.
const float ADC_REFERENCE_V = 5.21;
const float SOURCE_DIVIDER_RATIO = 3.13;
const unsigned long SEND_INTERVAL_MS = 1000;

unsigned long lastSend = 0;

float readSourceVoltage() {
  analogRead(SOURCE_PIN); // discard first sample after ADC mux settles
  unsigned long total = 0;
  for (int i = 0; i < ADC_SAMPLES; i++) {
    total += analogRead(SOURCE_PIN);
  }

  const float raw = total / (float)ADC_SAMPLES;
  return (raw / ADC_MAX) * ADC_REFERENCE_V * SOURCE_DIVIDER_RATIO;
}

void setup() {
  Serial.begin(115200); 
  pinMode(SOURCE_PIN, INPUT);
}

void loop() {
  if (millis() - lastSend >= SEND_INTERVAL_MS) {
    lastSend = millis();
    const float sourceVoltage = readSourceVoltage();
    Serial.print("{\"source_voltage\":");
    Serial.print(sourceVoltage, 3);
    Serial.println("}");
  }
}
