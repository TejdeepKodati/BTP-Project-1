# Printed Circuit Board (PCB) Fabrication & Assembly Guide
## OpenBikeSensor (OBS) Classic Board for CycleSafe

**Investigator:** Tej Deep  
**Supervisor:** Prof. Debasree Das  
**Standard Architecture:** OpenBikeSensor Classic 2-Layer PCB  
**Target Delivery:** IIT (ISM) Dhanbad, Jharkhand (PIN: 826004)

---

## 1. Official PCB Source Files & KiCad Project

All schematic files, board layouts, and Gerber generation scripts are open-source:

* **Official GitHub Hardware Repository:**  
  [`https://github.com/openbikesensor/OpenBikeSensor_PCB_Board`](https://github.com/openbikesensor/OpenBikeSensor_PCB_Board)
* **EDA Tool:** KiCad (v6 / v7 / v8 compatible).
* **Pre-generated Gerber Files:** You can download the zipped Gerber release directly from the repository's `Releases` tab or export the standard RS-274X Gerbers from KiCad.

---

## 2. PCB Fabrication Specifications (Enter into Fabricator Portal)

When ordering through an online PCB manufacturing service, use the following standard parameters:

| Parameter | Recommended Specification | Notes |
| :--- | :--- | :--- |
| **Board Type** | Single Board (2 Layers) | Standard double-sided FR-4 |
| **Dimensions** | $\sim 82\text{ mm} \times 52\text{ mm}$ | Form-factor matches 3D printed `case_bottom.stl` |
| **Material** | FR-4 Standard ($T_g 130 - 140^\circ\text{C}$) | Standard fiberglass-epoxy laminate |
| **Thickness** | $1.6\text{ mm}$ | Stiff, rigid support for bicycle road vibrations |
| **Copper Weight** | $1\text{ oz}\;(35\,\mu\text{m})$ | Ample for power traces handling up to 1.5A |
| **Surface Finish** | HASL with Lead-Free | RoHs compliant, easy hand-soldering |
| **Solder Mask** | Blue or Green | High contrast against white silkscreen |
| **Silkscreen** | White | Pin names and polarity labels clearly printed |
| **Minimum Trace/Space** | $6\,\text{mil} / 6\,\text{mil}$ | Standard manufacturing capability |
| **Minimum Hole Size** | $0.3\text{ mm}$ | Standard through-hole vias |

---

## 3. Recommended PCB Fabricators (Delivering to Dhanbad - 826004)

### Option 1: LionCircuits (Bangalore, India — Recommended Domestic Fab)
* **Direct Website:** [`https://www.lioncircuits.com/`](https://www.lioncircuits.com/)
* **Why Choose LionCircuits:**
  - **100% Domestic Indian Manufacturing:** Factory located in Bangalore, eliminating all customs clearance delays, import duty charges, or KYC hassles.
  - **Shipping:** Dispatches via Blue Dart / DTDC Express directly to **Dhanbad (826004)** with 3–4 day transit time.
  - **Pricing:** Prototype batch (5 boards) costs approximately ₹ 600 – ₹ 750 INR.

### Option 2: JLCPCB (Global Maker Standard)
* **Direct Website:** [`https://jlcpcb.com/`](https://jlcpcb.com/)
* **Features:** Extremely low base board cost ($2 USD for 5 boards), high automated optical inspection (AOI) quality. Ships to India via courier with prepaid customs.

---

## 4. Hardware Soldering & Commissioning Sequence

To protect the ESP32 and sensors from accidental short-circuits or voltage spikes during assembly, follow this step-by-step assembly sequence:

```
+-----------------------------------------------------------------------------------------+
|                               SOLDERING & VALIDATION SEQUENCE                            |
|                                                                                         |
|  [STEP 1] Solder Power Components First                                                 |
|           - Solder TP4056 board and 3.3V LDO regulator.                                 |
|           - Connect 18650 battery holder.                                               |
|           - TEST WITH MULTIMETER: Verify 3.30V (+/- 0.05V) at 3V3 rail before proceeding.  |
|                                                                                         |
|  [STEP 2] Solder Female Header Sockets (DO NOT Solder ESP32 Directly!)                  |
|           - Solder two 15-pin female header strips for the ESP32 DevKit.                |
|           - This allows removing or swapping the microcontroller at any time.           |
|                                                                                         |
|  [STEP 3] Solder Peripheral Connectors & Passives                                       |
|           - Solder JST-XH 4-pin headers for Ultrasonic Sensors & I2C Display.           |
|           - Solder 4-pin GPS UART header.                                               |
|           - Solder MicroSD card breakout header pins and 10uF decoupling capacitors.    |
|                                                                                         |
|  [STEP 4] Power Validation Before Mounting ICs                                          |
|           - Power the board via battery or USB-C.                                       |
|           - Probe every peripheral VCC pin with a multimeter to ensure NO pin has 5V.   |
|                                                                                         |
|  [STEP 5] Mount Modules & Initial Firmware Flash                                        |
|           - Seat ESP32, MPU-6050, and MicroSD card.                                     |
|           - Connect USB cable and upload the OpenBikeSensor firmware test sketch.       |
+-----------------------------------------------------------------------------------------+
```
