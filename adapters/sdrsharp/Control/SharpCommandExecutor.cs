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
            Rf = hf?.Read(),
            Recorder = new RecorderState
            {
                Status = record.State,
                Path = record.Path,
                DurationSeconds = record.Duration.TotalSeconds,
                DroppedBuffers = record.DroppedBuffers,
                Error = record.Error
            },
            Signal = new SignalState(_control.VisualSNR, _control.VisualPeak, _control.VisualFloor)
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
            case "control.adjust": Adjust(RequiredString(command, "control"), RequiredInt(command, "ticks")); break;
            case "control.set": Set(RequiredString(command, "control"), Required(command, "value")); break;
            case "control.cycle": Cycle(RequiredString(command, "control"), RequiredInt(command, "direction")); break;
            case "preset.apply": ApplyPreset(Required(command, "preset")); break;
            case "record.audio.set": SetRecording(Required(command, "enabled").GetBoolean()); break;
            default: throw new NotSupportedException($"Unknown command method: {command.Method}");
        }
    }

    private void Adjust(string control, int ticks)
    {
        switch (control)
        {
            case "frequencyHz": _control.Frequency = Math.Max(0, _control.Frequency + ((long)_control.StepSize * ticks)); break;
            case "volume": _control.AudioGain = Math.Clamp(_control.AudioGain + ticks * 2, 0, 100); break;
            case "bandwidthHz": _control.FilterBandwidth = Math.Clamp(_control.FilterBandwidth + ticks * Math.Max(10, _control.StepSize / 10), 10, _control.MaximumFilterBandwidth); break;
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
            case "stepHz": _control.StepSize = Math.Max(1, value.GetInt32()); break;
            case "volume": _control.AudioGain = Math.Clamp((int)Math.Round(value.GetDouble() * 100), 0, 100); break;
            case "muted": _control.AudioIsMuted = value.GetBoolean(); break;
            case "mode": _control.DetectorType = Enum.Parse<DetectorType>(value.GetString() ?? "", true); break;
            case "bandwidthHz": _control.FilterBandwidth = Math.Clamp(value.GetInt32(), 10, _control.MaximumFilterBandwidth); break;
            case "dsp.agc": _control.UseAgc = value.GetBoolean(); break;
            case "rf.lna": using (var hf = RequiredHf()) if (!hf.SetLna(value.GetBoolean())) throw new NotSupportedException("HF+ LNA is unavailable"); break;
            case "rf.agcMode": using (var hf = RequiredHf()) if (!hf.SetAgc(value.GetString() ?? "off")) throw new NotSupportedException("HF+ AGC is unavailable"); break;
            case "receiverRunning": if (value.GetBoolean()) _control.StartRadio(); else _control.StopRadio(); break;
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

    private HfPlusSourceCapabilities RequiredHf() => HfPlusSourceCapabilities.TryCreate(_control.Source, _control.SourceName) ?? throw new NotSupportedException("This SDR# source exposes no writable HF+ controls");
    private static T CycleValue<T>(IReadOnlyList<T> values, T current, int direction)
    {
        var index = values.IndexOf(current);
        if (index < 0) index = 0;
        return values[(index + Math.Sign(direction) + values.Count) % values.Count];
    }
    private static JsonElement Required(CommandMessage command, string name) => command.Params.TryGetValue(name, out var value) ? value : throw new ArgumentException($"Missing parameter: {name}");
    private static string RequiredString(CommandMessage command, string name) => Required(command, name).GetString() ?? throw new ArgumentException($"{name} must be a string");
    private static int RequiredInt(CommandMessage command, string name) => Required(command, name).GetInt32();
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
