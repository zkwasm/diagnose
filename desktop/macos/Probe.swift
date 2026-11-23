import AppKit
import Darwin

private let resources = Bundle.main.resourceURL!
private let runtime = resources.appendingPathComponent("runtime")
private let languages = ["en", "zh", "es"]

private final class LineReader {
    private var pending = Data()

    func read(_ pipe: Pipe, deliver: @escaping (String) -> Void) {
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let bytes = handle.availableData
            if bytes.isEmpty {
                handle.readabilityHandler = nil
                return
            }
            self.pending.append(bytes)
            while let end = self.pending.firstIndex(of: 10) {
                let line = String(decoding: self.pending[..<end], as: UTF8.self)
                self.pending.removeSubrange(self.pending.startIndex...end)
                DispatchQueue.main.async { deliver(line) }
            }
        }
    }
}

final class Probe: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var worker: Process?
    private var input: FileHandle?
    private var ending = false
    private var choicesOpen = false
    private let language = NSPopUpButton()
    private let status = NSTextField(wrappingLabelWithString: "")
    private let code = NSTextField(labelWithString: "")
    private let activity = NSTextView()
    private let choices = NSStackView()
    private let start = NSButton()
    private let stop = NSButton()
    private let copy = NSButton()
    private let revoke = NSButton()
    private let labels = (try? JSONDecoder().decode([String: [String: String]].self, from: Data(contentsOf: runtime.appendingPathComponent("labels.json")))) ?? [:]

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 750, height: 430),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Diagnose Probe"
        window.minSize = NSSize(width: 630, height: 420)
        language.addItems(withTitles: ["English", "简体中文", "Español"])
        let preferred = UserDefaults.standard.string(forKey: "probeLanguage") ??
            Locale.preferredLanguages.first?.split(separator: "-").first.map(String.init) ?? "en"
        language.selectItem(at: languages.firstIndex(of: preferred) ?? 0)
        language.target = self
        language.action = #selector(changeLanguage)
        for (button, action) in [(start, #selector(startSession)), (stop, #selector(endSession)), (copy, #selector(copyCode)), (revoke, #selector(requireReview))] {
            button.bezelStyle = .rounded
            button.target = self
            button.action = action
        }
        let controls = NSStackView(views: [language, start, stop, revoke])
        controls.spacing = 12
        let invitation = NSStackView(views: [code, copy])
        invitation.spacing = 10
        code.font = .monospacedSystemFont(ofSize: 24, weight: .medium)
        code.isSelectable = true
        activity.isEditable = false
        activity.font = .systemFont(ofSize: 13)
        activity.textContainerInset = NSSize(width: 10, height: 10)
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        scroll.borderType = .bezelBorder
        scroll.documentView = activity
        choices.spacing = 8
        let panel = NSStackView(views: [controls, status, invitation, choices, scroll])
        panel.orientation = .vertical
        panel.alignment = .leading
        panel.spacing = 14
        panel.translatesAutoresizingMaskIntoConstraints = false
        let view = window.contentView!
        view.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            panel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            panel.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),
            panel.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -20),
            scroll.widthAnchor.constraint(equalTo: panel.widthAnchor),
            scroll.heightAnchor.constraint(greaterThanOrEqualToConstant: 110),
            status.widthAnchor.constraint(lessThanOrEqualTo: panel.widthAnchor)
        ])
        revoke.isEnabled = false
        updateLabels()
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private var selectedLanguage: String { languages[max(0, language.indexOfSelectedItem)] }
    private func label(_ key: String) -> String { labels[selectedLanguage]?[key] ?? labels["en"]?[key] ?? key }

    @objc private func changeLanguage() {
        UserDefaults.standard.set(selectedLanguage, forKey: "probeLanguage")
        updateLabels()
    }

    private func updateLabels() {
        start.title = label("start")
        stop.title = label("end")
        copy.title = label("copy")
        revoke.title = label("revoke")
        code.setAccessibilityLabel(label("code"))
        activity.setAccessibilityLabel(label("activity"))
        if worker == nil { status.stringValue = label("ready") }
        updateControls()
    }

    private func updateControls() {
        start.isEnabled = worker == nil
        language.isEnabled = worker == nil
        stop.isEnabled = worker != nil && !ending
        copy.isEnabled = !code.stringValue.isEmpty
    }

    @objc private func startSession() {
        let process = Process()
        process.executableURL = runtime.appendingPathComponent("node")
        process.currentDirectoryURL = runtime
        process.arguments = ["dist/cli.js", "start", "--desktop-stdio", "--lang", selectedLanguage]
        let stdin = Pipe(), stdout = Pipe(), stderr = Pipe()
        process.standardInput = stdin
        process.standardOutput = stdout
        process.standardError = stderr
        LineReader().read(stdout) { [weak self, weak process] line in
            if let self, let process, self.worker === process { self.receive(line) }
        }
        LineReader().read(stderr) { [weak self, weak process] line in
            if let self, let process, self.worker === process { self.append(line) }
        }
        process.terminationHandler = { [weak self] process in
            DispatchQueue.main.async {
                guard let self, self.worker === process else { return }
                self.worker = nil
                try? self.input?.close()
                self.input = nil
                self.ending = false
                self.clearChoices()
                self.code.stringValue = ""
                self.revoke.isEnabled = false
                self.updateLabels()
                if process.terminationStatus != 0 { self.status.stringValue = self.label("failed") }
            }
        }
        do {
            try process.run()
            worker = process
            input = stdin.fileHandleForWriting
            status.stringValue = label("starting")
            updateControls()
        } catch {
            stdout.fileHandleForReading.readabilityHandler = nil
            stderr.fileHandleForReading.readabilityHandler = nil
            status.stringValue = label("failed")
            append(error.localizedDescription)
        }
    }

    private func append(_ text: String) {
        if activity.string.utf8.count > 200_000 { activity.string = "" }
        activity.textStorage?.append(NSAttributedString(string: text + "\n", attributes: [.font: NSFont.systemFont(ofSize: 13)]))
        activity.scrollRangeToVisible(NSRange(location: activity.string.utf16.count, length: 0))
    }

    private func receive(_ line: String) {
        guard !ending else { return }
        guard line.first == "\u{001e}", let message = try? JSONDecoder().decode([String: String].self, from: Data(line.dropFirst().utf8)),
              let event = message["event"], let text = message["text"] else { append(line); return }
        if event == "serial-ready" || event == "awaiting-serial-device" {
            append(text)
            if !choicesOpen { status.stringValue = text }
            return
        }
        status.stringValue = text
        code.stringValue = message["code"] ?? ""
        clearChoices()
        switch event {
        case "connected": revoke.isEnabled = true
        case "ended": revoke.isEnabled = false
        case "startup": addChoices([("", "everything"), ("r", "review"), ("a", "confirm")])
        case "pair-auto": addChoices([("y", "allow"), ("r", "allowReview"), ("n", "reject")])
        case "pair-review": addChoices([("y", "allowReview"), ("a", "allowAuto"), ("n", "reject")])
        case "review": addChoices([("y", "once"), ("a", "session"), ("d", "details"), ("n", "reject")])
        default: break
        }
        updateControls()
    }

    private func clearChoices() {
        for view in choices.arrangedSubviews { choices.removeArrangedSubview(view); view.removeFromSuperview() }
        choicesOpen = false
    }

    private func addChoices(_ values: [(String, String)]) {
        for (answer, key) in values {
            let button = NSButton(title: label(key), target: self, action: #selector(answerChoice(_:)))
            button.identifier = NSUserInterfaceItemIdentifier(answer)
            choices.addArrangedSubview(button)
        }
        choicesOpen = true
    }

    @objc private func answerChoice(_ button: NSButton) {
        guard let id = button.identifier else { return }
        clearChoices()
        send(id.rawValue)
    }

    private func send(_ text: String) { try? input?.write(contentsOf: Data((text + "\n").utf8)) }
    @objc private func requireReview() { send("permissions ask") }
    @objc private func copyCode() {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(code.stringValue, forType: .string)
    }
    @objc private func endSession() {
        guard let process = worker, !ending else { return }
        ending = true
        try? input?.close()
        input = nil
        clearChoices()
        code.stringValue = ""
        revoke.isEnabled = false
        updateControls()
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if process.isRunning { process.terminate() } }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        endSession()
        if let process = worker, process.isRunning {
            let deadline = Date().addingTimeInterval(1.6)
            while process.isRunning && Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
            if process.isRunning { kill(process.processIdentifier, SIGKILL) }
        }
        return .terminateNow
    }
}

if CommandLine.arguments.dropFirst().first == "--check-runtime" {
    let process = Process()
    process.executableURL = runtime.appendingPathComponent("node")
    process.arguments = [runtime.appendingPathComponent("dist/cli.js").path, "help"]
    try process.run()
    process.waitUntilExit()
    exit(process.terminationStatus)
}
let application = NSApplication.shared
let probe = Probe()
application.setActivationPolicy(.regular)
application.delegate = probe
application.run()
