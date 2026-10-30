#pragma once
#include <juce_core/juce_core.h>
#include <juce_events/juce_events.h>
#include <juce_gui_extra/juce_gui_extra.h>
#include <atomic>
#include <functional>
#include "Audio/AudioEngine.h"

class JuceBridge
{
public:
    explicit JuceBridge(AudioEngine& engine);

    // Register all native functions on WebBrowserComponent::Options
    juce::WebBrowserComponent::Options setupOptions(juce::WebBrowserComponent::Options options);

    void setMainWindow(juce::DocumentWindow* win) { mainWindow = win; }
    void setOnForceQuit(std::function<void()> cb) { onForceQuit = std::move(cb); }

private:
    AudioEngine& audioEngine;
    juce::DocumentWindow* mainWindow = nullptr;
    std::function<void()> onForceQuit;

    // Offline bounces run here (one at a time) so the WebView and audio device never block.
    // The destructor waits for the job, and audioEngine outlives this bridge.
    juce::ThreadPool renderPool { 1 };
    std::atomic<int> activeRenders { 0 };

    // Helper handlers
    void handleSaveProject(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleSaveProjectPath(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleOpenProject(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleOpenProjectPath(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleSaveMidi(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleSaveFile(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleRenderAudio(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleRenderAudioTemp(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleReleaseNativeRender(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleShowOpenDialog(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleDeleteFile(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handlePermanentDeleteFile(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleToggleFullscreen(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleSetFullscreen(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleIsFullscreen(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);

    // Real-time audio command dispatch
    void handleAudioCommand(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);

    // Notes that carry a `startTime` (Unix epoch ms, the clock the WebView also reads) are held
    // here until they are due instead of firing when the IPC message lands. Waiting happens on a
    // high-resolution timer so notes keep the spacing the JS scheduler asked for.
    struct PendingNote
    {
        juce::var command;
        juce::int64 dueTicks = 0;
    };

    class NoteScheduler : public juce::HighResolutionTimer
    {
    public:
        explicit NoteScheduler(JuceBridge& bridgeToUse) : bridge(bridgeToUse) {}
        void hiResTimerCallback() override { bridge.dispatchDueNotes(); }
    private:
        JuceBridge& bridge;
    };

    void dispatchDueNotes();
    void cancelPendingNotes();

    // Declared first so the timer stops before the queue it reads is destroyed.
    NoteScheduler noteScheduler { *this };
    const double epochAnchorMs = (double) juce::Time::currentTimeMillis();
    const juce::int64 hrAnchorTicks = juce::Time::getHighResolutionTicks();
    const double hrTicksPerMs = juce::Time::getHighResolutionTicksPerSecond() / 1000.0;
    juce::CriticalSection pendingNotesLock;
    std::vector<PendingNote> pendingNotes;

    // VST3 Hosting Handlers
    void handleVst3Scan(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleVst3GetPlugins(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleVst3OpenEditor(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);

    // Audio Device Manager & Driver Handlers
    void handleGetAudioDeviceSetup(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleSetAudioDeviceSetup(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
};
