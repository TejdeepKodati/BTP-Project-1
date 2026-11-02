# 3D Printed Weatherproof Enclosure Guide
## OpenBikeSensor (OBS) Case Fabrication & Sourcing for CycleSafe

**Investigator:** Tej Deep  
**Supervisor:** Prof. Debasree Das  
**Standard Architecture:** OpenBikeSensor 3D Printable Housing  
**Target Delivery:** IIT (ISM) Dhanbad, Jharkhand (PIN: 826004)  
**Local CAD Package:** [`hardware/OpenBikeSensor_3D_Print_STL_Package.zip`](OpenBikeSensor_3D_Print_STL_Package.zip)

---

## 1. Overview of Enclosure Components

The OpenBikeSensor mechanical design consists of two physical units mounted on the bicycle:
1. **Main Sensor Unit (Mounted on Seatpost / Rear Rack):**
   Houses the 18650 Li-ion battery, TP4056 charging board, ESP32 carrier PCB, NEO-6M GPS patch antenna, MPU-6050 IMU, and mounts the two waterproof JSN-SR04T ultrasonic transducers.
2. **Handlebar Display Unit (Mounted on Handlebar):**
   Houses the 0.96″ I2C OLED display and the 12 mm waterproof momentary push button within direct line-of-sight and thumb reach of the rider.

```
       +------------------------------------+
       |   HANDLEBAR DISPLAY UNIT           |
       |   - 0.96" OLED Screen (128x64)     |
       |   - 12 mm Event Push Button        |
       |   - Quick-Release Bar Clamp Mount  |
       +-----------------+------------------+
                         |
                         | 4-Core Cable (VCC, GND, SDA, SCL)
                         v
       +------------------------------------+
       |   MAIN TELEMETRY SENSOR UNIT       |
       |   (Under-Saddle / Seatpost Mount)  |
       |                                    |
       |   +----------------------------+   |
       |   | [Left Probe]  [Right Probe]|   |
       |   | Ultrasonic     Ultrasonic  |   |
       |   | Transducer     Transducer  |   |
       |   +----------------------------+   |
       |   - ESP32 MCU + Custom PCB         |
       |   - MPU-6050 6-Axis IMU Module     |
       |   - u-blox NEO-6M GPS & Antenna    |
       |   - 3.3V MicroSD Card Reader       |
       |   - 3.7V 18650 Li-ion Battery      |
       |   - TP4056 USB-C Charging Port     |
       +------------------------------------+
```

---

## 2. Local Pre-Packaged STL Files (Ready to Print)

All 10 official production STL models are downloaded directly into this repository:
- **Individual Models Directory:** [`hardware/3d_print_models/`](3d_print_models/)
- **One-Click Upload Zip Archive:** [`hardware/OpenBikeSensor_3D_Print_STL_Package.zip`](OpenBikeSensor_3D_Print_STL_Package.zip)

| File Name in `hardware/3d_print_models/` | Description & Placement | Approximate Weight / Print Time |
| :--- | :--- | :---: |
| **`MainCase.stl`** | Main chassis; holds 18650 battery holder, PCB standoffs, dual 20mm ultrasonic ports, and USB-C port. | ~85g / 4.5 hrs |
| **`MainCaseLid.stl`** | Weatherproof sliding top cover with perimeter silicone gasket channel. | ~35g / 2.0 hrs |
| **`GpsAntennaLid.stl`** | Weatherproof cap shielding the ceramic patch antenna while preserving RF sky visibility. | ~12g / 45 mins |
| **`UsbCover.stl`** | Flexible gasket plug sealing the Type-C USB charging port against rain/splashes. | ~4g / 20 mins |
| **`DisplayCaseTop.stl`** | Handlebar housing faceplate with window for 0.96″ OLED display & 12.2mm button hole. | ~22g / 1.5 hrs |
| **`DisplayCaseBottom.stl`** | Handlebar display backplate with cable routing strain relief. | ~16g / 1.0 hr |
| **`DisplayCableStrainRelief.stl`** | Mechanical clamp preventing cable pull damage to display I2C wires. | ~8g / 30 mins |
| **`SeatPostMount.stl`** | Heavy-duty 2-bolt clamp fitting standard bicycle seatposts (27.2 mm – 31.6 mm). | ~28g / 1.5 hrs |
| **`HandlebarRail.stl`** | Standard 22.2 mm / 31.8 mm bicycle handlebar quick-mount rail. | ~14g / 45 mins |
| **`StandardMountAdapter.stl`** | Universal mounting tongue connecting main enclosure to seatpost clamp. | ~20g / 1.0 hr |

---

## 3. Material Specification: Why PETG (NOT PLA)

- **DO NOT USE PLA (Polylactic Acid):**
  - PLA has a low glass transition temperature ($T_g \approx 55^\circ\text{C}$).
  - In direct sunlight during Indian summer days, dark-colored bicycle cases reach internal temperatures exceeding $65^\circ\text{C}$. PLA will soften, warp, deform, and break weatherproofing seals.
- **SPECIFY PETG (Polyethylene Terephthalate Glycol) OR ABS:**
  - **Thermal Resistance:** Stable up to $80^\circ\text{C} - 85^\circ\text{C}$ in direct outdoor sunlight.
  - **UV & Weather Resistance:** Does not degrade or embrittle under solar ultraviolet radiation.
  - **Mechanical Impact Strength:** Excellent layer adhesion; absorbs rough road vibrations and potholes without cracking.
- **Recommended Slicer Parameters:**
  - **Layer Height:** $0.20\text{ mm}$ (Standard)
  - **Perimeters / Wall Loops:** 4 walls ($1.6\text{ mm}$ wall thickness for moisture-tight seals)
  - **Infill Density:** 30% Gyroid or Grid infill
  - **Color:** Black, Slate Grey, or Safety Orange

---

## 4. How to Get It Printed (Options for Delivery to Dhanbad PIN 826004)

### Option A: Commercial Online 3D Printing Service (Think3D / Robu)
1. **Vendor Link:** [Think3D Rapid Prototyping](https://www.think3d.in/) or [Robu 3D Printing Service](https://robu.in/3d-printing-services/)
2. Upload the single ZIP archive: [`hardware/OpenBikeSensor_3D_Print_STL_Package.zip`](OpenBikeSensor_3D_Print_STL_Package.zip)
3. Select configuration:
   - **Technology:** FDM (Fused Deposition Modeling)
   - **Material:** PETG
   - **Infill:** 30%
   - **Color:** Black
4. Both services ship via Blue Dart / DTDC with direct delivery to **IIT (ISM) Dhanbad (PIN: 826004)** within 3 to 5 days.

### Option B: Campus FabLab / Department 3D Printer
- Copy the STL files from [`hardware/3d_print_models/`](3d_print_models/) onto a flash drive.
- Open in Cura or PrusaSlicer, slice with PETG settings, and print locally on any campus FDM printer.
