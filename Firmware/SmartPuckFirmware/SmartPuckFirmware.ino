/*
 * SmartPuck Offline Audio Recorder Firmware (Arduino Sketch)
 * 
 * Target Boards:
 * - LOLIN S3 Pro (ESP32-S3) - RECOMMENDED (Onboard MicroSD + Battery Charge + plenty of GPIOs)
 * - ESP32-CAM (Classic ESP32) - Pin-constrained (MicroSD conflicts with standard I2S)
 * 
 * Microphone: INMP441 I2S MEMS Microphone Module
 * Storage: FAT32 formatted microSD Card
 * 
 * Setup Instructions:
 * 1. Open Arduino IDE.
 * 2. Go to File -> Preferences, and add ESP32 board manager URL:
 *    https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_dev_index.json
 * 3. Go to Tools -> Board -> Board Manager, search for "esp32" by Espressif, and install it.
 * 4. Choose your board:
 *    - For LOLIN S3 Pro: Select "WEMOS LOLIN S3 PRO" or "ESP32S3 Dev Module"
 *    - For ESP32-CAM: Select "AI Thinker ESP32-CAM"
 * 5. Ensure "PSRAM" is enabled in Tools menu if using a board with PSRAM (optional but helpful).
 * 6. Wiring is described below for each board.
 */

#include "Arduino.h"
#include "FS.h"
#include "SPI.h"
#include <driver/i2s.h>

// ============================================================================
// BOARD SELECTION - Uncomment ONLY the board you are using!
// ============================================================================
#define BOARD_LOLIN_S3_PRO
// #define BOARD_ESP32_CAM

// ============================================================================
// WIRING & PIN CONFIGURATION
// ============================================================================
#ifdef BOARD_LOLIN_S3_PRO
  #include "SD.h"
  #define SD_DEVICE SD
  
  // LOLIN S3 Pro Onboard MicroSD Pins (SPI)
  #define SD_CS   46
  #define SD_MOSI 11
  #define SD_MISO 13
  #define SD_SCK  12

  // INMP441 I2S Microphone Pin Connections:
  // - VDD  -> LOLIN 3.3V
  // - GND  -> LOLIN GND
  // - L/R  -> LOLIN GND (Sets Left Channel)
  // - SCK  -> GPIO 4
  // - WS   -> GPIO 5
  // - SD   -> GPIO 6
  #define I2S_SCK  4
  #define I2S_WS   5
  #define I2S_SD   6

  // Controls (Record Button & LED)
  // Connect momentary button between GPIO 7 and GND (uses internal pull-up)
  // Connect LED anode to GPIO 8 through a 330-ohm resistor, cathode to GND
  #define BUTTON_PIN 7
  #define LED_PIN    8
#endif

#ifdef BOARD_ESP32_CAM
  #include "SD_MMC.h"
  #define SD_DEVICE SD_MMC

  // ESP32-CAM Onboard MicroSD uses SD_MMC in 1-bit mode to save pins.
  // 1-bit mode uses CLK (GPIO 14), CMD (GPIO 15), D0 (GPIO 2).
  // This frees up GPIO 12, 13, and 3 (RX0) for the microphone.
  // Note: GPIO 3 is shared with serial program interface (RXD). 
  // You MUST unplug the camera from your serial board / programmer 
  // before GPIO 3 can receive audio data from the mic!
  
  // INMP441 I2S Microphone Pin Connections:
  // - VDD  -> ESP32-CAM 3.3V
  // - GND  -> ESP32-CAM GND
  // - L/R  -> ESP32-CAM GND (Sets Left Channel)
  // - SCK  -> GPIO 12
  // - WS   -> GPIO 13
  // - SD   -> GPIO 3 (RX0 pin)
  #define I2S_SCK  12
  #define I2S_WS   13
  #define I2S_SD   3

  // Controls (Record Button & Onboard LED)
  // Connect momentary button between GPIO 16 and GND (uses internal pull-up)
  // ESP32-CAM has an onboard red LED connected to GPIO 33 (Active LOW)
  #define BUTTON_PIN 16
  #define LED_PIN    33
#endif

// ============================================================================
// AUDIO PARAMETERS
// ============================================================================
#define I2S_PORT            I2S_NUM_0
#define SAMPLE_RATE         16000 // 16kHz is standard for Speech-to-Text models
#define BITS_PER_SAMPLE     16    // 16-bit PCM
#define CHANNEL_COUNT       1     // Mono (L/R pin grounded on mic)
#define I2S_BUFFER_SIZE     1024  // Audio buffer size in bytes

// ============================================================================
// GLOBAL VARIABLES
// ============================================================================
File audioFile;
bool isRecording = false;
uint32_t audioSize = 0;
String currentSessionDir = "";
String currentWavPath = "";

// WAV Header Helper (44 bytes)
void writeWavHeader(File file, uint32_t totalAudioLen) {
  uint32_t totalDataLen = totalAudioLen + 36;
  uint32_t byteRate = SAMPLE_RATE * CHANNEL_COUNT * BITS_PER_SAMPLE / 8;
  uint16_t blockAlign = CHANNEL_COUNT * BITS_PER_SAMPLE / 8;
  uint16_t bits = BITS_PER_SAMPLE;
  uint16_t channels = CHANNEL_COUNT;
  uint16_t format = 1; // PCM Format
  uint32_t subChunk1Size = 16;

  file.seek(0);
  file.write((const uint8_t*)"RIFF", 4);
  file.write((const uint8_t*)&totalDataLen, 4);
  file.write((const uint8_t*)"WAVE", 4);
  file.write((const uint8_t*)"fmt ", 4);
  file.write((const uint8_t*)&subChunk1Size, 4);
  file.write((const uint8_t*)&format, 2);
  file.write((const uint8_t*)&channels, 2);
  file.write((const uint8_t*)&SAMPLE_RATE, 4);
  file.write((const uint8_t*)&byteRate, 4);
  file.write((const uint8_t*)&blockAlign, 2);
  file.write((const uint8_t*)&bits, 2);
  file.write((const uint8_t*)"data", 4);
  file.write((const uint8_t*)&totalAudioLen, 4);
}

// ============================================================================
// SD CARD INITIALIZATION
// ============================================================================
bool initSDCard() {
  Serial.println("Mounting microSD card...");
#ifdef BOARD_LOLIN_S3_PRO
  // Initialize SPI for LOLIN S3 Pro
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, SPI, 8000000U)) { // Run SPI at 8MHz
    Serial.println("ERROR: LOLIN S3 Pro MicroSD card mount failed!");
    return false;
  }
#endif

#ifdef BOARD_ESP32_CAM
  // Initialize SD_MMC in 1-bit mode for ESP32-CAM to free pins
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("ERROR: ESP32-CAM MicroSD card mount failed!");
    return false;
  }
#endif

  Serial.println("microSD card mounted successfully.");
  return true;
}

// ============================================================================
// SCAN FOR THE NEXT INCREMENTAL SESSION DIRECTORY
// ============================================================================
String getNextSessionPath() {
  // Ensure base /sessions directory exists
  if (!SD_DEVICE.exists("/sessions")) {
    SD_DEVICE.mkdir("/sessions");
  }

  int maxIndex = 0;
  File root = SD_DEVICE.open("/sessions");
  if (!root) {
    return "/sessions/session_001";
  }

  File file = root.openNextFile();
  while (file) {
    if (file.isDirectory()) {
      String name = file.name();
      // Parse out the folder name to get the session number
      int lastSlash = name.lastIndexOf('/');
      String folderName = (lastSlash >= 0) ? name.substring(lastSlash + 1) : name;
      if (folderName.startsWith("session_")) {
        int index = folderName.substring(8).toInt();
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    }
    file = root.openNextFile();
  }
  root.close();

  int nextIndex = maxIndex + 1;
  char buf[32];
  snprintf(buf, sizeof(buf), "/sessions/session_%03d", nextIndex);
  return String(buf);
}

// ============================================================================
// I2S MICROPHONE INITIALIZATION
// ============================================================================
bool initI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT, // Left channel for mono INMP441
    .communication_format = (i2s_comm_format_t)(I2S_COMM_FORMAT_STAND_I2S),
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 512,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };

  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };

  if (i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL) != ESP_OK) {
    Serial.println("ERROR: Failed to install I2S driver!");
    return false;
  }

  if (i2s_set_pin(I2S_PORT, &pin_config) != ESP_OK) {
    Serial.println("ERROR: Failed to set I2S pins!");
    return false;
  }

  Serial.println("I2S driver initialized.");
  return true;
}

// ============================================================================
// START RECORDING
// ============================================================================
void startRecording() {
  currentSessionDir = getNextSessionPath();
  Serial.print("Creating session directory: ");
  Serial.println(currentSessionDir);
  
  if (!SD_DEVICE.mkdir(currentSessionDir)) {
    Serial.println("ERROR: Failed to create session directory!");
    return;
  }

  // Create manifest file
  File manifest = SD_DEVICE.open(currentSessionDir + "/manifest.json", FILE_WRITE);
  if (manifest) {
    manifest.println("{");
    manifest.println("  \"version\": 1,");
    manifest.println("  \"device\": \"SmartPuck-MVP\",");
    manifest.println("  \"audio\": \"audio_000.wav\"");
    manifest.println("}");
    manifest.close();
  }

  currentWavPath = currentSessionDir + "/audio_000.wav";
  audioFile = SD_DEVICE.open(currentWavPath, FILE_WRITE);
  if (!audioFile) {
    Serial.println("ERROR: Failed to open audio file for writing!");
    return;
  }

  // Write placeholder WAV header (will update this later with final size)
  byte headerPlaceholder[44] = {0};
  audioFile.write(headerPlaceholder, 44);

  audioSize = 0;
  isRecording = true;
  Serial.print("Started recording to: ");
  Serial.println(currentWavPath);

  // Turn on recording LED
#ifdef BOARD_ESP32_CAM
  digitalWrite(LED_PIN, LOW);  // Active Low on ESP32-CAM
#else
  digitalWrite(LED_PIN, HIGH); // Active High
#endif
}

// ============================================================================
// STOP RECORDING
// ============================================================================
void stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  
  // Rewind to beginning and write complete WAV header
  writeWavHeader(audioFile, audioSize);
  audioFile.close();

  Serial.print("Stopped recording. Total audio size written: ");
  Serial.print(audioSize);
  Serial.println(" bytes.");

  // Turn off LED
#ifdef BOARD_ESP32_CAM
  digitalWrite(LED_PIN, HIGH); // Active Low off on ESP32-CAM
#else
  digitalWrite(LED_PIN, LOW);  // Active High off
#endif
}

// ============================================================================
// MAIN SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("--- SmartPuck Offline Audio Recorder Initializing ---");

  // Configure status LED
  pinMode(LED_PIN, OUTPUT);
#ifdef BOARD_ESP32_CAM
  digitalWrite(LED_PIN, HIGH); // Off (Active Low)
#else
  digitalWrite(LED_PIN, LOW);  // Off (Active High)
#endif

  // Configure Button (uses internal pull-up)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Mount SD Card
  if (!initSDCard()) {
    // Fast flash LED to signal SD failure
    while (true) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(100);
    }
  }

  // Install I2S Microphone
  if (!initI2S()) {
    // Slow flash LED to signal Microphone failure
    while (true) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(500);
    }
  }

  Serial.println("Setup complete. Press the button to start recording.");
}

// ============================================================================
// MAIN LOOP
// ============================================================================
void loop() {
  static bool lastButtonState = HIGH;
  bool currentButtonState = digitalRead(BUTTON_PIN);

  // Button pressed (falling edge transition HIGH -> LOW)
  if (lastButtonState == HIGH && currentButtonState == LOW) {
    delay(50); // Debounce delay
    if (digitalRead(BUTTON_PIN) == LOW) {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    }
  }
  lastButtonState = currentButtonState;

  // If recording, stream samples from I2S and write to SD card
  if (isRecording) {
    uint8_t buffer[I2S_BUFFER_SIZE];
    size_t bytesRead = 0;

    // Read audio chunk from mic
    esp_err_t result = i2s_read(I2S_PORT, &buffer, I2S_BUFFER_SIZE, &bytesRead, portMAX_DELAY);
    
    if (result == ESP_OK && bytesRead > 0) {
      // Write raw bytes directly to wav file on microSD
      size_t bytesWritten = audioFile.write(buffer, bytesRead);
      if (bytesWritten != bytesRead) {
        Serial.println("WARNING: File write buffer mismatch! SD card write might be too slow.");
      }
      audioSize += bytesWritten;
    }
  }
}
