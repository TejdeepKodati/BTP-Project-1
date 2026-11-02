# Hardware Components & Procurement Specification
## CycleSafe / OpenBikeSensor (OBS) Implementation for Urban Cyclist Safety

**Project Name:** CycleSafe — Microscopic Traffic Simulation & Instrumented Bicycle Telemetry System  
**Prepared by:** Tej Deep (Student Investigator)  
**Project Guide / Supervisor:** Prof. Debasree Das  
**Date:** November 2, 2026  
**Primary Reference Standard:** OpenBikeSensor (OBS) Open Hardware Platform (`openbikesensor.org`)  
**Target Delivery Address:** Indian Institute of Technology (ISM) Dhanbad, Jharkhand (PIN: 826004)  
**Verification Status:** 100% Live Direct Product Pages Tested (Zero Broken / 404 Links)

---

## 1. Minimal Component Sourcing List (Verified Delivery to Dhanbad - PIN: 826004)

All components below have been verified on active domestic Indian platforms (**Amazon.in**, **QuartzComponents.com**, **TechDelivers.com**, **LionCircuits.com**, and **Think3D.in**). All suppliers deliver directly to **Dhanbad PIN 826004** via Blue Dart, Delhivery, DTDC, or India Post Speed Post.

| Component Name (Units) | Where to Buy (Direct Product Link - Delivers to Dhanbad PIN 826004) | Approximate Cost (INR) |
| :--- | :--- | :---: |
| **ESP32 DEVKIT V1 30-Pin Microcontroller (1 Unit)** | [Amazon.in ESP32 WROOM-32 30-Pin Product Page](https://www.amazon.in/dp/B0G6WRJV9Q) | ₹ 490 |
| **JSN-SR04T V3.0 Waterproof Ultrasonic Distance Sensors (2 Units)** | [QuartzComponents JSN-SR04T Waterproof Transducer](https://quartzcomponents.com/products/waterproof-ultrasonic-distance-transducer-sensor) | ₹ 590 |
| **u-blox NEO-6M GPS Module with Ceramic Antenna (1 Unit)** | [TechDelivers NEO-6MV2 GPS Module](https://techdelivers.com/GPS-NEO6MV2-module?tag=gps%2520module) | ₹ 246 |
| **0.96 inch I2C OLED Display Module SSD1306 (1 Unit)** | [Amazon.in SSD1306 128x64 OLED Display](https://www.amazon.in/dp/B0D4YSHXQB) | ₹ 289 |
| **MPU-6050 6-Axis Accelerometer & Gyroscope Module (1 Unit)** | [Amazon.in GY-521 MPU6050 3-Axis Gyro & Accelerometer](https://www.amazon.in/dp/B07HVYDKNZ) | ₹ 179 |
| **Mini MicroSD SPI Card Reader Module (1 Unit)** | [QuartzComponents Mini MicroSD SPI Card Reader Module](https://quartzcomponents.com/products/mini-micro-sd-card-reader-module) | ₹ 24 |
| **Geonix 32GB MicroSD Card Class 10 (1 Unit)** | [Amazon.in Geonix 32GB High Speed MicroSD Card](https://www.amazon.in/dp/B0GXKRKJKK) | ₹ 479 |
| **18650 Li-ion 2500mAh Rechargeable Battery (1 Unit)** | [QuartzComponents 18650 2500mAh Li-ion Battery](https://quartzcomponents.com/products/18650-li-ion-2500mah-rechargeable-battery) | ₹ 67 |
| **Single 18650 Cell Battery Holder with Wire Leads (1 Unit)** | [Amazon.in Single 18650 Battery Holder with Leads](https://www.amazon.in/dp/B0BB3DKLSW) | ₹ 45 |
| **TP4056 Type-C Li-ion Battery Charging Board with Protection (1 Unit)** | [Amazon.in TP4056 Type-C USB Charging Module](https://www.amazon.in/dp/B0GYDLWV94) | ₹ 39 |
| **AMS1117 3.3V Step-Down Power Supply Module (1 Unit)** | [QuartzComponents AMS1117 3.3V Power Supply Module](https://quartzcomponents.com/products/dc-dc-ams1117-3-3v-power-supply-module) | ₹ 18 |
| **12mm Waterproof Momentary Push Button Switch Handlebar Mount (1 Unit)** | [Amazon.in 12mm Waterproof Momentary Switch](https://www.amazon.in/dp/B07W4TYDXK) | ₹ 228 |
| **OpenBikeSensor Custom 2-Layer PCB Fabrication (Batch of 5 Boards)** | [LionCircuits Bangalore Domestic PCB Fab](https://www.lioncircuits.com/) | ₹ 450 |
| **3D Printed Weatherproof PETG Enclosure Fabrication (1 Unit)** | [Think3D India Rapid 3D Prototyping](https://www.think3d.in/) | ₹ 350 |
| **JST-XH 4-Pin Wiring Harnesses & Brass Standoffs (1 Set)** | Available in Department Lab | ₹ 0 |
| **Soldering Wire, Rosin Flux & Heat-Shrink Tubing (1 Set)** | Available in Department Lab | ₹ 0 |
| **Total Estimated Procurement Cost (INR)** | | **₹ 3,494** |

*(Note: The companion file `hardware_components_bom.csv` in `hardware/` contains this exact 3-column table ready to open in Microsoft Excel).*

---

## 2. Technical Documentation & Blueprint Directory

All supporting blueprints, theory, and fabrication guides have been compiled in `hardware/` and `DOCS/components related guides and studies/`:

1. **Schematics & Electrical Theory:**  
   [`hardware/HARDWARE_THEORY_AND_SCHEMATICS.md`](HARDWARE_THEORY_AND_SCHEMATICS.md)  
   *Covers the complete 30-pin ESP32 GPIO allocation table, shared I2C bus wiring diagram, ultrasonic ToF physics, MPU-6050 frame roll tilt compensation formulas, and the 3.3V voltage dropout engineering explanation.*
2. **Official Component Datasheets & Integration Guides:**  
   `DOCS/components related guides and studies/`  
   *Contains official manufacturer datasheets for all components: ESP32-WROOM-32, JSN-SR04T V3.0, u-blox NEO-6M, InvenSense MPU-6050, SSD1306 OLED, TP4056, AMS1117-3.3V, Samsung/BAK 18650, and MicroSD SPI bus specifications.*
3. **3D Printed Case & STL Sourcing Guide:**  
   [`hardware/3D_PRINTED_CASE_GUIDE.md`](3D_PRINTED_CASE_GUIDE.md)  
   *Direct links to download official OpenBikeSensor STL models, PETG slicer settings, and instructions for ordering on domestic 3D printing services.*
4. **Custom PCB Fabrication Guide:**  
   [`hardware/PCB_FABRICATION_GUIDE.md`](PCB_FABRICATION_GUIDE.md)  
   *KiCad GitHub source repository, 2-layer FR-4 board fabrication parameters, domestic ordering through LionCircuits Bangalore, and step-by-step soldering sequence.*
