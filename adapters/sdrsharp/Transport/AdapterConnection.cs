using System.Diagnostics;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using SDRSharp.UlanziAdapter.Control;

namespace SDRSharp.UlanziAdapter.Transport;

internal sealed class AdapterConnection : IDisposable
{
    private readonly SharpCommandExecutor _executor;
    private readonly Dictionary<string, CapabilityDescriptor> _capabilities;
    private readonly CancellationTokenSource _shutdown = new();
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web) { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull };
    private ClientWebSocket? _socket;
    private Task? _loop;
    private int _snapshotPending;

    public AdapterConnection(SharpCommandExecutor executor, Dictionary<string, CapabilityDescriptor> capabilities)
    {
        _executor = executor;
        _capabilities = capabilities;
    }

    public string Status { get; private set; } = "Stopped";
    public event EventHandler? ConnectionChanged;

    public void Start() => _loop = Task.Run(() => ConnectionLoop(_shutdown.Token));

    public void ScheduleSnapshot()
    {
        if (Interlocked.Exchange(ref _snapshotPending, 1) != 0) return;
        _ = Task.Run(async () =>
        {
            await Task.Delay(50, _shutdown.Token).ConfigureAwait(false);
            Interlocked.Exchange(ref _snapshotPending, 0);
            await SendSnapshot(_shutdown.Token).ConfigureAwait(false);
        }, _shutdown.Token);
    }

    private async Task ConnectionLoop(CancellationToken cancellationToken)
    {
        var delay = 250;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var endpoint = await ReadEndpoint(cancellationToken).ConfigureAwait(false);
                using var socket = new ClientWebSocket();
                socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(5);
                SetStatus("Connecting");
                await socket.ConnectAsync(new Uri($"ws://{endpoint.Host}:{endpoint.Port}/control/v1"), cancellationToken).ConfigureAwait(false);
                _socket = socket;
                await SendHello(endpoint.Token, cancellationToken).ConfigureAwait(false);
                await SendSnapshot(cancellationToken).ConfigureAwait(false);
                SetStatus("Connected");
                delay = 250;
                await ReceiveLoop(socket, cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                SetStatus($"Waiting: {exception.Message}");
            }
            finally { _socket = null; }
            await Task.Delay(delay, cancellationToken).ConfigureAwait(false);
            delay = Math.Min(delay * 2, 10000);
        }
    }

    private async Task ReceiveLoop(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[64 * 1024];
        while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            WebSocketReceiveResult result;
            do
            {
                result = await socket.ReceiveAsync(buffer, cancellationToken).ConfigureAwait(false);
                if (result.MessageType == WebSocketMessageType.Close) return;
                if (message.Length + result.Count > buffer.Length) throw new InvalidDataException("IPC message exceeds 64 KiB");
                message.Write(buffer, 0, result.Count);
            } while (!result.EndOfMessage);
            using var document = JsonDocument.Parse(message.ToArray());
            var type = document.RootElement.GetProperty("type").GetString();
            if (type == "heartbeat")
            {
                await Send(new { type = "heartbeat", timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() }, cancellationToken).ConfigureAwait(false);
                continue;
            }
            if (type != "command") continue;
            var command = document.RootElement.Deserialize<CommandMessage>(_json) ?? throw new InvalidDataException("Invalid command");
            var response = await _executor.ExecuteAsync(command, cancellationToken).ConfigureAwait(false);
            await Send(response, cancellationToken).ConfigureAwait(false);
        }
    }

    private async Task SendHello(string token, CancellationToken cancellationToken)
    {
        var version = FileVersionInfo.GetVersionInfo(Environment.ProcessPath ?? "SDRSharp.exe").ProductVersion ?? "unknown";
        var state = await _executor.ReadStateAsync(cancellationToken).ConfigureAwait(false);
        await Send(new
        {
            type = "adapter.hello",
            protocolVersion = "1.0",
            token,
            app = "sdrsharp",
            appVersion = version,
            adapterVersion = "0.2.0",
            architecture = RuntimeInformation.ProcessArchitecture.ToString().ToLowerInvariant(),
            sourceName = state.SourceConnected ? "SDR# source" : "No source",
            targetVfo = "Radio",
            capabilities = _capabilities
        }, cancellationToken).ConfigureAwait(false);
    }

    private async Task SendSnapshot(CancellationToken cancellationToken)
    {
        if (_socket?.State != WebSocketState.Open) return;
        var state = await _executor.ReadStateAsync(cancellationToken).ConfigureAwait(false);
        await Send(new { type = "state.snapshot", state }, cancellationToken).ConfigureAwait(false);
    }

    private async Task Send(object value, CancellationToken cancellationToken)
    {
        var socket = _socket;
        if (socket?.State != WebSocketState.Open) return;
        var payload = JsonSerializer.SerializeToUtf8Bytes(value, _json);
        if (payload.Length > 64 * 1024) throw new InvalidDataException("IPC message exceeds 64 KiB");
        await _sendLock.WaitAsync(cancellationToken).ConfigureAwait(false);
        try { await socket.SendAsync(payload, WebSocketMessageType.Text, true, cancellationToken).ConfigureAwait(false); }
        finally { _sendLock.Release(); }
    }

    private static async Task<EndpointDescription> ReadEndpoint(CancellationToken cancellationToken)
    {
        var path = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "UlanziSDR", "endpoint.json");
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var stream = File.OpenRead(path);
                var endpoint = await JsonSerializer.DeserializeAsync<EndpointDescription>(stream, cancellationToken: cancellationToken).ConfigureAwait(false)
                    ?? throw new InvalidDataException("Invalid endpoint file");
                if (endpoint.Host != "127.0.0.1" || endpoint.ProtocolVersion != "1.0" || endpoint.Port is < 1 or > 65535 || string.IsNullOrWhiteSpace(endpoint.Token) || endpoint.Token.Length < 32)
                    throw new InvalidDataException("Endpoint is not a valid local protocol v1 endpoint");
                return endpoint;
            }
            catch (IOException) { await Task.Delay(1000, cancellationToken).ConfigureAwait(false); }
            catch (JsonException) { await Task.Delay(1000, cancellationToken).ConfigureAwait(false); }
            catch (InvalidDataException) { await Task.Delay(1000, cancellationToken).ConfigureAwait(false); }
        }
        throw new OperationCanceledException(cancellationToken);
    }

    private void SetStatus(string value)
    {
        Status = value;
        ConnectionChanged?.Invoke(this, EventArgs.Empty);
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        try { _loop?.Wait(TimeSpan.FromSeconds(2)); } catch { }
        _socket?.Dispose();
        _sendLock.Dispose();
        _shutdown.Dispose();
    }
}
