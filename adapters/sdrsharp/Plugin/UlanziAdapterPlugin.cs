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
            ["frequencyHz"] = CapabilityDescriptor.ReadWrite(),
            ["stepHz"] = CapabilityDescriptor.ReadWrite(values: SharpCommandExecutor.StepValues.Cast<object>().ToArray()),
            ["volume"] = CapabilityDescriptor.ReadWrite(0, 1, 0.01),
            ["muted"] = CapabilityDescriptor.ReadWrite(values: [true, false]),
            ["mode"] = CapabilityDescriptor.ReadWrite(values: Enum.GetNames<DetectorType>().Cast<object>().ToArray()),
            ["bandwidthHz"] = CapabilityDescriptor.ReadWrite(10, control.MaximumFilterBandwidth, 10),
            ["dsp.agc"] = CapabilityDescriptor.ReadWrite(values: [true, false]),
            ["record.audio"] = CapabilityDescriptor.ReadWrite(values: [true, false])
        };
        using var source = HfPlusSourceCapabilities.TryCreate(control.Source, control.SourceName);
        foreach (var capability in source?.Describe() ?? []) capabilities[capability.Key] = capability.Value;
        return capabilities;
    }
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

