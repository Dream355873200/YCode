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
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int nCmdShow);

    // SW_RESTORE：最小化窗口的矩形是 (-32000,-32000,219,30)，UIA 树几乎是空的、
    // 截图必是一片灰。观察/截图前先恢复窗口，否则拿到的是无意义的空状态。
    public const int SW_RESTORE = 9;
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    // PrintWindow 的 PW_RENDERFULLCONTENT：让窗口把自己渲染进 DC，而不是从屏幕表面拷。
    // 没有它，被遮挡的窗口、以及硬件加速的窗口（浏览器 / Electron / 播放器）会截出
    // 一片灰或黑——这正是"截图返回灰色画面"的根因。
    public const uint PW_RENDERFULLCONTENT = 0x00000002;

    // ---- 点击前的遮挡校验 ----
    //
    // SendInput 注入的鼠标事件由系统派发给"该坐标点上最顶层的窗口"，不是派发给"我们想点的窗口"。
    // 目标窗口被遮挡（或根本不在那个位置）时，坐标点击会落到别的应用上——必须先问系统
    // "这个点上是哪个窗口"，与目标窗口的根祖先比对，不一致就拒绝点击。
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    public const uint GA_ROOT = 2;

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT { public int X, Y; }

    // 该屏幕点上最顶层的窗口是否属于 target（target 自身或其子/后代窗口）
    public static bool IsPointOnWindow(int x, int y, IntPtr target)
    {
        var p = new POINT { X = x, Y = y };
        IntPtr hit = WindowFromPoint(p);
        if (hit == IntPtr.Zero) return false;
        return GetAncestor(hit, GA_ROOT) == GetAncestor(target, GA_ROOT);
    }

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

    // ---- 屏幕截取（窗口走 PrintWindow，全屏走 GDI 拷屏；JPEG 编码共用）----
    //
    // 返回 ShotResult：Jpeg 字节 + Blank 标记。Blank 用于把"截到一片纯色"这种
    // 静默失败显式暴露给模型，避免它把灰图当真实画面做判断。
    public class ShotResult
    {
        public byte[] Jpeg;
        public bool Blank;
    }

    public static ShotResult CaptureScreen(int x, int y, int w, int h, int maxEdge, long quality)
    {
        using (var bmp = new System.Drawing.Bitmap(w, h))
        {
            using (var g = System.Drawing.Graphics.FromImage(bmp))
            {
                g.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h));
            }
            return Finish(bmp, maxEdge, quality);
        }
    }

    // 窗口截图：优先 PrintWindow(PW_RENDERFULLCONTENT)（可见性/遮挡无关，
    // 硬件加速窗口也能拿到内容），失败再回退到按窗口矩形拷屏。
    public static ShotResult CaptureWindow(IntPtr hwnd, int x, int y, int w, int h, int maxEdge, long quality)
    {
        using (var bmp = new System.Drawing.Bitmap(w, h))
        {
            bool printed = false;
            using (var g = System.Drawing.Graphics.FromImage(bmp))
            {
                IntPtr hdc = g.GetHdc();
                try { printed = PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT); }
                finally { g.ReleaseHdc(hdc); }
                if (!printed)
                {
                    g.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h));
                }
            }
            var r = Finish(bmp, maxEdge, quality);
            // 用"客户区是否纯色"判断，而不是整图：Chromium 类窗口的标题栏/标签栏是 GDI
            // 绘制的、PrintWindow 能截到，页面内容（GPU 合成）截不到——整图看是"非纯色"，
            // 只有客户区看才是纯色。整图判断会让回退永不触发。
            if (printed && IsUniformRegion(bmp, 0.12))
            {
                // 客户区一片纯色：多半是 GPU 合成内容没渲染出来，再拷屏试一次，
                // 谁的内容多就用谁（窗口可见时拷屏能拿到完整页面）。
                using (var bmp2 = new System.Drawing.Bitmap(w, h))
                {
                    using (var g2 = System.Drawing.Graphics.FromImage(bmp2))
                    {
                        g2.CopyFromScreen(x, y, 0, 0, new System.Drawing.Size(w, h));
                    }
                    if (!IsUniformRegion(bmp2, 0.12)) return Finish(bmp2, maxEdge, quality);
                }
            }
            return r;
        }
    }

    static ShotResult Finish(System.Drawing.Bitmap bmp, int maxEdge, long quality)
    {
        bool blank = IsUniform(bmp);
        var outBmp = bmp;
        var scale = Math.Max(bmp.Width, bmp.Height) > maxEdge ? (double)maxEdge / Math.Max(bmp.Width, bmp.Height) : 1.0;
        if (scale < 1.0)
        {
            outBmp = new System.Drawing.Bitmap(bmp, (int)(bmp.Width * scale), (int)(bmp.Height * scale));
        }
        using (var ms = new System.IO.MemoryStream())
        {
            var codec = FindEncoder("image/jpeg");
            var ep = new System.Drawing.Imaging.EncoderParameters(1);
            ep.Param[0] = new System.Drawing.Imaging.EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);
            outBmp.Save(ms, codec, ep);
            if (!ReferenceEquals(outBmp, bmp)) outBmp.Dispose();
            return new ShotResult { Jpeg = ms.ToArray(), Blank = blank };
        }
    }

    // 抽样判断整图是否近似纯色（>=99% 采样点同色）——灰图/黑图检测
    static bool IsUniform(System.Drawing.Bitmap bmp)
    {
        return IsUniformRegion(bmp, 0.0);
    }

    // 同上，但可跳过顶部 topSkip 比例（标题栏/标签栏）与底部 8%（状态栏）
    static bool IsUniformRegion(System.Drawing.Bitmap bmp, double topSkip)
    {
        int y0 = (int)(bmp.Height * topSkip);
        int y1 = bmp.Height - (int)(bmp.Height * 0.08);
        if (y1 - y0 < 8) { y0 = 0; y1 = bmp.Height; }
        int stepX = Math.Max(1, bmp.Width / 24), stepY = Math.Max(1, (y1 - y0) / 24);
        var counts = new System.Collections.Generic.Dictionary<int, int>();
        int total = 0, top = 0;
        for (int y = y0; y < y1; y += stepY)
        {
            for (int x = 0; x < bmp.Width; x += stepX)
            {
                int c = bmp.GetPixel(x, y).ToArgb();
                int n; counts.TryGetValue(c, out n); counts[c] = n + 1;
                total++;
                if (counts[c] > top) top = counts[c];
            }
        }
        return total > 0 && top >= total * 0.99;
    }

    static System.Drawing.Imaging.ImageCodecInfo FindEncoder(string mime)
    {
        foreach (var c in System.Drawing.Imaging.ImageCodecInfo.GetImageEncoders())
            if (c.MimeType == mime) return c;
        throw new InvalidOperationException("no encoder: " + mime);
    }
}
