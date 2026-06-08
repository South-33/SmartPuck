# SmartPuck Firmware Setup & Wiring Guide

This directory contains the Arduino-compatible C++ firmware for the **SmartPuck Offline Audio Recorder** MVP. The firmware supports audio capture using an I2S MEMS microphone (INMP441) and stores high-quality 16kHz 16-bit Mono WAV audio chunks onto a FAT32-formatted microSD card.

---

## 1. Wiring Guide

Ensure you use a **3.3V** power connection for the INMP441 microphone module. **Do not connect the microphone to 5V**, as this will destroy the MEMS sensor.

### Option A: LOLIN S3 Pro V1.0.0 (Recommended)
The LOLIN S3 Pro has an onboard microSD (TF) slot and battery charger, which keeps wiring simple.

| INMP441 Pin | LOLIN S3 Pro Pin | Description |
| :--- | :--- | :--- |
| **VDD** | `3V3` | Power Supply |
| **GND** | `GND` | Ground |
| **L/R** | `GND` | Channel Select (GND = Left Channel) |
| **SCK** | `GPIO 4` | I2S Bit Clock (BCLK) |
| **WS** | `GPIO 5` | I2S Word Select (LRCLK) |
| **SD** | `GPIO 6` | I2S Serial Data Out (SD) |

*   **Record Button:** The onboard `Boot` button (marked **0** on the PCB, next to the card slot) is used to start and stop recordings. No external button or wiring is needed!
*   **Status LED:** The onboard RGB Neopixel LED (GPIO 38, near the EN/0 buttons) is used for status feedback. No external LED or wiring is needed!
    *   **Solid Blue:** Ready / Idle
    *   **Blinking Red:** Recording Active
    *   **Flashing Red:** microSD Card Mount Error
    *   **Flashing Yellow:** Microphone Connection Error

---

### Option B: AI-Thinker ESP32-CAM (Pin-Constrained)
The ESP32-CAM uses the standard SD Card slot in **1-bit SD_MMC mode** to free up GPIO pins for the microphone.

| INMP441 Pin | ESP32-CAM Pin | Description |
| :--- | :--- | :--- |
| **VDD** | `3.3V` | Power Supply |
| **GND** | `GND` | Ground |
| **L/R** | `GND` | Channel Select (GND = Left Channel) |
| **SCK** | `GPIO 12` | I2S Bit Clock (BCLK) |
| **WS** | `GPIO 13` | I2S Word Select (LRCLK) |
| **SD** | `GPIO 3 (RX0)` | I2S Serial Data Out (SD) |

> [!WARNING]
> Because `GPIO 3` is the RXD pin used for programming the ESP32-CAM, you **must disconnect your FTDI serial programmer / USB adapter** after uploading the sketch before the microphone's audio recording will function correctly.

*   **Record Button:** Connect a momentary push button between `GPIO 16` and `GND`.
*   **Status LED:** The ESP32-CAM uses its onboard red LED (connected to `GPIO 33`, active-low) for status.

---

## 2. Software & Upload Steps (Arduino IDE)

1.  **Download Arduino IDE:** Download and install the [Arduino IDE](https://www.arduino.cc/en/software).
2.  **Add ESP32 Boards Support:**
    *   Open Arduino IDE.
    *   Go to **File** -> **Preferences**.
    *   Paste the following URL into the **Additional Boards Manager URLs** field:
        `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_dev_index.json`
    *   Click **OK**.
3.  **Install ESP32 Package:**
    *   Go to **Tools** -> **Board** -> **Boards Manager**.
    *   Search for **esp32** by Espressif Systems.
    *   Click **Install** (use the latest stable version).
4.  **Select Your Board:**
    *   For **LOLIN S3 Pro**: Go to **Tools** -> **Board** -> **ESP32S3 Dev Module** or **WEMOS LOLIN S3 PRO**. Ensure **PSRAM** is enabled in the Tools menu.
    *   For **ESP32-CAM**: Go to **Tools** -> **Board** -> **AI Thinker ESP32-CAM**.
5.  **Configure Board Select in Code:**
    *   Open [SmartPuckFirmware.ino](file:///d:/Project/SmartPuck/Firmware/SmartPuckFirmware/SmartPuckFirmware.ino).
    *   Uncomment `#define BOARD_LOLIN_S3_PRO` if using the LOLIN S3 Pro.
    *   Uncomment `#define BOARD_ESP32_CAM` if using the ESP32-CAM.
6.  **Upload:**
    *   Connect your board to your computer via USB-C (LOLIN S3 Pro) or via an FTDI adapter (ESP32-CAM).
    *   Select the correct COM Port under **Tools** -> **Port**.
    *   Click the **Upload** arrow button in the top left.

---

## 3. Recording Audio

1.  Insert a **FAT32-formatted microSD card** into the board's slot.
2.  Power the board via USB or LiPo battery.
3.  **To Start Recording:** Press the button once.
    *   The LED will turn **ON** (blinking on ESP32-CAM / solid on LOLIN S3 Pro).
    *   A directory `/sessions/session_XXX/` will be created on the SD card containing a `manifest.json` and a raw audio file `audio_000.wav`.
4.  **To Stop Recording:** Press the button again.
    *   The LED will turn **OFF**.
    *   The firmware will finalize the WAV header and close the file.

---

## 4. Uploading and Transcribing (Web Companion App)

Once you have recorded a session, here is how to load it into the companion application:

1.  **Remove the microSD card** from the SmartPuck and insert it into your computer's card reader (or connect the device via USB if using mass-storage emulator).
2.  **Start the Local Webapp:**
    *   Open a terminal in the `Webapp` directory.
    *   Run `pnpm install` if you haven't already.
    *   Run `pnpm dev` in one terminal, and `pnpm convex:dev` in another terminal (to launch the local database and functions).
    *   Open `http://localhost:3000` in your browser.
3.  **Connect and Import:**
    *   Click **New Recording** in the sidebar.
    *   Select **Upload Recording File**.
    *   Select the folder or files from your microSD card (specifically `/sessions/session_XXX/audio_000.wav`).
    *   The web application will import the metadata, create the session card, and allow you to interact with the simulated workspace helper.
