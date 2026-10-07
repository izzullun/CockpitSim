using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace CockpitSim.Launcher;

/// <summary>
/// Startup flow:
///   1. GET {BackendBaseUrl}/api/health (3s timeout)
///   2. Not healthy → auto-start the backend (hidden child, .env token +
///      Influx preflight, mirrors Start-CockpitSim.cmd) and wait up to 30s.
///   3. Healthy → initialize WebView2 and navigate to the backend-hosted login page.
///   4. Still down → show the error overlay with a Retry button.
/// Single-click: double-clicking the launcher alone is enough.
/// </summary>
public partial class MainWindow : Window
{
    private readonly LauncherConfig _config = LauncherConfig.Load();
    private readonly BackendHost _backend;
    private readonly BridgeHost _bridge;
    private bool _webViewReady;
    private bool _webviewSettingsApplied;

    public MainWindow()
    {
        _backend = new BackendHost(_config);
        _bridge = new BridgeHost(_config);
        InitializeComponent();
        Loaded += MainWindow_Loaded;
        Closed += (_, _) =>
        {
            _bridge.Dispose();
            _backend.Dispose();
        };
    }

    private async void MainWindow_Loaded(object sender, RoutedEventArgs e)
    {
        await ConnectAsync();
    }

    private async void RetryButton_Click(object sender, RoutedEventArgs e)
    {
        ErrorOverlay.Visibility = Visibility.Collapsed;
        StatusPanel.Visibility = Visibility.Visible;
        await ConnectAsync();
    }

    private async Task ConnectAsync()
    {
        StatusText.Text = "STARTING COCKPITSIM SERVER…";
        if (await _backend.EnsureRunningAsync(msg => StatusText.Text = msg.ToUpperInvariant()))
        {
            await ShowDashboardAsync();
        }
        else
        {
            StatusPanel.Visibility = Visibility.Collapsed;
            ErrorDetail.Text = $"Tried: {_config.HealthUrl} (the app tried to start the backend automatically)";
            ErrorOverlay.Visibility = Visibility.Visible;
        }
    }

    private async Task ShowDashboardAsync()
    {
        StatusPanel.Visibility = Visibility.Collapsed;

        if (!_webViewReady)
        {
            // Fixed user-data folder so localStorage (JWT/session) persists
            // across launches — the app behaves like a real desktop app.
            var userDataFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "CockpitSim", "WebView2");
            Directory.CreateDirectory(userDataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(
                userDataFolder: userDataFolder);
            await WebView.EnsureCoreWebView2Async(environment);

            // Open target="_blank" links in this window instead of an external browser.
            WebView.CoreWebView2.NewWindowRequested += (s, args) =>
            {
                args.NewWindow = WebView.CoreWebView2;
                args.Handled = true;
            };

            _webViewReady = true;
        }

        ApplyWebViewSettings();
        WebView.CoreWebView2.Navigate(_config.LoginUrl);
        WebView.Visibility = Visibility.Visible;

        // Backend is up (we only get here past the health gate), so the
        // bridge can discover sessions immediately — no session id needed.
        _bridge.EnsureRunning();
    }

    private void ApplyWebViewSettings()
    {
        if (_webviewSettingsApplied)
        {
            return;
        }

        var settings = WebView.CoreWebView2.Settings;
#if DEBUG
        // Dev tools + right-click menu available while developing.
        settings.AreDevToolsEnabled = true;
        settings.AreDefaultContextMenusEnabled = true;
#else
        settings.AreDevToolsEnabled = false;
        settings.AreDefaultContextMenusEnabled = false;
#endif
        // Keep browser chrome out of the experience — this is a desktop app,
        // not a browser tab.
        settings.AreBrowserAcceleratorKeysEnabled = false;
        settings.IsStatusBarEnabled = false;

        _webviewSettingsApplied = true;
    }
}
