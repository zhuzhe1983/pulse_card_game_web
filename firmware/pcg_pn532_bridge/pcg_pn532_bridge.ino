/*
 * PULSE PN532 bridge — UID-only Arduino example.
 * Default: USB serial (Web Serial), 115200 baud.
 * Optional: set PCG_USE_WEBUSB=1 on a board/core supported by Adafruit TinyUSB.
 * This example has NOT been compiled or tested against physical hardware here.
 * Configure the PN532 for I2C and check your board's Grove pinout before flashing.
 * Libraries: Seeed-Studio/PN532; ArduinoJson; optional Adafruit_TinyUSB_Arduino.
 * Never writes a tag, changes passwords, or sets lock bits.
 */
#define PCG_USE_WEBUSB 0
#define PCG_SDA_PIN 21
#define PCG_SCL_PIN 22

#include <Arduino.h>
#include <Wire.h>
#include <PN532_I2C.h>
#include <PN532.h>
#include <ArduinoJson.h>
#if PCG_USE_WEBUSB
#include <Adafruit_TinyUSB.h>
Adafruit_USBD_WebUSB usb_web;
WEBUSB_URL_DEF(landingPage, 0, "localhost:8000/");
#endif

PN532_I2C pn532_i2c(Wire);
PN532 nfc(pn532_i2c);
bool ready = false;
bool session = false;
char incoming[512];
size_t incomingLength = 0;
bool discardLine = false;
String lastUID;
uint32_t lastSeen = 0;

void usbTask() {
#if PCG_USE_WEBUSB && defined(TINYUSB_NEED_POLLING_TASK)
  TinyUSBDevice.task();
#endif
}

void sendLine(const String &line) {
  const String data = line + "\n";
#if PCG_USE_WEBUSB
  // Use TinyUSB's vendor endpoint directly: no CDC line-state control request
  // is required by pcg.reader.v1, and the browser uses bulk IN/OUT only.
  if (!TinyUSBDevice.mounted()) return;
  size_t written = 0;
  const uint32_t started = millis();
  while (written < data.length() && millis() - started < 300) {
    written += tud_vendor_write((const uint8_t *)data.c_str() + written, data.length() - written);
    tud_vendor_flush();
    usbTask();
    yield();
  }
#else
  Serial.print(data);
#endif
}

int availableBytes() {
#if PCG_USE_WEBUSB
  return usb_web.available();
#else
  return Serial.available();
#endif
}

int readByte() {
#if PCG_USE_WEBUSB
  return usb_web.read();
#else
  return Serial.read();
#endif
}

void handleLine() {
  incoming[incomingLength] = '\0';
  StaticJsonDocument<512> command;
  if (deserializeJson(command, incoming)) {
    sendLine("{\"type\":\"error\",\"message\":\"Invalid JSON\"}");
    return;
  }
  const char *type = command["type"] | "";
  const char *protocol = command["protocol"] | "";
  if (strcmp(type, "hello") == 0 && strcmp(protocol, "pcg.reader.v1") == 0) {
    if (!ready) {
      sendLine("{\"type\":\"error\",\"message\":\"PN532 not found: check I2C mode, power and pins\"}");
      return;
    }
    session = true;
    lastUID = "";
    sendLine("{\"type\":\"hello\",\"protocol\":\"pcg.reader.v1\",\"device\":\"PN532 UID bridge\",\"capabilities\":[\"uid\"]}");
  } else {
    sendLine("{\"type\":\"error\",\"message\":\"UID-only bridge: command unsupported\"}");
  }
}

void setup() {
#if PCG_USE_WEBUSB
  if (!TinyUSBDevice.isInitialized()) TinyUSBDevice.begin(0);
  usb_web.setLandingPage(&landingPage);
  usb_web.begin();
  if (TinyUSBDevice.mounted()) {
    TinyUSBDevice.detach();
    delay(10);
    TinyUSBDevice.attach();
  }
#else
  Serial.begin(115200);
#endif
#if defined(ARDUINO_ARCH_ESP32)
  Wire.begin(PCG_SDA_PIN, PCG_SCL_PIN);
#else
  Wire.begin(); // Set the board's default I2C pins in its own board configuration.
#endif
  nfc.begin();
  ready = nfc.getFirmwareVersion() != 0;
  if (ready) {
    nfc.SAMConfig();
    nfc.setPassiveActivationRetries(0x01);
  }
  // Do not print debug text on the transport; every nonempty line must be JSON.
}

void loop() {
  usbTask();
  while (availableBytes()) {
    int value = readByte();
    if (value < 0) break;
    if (value == '\n') {
      if (!discardLine && incomingLength) handleLine();
      incomingLength = 0;
      discardLine = false;
    } else if (value != '\r' && !discardLine) {
      if (incomingLength >= sizeof(incoming) - 1) {
        incomingLength = 0;
        discardLine = true;
      } else incoming[incomingLength++] = (char)value;
    }
  }
  if (!session || !ready) { delay(1); return; }
  uint8_t uid[10] = {0};
  uint8_t uidLength = 0;
  const bool found = nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 80);
  if (found && (uidLength == 4 || uidLength == 7 || uidLength == 10)) {
    String id;
    static const char hex[] = "0123456789ABCDEF";
    for (uint8_t i = 0; i < uidLength; i++) {
      id += hex[uid[i] >> 4];
      id += hex[uid[i] & 15];
    }
    lastSeen = millis();
    if (id != lastUID) {
      lastUID = id;
      sendLine(String("{\"type\":\"card\",\"uid\":\"") + id + "\",\"tech\":\"nfc-a\",\"descriptor\":null}");
    }
  } else if (lastUID.length() && millis() - lastSeen > 600) {
    lastUID = "";
    sendLine("{\"type\":\"removed\"}");
  }
  yield();
}
