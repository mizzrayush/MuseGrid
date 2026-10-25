#pragma once
#include <juce_core/juce_core.h>
#include <juce_audio_basics/juce_audio_basics.h>
#include <atomic>
#include <vector>
#include "EnvelopeCurve.h"

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

    void noteOn(int noteId, float pitchMidi, float velocity, float durationSeconds, float pitchOffsetSemitones);
    void noteOff(int noteId);
    void allNotesOff();

    void renderBlock(float* leftOut, float* rightOut, int numSamples);

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
        int bufCh0 = 0;
        int bufCh1 = 1;
        bool usingReverse = false;
        float velocity = 1.0f;
        float remainingSeconds = -1.0f;
        EnvStage stage = EnvStage::Attack;
        float stageElapsed = 0.0f;
        float envValue = 0.0f;
        float sustainLevel = 0.6f;
        float decayAmount = 0.4f;
        float releaseStartLevel = 1.0f;
        Config cfg;
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
