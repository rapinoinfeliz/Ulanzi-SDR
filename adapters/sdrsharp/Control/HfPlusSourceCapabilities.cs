using System.Collections;
using System.Reflection;

namespace SDRSharp.UlanziAdapter.Control;

internal sealed class HfPlusSourceCapabilities : IDisposable
{
    private readonly object _source;
    private readonly PropertyInfo? _agc;
    private readonly PropertyInfo? _preamp;
    private readonly PropertyInfo? _attenuator;
    private readonly PropertyInfo? _attenuators;

    private HfPlusSourceCapabilities(object source)
    {
        _source = source;
        var type = source.GetType();
        _agc = type.GetProperty("AgcEnabled", BindingFlags.Public | BindingFlags.Instance);
        _preamp = type.GetProperty("PreampEnabled", BindingFlags.Public | BindingFlags.Instance);
        _attenuator = type.GetProperty("PreampAttenuator", BindingFlags.Public | BindingFlags.Instance);
        _attenuators = type.GetProperty("PreampAttenuators", BindingFlags.Public | BindingFlags.Instance);
    }

    public static HfPlusSourceCapabilities? TryCreate(object? source, string sourceName)
    {
        if (source is null || !sourceName.Contains("Airspy HF", StringComparison.OrdinalIgnoreCase)) return null;
        var result = new HfPlusSourceCapabilities(source);
        return result._agc is null && result._preamp is null && result._attenuator is null ? null : result;
    }

    public Dictionary<string, CapabilityDescriptor> Describe()
    {
        var result = new Dictionary<string, CapabilityDescriptor>();
        if (_agc?.CanRead == true && _agc.CanWrite) result["rf.agcMode"] = CapabilityDescriptor.ReadWrite(values: ["off", "auto"], experimental: true);
        if (_preamp?.CanRead == true && _preamp.CanWrite) result["rf.lna"] = CapabilityDescriptor.ReadWrite(values: [true, false], experimental: true);
        var values = AttenuatorValues().Cast<object>().ToArray();
        if (_attenuator?.CanRead == true && _attenuator.CanWrite && values.Length > 0) result["rf.attenuationDb"] = CapabilityDescriptor.ReadWrite(values: values, experimental: true);
        return result;
    }

    public RfState Read()
    {
        return new RfState
        {
            AgcMode = ReadBoolean(_agc) is true ? "auto" : "off",
            Lna = ReadBoolean(_preamp),
            AttenuationDb = ConvertToDouble(_attenuator?.GetValue(_source))
        };
    }

    public bool SetAgc(string mode) => WriteAndVerify(_agc, mode != "off");
    public bool SetLna(bool enabled) => WriteAndVerify(_preamp, enabled);

    public bool AdjustAttenuation(int ticks)
    {
        var values = AttenuatorValues();
        if (_attenuator is null || values.Count == 0) return false;
        var current = ConvertToDouble(_attenuator.GetValue(_source)) ?? values[0];
        var index = values.FindIndex(value => Math.Abs(value - current) < 0.01);
        index = Math.Clamp(index + ticks, 0, values.Count - 1);
        return WriteConvertedAndVerify(_attenuator, values[index]);
    }

    private List<double> AttenuatorValues()
    {
        if (_attenuators?.GetValue(_source) is not IEnumerable values) return [];
        return values.Cast<object>().Select(ConvertToDouble).Where(value => value.HasValue).Select(value => value!.Value).Distinct().Order().ToList();
    }

    private bool? ReadBoolean(PropertyInfo? property) => property?.CanRead == true && property.GetValue(_source) is bool value ? value : null;

    private bool WriteAndVerify(PropertyInfo? property, bool value)
    {
        if (property?.CanWrite != true) return false;
        property.SetValue(_source, value);
        return Equals(property.GetValue(_source), value);
    }

    private bool WriteConvertedAndVerify(PropertyInfo property, double value)
    {
        var converted = Convert.ChangeType(value, Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType);
        property.SetValue(_source, converted);
        return Math.Abs((ConvertToDouble(property.GetValue(_source)) ?? double.NaN) - value) < 0.01;
    }

    private static double? ConvertToDouble(object? value)
    {
        try { return value is null ? null : Convert.ToDouble(value); }
        catch { return null; }
    }

    public void Dispose() { }
}
