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

    // VST3 Hosting Handlers
    void handleVst3Scan(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleVst3GetPlugins(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleVst3OpenEditor(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);

    // Audio Device Manager & Driver Handlers
    void handleGetAudioDeviceSetup(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
    void handleSetAudioDeviceSetup(const juce::Array<juce::var>& args, juce::WebBrowserComponent::NativeFunctionCompletion complete);
};
