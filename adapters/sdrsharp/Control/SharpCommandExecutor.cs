using System.Text.Json;
using SDRSharp.Common;
using SDRSharp.Radio;
using SDRSharp.UlanziAdapter.Recording;

namespace SDRSharp.UlanziAdapter.Control;

internal sealed class SharpCommandExecutor
{
    public static readonly int[] StepValues = [1, 10, 100, 500, 1000, 2500, 5000, 6250, 8333, 9000, 10000, 12500, 25000, 50000, 100000, 250000, 500000, 1000000];
    private static readonly DetectorType[] Modes = [DetectorType.NFM, DetectorType.WFM, DetectorType.AM, DetectorType.DSB, DetectorType.USB, DetectorType.LSB, DetectorType.CW, DetectorType.RAW];
    private readonly ISharpControl _control;
    private readonly MonitorAudioRecorder _recorder;
    private readonly SynchronizationContext _ui;
    private long _revision;

    public SharpCommandExecutor(ISharpControl control, MonitorAudioRecorder recorder, SynchronizationContext ui)
    {
        _control = control;
        _recorder = recorder;
        _ui = ui;
    }

    public RadioState ReadState()
    {
        using var hf = HfPlusSourceCapabilities.TryCreate(_control.Source, _control.SourceName);
        var record = _recorder.Status;
        var rf = hf?.Read();
        return new RadioState
        {
            Revision = Interlocked.Read(ref _revision),
            SourceConnected = !string.IsNullOrWhiteSpace(_control.SourceName),
            ReceiverRunning = _control.IsPlaying,
            TargetVfo = "Radio",
            FrequencyHz = _control.Frequency,
            StepHz = _control.StepSize,
            Volume = Math.Clamp(_control.AudioGain / 100.0, 0, 1),
            Muted = _control.AudioIsMuted,
            Mode = _control.DetectorType.ToString(),
            BandwidthHz = _control.FilterBandwidth,
            DspAgc = new DspAgcState(_control.UseAgc),
            Rf = rf,
            Recorder = new RecorderState
            {
                Status = record.State,
                Path = record.Path,
                DurationSeconds = record.Duration.TotalSeconds,
                DroppedBuffers = record.DroppedBuffers,
                Error = record.Error
            },
            Signal = new SignalState(_control.VisualSNR, _control.VisualPeak, _control.VisualFloor),
            Controls = ReadControls(rf, record.State == "recording")
        };
    }

    public Task<RadioState> ReadStateAsync(CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<RadioState>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ui.Post(_ =>
        {
            try { completion.TrySetResult(ReadState()); }
            catch (Exception exception) { completion.TrySetException(exception); }
        }, null);
        cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
        return completion.Task;
    }

    public Task<CommandResult> ExecuteAsync(CommandMessage command, CancellationToken cancellationToken)
    {
        var completion = new TaskCompletionSource<CommandResult>(TaskCreationOptions.RunContinuationsAsynchronously);
        _ui.Post(_ =>
        {
            try
            {
                if (command.ExpectedRevision is long expected && expected != Interlocked.Read(ref _revision))
                {
                    completion.SetResult(Failure(command.Id, "conflict", "State revision changed before command execution"));
                    return;
                }
                Apply(command);
                Interlocked.Increment(ref _revision);
                completion.SetResult(new CommandResult { Id = command.Id, Ok = true, EffectiveState = ReadState() });
            }
            catch (NotSupportedException exception) { completion.SetResult(Failure(command.Id, "unsupported", exception.Message)); }
            catch (ArgumentException exception) { completion.SetResult(Failure(command.Id, "invalid", exception.Message)); }
            catch (Exception exception) { completion.SetResult(Failure(command.Id, "internal", exception.Message)); }
        }, null);
        cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
        return completion.Task;
    }

    private void Apply(CommandMessage command)
    {
        switch (command.Method)
        {
            case "control.adjust": Adjust(RequiredString(command, "control"), RequiredInt(command, "ticks"), OptionalDouble(command, "amount")); break;
            case "control.set": Set(RequiredString(command, "control"), Required(command, "value")); break;
            case "control.cycle": Cycle(RequiredString(command, "control"), RequiredInt(command, "direction")); break;
            case "control.toggle": Toggle(RequiredString(command, "control")); break;
            case "preset.apply": ApplyPreset(Required(command, "preset")); break;
            case "record.audio.set": SetRecording(Required(command, "enabled").GetBoolean()); break;
            default: throw new NotSupportedException($"Unknown command method: {command.Method}");
        }
    }

    private void Adjust(string control, int ticks, double? amount = null)
    {
        switch (control)
        {
            case "frequencyHz": _control.Frequency = Math.Max(0, _control.Frequency + LongDelta(ticks, amount, _control.StepSize)); break;
            case "centerFrequencyHz": _control.CenterFrequency = Math.Max(0, _control.CenterFrequency + LongDelta(ticks, amount, _control.StepSize)); break;
            case "stepHz": _control.StepSize = Math.Max(1, _control.StepSize + IntDelta(ticks, amount, 1)); break;
            case "volume": _control.AudioGain = Math.Clamp(_control.AudioGain + IntDelta(ticks, amount.HasValue ? amount * 100 : null, 2), 0, 100); break;
            case "audio.panning": _control.AudioPanning = Math.Clamp(_control.AudioPanning + FloatDelta(ticks, amount, 0.05), -1, 1); break;
            case "bandwidthHz": _control.FilterBandwidth = Math.Clamp(_control.FilterBandwidth + IntDelta(ticks, amount, Math.Max(10, _control.StepSize / 10)), 10, _control.MaximumFilterBandwidth); break;
            case "filter.order": _control.FilterOrder = Math.Clamp(_control.FilterOrder + IntDelta(ticks, amount, 2), 2, 1000); break;
            case "cwShiftHz": _control.CWShift = Math.Clamp(_control.CWShift + IntDelta(ticks, amount, 10), 0, 5000); break;
            case "frequencyShiftHz": _control.FrequencyShift = Math.Clamp(_control.FrequencyShift + LongDelta(ticks, amount, _control.StepSize), -2_000_000_000, 2_000_000_000); break;
            case "squelch.threshold": _control.SquelchThreshold = Math.Clamp(_control.SquelchThreshold + IntDelta(ticks, amount, 1), -150, 0); break;
            case "agc.threshold": _control.AgcThreshold = Math.Clamp(_control.AgcThreshold + IntDelta(ticks, amount, 1), -150, 0); break;
            case "agc.decay": _control.AgcDecay = Math.Clamp(_control.AgcDecay + IntDelta(ticks, amount, 10), 0, 5000); break;
            case "agc.slope": _control.AgcSlope = Math.Clamp(_control.AgcSlope + IntDelta(ticks, amount, 1), 0, 100); break;
            case "zoom": _control.Zoom = Math.Clamp(_control.Zoom + IntDelta(ticks, amount, 1), 0, 100); break;
            case "spectrum.attack": _control.SAttack = Math.Clamp(_control.SAttack + FloatDelta(ticks, amount, 0.01), 0, 1); break;
            case "spectrum.decay": _control.SDecay = Math.Clamp(_control.SDecay + FloatDelta(ticks, amount, 0.01), 0, 1); break;
            case "waterfall.attack": _control.WAttack = Math.Clamp(_control.WAttack + FloatDelta(ticks, amount, 0.01), 0, 1); break;
            case "waterfall.decay": _control.WDecay = Math.Clamp(_control.WDecay + FloatDelta(ticks, amount, 0.01), 0, 1); break;
            case "tuning.limit": _control.TuningLimit = Math.Clamp(_control.TuningLimit + FloatDelta(ticks, amount, 0.01), 0, 1); break;
            case "rf.attenuationDb":
                using (var hf = RequiredHf()) if (!hf.AdjustAttenuation(ticks)) throw new NotSupportedException("HF+ attenuation is unavailable in this SDR# build");
                break;
            default: throw new NotSupportedException($"Adjustment is not supported for {control}");
        }
    }

    private void Set(string control, JsonElement value)
    {
        switch (control)
        {
            case "frequencyHz": _control.Frequency = Math.Max(0, value.GetInt64()); break;
            case "centerFrequencyHz": _control.CenterFrequency = Math.Max(0, value.GetInt64()); break;
            case "stepHz": _control.StepSize = Math.Max(1, value.GetInt32()); break;
            case "volume": _control.AudioGain = Math.Clamp((int)Math.Round(value.GetDouble() * 100), 0, 100); break;
            case "muted": _control.AudioIsMuted = value.GetBoolean(); break;
            case "audio.panning": _control.AudioPanning = Math.Clamp(value.GetSingle(), -1, 1); break;
            case "unityGain": _control.UnityGain = value.GetBoolean(); break;
            case "filter.audio": _control.FilterAudio = value.GetBoolean(); break;
            case "mode": _control.DetectorType = Enum.Parse<DetectorType>(value.GetString() ?? "", true); break;
            case "bandwidthHz": _control.FilterBandwidth = Math.Clamp(value.GetInt32(), 10, _control.MaximumFilterBandwidth); break;
            case "filter.type": _control.FilterType = Enum.Parse<WindowType>(value.GetString() ?? "", true); break;
            case "filter.order": _control.FilterOrder = Math.Clamp(value.GetInt32(), 2, 1000); break;
            case "cwShiftHz": _control.CWShift = Math.Clamp(value.GetInt32(), 0, 5000); break;
            case "fm.stereo": _control.FmStereo = value.GetBoolean(); break;
            case "carrier.lock": _control.LockCarrier = value.GetBoolean(); break;
            case "antiFading": _control.AntiFading = value.GetBoolean(); break;
            case "demodulation.bypass": _control.BypassDemodulation = value.GetBoolean(); break;
            case "frequencyShift.enabled": _control.FrequencyShiftEnabled = value.GetBoolean(); break;
            case "frequencyShiftHz": _control.FrequencyShift = Math.Clamp(value.GetInt64(), -2_000_000_000, 2_000_000_000); break;
            case "snapToGrid": _control.SnapToGrid = value.GetBoolean(); break;
            case "centerFrequencyLocked": _control.CenterFrequencyIsLocked = value.GetBoolean(); break;
            case "tuning.style": _control.TuningStyle = Enum.Parse<TuningStyle>(value.GetString() ?? "", true); break;
            case "tuning.styleFrozen": _control.TuningStyleFreezed = value.GetBoolean(); break;
            case "tuning.limit": _control.TuningLimit = Math.Clamp(value.GetSingle(), 0, 1); break;
            case "squelch.enabled": _control.SquelchEnabled = value.GetBoolean(); break;
            case "squelch.threshold": _control.SquelchThreshold = Math.Clamp(value.GetInt32(), -150, 0); break;
            case "dsp.agc": _control.UseAgc = value.GetBoolean(); break;
            case "agc.hang": _control.AgcHang = value.GetBoolean(); break;
            case "agc.threshold": _control.AgcThreshold = Math.Clamp(value.GetInt32(), -150, 0); break;
            case "agc.decay": _control.AgcDecay = Math.Clamp(value.GetInt32(), 0, 5000); break;
            case "agc.slope": _control.AgcSlope = Math.Clamp(value.GetInt32(), 0, 100); break;
            case "iq.swap": _control.SwapIq = value.GetBoolean(); break;
            case "zoom": _control.Zoom = Math.Clamp(value.GetInt32(), 0, 100); break;
            case "spectrum.markPeaks": _control.MarkPeaks = value.GetBoolean(); break;
            case "spectrum.attack": _control.SAttack = Math.Clamp(value.GetSingle(), 0, 1); break;
            case "spectrum.decay": _control.SDecay = Math.Clamp(value.GetSingle(), 0, 1); break;
            case "waterfall.attack": _control.WAttack = Math.Clamp(value.GetSingle(), 0, 1); break;
            case "waterfall.decay": _control.WDecay = Math.Clamp(value.GetSingle(), 0, 1); break;
            case "spectrum.timeMarkers": _control.UseTimeMarkers = value.GetBoolean(); break;
            case "rds.useFec": _control.RdsUseFEC = value.GetBoolean(); break;
            case "rf.lna": using (var hf = RequiredHf()) if (!hf.SetLna(value.GetBoolean())) throw new NotSupportedException("HF+ LNA is unavailable"); break;
            case "rf.agcMode": using (var hf = RequiredHf()) if (!hf.SetAgc(value.GetString() ?? "off")) throw new NotSupportedException("HF+ AGC is unavailable"); break;
            case "rf.attenuationDb": using (var hf = RequiredHf()) if (!hf.SetAttenuation(value.GetDouble())) throw new NotSupportedException("HF+ attenuation is unavailable"); break;
            case "receiverRunning": if (value.GetBoolean()) _control.StartRadio(); else _control.StopRadio(); break;
            case "record.audio": SetRecording(value.GetBoolean()); break;
            default: throw new NotSupportedException($"Set is not supported for {control}");
        }
    }

    private void Cycle(string control, int direction)
    {
        if (direction == 0) return;
        switch (control)
        {
            case "stepHz": _control.StepSize = CycleValue(StepValues, _control.StepSize, direction); break;
            case "mode": _control.DetectorType = CycleValue(Modes, _control.DetectorType, direction); break;
            case "filter.type": _control.FilterType = CycleValue(Enum.GetValues<WindowType>(), _control.FilterType, direction); break;
            case "tuning.style": _control.TuningStyle = CycleValue(Enum.GetValues<TuningStyle>(), _control.TuningStyle, direction); break;
            case "rf.attenuationDb": using (var hf = RequiredHf()) if (!hf.AdjustAttenuation(Math.Sign(direction))) throw new NotSupportedException("HF+ attenuation is unavailable"); break;
            case "rf.agcMode":
                using (var hf = RequiredHf())
                {
                    var next = hf.Read().AgcMode == "off" ? "auto" : "off";
                    if (!hf.SetAgc(next)) throw new NotSupportedException("HF+ AGC is unavailable");
                }
                break;
            default: throw new NotSupportedException($"Cycle is not supported for {control}");
        }
    }

    private void Toggle(string control)
    {
        switch (control)
        {
            case "muted": _control.AudioIsMuted = !_control.AudioIsMuted; break;
            case "unityGain": _control.UnityGain = !_control.UnityGain; break;
            case "filter.audio": _control.FilterAudio = !_control.FilterAudio; break;
            case "fm.stereo": _control.FmStereo = !_control.FmStereo; break;
            case "carrier.lock": _control.LockCarrier = !_control.LockCarrier; break;
            case "antiFading": _control.AntiFading = !_control.AntiFading; break;
            case "demodulation.bypass": _control.BypassDemodulation = !_control.BypassDemodulation; break;
            case "frequencyShift.enabled": _control.FrequencyShiftEnabled = !_control.FrequencyShiftEnabled; break;
            case "snapToGrid": _control.SnapToGrid = !_control.SnapToGrid; break;
            case "centerFrequencyLocked": _control.CenterFrequencyIsLocked = !_control.CenterFrequencyIsLocked; break;
            case "tuning.styleFrozen": _control.TuningStyleFreezed = !_control.TuningStyleFreezed; break;
            case "squelch.enabled": _control.SquelchEnabled = !_control.SquelchEnabled; break;
            case "dsp.agc": _control.UseAgc = !_control.UseAgc; break;
            case "agc.hang": _control.AgcHang = !_control.AgcHang; break;
            case "iq.swap": _control.SwapIq = !_control.SwapIq; break;
            case "spectrum.markPeaks": _control.MarkPeaks = !_control.MarkPeaks; break;
            case "spectrum.timeMarkers": _control.UseTimeMarkers = !_control.UseTimeMarkers; break;
            case "rds.useFec": _control.RdsUseFEC = !_control.RdsUseFEC; break;
            case "receiverRunning": if (_control.IsPlaying) _control.StopRadio(); else _control.StartRadio(); break;
            case "record.audio": SetRecording(_recorder.Status.State != "recording"); break;
            case "rf.lna": using (var hf = RequiredHf()) { var next = hf.Read().Lna != true; if (!hf.SetLna(next)) throw new NotSupportedException("HF+ LNA is unavailable"); } break;
            default: throw new NotSupportedException($"Toggle is not supported for {control}");
        }
    }

    private void ApplyPreset(JsonElement preset)
    {
        _control.DetectorType = Enum.Parse<DetectorType>(preset.GetProperty("mode").GetString() ?? "", true);
        _control.FilterBandwidth = Math.Clamp(preset.GetProperty("bandwidthHz").GetInt32(), 10, _control.MaximumFilterBandwidth);
        _control.StepSize = Math.Max(1, preset.GetProperty("stepHz").GetInt32());
        _control.Frequency = Math.Max(0, preset.GetProperty("frequencyHz").GetInt64());
        if (preset.TryGetProperty("dspAgc", out var dspAgc) && dspAgc.TryGetProperty("enabled", out var enabled)) _control.UseAgc = enabled.GetBoolean();
        if (preset.TryGetProperty("includeAudio", out var includeAudio) && includeAudio.GetBoolean())
        {
            if (preset.TryGetProperty("volume", out var volume)) _control.AudioGain = Math.Clamp((int)Math.Round(volume.GetDouble() * 100), 0, 100);
            if (preset.TryGetProperty("muted", out var muted)) _control.AudioIsMuted = muted.GetBoolean();
        }
    }

    private void SetRecording(bool enabled)
    {
        if (enabled) _recorder.Start(_control.Frequency, _control.DetectorType.ToString(), _control.FilterBandwidth);
        else _recorder.Stop();
    }

    private Dictionary<string, object> ReadControls(RfState? rf, bool recording)
    {
        var values = new Dictionary<string, object>
        {
            ["frequencyHz"] = _control.Frequency,
            ["centerFrequencyHz"] = _control.CenterFrequency,
            ["stepHz"] = _control.StepSize,
            ["snapToGrid"] = _control.SnapToGrid,
            ["frequencyShift.enabled"] = _control.FrequencyShiftEnabled,
            ["frequencyShiftHz"] = _control.FrequencyShift,
            ["centerFrequencyLocked"] = _control.CenterFrequencyIsLocked,
            ["tuning.style"] = _control.TuningStyle.ToString(),
            ["tuning.styleFrozen"] = _control.TuningStyleFreezed,
            ["tuning.limit"] = _control.TuningLimit,
            ["volume"] = Math.Clamp(_control.AudioGain / 100.0, 0, 1),
            ["muted"] = _control.AudioIsMuted,
            ["audio.panning"] = _control.AudioPanning,
            ["unityGain"] = _control.UnityGain,
            ["filter.audio"] = _control.FilterAudio,
            ["mode"] = _control.DetectorType.ToString(),
            ["bandwidthHz"] = _control.FilterBandwidth,
            ["filter.type"] = _control.FilterType.ToString(),
            ["filter.order"] = _control.FilterOrder,
            ["cwShiftHz"] = _control.CWShift,
            ["fm.stereo"] = _control.FmStereo,
            ["carrier.lock"] = _control.LockCarrier,
            ["antiFading"] = _control.AntiFading,
            ["demodulation.bypass"] = _control.BypassDemodulation,
            ["squelch.enabled"] = _control.SquelchEnabled,
            ["squelch.threshold"] = _control.SquelchThreshold,
            ["dsp.agc"] = _control.UseAgc,
            ["agc.hang"] = _control.AgcHang,
            ["agc.threshold"] = _control.AgcThreshold,
            ["agc.decay"] = _control.AgcDecay,
            ["agc.slope"] = _control.AgcSlope,
            ["iq.swap"] = _control.SwapIq,
            ["receiverRunning"] = _control.IsPlaying,
            ["zoom"] = _control.Zoom,
            ["spectrum.markPeaks"] = _control.MarkPeaks,
            ["spectrum.attack"] = _control.SAttack,
            ["spectrum.decay"] = _control.SDecay,
            ["waterfall.attack"] = _control.WAttack,
            ["waterfall.decay"] = _control.WDecay,
            ["spectrum.timeMarkers"] = _control.UseTimeMarkers,
            ["rds.useFec"] = _control.RdsUseFEC,
            ["record.audio"] = recording
        };
        if (rf?.AgcMode is not null) values["rf.agcMode"] = rf.AgcMode;
        if (rf?.AttenuationDb is double attenuation) values["rf.attenuationDb"] = attenuation;
        if (rf?.Lna is bool lna) values["rf.lna"] = lna;
        return values;
    }

    private HfPlusSourceCapabilities RequiredHf() => HfPlusSourceCapabilities.TryCreate(_control.Source, _control.SourceName) ?? throw new NotSupportedException("This SDR# source exposes no writable HF+ controls");
    private static T CycleValue<T>(IReadOnlyList<T> values, T current, int direction)
    {
        var index = values.IndexOf(current);
        if (index < 0) index = 0;
        return values[(index + Math.Sign(direction) + values.Count) % values.Count];
    }
    private static JsonElement Required(CommandMessage command, string name) => command.Params.TryGetValue(name, out var value) ? value : throw new ArgumentException($"Missing parameter: {name}");
    private static double? OptionalDouble(CommandMessage command, string name) => command.Params.TryGetValue(name, out var value) && value.ValueKind == JsonValueKind.Number ? value.GetDouble() : null;
    private static string RequiredString(CommandMessage command, string name) => Required(command, name).GetString() ?? throw new ArgumentException($"{name} must be a string");
    private static int RequiredInt(CommandMessage command, string name) => Required(command, name).GetInt32();
    private static long LongDelta(int ticks, double? amount, double fallback) => checked((long)Math.Round(ticks * (amount ?? fallback)));
    private static int IntDelta(int ticks, double? amount, double fallback) => checked((int)Math.Round(ticks * (amount ?? fallback)));
    private static float FloatDelta(int ticks, double? amount, double fallback) => checked((float)(ticks * (amount ?? fallback)));
    private static CommandResult Failure(string id, string code, string message) => new() { Id = id, Ok = false, Error = new CommandError(code, message) };
}

internal static class ListExtensions
{
    public static int IndexOf<T>(this IReadOnlyList<T> values, T value)
    {
        for (var index = 0; index < values.Count; index++) if (EqualityComparer<T>.Default.Equals(values[index], value)) return index;
        return -1;
    }
}
