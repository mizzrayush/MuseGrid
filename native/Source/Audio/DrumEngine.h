#pragma once
#include <juce_core/juce_core.h>
#include <vector>
#include <array>
#include <cmath>
#include "EnvelopeCurve.h"
#include "NoteExpression.h"

class DrumEngine
{
public:
    enum class KitType { Classic, Acoustic, Tight, EightOhEight, Electro, Tabla };

    /**
     * Note-level modulation one hit receives. Everything defaults to "nothing asked for", so a
     * hit with no expression renders exactly as before this struct existed.
     */
    struct HitModulation
    {
        /** Note length floor. A hit may ring longer than its pad, never shorter. */
        float holdSeconds = 0.0f;
        /** Same unit as the synth voices: vibrato depth in cents, rate in Hz. */
        float vibratoDepthCents = 0.0f;
        float vibratoRateHz = 5.0f;
        /** One-shot tone sweep across the hit; -1 on either end means the pad keeps its resonance cutoff. */
        float filterStartHz = -1.0f;
        float filterEndHz = -1.0f;
        float filterSweepSeconds = 0.0f;
    };

    struct DrumVoice
    {
        bool active = false;
        int drumPad = 0; // 0 to 15
        KitType kit = KitType::Classic;
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

        // Per-note modulation. One LFO drives either the oscillator pitch or the noise filter
        // cutoff, chosen by how the pad makes its tone, and the curve slots ride with the voice.
        musegrid::NoteExpression expression;
        float vibratoDepthCents = 0.0f;
        float vibratoRateHz = 5.0f;
        double vibratoPhase = 0.0;
        float vibratoElapsed = 0.0f;
        bool ridesCutoff = false;
        bool hasToneSweep = false;
        float sweepStartHz = 0.0f;
        float sweepEndHz = 0.0f;
        float sweepSeconds = 0.0f;
        float sweepElapsed = 0.0f;

        // Oscillators
        double phase = 0.0;
        double phase2 = 0.0;
        double metalPhases[6] = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0};
        juce::uint32 noiseSeed = 54321;
        float filterState = 0.0f;
        float filterState2 = 0.0f;

        // 0 = track FX rack; otherwise this hit renders through a per-note FX chain.
        int fxChainId = 0;

        // Per-note expression output stage (pan/volume automation and morph crossfades).
        float pan = 0.0f;
        float gain = 1.0f;
        float fadeInSeconds = 0.0f;
        float fadeOutSeconds = 0.0f;
    };

    DrumEngine();

    void prepare(double sampleRate);
    void reset();

    void setKit(KitType kit) { currentKit = kit; }
    void setKitByName(const juce::String& kitName);
    KitType getKit() const { return currentKit; }
    juce::String getCurrentKitName() const
    {
        switch (currentKit)
        {
            case KitType::Acoustic:     return "acoustic";
            case KitType::Tight:        return "tight";
            case KitType::EightOhEight: return "eightOhEight";
            case KitType::Electro:      return "electro";
            case KitType::Tabla:        return "tabla";
            case KitType::Classic:
            default:                    return "classic";
        }
    }

    void setPadCurveLut(int pad, const float* data, int count)
    {
        if (pad >= 0 && pad < 16) padCurves[pad].setCustomLut(data, count);
    }

    void setPadTension(int pad, float tension)
    {
        if (pad >= 0 && pad < 16) padCurves[pad].setTension(tension);
    }

    void triggerHit(int drumPad, float velocity = 1.0f, float pitchOffsetSemitones = 0.0f, float customDecaySeconds = -1.0f, float slideSemitones = 0.0f, float slideTime = 0.0f, float punchOctaves = -1.0f, float resonanceHz = -1.0f, const juce::String& kitOverride = {}, int fxChainId = 0, const musegrid::NoteExpression& expression = {}, const HitModulation& modulation = {});
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
    KitType currentKit = KitType::Classic;

    static constexpr int MAX_DRUM_VOICES = 32;
    std::vector<DrumVoice> voices;

    float nextNoise(juce::uint32& seed);

    /**
     * Pads whose tone is filtered noise put expression on the cutoff; every other pad has an
     * oscillator carrying the note, so it rides pitch. Snare and rimshot count as tonal because
     * their body oscillator is the audible note under the noise.
     */
    static bool padRidesCutoff(int pad)
    {
        return pad == 2 || pad == 3 || pad == 4 || pad == 8 || pad == 9 || pad == 11;
    }
};
