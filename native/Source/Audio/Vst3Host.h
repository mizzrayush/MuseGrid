#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_gui_basics/juce_gui_basics.h>
#include <vector>
#include <memory>
#include <functional>
// SEH-protected plugin editor creation implemented in Vst3Host.cpp
juce::AudioProcessorEditor* safeCreatePluginEditor(juce::AudioPluginInstance* plugin);

/**
 * Native VST3 Editor Window using JUCE DocumentWindow.
 * Hosts the genuine native plugin GUI (HWND) with full hardware acceleration,
 * visualizers, and direct user interaction.
 */
class Vst3PluginWindow : public juce::DocumentWindow
{
public:
    Vst3PluginWindow(juce::AudioPluginInstance* plugin, const juce::String& title, std::function<void()> onCloseCallback = nullptr)
        : DocumentWindow(title, juce::Colour(0xff10121a), DocumentWindow::closeButton | DocumentWindow::minimiseButton),
          onClose(onCloseCallback)
    {
        setUsingNativeTitleBar(true);
        if (plugin != nullptr)
        {
            if (auto* editor = safeCreatePluginEditor(plugin))
            {
                int w = editor->getWidth();
                int h = editor->getHeight();
                if (w <= 50 || h <= 50)
                {
                    w = 750;
                    h = 500;
                    editor->setSize(w, h);
                }
                setResizable(editor->isResizable(), false);
                setContentOwned(editor, true);
            }
            else
            {
                juce::Logger::writeToLog("[VST3 Host] Warning: Plugin has no GUI or failed to open editor safely.");
                setSize(500, 300);
            }
        }
        else
        {
            setSize(500, 300);
        }

        centreWithSize(getWidth(), getHeight());
        setAlwaysOnTop(true);
        setVisible(true);
        toFront(true);
        juce::Timer::callAfterDelay(400, [this]() {
            setAlwaysOnTop(false);
            toFront(true);
        });
    }

    ~Vst3PluginWindow() override
    {
        clearContentComponent();
    }

    void closeButtonPressed() override
    {
        setVisible(false);
        if (onClose)
        {
            auto cb = onClose;
            onClose = nullptr;
            cb();
        }
    }

private:
    std::function<void()> onClose;
};

/**
 * Vst3Host manages:
 * 1. juce::AudioPluginFormatManager with VST3 hosting enabled.
 * 2. juce::KnownPluginList with XML caching in AppData for instant startups.
 * 3. System VST3 scanning across standard paths and custom paths.
 * 4. Safe instantiation of VST3 Instruments and Audio Effects.
 */
class Vst3Host
{
public:
    Vst3Host();
    ~Vst3Host();

    void init();

    /** Scan system VST3 folders. Can be run asynchronously on background thread. */
    void scanPluginsAsync(std::function<void(float progress, const juce::String& currentPlugin)> progressCallback,
                          std::function<void(int totalFound)> completeCallback);

    void scanPluginsSync();

    bool isScanning() const { return scanning; }

    juce::var getPluginListAsVar() const;

    std::unique_ptr<juce::PluginDescription> findDescription(const juce::String& identifierOrName) const;

    std::unique_ptr<juce::AudioPluginInstance> instantiatePlugin(const juce::PluginDescription& desc,
                                                                 double sampleRate,
                                                                 int blockSize,
                                                                 juce::String& errorMessage);

    std::unique_ptr<juce::AudioPluginInstance> instantiatePlugin(const juce::String& identifierOrName,
                                                                 double sampleRate,
                                                                 int blockSize,
                                                                 juce::String& errorMessage);

    juce::File getCacheFile() const;
    juce::File getDeadMansPedalFile() const;
    void saveCache();
    void loadCache();

    juce::AudioPluginFormatManager& getFormatManager() { return formatManager; }
    juce::KnownPluginList& getKnownPluginList() { return knownPluginList; }

private:
    juce::AudioPluginFormatManager formatManager;
    juce::KnownPluginList knownPluginList;
    juce::VST3PluginFormat* vst3Format = nullptr;

    bool scanning = false;
    std::unique_ptr<juce::Thread> scanThread;
};
