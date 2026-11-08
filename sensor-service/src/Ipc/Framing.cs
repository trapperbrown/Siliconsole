using System.Buffers.Binary;

namespace Siliconsole.SensorService.Ipc;

/// <summary>Wire format: 4 byte little-endian unsigned length, then that many bytes of UTF-8 JSON.</summary>
internal static class Framing
{
    public const int HeaderBytes = 4;

    /// <summary>Builds a complete frame once so it can be broadcast to many clients without copying.</summary>
    public static byte[] Frame(ReadOnlySpan<byte> payload)
    {
        var buf = new byte[HeaderBytes + payload.Length];
        BinaryPrimitives.WriteUInt32LittleEndian(buf, (uint)payload.Length);
        payload.CopyTo(buf.AsSpan(HeaderBytes));
        return buf;
    }

    /// <summary>Reads one message. Returns null on a clean end of stream before a header starts.</summary>
    /// <exception cref="InvalidDataException">Zero length, oversize, or truncated message.</exception>
    public static async Task<byte[]?> ReadAsync(Stream stream, int maxBytes, CancellationToken ct)
    {
        var header = new byte[HeaderBytes];
        var got = await stream.ReadAtLeastAsync(header, HeaderBytes, throwOnEndOfStream: false, ct);
        if (got == 0) return null;
        if (got < HeaderBytes) throw new InvalidDataException("Truncated message header.");

        var length = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (length == 0 || length > (uint)maxBytes)
            throw new InvalidDataException($"Message length {length} outside 1..{maxBytes}.");

        var payload = new byte[length];
        got = await stream.ReadAtLeastAsync(payload, (int)length, throwOnEndOfStream: false, ct);
        if (got < length) throw new InvalidDataException("Truncated message body.");
        return payload;
    }
}
