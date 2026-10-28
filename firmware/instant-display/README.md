# FPGA single-sample power display

The six-digit display now samples the live feedback ADC once every 0.1 s and applies the existing 30-segment calibration. It does not average samples. Units remain mW, displayed as XX.XXXX. Scan timing and invalidation for wrong channel, out-of-range input, OTR and stale sampling are retained.

Derived from the archived A624 project. The only RTL changes are the independent display module and register 0x38 (5030 -> 5031). PI, ADC/DAC and UART RTL are unchanged. The A624 interface ID at 0x3F is unchanged.

Build with Vivado 2023.2 from this directory:

    python scripts/test.py tb_instant_display_revision
    D:\xilinx\Vivado\2023.2\bin\vivado.bat -mode batch -source scripts/build.tcl

The build rejects negative setup or hold slack before writing the bitstream. `finish_route.tcl` reproduces the post-route optimization from a previously written routed checkpoint. The included bitstream passed setup slack 0.002 ns and hold slack 0.062 ns, and live hardware verification. See ../../docs/20261028-meter-and-display-check.json.

`program_ram.tcl` targets Digilent serial 210512180081 / xc7a35t and programs RAM only. Loading resets runtime registers and integral state: snapshot the current instrument configuration first and restore it afterward. It does not write Flash. Power-off therefore restores the previous Flash firmware, including its averaged display. The runtime parameters are not embedded into this display-only revision.

During the 2026-10-28 load, a historical ADC OTR bit was latched. Four new 8192-sample captures passed without live OTR/freeze/output-limit faults before the original PI mode was accepted as restored. The existing sticky ADC flag is still reported honestly; it is not masked by this update. Static configuration matched the pre-load backup; integral history cannot survive a RAM load.
