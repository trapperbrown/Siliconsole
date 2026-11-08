using System.Text;
using System.Text.Json;
using Siliconsole.SensorService;
using Siliconsole.SensorService.Generated;
using Siliconsole.SensorService.Ipc;
using Siliconsole.SensorService.SystemInfoCollection;
using Siliconsole.SensorService.Telemetry;

namespace Siliconsole.SensorService.Tests;

public class FramingTests
{
    [Fact]
    public async Task RoundTripsMultipleMessages()
    {
        var ms = new MemoryStream();
        ms.Write(Framing.Frame("{\"a\":1}"u8));
        ms.Write(Framing.Frame("{\"b\":2}"u8));
        ms.Position = 0;
        Assert.Equal("{\"a\":1}", Encoding.UTF8.GetString((await Framing.ReadAsync(ms, 1024, default))!));
        Assert.Equal("{\"b\":2}", Encoding.UTF8.GetString((await Framing.ReadAsync(ms, 1024, default))!));
        Assert.Null(await Framing.ReadAsync(ms, 1024, default));
    }

    [Fact]
    public void HeaderIsLittleEndianLength()
    {
        var f = Framing.Frame(new byte[300]);
        Assert.Equal(new byte[] { 44, 1, 0, 0 }, f[..4]);
        Assert.Equal(304, f.Length);
    }

    [Theory]
    [InlineData(new byte[] { 0, 0, 0, 0 })]              // zero length
    [InlineData(new byte[] { 0, 0, 0, 1 })]              // 16 MB, over the limit
    [InlineData(new byte[] { 5, 0 })]                    // truncated header
    [InlineData(new byte[] { 5, 0, 0, 0, 1, 2 })]        // truncated body
    public async Task RejectsBadFrames(byte[] raw)
    {
        await Assert.ThrowsAsync<InvalidDataException>(() => Framing.ReadAsync(new MemoryStream(raw), 1024, default));
    }
}

public class ValidationTests
{
    private static JsonElement J(string s) => JsonDocument.Parse(s).RootElement;
    private static bool Client(string s) => MessageValidator.Instance.ValidateClient(J(s), out _);

    [Theory]
    [InlineData("""{"type":"hello","protocolVersion":1,"client":"x"}""")]
    [InlineData("""{"type":"history_request","requestId":3,"ids":["/cpu/0/load/0"]}""")]
    [InlineData("""{"type":"history_request","requestId":3,"ids":[],"maxSamples":10}""")]
    [InlineData("""{"type":"set_interval","intervalMs":500}""")]
    public void AcceptsValidClientMessages(string json) => Assert.True(Client(json));

    [Theory]
    [InlineData("""{"type":"shutdown"}""")]                                        // unknown type
    [InlineData("""{"type":"set_interval","intervalMs":500,"extra":1}""")]         // unknown property
    [InlineData("""{"type":"set_interval","intervalMs":"500"}""")]                 // wrong type
    [InlineData("""{"type":"set_interval","intervalMs":0}""")]                     // below minimum
    [InlineData("""{"type":"hello","protocolVersion":1}""")]                       // missing field
    [InlineData("""{"type":"sensor_frame","timestamp":1,"values":[]}""")]         // service-only type
    [InlineData("""[1,2,3]""")]
    public void RejectsInvalidClientMessages(string json) => Assert.False(Client(json));

    /// <summary>The generated C# records must serialize to JSON the schema accepts.</summary>
    [Fact]
    public void GeneratedServiceRecordsMatchSchema()
    {
        var fake = new FakeTelemetrySource();
        object[] messages =
        [
            new ServiceHello { ProtocolVersion = 1, AppName = "x", ServiceVersion = "1.0.0", IntervalMs = 1000, MinIntervalMs = 250, MaxIntervalMs = 5000, RingBufferSamples = 600 },
            new SystemInfoMessage { Info = fake.GetSystemInfo() },
            fake.GetCatalog(),
            fake.MakeFrame(),
            fake.GetHistory(new HistoryRequest { RequestId = 1, Ids = ["/fake/0/temperature/0"] }),
        ];
        foreach (var m in messages)
        {
            var el = J(JsonSerializer.Serialize(m, m.GetType(), JsonOpts.Options));
            Assert.True(MessageValidator.Instance.ValidateService(el, out var err), $"{m.GetType().Name}: {err}");
        }
    }
}

public class SampleHistoryTests
{
    [Fact]
    public void WrapsAroundAndReturnsChronologicalOrder()
    {
        var h = new SampleHistory(3);
        h.Reset(["a"]);
        for (var i = 1; i <= 5; i++) h.Append(i, [i * 10f]);
        var r = h.Query(7, ["a", "missing"], null);
        Assert.Equal(7, r.RequestId);
        Assert.Equal(new long[] { 3, 4, 5 }, r.Timestamps);
        Assert.Single(r.Series);
        Assert.Equal(new double?[] { 30, 40, 50 }, r.Series[0].Values);
    }

    [Fact]
    public void NewSensorsGetNullHistoryAndExistingKeepTheirs()
    {
        var h = new SampleHistory(4);
        h.Reset(["a"]);
        h.Append(1, [1f]);
        h.Reset(["b", "a"]);
        h.Append(2, [float.NaN, 2f]);
        var r = h.Query(0, ["a", "b"], 2);
        Assert.Equal(new double?[] { 1, 2 }, r.Series.Single(s => s.Id == "a").Values);
        Assert.Equal(new double?[] { null, null }, r.Series.Single(s => s.Id == "b").Values);
    }

    [Fact]
    public void EmptyHistoryReturnsNoSamples() =>
        Assert.Empty(new SampleHistory(4).Query(0, ["a"], null).Timestamps);
}

public class DriverVersionTests
{
    [Theory]
    [InlineData(0x10DEu, "32.0.15.8180", "581.80 (32.0.15.8180)")]
    [InlineData(0x10DEu, "32.0.16.2114", "621.14 (32.0.16.2114)")]
    [InlineData(0x1002u, "32.0.21030.2001", "32.0.21030.2001")]
    [InlineData(0x10DEu, "bogus", "bogus")]
    public void FormatsNvidiaVersions(uint vendor, string raw, string expected) =>
        Assert.Equal(expected, SystemInfoCollector.FormatDriver(vendor, raw));
}
