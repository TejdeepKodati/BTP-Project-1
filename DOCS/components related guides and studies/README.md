# Component Datasheets, Engineering Guides & Technical Studies

This directory contains the authentic manufacturer datasheets, hardware integration manuals, and electrical specifications for all hardware components comprising the **CycleSafe / OpenBikeSensor (OBS)** instrumented bicycle telemetry unit.

These documents serve as formal technical references and empirical evidence for circuit design, power distribution calculations, sensor calibration, and viva evaluation at the **Department of Computer Science and Engineering, IIT (ISM) Dhanbad**.

---

## Technical Datasheet Reference Index

| File Name | Component & Description | Manufacturer / Standard | Key Technical Parameters |
| :--- | :--- | :--- | :--- |
| [`ESP32_WROOM32_Microcontroller_Datasheet.pdf`](ESP32_WROOM32_Microcontroller_Datasheet.pdf) | **ESP32 DEVKIT V1 30-Pin** (Dual-Core Xtensa LX6 @ 240 MHz) | Espressif Systems | 3.3V Logic, 520 KB SRAM, Integrated 802.11 b/g/n Wi-Fi & BLE v4.2 BR/EDR, Hardware I2C / SPI / UART peripherals. |
| [`JSN-SR04T_Waterproof_Ultrasonic_Sensor_Datasheet.pdf`](JSN-SR04T_Waterproof_Ultrasonic_Sensor_Datasheet.pdf) | **JSN-SR04T V3.0 Transducer** (Waterproof Distance Sensor) | Sunfounder / JSN | Operating Voltage: 3.0V–5.5V DC, Working Current: 30 mA, Acoustic Frequency: 40 kHz, Blind Zone: 20 cm, Max Range: 450 cm, Resolving Capability: 1 mm. |
| [`ublox_NEO-6M_GPS_Receiver_Datasheet.pdf`](ublox_NEO-6M_GPS_Receiver_Datasheet.pdf) | **u-blox NEO-6M GPS Module** (with Ceramic Patch Antenna) | u-blox AG (Switzerland) | 50-Channel u-blox 6 positioning engine, TTFF: Cold start 27s / Hot start 1s, Sensitivity: -161 dBm tracking, UART NMEA-0183 @ 9600 baud, 3.3V Logic. |
| [`MPU-6050_6Axis_Accelerometer_Gyroscope_Datasheet.pdf`](MPU-6050_6Axis_Accelerometer_Gyroscope_Datasheet.pdf) | **MPU-6050 6-Axis MotionTracking** (Accelerometer + Gyroscope) | InvenSense (TDK) | 3-Axis Gyro ($\pm 250, \pm 500, \pm 1000, \pm 2000^\circ/\text{s}$), 3-Axis Accel ($\pm 2g, \pm 4g, \pm 8g, \pm 16g$), Digital Motion Processor (DMP), I2C address `0x68`, Operating: 2.375V–3.46V (onboard 3.3V LDO for 5V input). |
| [`SSD1306_OLED_Display_Controller_Datasheet.pdf`](SSD1306_OLED_Display_Controller_Datasheet.pdf) | **0.96" 128x64 OLED Display** (Monochrome Blue Screen) | Solomon Systech | Resolution: 128x64 pixels, I2C address `0x3C`, Operating Voltage: 3.3V–5V, Built-in DC-DC charge pump, Operating Current: ~15–20 mA at 100% pixel illumination. |
| [`MicroSD_Card_SPI_Hardware_Interface_Guide.pdf`](MicroSD_Card_SPI_Hardware_Interface_Guide.pdf) | **MicroSD SPI Breakout Board** (32GB Storage Interface) | Adafruit / SD Card Association | Standard 4-wire SPI (MOSI, MISO, SCK, CS), Sector Size: 512 Bytes, Operating Voltage: 2.7V–3.6V (strict 3.3V VCC to avoid Flash corruption), FAT32 file system compatibility. |
| [`TP4056_LiIon_Battery_Charging_Protection_Datasheet.pdf`](TP4056_LiIon_Battery_Charging_Protection_Datasheet.pdf) | **TP4056 1A Li-Ion Charger** (with DW01A + FS8205A Protection) | NanJing Top Power ASIC Corp | CC/CV charging profile, Programmable charge current up to 1000 mA via $R_{\text{PROG}}$, Float voltage: $4.2\text{V} \pm 1\%$, Over-discharge cut-off: 2.4V, Over-current limit: 3A. |
| [`AMS1117-3.3V_Voltage_Regulator_Datasheet.pdf`](AMS1117-3.3V_Voltage_Regulator_Datasheet.pdf) | **AMS1117-3.3 Low-Dropout Regulator** (Voltage Stabilization) | Advanced Monolithic Systems | Fixed 3.3V output, Output current: 1.0A max, Dropout voltage: 1.1V at 1A, Built-in thermal overload and short-circuit current limiting, Ripple rejection: 60 dB. |
| [`18650_LiIon_Cell_Specification_Datasheet.pdf`](18650_LiIon_Cell_Specification_Datasheet.pdf) | **18650 Rechargeable Li-Ion Cell** (High Drain 2500mAh/2600mAh) | Samsung SDI / BAK Battery | Nominal Voltage: 3.7V, Nominal Capacity: 2500 mAh (9.25 Wh), Charging Cut-off: 4.20V, Discharge Cut-off: 2.50V, Max Continuous Discharge: 20A (5C), Chemistry: NMC. |

---

## Engineering Design Justifications from Datasheets

### 1. I2C Bus Multiplexing (OLED + MPU-6050)
According to the **Solomon Systech SSD1306** and **InvenSense MPU-6050** datasheets:
- SSD1306 defaults to 7-bit slave address `0b0111100` (`0x3C`).
- MPU-6050 defaults to 7-bit slave address `0b1101000` (`0x68`) when pin `AD0` is tied low.
Because these addresses are distinct on the multi-drop open-drain $I^2C$ bus, both devices share `GPIO 21 (SDA)` and `GPIO 22 (SCL)` without bus arbitration conflict or GPIO pin shortage.

### 2. 3.3V Power Rail Brownout Prevention
The **Espressif ESP32** datasheet specifies peak transient current draws of up to **240 mA** during Wi-Fi beacon transmission and RF calibration bursts. Simultaneously, write cycles on the **MicroSD Card** draw transient spikes up to **100 mA**. 
Using the **AMS1117-3.3** dedicated step-down regulator module from the single 18650 3.7V cell isolates the sensor and memory SPI bus from the ESP32 RF transients, preventing MicroSD file system corruptions and brownout resets (`Brownout detector was triggered`).

### 3. Dynamic Roll-Angle Tilt Compensation Formula
Using the accelerometer registers (ACCEL_XOUT, ACCEL_YOUT, ACCEL_ZOUT) documented in the **MPU-6050 Product Specification**:
$$\phi = \arctan\left(\frac{a_y}{\sqrt{a_x^2 + a_z^2}}\right)$$
The lateral distance measured by the acoustic beam of the **JSN-SR04T** is compensated to true perpendicular road clearance via:
$$d_{\text{true}} = d_{\text{measured}} \cdot \cos(\phi)$$
eliminating false positives caused by the cyclist leaning into corners or pedaling sway.
