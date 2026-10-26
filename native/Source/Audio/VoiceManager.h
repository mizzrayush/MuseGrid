#pragma once
#include <juce_core/juce_core.h>
#include <vector>
#include <unordered_map>
#include "SynthVoice.h"
#include "PhysicalModelVoice.h"
#include "VocalModelVoice.h"

class VoiceManager
{
public:
    VoiceManager();

    void prepare(double sampleRate);
    void reset();

    void noteOnSynth(const juce::String& trackId,
                     int noteId,
                     float pitchMidi,
                     float velocity,
                     float durationSeconds,
                     const juce::String& presetName = "",
                     SynthVoice::OscType oscType = SynthVoice::OscType::Triangle,
                     float attack = 0.02f, float decay = 0.12f, float sustain = 0.48f, float release = 0.35f,
                     float targetPitchMidi = -1.0f,
                     float slideTimeSeconds = 0.0f,
                     float vibratoDepthCents = 0.0f,
                     float vibratoRateHz = 5.0f,
                     float tremoloDepth = 0.0f,
                     float tremoloRateHz = 6.0f,
                     float filterStartHz = -1.0f,
                     float filterEndHz = -1.0f,
                     float filterSweepTimeSeconds = 0.0f,
                     const EnvelopeCurve* customDecayCurve = nullptr,
                     const EnvelopeCurve* customReleaseCurve = nullptr,
                     const musegrid::NoteExpression& expression = {});

    void noteOnPhysical(const juce::String& trackId,
                        int noteId,
                        float pitchMidi,
                        float velocity,
                        float durationSeconds,
                        float damping = 0.5f,
                        float pluckPos = 0.5f,
                        int fxChainId = 0,
                        const musegrid::NoteExpression& expression = {},
                        float targetPitchMidi = -1.0f,
                        float slideTimeSeconds = 0.0f);

    void noteOnVocal(const juce::String& trackId,
                     int noteId,
                     float pitchMidi,
                     float velocity,
                     float durationSeconds,
                     const juce::String& vowel = "a",
                     float tractLength = 1.0f,
                     float breathiness = 0.1f,
                     float tension = 0.85f,
                     int fxChainId = 0,
                     const musegrid::NoteExpression& expression = {},
                     float targetPitchMidi = -1.0f,
                     float slideTimeSeconds = 0.0f);

    void noteOff(const juce::String& trackId, int noteId);
    void allNotesOff();
    void killAllNotesOnTrack(const juce::String& trackId);

    // chainId 0 renders the voices that use the track FX rack; any other value renders only
    // the voices routed to that per-note chain.
    void renderVoices(const juce::String& trackId, float* leftOut, float* rightOut, int numSamples,
                      float trackPan, float trackVol, int fxChainId = 0);

private:
    double currentSampleRate = 44100.0;

    static constexpr int MAX_SYNTH_VOICES = 64;
    static constexpr int MAX_PHYS_VOICES = 32;
    static constexpr int MAX_VOCAL_VOICES = 16;

    struct TrackedVoice
    {
        juce::String trackId;
        int fxChainId = 0;
        SynthVoice voice;
    };

    struct TrackedPhysVoice
    {
        juce::String trackId;
        int fxChainId = 0;
        PhysicalModelVoice voice;
    };

    struct TrackedVocalVoice
    {
        juce::String trackId;
        int fxChainId = 0;
        VocalModelVoice voice;
    };

    std::vector<TrackedVoice> synthVoices;
    std::vector<TrackedPhysVoice> physVoices;
    std::vector<TrackedVocalVoice> vocalVoices;

    int nextSynthVoiceIndex = 0;
    int nextPhysVoiceIndex = 0;
    int nextVocalVoiceIndex = 0;
};
