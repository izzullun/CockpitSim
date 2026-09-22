using System.IO;
using System.Net.Http;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace CockpitSim.Launcher;

/// <summary>
/// Startup flow:
///   1. GET {BackendBaseUrl}/api/health (3s timeout)
///   2. Success → initialize WebView2 and navigate to the backend-hosted login page.
///   3. Failure → show the error overlay with a Retry button.
/// The backend is expected to already be running (Windows Service on the FYP
/// PC, `dotnet run` on dev machines) — the launcher never starts it itself.
/// </summary>
public partial class MainWindow : Window
{
    private static readonly TimeSpan HealthTimeout = TimeSpan.FromSeconds(3);

    private readonly LauncherConfig _config = LauncherConfig.Load();
    private bool _webViewReady;
    private bool _webviewSettingsApplied;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += MainWindow_Loaded;
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
        if (await IsBackendHealthyAsync())
        {
            await ShowDashboardAsync();
        }
        else
        {
            StatusPanel.Visibility = Visibility.Collapsed;
            ErrorDetail.Text = $"Tried: {_config.HealthUrl}";
            ErrorOverlay.Visibility = Visibility.Visible;
        }
    }

    private async Task<bool> IsBackendHealthyAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = HealthTimeout };
            using var response = await http.GetAsync(_config.HealthUrl);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
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
