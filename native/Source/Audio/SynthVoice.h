#pragma once
#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>
#include <cmath>
#include <array>
#include "EnvelopeCurve.h"
#include "NoteExpression.h"

class SynthVoice
{
public:
    enum class OscType { Sine, Triangle, Square, Saw, Noise };

    SynthVoice();

    void prepare(double sampleRate);
    void reset();

    void triggerNoteOn(int noteId,
                       float pitchMidi,
                       float velocity,
                       float durationSeconds,
                       float targetPitchMidi = -1.0f,
                       float slideTimeSeconds = 0.0f,
                       float vibratoDepthCents = 0.0f,
                       float vibratoRateHz = 5.0f,
                       float tremoloDepth = 0.0f,
                       float tremoloRateHz = 6.0f,
                       float filterStartHz = -1.0f,
                       float filterEndHz = -1.0f,
                       float filterSweepTimeSeconds = 0.0f,
                       const musegrid::NoteExpression& expression = {});

    void triggerNoteOff();
    void stopImmediately();

    bool isActive() const { return active; }
    int getNoteId() const { return currentNoteId; }
    float getOriginalPitch() const { return startPitch; }

    // Sound customization
    void setOscType(OscType type) { oscType = type; }
    void setAdsr(float a, float d, float s, float r);
    void setPreset(const juce::String& presetName);
    void setDecayCurve(const EnvelopeCurve& curve) { decayCurve = curve; }
    void setReleaseCurve(const EnvelopeCurve& curve) { releaseCurve = curve; }
    void setFmParams(bool enabled, float harmonicity, float modIndex,
                     float modA = 0.01f, float modD = 0.2f, float modS = 0.1f, float modR = 0.2f);

    // Audio generation per sample block
    void renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol);

private:
    double currentSampleRate = 44100.0;
    bool active = false;
    int currentNoteId = -1;

    // Pitch & Oscillators
    OscType oscType = OscType::Saw;
    double currentPhase = 0.0;
    float startPitch = 60.0f;
    float currentPitch = 60.0f;
    float targetPitch = 60.0f;
    float slideDuration = 0.0f;
    float slideElapsed = 0.0f;
    bool isSliding = false;
    musegrid::NoteExpression expression;
    float vibratoElapsed = 0.0f;
    float tremoloElapsed = 0.0f;

    // FM Synthesis
    bool isFM = false;
    float fmHarmonicity = 1.0f;
    float fmModIndex = 0.0f;
    double fmPhase = 0.0;
    float fmModAttack = 0.01f;
    float fmModDecay = 0.2f;
    float fmModSustain = 0.1f;
    float fmModRelease = 0.2f;
    float fmModEnvValue = 0.0f;

    // Vibrato & Tremolo
    float vibDepth = 0.0f;
    float vibRate = 5.0f;
    double vibPhase = 0.0;

    float tremDepth = 0.0f;
    float tremRate = 6.0f;
    double tremPhase = 0.0;

    // ADSR Envelope
    enum class EnvStage { Off, Attack, Decay, Sustain, Release };
    EnvStage envStage = EnvStage::Off;
    float attackTime = 0.005f;
    float decayTime = 0.15f;
    float sustainLevel = 0.7f;
    float releaseTime = 0.25f;
    float envValue = 0.0f;
    float noteVelocity = 1.0f;
    EnvelopeCurve decayCurve;
    EnvelopeCurve releaseCurve;
    float stageElapsed = 0.0f;
    float releaseStartLevel = 0.0f;

    // Filter sweep
    bool hasFilterSweep = false;
    float filterCutoffStart = 20000.0f;
    float filterCutoffEnd = 20000.0f;
    float filterSweepDuration = 0.0f;
    float filterSweepElapsed = 0.0f;
    float currentFilterCutoff = 20000.0f;
    float filterState = 0.0f;

    // Note duration tracker (for auto release if duration provided)
    float remainingDuration = -1.0f;

    // PRNG for noise
    juce::uint32 noiseSeed = 123456789;
    float nextNoise();

    static float sampleCurve(const std::array<float, musegrid::NoteExpression::kCurvePoints>& curve,
                            int count, float t);
    static float waveform(int wave, double phase);
};
