#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <vector>
#include <array>
#include "EnvelopeCurve.h"
#include "NoteExpression.h"

// Single-sample chromatic sampler (Simpler / Quick Sampler style):
// one root audio file repitched across the keyboard via playbackRate = 2^((midi - root) / 12).
class SampleEngine
{
public:
    enum class EnvStage { Attack, Decay, Sustain, Release };

    struct Config
    {
        int   rootNote   = 60;
        float tuning     = 0.0f;   // semitones
        float fineTune   = 0.0f;   // cents
        float startOffset = 0.0f;  // normalized 0..1
        float endOffset   = 1.0f;  // normalized 0..1
        float loopStartOffset = -1.0f; // normalized; < 0 means "same as startOffset"
        float loopEndOffset   = -1.0f; // normalized; < 0 means "same as endOffset"
        int   loopMode   = 0;          // 0 = sustain while held, 1 = release tail after the note
        bool  loop     = false;
        bool  reverse  = false;
        float attack   = 0.005f;
        float decay    = 0.25f;
        float sustain  = 0.6f;
        float release  = 0.35f;
        float volume   = 1.0f;
        float pan      = 0.0f;
    };

    SampleEngine();

    void prepare(double sampleRate);
    void reset();

    // Message-thread only. base64Data may be empty (config-only update, reuses loaded buffer)
    // or a "data:audio/...;base64,..." URI / raw base64 of a WAV file (re-decodes buffer).
    void setConfig(const Config& newConfig, const juce::String& base64Data);

    void noteOn(int noteId, float pitchMidi, float velocity, float durationSeconds, float pitchOffsetSemitones, int fxChainId = 0,
                const musegrid::NoteExpression& expression = {}, float targetPitchMidi = -1.0f, float slideTimeSeconds = 0.0f);
    void noteOff(int noteId);
    void allNotesOff();

    // Renders only voices tagged with fxChainId (0 = voices without a per-note chain).
    void renderBlock(float* leftOut, float* rightOut, int numSamples, int fxChainId = 0);

    bool isReady() const { return readyFlag.load(std::memory_order_acquire); }

private:
    struct Voice
    {
        bool active = false;
        int noteId = -1;
        double position = 0.0;
        double rate = 1.0;
        double startIdx = 0.0;
        double endIdx = 0.0;
        // Sustain span in original-buffer sample coordinates (mapped for reverse at render time).
        double loopStartIdx = 0.0;
        double loopEndIdx = 0.0;
        int bufCh0 = 0;
        int bufCh1 = 1;
        bool usingReverse = false;
        // True when this voice should wrap inside its trimmed region instead of releasing at
        // the region end: either the patch loops, or the note is longer than the region.
        bool loopWhileHeld = false;
        // Release-tail voices resume loop end -> trim end once the note lets go.
        bool releaseTail = false;
        bool tailJumpPending = false;
        float tailSeconds = 0.0f;
        float releaseSeconds = 0.35f;
        float velocity = 1.0f;
        int fxChainId = 0;
        float remainingSeconds = -1.0f;
        EnvStage stage = EnvStage::Attack;
        float stageElapsed = 0.0f;
        float envValue = 0.0f;
        float sustainLevel = 0.6f;
        float decayAmount = 0.4f;
        float releaseStartLevel = 1.0f;
        Config cfg;

        // Pitch glide (playback-rate ramp) with the shared curve LUT.
        double startRate = 1.0;
        double targetRate = 1.0;
        bool sliding = false;
        float glideSeconds = 0.0f;
        float glideElapsed = 0.0f;
        std::array<float, musegrid::NoteExpression::kCurvePoints> glideCurve {};
        int glideCurveSize = 0;
        bool steppedGlide = false;

        // Per-note output stage: morph crossfade, volume automation and pan trim.
        float elapsedSeconds = 0.0f;
        float fadeInSeconds = 0.0f;
        float fadeOutSeconds = 0.0f;
        float gain = 1.0f;
        float pan = 0.0f;
    };

    static juce::AudioBuffer<float>* decodeToBuffer(const juce::MemoryBlock& bytes);
    static juce::AudioBuffer<float>* makeReversed(const juce::AudioBuffer<float>& src);
    void swapBuffers(juce::AudioBuffer<float>* newMain, int hash, int generation);

    double currentSampleRate = 44100.0;
    static constexpr int MAX_VOICES = 24;
    std::vector<Voice> voices;
    int nextVoiceIndex = 0;

    std::atomic<juce::AudioBuffer<float>*> mainBuffer{ nullptr };
    std::atomic<juce::AudioBuffer<float>*> reverseBuffer{ nullptr };
    std::atomic<double> atomicSampleRate{ 44100.0 };
    std::atomic<bool> readyFlag{ false };

    Config config;
    int bufferHash = 0;        // hash of base64 currently requested (message thread)
    int bufferLoadedHash = 0;  // hash of buffer currently live (message thread)
    std::atomic<int> decodeGeneration{ 0 };
    EnvelopeCurve decayCurve;
    EnvelopeCurve releaseCurve;
};
