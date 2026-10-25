#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_dsp/juce_dsp.h>
#include <vector>
#include <map>
#include <mutex>
#include <atomic>
#include "VoiceManager.h"
#include "DrumEngine.h"
#include "SampleEngine.h"
#include "Vst3Host.h"
#include "Effects/FilterEffect.h"
#include "Effects/DistortionEffect.h"
#include "Effects/DelayEffect.h"
#include "Effects/ReverbEffect.h"
#include "Effects/ChorusEffect.h"
#include "Effects/PhaserEffect.h"
#include "Effects/EQEffect.h"
#include "Effects/BitcrushEffect.h"
#include "Effects/LimiterEffect.h"

struct TrackVst3Fx
{
    juce::String fxId;
    juce::String pluginIdentifier;
    juce::String pluginName;
    std::unique_ptr<juce::AudioPluginInstance> plugin;
    std::unique_ptr<Vst3PluginWindow> editorWindow;
    bool bypassed = false;
    float wet = 1.0f;
};

struct TrackState
{
    juce::String id;
    juce::String instrument = "synth"; // "synth", "drum", "physical", "vocal", "vst3"
    float volume = 0.8f;
    float pan = 0.0f;
    bool muted = false;
    bool soloed = false;

    // Synth Preset
    juce::String synthPreset = "piano";
    SynthVoice::OscType oscType = SynthVoice::OscType::Triangle;
    float attack = 0.004f;
    float decay = 0.28f;
    float sustain = 0.16f;
    float release = 0.36f;
    EnvelopeCurve decayCurve;
    EnvelopeCurve releaseCurve;

    // FX units
    EQEffect eq;
    FilterEffect filter;
    DistortionEffect distortion;
    BitcrushEffect bitcrush;
    ChorusEffect chorus;
    PhaserEffect phaser;
    DelayEffect delay;
    ReverbEffect dpreverb;
    ReverbEffect reverb;
    ReverbEffect freeverb;

    // Drum Engine instance if instrument == "drum"
    DrumEngine drumEngine;

    // Single-sample chromatic sampler (Synth Studio sampler mode)
    bool samplerEnabled = false;
    SampleEngine sampleEngine;

    // VST3 Instrument
    std::unique_ptr<juce::AudioPluginInstance> vst3Instrument;
    std::unique_ptr<Vst3PluginWindow> vst3InstrumentEditor;
    juce::String vst3InstrumentIdentifier;
    juce::String vst3InstrumentName;
    juce::MidiBuffer pendingMidi;
    std::mutex midiMutex;

    struct ScheduledNoteOff
    {
        int midiPitch;
        int sampleCountdown;
    };
    std::vector<ScheduledNoteOff> scheduledNoteOffs;

    // VST3 FX Chain
    std::vector<std::unique_ptr<TrackVst3Fx>> vst3FxChain;
};

class AudioEngine : public juce::AudioIODeviceCallback
{
public:
    AudioEngine();
    ~AudioEngine() override;

    bool init();
    void shutdown();

    // Transport controls
    void play();
    void stop();
    bool isPlaying() const { return playing; }
    void setBpm(float newBpm) { bpm = juce::jlimit(20.0f, 400.0f, newBpm); }
    float getBpm() const { return bpm; }

    // Track management
    void addTrack(const juce::String& trackId, const juce::String& instrument);
    void setTrackInstrument(const juce::String& trackId, const juce::String& instrument);
    void removeTrack(const juce::String& trackId);
    void clearAllTracks();
    void setTrackVolume(const juce::String& trackId, float vol);
    void setTrackPan(const juce::String& trackId, float pan);
    void setTrackMute(const juce::String& trackId, bool mute);
    void setTrackSolo(const juce::String& trackId, bool solo);
    void setTrackSynthParam(const juce::String& trackId, const juce::String& param, float val);
    void setTrackSynthPreset(const juce::String& trackId, const juce::String& presetName);
    void setTrackFxParam(const juce::String& trackId, const juce::String& fxType, const juce::String& param, float val);
    void setTrackDrumKit(const juce::String& trackId, const juce::String& kitName);

    // Chromatic sampler track control
    void setTrackSampler(const juce::String& trackId, bool enabled, const SampleEngine::Config& config, const juce::String& base64Data);

    // Custom Curve LUT & Tension controls
    void setTrackDecayCurveLut(const juce::String& trackId, const float* data, int count);
    void setTrackDecayTension(const juce::String& trackId, float tension);
    void setTrackDecayCurveType(const juce::String& trackId, const juce::String& type, float tension);

    void setDrumPadDecayCurveLut(const juce::String& trackId, int pad, const float* data, int count);
    void setDrumPadTension(const juce::String& trackId, int pad, float tension);

    // Note triggers
    void playNote(const juce::String& trackId,
                  float pitchMidi,
                  float velocity,
                  float durationSeconds,
                  const juce::String& instrument = "",
                  float targetPitchMidi = -1.0f,
                  float slideTimeSeconds = 0.0f,
                  float vibratoDepthCents = 0.0f,
                  float vibratoRateHz = 5.0f,
                  float tremoloDepth = 0.0f,
                  float tremoloRateHz = 6.0f,
                  float filterStartHz = -1.0f,
                  float filterEndHz = -1.0f,
                  float filterSweepTimeSeconds = 0.0f,
                  const juce::String& lyric = "a",
                  float pitchOffsetSemitones = 0.0f,
                  float drumDecay = -1.0f,
                  float slideSemitones = 0.0f,
                  float punchOctaves = -1.0f,
                  float resonanceHz = -1.0f,
                  const musegrid::NoteExpression& expression = {});

    void noteOff(const juce::String& trackId, int noteId = -1);
    void allNotesOff();
    void killAllNotesOnTrack(const juce::String& trackId);

    // Audio device callback overrides
    void audioDeviceIOCallbackWithContext(const float* const* inputChannelData,
                                         int numInputChannels,
                                         float* const* outputChannelData,
                                         int numOutputChannels,
                                         int numSamples,
                                         const juce::AudioIODeviceCallbackContext& context) override;

    void audioDeviceAboutToStart(juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;

    // VST3 Hosting Controls
    Vst3Host& getVst3Host() { return vst3Host; }
    bool setTrackVst3Instrument(const juce::String& trackId, const juce::String& pluginIdentifier);
    void removeTrackVst3Instrument(const juce::String& trackId);
    void openTrackVst3InstrumentEditor(const juce::String& trackId);

    bool addTrackVst3Fx(const juce::String& trackId, const juce::String& fxId, const juce::String& pluginIdentifier);
    void removeTrackVst3Fx(const juce::String& trackId, const juce::String& fxId);
    void setTrackVst3FxBypass(const juce::String& trackId, const juce::String& fxId, bool bypassed);
    void setTrackVst3FxWet(const juce::String& trackId, const juce::String& fxId, float wet);
    void openTrackVst3FxEditor(const juce::String& trackId, const juce::String& fxId);

    void openStandaloneVst3Editor(const juce::String& pluginIdentifier);

    juce::AudioDeviceManager& getDeviceManager() { return deviceManager; }
    double getSampleRate() const { return currentSampleRate; }

    // Offline bounce support: re-prepare the whole graph for a foreign sample rate,
    // and keep the live device silent while a renderer drives the same graph.
    void prepareForRate(double sampleRate, int blockSize);
    void setOfflineBusy(bool busy) { offlineBusy.store(busy, std::memory_order_release); }

    // The offline renderer mixes its metronome click into the master bus, so it defers the
    // limiter and applies it itself once the click is in the block.
    void setMasterLimiterDeferred(bool deferred) { masterLimiterDeferred.store(deferred, std::memory_order_release); }
    void processMasterLimiterBlock(float* const* channelData, int numChannels, int numSamples);

    // Renders one block of the full graph (tracks, FX, VST3, limiter) into the given buffers.
    // Called by the live device callback and by the offline renderer.
    void renderBlock(float* const* outputChannelData, int numOutputChannels, int numSamples);

    bool getTrackMute(const juce::String& trackId);
    bool getTrackSolo(const juce::String& trackId);

private:
    juce::AudioDeviceManager deviceManager;
    double currentSampleRate = 44100.0;
    int currentBlockSize = 512;

    bool playing = false;
    float bpm = 120.0f;
    float masterVolume = 1.0f;
    std::atomic<bool> offlineBusy{ false };
    std::atomic<bool> masterLimiterDeferred{ false };

    VoiceManager voiceManager;
    LimiterEffect masterLimiter;
    Vst3Host vst3Host;

    // Standalone plugin instances for previewing GUI
    std::map<juce::String, std::unique_ptr<Vst3PluginWindow>> standaloneWindows;
    std::map<juce::String, std::unique_ptr<juce::AudioPluginInstance>> standaloneInstances;

    // Mutex for track list modifications from UI thread
    std::recursive_mutex trackMutex;
    std::vector<std::unique_ptr<TrackState>> tracks;

    // Internal render buffers
    juce::AudioBuffer<float> trackBuffer;
    juce::AudioBuffer<float> fxWetBuffer;
    juce::AudioBuffer<float> vst3InstBuffer;
    juce::AudioBuffer<float> masterBuffer;
};
