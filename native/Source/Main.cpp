#include <juce_gui_extra/juce_gui_extra.h>
#include "Audio/AudioEngine.h"
#include "Bridge/JuceBridge.h"

//==============================================================================
//==============================================================================
class CustomWebBrowserComponent : public juce::WebBrowserComponent
{
public:
    using WebBrowserComponent::WebBrowserComponent;

    bool pageAboutToLoad (const juce::String& newURL) override
    {
        juce::Logger::writeToLog("[WebBrowser] pageAboutToLoad: " + newURL);
        return true;
    }

    void pageFinishedLoading (const juce::String& url) override
    {
        juce::Logger::writeToLog("[WebBrowser] pageFinishedLoading: " + url);
    }

    bool pageLoadHadNetworkError (const juce::String& error) override
    {
        juce::Logger::writeToLog("[WebBrowser] pageLoadHadNetworkError: " + error);
        return false;
    }

    void newWindowAttemptingToLoad (const juce::String& newURL) override
    {
        juce::Logger::writeToLog("[WebBrowser] newWindowAttemptingToLoad: " + newURL);
    }
};

class MuseGridApplication : public juce::JUCEApplication
{
public:
    MuseGridApplication() {}

    const juce::String getApplicationName() override       { return "MuseGrid"; }
    const juce::String getApplicationVersion() override    { return "1.1.0"; }
    bool moreThanOneInstanceAllowed() override             { return true; }

    void initialise(const juce::String& /*commandLine*/) override
    {
        auto appDataDir = juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("MuseGrid");
        if (!appDataDir.exists()) appDataDir.createDirectory();
        auto logFile = appDataDir.getChildFile("debug.log");
        juce::File devLog("D:\\MyApps\\MuseGrid Native\\debug.log");
        if (devLog.getParentDirectory().exists()) logFile = devLog;

        if (logFile.exists()) logFile.deleteFile();
        fileLogger = std::make_unique<juce::FileLogger>(logFile, "=== MuseGrid Native Log ===");
        juce::Logger::setCurrentLogger(fileLogger.get());
        juce::Logger::writeToLog("App starting up...");

        // 1. Initialise C++ Audio Engine
        juce::Logger::writeToLog("Initialising AudioEngine...");
        try
        {
            audioEngine = std::make_unique<AudioEngine>();
        }
        catch (const std::exception& e)
        {
            juce::Logger::writeToLog("Exception in AudioEngine ctor: " + juce::String(e.what()));
            return;
        }
        catch (...)
        {
            juce::Logger::writeToLog("Unknown exception in AudioEngine ctor!");
            return;
        }
        if (!audioEngine->init())
        {
            juce::Logger::writeToLog("Warning: AudioEngine init encountered issues.");
        }
        juce::Logger::writeToLog("AudioEngine initialised successfully.");

        // 2. Initialise Bridge
        juce::Logger::writeToLog("Initialising JuceBridge...");
        bridge = std::make_unique<JuceBridge>(*audioEngine);
        juce::Logger::writeToLog("JuceBridge initialised successfully.");

        // 3. Create Main Window
        juce::Logger::writeToLog("Creating MainWindow...");
        mainWindow = std::make_unique<MainWindow>(getApplicationName(), *audioEngine, *bridge);
        bridge->setMainWindow(mainWindow.get());
        juce::Logger::writeToLog("MainWindow created successfully.");
    }

    void shutdown() override
    {
        mainWindow = nullptr;
        bridge = nullptr;
        if (audioEngine)
        {
            audioEngine->shutdown();
            audioEngine = nullptr;
        }
        juce::Logger::setCurrentLogger(nullptr);
        fileLogger = nullptr;
    }

    void systemRequestedQuit() override
    {
        quit();
    }

    void anotherInstanceStarted(const juce::String& /*commandLine*/) override {}

    //==============================================================================
    class MainWindow : public juce::DocumentWindow
    {
    public:
        MainWindow(const juce::String& name, AudioEngine& engine, JuceBridge& bridge)
            : DocumentWindow(name,
                             juce::Colour(0xff0a0a0f), // Dark industrial workspace color
                             DocumentWindow::allButtons),
              audioEngineRef(engine),
              bridgeRef(bridge)
        {
            setUsingNativeTitleBar(true);

            // Locate web distribution folder
            auto exeFile = juce::File::getSpecialLocation(juce::File::currentExecutableFile);
            distDir = exeFile.getParentDirectory().getChildFile("dist");
            if (!distDir.exists())
            {
                // Fallback to project root / dist during development
                distDir = exeFile.getParentDirectory().getParentDirectory().getParentDirectory().getChildFile("dist");
            }
            if (!distDir.exists())
            {
                // Try workspace directory directly
                distDir = juce::File("D:\\MyApps\\MuseGrid Native\\dist");
            }

            // Configure WebBrowserComponent
            auto options = juce::WebBrowserComponent::Options{}
                .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
                .withWinWebView2Options(juce::WebBrowserComponent::Options::WinWebView2{}
                    .withUserDataFolder(juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("MuseGrid_WebView2"))
                    .withStatusBarDisabled()
                    .withBackgroundColour(juce::Colour(0xff0a0a0f)))
                .withKeepPageLoadedWhenBrowserIsHidden();

            options = bridgeRef.setupOptions(options);

            options = options.withResourceProvider([this](const juce::String& url) -> std::optional<juce::WebBrowserComponent::Resource> {
                juce::Logger::writeToLog("[ResourceProvider] Entering with url: " + url);
                juce::String cleanUrl = url.upToFirstOccurrenceOf("?", false, false).upToFirstOccurrenceOf("#", false, false);
                if (cleanUrl == "/" || cleanUrl.isEmpty()) cleanUrl = "/index.html";

                if (cleanUrl.startsWithChar('/')) cleanUrl = cleanUrl.substring(1);

                juce::File targetFile;
                if (cleanUrl.startsWith("musegrid-render/"))
                {
                    // Only files the bridge wrote into its private temp folder are reachable.
                    const juce::String name = cleanUrl.substring(juce::String("musegrid-render/").length());
                    if (name.isNotEmpty() && !name.contains("..") && !name.containsChar('/') && !name.containsChar('\\'))
                        targetFile = juce::File::getSpecialLocation(juce::File::tempDirectory)
                                        .getChildFile("MuseGridRenders").getChildFile(name);
                }
                else
                {
                    targetFile = distDir.getChildFile(cleanUrl);

                    if (!targetFile.existsAsFile())
                    {
                        // Fallback to public assets
                        auto publicFile = distDir.getParentDirectory().getChildFile("public").getChildFile(cleanUrl);
                        if (publicFile.existsAsFile()) targetFile = publicFile;
                    }

                    if (!targetFile.existsAsFile())
                    {
                        // Additional fallback to workspace dist
                        auto wsDistFile = juce::File("D:\\MyApps\\MuseGrid Native\\dist").getChildFile(cleanUrl);
                        if (wsDistFile.existsAsFile()) targetFile = wsDistFile;
                    }
                }

                if (targetFile.existsAsFile())
                {
                    juce::MemoryBlock block;
                    targetFile.loadFileAsData(block);

                    std::vector<std::byte> data(block.getSize());
                    std::memcpy(data.data(), block.getData(), block.getSize());

                    juce::String ext = targetFile.getFileExtension().toLowerCase().replace(".", "");
                    juce::String mime = "application/octet-stream";

                    if (ext == "html" || ext == "htm")   mime = "text/html; charset=utf-8";
                    else if (ext == "js" || ext == "mjs") mime = "text/javascript; charset=utf-8";
                    else if (ext == "css")                mime = "text/css; charset=utf-8";
                    else if (ext == "wasm")               mime = "application/wasm";
                    else if (ext == "svg")                mime = "image/svg+xml";
                    else if (ext == "png")                mime = "image/png";
                    else if (ext == "ico")                mime = "image/x-icon";
                    else if (ext == "json")               mime = "application/json; charset=utf-8";
                    else if (ext == "woff2")              mime = "font/woff2";
                    else if (ext == "wav")                mime = "audio/wav";

                    return juce::WebBrowserComponent::Resource{ std::move(data), mime };
                }

                juce::Logger::writeToLog("[ResourceProvider] NOT FOUND: " + url + " -> " + targetFile.getFullPathName());
                return std::nullopt;
            }, "*");

            browserComponent = std::make_unique<CustomWebBrowserComponent>(options);
            setContentNonOwned(browserComponent.get(), false);

            setResizable(true, true);
            setResizeLimits(960, 580, 3840, 2160);
            setSize(1080, 700);
            centreWithSize(1080, 700);

            juce::Logger::writeToLog("distDir: " + distDir.getFullPathName() + " (exists: " + juce::String(distDir.exists() ? "YES" : "NO") + ")");
            juce::Logger::writeToLog("Navigating to: " + browserComponent->getResourceProviderRoot());

            // Load UI via resource provider root or local file
            browserComponent->goToURL(browserComponent->getResourceProviderRoot());

            bridgeRef.setOnForceQuit([this]() {
                forceQuitAllowed = true;
                if (auto* app = juce::JUCEApplication::getInstance())
                    app->systemRequestedQuit();
            });

            setVisible(true);
        }

        void closeButtonPressed() override
        {
            if (forceQuitAllowed)
            {
                if (auto* app = juce::JUCEApplication::getInstance())
                    app->systemRequestedQuit();
                return;
            }

            if (browserComponent != nullptr)
            {
                browserComponent->evaluateJavascript(
                    "if (typeof window.__handleAppCloseRequest === 'function') { "
                    "    window.__handleAppCloseRequest(); "
                    "} else { "
                    "    window.dispatchEvent(new CustomEvent('app-request-close')); "
                    "}"
                );
            }
            else
            {
                if (auto* app = juce::JUCEApplication::getInstance())
                    app->systemRequestedQuit();
            }
        }

        void resized() override
        {
            DocumentWindow::resized();
            if (browserComponent != nullptr)
            {
                browserComponent->setBounds(getContentComponentBorder().subtractedFrom(getLocalBounds()));
            }
        }

    private:
        AudioEngine& audioEngineRef;
        JuceBridge& bridgeRef;
        juce::File distDir;
        std::unique_ptr<CustomWebBrowserComponent> browserComponent;
        bool forceQuitAllowed = false;

        JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MainWindow)
    };

private:
    std::unique_ptr<juce::FileLogger> fileLogger;
    std::unique_ptr<AudioEngine> audioEngine;
    std::unique_ptr<JuceBridge> bridge;
    std::unique_ptr<MainWindow> mainWindow;
};

//==============================================================================
START_JUCE_APPLICATION(MuseGridApplication)
