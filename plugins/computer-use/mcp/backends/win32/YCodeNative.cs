// YCodeNative — computer-use win32 后端的全部 Win32 互操作（唯一出处）。
// 由各 .ps1 经 `Add-Type -Path "$PSScriptRoot\YCodeNative.cs"` 编译加载；
// 独立成文件便于审查，也避免 PowerShell 内联 C# 触发 AMSI 误报。
using System;
using System.Runtime.InteropServices;

public class YCodeNative
{
    // ---- 进程/窗口 ----
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left, Top, Right, Bottom; }

    // ---- 输入注入（SendInput）----
    [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);

    [StructLayout(LayoutKind.Sequential)]
    public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Sequential)]
    public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
    [StructLayout(LayoutKind.Explicit)]
    public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
    [StructLayout(LayoutKind.Sequential)]
    public struct INPUT { public uint type; public INPUTUNION u; }

    public const uint MOUSE_LEFTDOWN = 0x0002, MOUSE_LEFTUP = 0x0004,
        MOUSE_RIGHTDOWN = 0x0008, MOUSE_RIGHTUP = 0x0010,
        MOUSE_MIDDLEDOWN = 0x0020, MOUSE_MIDDLEUP = 0x0040,
        MOUSE_WHEEL = 0x0800, MOUSE_HWHEEL = 0x1000;
    public const uint KEY_KEYUP = 0x0002, KEY_EXTENDED = 0x0008, KEY_UNICODE = 0x0004;
    public const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;

    public static void Mouse(uint flags, int data)
    {
        var arr = new INPUT[1];
        arr[0].type = INPUT_MOUSE;
        arr[0].u.mi.mouseData = (uint)data;
        arr[0].u.mi.dwFlags = flags;
        SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void Key(ushort vk, bool up, bool extended)
    {
        var arr = new INPUT[1];
        arr[0].type = INPUT_KEYBOARD;
        arr[0].u.ki.wVk = vk;
        arr[0].u.ki.dwFlags = (up ? KEY_KEYUP : 0) | (extended ? KEY_EXTENDED : 0);
        SendInput(1, arr, Marshal.SizeOf(typeof(INPUT)));
    }

    public static void KeyChar(char c)
    {
        var down = new INPUT[1]; down[0].type = INPUT_KEYBOARD;
        down[0].u.ki.wVk = 0; down[0].u.ki.wScan = c; down[0].u.ki.dwFlags = KEY_UNICODE;
        var up = new INPUT[1]; up[0].type = INPUT_KEYBOARD;
        up[0].u.ki.wVk = 0; up[0].u.ki.wScan = c; up[0].u.ki.dwFlags = KEY_UNICODE | KEY_KEYUP;
        SendInput(1, down, Marshal.SizeOf(typeof(INPUT)));
        SendInput(1, up, Marshal.SizeOf(typeof(INPUT)));
    }

    // ---- 屏幕截取（GDI 拷屏 + JPEG 编码；C# 侧实现，见文件头说明）----
    public static byte[] CaptureScreen(int x, int y, int w, int h, int maxEdge, long quality)
    {
        using (var bmp = new System.Drawing.Bitmap(w, h))
        using (var g = System.Drawing.Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h));
            var outBmp = bmp;
            var scale = Math.Max(w, h) > maxEdge ? (double)maxEdge / Math.Max(w, h) : 1.0;
            if (scale < 1.0)
            {
                outBmp = new System.Drawing.Bitmap(bmp, (int)(w * scale), (int)(h * scale));
            }
            using (var ms = new System.IO.MemoryStream())
            {
                var codec = FindEncoder("image/jpeg");
                var ep = new System.Drawing.Imaging.EncoderParameters(1);
                ep.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
                outBmp.Save(ms, codec, ep);
                if (!ReferenceEquals(outBmp, bmp)) outBmp.Dispose();
                return ms.ToArray();
            }
        }
    }

    static System.Drawing.Imaging.ImageCodecInfo FindEncoder(string mime)
    {
        foreach (var c in System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders())
            if (c.MimeType == mime) return c;
        throw new InvalidOperationException("no encoder: " + mime);
    }
}
