#include <Arduino.h>
#include <math.h>

constexpr uint32_t kSamplePeriodUs = 5000;
uint32_t lastSampleUs = 0;
uint32_t sampleIndex = 0;

void setup() {
  Serial.begin(115200);
  lastSampleUs = micros();
}

void loop() {
  const uint32_t now = micros();
  if (static_cast<uint32_t>(now - lastSampleUs) < kSamplePeriodUs) {
    return;
  }
  lastSampleUs = now;

  const float seconds = sampleIndex++ * 0.005f;
  const float phase = 2.0f * PI * 1.4f * seconds;
  const float voltage = 1.65f + 1.12f * sinf(phase);
  const float current = 1.3f + 0.56f * sinf(phase + 1.35f);
  const float reference = 2.55f + 0.28f * sinf(phase * 0.5f);

  Serial.print(voltage, 4);
  Serial.print(',');
  Serial.print(current, 4);
  Serial.print(',');
  Serial.println(reference, 4);
}
