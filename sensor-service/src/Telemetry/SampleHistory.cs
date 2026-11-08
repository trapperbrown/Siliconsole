using Siliconsole.SensorService.Generated;

namespace Siliconsole.SensorService.Telemetry;

/// <summary>
/// Fixed-size ring buffer: one shared timestamp ring plus one value ring per sensor.
/// All sensors are sampled on the same tick, so they share the head index.
/// </summary>
internal sealed class SampleHistory(int capacity)
{
    private readonly object _gate = new();
    private readonly long[] _timestamps = new long[capacity];
    private Dictionary<string, float[]> _byId = new();
    private float[][] _rows = [];
    private int _head;
    private int _count;

    public int Capacity => capacity;

    /// <summary>Sets the sensor list (in catalog order). Existing sensors keep their history.</summary>
    public void Reset(IReadOnlyList<string> ids)
    {
        lock (_gate)
        {
            var next = new Dictionary<string, float[]>(ids.Count);
            var rows = new float[ids.Count][];
            for (var i = 0; i < ids.Count; i++)
            {
                if (!_byId.TryGetValue(ids[i], out var row))
                {
                    row = new float[capacity];
                    Array.Fill(row, float.NaN);
                }
                rows[i] = row;
                next[ids[i]] = row;
            }
            _byId = next;
            _rows = rows;
        }
    }

    /// <summary>Appends one sample per sensor, aligned with the ids passed to <see cref="Reset"/>.</summary>
    public void Append(long timestamp, ReadOnlySpan<float> values)
    {
        lock (_gate)
        {
            _timestamps[_head] = timestamp;
            var n = Math.Min(values.Length, _rows.Length);
            for (var i = 0; i < n; i++) _rows[i][_head] = values[i];
            _head = (_head + 1) % capacity;
            if (_count < capacity) _count++;
        }
    }

    public HistoryResponse Query(int requestId, IEnumerable<string> ids, int? maxSamples)
    {
        lock (_gate)
        {
            var n = Math.Min(_count, Math.Max(1, maxSamples ?? capacity));
            if (_count == 0) n = 0;
            var start = (_head - n + capacity) % capacity;
            var ts = new long[n];
            for (var k = 0; k < n; k++) ts[k] = _timestamps[(start + k) % capacity];

            var series = new List<HistorySeries>();
            foreach (var id in ids.Distinct())
            {
                if (!_byId.TryGetValue(id, out var row)) continue;
                var values = new double?[n];
                for (var k = 0; k < n; k++) values[k] = Sanitize(row[(start + k) % capacity]);
                series.Add(new HistorySeries { Id = id, Values = values });
            }
            return new HistoryResponse { RequestId = requestId, Timestamps = ts, Series = series };
        }
    }

    /// <summary>JSON has no NaN or Infinity, and 4 decimals is plenty for any sensor.</summary>
    public static double? Sanitize(float? v) =>
        v is { } f && float.IsFinite(f) ? Math.Round((double)f, 4) : null;
}
