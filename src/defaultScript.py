import io
import time

raw = SerialStream()
serial = io.TextIOWrapper(
    io.BufferedRWPair(raw, raw),
    encoding="utf-8",
    newline="\n",
    line_buffering=True,
    write_through=True,
)

for x in range(12):
	serial.write(f"move {x} 0\n")
	serial.readline()

	for p in range(8):
		if x % 2 == 0:
			serial.write(f"aspirate {p} 200\n")
		else:
			serial.write(f"dispense {p} 200\n")
		time.sleep(0.2)
	
	for p in range(8):
		serial.readline()
