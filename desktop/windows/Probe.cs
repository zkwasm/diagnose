using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class Probe : Form {
    private readonly ComboBox language = new ComboBox();
    private readonly TextBox code = new TextBox();
    private readonly TextBox history = new TextBox();
    private readonly Label status = new Label();
    private readonly FlowLayoutPanel choices = new FlowLayoutPanel();
    private readonly Button start = new Button(), end = new Button(), copy = new Button(), revoke = new Button();
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly string[] locale = { "en", "zh", "es" };
    private readonly string localeFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Diagnose", "probe-language");
    private Process worker;

    [STAThread]
    public static void Main() {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new Probe());
    }

    private Probe() {
        Text = "Diagnose Probe";
        Font = new Font("Segoe UI", 11);
        ClientSize = new Size(760, 460);
        MinimumSize = new Size(620, 400);
        StartPosition = FormStartPosition.CenterScreen;
        language.DropDownStyle = ComboBoxStyle.DropDownList;
        language.Items.AddRange(new object[] { "English", "简体中文", "Español" });
        string preferred = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName;
        try { if (File.Exists(localeFile)) preferred = File.ReadAllText(localeFile).Trim(); }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        language.SelectedIndex = Math.Max(0, Array.IndexOf(locale, preferred));
        code.ReadOnly = true;
        code.Width = 155;
        status.Dock = DockStyle.Top;
        status.Height = 58;
        history.ReadOnly = true;
        history.Multiline = true;
        history.ScrollBars = ScrollBars.Vertical;
        history.Dock = DockStyle.Fill;
        history.AccessibleName = "Session activity";
        choices.Dock = DockStyle.Top;
        choices.AutoSize = true;
        var controls = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true };
        controls.Controls.AddRange(new Control[] { language, start, end, code, copy, revoke });
        foreach (var button in new[] { start, end, copy, revoke }) button.AutoSize = true;
        revoke.Enabled = false;
        Padding = new Padding(16);
        Controls.Add(history);
        Controls.Add(choices);
        Controls.Add(status);
        Controls.Add(controls);
        language.SelectedIndexChanged += delegate {
            UpdateLabels();
            try {
                Directory.CreateDirectory(Path.GetDirectoryName(localeFile));
                File.WriteAllText(localeFile, locale[language.SelectedIndex]);
            } catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        };
        start.Click += delegate { StartProbe(); };
        end.Click += delegate { EndProbe(); };
        copy.Click += delegate { if (code.Text.Length != 0) Clipboard.SetText(code.Text); };
        revoke.Click += delegate { Answer("permissions ask"); };
        FormClosing += delegate {
            var process = worker;
            EndProbe();
            if (process != null && !process.WaitForExit(1800)) process.Kill();
        };
        UpdateLabels();
    }

    private string Local(string en, string zh, string es) {
        return language.SelectedIndex == 1 ? zh : language.SelectedIndex == 2 ? es : en;
    }

    private void UpdateLabels() {
        start.Text = Local("Start support", "开始诊断", "Iniciar soporte");
        end.Text = Local("End access", "结束访问", "Terminar acceso");
        copy.Text = Local("Copy code", "复制配对码", "Copiar código");
        revoke.Text = Local("Require review", "恢复逐项审核", "Volver a revisar");
        if (worker == null) status.Text = Local("Start when your support contact is ready.", "诊断人员准备好后，点击开始。", "Empezá cuando soporte esté listo.");
        SetControls();
    }

    private void SetControls() {
        start.Enabled = language.Enabled = worker == null;
        end.Enabled = worker != null;
        copy.Enabled = code.Text.Length != 0;
    }

    private void StartProbe() {
        var root = AppDomain.CurrentDomain.BaseDirectory;
        var process = new Process { StartInfo = new ProcessStartInfo {
            FileName = Path.Combine(root, "node.exe"),
            Arguments = "dist/cli.js start --desktop-stdio --lang " + locale[language.SelectedIndex],
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        }, EnableRaisingEvents = true };
        process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) {
            if (e.Data != null) OnUi(delegate { if (worker == process) Display(e.Data); });
        };
        process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) {
            if (e.Data != null) OnUi(delegate { if (worker == process) AddHistory(e.Data); });
        };
        process.Exited += delegate {
            OnUi(delegate {
                if (worker == process) {
                    worker = null;
                    ClearChoices();
                    code.Clear();
                    revoke.Enabled = false;
                    UpdateLabels();
                }
                process.Dispose();
            });
        };
        revoke.Enabled = false;
        try {
            process.Start();
            worker = process;
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            SetControls();
        } catch (Exception error) {
            worker = null;
            process.Dispose();
            status.Text = Local("Could not start Diagnose Probe.", "无法启动 Diagnose Probe。", "No se pudo iniciar Diagnose Probe.");
            AddHistory(error.Message);
            SetControls();
        }
    }

    private void OnUi(Action action) {
        if (!IsDisposed && IsHandleCreated) try { BeginInvoke(action); } catch (InvalidOperationException) { }
    }

    private void AddHistory(string value) {
        if (history.TextLength > 200000) history.Clear();
        history.AppendText(value + Environment.NewLine);
    }

    private void Display(string line) {
        if (line.Length == 0 || line[0] != 30) {
            AddHistory(line);
            return;
        }
        var message = json.Deserialize<Dictionary<string, string>>(line.Substring(1));
        if (message["event"] == "serial-ready" || message["event"] == "awaiting-serial-device") {
            AddHistory(message["text"]);
            if (choices.Controls.Count == 0) status.Text = message["text"];
            return;
        }
        status.Text = message["text"];
        ClearChoices();
        code.Text = message.ContainsKey("code") ? message["code"] : "";
        if (message["event"] == "connected") revoke.Enabled = true;
        if (message["event"] == "ended") revoke.Enabled = false;
        switch (message["event"]) {
            case "startup":
                AddChoice("", Local("Approve everything", "全部授权", "Aprobar todo"));
                AddChoice("r", Local("Review", "逐项审核", "Revisar"));
                AddChoice("a", Local("Confirm connection only", "只确认连接", "Confirmar conexión"));
                break;
            case "pair-auto":
                AddChoice("y", Local("Allow", "允许", "Permitir"));
                AddChoice("r", Local("Allow with review", "允许并逐项审核", "Permitir con revisión"));
                AddChoice("n", Local("Reject", "拒绝", "Rechazar"));
                break;
            case "pair-review":
                AddChoice("y", Local("Allow with review", "允许并逐项审核", "Permitir con revisión"));
                AddChoice("a", Local("Allow automatically", "允许并自动授权", "Permitir automáticamente"));
                AddChoice("n", Local("Reject", "拒绝", "Rechazar"));
                break;
            case "review":
                AddChoice("y", Local("Approve once", "仅批准这一次", "Aprobar una vez"));
                AddChoice("a", Local("Approve for this session", "本次会话自动授权", "Aprobar durante esta sesión"));
                AddChoice("d", Local("View details", "查看详情", "Ver detalles"));
                AddChoice("n", Local("Reject", "拒绝", "Rechazar"));
                break;
        }
        SetControls();
    }

    private void ClearChoices() {
        while (choices.Controls.Count > 0) choices.Controls[0].Dispose();
    }

    private void AddChoice(string value, string label) {
        var button = new Button { Text = label, AutoSize = true };
        button.Click += delegate {
            foreach (Control item in choices.Controls) item.Enabled = false;
            Answer(value);
        };
        choices.Controls.Add(button);
    }

    private void Answer(string answer) {
        if (worker == null || worker.HasExited) return;
        try { worker.StandardInput.WriteLine(answer); } catch (IOException) { }
    }

    private void EndProbe() {
        if (worker != null && !worker.HasExited) worker.StandardInput.Close();
    }
}
