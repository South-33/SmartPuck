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
#include <WiFi.h>
#include <WebServer.h>

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

  // Controls (Record Button & Onboard RGB LED)
  // LOLIN S3 Pro has a Boot button connected to GPIO 0 and a WS2812B RGB LED on GPIO 38.
  // We use these onboard components directly so you don't need to wire an external button/LED!
  #define BUTTON_PIN 0
  #define LED_PIN    38
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
  uint32_t sampleRate = SAMPLE_RATE;
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
  file.write((const uint8_t*)&sampleRate, 4);
  file.write((const uint8_t*)&byteRate, 4);
  file.write((const uint8_t*)&blockAlign, 2);
  file.write((const uint8_t*)&bits, 2);
  file.write((const uint8_t*)"data", 4);
  file.write((const uint8_t*)&totalAudioLen, 4);
}

// LED Status Helper (Handles both LOLIN's RGB LED and ESP32-CAM's active-low LED)
void setStatusLED(uint8_t r, uint8_t g, uint8_t b) {
#ifdef BOARD_LOLIN_S3_PRO
  neopixelWrite(LED_PIN, r, g, b);
#endif
#ifdef BOARD_ESP32_CAM
  // ESP32-CAM uses a standard active-low single-color LED
  if (r > 0 || g > 0 || b > 0) {
    digitalWrite(LED_PIN, LOW); // LED ON
  } else {
    digitalWrite(LED_PIN, HIGH); // LED OFF
  }
#endif
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

  // Set LED to Blinking Red (or solid red to start)
  setStatusLED(30, 0, 0); // Dim Red (don't blind the user!)
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

  // Set LED to Solid Blue (Ready / Idle)
  setStatusLED(0, 0, 30); // Dim Blue
}

// ============================================================================
// WIFI & WEB SERVER PORTAL
// ============================================================================
WebServer server(80);
const char* ssid = "RITH";
const char* password = "29051995";
bool wifiConnected = false;

// HTTP "/" handler - lists files on SD card and displays streaming/download portal
void handleRoot() {
  String html = "<!DOCTYPE html><html><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width,initial-scale=1.0'>";
  html += "<title>SmartPuck Web Portal</title>";
  html += "<style>";
  html += "body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0b0f19; color: #f1f5f9; padding: 25px; max-width: 600px; margin: 0 auto; }";
  html += "h1 { color: #38bdf8; font-weight: 300; margin-bottom: 5px; }";
  html += ".subtitle { color: #94a3b8; font-size: 0.9em; margin-bottom: 30px; }";
  html += ".session { background: #1e293b; padding: 20px; border-radius: 16px; margin-bottom: 15px; border: 1px solid #334155; }";
  html += ".session-title { font-weight: 600; margin-bottom: 12px; color: #e2e8f0; font-size: 1.1em; }";
  html += "a { color: #38bdf8; text-decoration: none; display: inline-block; font-weight: 500; font-size: 0.9em; margin-bottom: 10px; }";
  html += "a:hover { text-decoration: underline; }";
  html += "audio { display: block; width: 100%; height: 36px; margin-top: 5px; filter: invert(0.9) hue-rotate(180deg); }";
  html += "</style></head><body>";
  html += "<h1>SmartPuck Portal</h1>";
  html += "<div class='subtitle'>Connected to Wi-Fi <strong>" + String(ssid) + "</strong></div>";
  html += "<h3>Recorded Sessions</h3>";

  // Scan sessions folder
  File root = SD_DEVICE.open("/sessions");
  if (!root) {
    html += "<p style='color: #94a3b8; font-style: italic;'>No recordings found. Press the boot button to make your first recording!</p>";
  } else {
    File file = root.openNextFile();
    bool hasSessions = false;
    while (file) {
      if (file.isDirectory()) {
        hasSessions = true;
        String folderPath = file.name();
        int lastSlash = folderPath.lastIndexOf('/');
        String baseName = (lastSlash >= 0) ? folderPath.substring(lastSlash + 1) : folderPath;

        html += "<div class='session'>";
        html += "<div class='session-title'>📁 " + baseName + "</div>";
        String wavPath = "/sessions/" + baseName + "/audio_000.wav";
        if (SD_DEVICE.exists(wavPath)) {
          html += "<a href='/download?path=" + wavPath + "' download>⬇️ Download WAV Audio File</a>";
          html += "<audio controls src='/download?path=" + wavPath + "'></audio>";
        } else {
          html += "<span style='color: #f87171; font-size: 0.9em;'>WAV audio file not found</span>";
        }
        html += "</div>";
      }
      file = root.openNextFile();
    }
    root.close();
    if (!hasSessions) {
      html += "<p style='color: #94a3b8; font-style: italic;'>No recordings found. Press the boot button to make your first recording!</p>";
    }
  }

  html += "</body></html>";
  server.send(200, "text/html", html);
}

// HTTP "/download" handler - streams WAV file directly from SD card
void handleDownload() {
  if (!server.hasArg("path")) {
    server.send(400, "text/plain", "Bad Request: Missing 'path' parameter");
    return;
  }
  
  String path = server.arg("path");
  if (!SD_DEVICE.exists(path)) {
    server.send(404, "text/plain", "File Not Found");
    return;
  }

  File file = SD_DEVICE.open(path, FILE_READ);
  if (!file) {
    server.send(500, "text/plain", "Internal Server Error: Could not open file");
    return;
  }

  // Stream WAV file directly
  server.streamFile(file, "audio/wav");
  file.close();
}

void initWiFi() {
  Serial.println();
  Serial.print("Attempting connection to WiFi SSID: ");
  Serial.println(ssid);
  
  // Set LED to dim orange while connecting to WiFi
  setStatusLED(30, 10, 0); 
  
  WiFi.begin(ssid, password);

  // Wait for connection (timeout after 10 seconds)
  int count = 0;
  while (WiFi.status() != WL_CONNECTED && count < 20) {
    delay(500);
    Serial.print(".");
    count++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\nWiFi connected successfully!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());

    server.on("/", handleRoot);
    server.on("/download", handleDownload);
    server.begin();
    Serial.println("Web Portal HTTP Server started.");
    
    // Flash green twice to confirm connection
    for (int i = 0; i < 2; i++) {
      setStatusLED(0, 30, 0);
      delay(200);
      setStatusLED(0, 0, 0);
      delay(200);
    }
  } else {
    Serial.println("\nWiFi connection timed out. Booting in local offline mode.");
    // Flash red twice to show WiFi fail
    for (int i = 0; i < 2; i++) {
      setStatusLED(30, 0, 0);
      delay(200);
      setStatusLED(0, 0, 0);
      delay(200);
    }
  }
}

// ============================================================================
// MAIN SETUP
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("--- SmartPuck Offline Audio Recorder Initializing ---");

  // Configure status LED
#ifdef BOARD_ESP32_CAM
  pinMode(LED_PIN, OUTPUT);
#endif
  setStatusLED(0, 0, 0); // Off initially

  // Configure Button (uses internal pull-up)
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Mount SD Card
  if (!initSDCard()) {
    // Flash LED Red rapidly to signal SD failure
    while (true) {
      setStatusLED(50, 0, 0);
      delay(100);
      setStatusLED(0, 0, 0);
      delay(100);
    }
  }

  // Install I2S Microphone
  if (!initI2S()) {
    // Flash LED Yellow (Red + Green) slowly to signal Microphone failure
    while (true) {
      setStatusLED(40, 20, 0);
      delay(500);
      setStatusLED(0, 0, 0);
      delay(500);
    }
  }

  // Initialize Wi-Fi
  initWiFi();

  // Ready! Turn LED Solid Blue
  setStatusLED(0, 0, 30);
  Serial.println("Setup complete. Press the boot button to start recording.");
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
    // Pulse/Blink LED during recording (every 500ms)
    static uint32_t lastBlinkTime = 0;
    static bool ledState = true;
    if (millis() - lastBlinkTime > 500) {
      lastBlinkTime = millis();
      ledState = !ledState;
      if (ledState) {
        setStatusLED(30, 0, 0); // Dim Red
      } else {
        setStatusLED(5, 0, 0);  // Very dim Red
      }
    }

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

  // Handle WiFi Web Server Clients
  if (wifiConnected && !isRecording) {
    server.handleClient();
  }
}
