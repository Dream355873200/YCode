// YCodeStardew —— SMAPI mod：把游戏状态与操作暴露成本地 HTTP 桥（YCode 的
// MCP 服务器消费）。只绑 127.0.0.1；动作在游戏主线程执行（UpdateTicked 派发）。
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Xna.Framework.Input;
using StardewModdingAPI;
using StardewValley;

namespace YCodeStardew
{
    public class ModEntry : Mod
    {
        private IModHelper Helper_;
        private Func<string> pending;           // 监听线程投递、游戏线程执行
        private readonly TaskCompletionSource<string> done = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public override void Entry(IModHelper helper)
        {
            Helper_ = helper;
            helper.Events.GameLoop.UpdateTicked += OnTicked;
            var listener = new System.Net.HttpListener();
            listener.Prefixes.Add("http://127.0.0.1:9875/");
            listener.Start();
            Task.Run(() => ListenLoop(listener));
            Monitor.Log("YCode bridge: http://127.0.0.1:9875（state / warp / press）", LogLevel.Info);
        }

        private void OnTicked(object sender, EventArgs e)
        {
            var f = Interlocked.Exchange(ref pending, null);
            if (f == null) return;
            string r;
            try { r = f(); } catch (Exception ex) { r = "{\"error\":\"" + Esc(ex.Message) + "\"}"; }
            done.TrySetResult(r);
        }

        private async Task ListenLoop(System.Net.HttpListener listener)
        {
            while (listener.IsListening)
            {
                System.Net.HttpListenerContext ctx;
                try { ctx = await listener.GetContextAsync(); } catch { return; }
                string resp;
                try
                {
                    string body = new StreamReader(ctx.Request.InputStream, Encoding.UTF8).ReadToEnd();
                    resp = Dispatch(body);
                }
                catch (Exception ex) { resp = "{\"error\":\"" + Esc(ex.Message) + "\"}"; }
                byte[] buf = Encoding.UTF8.GetBytes(resp);
                ctx.Response.ContentType = "application/json; charset=utf-8";
                ctx.Response.ContentLength64 = buf.Length;
                ctx.Response.OutputStream.Write(buf, 0, buf.Length);
                ctx.Response.OutputStream.Close();
            }
        }

        // body: {"action":"state"|"warp"|"press", "location":"Farm","x":64,"y":15,"button":"MouseRight","times":1}
        private string Dispatch(string body)
        {
            string Get(string key)
            {
                var i = body.IndexOf("\"" + key + "\"");
                if (i < 0) return null;
                i = body.IndexOf(':', i) + 1;
                while (i < body.Length && body[i] == ' ') i++;
                if (i >= body.Length) return null;
                if (body[i] == '"')
                {
                    var j = body.IndexOf('"', i + 1);
                    return j < 0 ? null : body.Substring(i + 1, j - i - 1);
                }
                var j2 = i;
                while (j2 < body.Length && "-0123456789.truefalsn".IndexOf(body[j2]) >= 0) j2++;
                return body.Substring(i, j2 - i);
            }
            var action = Get("action") ?? "state";
            // 游戏状态只能在主线程读/改：投递到 UpdateTicked 执行并等结果
            pending = () => Run(action, Get);
            var task = done.Task;
            var finished = Task.WhenAny(task, Task.Delay(5000)).GetAwaiter().GetResult();
            if (finished != task) return "{\"error\":\"游戏主线程 5s 内未响应（可能在过场/存档）\"}";
            return task.Result;
        }

        private string Run(string action, Func<string, string> get)
        {
            switch (action)
            {
                case "state":
                {
                    var inv = new StringBuilder();
                    foreach (var item in Game1.player.Items)
                    {
                        if (item == null || item.Stack <= 0) continue;
                        if (inv.Length > 0) inv.Append(", ");
                        inv.Append("{\"name\":\"" + Esc(item.Name) + "\",\"stack\":" + item.Stack + "}");
                    }
                    return "{\"location\":\"" + Esc(Game1.player.currentLocation.Name) + "\"" +
                           ",\"tile\":{\"x\":" + Game1.player.TilePoint.X + ",\"y\":" + Game1.player.TilePoint.Y + "}" +
                           ",\"money\":" + Game1.player.Money +
                           ",\"stamina\":" + (int)Game1.player.Stamina +
                           ",\"time\":" + Game1.timeOfDay +
                           ",\"date\":\"" + Game1.currentSeason + " " + Game1.dayOfMonth + " Y" + Game1.year + "\"" +
                           ",\"inventory\":[" + inv + "]}";
                }
                case "warp":
                {
                    var loc = get("location") ?? "Farm";
                    var x = int.Parse(get("x") ?? "64");
                    var y = int.Parse(get("y") ?? "15");
                    Game1.warpFarmer(loc, x, y, false);
                    return "{\"ok\":true,\"warp\":\"" + Esc(loc) + " " + x + "," + y + "\"}";
                }
                case "press":
                {
                    var name = get("button") ?? "MouseRight";
                    if (!Enum.TryParse(name, true, out SButton btn))
                        return "{\"error\":\"未知按键: " + Esc(name) + "（SButton 名，如 MouseRight / W / Space）\"}";
                    var times = 1;
                    int.TryParse(get("times"), out times);
                    if (times < 1) times = 1;
                    for (var i = 0; i < times; i++) Helper_.Input.Simulate(btn);
                    return "{\"ok\":true,\"pressed\":\"" + Esc(name) + "\" x" + times + "}";
                }
                default:
                    return "{\"error\":\"未知 action: " + Esc(action) + "（state / warp / press）\"}";
            }
        }

        private static string Esc(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\r", "");
        }
    }
}
