using System.Buffers;
using System.Threading.Channels;
using SDRSharp.Radio;

namespace SDRSharp.UlanziAdapter.Recording;

internal sealed record RecordingStatus(string State, string? Path, TimeSpan Duration, long DroppedBuffers, string? Error);

internal sealed class MonitorAudioRecorder : IDisposable
{
    private readonly AudioBlockProcessor _processor = new();
    private readonly object _gate = new();
    private CancellationTokenSource? _recordingCancellation;
    private Task? _writerTask;
    private DateTimeOffset? _started;
    private string? _path;
    private string? _error;

    public AudioBlockProcessor Processor => _processor;
    public RecordingStatus Status => new(
        _writerTask is null ? (_error is null ? "idle" : "error") : "recording",
        _path,
        _started.HasValue ? DateTimeOffset.UtcNow - _started.Value : TimeSpan.Zero,
        _processor.DroppedBuffers,
        _error);

    public void Start(long frequency, string mode, int bandwidth)
    {
        lock (_gate)
        {
            if (_writerTask is not null) return;
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "SDRSharp Recordings");
            Directory.CreateDirectory(root);
            var safeMode = string.Concat(mode.Where(char.IsLetterOrDigit));
            _path = Path.Combine(root, $"{DateTimeOffset.UtcNow:yyyyMMddTHHmmssZ}_{frequency}_{safeMode}.wav");
            _error = null;
            _started = DateTimeOffset.UtcNow;
            _recordingCancellation = new CancellationTokenSource();
            _processor.ResetStatistics();
            _processor.Enabled = true;
            _writerTask = Task.Run(() => WriteLoop(_path, frequency, mode, bandwidth, _recordingCancellation.Token));
        }
    }

    public void Stop()
    {
        Task? task;
        lock (_gate)
        {
            _processor.Enabled = false;
            _recordingCancellation?.Cancel();
            task = _writerTask;
        }
        try { task?.Wait(TimeSpan.FromSeconds(3)); } catch (Exception exception) { _error = exception.GetBaseException().Message; }
        lock (_gate)
        {
            _writerTask = null;
            _recordingCancellation?.Dispose();
            _recordingCancellation = null;
            _started = null;
        }
    }

    private async Task WriteLoop(string path, long frequency, string mode, int bandwidth, CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.ReadWrite, FileShare.Read, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var writer = new BinaryWriter(stream, System.Text.Encoding.UTF8, true);
            WriteWaveHeader(writer, Math.Max(8000, (int)Math.Round(_processor.SampleRate)), 0);
            long sampleCount = 0;
            try
            {
                await foreach (var block in _processor.ReadAll(cancellationToken))
                {
                    try
                    {
                        for (var index = 0; index < block.Length; index++)
                        {
                            var pcm = (short)Math.Clamp(block.Buffer[index] * short.MaxValue, short.MinValue, short.MaxValue);
                            writer.Write(pcm);
                        }
                        sampleCount += block.Length;
                    }
                    finally { ArrayPool<float>.Shared.Return(block.Buffer); }
                    if (stream.Position >= 2_000_000_000L) break;
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
            stream.Position = 0;
            WriteWaveHeader(writer, Math.Max(8000, (int)Math.Round(_processor.SampleRate)), checked((int)(sampleCount * sizeof(short))));
            await stream.FlushAsync(CancellationToken.None).ConfigureAwait(false);
            var metadata = new { frequencyHz = frequency, mode, bandwidthHz = bandwidth, sampleRate = _processor.SampleRate, samples = sampleCount, droppedBuffers = _processor.DroppedBuffers };
            await File.WriteAllTextAsync(Path.ChangeExtension(path, ".json"), System.Text.Json.JsonSerializer.Serialize(metadata, new System.Text.Json.JsonSerializerOptions { WriteIndented = true })).ConfigureAwait(false);
        }
        catch (Exception exception) { _error = exception.Message; }
        finally
        {
            while (_processor.TryRead(out var block)) ArrayPool<float>.Shared.Return(block.Buffer);
        }
    }

    private static void WriteWaveHeader(BinaryWriter writer, int sampleRate, int dataBytes)
    {
        writer.Write("RIFF"u8.ToArray()); writer.Write(36 + dataBytes); writer.Write("WAVE"u8.ToArray());
        writer.Write("fmt "u8.ToArray()); writer.Write(16); writer.Write((short)1); writer.Write((short)1);
        writer.Write(sampleRate); writer.Write(sampleRate * 2); writer.Write((short)2); writer.Write((short)16);
        writer.Write("data"u8.ToArray()); writer.Write(dataBytes);
    }

    public void Dispose() => Stop();
}

internal sealed record AudioBlock(float[] Buffer, int Length);

internal sealed unsafe class AudioBlockProcessor : IRealProcessor, IStreamProcessor, IBaseProcessor
{
    private readonly Channel<AudioBlock> _blocks = Channel.CreateBounded<AudioBlock>(new BoundedChannelOptions(128)
    {
        FullMode = BoundedChannelFullMode.Wait,
        SingleReader = true,
        SingleWriter = true
    });
    private long _droppedBuffers;

    public bool Enabled { get; set; }
    public double SampleRate { get; set; } = 48000;
    public long DroppedBuffers => Interlocked.Read(ref _droppedBuffers);

    public void ResetStatistics() => Interlocked.Exchange(ref _droppedBuffers, 0);

    public void Process(float* buffer, int length)
    {
        if (!Enabled || length <= 0) return;
        var rented = ArrayPool<float>.Shared.Rent(length);
        new ReadOnlySpan<float>(buffer, length).CopyTo(rented);
        if (!_blocks.Writer.TryWrite(new AudioBlock(rented, length)))
        {
            ArrayPool<float>.Shared.Return(rented);
            Interlocked.Increment(ref _droppedBuffers);
        }
    }

    public IAsyncEnumerable<AudioBlock> ReadAll(CancellationToken cancellationToken) => _blocks.Reader.ReadAllAsync(cancellationToken);
    public bool TryRead(out AudioBlock block) => _blocks.Reader.TryRead(out block!);
}
