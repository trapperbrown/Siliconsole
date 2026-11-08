using System.Runtime.InteropServices;

namespace Siliconsole.SensorService.SystemInfoCollection;

/// <summary>Minimal DXGI adapter enumeration via raw COM vtable calls (no extra dependency).</summary>
internal static unsafe class Dxgi
{
    public readonly record struct Adapter(string Description, uint VendorId, uint DeviceId, long DedicatedVideoMemory, long SharedSystemMemory);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct AdapterDesc1
    {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
        public uint VendorId, DeviceId, SubSysId, Revision;
        public nuint DedicatedVideoMemory, DedicatedSystemMemory, SharedSystemMemory;
        public long AdapterLuid;
        public uint Flags;
    }

    private const uint SoftwareAdapterFlag = 2;
    private const int DxgiErrorNotFound = unchecked((int)0x887A0002);
    private static readonly Guid IidFactory1 = new("770aae78-f26f-4dba-a829-253c83d1b387");

    [DllImport("dxgi.dll")]
    private static extern int CreateDXGIFactory1(in Guid riid, out IntPtr factory);

    // vtable slots: IUnknown(0-2), IDXGIObject(3-6), IDXGIFactory(7-11), IDXGIFactory1.EnumAdapters1 = 12
    // IDXGIAdapter: EnumOutputs 7, GetDesc 8, CheckInterfaceSupport 9, IDXGIAdapter1.GetDesc1 = 10
    private const int SlotRelease = 2, SlotEnumAdapters1 = 12, SlotGetDesc1 = 10;

    public static List<Adapter> EnumerateAdapters()
    {
        var result = new List<Adapter>();
        if (CreateDXGIFactory1(IidFactory1, out var factory) < 0) return result;
        try
        {
            var enumAdapters = (delegate* unmanaged[Stdcall]<IntPtr, uint, out IntPtr, int>)VTable(factory, SlotEnumAdapters1);
            for (uint i = 0; ; i++)
            {
                var hr = enumAdapters(factory, i, out var adapter);
                if (hr == DxgiErrorNotFound || hr < 0) break;
                try
                {
                    var getDesc = (delegate* unmanaged[Stdcall]<IntPtr, IntPtr, int>)VTable(adapter, SlotGetDesc1);
                    var buf = Marshal.AllocHGlobal(Marshal.SizeOf<AdapterDesc1>());
                    try
                    {
                        if (getDesc(adapter, buf) < 0) continue;
                        var d = Marshal.PtrToStructure<AdapterDesc1>(buf);
                        if ((d.Flags & SoftwareAdapterFlag) != 0) continue;
                        result.Add(new Adapter(d.Description, d.VendorId, d.DeviceId, (long)d.DedicatedVideoMemory, (long)d.SharedSystemMemory));
                    }
                    finally { Marshal.FreeHGlobal(buf); }
                }
                finally { Release(adapter); }
            }
        }
        finally { Release(factory); }
        return result;
    }

    private static IntPtr VTable(IntPtr obj, int slot) => (*(IntPtr**)obj)[slot];

    private static void Release(IntPtr obj) =>
        ((delegate* unmanaged[Stdcall]<IntPtr, uint>)VTable(obj, SlotRelease))(obj);
}
