#pragma once
#include <juce_core/juce_core.h>
#include <vector>
#include <cmath>

class VocalModelVoice
{
public:
    struct FormantFilter
    {
        float freq = 800.0f;
        float q = 5.0f;
        float gain = 1.0f;
        float y1 = 0.0f;
        float y2 = 0.0f;

        void processBiquad(float in, float& out, double sampleRate);
    };

    VocalModelVoice();

    void prepare(double sampleRate);
    void reset();

    void triggerVocal(int noteId,
                      float pitchMidi,
                      float velocity,
                      float durationSeconds,
                      const juce::String& vowel = "a",
                      float tractLength = 1.0f,
                      float breathiness = 0.1f,
                      float glottalTension = 0.85f,
                      float vibratoDepth = 30.0f,
                      float vibratoRate = 5.5f);

    void triggerNoteOff();
    void stopImmediately();

    bool isActive() const { return active; }
    int getNoteId() const { return currentNoteId; }

    void renderBlock(float* leftOut, float* rightOut, int numSamples, float trackPan, float trackVol);

private:
    double currentSampleRate = 44100.0;
    bool active = false;
    int currentNoteId = -1;

    double phase = 0.0;
    float basePitch = 60.0f;
    float noteVelocity = 1.0f;
    float remainingSeconds = 0.0f;

    // Parameters
    float tractScale = 1.0f;
    float breathLevel = 0.1f;
    float tension = 0.85f;
    float vibDepth = 30.0f;
    float vibRate = 5.5f;
    double vibPhase = 0.0;

    // Formants (5 resonators: F1, F2, F3, F4, F5)
    static constexpr int NUM_FORMANTS = 5;
    FormantFilter formants[NUM_FORMANTS];

    void setVowelFormants(const juce::String& vowel);
    juce::uint32 noiseSeed = 445566;
    float nextNoise();
};
