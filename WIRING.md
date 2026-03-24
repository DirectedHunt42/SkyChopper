# Wiring Diagram (Arduino Nano + Raspberry Pi Zero)

This diagram matches the current firmware in `arduino/arduino.ino`.

**Assumptions**
- Arduino Nano 5V (ATmega328P).
- Relay module uses 5V logic and is *active-high*.
- Battery/source/buck voltages are measured through resistor dividers to keep the analog pins <= 5V.
- Pi Zero only talks to Arduino over USB serial (recommended).

**Pin Map**
- `A0` = Battery voltage sense (via divider)
- `A1` = Source voltage sense (via divider)
- `A2` = Buck voltage sense (via divider)
- `D8` = Relay control output
- `5V` = Relay VCC (if your relay module needs 5V)
- `GND` = Common ground (Arduino + relay + voltage dividers)

**ASCII Wiring Diagram**
```
Battery+ ----[R1]----+-----> A0 (Nano)
                     |
                    [R2]
                     |
Battery- ------------+-----> GND (Nano)

Source+  ----[R3]----+-----> A1 (Nano)
                     |
                    [R4]
                     |
Source- -------------+-----> GND (Nano)

Buck+    ----[R5]----+-----> A2 (Nano)
                     |
                    [R6]
                     |
Buck- ---------------+-----> GND (Nano)

Relay Module:
  Nano D8  ---------- IN
  Nano 5V  ---------- VCC
  Nano GND ---------- GND

Pi Zero:
  USB to Nano (serial + power). No GPIO wiring required.
```

**Notes**
- Use a **common ground** between Nano, relay, and all voltage dividers.
- Choose divider resistors so the max voltage at A0/A1/A2 stays below 5V.
- If your relay is **active-low**, flip `RELAY_ACTIVE_HIGH` to `false` in `arduino/arduino.ino`.

**Suggested Resistor Values (examples)**
These are safe starting points that match the firmware multipliers in `arduino/arduino.ino`.
- Battery/Source (`BATT_DIVIDER_MULT = 11.0`):
  - `Rtop = 100k`, `Rbottom = 10k` (multiplier = 11.0)
  - Max measurable voltage ≈ `5.0V * 11.0 = 55V`
- Buck (`BUCK_DIVIDER_MULT = 6.0`):
  - `Rtop = 47k`, `Rbottom = 10k` (multiplier = 5.7)
  - Max measurable voltage ≈ `5.0V * 5.7 = 28.5V`

**Lower-Voltage Alternative (tighter resolution)**
If your system never exceeds ~15V, use a smaller ratio:
- `Rtop = 20k`, `Rbottom = 10k` (multiplier = 3.0, max ≈ 15V)
Update the multiplier in `arduino/arduino.ino` to match your ratio.
