using System.Text.Json.Serialization;

namespace SDRSharp.UlanziAdapter.Control;

public sealed record CapabilityDescriptor
{
    [JsonPropertyName("access")] public string Access { get; init; } = "readwrite";
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("unit")] public string? Unit { get; init; }
    [JsonPropertyName("minimum")] public double? Minimum { get; init; }
    [JsonPropertyName("maximum")] public double? Maximum { get; init; }
    [JsonPropertyName("step")] public double? Step { get; init; }
    [JsonPropertyName("values")] public object[]? Values { get; init; }
    [JsonPropertyName("experimental")] public bool? Experimental { get; init; }

    public static CapabilityDescriptor ReadWrite(double? minimum = null, double? maximum = null, double? step = null, object[]? values = null, bool experimental = false, string? label = null, string? category = null, string? unit = null) =>
        new() { Minimum = minimum, Maximum = maximum, Step = step, Values = values, Experimental = experimental ? true : null, Label = label, Category = category, Unit = unit };
}

public sealed record RecorderState
{
    [JsonPropertyName("status")] public string Status { get; init; } = "idle";
    [JsonPropertyName("path")] public string? Path { get; init; }
    [JsonPropertyName("durationSeconds")] public double? DurationSeconds { get; init; }
    [JsonPropertyName("droppedBuffers")] public long? DroppedBuffers { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
}

public sealed record RfState
{
    [JsonPropertyName("agcMode")] public string? AgcMode { get; init; }
    [JsonPropertyName("attenuationDb")] public double? AttenuationDb { get; init; }
    [JsonPropertyName("lna")] public bool? Lna { get; init; }
    [JsonPropertyName("overallGainDb")] public double? OverallGainDb { get; init; }
}

public sealed record DspAgcState([property: JsonPropertyName("enabled")] bool Enabled);
public sealed record SignalState(
    [property: JsonPropertyName("snrDb")] double SnrDb,
    [property: JsonPropertyName("peakDb")] double PeakDb,
    [property: JsonPropertyName("floorDb")] double FloorDb);

public sealed record RadioState
{
    [JsonPropertyName("revision")] public long Revision { get; init; }
    [JsonPropertyName("sourceConnected")] public bool SourceConnected { get; init; }
    [JsonPropertyName("receiverRunning")] public bool ReceiverRunning { get; init; }
    [JsonPropertyName("targetVfo")] public string TargetVfo { get; init; } = "Radio";
    [JsonPropertyName("frequencyHz")] public long FrequencyHz { get; init; }
    [JsonPropertyName("stepHz")] public int StepHz { get; init; }
    [JsonPropertyName("volume")] public double Volume { get; init; }
    [JsonPropertyName("muted")] public bool Muted { get; init; }
    [JsonPropertyName("mode")] public string Mode { get; init; } = "AM";
    [JsonPropertyName("bandwidthHz")] public int BandwidthHz { get; init; }
    [JsonPropertyName("dspAgc")] public DspAgcState? DspAgc { get; init; }
    [JsonPropertyName("rf")] public RfState? Rf { get; init; }
    [JsonPropertyName("recorder")] public RecorderState Recorder { get; init; } = new();
    [JsonPropertyName("signal")] public SignalState? Signal { get; init; }
    [JsonPropertyName("controls")] public Dictionary<string, object> Controls { get; init; } = [];

    public string ToDisplayString() => $"{FrequencyHz:N0} Hz | {Mode} | BW {BandwidthHz:N0} Hz\r\nStep {StepHz:N0} Hz | Volume {Volume:P0} | Mute {Muted}\r\nRecorder: {Recorder.Status}";
}

public sealed record EndpointDescription(
    [property: JsonPropertyName("host")] string Host,
    [property: JsonPropertyName("port")] int Port,
    [property: JsonPropertyName("token")] string Token,
    [property: JsonPropertyName("protocolVersion")] string ProtocolVersion);

public sealed record CommandMessage
{
    [JsonPropertyName("type")] public string Type { get; init; } = "command";
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("method")] public string Method { get; init; } = "";
    [JsonPropertyName("params")] public Dictionary<string, System.Text.Json.JsonElement> Params { get; init; } = [];
    [JsonPropertyName("expectedRevision")] public long? ExpectedRevision { get; init; }
}

public sealed record CommandError(
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("message")] string Message);

public sealed record CommandResult
{
    [JsonPropertyName("type")] public string Type { get; init; } = "command.result";
    [JsonPropertyName("id")] public string Id { get; init; } = "";
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("effectiveState")] public RadioState? EffectiveState { get; init; }
    [JsonPropertyName("error")] public CommandError? Error { get; init; }
}
