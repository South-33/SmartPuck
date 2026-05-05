# SmartPuck Hardware Guide

SmartPuck is currently an audio-first offline meeting/lecture recorder. The MVP does not use a camera. The hardware goal is reliable local audio capture to microSD, battery-powered operation, and simple USB/webapp import.

## Current Decision

Buy only the hard-to-find electronics from AliExpress:

| Part | Qty | Source | Variant / Search Target | Expected Cost | Status |
| --- | ---: | --- | --- | ---: | --- |
| LOLIN S3 Pro V1.0.0 | 1 | AliExpress, LOLIN Official Store | `S3 Pro V1.0.0 - LOLIN WIFI BLE IOT Board based ESP32-S3 16MB FLASH 8MB PSRAM` | USD 13.23, free shipping | Buy |
| INMP441 I2S MEMS microphone module | 2 | AliExpress, listing in cart from `Shop1105406148 Store` | `1-20PCS MH-ET LIVE INMP441 I2S Digital Microphone Module`, variant `1PCS`, quantity 2 | USD 1.53 each + USD 1.68 shipping, USD 4.74 total | Buy |

Buy common/simple parts locally:

| Part | Qty | Local Search / Store Request | Notes |
| --- | ---: | --- | --- |
| 3.7V LiPo battery | 1 | `3.7V LiPo 1500-3000mAh JST PH 2.0 2-pin protected` | Battery safety and connector correctness matter more than lowest price. |
| microSD card | 1 | `SanDisk/Samsung 32GB Class 10 or U1 microSD` | Buy locally to avoid fake cards. Format as FAT32. |
| Slide switch | 1-2 | `small SPDT slide switch` or `SS12D00 mini slide switch` | Optional for first USB prototype, useful for battery power. |
| Momentary push button | 1-2 | `6x6 tactile push button`, 5mm height is fine | Used for record/start/stop. |
| LED | 1-3 | `3mm or 5mm LED`, red/green preferred | 3mm fits an enclosure better; 5mm is fine for bench testing. |
| LED resistor | 1-3 | `220 ohm`, `330 ohm`, or `1k ohm` | Existing 4.7k resistors work for dim LED testing. |
| Jumper wires / headers | as needed | Already available | Use for prototype wiring. |
| Enclosure material | 1 | 3D print, small round plastic box, or prototype case | Final enclosure should prioritize mic holes and battery placement. |

## Do Not Buy For MVP

| Part | Reason |
| --- | --- |
| ESP32-CAM | The MVP no longer needs camera capture. It adds complexity without improving audio reliability. |
| OV5640 camera | Cheap camera snapshots are unreliable for whiteboards/slides and should not be a core MVP promise. |
| Separate microSD SPI module | The LOLIN S3 Pro has an onboard microSD/TF slot. |
| TP4056 charger module | The LOLIN S3 Pro already has onboard battery charging. Do not double-charge the LiPo. |
| JST PH 1.0 / PH 1.25 / XH 2.54 / MX 2.0 batteries | These are not the expected LOLIN S3 Pro battery connector. |

## Main Board

Recommended board: **LOLIN S3 Pro V1.0.0**.

Why this board:

- ESP32-S3, suitable for I2S audio capture and SD writes.
- USB-C for programming and power.
- Onboard microSD/TF slot, so no external SD module is needed.
- Onboard battery connector and charger, reducing wiring and charger risk.
- 16MB flash and 8MB PSRAM, giving more room than minimal ESP32 boards.
- Official WEMOS/LOLIN documentation exists.

Official reference:

- WEMOS S3 Pro docs: https://docs.wemos.cc/en/latest/s3/s3_pro.html

Important checks:

- Listing must say **S3 Pro**, not plain S3.
- Variant should be **1pcs**.
- Seller should be **LOLIN Official Store** if possible.
- The board has a battery port with charging; do not add another charger module in series.

## Microphone

Recommended mic: **INMP441 I2S MEMS microphone module**.

Buy quantity: **2 modules**.

Why buy 2:

- We only need 1 working mic for the MVP.
- Cheap mic modules can vary in noise/quality.
- A spare prevents one bad module from blocking firmware work.

Required pin labels:

- `VDD`
- `GND`
- `SCK` or `BCLK`
- `WS` or `LRCLK`
- `SD` or `DOUT`
- `L/R`

Wiring concept:

| INMP441 Pin | Connects To | Notes |
| --- | --- | --- |
| `VDD` | LOLIN `3V` / `3.3V` | Do not power from 5V unless the module explicitly supports it. |
| `GND` | LOLIN `GND` | Common ground. |
| `SCK` | ESP32-S3 free GPIO | I2S bit clock. Confirm pin choice before soldering. |
| `WS` | ESP32-S3 free GPIO | I2S word select / LRCLK. Confirm pin choice before soldering. |
| `SD` | ESP32-S3 free GPIO | I2S data into ESP32. Confirm pin choice before soldering. |
| `L/R` | `GND` or `3.3V` | Selects left/right channel. Tie to GND for one channel; do not leave floating. |

Do not lock final GPIOs until firmware starts. The LOLIN S3 Pro onboard SD card uses its own pins, so choose I2S pins after checking the board pinout and avoiding boot/flash/SD conflicts.

## Battery

Target battery:

- Single-cell LiPo / Li-polymer
- 3.7V nominal
- 1500-3000mAh acceptable
- 2000mAh preferred
- Protected cell preferred
- Connector: **JST PH 2.0mm 2-pin**

Why local/trusted source is preferred:

- AliExpress battery listings repeatedly showed connector conflicts, such as title saying `PH2.0` while product images/specs said `2.54`.
- Wrong connector or reversed polarity can damage the board.
- Battery quality and shipping are higher-risk than passive parts.

Reject batteries that mention:

- `JST PH 1.0`
- `JST PH 1.25`
- `JST XH 2.54`
- `JST 2.54`
- `2P 2.54 socket`
- `MX 2.0`
- `7.4V`

Before plugging into the LOLIN board:

1. Confirm the connector physically fits without force.
2. Use a multimeter to verify polarity.
3. Red should be positive and black should be ground, but do not trust color alone.
4. Check the battery voltage is roughly 3.0V-4.2V.

Runtime expectation:

- A 2000mAh cell should be enough for useful meeting-length tests.
- Exact runtime depends on ESP32 clock, SD write behavior, Wi-Fi state, LED usage, and firmware sleep strategy.
- Measure real current draw once firmware records audio continuously.

## Storage

Use a branded **32GB microSD card**, Class 10 or U1.

Recommendation:

- SanDisk 32GB
- Samsung 32GB

Avoid generic no-name cards from marketplace listings. Fake cards and unstable cards can cause recording failures that look like firmware bugs.

Format:

- FAT32
- 32GB maximum is a conservative target for ESP32 SD libraries.

Suggested session layout:

```text
/sessions/YYYYMMDD_HHMMSS/
  manifest.json
  audio_000.wav
  audio_001.wav
  audio_002.wav
```

Start with WAV/PCM chunks instead of MP3. WAV is easier to implement and debug on ESP32, and storage is cheap enough for prototypes.

## Controls

Minimum controls:

- One momentary push button for record/start/stop.
- One status LED.

Optional:

- Slide switch for battery power.

Button wiring:

| Button Side | Connects To |
| --- | --- |
| Side A | ESP32-S3 GPIO |
| Side B | GND |

Firmware should use internal pull-up:

```cpp
pinMode(RECORD_BUTTON_PIN, INPUT_PULLUP);
```

This avoids needing an external pull-up resistor.

LED wiring:

```text
GPIO -> resistor -> LED anode
LED cathode -> GND
```

Preferred LED resistor:

- 220 ohm: bright
- 330 ohm: normal
- 1k ohm: dimmer, lower current
- 4.7k ohm: very dim but usable for testing

## Enclosure Notes

The enclosure should be designed around audio quality, not camera alignment.

Priorities:

- Small holes/opening near the mic port.
- Keep the mic away from internal rattling parts.
- Avoid blocking the INMP441 bottom sound port.
- Keep the battery secured so it cannot move.
- Make USB-C accessible.
- Make microSD accessible if frequent removal is expected.
- Keep the record button easy to press.
- Keep status LED visible.

Avoid:

- A sealed enclosure with no mic opening.
- Placing the mic directly against plastic.
- Loose battery movement.
- Camera hole or camera mount in the MVP enclosure.

## First Prototype Build Order

1. Power the LOLIN S3 Pro over USB-C.
2. Blink an onboard or external LED.
3. Initialize the microSD card and write a test file.
4. Read INMP441 samples over I2S and print levels over serial.
5. Write short WAV chunks to SD.
6. Add record/start/stop button.
7. Add battery power after USB prototype works.
8. Measure current draw and estimate runtime.
9. Only then design the enclosure.

## Known Open Decisions

- Final I2S GPIO pins are not chosen yet.
- Final battery supplier is not chosen yet.
- Final enclosure dimensions are not chosen yet.
- Audio format should start as WAV/PCM; compression can come later if needed.

