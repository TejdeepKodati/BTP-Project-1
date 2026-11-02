# Hardware Theory, Schematics & Technical Blueprint
## OpenBikeSensor (OBS) Implementation for CycleSafe Project

**Author / Investigator:** Tej Deep  
**Supervisor:** Prof. Debasree Das  
**Project:** CycleSafe — Microscopic Traffic Simulation & Instrumented Bicycle Telemetry  
**Target Hardware Platform:** ESP32-WROOM-32 / OpenBikeSensor Architecture  
**Target Location / Delivery:** IIT (ISM) Dhanbad, Jharkhand (PIN: 826004)

---

## 1. System Architecture Overview

The CycleSafe hardware module is an instrumented on-bike telemetry probe based on the open-source **OpenBikeSensor (OBS)** standard, enhanced with a 6-axis Inertial Measurement Unit (IMU). The system executes five concurrent functions:
1. **Dual Ultrasonic Distance Scanning:** Continuous acoustic lateral distance measurement on the left (motor vehicle overtakes) and right (curb / parked car door-zone).
2. **Kinematic & Roll Sensing:** 6-axis IMU polling for cyclist pace, acceleration, braking events, and frame tilt compensation.
3. **Geospatial Logging:** Real-time GPS coordinate, ground speed, and UTC timestamp acquisition.
4. **Local Data Persistence:** Continuous high-speed writing of timestamped telemetry to a FAT32 MicroSD card.
5. **Rider Interface & Connectivity:** Live clearance display on an on-handlebar 0.96″ OLED display, manual event button, and Wi-Fi / BLE connectivity.

```
+---------------------------------------------------------------------------------------------------+
|                                       CYCLESAFE HARDWARE UNIT                                     |
|                                                                                                   |
|  +--------------------+         +---------------------------------------+         +------------+  |
|  | JSN-SR04T (Left)   |-------->| Trig: GPIO 13 | Echo: GPIO 14         |         | u-blox     |  |
|  | Ultrasonic Sensor  |         |                                       |         | NEO-6M GPS |  |
|  +--------------------+         |                                       |<------->| UART2      |  |
|                                 |           ESP32 DEVKIT V1             |         | TX2: GPIO17|  |
|  +--------------------+         |           (30-Pin Dual Core           |         | RX2: GPIO16|  |
|  | JSN-SR04T (Right)  |-------->| Trig: GPIO 27 | Echo: GPIO 26         |         +------------+  |
|  | Ultrasonic Sensor  |         |            240 MHz MCU)               |                         |
|  +--------------------+         |                                       |         +------------+  |
|                                 |                                       |         | 3.3V Native|  |
|  +--------------------+         | SPI: CS:D5, SCK:D18, MISO:D19, MOSI:D23|<------->| MicroSD    |  |
|  | 0.96" OLED Display |<------->|                                       |         | Card Board |  |
|  | (SSD1306, Addr 0x3C|         | I2C: SDA: GPIO 21, SCL: GPIO 22       |         +------------+  |
|  +--------------------+         |                                       |                         |
|                                 |                                       |         +------------+  |
|  +--------------------+         |                                       |         | Handlebar  |  |
|  | MPU-6050 6-Axis IMU|<------->| (Shared multi-drop I2C Bus)           |<--------| Event Push |  |
|  | (Accel/Gyro, 0x68) |         |                                       |         | Button(D34)|  |
|  +--------------------+         +---------------------------------------+         +------------+  |
|                                                     ^                                             |
|                                                     | 3.3V Rail (Clean Low-Noise @ 600mA)         |
|  +------------------+         +---------------------+-------------------+                         |
|  | 3.7V 18650 Li-ion|-------->| TP4056 Charger + Protection -> 3.3V LDO |                         |
|  | Battery (2600mAh)|         | (AP2112K-3.3 / AMS1117-3.3 Module)      |                         |
|  +------------------+         +-----------------------------------------+                         |
+---------------------------------------------------------------------------------------------------+
```

---

## 2. ESP32 30-Pin Pinout & Interface Mapping

The ESP32 DEVKIT V1 (30-pin model) provides 15 pins on each header. The exact pin assignment below avoids boot-strap pin conflicts (GPIO 0, GPIO 2, GPIO 12, GPIO 15) and ADC2 pins (which conflict with Wi-Fi):

| ESP32 Pin | Function / Net Name | Connected Peripheral & Pin | Protocol / Signal Description |
| :---: | :---: | :--- | :--- |
| **3V3** | Power (+3.3V) | VCC of MicroSD, OLED, MPU-6050, GPS, Sensor Boards | Main regulated 3.3V DC power rail |
| **GND** | Ground (0V) | Common Ground for all components and battery | Common system ground |
| **GPIO 13** | `US_LEFT_TRIG` | JSN-SR04T Left Board — `TRIG` Pin | 10 µs trigger pulse output |
| **GPIO 14** | `US_LEFT_ECHO` | JSN-SR04T Left Board — `ECHO` Pin | Echo pulse input (pulse width = travel time) |
| **GPIO 27** | `US_RIGHT_TRIG` | JSN-SR04T Right Board — `TRIG` Pin | 10 µs trigger pulse output |
| **GPIO 26** | `US_RIGHT_ECHO` | JSN-SR04T Right Board — `ECHO` Pin | Echo pulse input (pulse width = travel time) |
| **GPIO 21** | `I2C_SDA` | OLED Display `SDA` + MPU-6050 `SDA` | I2C Serial Data line (shared multi-drop bus) |
| **GPIO 22** | `I2C_SCL` | OLED Display `SCL` + MPU-6050 `SCL` | I2C Serial Clock line (shared multi-drop bus) |
| **GPIO 16** | `UART2_RX` | u-blox NEO-6M GPS — `TX` Pin | Hardware Serial 2 Receive (NMEA data stream) |
| **GPIO 17** | `UART2_TX` | u-blox NEO-6M GPS — `RX` Pin | Hardware Serial 2 Transmit (configuration commands) |
| **GPIO 5** | `SPI_CS` | MicroSD Breakout — `CS` Pin | SPI Chip Select line |
| **GPIO 18** | `SPI_SCK` | MicroSD Breakout — `SCK` / `CLK` Pin | SPI Serial Clock line |
| **GPIO 19** | `SPI_MISO` | MicroSD Breakout — `MISO` / `DAT0` Pin | SPI Master-In Slave-Out data line |
| **GPIO 23** | `SPI_MOSI` | MicroSD Breakout — `MOSI` / `CMD` Pin | SPI Master-Out Slave-In data line |
| **GPIO 34** | `BUTTON_EVENT` | 12 mm Waterproof Push Button (Handlebar) | Active-low input with 10 kΩ pull-up to 3.3V |
| **GPIO 35** | `BATT_MONITOR` | Battery Voltage Divider (100 kΩ / 100 kΩ) | ADC1 input for battery level percentage monitoring |

---

## 3. Sensor Working Principles & Engineering Theory

### A. Ultrasonic Time-of-Flight Distance Measurement
* **Acoustic Wave Propagation:** The ultrasonic transmitter emits an acoustic burst at $40\text{ kHz}$. The sound wave travels through air, strikes the passing vehicle body, and reflects back to the transducer receiver.
* **Governing Equation:**
  $$d = \frac{v_{\text{sound}} \times \Delta t}{2}$$
  Where:
  - $\Delta t$ = measured duration of the High state on the Echo pin.
  - $v_{\text{sound}}$ = speed of sound in air, temperature-compensated by:
    $$v_{\text{sound}} \approx 331.3 + 0.606 \times T_{\text{celsius}}\;(\text{m/s})$$
    *(At $25^\circ\text{C}$, $v_{\text{sound}} \approx 346.5\text{ m/s}$)*.
* **Why the JSN-SR04T V3.0 is Chosen:**
  1. **Sealed Waterproof Transducer:** Standard open-mesh sensors (HC-SR04) fail rapidly outdoors from humidity, road dust, and rain. The JSN-SR04T uses an IP67 sealed piezoelectric transducer.
  2. **Decoupled Electronics:** The sensitive analog driver board is housed inside the protected central case, while only the sealed probe is exposed on the outside via a 2.5 m shielded coaxial cable.
  3. **Multi-Mode Support:** Version 3.0 supports standard GPIO trigger/echo, low-power polling, and automatic UART serial output.

---

### B. 6-Axis Inertial Measurement Unit (MPU-6050 / GY-521)
During project review, Prof. Debasree Das recommended adding an accelerometer to track cycling pace, braking, and stability.

#### 1. Hardware Integration via Shared $I^2C$ Bus
* Both the 0.96″ SSD1306 OLED display and the MPU-6050 operate over $I^2C$.
* Because $I^2C$ uses hardware device addresses, both peripherals connect to the **identical two pins** (`GPIO 21` SDA, `GPIO 22` SCL) without conflict:
  - **OLED Display Address:** `0x3C`
  - **MPU-6050 Address:** `0x68` (with `AD0` pin pulled to GND)
* **Zero extra microcontroller pins** are required.

#### 2. Dynamic Frame Roll Angle & Tilt Compensation
When a cyclist corners or pedals vigorously, the bicycle frame tilts by angle $\phi$ (typically $10^\circ - 18^\circ$). A fixed ultrasonic sensor tilted downward will reflect off the road surface (~$1.1\text{ m}$ away), creating a **false-positive close pass**.

The MPU-6050 solves this by computing the instantaneous roll angle $\phi$:
$$\phi = \arctan\left(\frac{a_y}{\sqrt{a_x^2 + a_z^2}}\right)$$
The firmware then applies dynamic trigonometric correction:
$$d_{\text{true}} = d_{\text{measured}} \times \cos(\phi)$$
Furthermore, if $|\phi| > 18^\circ$ (sharp turn or extreme lean), the reading is flagged as a turning maneuver rather than a vehicular overtake, completely eliminating road-reflection false alarms.

#### 3. Kinematic Braking & Road Quality Detection
* **Panic Braking Event:** If forward deceleration exceeds $-2.5\text{ m/s}^2$ ($a_x < -2.5\text{ m/s}^2$), a `hard_braking` interaction event is automatically logged.
* **Surface Roughness:** Root-Mean-Square (RMS) vertical acceleration ($a_z$) profiles road roughness (smooth asphalt vs. cobblestones vs. potholes), aligning with the TU Berlin SimRa crowdsourcing methodology.

---

### C. u-blox NEO-6M GPS Engine
* **Receiver Architecture:** 50-channel u-blox 6 positioning engine with sensitivity of $-161\text{ dBm}$.
* **Data Protocol:** Outputs standard NMEA-0183 sentences via UART at 9600 baud:
  - `$GPRMC`: Recommended Minimum Specific GPS Data (latitude, longitude, speed over ground, date/time).
  - `$GPGGA`: Global Positioning System Fix Data (3D fix status, number of tracked satellites, altitude).
* **Backup Battery & EEPROM:** Onboard coin battery powers RTC and SRAM, reducing warm-start satellite lock time to under 1 second.

---

## 4. Power Delivery & 3.3V Voltage Regulation Architecture

### The Crucial MicroSD 3.3V vs. 5V Engineering Solution

During review, Prof. Das shared: *"From my real experience that when you are actually integrating and you are testing with the power, it has gone down. The ESP32. So we have to be very specific about the voltage regulator."*

Here is the exact engineering explanation and the solution:

#### The Failure Modes of 5V Arduino SD Modules on ESP32:
1. **The Dropout Trap:** Cheap Arduino SD modules feature an onboard AMS1117-3.3 linear regulator. The AMS1117 requires a minimum dropout voltage of $1.1\text{ V} - 1.3\text{ V}$. If fed from the ESP32's 3.3V rail, its output drops to:
   $$V_{\text{out}} = 3.3\text{ V} - 1.1\text{ V} \approx 2.2\text{ V}$$
   Flash memory cards require $2.7\text{ V} - 3.6\text{ V}$ to operate reliably. At $2.2\text{ V}$, write operations fail, resulting in SD initialization errors or silent filesystem corruption.
2. **The 5V Backfeed Destruction:** If the module is instead powered from 5V (from USB or battery boost), its onboard level shifters or pull-up resistors pull the SPI lines (`CS`, `CLK`, `MOSI`, `MISO`) up to 5V. When connected to the ESP32 (which is **strictly 3.3V logic and NOT 5V tolerant**), overvoltage enters the ESP32 silicon, degrading or burning out the GPIO pins or the entire SoC.

#### The Engineered Solution Implemented:
* **Procure a Pure 3.3V Native MicroSD Breakout:** Contains **NO onboard 5V regulator and NO level shifter chip**; only clean $10\,\mu\text{F}$ and $0.1\,\mu\text{F}$ bypass capacitors and $10\,\text{k}\Omega$ pull-up resistors tied exclusively to the clean 3.3V rail.
* **Dedicated High-Current LDO Regulator:** An **AP2112K-3.3** (or AMS1117-3.3 module) capable of delivering $600\text{ mA}$ continuous output. MicroSD cards draw transient current bursts of $100\text{ mA} - 150\text{ mA}$ during block writes. The dedicated 600 mA LDO absorbs these spikes without causing voltage dips on the ESP32 core rail, completely preventing brownout resets.

---

## 5. Wiring Schematic & Connection Table

```
   +-----------------------------------------------------------------------+
   |                             POWER WIRING                              |
   |                                                                       |
   |   [18650 Li-ion Cell]                                                 |
   |         (+) ----------------> B+ [TP4056 Type-C Protection Board]     |
   |         (-) ----------------> B-                                      |
   |                                                                       |
   |   [TP4056 Board]                                                      |
   |         OUT+ (3.7V - 4.2V) -> IN+ [AMS1117 / AP2112K 3.3V LDO Module] |
   |         OUT- (GND) ---------> IN- (GND)                               |
   |                                                                       |
   |   [3.3V LDO Module]                                                   |
   |         VOUT (Clean 3.3V) --> Common 3.3V Rail (ESP32 3V3, SD, OLED)  |
   |         GND (0V) -----------> Common System Ground (All Devices)      |
   +-----------------------------------------------------------------------+

   +-----------------------------------------------------------------------+
   |                         SIGNAL INTERCONNECTS                          |
   |                                                                       |
   | ESP32 GPIO 13 --------------> TRIG [Left JSN-SR04T Sensor Board]      |
   | ESP32 GPIO 14 <-------------- ECHO [Left JSN-SR04T Sensor Board]      |
   |                                                                       |
   | ESP32 GPIO 27 --------------> TRIG [Right JSN-SR04T Sensor Board]     |
   | ESP32 GPIO 26 <-------------- ECHO [Right JSN-SR04T Sensor Board]     |
   |                                                                       |
   | ESP32 GPIO 21 (SDA) --------> SDA [0.96" OLED] & SDA [MPU-6050 IMU]   |
   | ESP32 GPIO 22 (SCL) --------> SCL [0.96" OLED] & SCL [MPU-6050 IMU]   |
   |                                                                       |
   | ESP32 GPIO 16 (RX2) <-------- TXD [u-blox NEO-6M GPS Module]          |
   | ESP32 GPIO 17 (TX2) --------> RXD [u-blox NEO-6M GPS Module]          |
   |                                                                       |
   | ESP32 GPIO 5  --------------> CS   [3.3V MicroSD Card Board]          |
   | ESP32 GPIO 18 --------------> SCK  [3.3V MicroSD Card Board]          |
   | ESP32 GPIO 19 <-------------- MISO [3.3V MicroSD Card Board]          |
   | ESP32 GPIO 23 --------------> MOSI [3.3V MicroSD Card Board]          |
   |                                                                       |
   | ESP32 GPIO 34 <-------------- One Lead of Push Button (Other to GND)  |
   +-----------------------------------------------------------------------+
```

---

## 6. Verification & Delivery to Dhanbad (PIN: 826004)

All components listed have been verified to ship directly to **Dhanbad, Jharkhand (PIN: 826004)**:
* **Robu.in:** Dispatches from Pune via Blue Dart / Delhivery Express. Verified transit time to Dhanbad: **3 to 4 business days**.
* **QuartzComponents.com:** Dispatches from Jaipur via Shiprocket / Delhivery to 826004.
* **Amazon.in:** Standard delivery to IIT (ISM) Dhanbad campus.
* **LionCircuits.com:** PCB fabrication facility in Bangalore; delivers custom PCBs via Blue Dart courier directly to Dhanbad.
