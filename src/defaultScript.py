import io
import time

class HandlerError(Exception):
    pass

CHANNELS = 8

raw = SerialStream()
serial = io.TextIOWrapper(
    io.BufferedRWPair(raw, raw),
    encoding="utf-8",
    newline="\n",
    line_buffering=True,
    write_through=True,
)

def cmd_move(x, y):
	serial.write(f"move {x} {y}\n")
	resp = serial.readline().strip()
	if resp != "move complete":
		raise HandlerError("Move failed: " + resp)

def cmd_pick_up_tips():
	for i in range(CHANNELS):
		serial.write(f"pick_up_tip {i}\n")

	for i in range(CHANNELS):
		resp = serial.readline().strip()
		split = resp.split()
		if len(split) != 3 or split[0] != "pick_up_tip" or split[2] != "complete":
			raise HandlerError("Pick up tip failed: " + resp)

def cmd_aspirate_all(vol):
	for i in range(CHANNELS):
		serial.write(f"aspirate {i} {vol}\n")
	
	vols = [0] * CHANNELS
	for i in range(CHANNELS):
		resp = serial.readline().strip()
		split = resp.split()
		if len(split) != 3 or split[1] == "error":
			raise HandlerError("Aspirate failed: " + resp)
		channel = int(split[1])
		vol = int(split[2])
		vols[channel] = vol
	
	return vols

def cmd_dispense(channel, vol):
	serial.write(f"dispense {channel} {vol}\n")
	resp = serial.readline().strip()
	split = resp.split()
	if len(split) != 3 or split[1] == "error":
		raise HandlerError("Dispense failed: " + resp)
	return int(split[2])

def cmd_dispense_all(vol):
	for i in range(CHANNELS):
		serial.write(f"dispense {i} {vol}\n")
	
	vols = [0] * CHANNELS
	for i in range(CHANNELS):
		resp = serial.readline().strip()
		split = resp.split()
		if len(split) != 3 or split[1] == "error":
			raise HandlerError("Dispense failed: " + resp)
		channel = int(split[1])
		vol = int(split[2])
		vols[channel] = vol
	
	return vols

def demo_1_dilution_chain():
	# Aspirate sample
	cmd_move(0, 0)
	cmd_aspirate_all(200)

	# Dispense samples into dilutant
	for x in range(3, 7):
		cmd_move(x, 0)
		cmd_dispense_all(50)

	# Aspirate reagent
	cmd_move(1, 0)
	cmd_aspirate_all(100)

	# Dispense reagents
	for x in range(3, 7):
		cmd_move(x, 0)
		cmd_dispense_all(25)

def demo_2_clean_up():
	cur_well = [13, 0]

	for dirty_col in range(12):
		cmd_move(dirty_col, 9)
		channel_vols = cmd_aspirate_all(200)

		channel = 0
		while channel < CHANNELS:
			if channel_vols[channel] > 0:
				cmd_move(cur_well[0], cur_well[1] - channel)
				dispensed = cmd_dispense(channel, channel_vols[channel])
				channel_vols[channel] = channel_vols[channel] - dispensed

				if channel_vols[channel] > 0:
					# Couldn't dispense all, switch to next empty well
					cur_well[1] = cur_well[1] + 1
					if cur_well[1] >= CHANNELS:
						cur_well[0] = cur_well[0] + 1
						cur_well[1] = 0
			else:
				channel = channel + 1

# Pick up tips
cmd_move(26, 0)
cmd_pick_up_tips()

demo_1_dilution_chain()
demo_2_clean_up()
