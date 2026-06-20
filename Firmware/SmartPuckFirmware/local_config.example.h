#pragma once

// Copy this file to local_config.h and fill these values locally.
// local_config.h is gitignored because SMARTPUCK_DEVICE_TOKEN is a shared secret.

#define CONVEX_SITE_URL "https://your-convex-deployment.convex.site"
#define SMARTPUCK_DEVICE_TOKEN "replace-with-convex-device-token"

// Optional: add local Wi-Fi networks here, not in the tracked sketch.
// Example:
// #define SMARTPUCK_WIFI_NETWORKS \
//   {"Studio WiFi", "wifi-password"}, \
//   {"Phone Hotspot", "hotspot-password"}

// Optional: lower this if a specific card is unstable, raise only after testing.
// #define SMARTPUCK_SD_SPI_FREQUENCY 20000000U
