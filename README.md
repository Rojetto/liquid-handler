# Liquid Handler Simulator

A browser-based simulator for high-level liquid handling workflows. It pairs a real-time 3D deck view with an embedded Python protocol editor that talks to the simulator through a simple serial-style command protocol.

## Capabilities

- Real-time three.js visualization of a liquid handler deck.
- 8-channel pipette head with animated X/Y movement and per-channel Z motion.
- Four 96-well plate positions arranged as a 2 by 2 deck.

## Serial Protocol

Python scripts communicate with the simulator by writing newline-terminated text commands to `SerialStream` and reading newline-terminated text responses back.

```python
import io

raw = SerialStream()
serial = io.TextIOWrapper(
    io.BufferedRWPair(raw, raw),
    encoding="utf-8",
    newline="\n",
    line_buffering=True,
    write_through=True,
)

serial.write("move 0 0\n")
print(serial.readline().strip())

serial.write("aspirate 0 100\n")
print(serial.readline().strip())
```

Commands are split on spaces. Blank lines are ignored. Unknown commands currently produce no response.

### Coordinates And Channels

- Units are simulator centimeters.
- `move x y` places channel `0` at `(x, y)`.
- Channels `1` through `7` are offset along positive Y, so channel `n` acts at `(head_x, head_y + n)`.
- Wells are addressed by placing a channel over a well center.
- Each plate has 12 columns by 8 rows, with wells spaced 1 cm apart.

### Commands

| Command | Meaning | Success response |
| --- | --- | --- |
| `move <x> <y>` | Move the 8-channel head so channel 0 is over `(x, y)`. `x` and `y` may be numeric values. | `move complete` |
| `aspirate <channel> <volumeUl>` | Aspirate from the well under one channel. `channel` must be `0`-`7`; `volumeUl` must be an integer from `0` to `200`. | `aspirate <channel> <actualVolumeUl>` |
| `dispense <channel> <volumeUl>` | Dispense into the well under one channel. `channel` must be `0`-`7`; `volumeUl` must be an integer from `0` to `200`. | `dispense <channel> <actualVolumeUl>` |
| `get position` | Read the current head position. | `get <x> <y>` |

`actualVolumeUl` may be lower than requested. Aspirate is limited by source well volume and pipette capacity. Dispense is limited by pipette contents and destination well capacity.

### Error Responses

| Response | Cause |
| --- | --- |
| `command error arguments` | Wrong argument count, invalid number, invalid channel, invalid volume, or unknown `get` field. |
| `move error move_in_progress` | A `move` command was sent while the head was already moving. |
| `move error pipette_in_progress` | A `move` command was sent while any channel was aspirating or dispensing. |
| `aspirate error move_in_progress` | An aspirate command was sent while the head was moving. |
| `aspirate error pipette_in_progress` | The requested channel was already busy. |
| `aspirate error no_well` | The requested channel is not positioned over a well. |
| `dispense error move_in_progress` | A dispense command was sent while the head was moving. |
| `dispense error pipette_in_progress` | The requested channel was already busy. |
| `dispense error no_well` | The requested channel is not positioned over a well. |

## Use

Install and run:

```bash
npm install
npm run dev
```

Open the Vite URL, edit the Python script, click **Run**, and inspect the 3D simulation. Use **Reset** to rebuild the deck state.

## Build

```bash
npm run build
```

The built app is static, but it must be served with cross-origin isolation headers so `SharedArrayBuffer` is available. The included Vite dev and preview configs set these headers.

## Tech Stack

- TypeScript
- Vite
- three.js
- Monaco Editor
- Pyodide
