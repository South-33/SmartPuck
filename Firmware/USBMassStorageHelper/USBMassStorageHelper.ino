/*
 * SmartPuck USB Mass Storage Helper (SdSpiCard version)
 * 
 * Exposes the microSD card as a raw USB drive, even if formatting is invalid.
 */

#include "Arduino.h"
#include "SdFat.h"
#include "USB.h"
#include "USBMSC.h"

// LOLIN S3 Pro Onboard MicroSD Pins (SPI)
#define SD_CS   46
#define SD_MOSI 11
#define SD_MISO 13
#define SD_SCK  12

// LED Indicator
#define LED_PIN 38

USBMSC msc;
SdSpiCard card;
bool cardInitSuccess = false;

static int32_t onRead(uint32_t lba, uint32_t offset, void* buffer, uint32_t bufsize) {
  return card.readSectors(lba, (uint8_t*)buffer, bufsize / 512) ? bufsize : -1;
}

static int32_t onWrite(uint32_t lba, uint32_t offset, uint8_t* buffer, uint32_t bufsize) {
  return card.writeSectors(lba, buffer, bufsize / 512) ? bufsize : -1;
}

static bool onStartStop(uint8_t power, bool load_eject, bool relative) {
  return true;
}

void setup() {
  Serial.begin(115200);
  
  // Wait a few seconds for CDC serial to connect
  for (int i = 5; i > 0; i--) {
    neopixelWrite(LED_PIN, 10, 10, 0); // Yellow-ish
    delay(500);
    neopixelWrite(LED_PIN, 0, 0, 0);
    delay(500);
    Serial.printf("Starting in %d seconds...\n", i);
  }

  Serial.println("Initializing raw block SD reader...");

  // Configure SPI pins in the default SPI instance
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);

  // Configure SdFat SPI config - Use 4MHz for extra reliability/noise tolerance
  SdSpiConfig config(SD_CS, DEDICATED_SPI, SD_SCK_MHZ(4), &SPI);

  // Initialize the card physically (ignores formatting)
  if (!card.begin(config)) {
    Serial.println("ERROR: Physical SD card connection failed! Check if card is inserted correctly.");
    Serial.printf("SdFat Error Code: 0x%02X\n", card.errorCode());
    Serial.printf("SdFat Error Data: 0x%02X\n", card.errorData());
    // Red (physical Green in GRB)
    neopixelWrite(LED_PIN, 30, 0, 0); 
    cardInitSuccess = false;
    return;
  }
  
  uint32_t sectorCount = card.sectorCount();
  uint64_t cardSize = (uint64_t)sectorCount * 512LL / (1024LL * 1024LL);

  msc.vendorID("ESP32-S3");
  msc.productID("SmartPuck-Reader");
  msc.productRevision("1.0");
  msc.onRead(onRead);
  msc.onWrite(onWrite);
  msc.onStartStop(onStartStop);
  msc.mediaPresent(true);
  
  msc.begin(sectorCount, 512);
  USB.begin();
  
  // Blue (indicates success)
  neopixelWrite(LED_PIN, 0, 0, 30);
  cardInitSuccess = true;

  Serial.print("Success! Exposing raw MicroSD over USB. Size: ");
  Serial.print(cardSize);
  Serial.println(" MB.");
}

void loop() {
  if (cardInitSuccess) {
    Serial.println("[USB Helper] SD connected. Exposing over USB. LED is Blue.");
  } else {
    Serial.printf("[USB Helper] ERROR: SD card init failed. Error Code: 0x%02X, Error Data: 0x%02X. LED is Green/Red. Please re-insert card.\n", card.errorCode(), card.errorData());
  }
  delay(3000);
}

