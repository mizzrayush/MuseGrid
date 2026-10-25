#pragma once
#include <juce_core/juce_core.h>
#include <vector>
#include <array>
#include <cmath>
#include "EnvelopeCurve.h"

class DrumEngine
{
public:
    enum class KitType { Default, Tight, EightOhEight, Electro, Tabla };

    struct DrumVoice
    {
        bool active = false;
        int drumPad = 0; // 0 to 15
        float velocity = 1.0f;
        float elapsedSeconds = 0.0f;
        float durationSeconds = 0.5f;

        // Pitch envelope
        float startFreq = 150.0f;
        float endFreq = 45.0f;
        float pitchDecay = 0.05f;

        // 808 Pitch Slide & Resonance
        float slideSemitones = 0.0f;
        float slideTimeSeconds = 0.0f;
        float filterCutoffHz = 4000.0f;

        // Oscillators
        double phase = 0.0;
        double phase2 = 0.0;
        double metalPhases[6] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
        juce::uint32 noiseSeed = 54321;
        float filterState = 0.0f;
        float filterState2 = 0.0f;

        // 0 = track FX rack; otherwise this hit renders through a per-note FX chain.
        int fxChainId = 0;
    };

    DrumEngine();

    void prepare(double sampleRate);
    void reset();

    void setKit(KitType kit) { currentKit = kit; }
    void setKitByName(const juce::String& kitName);

    void setPadCurveLut(int pad, const float* data, int count)
    {
        if (pad >= 0 && pad < 16) padCurves[pad].setCustomLut(data, count);
    }

    void setPadTension(int pad, float tension)
    {
        if (pad >= 0 && pad < 16) padCurves[pad].setTension(tension);
    }

    void triggerHit(int drumPad, float velocity = 1.0f, float pitchOffsetSemitones = 0.0f, float customDecaySeconds = -1.0f, float slideSemitones = 0.0f, float slideTime = 0.0f, float punchOctaves = -1.0f, float resonanceHz = -1.0f, const juce::String& kitOverride = {}, int fxChainId = 0);
    void allNotesOff()
    {
        for (auto& v : voices) v.active = false;
    }
    void renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol, int fxChainId = 0);
    bool hasActiveVoices() const
    {
        for (const auto& v : voices)
            if (v.active) return true;
        return false;
    }

    std::array<EnvelopeCurve, 16> padCurves;

private:
    double currentSampleRate = 44100.0;
    KitType currentKit = KitType::Default;

    static constexpr int MAX_DRUM_VOICES = 32;
    std::vector<DrumVoice> voices;

    float nextNoise(juce::uint32& seed);
};
