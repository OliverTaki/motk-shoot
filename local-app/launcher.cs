using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class MotkShootLocal
{
    private const int Port = 18321;
    private const string Marker = "MOTK_SHOOT_LOCAL_1";
    private static readonly Dictionary<string, string> Mime = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
        { ".js", "application/javascript; charset=utf-8" }, { ".json", "application/json; charset=utf-8" },
        { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".jpg", "image/jpeg" },
        { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" }, { ".wav", "audio/wav" },
        { ".mp3", "audio/mpeg" }, { ".ico", "image/x-icon" },
    };

    private static HttpListener listener;
    private static string appRoot;
    private static volatile bool running;
    private static DateTime lastPingUtc;
    private static bool receivedPing;

    [STAThread]
    private static int Main(string[] args)
    {
        bool selfTest = Array.Exists(args, value => value == "--self-test");
        bool serverOnly = Array.Exists(args, value => value == "--server-only");
        appRoot = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "_internal", "app"));
        if (!File.Exists(Path.Combine(appRoot, "index.html")))
            return Fail("The application files are missing. Keep the _internal folder next to MOTK Shoot Local.exe.", selfTest);

        if (!StartServer())
        {
            if (IsOurServerRunning())
            {
                if (!selfTest) OpenApp();
                return 0;
            }
            return Fail("MOTK Shoot Local could not start its private local server. Port 18321 is already in use.", selfTest);
        }

        if (selfTest)
        {
            try
            {
                using (var client = new WebClient())
                {
                    string health = client.DownloadString(BaseUrl + "__motk_health");
                    string page = client.DownloadString(BaseUrl + "index.html?edition=local");
                    string shell = client.DownloadString(BaseUrl + "js/local-edition.js");
                    if (health != Marker || !page.Contains("btnCapture") || !page.Contains("timeline") || !shell.Contains("MOTK_LOCAL_EDITION"))
                        throw new InvalidOperationException("The local application contract did not load.");
                }
                Console.WriteLine("MOTK Shoot Local package self-test: PASS");
                StopServer();
                return 0;
            }
            catch (Exception ex)
            {
                StopServer();
                return Fail("Self-test failed: " + ex.Message, true);
            }
        }

        if (!serverOnly) OpenApp();
        while (running)
        {
            Thread.Sleep(1000);
            if (receivedPing && DateTime.UtcNow.Subtract(lastPingUtc).TotalSeconds > 20) StopServer();
        }
        return 0;
    }

    private static string BaseUrl { get { return "http://127.0.0.1:" + Port + "/"; } }

    private static bool StartServer()
    {
        try
        {
            listener = new HttpListener();
            listener.Prefixes.Add(BaseUrl);
            listener.Start();
            running = true;
            lastPingUtc = DateTime.UtcNow;
            var thread = new Thread(ServeLoop) { IsBackground = true, Name = "MOTK Shoot Local Server" };
            thread.Start();
            return true;
        }
        catch { return false; }
    }

    private static void ServeLoop()
    {
        while (running)
        {
            try
            {
                HttpListenerContext context = listener.GetContext();
                ThreadPool.QueueUserWorkItem(_ => Respond(context));
            }
            catch (HttpListenerException) { if (running) Thread.Sleep(50); }
            catch (ObjectDisposedException) { return; }
        }
    }

    private static void Respond(HttpListenerContext context)
    {
        try
        {
            string path = context.Request.Url.AbsolutePath;
            if (path == "/__motk_health") { WriteText(context, 200, Marker, "text/plain; charset=utf-8"); return; }
            if (path == "/__motk_ping")
            {
                receivedPing = true;
                lastPingUtc = DateTime.UtcNow;
                context.Response.Headers["Cache-Control"] = "no-store";
                WriteText(context, 200, "ok", "text/plain; charset=utf-8");
                return;
            }

            string relative = Uri.UnescapeDataString(path.TrimStart('/').Replace('/', Path.DirectorySeparatorChar));
            if (String.IsNullOrWhiteSpace(relative)) relative = "index.html";
            string file = Path.GetFullPath(Path.Combine(appRoot, relative));
            string prefix = appRoot.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
            {
                WriteText(context, 404, "Not found", "text/plain; charset=utf-8");
                return;
            }
            byte[] bytes = File.ReadAllBytes(file);
            string contentType;
            if (!Mime.TryGetValue(Path.GetExtension(file), out contentType)) contentType = "application/octet-stream";
            context.Response.StatusCode = 200;
            context.Response.ContentType = contentType;
            context.Response.Headers["Cache-Control"] = "no-store";
            context.Response.ContentLength64 = bytes.Length;
            context.Response.OutputStream.Write(bytes, 0, bytes.Length);
            context.Response.OutputStream.Close();
        }
        catch { try { context.Response.Abort(); } catch { } }
    }

    private static void WriteText(HttpListenerContext context, int status, string value, string contentType)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        context.Response.StatusCode = status;
        context.Response.ContentType = contentType;
        context.Response.ContentLength64 = bytes.Length;
        context.Response.OutputStream.Write(bytes, 0, bytes.Length);
        context.Response.OutputStream.Close();
    }

    private static void OpenApp()
    {
        string url = BaseUrl + "index.html?edition=local";
        string edge = FindEdge();
        try
        {
            if (edge != null)
            {
                string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MOTKShootLocal", "Browser");
                Directory.CreateDirectory(profile);
                Process.Start(new ProcessStartInfo
                {
                    FileName = edge,
                    Arguments = "--app=\"" + url + "\" --start-maximized --user-data-dir=\"" + profile + "\"",
                    UseShellExecute = false,
                });
            }
            else Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch (Exception ex)
        {
            MessageBox.Show("Could not open the application window.\n\n" + ex.Message, "MOTK Shoot Local", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string FindEdge()
    {
        string[] roots = { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) };
        foreach (string root in roots)
        {
            string path = Path.Combine(root, "Microsoft", "Edge", "Application", "msedge.exe");
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static bool IsOurServerRunning()
    {
        try { using (var client = new WebClient()) return client.DownloadString(BaseUrl + "__motk_health") == Marker; }
        catch { return false; }
    }

    private static void StopServer()
    {
        running = false;
        try { listener.Stop(); listener.Close(); } catch { }
    }

    private static int Fail(string message, bool consoleOnly)
    {
        if (consoleOnly) Console.Error.WriteLine(message);
        else MessageBox.Show(message, "MOTK Shoot Local", MessageBoxButtons.OK, MessageBoxIcon.Error);
        return 1;
    }
}
