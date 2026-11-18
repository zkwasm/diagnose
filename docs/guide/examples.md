# Diagnostic walkthroughs

Choose the example closest to what you see. These are illustrative sessions. The readings, logs, and outcomes in your session will depend on the actual device.

For any example, the **person on site** connects the device to a computer that can reach it, starts the probe, and shares the invitation privately. The **diagnostician** opens their agent, connects with the invitation, and starts with the suggested prompt. [Follow Quick start to get both sides connected](../../USER_GUIDE.md#quick-start).

## A USB gateway is silent

**What you see.** An OWON gateway powers on, but its readings stopped arriving. The manufacturer exposes diagnostic logs over a USB serial connection.

**Prepare on site.** Connect the gateway with a USB data cable. Share the model and which cable goes to the gateway. If you know the serial settings or which port belongs to the gateway, share those too. Agree on when it is safe to open the port, since opening a serial port can reset some devices.

**Ask the agent.**

> The OWON gateway stopped reporting plug readings. It is connected to the on-site Mac by USB. Identify the serial interface, then take a short passive log sample if the port and settings are confirmed. Tell me separately whether the probe is connected, which device interface you can identify, and whether the gateway produced recognizable output.

**Follow the evidence.** If the computer lists two USB serial ports, the person on site can identify the right cable or provide the port name before the agent opens either one. If the capture returns zero bytes, check the documented baud rate and when the gateway normally emits logs. Arrange a second sample during a normal reporting event. If the gateway logs show fresh readings but the dashboard stays stale, check the application that consumes those readings next.

> The gateway normally reports once a minute. Once we've confirmed the port settings, sample across one reporting interval and tell me whether you see a new reading.

**Verify recovery.** Observe a new reading and confirm that the same reading reaches the intended dashboard. Recognizable gateway output confirms the interface and gives you evidence for the next diagnostic step.

## A network device appears offline

**What you see.** A smart device appears offline in its app while the device still has power. The manufacturer documents a local status page or query.

**Prepare on site.** Put the on-site computer on a network that can reach the device. Share the known local address and the documented status page or approved vendor utility. If the tool needs a login, arrange for the on-site person to enter credentials locally.

**Ask the agent.**

> The app says the device is offline. From the on-site laptop, check the device's documented local status endpoint and tell me whether it responds with the expected device status. Only check the address I provided. If local status works, help me work out where the app path fails.

**Follow the evidence.** A normal status response confirms local access from that computer. Ask which app or service is supposed to receive the status, then inspect its configured address or relevant logs if available. If the documented service times out, ask the person on site to confirm the current address and network connection, then retry the same check.

**Verify recovery.** Repeat the local status check and reopen the app or refresh its device view. Confirm that it shows a current value for the correct device.

## Factory readings stopped arriving

**What you see.** The machine operator sees normal operation, but the dashboard has stopped showing new telemetry. A collector on an industrial PC reads from the controller and sends measurements to the dashboard.

**Prepare on site.** Put the probe on the industrial PC or an approved maintenance computer that can access the relevant collector diagnostics. Give the agent the name of the collector, the path to its logs if known, and the time of the last good reading. Agree with the operator on which read-only checks are allowed and how to verify a new measurement.

**Ask the agent.**

> The line is running, but the dashboard has shown the same reading since 10 a.m. Check the collector logs around that time and compare the last successful controller read with the last successful dashboard send. Keep the machine and controller in their current state. Tell me which link in the data path the evidence points to.

**Follow the evidence.** Recent controller reads plus repeated dashboard-send errors point to the collector-to-dashboard link. Check the collector's configured destination against the approved value. If they differ, ask the agent to show the current and proposed values and the steps to restore the original value. Schedule an authorized change to the collector with the operator. If controller reads have stopped instead, ask for the manufacturer's permitted status check and involve the on-site operator.

> The collector shows fresh controller readings and send failures. Compare the configured dashboard destination with the approved value and explain what would need to change.

**Verify recovery.** Confirm a new measurement in the collector and a matching timestamp or value in the dashboard. Record which component changed and which check confirmed recovery.

## An application won't start

**What you see.** An application on the on-site computer exits on startup after a settings change.

**Prepare on site.** Start the probe on that computer. Share the application name, the exact startup error if visible, and which settings changed. Identify whether someone is actively using the service before approving a restart.

**Ask the agent.**

> This application exits on startup after a configuration edit. Read only the relevant startup log and settings first. Show me which setting the evidence points to and how to restore its previous value. After I approve the change, repeat the same startup check.

**Follow the evidence.** If the log names an invalid setting, compare it with the last known good configuration or documented value. Review the targeted change before applying it. If the application still exits, collect the new startup error and update the diagnosis.

**Verify recovery.** Start it the same way the user normally does and perform one real operation, such as opening its status page or loading a sample record.

## The on-site computer is slow or losing disk space

**What you see.** The machine is slow, CPU usage stays high, or free space is dropping during a diagnostic or maintenance task.

**Prepare on site.** Run the probe on the affected computer. If Activity Monitor or Task Manager shows a process ID, share it. If you know the log path or the volume losing space, share it so the agent can check the right file or disk.

**Ask the agent.**

> Use Diagnose to check the on-site computer's high CPU and dropping free space. Show which processes are busy, what started them, and whether a known log is growing. Keep the checks read-only. If I ask for progress on a running repair, look up the original task.

**Follow the evidence.** With Diagnose 0.8.3 or later on both computers, `system.performance` returns the process snapshot, parents, disk capacity, and a short sample of log growth. macOS and Linux can identify visible regular files attached to the selected process's stdout or stderr. On Windows, provide the suspected log paths for growth sampling. CPU measurements reflect the reported source, including a lifetime average on Linux. Use process and file evidence together before proposing a change.

**Verify recovery.** After an authorized intervention, compare another snapshot. Look for the affected process to exit or use less CPU and for the log to stop growing. Check free space separately if files were removed.

## Use the diagnosis again

If the same site needs follow-up, [save the pairing](reconnect.md#keep-a-device-paired-for-future-diagnosis). When you return, check which equipment is currently attached and repeat the same verification. If you want to repeat the workflow on another device of the same kind, [record the diagnosis and review a reusable procedure](procedures.md#record-a-device-diagnosis-and-improve-your-procedures).
