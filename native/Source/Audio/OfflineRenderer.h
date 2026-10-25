#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include "AudioEngine.h"

// Bounces the live JUCE graph (voices, drum engines, chromatic sampler, native FX, VST3)
// to a file by driving it block-by-block off-device, with the audio callback held silent.
class OfflineRenderer
{
public:
    // Mirrors the Click panel (MembraneSynth-style click) so a native bounce can include it.
    struct MetronomeConfig
    {
        bool enabled = false;
        double bpm = 120.0;
        double startTick = 0.0;
        int beatsPerMeasure = 4;
        double metronomeVolume = 1.0;   // 0-1, the Click slider
        double gainDb = 0.0;            // Click panel "Gain (dB)"
        double pitchDecay = 0.01;
        double octaves = 2.0;
        double attack = 0.001;
        double decay = 0.1;
        double sustain = 0.0;
        double release = 0.1;
        juce::String downbeatPitch = "C6";
        juce::String upbeatPitch = "C5";
        double downbeatVel = 1.0;
        double upbeatVel = 0.65;
    };

    struct RenderJob
    {
        juce::File outputFile;
        double sampleRate = 44100.0;
        int bitDepth = 24;              // 16, 24 or 32 (32 = IEEE float)
        double totalDurationSeconds = 10.0;
        bool normalize = true;
        double normalizeTargetDb = -1.0;
        bool autoFade = true;
        double fadeSeconds = 0.5;
        // "noteOn" command objects, each with an extra "time" (seconds from render start)
        juce::Array<juce::var> events;
        // [{trackId, muted, soloed}] applied for the bounce and restored afterwards
        juce::Array<juce::var> trackOverrides;
        MetronomeConfig metronome;
    };

    struct Result
    {
        bool success = false;
        juce::String message;
        double peakLinear = 0.0;
        double appliedGain = 1.0;
        int writtenSamples = 0;
    };

    // Parses one serialized "noteOn" command and triggers the engine. Shared with the live bridge.
    static void dispatchNoteOn(AudioEngine& engine, const juce::var& command);

    static Result renderToFile(const RenderJob& job, AudioEngine& engine,
                               double liveSampleRate, int liveBlockSize);
};
