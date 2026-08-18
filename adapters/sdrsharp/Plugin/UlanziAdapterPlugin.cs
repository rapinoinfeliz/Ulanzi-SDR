using System.ComponentModel;
using System.Windows.Forms;
using SDRSharp.Common;
using SDRSharp.Radio;
using SDRSharp.UlanziAdapter.Control;
using SDRSharp.UlanziAdapter.Recording;
using SDRSharp.UlanziAdapter.Transport;

namespace SDRSharp.UlanziAdapter.Plugin;

public sealed class UlanziAdapterPlugin : ISharpPlugin, ICanLazyLoadGui, ISupportStatus, IExtendedNameProvider
{
    private ISharpControl? _control;
    private DiagnosticsPanel? _panel;
    private AdapterConnection? _connection;
    private MonitorAudioRecorder? _recorder;
    private SharpCommandExecutor? _executor;
    private SynchronizationContext? _uiContext;

    public string DisplayName => "Ulanzi SDR Control";
    public string Category => "Control";
    public string MenuItemName => DisplayName;
    public bool IsActive => _panel?.Visible == true;
    public UserControl Gui { get { LoadGui(); return _panel!; } }

    public void Initialize(ISharpControl control)
    {
        _control = control;
        _uiContext = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _recorder = new MonitorAudioRecorder();
        control.RegisterStreamHook(_recorder.Processor, ProcessorType.MonitorAF);
        _executor = new SharpCommandExecutor(control, _recorder, _uiContext);
        _connection = new AdapterConnection(_executor, BuildCapabilities(control));
        _connection.ConnectionChanged += OnConnectionChanged;
        control.PropertyChanged += OnSharpPropertyChanged;
        _connection.Start();
    }

    public void LoadGui()
    {
        _panel ??= new DiagnosticsPanel(
            () => _connection?.Status ?? "Starting",
            () => _executor?.ReadState().ToDisplayString() ?? "No state");
    }

    public void Close()
    {
        if (_control is not null)
        {
            _control.PropertyChanged -= OnSharpPropertyChanged;
            if (_recorder is not null) _control.UnregisterStreamHook(_recorder.Processor);
        }
        _connection?.Dispose();
        _recorder?.Dispose();
        _panel?.Dispose();
        _control = null;
    }

    private void OnSharpPropertyChanged(object? sender, PropertyChangedEventArgs args) => _connection?.ScheduleSnapshot();

    private void OnConnectionChanged(object? sender, EventArgs args)
    {
        if (_panel is null || _panel.IsDisposed) return;
        _panel.BeginInvoke(_panel.RefreshStatus);
    }

    private static Dictionary<string, CapabilityDescriptor> BuildCapabilities(ISharpControl control)
    {
        var capabilities = new Dictionary<string, CapabilityDescriptor>
        {
            ["frequencyHz"] = RW("Frequency", "Tuning", unit: "Hz"),
            ["centerFrequencyHz"] = RW("Center frequency", "Tuning", unit: "Hz"),
            ["stepHz"] = RW("Tuning step", "Tuning", values: SharpCommandExecutor.StepValues.Cast<object>().ToArray(), unit: "Hz"),
            ["snapToGrid"] = RW("Snap to grid", "Tuning", boolean: true),
            ["frequencyShift.enabled"] = RW("Frequency shift", "Tuning", boolean: true),
            ["frequencyShiftHz"] = RW("Frequency shift value", "Tuning", -2_000_000_000, 2_000_000_000, 1, unit: "Hz"),
            ["centerFrequencyLocked"] = RW("Lock center frequency", "Tuning", boolean: true),
            ["tuning.style"] = RW("Tuning style", "Tuning", values: Enum.GetNames<TuningStyle>().Cast<object>().ToArray()),
            ["tuning.styleFrozen"] = RW("Freeze tuning style", "Tuning", boolean: true),
            ["tuning.limit"] = RW("Tuning limit", "Tuning", 0, 1, 0.01),

            ["volume"] = RW("Volume", "Audio", 0, 1, 0.01),
            ["muted"] = RW("Mute", "Audio", boolean: true),
            ["audio.panning"] = RW("Audio panning", "Audio", -1, 1, 0.05),
            ["unityGain"] = RW("Unity gain", "Audio", boolean: true),
            ["filter.audio"] = RW("Audio filter", "Audio", boolean: true),

            ["mode"] = RW("Demodulation mode", "Demodulation", values: Enum.GetNames<DetectorType>().Cast<object>().ToArray()),
            ["bandwidthHz"] = RW("Filter bandwidth", "Demodulation", 10, control.MaximumFilterBandwidth, 10, unit: "Hz"),
            ["filter.type"] = RW("Filter window", "Demodulation", values: Enum.GetNames<WindowType>().Cast<object>().ToArray()),
            ["filter.order"] = RW("Filter order", "Demodulation", 2, 1000, 2),
            ["cwShiftHz"] = RW("CW shift", "Demodulation", 0, 5000, 10, unit: "Hz"),
            ["fm.stereo"] = RW("FM stereo", "Demodulation", boolean: true),
            ["carrier.lock"] = RW("Carrier lock", "Demodulation", boolean: true),
            ["antiFading"] = RW("Anti-fading", "Demodulation", boolean: true),
            ["demodulation.bypass"] = RW("Bypass demodulation", "Demodulation", boolean: true),

            ["squelch.enabled"] = RW("Squelch", "Squelch", boolean: true),
            ["squelch.threshold"] = RW("Squelch threshold", "Squelch", -150, 0, 1, unit: "dB"),

            ["dsp.agc"] = RW("DSP AGC", "AGC", boolean: true),
            ["agc.hang"] = RW("AGC hang", "AGC", boolean: true),
            ["agc.threshold"] = RW("AGC threshold", "AGC", -150, 0, 1, unit: "dB"),
            ["agc.decay"] = RW("AGC decay", "AGC", 0, 5000, 10),
            ["agc.slope"] = RW("AGC slope", "AGC", 0, 100, 1),

            ["iq.swap"] = RW("Swap I/Q", "Source", boolean: true),
            ["receiverRunning"] = RW("Receiver", "Source", boolean: true),

            ["zoom"] = RW("Spectrum zoom", "Display", 0, 100, 1),
            ["spectrum.markPeaks"] = RW("Mark peaks", "Display", boolean: true),
            ["spectrum.attack"] = RW("Spectrum attack", "Display", step: 0.01),
            ["spectrum.decay"] = RW("Spectrum decay", "Display", step: 0.01),
            ["waterfall.attack"] = RW("Waterfall attack", "Display", step: 0.01),
            ["waterfall.decay"] = RW("Waterfall decay", "Display", step: 0.01),
            ["spectrum.timeMarkers"] = RW("Time markers", "Display", boolean: true),
            ["rds.useFec"] = RW("RDS error correction", "RDS", boolean: true),

            ["record.audio"] = RW("Audio recording", "Recorder", boolean: true)
        };
        using var source = HfPlusSourceCapabilities.TryCreate(control.Source, control.SourceName);
        foreach (var capability in source?.Describe() ?? []) capabilities[capability.Key] = capability.Value;
        return capabilities;
    }

    private static CapabilityDescriptor RW(string label, string category, double? minimum = null, double? maximum = null, double? step = null, object[]? values = null, string? unit = null, bool boolean = false) =>
        CapabilityDescriptor.ReadWrite(minimum, maximum, step, boolean ? [true, false] : values, label: label, category: category, unit: unit);
}

internal sealed class DiagnosticsPanel : UserControl
{
    private readonly Func<string> _status;
    private readonly Func<string> _state;
    private readonly Label _statusLabel;
    private readonly Label _stateLabel;
    private readonly System.Windows.Forms.Timer _timer;

    public DiagnosticsPanel(Func<string> status, Func<string> state)
    {
        _status = status;
        _state = state;
        Dock = DockStyle.Fill;
        _statusLabel = new Label { Dock = DockStyle.Top, Height = 28, TextAlign = System.Drawing.ContentAlignment.MiddleLeft };
        _stateLabel = new Label { Dock = DockStyle.Fill, AutoSize = false };
        Controls.Add(_stateLabel);
        Controls.Add(_statusLabel);
        _timer = new System.Windows.Forms.Timer { Interval = 500 };
        _timer.Tick += (_, _) => RefreshStatus();
        _timer.Start();
        RefreshStatus();
    }

    public void RefreshStatus()
    {
        _statusLabel.Text = $"IPC: {_status()}";
        _stateLabel.Text = _state();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _timer.Dispose();
        base.Dispose(disposing);
    }
}
