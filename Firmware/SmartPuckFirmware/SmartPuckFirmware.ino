/*
 * SmartPuck Offline Audio Recorder Firmware (Arduino Sketch)
 * 
 * Target Boards:
 * - LOLIN S3 Pro (ESP32-S3) - RECOMMENDED (Onboard MicroSD + Battery Charge + plenty of GPIOs)
 * - ESP32-CAM (Classic ESP32) - Pin-constrained (MicroSD conflicts with standard I2S)
 * 
 * Microphone: INMP441 I2S MEMS Microphone Module
 * Storage: FAT32 formatted microSD Card
 */

#include "Arduino.h"
#include "FS.h"
#include "SPI.h"
#include <driver/i2s.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <WebServer.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Preferences.h>
#include <time.h>
#include "freertos/ringbuf.h"

#if __has_include("local_config.h")
  #include "local_config.h"
#endif

#ifndef CONVEX_SITE_URL
  #define CONVEX_SITE_URL ""
#endif

#ifndef SMARTPUCK_DEVICE_TOKEN
  #define SMARTPUCK_DEVICE_TOKEN ""
#endif

#define SMARTPUCK_FIRMWARE_VERSION "0.1.0"
#define SMARTPUCK_MIN_FREE_BYTES_FOR_RECORDING (64ULL * 1024ULL * 1024ULL)
#define SMARTPUCK_MAX_SESSIONS_JSON 40
#define SMARTPUCK_MAX_SAVED_WIFI_NETWORKS 5
#define SMARTPUCK_BUTTON_ARM_DELAY_MS 2000
#ifndef SMARTPUCK_SD_SPI_FREQUENCY
  #define SMARTPUCK_SD_SPI_FREQUENCY 20000000U
#endif
#ifndef SMARTPUCK_LED_BRIGHTNESS_PERCENT
  #define SMARTPUCK_LED_BRIGHTNESS_PERCENT 40U
#endif

// ============================================================================
// BOARD SELECTION - Uncomment ONLY the board you are using!
// ============================================================================
// Defaults to LOLIN S3 Pro in Arduino IDE. PlatformIO can define the board in build_flags.
#if !defined(BOARD_LOLIN_S3_PRO) && !defined(BOARD_ESP32_CAM)
  #define BOARD_LOLIN_S3_PRO
#endif
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
  // - SCK  -> GPIO 4
  // - WS   -> GPIO 5
  // - SD   -> GPIO 6
  #define I2S_SCK  4
  #define I2S_WS   5
  #define I2S_SD   6

  // Controls (Record Button & Onboard RGB LED)
  #define BUTTON_PIN 0
  #define LED_PIN    38
#endif

#ifdef BOARD_ESP32_CAM
  #include "SD_MMC.h"
  #define SD_DEVICE SD_MMC

  // ESP32-CAM Onboard MicroSD uses SD_MMC in 1-bit mode to save pins.
  #define I2S_SCK  12
  #define I2S_WS   13
  #define I2S_SD   3

  // Controls (Record Button & Onboard LED)
  #define BUTTON_PIN 16
  #define LED_PIN    33
#endif

// ============================================================================
// AUDIO PARAMETERS
// ============================================================================
#define I2S_PORT            I2S_NUM_0
#define SAMPLE_RATE         16000 // 16kHz is standard for Speech-to-Text models
#define BITS_PER_SAMPLE     16    // 16-bit PCM
#define CHANNEL_COUNT       1     // Mono
#define I2S_BUFFER_SIZE     1024 // Audio buffer size in bytes (256 samples of 32-bit data = 16ms)
#define I2S_SHIFT_FACTOR    16    // Shift standard 24-bit MSB inside 32-bit slot down to 16-bit PCM
#ifndef SMARTPUCK_MIC_GAIN
  #define SMARTPUCK_MIC_GAIN 4.0f // +12 dB; raises quiet INMP441 speech before storage/streaming
#endif

// ============================================================================
// WI-FI CREDENTIALS LIST
// ============================================================================
struct WifiCredential {
  const char* ssid;
  const char* password;
};

#ifdef SMARTPUCK_WIFI_NETWORKS
WifiCredential knownNetworks[] = {
  SMARTPUCK_WIFI_NETWORKS
};
const int knownNetworksCount = sizeof(knownNetworks) / sizeof(knownNetworks[0]);
#else
WifiCredential knownNetworks[] = {
  {nullptr, nullptr}
};
const int knownNetworksCount = 0;
#endif

// ============================================================================
// GLOBAL SYSTEM VARIABLES
// ============================================================================
File audioFile;
volatile bool isRecording = false;
volatile bool isStreaming = false;
volatile uint32_t audioSize = 0;
volatile uint8_t audioLevel = 0;
String currentSessionDir = "";
String currentWavPath = "";
bool storageAvailable = false;
String lastRecordingError = "";

// PSRAM Fallback State
bool usePsramFallback = false;
uint8_t* psramBuffer = NULL;
const uint32_t PSRAM_BUFFER_MAX = 4000000; // 4MB (approx 125 seconds of 16kHz 16-bit mono)

// FreeRTOS Handles & Thread Safety
TaskHandle_t audioTaskHandle = NULL;
SemaphoreHandle_t fileMutex = NULL;
RingbufHandle_t audioRingBuf = NULL;

// Wi-Fi Connection Information
bool wifiConnected = false;
bool apModeActive = false;
String activeNetworkInfo = "Local Offline Mode";
uint32_t restartAtMs = 0;
Preferences smartPuckPrefs;

struct SavedWifiCredential {
  String ssid;
  String password;
};
SavedWifiCredential savedNetworks[SMARTPUCK_MAX_SAVED_WIFI_NETWORKS];
int savedNetworksCount = 0;

// Web Server
WebServer server(80);
const char* SMARTPUCK_HTTP_HEADERS[] = { "Range" };
String usbCommandBuffer = "";

// ============================================================================
// FUNCTION PROTOTYPES
// ============================================================================
void setStatusLED(uint8_t r, uint8_t g, uint8_t b);
bool initSDCard();
String getNextSessionPath();
String buildSessionSlug();
String getSessionTimestamp();
String sanitizePathSegment(String value);
String readManifestField(String sessionPath, String field);
bool initI2S();
void startRecording();
void stopRecording();
void repairIncompleteSessions();
bool repairWavHeader(String wavPath);
void applyHPFBuffer(int16_t* buffer, size_t count);
void writeWavHeader(File file, uint32_t totalAudioLen);
void fillWavHeader(uint8_t* header, uint32_t totalAudioLen);
void startAP();
void initWiFi();
bool tryConfiguredWiFiNetworks();
bool connectToWiFi(const char* ssid, const char* password, const char* sourceLabel);
bool connectToStoredSdkWiFi();
void loadSavedWiFiCredentials();
bool saveWiFiCredentials(String ssid, String password);
bool removeWiFiCredentials(String ssid);
void persistSavedWiFiCredentials();
String buildWiFiConfigJson();
void handleRoot();
void handleDownload();
void handleSessions();
void handleSessionUploaded();
void handleDeleteSession();
void handleWiFiConfig();
void handleStream();
void handleStartRecord();
void handleStopRecord();
void handleStatus();
void sendCorsHeaders();
void handleCorsOptions();
void sendConvexHeartbeat(const char* reason);
String jsonEscape(String value);
String urlDecode(String value);
bool isSafeSessionPath(String path);
bool isSafeAudioPath(String path);
bool sessionHasUploadedMarker(String sessionPath);
bool markSessionUploaded(String sessionPath);
bool removeSessionRecursive(String sessionPath);
void cleanupUploadedSessionsIfNeeded();
bool parseRangeHeader(size_t fileSize, size_t& rangeStart, size_t& rangeEnd);
void sendRangeHeaders(size_t fileSize, size_t rangeStart, size_t rangeEnd, bool partial);
bool writeClientBytes(WiFiClient& client, const uint8_t* data, size_t bytesToWrite);
void streamFileBytes(File& file, size_t bytesToSend);
String buildStatusJson();
String buildSessionsJson();
uint64_t getTotalStorageBytes();
uint64_t getUsedStorageBytes();
uint64_t getFreeStorageBytes();
String formatStorageSummary();
void checkButton();
void updateLED();
void audioTask(void* pvParameters);
void checkUsbTransport();
void handleUsbCommand(String command);
void sendUsbFile(String audioPath);

// ============================================================================
// FIRST-ORDER IIR HIGH-PASS FILTER
// ============================================================================
// Removes the ~150-200mV DC offset characteristic of the INMP441 sensor,
// then applies a fixed, saturating speech gain shared by recording and streaming.
// y[n] = x[n] - x[n-1] + alpha * y[n-1]
void applyHPFBuffer(int16_t* buffer, size_t count) {
  static float prev_x = 0;
  static float prev_y = 0;
  const float alpha = 0.995f; // fc = approx 12.7 Hz at 16kHz
  
  for (size_t i = 0; i < count; i++) {
    float x = (float)buffer[i];
    float y = x - prev_x + alpha * prev_y;
    prev_x = x;
    prev_y = y;
    
    const float amplified = y * SMARTPUCK_MIC_GAIN;
    if (amplified > 32767.0f) buffer[i] = 32767;
    else if (amplified < -32768.0f) buffer[i] = -32768;
    else buffer[i] = (int16_t)amplified;
  }
}

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

// WAV Header Generator for Memory Buffers (44 bytes)
void fillWavHeader(uint8_t* header, uint32_t totalAudioLen) {
  uint32_t totalDataLen = totalAudioLen + 36;
  uint32_t sampleRate = SAMPLE_RATE;
  uint32_t byteRate = SAMPLE_RATE * CHANNEL_COUNT * BITS_PER_SAMPLE / 8;
  uint16_t blockAlign = CHANNEL_COUNT * BITS_PER_SAMPLE / 8;
  uint16_t bits = BITS_PER_SAMPLE;
  uint16_t channels = CHANNEL_COUNT;
  uint16_t format = 1; // PCM Format
  uint32_t subChunk1Size = 16;

  memcpy(header, "RIFF", 4);
  memcpy(header + 4, &totalDataLen, 4);
  memcpy(header + 8, "WAVEfmt ", 8);
  memcpy(header + 16, &subChunk1Size, 4);
  memcpy(header + 20, &format, 2);
  memcpy(header + 22, &channels, 2);
  memcpy(header + 24, &sampleRate, 4);
  memcpy(header + 28, &byteRate, 4);
  memcpy(header + 32, &blockAlign, 2);
  memcpy(header + 34, &bits, 2);
  memcpy(header + 36, "data", 4);
  memcpy(header + 40, &totalAudioLen, 4);
}

// LED Status Helper (Handles both LOLIN's RGB LED and ESP32-CAM's active-low LED)
void setStatusLED(uint8_t r, uint8_t g, uint8_t b) {
#ifdef BOARD_LOLIN_S3_PRO
  const uint8_t scaledR = (uint8_t)(((uint16_t)r * SMARTPUCK_LED_BRIGHTNESS_PERCENT) / 100U);
  const uint8_t scaledG = (uint8_t)(((uint16_t)g * SMARTPUCK_LED_BRIGHTNESS_PERCENT) / 100U);
  const uint8_t scaledB = (uint8_t)(((uint16_t)b * SMARTPUCK_LED_BRIGHTNESS_PERCENT) / 100U);
  neopixelWrite(LED_PIN, scaledG, scaledR, scaledB); // Swap green and red for GRB WS2812
#endif
#ifdef BOARD_ESP32_CAM
  if (r > 0 || g > 0 || b > 0) {
    digitalWrite(LED_PIN, LOW); // ON
  } else {
    digitalWrite(LED_PIN, HIGH); // OFF
  }
#endif
}

// SD Card Initialization
bool initSDCard() {
  Serial.println("Mounting microSD card...");
#ifdef BOARD_LOLIN_S3_PRO
  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS, SPI, SMARTPUCK_SD_SPI_FREQUENCY)) {
    Serial.println("ERROR: LOLIN S3 Pro MicroSD card mount failed!");
    return false;
  }
#endif

#ifdef BOARD_ESP32_CAM
  if (!SD_MMC.begin("/sdcard", true)) {
    Serial.println("ERROR: ESP32-CAM MicroSD card mount failed!");
    return false;
  }
#endif

  Serial.println("microSD card mounted successfully.");
  return true;
}

// Scanning for the next incremental session directory
String getNextSessionPath() {
  if (!SD_DEVICE.exists("/sessions")) {
    SD_DEVICE.mkdir("/sessions");
  }

  String sessionSlug = buildSessionSlug();
  int maxIndex = 0;
  File root = SD_DEVICE.open("/sessions");
  if (!root) {
    return "/sessions/" + sessionSlug + "_001";
  }

  File file = root.openNextFile();
  while (file) {
    if (file.isDirectory()) {
      String name = file.name();
      int lastSlash = name.lastIndexOf('/');
      String folderName = (lastSlash >= 0) ? name.substring(lastSlash + 1) : name;
      String prefix = sessionSlug + "_";
      if (folderName.startsWith(prefix)) {
        int index = folderName.substring(prefix.length()).toInt();
        if (index > maxIndex) {
          maxIndex = index;
        }
      }
    }
    file = root.openNextFile();
  }
  root.close();

  int nextIndex = maxIndex + 1;
  char buf[96];
  snprintf(buf, sizeof(buf), "/sessions/%s_%03d", sessionSlug.c_str(), nextIndex);
  return String(buf);
}

String buildSessionSlug() {
  String timestamp = getSessionTimestamp();
  String network = apModeActive ? "direct" : WiFi.SSID();
  network = sanitizePathSegment(network);
  if (network.length() == 0) {
    network = "offline";
  }
  return "session_" + timestamp + "_" + network;
}

String getSessionTimestamp() {
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 250)) {
    char buffer[20];
    strftime(buffer, sizeof(buffer), "%Y%m%d_%H%M%S", &timeinfo);
    return String(buffer);
  }

  char fallback[20];
  snprintf(fallback, sizeof(fallback), "boot_%lu", (unsigned long)(millis() / 1000));
  return String(fallback);
}

String sanitizePathSegment(String value) {
  value.trim();
  String out = "";
  for (size_t i = 0; i < value.length() && out.length() < 24; i++) {
    char c = value.charAt(i);
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
      out += c;
    } else if (c == '-' || c == '_') {
      out += c;
    } else if (c == ' ') {
      out += "-";
    }
  }
  return out;
}

bool repairWavHeader(String wavPath) {
  if (!isSafeAudioPath(wavPath) || !SD_DEVICE.exists(wavPath)) {
    return false;
  }

  File wav = SD_DEVICE.open(wavPath, FILE_READ);
  if (!wav) {
    return false;
  }
  size_t fileSize = wav.size();
  wav.close();

  if (fileSize <= 44) {
    return false;
  }

  wav = SD_DEVICE.open(wavPath, FILE_WRITE);
  if (!wav) {
    return false;
  }
  writeWavHeader(wav, fileSize - 44);
  wav.flush();
  wav.close();
  return true;
}

String readManifestField(String sessionPath, String field) {
  if (!isSafeSessionPath(sessionPath)) {
    return "";
  }

  File manifest = SD_DEVICE.open(sessionPath + "/manifest.json", FILE_READ);
  if (!manifest) {
    return "";
  }

  String needle = "\"" + field + "\"";
  while (manifest.available()) {
    String line = manifest.readStringUntil('\n');
    int keyIndex = line.indexOf(needle);
    if (keyIndex < 0) {
      continue;
    }
    int colonIndex = line.indexOf(':', keyIndex + needle.length());
    int valueStart = line.indexOf('"', colonIndex + 1);
    int valueEnd = valueStart >= 0 ? line.indexOf('"', valueStart + 1) : -1;
    if (colonIndex >= 0 && valueStart >= 0 && valueEnd > valueStart) {
      String value = line.substring(valueStart + 1, valueEnd);
      manifest.close();
      return value;
    }
  }

  manifest.close();
  return "";
}

void repairIncompleteSessions() {
  if (!storageAvailable || usePsramFallback || !SD_DEVICE.exists("/sessions")) {
    return;
  }

  int repaired = 0;
  File root = SD_DEVICE.open("/sessions");
  if (!root) {
    return;
  }

  File entry = root.openNextFile();
  while (entry) {
    if (entry.isDirectory()) {
      String sessionPath = entry.name();
      if (!sessionPath.startsWith("/")) {
        sessionPath = "/sessions/" + sessionPath;
      }
      if (isSafeSessionPath(sessionPath) && repairWavHeader(sessionPath + "/audio_000.wav")) {
        repaired++;
      }
    }
    entry.close();
    entry = root.openNextFile();
  }
  root.close();

  if (repaired > 0) {
    Serial.print("[Storage] Repaired WAV headers for sessions: ");
    Serial.println(repaired);
  }
}

// I2S Microphone Initialization
bool initI2S() {
  i2s_config_t i2s_config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT, // INMP441 outputs 24-bit inside a 32-bit frame slot
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT, // Left channel for mono
    .communication_format = (i2s_comm_format_t)(I2S_COMM_FORMAT_STAND_I2S),
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = 8,
    .dma_buf_len = 256,
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

// Start Recording
void startRecording() {
  if (isRecording) return;
  lastRecordingError = "";

  if (usePsramFallback) {
    if (psramBuffer == NULL) {
      lastRecordingError = "PSRAM fallback is not available";
      Serial.println("ERROR: PSRAM fallback is not available.");
      return;
    }
    audioSize = 0;
    isRecording = true;
    Serial.println("Started recording to PSRAM buffer (Fallback Mode)...");
    return;
  }

  if (!storageAvailable) {
    lastRecordingError = "No writable storage. Insert a working microSD card or use live stream.";
    Serial.println("ERROR: No writable storage available.");
    return;
  }

  cleanupUploadedSessionsIfNeeded();
  if (getFreeStorageBytes() < SMARTPUCK_MIN_FREE_BYTES_FOR_RECORDING) {
    lastRecordingError = "microSD is low on space and no uploaded sessions can be removed.";
    Serial.println("ERROR: microSD low on space and no uploaded sessions can be removed.");
    return;
  }

  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(1000)) == pdTRUE) {
    currentSessionDir = getNextSessionPath();
    Serial.print("Creating session directory: ");
    Serial.println(currentSessionDir);
    
    if (!SD_DEVICE.mkdir(currentSessionDir)) {
      lastRecordingError = "Failed to create session directory.";
      Serial.println("ERROR: Failed to create session directory!");
      xSemaphoreGive(fileMutex);
      return;
    }

    // Create manifest file
    File manifest = SD_DEVICE.open(currentSessionDir + "/manifest.json", FILE_WRITE);
    if (manifest) {
      String sessionName = currentSessionDir.substring(currentSessionDir.lastIndexOf('/') + 1);
      String recordedAt = getSessionTimestamp();
      String network = apModeActive ? "SmartPuck direct Wi-Fi" : WiFi.SSID();
      String ipAddress = apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString();
      manifest.println("{");
      manifest.println("  \"version\": 1,");
      manifest.println("  \"device\": \"SmartPuck-MVP\",");
      manifest.println("  \"name\": \"" + jsonEscape(sessionName) + "\",");
      manifest.println("  \"displayName\": \"" + jsonEscape(recordedAt + " - " + network) + "\",");
      manifest.println("  \"createdAt\": \"" + jsonEscape(recordedAt) + "\",");
      manifest.println("  \"network\": \"" + jsonEscape(network) + "\",");
      manifest.println("  \"ip\": \"" + jsonEscape(ipAddress) + "\",");
      manifest.println("  \"storageMode\": \"" + String(usePsramFallback ? "psram" : "microsd") + "\",");
      manifest.println("  \"audio\": \"audio_000.wav\"");
      manifest.println("}");
      manifest.close();
    }

    currentWavPath = currentSessionDir + "/audio_000.wav";
    audioFile = SD_DEVICE.open(currentWavPath, FILE_WRITE);
    if (!audioFile) {
      lastRecordingError = "Failed to open audio file for writing.";
      Serial.println("ERROR: Failed to open audio file for writing!");
      xSemaphoreGive(fileMutex);
      return;
    }

    // Write placeholder WAV header
    byte headerPlaceholder[44] = {0};
    audioFile.write(headerPlaceholder, 44);

    audioSize = 0;
    isRecording = true;
    Serial.print("Started recording to: ");
    Serial.println(currentWavPath);

    xSemaphoreGive(fileMutex);
  } else {
    lastRecordingError = "Storage is busy. Try again.";
  }
}

// Stop Recording
void stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  delay(50); // Give the audio task a small moment to exit its file write block

  if (usePsramFallback) {
    Serial.print("Stopped recording to PSRAM. Total size: ");
    Serial.print(audioSize);
    Serial.println(" bytes.");
    return;
  }

  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
    if (audioFile) {
      writeWavHeader(audioFile, audioSize);
      audioFile.flush();
      audioFile.close();
      Serial.print("Stopped recording to SD. Total WAV size: ");
      Serial.print(audioSize);
      Serial.println(" bytes.");
    }
    xSemaphoreGive(fileMutex);
  }
}

// ============================================================================
// AUDIO READER TASK (Pinned to Core 1)
// ============================================================================
void audioTask(void* pvParameters) {
  int32_t i2s_raw_buffer[I2S_BUFFER_SIZE / 4];
  size_t bytesRead = 0;
  
  Serial.println("[Core 1] Audio Task started.");
  
  while (true) {
    esp_err_t result = i2s_read(I2S_PORT, &i2s_raw_buffer, I2S_BUFFER_SIZE, &bytesRead, portMAX_DELAY);
    
    if (result == ESP_OK && bytesRead > 0) {
      size_t sampleCount = bytesRead / 4;
      int16_t processedBuffer[sampleCount];
      
      for (size_t i = 0; i < sampleCount; i++) {
        // Shift MSB 24-bit alignment in 32-bit slot down to 16-bit PCM range
        int32_t sample = i2s_raw_buffer[i] >> I2S_SHIFT_FACTOR;
        if (sample > 32767) sample = 32767;
        else if (sample < -32768) sample = -32768;
        processedBuffer[i] = (int16_t)sample;
      }
      
      // Apply High-Pass Filter to remove DC baseline offset
      applyHPFBuffer(processedBuffer, sampleCount);

      // Track a smoothed post-gain peak for the desktop recording meter.
      uint16_t peak = 0;
      for (size_t i = 0; i < sampleCount; i++) {
        uint16_t magnitude = processedBuffer[i] == INT16_MIN
          ? 32768
          : abs(processedBuffer[i]);
        if (magnitude > peak) peak = magnitude;
      }
      const uint8_t nextLevel = (uint8_t)min(100U, ((uint32_t)peak * 100U) / 32767U);
      audioLevel = nextLevel >= audioLevel
        ? (uint8_t)((audioLevel + nextLevel + 1U) / 2U)
        : (uint8_t)((audioLevel * 3U + nextLevel + 2U) / 4U);
      
      size_t processedBytes = sampleCount * 2;
      
      if (isRecording) {
        if (usePsramFallback) {
          if (audioSize + processedBytes < PSRAM_BUFFER_MAX) {
            memcpy(psramBuffer + audioSize, processedBuffer, processedBytes);
            audioSize += processedBytes;
          } else {
            Serial.println("[Core 1] PSRAM Buffer Full! Stopping recording.");
            isRecording = false;
          }
        } else {
          // Lock mutex and write directly to file
          if (xSemaphoreTake(fileMutex, 0) == pdTRUE) {
            if (audioFile) {
              size_t bytesWritten = audioFile.write((const uint8_t*)processedBuffer, processedBytes);
              if (bytesWritten == processedBytes) {
                audioSize += bytesWritten;
              } else {
                Serial.println("[Core 1] WARNING: SD write speed bottleneck!");
              }
            }
            xSemaphoreGive(fileMutex);
          }
        }
      }
      
      // Send raw samples to FreeRTOS ring buffer for web client streaming
      if (isStreaming && audioRingBuf != NULL) {
        xRingbufferSend(audioRingBuf, processedBuffer, processedBytes, 0);
      }
    }
    
    vTaskDelay(pdMS_TO_TICKS(1)); // Allow other CPU tasks to run on Core 1
  }
}

// ============================================================================
// WIFI CONNECTION MANAGER
// ============================================================================
void initWiFi() {
  WiFi.disconnect();
  WiFi.mode(WIFI_STA);
  loadSavedWiFiCredentials();
  
  // Orange LED indicates Wi-Fi initialization
  setStatusLED(30, 10, 0);
  
  bool connected = tryConfiguredWiFiNetworks();

  if (!connected) {
    startAP();
  }
}

bool tryConfiguredWiFiNetworks() {
  loadSavedWiFiCredentials();

  for (int i = 0; i < savedNetworksCount; i++) {
    if (connectToWiFi(savedNetworks[i].ssid.c_str(), savedNetworks[i].password.c_str(), "saved")) {
      return true;
    }
  }
  
  for (int i = 0; i < knownNetworksCount; i++) {
    if (connectToWiFi(knownNetworks[i].ssid, knownNetworks[i].password, "firmware")) {
      return true;
    }
  }

  if (connectToStoredSdkWiFi()) {
    return true;
  }

  return false;
}

bool connectToWiFi(const char* ssid, const char* password, const char* sourceLabel) {
  if (ssid == nullptr || strlen(ssid) == 0) {
    return false;
  }

  Serial.println();
  Serial.print("Connecting to ");
  Serial.print(sourceLabel);
  Serial.print(" Wi-Fi SSID: ");
  Serial.println(ssid);

  WiFi.mode(apModeActive ? WIFI_AP_STA : WIFI_STA);
  WiFi.begin(ssid, password);

  int count = 0;
  while (WiFi.status() != WL_CONNECTED && count < 20) {
    delay(500);
    Serial.print(".");
    count++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nConnection timed out for SSID: " + String(ssid));
    WiFi.disconnect();
    return false;
  }

  wifiConnected = true;
  apModeActive = false;
  activeNetworkInfo = "Wi-Fi: " + String(ssid);
  WiFi.softAPdisconnect(true);

  Serial.println("\nWiFi connected successfully!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  sendConvexHeartbeat("Connected");

  // Flash green twice to confirm connection
  for (int k = 0; k < 2; k++) {
    setStatusLED(0, 30, 0);
    delay(200);
    setStatusLED(0, 0, 0);
    delay(200);
  }

  return true;
}

bool connectToStoredSdkWiFi() {
  Serial.println();
  Serial.println("Trying ESP stored Wi-Fi credentials...");

  WiFi.mode(apModeActive ? WIFI_AP_STA : WIFI_STA);
  WiFi.begin();

  int count = 0;
  while (WiFi.status() != WL_CONNECTED && count < 20) {
    delay(500);
    Serial.print(".");
    count++;
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("\nNo ESP stored Wi-Fi credentials connected.");
    WiFi.disconnect();
    return false;
  }

  wifiConnected = true;
  apModeActive = false;
  activeNetworkInfo = "Wi-Fi: " + WiFi.SSID();
  WiFi.softAPdisconnect(true);

  Serial.println("\nWiFi connected successfully using ESP stored credentials!");
  Serial.print("IP Address: ");
  Serial.println(WiFi.localIP());
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  sendConvexHeartbeat("Connected");

  for (int k = 0; k < 2; k++) {
    setStatusLED(0, 30, 0);
    delay(200);
    setStatusLED(0, 0, 0);
    delay(200);
  }

  return true;
}

void loadSavedWiFiCredentials() {
  savedNetworksCount = 0;
  smartPuckPrefs.begin("smartpuck", true);
  int count = smartPuckPrefs.getInt("wifi_count", 0);
  count = constrain(count, 0, SMARTPUCK_MAX_SAVED_WIFI_NETWORKS);
  for (int i = 0; i < count; i++) {
    String ssidKey = "ssid" + String(i);
    String passKey = "pass" + String(i);
    String ssid = smartPuckPrefs.getString(ssidKey.c_str(), "");
    String password = smartPuckPrefs.getString(passKey.c_str(), "");
    if (ssid.length() > 0) {
      savedNetworks[savedNetworksCount++] = { ssid, password };
    }
  }
  smartPuckPrefs.end();
}

bool saveWiFiCredentials(String ssid, String password) {
  ssid.trim();
  if (ssid.length() == 0 || ssid.length() > 32 || password.length() > 64) {
    return false;
  }

  loadSavedWiFiCredentials();
  for (int i = 0; i < savedNetworksCount; i++) {
    if (savedNetworks[i].ssid == ssid) {
      savedNetworks[i].password = password;
      persistSavedWiFiCredentials();
      return true;
    }
  }

  if (savedNetworksCount >= SMARTPUCK_MAX_SAVED_WIFI_NETWORKS) {
    for (int i = 1; i < savedNetworksCount; i++) {
      savedNetworks[i - 1] = savedNetworks[i];
    }
    savedNetworksCount--;
  }

  savedNetworks[savedNetworksCount++] = { ssid, password };
  persistSavedWiFiCredentials();
  return true;
}

bool removeWiFiCredentials(String ssid) {
  ssid.trim();
  if (ssid.length() == 0) {
    return false;
  }

  loadSavedWiFiCredentials();
  int writeIndex = 0;
  bool removed = false;
  for (int i = 0; i < savedNetworksCount; i++) {
    if (savedNetworks[i].ssid == ssid) {
      removed = true;
      continue;
    }
    savedNetworks[writeIndex++] = savedNetworks[i];
  }

  savedNetworksCount = writeIndex;
  if (removed) {
    persistSavedWiFiCredentials();
  }
  return removed;
}

void persistSavedWiFiCredentials() {
  smartPuckPrefs.begin("smartpuck", false);
  smartPuckPrefs.putInt("wifi_count", savedNetworksCount);
  for (int i = 0; i < SMARTPUCK_MAX_SAVED_WIFI_NETWORKS; i++) {
    String ssidKey = "ssid" + String(i);
    String passKey = "pass" + String(i);
    if (i < savedNetworksCount) {
      smartPuckPrefs.putString(ssidKey.c_str(), savedNetworks[i].ssid);
      smartPuckPrefs.putString(passKey.c_str(), savedNetworks[i].password);
    } else {
      smartPuckPrefs.remove(ssidKey.c_str());
      smartPuckPrefs.remove(passKey.c_str());
    }
  }
  smartPuckPrefs.end();
}

void startAP() {
  apModeActive = true;
  wifiConnected = true; 
  
  WiFi.disconnect();
  WiFi.mode(WIFI_AP);
  
  String apSSID = "SmartPuck-AP-" + String((uint32_t)ESP.getEfuseMac(), HEX);
  WiFi.softAP(apSSID.c_str());
  
  activeNetworkInfo = "AP Mode: " + apSSID;
  Serial.println("\n[WiFi] Booting in local AP mode (No network found).");
  Serial.print("[WiFi] AP SSID: ");
  Serial.println(apSSID);
  Serial.print("[WiFi] Access Dashboard at: http://");
  Serial.println(WiFi.softAPIP());
  
  // Flash Orange/Yellow twice
  for (int k = 0; k < 2; k++) {
    setStatusLED(30, 10, 0);
    delay(200);
    setStatusLED(0, 0, 0);
    delay(200);
  }
}

String jsonEscape(String value) {
  value.replace("\\", "\\\\");
  value.replace("\"", "\\\"");
  value.replace("\n", "\\n");
  value.replace("\r", "\\r");
  return value;
}

String urlDecode(String value) {
  value.replace("+", " ");
  String decoded = "";
  char temp[] = "0x00";
  unsigned int len = value.length();
  for (unsigned int i = 0; i < len; i++) {
    if (value[i] == '%' && i + 2 < len) {
      temp[2] = value[i + 1];
      temp[3] = value[i + 2];
      decoded += char(strtol(temp, NULL, 16));
      i += 2;
    } else {
      decoded += value[i];
    }
  }
  return decoded;
}

bool isSafeSessionPath(String path) {
  path = urlDecode(path);
  if (!path.startsWith("/sessions/session_")) return false;
  if (path.indexOf("..") >= 0) return false;
  if (path.indexOf("//") >= 0) return false;
  return path.indexOf('/', String("/sessions/session_").length()) < 0;
}

bool isSafeAudioPath(String path) {
  path = urlDecode(path);
  if (path == "psram") return usePsramFallback;
  if (!path.startsWith("/sessions/session_")) return false;
  if (!path.endsWith("/audio_000.wav")) return false;
  if (path.indexOf("..") >= 0) return false;
  if (path.indexOf("//") >= 0) return false;
  return true;
}

bool sessionHasUploadedMarker(String sessionPath) {
  if (!storageAvailable || usePsramFallback || !isSafeSessionPath(sessionPath)) return false;
  return SD_DEVICE.exists(sessionPath + "/uploaded.marker");
}

bool markSessionUploaded(String sessionPath) {
  if (!storageAvailable || usePsramFallback || !isSafeSessionPath(sessionPath)) return false;
  File marker = SD_DEVICE.open(sessionPath + "/uploaded.marker", FILE_WRITE);
  if (!marker) return false;
  marker.println(String(millis()));
  marker.close();
  return true;
}

bool removeSessionRecursive(String sessionPath) {
  if (!storageAvailable || usePsramFallback || !isSafeSessionPath(sessionPath)) return false;

  File dir = SD_DEVICE.open(sessionPath);
  if (!dir || !dir.isDirectory()) {
    if (dir) dir.close();
    return false;
  }

  File entry = dir.openNextFile();
  while (entry) {
    String childPath = entry.name();
    if (!childPath.startsWith("/")) {
      childPath = sessionPath + "/" + childPath;
    }
    entry.close();
    SD_DEVICE.remove(childPath);
    entry = dir.openNextFile();
  }
  dir.close();
  return SD_DEVICE.rmdir(sessionPath);
}

uint64_t getTotalStorageBytes() {
  if (!storageAvailable || usePsramFallback) return 0;
#ifdef BOARD_LOLIN_S3_PRO
  return SD_DEVICE.totalBytes();
#else
  return SD_DEVICE.totalBytes();
#endif
}

uint64_t getUsedStorageBytes() {
  if (!storageAvailable || usePsramFallback) return 0;
#ifdef BOARD_LOLIN_S3_PRO
  return SD_DEVICE.usedBytes();
#else
  return SD_DEVICE.usedBytes();
#endif
}

uint64_t getFreeStorageBytes() {
  uint64_t total = getTotalStorageBytes();
  uint64_t used = getUsedStorageBytes();
  if (total <= used) return 0;
  return total - used;
}

String formatStorageSummary() {
  if (usePsramFallback) {
    return "PSRAM fallback";
  }
  if (!storageAvailable) {
    return "No writable storage";
  }

  uint64_t totalMb = getTotalStorageBytes() / 1024ULL / 1024ULL;
  uint64_t freeMb = getFreeStorageBytes() / 1024ULL / 1024ULL;
  return "microSD " + String((unsigned long)freeMb) + "MB free / " + String((unsigned long)totalMb) + "MB";
}

void cleanupUploadedSessionsIfNeeded() {
  if (!storageAvailable || usePsramFallback) return;
  if (getFreeStorageBytes() >= SMARTPUCK_MIN_FREE_BYTES_FOR_RECORDING) return;

  for (int pass = 0; pass < 8 && getFreeStorageBytes() < SMARTPUCK_MIN_FREE_BYTES_FOR_RECORDING; pass++) {
    File root = SD_DEVICE.open("/sessions");
    if (!root) return;

    String oldestUploaded = "";
    File entry = root.openNextFile();
    while (entry) {
      if (entry.isDirectory()) {
        String path = entry.name();
        if (!path.startsWith("/")) {
          path = "/sessions/" + path;
        }
        if (sessionHasUploadedMarker(path) && (oldestUploaded == "" || path < oldestUploaded)) {
          oldestUploaded = path;
        }
      }
      entry.close();
      entry = root.openNextFile();
    }
    root.close();

    if (oldestUploaded == "") {
      return;
    }
    Serial.print("[Storage] Removing uploaded session to free space: ");
    Serial.println(oldestUploaded);
    removeSessionRecursive(oldestUploaded);
  }
}

bool parseRangeHeader(size_t fileSize, size_t& rangeStart, size_t& rangeEnd) {
  rangeStart = 0;
  rangeEnd = fileSize > 0 ? fileSize - 1 : 0;

  if (!server.hasHeader("Range")) {
    return false;
  }

  String range = server.header("Range");
  range.trim();
  if (!range.startsWith("bytes=")) {
    return false;
  }

  int dashIndex = range.indexOf('-');
  if (dashIndex < 6) {
    return false;
  }

  String startText = range.substring(6, dashIndex);
  String endText = range.substring(dashIndex + 1);
  if (startText.length() == 0) {
    return false;
  }

  size_t requestedStart = (size_t)strtoull(startText.c_str(), NULL, 10);
  size_t requestedEnd = endText.length() > 0 ? (size_t)strtoull(endText.c_str(), NULL, 10) : rangeEnd;
  if (fileSize == 0 || requestedStart >= fileSize || requestedEnd < requestedStart) {
    return false;
  }

  rangeStart = requestedStart;
  rangeEnd = min(requestedEnd, fileSize - 1);
  return true;
}

void sendRangeHeaders(size_t fileSize, size_t rangeStart, size_t rangeEnd, bool partial) {
  size_t contentLength = rangeEnd >= rangeStart ? (rangeEnd - rangeStart + 1) : 0;
  server.sendHeader("Accept-Ranges", "bytes");
  server.sendHeader("Cache-Control", "no-store");
  if (partial) {
    server.sendHeader(
      "Content-Range",
      "bytes " + String(rangeStart) + "-" + String(rangeEnd) + "/" + String(fileSize)
    );
  }
  server.setContentLength(contentLength);
}

bool writeClientBytes(WiFiClient& client, const uint8_t* data, size_t bytesToWrite) {
  size_t offset = 0;
  while (offset < bytesToWrite && client.connected()) {
    size_t written = client.write(data + offset, bytesToWrite - offset);
    if (written == 0) {
      return false;
    }
    offset += written;
    yield();
  }
  return offset == bytesToWrite;
}

void streamFileBytes(File& file, size_t bytesToSend) {
  uint8_t buffer[4096];
  WiFiClient client = server.client();
  client.setNoDelay(true);

  while (bytesToSend > 0 && client.connected()) {
    size_t chunkSize = min(bytesToSend, sizeof(buffer));
    int bytesRead = file.read(buffer, chunkSize);
    if (bytesRead <= 0) {
      break;
    }
    if (!writeClientBytes(client, buffer, bytesRead)) {
      return;
    }
    bytesToSend -= bytesRead;
  }
}

void sendConvexHeartbeat(const char* reason) {
  if (apModeActive || WiFi.status() != WL_CONNECTED) {
    Serial.println("[Convex] Skipping heartbeat; station Wi-Fi is not connected.");
    return;
  }
  if (strlen(CONVEX_SITE_URL) == 0 || strlen(SMARTPUCK_DEVICE_TOKEN) == 0) {
    Serial.println("[Convex] Skipping heartbeat; CONVEX_SITE_URL or SMARTPUCK_DEVICE_TOKEN is not configured.");
    return;
  }

  WiFiClientSecure client;
  client.setInsecure();

  String endpoint = String(CONVEX_SITE_URL);
  endpoint.replace("/$", "");
  if (endpoint.endsWith("/")) {
    endpoint.remove(endpoint.length() - 1);
  }
  endpoint += "/device/heartbeat";

  String localIp = WiFi.localIP().toString();
  String baseUrl = "http://" + localIp;
  String mac = WiFi.macAddress();
  String status = String(reason) + " at " + baseUrl;

  String body = "{";
  body += "\"token\":\"" + jsonEscape(String(SMARTPUCK_DEVICE_TOKEN)) + "\",";
  body += "\"baseUrl\":\"" + jsonEscape(baseUrl) + "\",";
  body += "\"localIp\":\"" + jsonEscape(localIp) + "\",";
  body += "\"mac\":\"" + jsonEscape(mac) + "\",";
  body += "\"network\":\"" + jsonEscape(WiFi.SSID()) + "\",";
  body += "\"mode\":\"station\",";
  body += "\"firmwareVersion\":\"" SMARTPUCK_FIRMWARE_VERSION "\",";
  body += "\"storage\":\"" + jsonEscape(formatStorageSummary()) + "\",";
  body += "\"storageReady\":" + String((storageAvailable || usePsramFallback) ? "true" : "false") + ",";
  body += "\"storageMode\":\"" + String(usePsramFallback ? "psram" : storageAvailable ? "microsd" : "none") + "\",";
  body += "\"storageFreeBytes\":" + String((unsigned long long)getFreeStorageBytes()) + ",";
  body += "\"storageTotalBytes\":" + String((unsigned long long)getTotalStorageBytes()) + ",";
  body += "\"lastStatus\":\"" + jsonEscape(status) + "\"";
  body += "}";

  HTTPClient http;
  Serial.print("[Convex] Posting heartbeat to: ");
  Serial.println(endpoint);
  if (!http.begin(client, endpoint)) {
    Serial.println("[Convex] ERROR: Failed to initialize HTTPS client.");
    return;
  }

  http.addHeader("Content-Type", "application/json");
  int responseCode = http.POST(body);
  Serial.print("[Convex] Heartbeat response: ");
  Serial.println(responseCode);
  if (responseCode > 0) {
    Serial.println(http.getString());
  }
  http.end();
}

// ============================================================================
// WEB SERVER PORTAL & HANDLERS
// ============================================================================

// Serves the glassmorphic dark-themed web portal
void handleRoot() {
  String html = R"rawliteral(<!DOCTYPE html>
<html>
<head>
  <meta charset='UTF-8'>
  <meta name='viewport' content='width=device-width,initial-scale=1.0'>
  <title>SmartPuck Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #030712;
      --card-bg: rgba(17, 24, 39, 0.7);
      --border: rgba(255, 255, 255, 0.08);
      --primary: #38bdf8;
      --primary-glow: rgba(56, 189, 248, 0.3);
      --record: #ef4444;
      --record-glow: rgba(239, 68, 68, 0.3);
      --text: #f8fafc;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
    body {
      background: var(--bg);
      background-image: radial-gradient(circle at 50% -20%, #1e1b4b 0%, #030712 70%);
      color: var(--text);
      min-height: 100vh;
      padding: 40px 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 40px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 20px;
    }
    h1 { font-size: 2rem; font-weight: 700; background: linear-gradient(to right, #38bdf8, #818cf8); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .badge {
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.05);
      backdrop-filter: blur(10px);
      color: #38bdf8;
    }
    .grid { display: grid; grid-template-columns: 1fr; gap: 24px; margin-bottom: 40px; }
    @media(min-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 28px;
      backdrop-filter: blur(12px);
      box-shadow: 0 4px 30px rgba(0,0,0,0.4);
      transition: all 0.3s ease;
    }
    .card:hover { border-color: rgba(255,255,255,0.15); transform: translateY(-2px); }
    .card-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 8px; display: flex; align-items: center; gap: 10px; }
    .card-subtitle { color: var(--text-muted); font-size: 0.9rem; margin-bottom: 24px; line-height: 1.5; }
    .btn {
      width: 100%;
      padding: 14px;
      border-radius: 14px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
    }
    .btn-primary {
      background: var(--primary);
      color: #030712;
      box-shadow: 0 0 20px var(--primary-glow);
    }
    .btn-primary:hover {
      background: #7dd3fc;
      transform: scale(1.02);
    }
    .btn-danger {
      background: var(--record);
      color: white;
      box-shadow: 0 0 20px var(--record-glow);
    }
    .btn-danger:hover {
      background: #f87171;
      transform: scale(1.02);
    }
    .btn-disabled {
      background: #475569;
      color: #94a3b8;
      cursor: not-allowed;
      box-shadow: none;
    }
    .status-indicator {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #94a3b8;
    }
    .status-recording {
      background: var(--record);
      box-shadow: 0 0 10px var(--record-glow);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.5; }
      50% { transform: scale(1.1); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.5; }
    }
    .visualizer-container {
      width: 100%;
      height: 80px;
      background: rgba(0,0,0,0.4);
      border-radius: 12px;
      margin-top: 15px;
      overflow: hidden;
      border: 1px solid rgba(255,255,255,0.05);
    }
    canvas { width: 100%; height: 100%; display: block; }
    .session-title { font-weight: 600; margin-bottom: 8px; color: var(--text); font-size: 1.1rem; }
    .session-item {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 12px;
      transition: all 0.2s ease;
    }
    .session-item:hover {
      background: rgba(255, 255, 255, 0.04);
      border-color: rgba(255, 255, 255, 0.12);
    }
    .session-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    a { color: var(--primary); text-decoration: none; font-weight: 600; font-size: 0.9rem; display: inline-block; margin-bottom: 8px; }
    a:hover { color: #7dd3fc; text-decoration: underline; }
    audio {
      width: 100%;
      height: 36px;
      margin-top: 10px;
      filter: invert(0.9) hue-rotate(180deg);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>SmartPuck Portal</h1>
      <div id="net-info" class="badge">Connecting...</div>
    </header>
    
    <div class="grid">
      <!-- Recording Card -->
      <div class="card">
        <div class="card-title">
          <span id="rec-indicator" class="status-indicator"></span>
          <span>Offline Recorder</span>
        </div>
        <div id="rec-status-text" class="card-subtitle">Status: Idle</div>
        <button id="record-btn" class="btn btn-primary" onclick="startRecording()">⏺️ Start Recording</button>
      </div>
      
      <!-- Live Stream Card -->
      <div class="card">
        <div class="card-title">🎙️ Live Stream</div>
        <div class="card-subtitle">Real-time PCM stream over Web Audio</div>
        <div style="display: flex; gap: 10px;">
          <button id="playBtn" class="btn btn-primary" style="flex: 1;">Start Listening</button>
          <button id="stopBtn" class="btn btn-danger" style="flex: 1; display: none;">Stop</button>
        </div>
        <div id="stream-status" style="font-size: 0.85rem; color: var(--text-muted); margin-top: 10px;">Status: Idle</div>
        <div class="visualizer-container">
          <canvas id="visualizer"></canvas>
        </div>
      </div>
    </div>
    
    <div class="card" style="margin-bottom: 40px;">
      <div class="card-title" id="storage-info">Storage Details</div>
      <div class="card-subtitle" style="margin-bottom: 0;">Device automatically falls back to PSRAM buffer if SD card mount fails.</div>
    </div>

    <h2 style="font-size: 1.5rem; margin-bottom: 20px; font-weight: 600;">Recorded Sessions</h2>
    <div id="sessions-container">
      SESSION_ITEMS_PLACEHOLDER
    </div>
  </div>

  <script>
    const playBtn = document.getElementById('playBtn');
    const stopBtn = document.getElementById('stopBtn');
    const statusDiv = document.getElementById('stream-status');
    const canvas = document.getElementById('visualizer');
    const canvasCtx = canvas.getContext('2d');
    
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    
    canvasCtx.fillStyle = '#0f172a';
    canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

    let audioCtx = null;
    let nextPlayTime = 0;
    const safetyDelay = 0.05;
    let controller = null;
    let activeSources = [];
    let analyser = null;
    let visualizerAnimFrame = null;

    function drawVisualizer() {
      if (!analyser) return;
      visualizerAnimFrame = requestAnimationFrame(drawVisualizer);
      
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteFrequencyData(dataArray);
      
      canvasCtx.fillStyle = '#0f172a';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
      
      const barWidth = (canvas.width / bufferLength) * 1.5;
      let barHeight;
      let x = 0;
      
      for(let i = 0; i < bufferLength; i++) {
        barHeight = (dataArray[i] / 255) * canvas.height * 0.9;
        const percent = i / bufferLength;
        const r = Math.round(56 + percent * 100);
        const g = Math.round(189 - percent * 50);
        const b = 248;
        
        canvasCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
        x += barWidth;
      }
    }

    playBtn.addEventListener('click', async () => {
      try {
        statusDiv.textContent = 'Status: Connecting...';
        playBtn.style.display = 'none';
        stopBtn.style.display = 'block';
        
        if (!audioCtx) {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } else if (audioCtx.state === 'suspended') {
          await audioCtx.resume();
        }
        
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.connect(audioCtx.destination);
        
        nextPlayTime = audioCtx.currentTime + safetyDelay;
        controller = new AbortController();
        
        drawVisualizer();
        
        const response = await fetch('/stream', { signal: controller.signal });
        const reader = response.body.getReader();
        statusDiv.textContent = 'Status: Streaming live...';
        
        let headerSkipped = false;
        let leftoverBytes = new Uint8Array(0);
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          let data = new Uint8Array(leftoverBytes.length + value.length);
          data.set(leftoverBytes);
          data.set(value, leftoverBytes.length);
          
          let offset = 0;
          if (!headerSkipped) {
            if (data.length >= 44) {
              offset = 44;
              headerSkipped = true;
            } else {
              leftoverBytes = data;
              continue;
            }
          }
          
          const bytesToProcess = data.length - offset;
          const samplesToProcess = Math.floor(bytesToProcess / 2);
          
          if (samplesToProcess === 0) {
            leftoverBytes = data.subarray(offset);
            continue;
          }
          
          const floatData = new Float32Array(samplesToProcess);
          for (let i = 0; i < samplesToProcess; i++) {
            const byteIdx = offset + i * 2;
            let val = data[byteIdx] | (data[byteIdx + 1] << 8);
            if (val & 0x8000) val = val - 0x10000;
            floatData[i] = val / 32768.0;
          }
          
          leftoverBytes = data.subarray(offset + samplesToProcess * 2);
          
          if (floatData.length > 0) {
            const audioBuffer = audioCtx.createBuffer(1, floatData.length, 16000);
            audioBuffer.copyToChannel(floatData, 0);
            
            const source = audioCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(analyser);
            
            const currentTime = audioCtx.currentTime;
            if (nextPlayTime < currentTime) {
              nextPlayTime = currentTime + safetyDelay;
            }
            
            source.start(nextPlayTime);
            activeSources.push(source);
            nextPlayTime += audioBuffer.duration;
            
            source.onended = () => {
              activeSources = activeSources.filter(s => s !== source);
            };
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error(err);
          statusDiv.textContent = 'Status: Error - ' + err.message;
          stopStreaming();
        }
      }
    });

    stopBtn.addEventListener('click', () => {
      stopStreaming();
    });

    function stopStreaming() {
      if (controller) {
        controller.abort();
        controller = null;
      }
      if (visualizerAnimFrame) {
        cancelAnimationFrame(visualizerAnimFrame);
        visualizerAnimFrame = null;
      }
      activeSources.forEach(s => {
        try { s.stop(); } catch(e) {}
      });
      activeSources = [];
      analyser = null;
      statusDiv.textContent = 'Status: Stopped';
      playBtn.style.display = 'block';
      stopBtn.style.display = 'none';
      
      canvasCtx.fillStyle = '#0f172a';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
    }

    async function startRecording() {
      document.getElementById('record-btn').className = 'btn btn-disabled';
      await fetch('/start_record');
      updateStatus();
    }

    async function stopRecording() {
      document.getElementById('record-btn').className = 'btn btn-disabled';
      await fetch('/stop_record');
      setTimeout(() => window.location.reload(), 1000);
    }

    async function updateStatus() {
      try {
        const res = await fetch('/status');
        const status = await res.json();
        
        const recIndicator = document.getElementById('rec-indicator');
        const recStatusText = document.getElementById('rec-status-text');
        const recordBtn = document.getElementById('record-btn');
        
        if (status.recording) {
          recIndicator.className = 'status-indicator status-recording';
          recStatusText.textContent = 'Status: Recording (' + Math.round(status.audioSize / 32000) + ' seconds)';
          recordBtn.textContent = '🛑 Stop Recording';
          recordBtn.className = 'btn btn-danger';
          recordBtn.onclick = stopRecording;
        } else {
          recIndicator.className = 'status-indicator';
          recIndicator.style.background = '#94a3b8';
          recStatusText.textContent = 'Status: Idle / Ready';
          recordBtn.textContent = '⏺️ Start Recording';
          recordBtn.className = 'btn btn-primary';
          recordBtn.onclick = startRecording;
        }
        
        document.getElementById('net-info').textContent = status.network;
        document.getElementById('storage-info').textContent = 'Storage: ' + status.storage + ' | Size: ' + status.audioSize + ' bytes';
      } catch (err) {
        console.error('Error fetching status:', err);
      }
    }
    
    setInterval(updateStatus, 1000);
    updateStatus();
  </script>
</body>
</html>)rawliteral";
  
  String sessionItemsHtml = "";
  
  if (usePsramFallback) {
    if (audioSize == 0) {
      sessionItemsHtml += "<p style='color: #94a3b8; font-style: italic;'>No recordings found in PSRAM. Use the controls above to start recording!</p>";
    } else {
      sessionItemsHtml += "<div class='session-item'>";
      sessionItemsHtml += "  <div class='session-title'>🧠 temporary_psram_session (RAM)</div>";
      sessionItemsHtml += "  <div class='session-meta'>";
      sessionItemsHtml += "    <span>Type: PSRAM Fallback Buffer</span>";
      sessionItemsHtml += "    <span>Size: " + String(audioSize) + " bytes (" + String(audioSize / 32000) + "s)</span>";
      sessionItemsHtml += "  </div>";
      sessionItemsHtml += "  <a href='/download?path=psram' download='recording.wav'>⬇️ Download WAV Audio File</a>";
      sessionItemsHtml += "  <audio controls src='/download?path=psram'></audio>";
      sessionItemsHtml += "</div>";
    }
  } else {
    // Scan SD Card session folders (protect with mutex)
    if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(500)) == pdTRUE) {
      File root = SD_DEVICE.open("/sessions");
      if (!root) {
        sessionItemsHtml += "<p style='color: #94a3b8; font-style: italic;'>No recordings directory found. Create a recording to start!</p>";
      } else {
        File file = root.openNextFile();
        bool hasSessions = false;
        while (file) {
          if (file.isDirectory()) {
            hasSessions = true;
            String folderPath = file.name();
            int lastSlash = folderPath.lastIndexOf('/');
            String baseName = (lastSlash >= 0) ? folderPath.substring(lastSlash + 1) : folderPath;
            
            sessionItemsHtml += "<div class='session-item'>";
            sessionItemsHtml += "  <div class='session-title'>📁 " + baseName + "</div>";
            
            String wavPath = "/sessions/" + baseName + "/audio_000.wav";
            File audioFileCheck = SD_DEVICE.open(wavPath, FILE_READ);
            size_t fileSize = 0;
            if (audioFileCheck) {
              fileSize = audioFileCheck.size();
              audioFileCheck.close();
            }
            
            sessionItemsHtml += "  <div class='session-meta'>";
            sessionItemsHtml += "    <span>Path: " + wavPath + "</span>";
            sessionItemsHtml += "    <span>Size: " + String(fileSize) + " bytes (" + String(fileSize / 32000) + "s)</span>";
            sessionItemsHtml += "  </div>";
            
            if (fileSize > 44) {
              sessionItemsHtml += "  <a href='/download?path=" + wavPath + "' download>⬇️ Download WAV Audio File</a>";
              sessionItemsHtml += "  <audio controls src='/download?path=" + wavPath + "'></audio>";
            } else {
              sessionItemsHtml += "  <span style='color: #ef4444; font-size: 0.9em; font-weight:600;'>Empty/Corrupted WAV file</span>";
            }
            sessionItemsHtml += "</div>";
          }
          file = root.openNextFile();
        }
        root.close();
        if (!hasSessions) {
          sessionItemsHtml += "<p style='color: #94a3b8; font-style: italic;'>No recordings found. Use the controls above to start recording!</p>";
        }
      }
      xSemaphoreGive(fileMutex);
    } else {
      sessionItemsHtml += "<p style='color: #ef4444; font-style: italic;'>SD Card is busy. Please refresh.</p>";
    }
  }
  
  html.replace("SESSION_ITEMS_PLACEHOLDER", sessionItemsHtml);
  server.send(200, "text/html", html);
}

// Download/Stream files from SD card or PSRAM
void handleDownload() {
  sendCorsHeaders();

  if (!server.hasArg("path")) {
    server.send(400, "text/plain", "Bad Request: Missing 'path' parameter");
    return;
  }
  
  String path = urlDecode(server.arg("path"));
  if (!isSafeAudioPath(path)) {
    server.send(400, "text/plain", "Bad Request: Invalid audio path");
    return;
  }

  if (usePsramFallback && path == "psram") {
    if (audioSize == 0) {
      server.send(404, "text/plain", "No audio recorded in RAM yet");
      return;
    }

    size_t fileSize = 44 + audioSize;
    size_t rangeStart = 0;
    size_t rangeEnd = fileSize - 1;
    bool partial = parseRangeHeader(fileSize, rangeStart, rangeEnd);
    if (server.hasHeader("Range") && !partial) {
      server.sendHeader("Content-Range", "bytes */" + String(fileSize));
      server.send(416, "text/plain", "Requested Range Not Satisfiable");
      return;
    }

    sendRangeHeaders(fileSize, rangeStart, rangeEnd, partial);
    server.send(partial ? 206 : 200, "audio/wav", "");

    uint8_t header[44];
    fillWavHeader(header, audioSize);
    size_t bytesToSend = rangeEnd - rangeStart + 1;
    WiFiClient client = server.client();
    client.setNoDelay(true);
    if (rangeStart < 44) {
      size_t headerStart = rangeStart;
      size_t headerBytes = min(bytesToSend, (size_t)(44 - headerStart));
      if (!writeClientBytes(client, header + headerStart, headerBytes)) {
        return;
      }
      bytesToSend -= headerBytes;
      rangeStart += headerBytes;
    }
    if (bytesToSend > 0 && client.connected()) {
      size_t psramOffset = rangeStart - 44;
      writeClientBytes(client, psramBuffer + psramOffset, bytesToSend);
    }
    return;
  }

  if (!storageAvailable) {
    server.send(404, "text/plain", "No microSD storage available");
    return;
  }

  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(2000)) == pdTRUE) {
    if (!SD_DEVICE.exists(path)) {
      server.send(404, "text/plain", "File Not Found");
      xSemaphoreGive(fileMutex);
      return;
    }

    File file = SD_DEVICE.open(path, FILE_READ);
    if (!file) {
      server.send(500, "text/plain", "Internal Server Error: Could not open file");
      xSemaphoreGive(fileMutex);
      return;
    }

    size_t fileSize = file.size();
    size_t rangeStart = 0;
    size_t rangeEnd = fileSize > 0 ? fileSize - 1 : 0;
    bool partial = parseRangeHeader(fileSize, rangeStart, rangeEnd);
    if (server.hasHeader("Range") && !partial) {
      server.sendHeader("Content-Range", "bytes */" + String(fileSize));
      server.send(416, "text/plain", "Requested Range Not Satisfiable");
      file.close();
      xSemaphoreGive(fileMutex);
      return;
    }

    sendRangeHeaders(fileSize, rangeStart, rangeEnd, partial);
    server.send(partial ? 206 : 200, "audio/wav", "");
    file.seek(rangeStart);
    streamFileBytes(file, rangeEnd - rangeStart + 1);
    file.close();
    xSemaphoreGive(fileMutex);
  } else {
    server.send(503, "text/plain", "SD Card busy, try again later");
  }
}

// Low-latency real-time live PCM streaming handler
void handleStream() {
  Serial.println("[Stream] Client connected. Starting live raw audio stream...");
  
  WiFiClient client = server.client();
  client.setNoDelay(true); // Disable Nagle's algorithm for low-latency transmission
  
  client.println("HTTP/1.1 200 OK");
  client.println("Content-Type: audio/wav");
  client.println("Access-Control-Allow-Origin: *");
  client.println("Access-Control-Allow-Methods: GET, OPTIONS");
  client.println("Access-Control-Allow-Headers: Content-Type");
  client.println("Access-Control-Allow-Private-Network: true");
  client.println("Connection: close");
  client.println();
  
  // Send 2GB WAV header (infinite open-ended stream)
  uint8_t header[44];
  fillWavHeader(header, 0x7FFFFFFF);
  client.write(header, 44);
  
  // Clear ring buffer of any stale audio before starting
  size_t tempBytes = 0;
  while (true) {
    void* temp = xRingbufferReceive(audioRingBuf, &tempBytes, 0);
    if (temp == NULL) break;
    vRingbufferReturnItem(audioRingBuf, temp);
  }
  
  isStreaming = true;
  
  while (client.connected()) {
    size_t receivedBytes = 0;
    // Receive processed PCM data from Core 1 audioTask (wait up to 50ms)
    void* data = xRingbufferReceiveUpTo(audioRingBuf, &receivedBytes, pdMS_TO_TICKS(50), 512);
    
    if (data != NULL) {
      if (client.write((const uint8_t*)data, receivedBytes) != receivedBytes) {
        vRingbufferReturnItem(audioRingBuf, data);
        break; // socket write error or client disconnected
      }
      vRingbufferReturnItem(audioRingBuf, data);
    }
    
    // Check button inside streaming loop to preserve button responsiveness
    checkButton();
    
    yield();
  }
  
  isStreaming = false;
  Serial.println("[Stream] Client disconnected. Live audio stream closed.");
}

// Remote Control endpoints
void handleStartRecord() {
  sendCorsHeaders();

  if (!isRecording) {
    startRecording();
    if (isRecording) {
      server.send(200, "application/json", "{\"status\":\"started\"}");
    } else {
      server.send(409, "application/json", "{\"status\":\"failed\",\"error\":\"" + jsonEscape(lastRecordingError) + "\"}");
    }
  } else {
    server.send(200, "application/json", "{\"status\":\"already_recording\"}");
  }
}

void handleStopRecord() {
  sendCorsHeaders();

  if (isRecording) {
    stopRecording();
    server.send(200, "application/json", "{\"status\":\"stopped\"}");
  } else {
    server.send(200, "application/json", "{\"status\":\"not_recording\"}");
  }
}

String buildStatusJson() {
  String json = "{";
  json += "\"recording\":" + String(isRecording ? "true" : "false") + ",";
  json += "\"streaming\":" + String(isStreaming ? "true" : "false") + ",";
  json += "\"audioSize\":" + String(audioSize) + ",";
  json += "\"audioLevel\":" + String(isRecording ? audioLevel : 0) + ",";
  json += "\"network\":\"" + jsonEscape(activeNetworkInfo) + "\",";
  json += "\"networkMode\":\"" + String(apModeActive ? "ap" : "station") + "\",";
  json += "\"ip\":\"" + jsonEscape(apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString()) + "\",";
  json += "\"savedWifiCount\":" + String(savedNetworksCount) + ",";
  json += "\"storage\":\"" + jsonEscape(formatStorageSummary()) + "\",";
  json += "\"storageReady\":" + String((storageAvailable || usePsramFallback) ? "true" : "false") + ",";
  json += "\"storageMode\":\"" + String(usePsramFallback ? "psram" : storageAvailable ? "microsd" : "none") + "\",";
  json += "\"storageFreeBytes\":" + String((unsigned long long)getFreeStorageBytes()) + ",";
  json += "\"storageTotalBytes\":" + String((unsigned long long)getTotalStorageBytes()) + ",";
  json += "\"batteryPercent\":null,";
  json += "\"batteryCharging\":null,";
  json += "\"firmwareVersion\":\"" SMARTPUCK_FIRMWARE_VERSION "\",";
  json += "\"lastError\":\"" + jsonEscape(lastRecordingError) + "\"";
  json += "}";
  return json;
}

String buildSessionsJson() {
  String json = "{\"sessions\":[";

  if (usePsramFallback) {
    if (audioSize > 0) {
      json += "{\"sessionPath\":\"psram\",\"audioPath\":\"psram\",\"name\":\"temporary_psram_session\",";
      json += "\"sizeBytes\":" + String(audioSize + 44) + ",\"durationSeconds\":" + String(audioSize / 32000) + ",";
      json += "\"uploaded\":false,\"storageMode\":\"psram\"}";
    }
    json += "]}";
    return json;
  }

  if (!storageAvailable) {
    json += "]}";
    return json;
  }

  String sessionPaths[SMARTPUCK_MAX_SESSIONS_JSON];
  int count = 0;

  File root = SD_DEVICE.open("/sessions");
  if (root) {
    File entry = root.openNextFile();
    while (entry && count < SMARTPUCK_MAX_SESSIONS_JSON) {
      if (entry.isDirectory()) {
        String path = entry.name();
        if (!path.startsWith("/")) {
          path = "/sessions/" + path;
        }
        if (isSafeSessionPath(path)) {
          int insertAt = count;
          while (insertAt > 0 && sessionPaths[insertAt - 1] < path) {
            sessionPaths[insertAt] = sessionPaths[insertAt - 1];
            insertAt--;
          }
          sessionPaths[insertAt] = path;
          count++;
        }
      }
      entry.close();
      entry = root.openNextFile();
    }
    root.close();
  }

  for (int i = 0; i < count; i++) {
    String sessionPath = sessionPaths[i];
    String audioPath = sessionPath + "/audio_000.wav";
    String name = sessionPath.substring(sessionPath.lastIndexOf('/') + 1);
    String displayName = readManifestField(sessionPath, "displayName");
    String createdAt = readManifestField(sessionPath, "createdAt");
    String network = readManifestField(sessionPath, "network");
    String ip = readManifestField(sessionPath, "ip");
    if (displayName.length() == 0) {
      displayName = name;
    }
    if (network.length() == 0) {
      network = activeNetworkInfo;
    }
    size_t sizeBytes = 0;
    File wav = SD_DEVICE.open(audioPath, FILE_READ);
    if (wav) {
      sizeBytes = wav.size();
      wav.close();
    }

    if (i > 0) json += ",";
    json += "{\"sessionPath\":\"" + jsonEscape(sessionPath) + "\",";
    json += "\"audioPath\":\"" + jsonEscape(audioPath) + "\",";
    json += "\"name\":\"" + jsonEscape(name) + "\",";
    json += "\"displayName\":\"" + jsonEscape(displayName) + "\",";
    json += "\"createdAt\":\"" + jsonEscape(createdAt) + "\",";
    json += "\"network\":\"" + jsonEscape(network) + "\",";
    json += "\"ip\":\"" + jsonEscape(ip) + "\",";
    json += "\"sizeBytes\":" + String(sizeBytes) + ",";
    json += "\"durationSeconds\":" + String(sizeBytes > 44 ? (sizeBytes - 44) / 32000 : 0) + ",";
    json += "\"uploaded\":" + String(sessionHasUploadedMarker(sessionPath) ? "true" : "false") + ",";
    json += "\"storageMode\":\"microsd\"}";
  }

  json += "]}";
  return json;
}

void handleSessions() {
  sendCorsHeaders();
  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(1500)) == pdTRUE) {
    server.send(200, "application/json", buildSessionsJson());
    xSemaphoreGive(fileMutex);
  } else {
    server.send(503, "application/json", "{\"sessions\":[],\"error\":\"Storage busy\"}");
  }
}

void handleSessionUploaded() {
  sendCorsHeaders();
  if (!server.hasArg("path")) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Missing path\"}");
    return;
  }

  String path = urlDecode(server.arg("path"));
  if (!isSafeSessionPath(path)) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Invalid session path\"}");
    return;
  }

  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(1500)) == pdTRUE) {
    bool ok = markSessionUploaded(path);
    xSemaphoreGive(fileMutex);
    server.send(ok ? 200 : 500, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Could not mark uploaded\"}");
  } else {
    server.send(503, "application/json", "{\"ok\":false,\"error\":\"Storage busy\"}");
  }
}

void handleDeleteSession() {
  sendCorsHeaders();
  if (!server.hasArg("path")) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Missing path\"}");
    return;
  }

  String path = urlDecode(server.arg("path"));
  if (!isSafeSessionPath(path)) {
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"Invalid session path\"}");
    return;
  }

  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(1500)) == pdTRUE) {
    bool forceDelete = server.hasArg("force") && server.arg("force") == "1";
    if (!forceDelete && !sessionHasUploadedMarker(path)) {
      xSemaphoreGive(fileMutex);
      server.send(409, "application/json", "{\"ok\":false,\"error\":\"Session has not been uploaded\"}");
      return;
    }
    bool ok = removeSessionRecursive(path);
    xSemaphoreGive(fileMutex);
    server.send(ok ? 200 : 500, "application/json", ok ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Could not delete session\"}");
  } else {
    server.send(503, "application/json", "{\"ok\":false,\"error\":\"Storage busy\"}");
  }
}

// JSON Status endpoint
void handleStatus() {
  sendCorsHeaders();
  server.send(200, "application/json", buildStatusJson());
}

void sendCorsHeaders() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
  server.sendHeader("Access-Control-Allow-Private-Network", "true");
}

void handleCorsOptions() {
  sendCorsHeaders();
  server.send(204, "text/plain", "");
}

String buildWiFiConfigJson() {
  loadSavedWiFiCredentials();
  String json = "{";
  json += "\"mode\":\"" + String(apModeActive ? "ap" : "station") + "\",";
  json += "\"network\":\"" + jsonEscape(activeNetworkInfo) + "\",";
  json += "\"ip\":\"" + jsonEscape(apModeActive ? WiFi.softAPIP().toString() : WiFi.localIP().toString()) + "\",";
  json += "\"activeSsid\":\"" + jsonEscape(apModeActive ? "" : WiFi.SSID()) + "\",";
  json += "\"maxNetworks\":" + String(SMARTPUCK_MAX_SAVED_WIFI_NETWORKS) + ",";
  json += "\"networks\":[";
  for (int i = 0; i < savedNetworksCount; i++) {
    if (i > 0) json += ",";
    json += "{";
    json += "\"ssid\":\"" + jsonEscape(savedNetworks[i].ssid) + "\",";
    json += "\"active\":" + String((!apModeActive && WiFi.SSID() == savedNetworks[i].ssid) ? "true" : "false");
    json += "}";
  }
  json += "]}";
  return json;
}

void handleWiFiConfig() {
  sendCorsHeaders();

  if (server.method() == HTTP_GET) {
    server.send(200, "application/json", buildWiFiConfigJson());
    return;
  }

  if (server.method() == HTTP_POST) {
    String ssid = server.arg("ssid");
    String password = server.arg("password");
    if (ssid.length() == 0) {
      server.send(400, "application/json", "{\"ok\":false,\"error\":\"SSID is required\"}");
      return;
    }

    bool ok = saveWiFiCredentials(ssid, password);
    if (!ok) {
      server.send(400, "application/json", "{\"ok\":false,\"error\":\"SSID or password is too long\"}");
      return;
    }

    restartAtMs = millis() + 900;
    server.send(200, "application/json", "{\"ok\":true,\"restart\":true,\"message\":\"Wi-Fi saved. SmartPuck is restarting and will join the network if reachable.\"}");
    return;
  }

  if (server.method() == HTTP_DELETE) {
    String ssid = server.arg("ssid");
    bool removed = removeWiFiCredentials(ssid);
    server.send(removed ? 200 : 404, "application/json", removed ? "{\"ok\":true}" : "{\"ok\":false,\"error\":\"Network not found\"}");
    return;
  }

  server.send(405, "application/json", "{\"ok\":false,\"error\":\"Method not allowed\"}");
}

// Unified button check and debouncing
void checkButton() {
  static bool lastButtonState = HIGH;
  static bool buttonArmed = false;
  bool currentButtonState = digitalRead(BUTTON_PIN);

  if (!buttonArmed) {
    lastButtonState = currentButtonState;
    if (millis() > SMARTPUCK_BUTTON_ARM_DELAY_MS && currentButtonState == HIGH) {
      buttonArmed = true;
    }
    return;
  }

  if (lastButtonState == HIGH && currentButtonState == LOW) {
    delay(50); // Debounce
    if (digitalRead(BUTTON_PIN) == LOW) {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    }
  }
  lastButtonState = currentButtonState;
}

// Updates LED indicator depending on system state
void updateLED() {
  if (isStreaming) {
    setStatusLED(0, 15, 15); // Cyan
  } else if (isRecording) {
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
  } else if (lastRecordingError.length() > 0) {
    static uint32_t lastErrorBlinkTime = 0;
    static bool errorLedState = false;
    if (millis() - lastErrorBlinkTime > 700) {
      lastErrorBlinkTime = millis();
      errorLedState = !errorLedState;
      setStatusLED(errorLedState ? 24 : 3, errorLedState ? 8 : 1, 0);
    }
  } else {
    setStatusLED(0, 0, 30); // Solid Blue (Idle)
  }
}

// ============================================================================
// MAIN SETUP
// ============================================================================
void setup() {
  Serial.begin(921600);
  delay(1000);
  Serial.println("--- SmartPuck Offline Audio Recorder Initializing ---");

#ifdef BOARD_ESP32_CAM
  pinMode(LED_PIN, OUTPUT);
#endif
  setStatusLED(0, 0, 0); // Off initially

  pinMode(BUTTON_PIN, INPUT_PULLUP);

  // Mount SD Card
  bool sdCardOk = initSDCard();
  storageAvailable = sdCardOk;
  if (!sdCardOk) {
    Serial.println("MicroSD card not found. Attempting to fall back to PSRAM buffer mode...");
    if (psramFound()) {
      psramBuffer = (uint8_t*)ps_malloc(PSRAM_BUFFER_MAX);
      if (psramBuffer != NULL) {
        usePsramFallback = true;
        Serial.printf("SUCCESS: Allocated %d bytes in PSRAM for audio recording buffer.\n", PSRAM_BUFFER_MAX);
      } else {
        Serial.println("ERROR: Failed to allocate PSRAM audio buffer.");
      }
    } else {
      Serial.println("ERROR: PSRAM not found/enabled on this board.");
    }

    if (!usePsramFallback) {
      Serial.println("WARNING: No writable recording storage. Live audio streaming and status API will still run.");
    }
  } else {
    repairIncompleteSessions();
  }

  // Install I2S Microphone
  if (!initI2S()) {
    // Flash LED Yellow slowly to signal Microphone failure
    while (true) {
      setStatusLED(40, 20, 0);
      delay(500);
      setStatusLED(0, 0, 0);
      delay(500);
    }
  }

  // Initialize ring buffer for streaming (holds 8KB / 4096 samples of 16-bit mono)
  audioRingBuf = xRingbufferCreate(8192, RINGBUF_TYPE_BYTEBUF);
  if (audioRingBuf == NULL) {
    Serial.println("ERROR: Failed to create FreeRTOS Ring Buffer!");
  }

  // Create file access mutex
  fileMutex = xSemaphoreCreateMutex();
  if (fileMutex == NULL) {
    Serial.println("ERROR: Failed to create File Mutex!");
  }

  // Create high-priority audio acquisition task on Core 1
  xTaskCreatePinnedToCore(
    audioTask,
    "audioTask",
    8192,
    NULL,
    configMAX_PRIORITIES - 1,
    &audioTaskHandle,
    1
  );

  // Initialize Wi-Fi and Web Server (or local AP fallback)
  initWiFi();
  if (MDNS.begin("smartpuck")) {
    MDNS.addService("http", "tcp", 80);
    Serial.println("SmartPuck discovery ready at http://smartpuck.local");
  } else {
    Serial.println("WARNING: SmartPuck mDNS discovery failed to start.");
  }

  // Initialize Web Portal Endpoints
  server.collectHeaders(SMARTPUCK_HTTP_HEADERS, 1);
  server.on("/", handleRoot);
  server.on("/status", HTTP_OPTIONS, handleCorsOptions);
  server.on("/sessions", HTTP_OPTIONS, handleCorsOptions);
  server.on("/session_uploaded", HTTP_OPTIONS, handleCorsOptions);
  server.on("/session", HTTP_OPTIONS, handleCorsOptions);
  server.on("/stream", HTTP_OPTIONS, handleCorsOptions);
  server.on("/download", HTTP_OPTIONS, handleCorsOptions);
  server.on("/start_record", HTTP_OPTIONS, handleCorsOptions);
  server.on("/stop_record", HTTP_OPTIONS, handleCorsOptions);
  server.on("/wifi", HTTP_OPTIONS, handleCorsOptions);
  server.on("/download", handleDownload);
  server.on("/sessions", handleSessions);
  server.on("/session_uploaded", HTTP_POST, handleSessionUploaded);
  server.on("/session", HTTP_DELETE, handleDeleteSession);
  server.on("/wifi", handleWiFiConfig);
  server.on("/stream", handleStream);
  server.on("/start_record", handleStartRecord);
  server.on("/stop_record", handleStopRecord);
  server.on("/status", handleStatus);
  server.begin();
  Serial.println("Web Portal HTTP Server started.");

  // Ready! Turn LED Solid Blue
  setStatusLED(0, 0, 30);
  Serial.println("Setup complete. SmartPuck is ready.");
}

// ============================================================================
// MAIN LOOP (Runs on Core 0)
// ============================================================================
void handleUsbCommand(String command) {
  command.trim();
  if (!command.startsWith("@SPK ")) return;
  command.remove(0, 5);

  if (command == "STATUS") {
    Serial.println("@SPK STATUS " + buildStatusJson());
  } else if (command == "SESSIONS") {
    Serial.println("@SPK SESSIONS " + buildSessionsJson());
  } else if (command == "START") {
    startRecording();
    Serial.println("@SPK STATUS " + buildStatusJson());
  } else if (command == "STOP") {
    stopRecording();
    Serial.println("@SPK STATUS " + buildStatusJson());
  } else if (command.startsWith("DOWNLOAD ")) {
    sendUsbFile(command.substring(9));
  } else if (command.startsWith("UPLOADED ")) {
    const String sessionPath = command.substring(9);
    Serial.println(markSessionUploaded(sessionPath) ? "@SPK OK" : "@SPK ERROR Could not mark session uploaded");
  } else if (command.startsWith("DELETE ")) {
    const String sessionPath = command.substring(7);
    Serial.println(removeSessionRecursive(sessionPath) ? "@SPK OK" : "@SPK ERROR Could not delete session");
  } else {
    Serial.println("@SPK ERROR Unknown command");
  }
}

void sendUsbFile(String audioPath) {
  audioPath.trim();
  if (!isSafeAudioPath(audioPath)) {
    Serial.println("@SPK ERROR Unsafe audio path");
    return;
  }
  if (xSemaphoreTake(fileMutex, pdMS_TO_TICKS(2000)) != pdTRUE) {
    Serial.println("@SPK ERROR Storage is busy");
    return;
  }
  File file = SD_DEVICE.open(audioPath, FILE_READ);
  if (!file) {
    xSemaphoreGive(fileMutex);
    Serial.println("@SPK ERROR Audio file not found");
    return;
  }
  const size_t size = file.size();
  Serial.printf("@SPK FILE %u\n", (unsigned int)size);
  uint8_t buffer[1024];
  while (file.available()) {
    const size_t readBytes = file.read(buffer, sizeof(buffer));
    if (readBytes == 0) break;
    Serial.write(buffer, readBytes);
  }
  Serial.flush();
  file.close();
  xSemaphoreGive(fileMutex);
}

void checkUsbTransport() {
  while (Serial.available() > 0) {
    const char next = (char)Serial.read();
    if (next == '\r') continue;
    if (next == '\n') {
      handleUsbCommand(usbCommandBuffer);
      usbCommandBuffer = "";
    } else if (usbCommandBuffer.length() < 256) {
      usbCommandBuffer += next;
    } else {
      usbCommandBuffer = "";
    }
  }
}

void loop() {
  // USB-C is the preferred wired control/transfer transport. Commands are
  // explicitly framed so ordinary debug output remains safe to ignore.
  checkUsbTransport();

  // 1. WiFi/Web Server client handling (even while recording!)
  if (wifiConnected) {
    server.handleClient();
  }

  // 2. Hardware Button Polling
  checkButton();

  // 3. Restart after Wi-Fi config changes, once the HTTP response has flushed.
  if (restartAtMs > 0 && millis() > restartAtMs) {
    Serial.println("[WiFi] Restarting to apply saved Wi-Fi credentials...");
    delay(100);
    ESP.restart();
  }

  // 4. While in fallback AP mode, keep trying saved/firmware Wi-Fi until one connects.
  static uint32_t lastWifiRetry = 0;
  if (apModeActive && millis() - lastWifiRetry > 60000) {
    lastWifiRetry = millis();
    Serial.println("[WiFi] Retrying saved networks from AP fallback mode...");
    if (tryConfiguredWiFiNetworks()) {
      Serial.println("[WiFi] Reconnected from AP fallback mode.");
    }
  }

  // 5. Status LED updates
  updateLED();

  // 6. Print status/IP address every 10 seconds
  static uint32_t lastStatusPrint = 0;
  if (millis() - lastStatusPrint > 10000) {
    lastStatusPrint = millis();
    if (apModeActive) {
      Serial.print("[SmartPuck] Dashboard active at local AP: http://");
      Serial.println(WiFi.softAPIP());
    } else if (wifiConnected) {
      Serial.print("[SmartPuck] Dashboard active at: http://");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("[SmartPuck] Running offline.");
    }
  }

  static uint32_t lastConvexHeartbeat = 0;
  if (!apModeActive && WiFi.status() == WL_CONNECTED && millis() - lastConvexHeartbeat > 60000) {
    lastConvexHeartbeat = millis();
    sendConvexHeartbeat("Heartbeat");
  }

  delay(10); // Small yield to prevent CPU starvation on Core 0
}
